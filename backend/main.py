import os, csv, io, re
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
import anthropic
from supabase import create_client
from datetime import date
import extract_msg
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

app = FastAPI(title="Kist Cotações API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth ──────────────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID  = os.environ.get("GOOGLE_CLIENT_ID", "822792475898-4l9ctl5jc1urpi2tvbuaut2tpelgevfo.apps.googleusercontent.com")
USUARIOS_PERMITIDOS = set(os.environ.get("USUARIOS_PERMITIDOS", "leonardobarrey@gmail.com,thiagokist@gmail.com,fabiokist@gmail.com").split(","))

security = HTTPBearer()

# Cache de tokens verificados (evita chamada ao Google a cada request)
_token_cache: dict = {}

def _verificar_token_str(token: str) -> str:
    """Verifica token Google e retorna email. Usa cache."""
    if token in _token_cache:
        return _token_cache[token]
    try:
        info = id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=30
        )
        email = info.get("email", "").lower()
        if email not in USUARIOS_PERMITIDOS:
            raise HTTPException(status_code=403, detail=f"Acesso negado para {email}")
        _token_cache[token] = email
        if len(_token_cache) > 200:
            _token_cache.clear()
        return email
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token inválido: {str(e)}")

def verificar_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    return _verificar_token_str(credentials.credentials)

# ── Clientes singleton (criados uma vez, reutilizados) ────────────────────────
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SUPABASE_URL  = os.environ.get("SUPABASE_URL", "https://owpmcoithvzdlhmfkvbe.supabase.co")
SUPABASE_KEY  = os.environ.get("SUPABASE_KEY", "")

_claude_client = None
_supabase_client = None

def get_claude():
    global _claude_client
    if _claude_client is None:
        _claude_client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    return _claude_client

def get_supabase():
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client

# ── Prompt de sistema ─────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Você é o assistente comercial da Kist Soluções em Telecom e Energia.
Sua tarefa é extrair itens de cotação de e-mails e retornar um JSON estruturado.

RETORNE APENAS JSON VÁLIDO. NUNCA use blocos de código markdown. NUNCA use ```json. NUNCA use ```. Retorne SOMENTE o objeto JSON puro, começando com { e terminando com }.

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
      "unidade": "UN",
      "sugerir_pn": false
    }
  ]
}

Regras:
- Extraia TODOS os itens listados no e-mail
- Preserve a descrição original do item
- Se não encontrar CNPJ, deixe null
- Unidade padrão é UN se não especificada
- quantidade deve ser número (não string)
- NUNCA envolva o JSON em blocos de código
- sugerir_pn deve ser true SOMENTE quando AS DUAS condições abaixo forem verdadeiras simultaneamente:
  1. O item É de alto valor agregado (notebooks, desktops, servidores, monitores, switches gerenciáveis, roteadores, UPS, câmeras IP, projetores, impressoras, scanners, TVs, tablets, storage, access points)
  2. O item NÃO tem PN/modelo/part number específico já informado na descrição (ex: se já diz "Dell OptiPlex 7020" ou "HP EliteBook 840 G10" ou qualquer código de produto, sugerir_pn = false)
