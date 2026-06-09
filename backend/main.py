import os, csv, io, re
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
import anthropic
from supabase import create_client
from datetime import date
import extract_msg

app = FastAPI(title="Kist Cotações API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Clientes ──────────────────────────────────────────────────────────────────
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SUPABASE_URL  = os.environ.get("SUPABASE_URL", "https://owpmcoithvzdlhmfkvbe.supabase.co")
SUPABASE_KEY  = os.environ.get("SUPABASE_KEY", "")

def get_claude():
    return anthropic.Anthropic(api_key=ANTHROPIC_KEY)

def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Prompt de sistema ─────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Você é o assistente comercial da Kist Soluções em Telecom e Energia.
Sua tarefa é extrair itens de cotação de e-mails e retornar um JSON estruturado.

RETORNE APENAS JSON VÁLIDO, sem texto antes ou depois, sem markdown, sem blocos de código.

Formato de saída:
{
  "cliente": "NOME DO CLIENTE",
  "cnpj": "XX.XXX.XXX/XXXX-XX",
  "rc_neg": "RC XXXXX ou NEG-XXXXXXX",
  "proposta": "número fornecido pelo usuário ou null",
  "itens": [
    {
      "descricao": "descrição completa do item",
      "quantidade": 1,
      "unidade": "UN"
    }
  ]
}

Regras:
- Extraia TODOS os itens listados no e-mail
- Preserve a descrição original do item
- Se não encontrar CNPJ, deixe null
- Unidade padrão é UN se não especificada
- quantidade deve ser número (não string)
"""

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "banco": SUPABASE_URL}


@app.post("/extrair")
async def extrair_email(
    texto: str = Form(None),
    arquivo: UploadFile = File(None),
    numero_proposta: str = Form(...)
):
    """Extrai itens do e-mail (texto ou .msg) e retorna com preços do banco"""

    # 1. Obter texto do e-mail
    conteudo = ""
    if arquivo and arquivo.filename.endswith(".msg"):
        dados = await arquivo.read()
        with open("/tmp/upload.msg", "wb") as f:
            f.write(dados)
        msg = extract_msg.openMsg("/tmp/upload.msg")
        conteudo = f"Assunto: {msg.subject}\n\n{msg.body}"
    elif texto:
        conteudo = texto
    else:
        raise HTTPException(400, "Envie texto ou arquivo .msg")

    # 2. Claude extrai os itens
    claude = get_claude()
    resp = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Número da proposta: {numero_proposta}\n\nE-mail:\n{conteudo}"}]
    )

    import json
    try:
        dados_email = json.loads(resp.content[0].text)
    except Exception as e:
        raise HTTPException(500, f"Erro ao parsear resposta do Claude: {str(e)}\nResposta: {resp.content[0].text[:500]}")

    # 3. Para cada item, buscar preço no Supabase
    sb = get_supabase()
    itens_com_preco = []

    for item in dados_email.get("itens", []):
        desc = item["descricao"]
        preco_un = 0.0
        desc_banco = desc
        obs_item = "SEM PREÇO"

        # Busca por full text search
        try:
            # Normalizar descrição para busca
            termos = re.sub(r'[^a-zA-Z0-9À-ÿ\s]', ' ', desc)
            termos = ' '.join(termos.split()[:6])

            res = sb.rpc('buscar_produto', {'termo': termos}).execute()
            if res.data and len(res.data) > 0:
                match = res.data[0]
                preco_un = float(match.get('preco_un') or 0)
                desc_banco = match.get('descricao', desc)
                proposta_ref = match.get('proposta_tiny', '')
                obs_item = f"ref proposta {proposta_ref}" if proposta_ref else ""
        except Exception:
            # Fallback: busca simples por ILIKE
            try:
                palavras = [p for p in desc.upper().split() if len(p) > 4][:3]
                query = sb.table('produtos').select('descricao,preco_un,proposta_tiny,data_ref')
                for p in palavras:
                    query = query.ilike('descricao', f'%{p}%')
                res = query.order('data_ref', desc=True).limit(1).execute()
                if res.data:
                    match = res.data[0]
                    preco_un = float(match.get('preco_un') or 0)
                    desc_banco = match.get('descricao', desc)
                    proposta_ref = match.get('proposta_tiny', '')
                    obs_item = f"ref proposta {proposta_ref}" if proposta_ref else ""
            except Exception:
                pass

        itens_com_preco.append({
            "descricao_original": desc,
            "descricao_final": desc_banco,
            "quantidade": item.get("quantidade", 1),
            "unidade": item.get("unidade", "UN"),
            "preco_un": preco_un,
            "obs": obs_item,
            "tem_preco": preco_un > 0
        })

    return {
        "cliente": dados_email.get("cliente", ""),
        "cnpj": dados_email.get("cnpj", ""),
        "rc_neg": dados_email.get("rc_neg", ""),
        "proposta": numero_proposta,
        "itens": itens_com_preco,
        "total_itens": len(itens_com_preco),
        "com_preco": sum(1 for i in itens_com_preco if i["tem_preco"]),
        "sem_preco": sum(1 for i in itens_com_preco if not i["tem_preco"])
    }


@app.post("/gerar-csv")
async def gerar_csv(payload: dict):
    """Gera CSV no formato Tiny a partir do payload confirmado"""

    COLUNAS = [
        'ID','Número da proposta','Data','Data proximo contato','ID contato',
        'Nome do contato','Aos cuidados de','Lista de Preço','Tipo de Pessoa','CPF/CNPJ',
        'RG/IE','CEP','Município','UF','Endereço','Endereço Nro','Complemento','Bairro',
        'Fone','Celular','E-mail','Desconto','Frete','Observações','Validade',
        'Prazo de Entrega','Situação','Introdução','ID produto','Descrição','Quantidade',
        'Valor unitário','Descrição complementar','Vendedor','Destinatário',
        'CPF/CNPJ entrega','CEP entrega','Município entrega','UF entrega',
        'Endereço entrega','Endereço Nro entrega','Complemento entrega','Bairro entrega',
        'Fone entrega','Inscrição Estadual entrega'
    ]

    def fmt_preco(v):
        try:
            f = float(v)
            inteiro = int(f)
            dec = round((f - inteiro) * 1000)
            return f"{inteiro:,}".replace(',','.') + f",{dec:03d}"
        except:
            return "0,000"

    hoje = date.today().strftime('%d/%m/%Y')
    rows = []

    for item in payload.get("itens", []):
        r = {c: '' for c in COLUNAS}
        r['Número da proposta'] = payload.get("proposta", "")
        r['Data'] = hoje
        r['Nome do contato'] = payload.get("cliente", "")
        r['Tipo de Pessoa'] = 'J'
        r['CPF/CNPJ'] = payload.get("cnpj", "")
        r['Desconto'] = '0,00'
        r['Frete'] = '0,00'
        r['Observações'] = payload.get("rc_neg", "")
        r['Validade'] = '5'
        r['Situação'] = 'Rascunho'
        r['ID produto'] = '0'
        r['Descrição'] = item.get("descricao_final", "")
        r['Quantidade'] = f"{int(item.get('quantidade', 1))},00"
        r['Valor unitário'] = fmt_preco(item.get("preco_un", 0))
        r['Descrição complementar'] = item.get("unidade", "UN")
        rows.append(r)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=COLUNAS, delimiter=',', quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    writer.writerows(rows)

    csv_bytes = '\ufeff' + output.getvalue()  # utf-8-sig
    nome_arquivo = f"proposta_{payload.get('proposta', 'kist')}.csv"

    return StreamingResponse(
        io.BytesIO(csv_bytes.encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={nome_arquivo}"}
    )


@app.get("/banco/stats")
def banco_stats():
    """Retorna estatísticas do banco de preços"""
    sb = get_supabase()
    try:
        total = sb.table('produtos').select('id', count='exact').execute()
        desatualizados = sb.table('produtos').select('id', count='exact').lt('data_ref', '2026-03-01').gt('preco_un', 0).execute()
        return {
            "total_produtos": total.count,
            "desatualizados_90d": desatualizados.count
        }
    except Exception as e:
        return {"erro": str(e)}