- Se o item já tem fabricante E modelo específico definidos → sugerir_pn = false (não precisamos sugerir o que já está definido)
- Se o item é commodity independente do valor (cabos, mouses, teclados, pen drives, abraçadeiras, parafusos, lâmpadas genéricas, ferramentas simples, periféricos básicos) → sugerir_pn = false
"""

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "banco": SUPABASE_URL}

@app.get("/ping")
def ping():
    """Keep-alive endpoint — chamado pelo frontend para evitar cold start"""
    return {"pong": True}



def _log(etapa: str, duracao_ms: int, status: str = "ok", proposta: str = "", usuario: str = "", detalhe: str = ""):
    """Registra log no Supabase de forma assíncrona (não bloqueia)"""
    try:
        get_supabase().table("logs_requisicoes").insert({
            "etapa": etapa,
            "duracao_ms": duracao_ms,
            "proposta": proposta or None,
            "usuario": usuario or None,
            "status": status,
            "detalhe": detalhe[:500] if detalhe else None,
        }).execute()
    except Exception:
        pass  # Log nunca deve quebrar a aplicação


def _validar_sugerir_pn(sugerido_pelo_claude: bool, descricao: str) -> bool:
    """Segunda barreira: confirma que sugerir_pn só é true quando realmente necessário"""
    if not sugerido_pelo_claude:
        return False

    import re as _re
    desc_upper = descricao.upper()

    # Se já tem código alfanumérico específico que parece PN (ex: G10, 7020, 840-G9, ThinkPad)
    # Padrões: letra(s)+número(s), número(s)+letra(s), traços entre alfanuméricos
    pn_patterns = [
        r'\b[A-Z]{2,}\s*\d{3,}\b',      # ex: HP840, DELL7020
        r'\b\d{3,}[A-Z]{1,3}\b',          # ex: 840G, 7020SFF
        r'\b[A-Z]+-\d+[A-Z]*\b',          # ex: T14-Gen3, G10
        r'\bGEN\s*\d+\b',                # ex: Gen4, Gen 3
        r'\b[A-Z]{4,}\d{2,}\b',           # ex: ELITEBOOK840
        r'\b\d{4,}\b',                    # número longo = possivelmente PN
    ]
    for pat in pn_patterns:
        if _re.search(pat, desc_upper):
            return False

    # Commodities que nunca precisam de sugestão
    commodities = ['CABO', 'MOUSE', 'TECLADO', 'PEN DRIVE', 'PENDRIVE', 'HEADSET',
                   'WEBCAM', 'HUB USB', 'CARREGADOR', 'ADAPTADOR', 'MOUSE PAD',
                   'SUPORTE', 'ABRAÇADEIRA', 'PARAFUSO', 'LAMPADA', 'LAMPADA']
    for c in commodities:
        if c in desc_upper:
            return False

    return True


@app.post("/extrair")
async def extrair_email(
    texto: str = Form(None),
    arquivo: UploadFile = File(None),
    numero_proposta: str = Form(...),
    token_form: str = Form(None),
    request: Request = None,
    usuario: str = Depends(verificar_token)
):
    """Extrai itens do e-mail (texto ou .msg) e retorna com preços do banco"""

    # 1. Obter texto do e-mail
    conteudo = ""
    if arquivo and arquivo.filename.endswith(".msg"):
        dados = await arquivo.read()
        with open("/tmp/upload.msg", "wb") as f:
            f.write(dados)
        msg = extract_msg.openMsg("/tmp/upload.msg")
        corpo = (msg.body or "").strip()
        conteudo = f"Assunto: {msg.subject}\n\nCorpo:\n{corpo}"

        # Extrair conteúdo de todos os anexos relevantes
        textos_anexos = []
        for att in msg.attachments:
            fname = (att.longFilename or att.shortFilename or "")
            fname_lower = fname.lower()
            if not att.data:
                continue

            # PDF
            if fname_lower.endswith(".pdf"):
                try:
                    import pdfplumber, io as _io
                    with pdfplumber.open(_io.BytesIO(att.data)) as pdf:
                        texto_pdf = ""
                        for page in pdf.pages:
                            t = page.extract_text()
                            if t:
                                texto_pdf += t + "\n"
                    if texto_pdf.strip():
                        textos_anexos.append(f"[ANEXO PDF: {fname}]\n{texto_pdf.strip()}")
                    else:
                        textos_anexos.append(f"[ANEXO PDF: {fname} - sem texto extraível (possível imagem escaneada)]")
                except Exception as e:
                    textos_anexos.append(f"[ANEXO PDF: {fname} - erro: {str(e)}]")

            # Excel (.xlsx / .xls / .xlsm)
            elif fname_lower.endswith((".xlsx", ".xls", ".xlsm")):
                try:
                    import openpyxl, io as _io
                    wb = openpyxl.load_workbook(_io.BytesIO(att.data), read_only=True, data_only=True)
                    linhas_excel = []
                    for sheet_name in wb.sheetnames:
                        ws = wb[sheet_name]
                        sheet_linhas = []
                        for row in ws.iter_rows(values_only=True):
                            # Filtrar linhas completamente vazias
                            vals = [str(c).strip() if c is not None else "" for c in row]
                            if any(v for v in vals):
                                sheet_linhas.append(" | ".join(vals))
                        if sheet_linhas:
                            linhas_excel.append(f"--- Aba: {sheet_name} ---\n" + "\n".join(sheet_linhas[:200]))
                    if linhas_excel:
                        textos_anexos.append(f"[ANEXO EXCEL: {fname}]\n" + "\n\n".join(linhas_excel))
                except Exception as e:
                    # Fallback: tentar com xlrd para .xls antigo
                    try:
                        import xlrd, io as _io
                        wb = xlrd.open_workbook(file_contents=att.data)
                        linhas = []
                        for sheet in wb.sheets():
                            for rx in range(sheet.nrows):
                                row = sheet.row(rx)
                                vals = [str(c.value).strip() for c in row if str(c.value).strip()]
                                if vals:
                                    linhas.append(" | ".join(vals))
                        if linhas:
                            textos_anexos.append(f"[ANEXO EXCEL: {fname}]\n" + "\n".join(linhas[:200]))
                    except Exception as e2:
                        textos_anexos.append(f"[ANEXO EXCEL: {fname} - erro: {str(e2)}]")

            # CSV
            elif fname_lower.endswith(".csv"):
                try:
                    texto_csv = att.data.decode("utf-8-sig", errors="replace")
                    textos_anexos.append(f"[ANEXO CSV: {fname}]\n{texto_csv[:3000]}")
                except Exception as e:
                    textos_anexos.append(f"[ANEXO CSV: {fname} - erro: {str(e)}]")

        if textos_anexos:
            conteudo += "\n\n" + "\n\n".join(textos_anexos)

    elif texto:
        conteudo = texto
    else:
        raise HTTPException(400, "Envie texto ou arquivo .msg")

    # 2. Claude extrai os itens
    import time as _time
    t0 = _time.time()
    claude = get_claude()
    resp = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Número da proposta: {numero_proposta}\n\nE-mail:\n{conteudo[:8000]}"}],
        timeout=30.0
    )
    _log("claude_extracao", int((_time.time()-t0)*1000), proposta=numero_proposta, usuario=usuario)

    import json, re as _re
    try:
        raw = resp.content[0].text.strip()
        # Remove blocos markdown ```json ... ``` ou ``` ... ```
        raw = _re.sub(r'^```(?:json)?\s*', '', raw)
        raw = _re.sub(r'\s*```$', '', raw.strip())
        dados_email = json.loads(raw)
    except Exception as e:
        raise HTTPException(500, f"Erro ao parsear resposta do Claude: {str(e)}\nResposta: {resp.content[0].text[:500]}")

    # 3. Para cada item, buscar preço no Supabase
    sb = get_supabase()
    itens_com_preco = []

    itens_raw = dados_email.get("itens", [])

    # ── Busca em lote no banco (1 query ao invés de N) ────────────────────────
    import time as _time
    t_banco = _time.time()
    # Extrai todas as palavras-chave dos itens e busca de uma vez
    banco_cache = {}  # desc_norm -> row
    try:
        # Buscar os 200 produtos mais recentes relevantes numa única query
        # Estratégia: concatenar todas as descrições e fazer full text search
        todas_palavras = set()
        for item in itens_raw:
            desc = item.get("descricao", "")
            for p in desc.upper().split():
                if len(p) > 4:
                    todas_palavras.add(p)

        if todas_palavras:
            # Uma única query trazendo candidatos para todos os itens
            res_batch = sb.table('produtos')\
                .select('descricao,preco_un,proposta_tiny,data_ref')\
                .order('data_ref', desc=True)\
                .limit(500)\
                .execute()

            # Indexar por palavras para matching local (sem roundtrip)
            candidatos = res_batch.data or []
    except Exception:
        candidatos = []
    _log("busca_banco", int((_time.time()-t_banco)*1000), proposta=numero_proposta, usuario=usuario, detalhe=f"{len(candidatos)} candidatos")

    def match_local(desc_pedido, candidatos):
        """Faz matching local sem chamada ao banco"""
        palavras = [p for p in desc_pedido.upper().split() if len(p) > 4][:5]
        if not palavras:
            return None
        melhor = None
        melhor_score = 0
        for row in candidatos:
            desc_banco = (row.get('descricao') or '').upper()
            score = sum(1 for p in palavras if p in desc_banco)
            if score > melhor_score and score >= min(2, len(palavras)):
                melhor_score = score
                melhor = row
        return melhor

    for item in itens_raw:
        desc = item.get("descricao", "")
        preco_un = 0.0
        desc_banco = desc
        obs_item = "SEM PREÇO"

        match = match_local(desc, candidatos)
        if match:
            preco_un = float(match.get('preco_un') or 0)
            desc_banco = match.get('descricao', desc)
            proposta_ref = match.get('proposta_tiny', '')
            obs_item = f"ref proposta {proposta_ref}" if proposta_ref else ""

        itens_com_preco.append({
            "descricao_original": desc,
            "descricao_final": desc_banco,
            "quantidade": item.get("quantidade", 1),
            "unidade": item.get("unidade", "UN"),
            "preco_un": preco_un,
            "obs": obs_item,
            "tem_preco": preco_un > 0,
            "sugerir_pn": _validar_sugerir_pn(item.get("sugerir_pn", False), desc)
        })

    total_ms = int((_time.time() - t0) * 1000)
    com_preco = sum(1 for i in itens_com_preco if i["tem_preco"])
    sem_preco = len(itens_com_preco) - com_preco
    _log("total_extracao", total_ms, proposta=numero_proposta, usuario=usuario,
         detalhe=f"{len(itens_com_preco)} itens | {com_preco} com preco | {sem_preco} zerados")

    return {
        "cliente": dados_email.get("cliente", ""),
        "cnpj": dados_email.get("cnpj", ""),
        "rc_neg": dados_email.get("rc_neg", ""),
        "proposta": numero_proposta,
        "itens": itens_com_preco,
        "total_itens": len(itens_com_preco),
        "com_preco": com_preco,
        "sem_preco": sem_preco
    }



@app.post("/upsert-precos")
async def upsert_precos(payload: dict, usuario: str = Depends(verificar_token)):
    """Atualiza/insere preços no banco após confirmação do usuário"""
    sb = get_supabase()
    proposta = payload.get("proposta", "")
    cliente  = payload.get("cliente", "")
    itens    = payload.get("itens", [])
    hoje     = date.today().isoformat()

    atualizados, inseridos, ignorados = 0, 0, 0

    for item in itens:
        preco = item.get("preco_un", 0)
        desc  = item.get("descricao_final", "").strip()
        if not desc or not preco or float(preco) <= 0:
            ignorados += 1
            continue

        try:
            # Verificar se já existe pela descrição (ILIKE)
            res = sb.table("produtos").select("id,preco_un,data_ref")                .ilike("descricao", desc).limit(1).execute()

            if res.data:
                # Atualizar preço existente
                sb.table("produtos").update({
                    "preco_un":     float(preco),
                    "data_ref":     hoje,
                    "proposta_tiny": proposta,
                    "cliente":      cliente,
                }).eq("id", res.data[0]["id"]).execute()
                atualizados += 1
            else:
                # Inserir novo
                sb.table("produtos").insert({
                    "descricao":    desc,
                    "variante":     item.get("unidade", "UN"),
                    "un":           item.get("unidade", "UN"),
                    "preco_un":     float(preco),
                    "data_ref":     hoje,
                    "proposta_tiny": proposta,
                    "cliente":      cliente,
                    "obs":          "inserido automaticamente via app",
                }).execute()
                inseridos += 1
        except Exception as e:
            ignorados += 1

    return {
        "atualizados": atualizados,
        "inseridos":   inseridos,
        "ignorados":   ignorados,
        "total":       len(itens)
    }


@app.post("/gerar-csv")
async def gerar_csv(payload: dict, usuario: str = Depends(verificar_token)):
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



@app.post("/sugerir-pn")
async def sugerir_pn(payload: dict, usuario: str = Depends(verificar_token)):
    """Sugere PN/modelos específicos para um item de alto valor agregado"""
    descricao = payload.get("descricao", "")
    fabricantes = payload.get("fabricantes", "")  # ex: "Dell, Lenovo ou HP"

    if not descricao:
        raise HTTPException(400, "Descrição obrigatória")

    # Buscar histórico de itens similares no banco para contexto
    sb = get_supabase()
    historico = []
    try:
        palavras = [p for p in descricao.upper().split() if len(p) > 4][:3]
        query = sb.table("produtos").select("descricao,preco_un,proposta_tiny,cliente")
        for p in palavras:
            query = query.ilike("descricao", f"%{p}%")
        res = query.order("data_ref", desc=True).limit(5).execute()
        historico = res.data or []
    except Exception:
        pass

    historico_txt = ""
    if historico:
        historico_txt = "\n\nHistórico de itens similares já vendidos pela Kist:\n"
        for h in historico:
            preco = h.get("preco_un", 0)
            historico_txt += f"- {h.get('descricao','')} | R$ {preco:.2f} | proposta {h.get('proposta_tiny','')} | {h.get('cliente','')}\n"

    prompt = f"""Você é especialista em TI e infraestrutura. Um cliente solicitou o seguinte item:

ESPECIFICAÇÃO DO CLIENTE:
{descricao}

{f"Fabricantes aceitos pelo cliente: {fabricantes}" if fabricantes else ""}
{historico_txt}

Sugira exatamente 3 opções de PN/modelos específicos que atendam a essa especificação.
Para cada opção informe:
- Fabricante e modelo/PN exato
- Principais specs que atendem ao pedido
- Preço de mercado estimado em reais (valor aproximado)
- Se está disponível nos fabricantes mencionados pelo cliente

RETORNE APENAS JSON VÁLIDO, sem markdown, sem blocos de código:
{{
  "sugestoes": [
    {{
      "fabricante": "Dell",
      "modelo": "OptiPlex 7020 SFF",
      "pn": "7020-SFF-I5-16-512",
      "specs": "Core i5-14ª gen, 16GB DDR5, 512GB NVMe, Win11 Pro",
      "preco_estimado": 4500.00,
      "atende_fabricante": true
    }}
  ]
}}"""

    claude = get_claude()
    resp = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
        timeout=20.0
    )

    import json, re as _re
    raw = resp.content[0].text.strip()
    raw = _re.sub(r'^```(?:json)?\s*', '', raw)
    raw = _re.sub(r'\s*```$', '', raw.strip())

    try:
        data = json.loads(raw)
        return data
    except Exception as e:
        raise HTTPException(500, f"Erro ao parsear sugestões: {str(e)} | Resposta: {raw[:300]}")


@app.get("/proxima-proposta")
def proxima_proposta():
    """Retorna o próximo número de proposta baseado no banco"""
    sb = get_supabase()
    try:
        res = sb.table('produtos')\
            .select('proposta_tiny')\
            .not_.is_('proposta_tiny', 'null')\
            .order('proposta_tiny', desc=True)\
            .limit(50)\
            .execute()
        numeros = []
        for r in res.data:
            try:
                n = int(r['proposta_tiny'])
                numeros.append(n)
            except:
                pass
        if numeros:
            return {"proximo": str(max(numeros) + 1)}
    except Exception as e:
        return {"erro": str(e)}
    return {"proximo": ""}
