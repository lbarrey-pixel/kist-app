import os, csv, io, re, time, base64 as _b64
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Auth ──────────────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "822792475898-4l9ctl5jc1urpi2tvbuaut2tpelgevfo.apps.googleusercontent.com")
USUARIOS_PERMITIDOS = set(os.environ.get("USUARIOS_PERMITIDOS", "leonardobarrey@gmail.com,thiagokist@gmail.com,fabiokist@gmail.com").split(","))
security = HTTPBearer()
_token_cache: dict = {}

def _verificar_token_str(token: str) -> str:
    if token in _token_cache:
        return _token_cache[token]
    try:
        info = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=30)
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

# ── Clientes singleton ────────────────────────────────────────────────────────
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

# ── Prompts ───────────────────────────────────────────────────────────────────
SYSTEM_EXTRACAO = """Você é o assistente comercial da Kist Soluções em Telecom e Energia.
Extraia itens de cotação de e-mails, textos ou imagens/prints e retorne JSON.

RETORNE APENAS JSON VÁLIDO. Sem markdown, sem ```json, sem ```. Só o objeto JSON puro.

Formato:
{
  "cliente": "NOME DO CLIENTE",
  "cnpj": "XX.XXX.XXX/XXXX-XX ou null",
  "rc_neg": "RC XXXXX ou NEG-XXXXXXX ou null",
  "proposta": "número informado ou null",
  "itens": [
    {
      "descricao": "descrição comercial curta — máx 120 chars",
      "descricao_original": "texto exato do cliente, preservado integralmente",
      "specs_complementares": "specs técnicas detalhadas se descrição original > 150 chars ou em formato de tabela, senão null",
      "quantidade": 1,
      "unidade": "UN",
      "sugerir_pn": false
    }
  ]
}

REGRAS DE DESCRIÇÃO:
- "descricao": sempre curta e comercial. Formato: [Categoria] [Marca/Modelo] [Spec principal]
  Ex: "Smartphone Samsung Galaxy A55 5G 128GB", "Monitor 24pol Full HD IPS", "Cabo FTP CAT5E 305m"
  Se vier como tabela de specs (RAM: 4GB | Tela: 6.5" | ...), monte a descrição comercial a partir delas
- "descricao_original": preservar EXATAMENTE como veio, sem alterar nada
- "specs_complementares": preencher quando descrição original for longa ou em tabela. Null caso contrário
- "sugerir_pn": true SOMENTE se (1) item de alto valor agregado (notebook, desktop, servidor, monitor,
  switch gerenciável, roteador, UPS, câmera IP, projetor, TV, tablet, storage) E (2) sem PN/modelo
  específico já definido. Commodities e itens com modelo específico → sempre false

REGRAS GERAIS:
- Extraia TODOS os itens, inclusive de imagens/prints
- Múltiplos prints: consolide sem duplicatas
- quantidade = número, nunca string
"""

SYSTEM_MATCHING = """Você é especialista em materiais elétricos, telecom, infraestrutura e TI.
Sua tarefa é identificar, para cada item solicitado, qual produto do banco de preços é o mesmo item.

RETORNE APENAS JSON VÁLIDO. Sem markdown. Só o objeto JSON puro.

Formato:
{
  "matches": [
    {
      "indice": 0,
      "banco_descricao": "descrição exata do item do banco que corresponde, ou null se não encontrado",
      "banco_preco": 0.00,
      "banco_proposta": "número da proposta de referência ou null",
      "confianca": "alta/media/baixa/nenhuma",
      "motivo": "breve explicação da decisão"
    }
  ]
}

REGRAS DE MATCHING — seja rigoroso:
- "alta": mesmo produto, mesma especificação, mesmo fabricante (quando mencionado)
- "media": mesmo produto e spec, fabricante não mencionado no pedido (qualquer fabricante atende)
- "baixa": produto similar mas com dúvida — retornar mas sinalizar
- "nenhuma": produto diferente ou fabricante diferente do solicitado → banco_descricao = null, banco_preco = 0

ATENÇÃO especial:
- Fabricantes DIFERENTES = nenhuma. Ex: pedido "Wetzel" + banco "Tramontina" → nenhuma
- Categoria diferente = nenhuma. Ex: pedido "canaleta" + banco "tampa para canaleta" → nenhuma  
- Tamanho/bitola/dimensão diferente = nenhuma. Ex: pedido "6mm²" + banco "4mm²" → nenhuma
- Cor nunca diferencia preço em cabos elétricos. Ex: "cabo 6mm amarelo" = "cabo 6mm azul" → alta
- Quando pedido não menciona fabricante e banco tem fabricante → pode ser media se spec bater
- Prefira retornar nenhuma a retornar match errado — falso negativo é melhor que falso positivo
"""

# ── Helpers ───────────────────────────────────────────────────────────────────
def _validar_sugerir_pn(sugerido: bool, descricao: str) -> bool:
    if not sugerido:
        return False
    d = descricao.upper()
    pn_patterns = [r'\b[A-Z]{2,}\s*\d{3,}\b', r'\b\d{3,}[A-Z]{1,3}\b', r'\b[A-Z]+-\d+[A-Z]*\b',
                   r'\bGEN\s*\d+\b', r'\b[A-Z]{4,}\d{2,}\b', r'\b\d{4,}\b']
    for pat in pn_patterns:
        if re.search(pat, d):
            return False
    commodities = ['CABO', 'MOUSE', 'TECLADO', 'PEN DRIVE', 'PENDRIVE', 'HEADSET',
                   'WEBCAM', 'HUB USB', 'CARREGADOR', 'ADAPTADOR', 'SUPORTE',
                   'ABRAÇADEIRA', 'PARAFUSO', 'LAMPADA']
    for c in commodities:
        if c in d:
            return False
    return True

def _prefiltro_candidatos(descricao: str, todos_candidatos: list) -> list:
    """Filtra candidatos por palavras relevantes — máx 40 por item para não sobrecarregar o Claude"""
    palavras = [p for p in descricao.upper().split() if len(p) > 3][:6]
    if not palavras:
        return todos_candidatos[:40]
    scored = []
    for row in todos_candidatos:
        desc_banco = (row.get('descricao') or '').upper()
        score = sum(1 for p in palavras if p in desc_banco)
        if score > 0:
            scored.append((score, row))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[:40]]

# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/ping")
def ping():
    return {"pong": True}

@app.get("/proxima-proposta")
def proxima_proposta():
    sb = get_supabase()
    try:
        res = sb.table('produtos').select('proposta_tiny')\
            .not_.is_('proposta_tiny', 'null')\
            .order('proposta_tiny', desc=True).limit(50).execute()
        numeros = []
        for r in res.data:
            try:
                numeros.append(int(r['proposta_tiny']))
            except Exception:
                pass
        if numeros:
            return {"proximo": str(max(numeros) + 1)}
    except Exception:
        pass
    return {"proximo": ""}

@app.get("/banco/stats")
def banco_stats():
    sb = get_supabase()
    try:
        total = sb.table('produtos').select('id', count='exact').execute()
        from datetime import datetime, timedelta
        data_limite = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
        desatual = sb.table('produtos').select('id', count='exact')\
            .lt('data_ref', data_limite).gt('preco_un', 0).execute()
        return {"total_produtos": total.count, "desatualizados_90d": desatual.count}
    except Exception as e:
        return {"erro": str(e)}

@app.post("/extrair")
async def extrair_email(
    texto: str = Form(None),
    arquivo: UploadFile = File(None),
    imagens: list[UploadFile] = File(default=[]),
    numero_proposta: str = Form(...),
    token_form: str = Form(None),
    request: Request = None,
    usuario: str = Depends(verificar_token)
):
    """Extrai itens do e-mail/prints e faz matching inteligente com o banco"""

    # 1. Obter conteúdo textual
    conteudo = ""
    if arquivo and arquivo.filename.endswith(".msg"):
        dados = await arquivo.read()
        with open("/tmp/upload.msg", "wb") as f:
            f.write(dados)
        msg = extract_msg.openMsg("/tmp/upload.msg")
        corpo = (msg.body or "").strip()
        conteudo = f"Assunto: {msg.subject}\n\nCorpo:\n{corpo}"

        # Extrair anexos
        textos_anexos = []
        for att in msg.attachments:
            fname = att.longFilename or att.shortFilename or ""
            fname_lower = fname.lower()
            if not att.data:
                continue
            if fname_lower.endswith(".pdf"):
                try:
                    import pdfplumber, io as _io
                    with pdfplumber.open(_io.BytesIO(att.data)) as pdf:
                        texto_pdf = "".join((p.extract_text() or "") + "\n" for p in pdf.pages)
                    if texto_pdf.strip():
                        textos_anexos.append(f"[ANEXO PDF: {fname}]\n{texto_pdf.strip()}")
                except Exception as e:
                    textos_anexos.append(f"[ANEXO PDF: {fname} - erro: {str(e)}]")
            elif fname_lower.endswith((".xlsx", ".xls", ".xlsm")):
                try:
                    import openpyxl, io as _io
                    wb = openpyxl.load_workbook(_io.BytesIO(att.data), read_only=True, data_only=True)
                    for sname in wb.sheetnames:
                        ws = wb[sname]
                        linhas = []
                        for row in ws.iter_rows(values_only=True):
                            vals = [str(c).strip() if c is not None else "" for c in row]
                            if any(vals):
                                linhas.append(" | ".join(vals))
                        if linhas:
                            textos_anexos.append(f"[ANEXO EXCEL: {fname}/{sname}]\n" + "\n".join(linhas[:200]))
                except Exception:
                    pass
            elif fname_lower.endswith(".csv"):
                try:
                    textos_anexos.append(f"[ANEXO CSV: {fname}]\n{att.data.decode('utf-8-sig', errors='replace')[:3000]}")
                except Exception:
                    pass
        if textos_anexos:
            conteudo += "\n\n" + "\n\n".join(textos_anexos)
    elif texto:
        conteudo = texto

    # 2. Montar mensagem para o Claude (texto + imagens)
    conteudo_msg = []
    if conteudo.strip():
        conteudo_msg.append({"type": "text", "text": f"Número da proposta: {numero_proposta}\n\nConteúdo:\n{conteudo[:8000]}"})

    imgs_validas = [img for img in (imagens or []) if img and img.filename]
    if imgs_validas:
        conteudo_msg.append({"type": "text", "text": f"{'Além do conteúdo acima, analise também os' if conteudo.strip() else 'Extrai os itens dos'} {len(imgs_validas)} print(s):"})
        for img in imgs_validas[:6]:
            img_bytes = await img.read()
            img_b64 = _b64.standard_b64encode(img_bytes).decode()
            fname_lower = (img.filename or "").lower()
            media_type = "image/png" if fname_lower.endswith(".png") else \
                         "image/jpeg" if fname_lower.endswith((".jpg", ".jpeg")) else \
                         "image/webp" if fname_lower.endswith(".webp") else "image/png"
            conteudo_msg.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": img_b64}})

    if not conteudo_msg:
        raise HTTPException(400, "Envie texto, arquivo .msg, imagem ou print")

    # 3. Extração dos itens via Claude
    t0 = time.time()
    claude = get_claude()
    resp_extracao = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4000,
        system=SYSTEM_EXTRACAO,
        messages=[{"role": "user", "content": conteudo_msg}],
        timeout=45.0
    )
    t_extracao = time.time() - t0

    import json
    raw = resp_extracao.content[0].text.strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw.strip())
    try:
        dados_email = json.loads(raw)
    except Exception as e:
        raise HTTPException(500, f"Erro ao parsear extração: {str(e)} | Resposta: {raw[:300]}")

    itens_raw = dados_email.get("itens", [])
    if not itens_raw:
        return {
            "cliente": dados_email.get("cliente", ""),
            "cnpj": dados_email.get("cnpj"),
            "rc_neg": dados_email.get("rc_neg"),
            "proposta": numero_proposta,
            "itens": [],
            "total_itens": 0, "com_preco": 0, "sem_preco": 0
        }

    # 4. Buscar candidatos do banco (1 query)
    sb = get_supabase()
    t_banco = time.time()
    try:
        res_batch = sb.table('produtos')\
            .select('descricao,preco_un,proposta_tiny,data_ref')\
            .order('data_ref', desc=True).limit(500).execute()
        todos_candidatos = res_batch.data or []
    except Exception:
        todos_candidatos = []

    # 5. Matching inteligente via Claude — para cada item, pré-filtrar candidatos e pedir match
    t_match = time.time()

    # Montar prompt de matching com todos os itens de uma vez
    itens_txt = ""
    for i, item in enumerate(itens_raw):
        itens_txt += f"\nItem {i}: {item.get('descricao', '')}"

    candidatos_por_item = []
    candidatos_txt = ""
    for i, item in enumerate(itens_raw):
        candidatos = _prefiltro_candidatos(item.get('descricao', ''), todos_candidatos)
        candidatos_por_item.append(candidatos)
        if candidatos:
            candidatos_txt += f"\n\n--- Candidatos para Item {i} ({item.get('descricao','')[:60]}) ---\n"
            for j, c in enumerate(candidatos[:20]):
                candidatos_txt += f"  [{j}] {c.get('descricao','')} | R$ {c.get('preco_un',0)} | ref {c.get('proposta_tiny','')}\n"

    prompt_matching = f"""Itens solicitados:{itens_txt}

Candidatos do banco de preços:{candidatos_txt}

Para cada item, identifique qual candidato é o mesmo produto ou retorne null se nenhum for adequado.
Lembre: fabricante diferente = null. Categoria diferente = null. Seja rigoroso."""

    resp_match = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=3000,
        system=SYSTEM_MATCHING,
        messages=[{"role": "user", "content": prompt_matching}],
        temperature=0.0,  # matching analítico — máxima consistência
        timeout=30.0
    )

    raw_match = resp_match.content[0].text.strip()
    raw_match = re.sub(r'^```(?:json)?\s*', '', raw_match)
    raw_match = re.sub(r'\s*```$', '', raw_match.strip())
    try:
        resultado_match = json.loads(raw_match)
        matches = {m["indice"]: m for m in resultado_match.get("matches", [])}
    except Exception:
        matches = {}

    # 6. Montar resposta final
    itens_com_preco = []
    for i, item in enumerate(itens_raw):
        desc = item.get("descricao", "")
        desc_original = item.get("descricao_original", desc) or desc
        specs_comp = item.get("specs_complementares") or ""

        match = matches.get(i, {})
        confianca = match.get("confianca", "nenhuma")
        preco_un = 0.0
        desc_final = desc
        obs_item = "SEM PREÇO"

        if confianca in ("alta", "media") and match.get("banco_descricao"):
            # Match confiável: usa descrição do banco (mais completa/canônica)
            desc_final = match["banco_descricao"]
            preco_un = float(match.get("banco_preco") or 0)
            proposta_ref = match.get("banco_proposta", "")
            obs_item = f"{'✓' if confianca == 'alta' else '~'} ref {proposta_ref}" if proposta_ref else ""
        elif confianca == "baixa" and match.get("banco_descricao"):
            # Match incerto: PRESERVA descrição original do cliente
            # mas guarda o candidato do banco para o operador conferir
            desc_final = desc  # descrição original do cliente, sem alterar
            preco_un = float(match.get("banco_preco") or 0)
            obs_item = f"⚠ CONFIRA — candidato no banco: {match['banco_descricao']} | motivo: {match.get('motivo','')}"

        itens_com_preco.append({
            "descricao_original": desc_original,
            "descricao_final": desc_final,
            "specs_complementares": specs_comp,
            "quantidade": item.get("quantidade", 1),
            "unidade": item.get("unidade", "UN"),
            "preco_un": preco_un,
            "obs": obs_item,
            "confianca_match": confianca,
            "banco_candidato": match.get("banco_descricao") if confianca == "baixa" else None,
            "banco_candidato_preco": float(match.get("banco_preco") or 0) if confianca == "baixa" else None,
            "motivo_incerto": match.get("motivo", "") if confianca == "baixa" else None,
            "tem_preco": preco_un > 0,
            "sugerir_pn": _validar_sugerir_pn(item.get("sugerir_pn", False), desc)
        })

    com_preco = sum(1 for i in itens_com_preco if i["tem_preco"])
    return {
        "cliente": dados_email.get("cliente", ""),
        "cnpj": dados_email.get("cnpj"),
        "rc_neg": dados_email.get("rc_neg"),
        "proposta": numero_proposta,
        "itens": itens_com_preco,
        "total_itens": len(itens_com_preco),
        "com_preco": com_preco,
        "sem_preco": len(itens_com_preco) - com_preco
    }


@app.post("/upsert-precos")
async def upsert_precos(payload: dict, usuario: str = Depends(verificar_token)):
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
            res = sb.table("produtos").select("id,preco_un")\
                .ilike("descricao", desc).limit(1).execute()
            if res.data:
                sb.table("produtos").update({
                    "preco_un": float(preco), "data_ref": hoje,
                    "proposta_tiny": proposta, "cliente": cliente,
                }).eq("id", res.data[0]["id"]).execute()
                atualizados += 1
            else:
                sb.table("produtos").insert({
                    "descricao": desc, "un": item.get("unidade", "UN"),
                    "preco_un": float(preco), "data_ref": hoje,
                    "proposta_tiny": proposta, "cliente": cliente,
                    "obs": "inserido automaticamente via app",
                }).execute()
                inseridos += 1
        except Exception:
            ignorados += 1

    return {"atualizados": atualizados, "inseridos": inseridos, "ignorados": ignorados}


@app.post("/gerar-csv")
async def gerar_csv(payload: dict, usuario: str = Depends(verificar_token)):
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
            return f"{inteiro:,}".replace(',', '.') + f",{dec:03d}"
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
        r['CPF/CNPJ'] = payload.get("cnpj", "") or ""
        r['Desconto'] = '0,00'
        r['Frete'] = '0,00'
        r['Observações'] = payload.get("rc_neg", "") or ""
        r['Validade'] = '5'
        r['Situação'] = 'Rascunho'
        r['ID produto'] = '0'
        r['Descrição'] = item.get("descricao_final", "")
        r['Quantidade'] = f"{int(item.get('quantidade', 1))},00"
        r['Valor unitário'] = fmt_preco(item.get("preco_un", 0))
        # Specs complementares vão para Descrição complementar se existirem
        specs = item.get("specs_complementares", "") or ""
        unidade = item.get("unidade", "UN") or "UN"
        r['Descrição complementar'] = f"{unidade} | {specs[:200]}" if specs else unidade
        rows.append(r)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=COLUNAS, delimiter=',', quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    writer.writerows(rows)
    csv_bytes = '\ufeff' + output.getvalue()
    nome = f"proposta_{payload.get('proposta', 'kist')}.csv"
    return StreamingResponse(io.BytesIO(csv_bytes.encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={nome}"})


@app.post("/sugerir-pn")
async def sugerir_pn(payload: dict, usuario: str = Depends(verificar_token)):
    descricao = payload.get("descricao", "")
    if not descricao:
        raise HTTPException(400, "Descrição obrigatória")

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
        historico_txt = "\n\nHistórico similar no banco:\n"
        for h in historico:
            historico_txt += f"- {h.get('descricao','')} | R$ {h.get('preco_un',0):.2f}\n"

    prompt = f"""Especialista em TI e infraestrutura. Cliente solicitou:

{descricao}
{historico_txt}

Sugira 3 opções de PN/modelos específicos. JSON puro sem markdown:
{{"sugestoes": [{{"fabricante": "Dell", "modelo": "OptiPlex 7020 SFF", "pn": "7020-SFF", "specs": "Core i5-14ª, 16GB DDR5, 512GB NVMe", "preco_estimado": 4500.00, "atende_fabricante": true}}]}}"""

    claude = get_claude()
    resp = claude.messages.create(
        model="claude-haiku-4-5-20251001", max_tokens=1500,
        messages=[{"role": "user", "content": prompt}], timeout=20.0
    )
    raw = resp.content[0].text.strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw.strip())
    try:
        return json.loads(raw)
    except Exception as e:
        raise HTTPException(500, f"Erro ao parsear sugestões: {str(e)} | {raw[:200]}")


# ── PROPOSTAS ─────────────────────────────────────────────────────────────────

@app.post("/salvar-proposta")
async def salvar_proposta(payload: dict, usuario: str = Depends(verificar_token)):
    """Salva proposta e itens no banco após confirmação"""
    sb = get_supabase()

    # Calcular valor total estimado
    itens = payload.get("itens", [])
    valor_total = sum(
        float(i.get("preco_un") or 0) * float(i.get("quantidade") or 1)
        for i in itens
    )

    # Inserir proposta
    res = sb.table("propostas").insert({
        "numero_proposta": payload.get("proposta"),
        "cliente":         payload.get("cliente"),
        "cnpj":            payload.get("cnpj"),
        "rc_neg":          payload.get("rc_neg"),
        "usuario_email":   usuario,
        "usuario_nome":    payload.get("usuario_nome", ""),
        "total_itens":     len(itens),
        "com_preco":       payload.get("com_preco", 0),
        "sem_preco":       payload.get("sem_preco", 0),
        "valor_total_estimado": valor_total,
    }).execute()

    proposta_id = res.data[0]["id"]

    # Inserir itens
    if itens:
        rows = []
        for i in itens:
            rows.append({
                "proposta_id":       proposta_id,
                "descricao_original": i.get("descricao_original", ""),
                "descricao_final":   i.get("descricao_final", ""),
                "quantidade":        float(i.get("quantidade") or 1),
                "unidade":           i.get("unidade", "UN"),
                "preco_venda":       float(i.get("preco_un") or 0),
                "confianca_match":   i.get("confianca_match", ""),
                "specs_complementares": i.get("specs_complementares", ""),
                "fornecedor":        i.get("fornecedor", ""),
                "link_fornecedor":   i.get("link_fornecedor", ""),
                "sku_fornecedor":    i.get("sku_fornecedor", ""),
                "obs_interna":       i.get("obs_interna", ""),
            })
        sb.table("itens_proposta").insert(rows).execute()

    return {"proposta_id": proposta_id, "total_itens": len(itens)}


@app.get("/propostas")
async def listar_propostas(
    numero: str = None,
    cnpj: str = None,
    usuario_email: str = None,
    data_inicio: str = None,
    data_fim: str = None,
    todos: bool = False,
    limit: int = 50,
    usuario: str = Depends(verificar_token)
):
    """Lista propostas com filtros"""
    sb = get_supabase()
    q = sb.table("propostas").select("*").order("data_geracao", desc=True).limit(limit)

    # Por padrão mostra só do usuário autenticado, salvo se todos=True
    if not todos:
        q = q.eq("usuario_email", usuario)
    if numero:
        q = q.ilike("numero_proposta", f"%{numero}%")
    if cnpj:
        q = q.ilike("cnpj", f"%{cnpj}%")
    if usuario_email:
        q = q.ilike("usuario_email", f"%{usuario_email}%")
    if data_inicio:
        q = q.gte("data_geracao", data_inicio)
    if data_fim:
        q = q.lte("data_geracao", data_fim + "T23:59:59")

    res = q.execute()
    return res.data


@app.get("/propostas/{proposta_id}/itens")
async def itens_proposta(proposta_id: int, usuario: str = Depends(verificar_token)):
    """Retorna itens de uma proposta"""
    sb = get_supabase()
    res = sb.table("itens_proposta").select("*").eq("proposta_id", proposta_id).execute()
    return res.data


@app.put("/itens-proposta/{item_id}/origem")
async def atualizar_origem_item(
    item_id: int, payload: dict, usuario: str = Depends(verificar_token)
):
    """Atualiza campos internos de origem de um item"""
    sb = get_supabase()
    sb.table("itens_proposta").update({
        "fornecedor":      payload.get("fornecedor", ""),
        "link_fornecedor": payload.get("link_fornecedor", ""),
        "sku_fornecedor":  payload.get("sku_fornecedor", ""),
        "obs_interna":     payload.get("obs_interna", ""),
    }).eq("id", item_id).execute()
    return {"ok": True}


# ── ORDENS DE COMPRA ──────────────────────────────────────────────────────────

@app.post("/ordens-compra")
async def criar_oc(payload: dict, usuario: str = Depends(verificar_token)):
    """Cria uma nova ordem de compra"""
    sb = get_supabase()
    res = sb.table("ordens_compra").insert({
        "titulo":        payload.get("titulo", ""),
        "numero_po":     (payload.get("numero_po") or None),   # PO do cliente (pode ser nula/pendente)
        "usuario_email": usuario,
        "usuario_nome":  payload.get("usuario_nome", ""),
        "status":        "rascunho",
        "obs":           payload.get("obs", ""),
    }).execute()
    oc_id = res.data[0]["id"]

    # Adicionar itens se fornecidos
    itens = payload.get("itens", [])
    if itens:
        rows = []
        for i in itens:
            rows.append({
                "oc_id":               oc_id,
                "item_proposta_id":    i.get("item_proposta_id"),
                "descricao":           i.get("descricao", ""),
                "quantidade_proposta": float(i.get("quantidade_proposta") or 1),
                "quantidade_comprar":  float(i.get("quantidade_comprar") or i.get("quantidade_proposta") or 1),
                "unidade":             i.get("unidade", "UN"),
                "preco_venda":         float(i.get("preco_venda") or 0),
                # origem do preço herdada da proposta (aceita as duas nomenclaturas):
                "nome_fornecedor":     i.get("nome_fornecedor") or i.get("fornecedor", ""),
                "link_fornecedor":     i.get("link_fornecedor", ""),
                "sku_fornecedor":      i.get("sku_fornecedor", ""),
            })
        sb.table("oc_itens").insert(rows).execute()

    return {"oc_id": oc_id}


@app.get("/ordens-compra")
async def listar_ocs(
    status: str = None,
    todos: bool = False,
    limit: int = 100,
    usuario: str = Depends(verificar_token)
):
    """Lista ordens de compra"""
    sb = get_supabase()
    q = sb.table("ordens_compra").select("*").order("criado_em", desc=True).limit(limit)
    if not todos:
        q = q.eq("usuario_email", usuario)
    if status:
        q = q.eq("status", status)
    # Excluir arquivadas por padrão
    q = q.neq("status", "arquivada")
    res = q.execute()
    ocs = res.data or []

    # Totais por OC (venda e custo) para os cards do quadro
    if ocs:
        ids = [o["id"] for o in ocs]
        itens = sb.table("oc_itens").select(
            "oc_id,preco_venda,preco_custo,quantidade_comprar,quantidade_proposta"
        ).in_("oc_id", ids).execute().data or []
        tot = {}
        for r in itens:
            qd = r.get("quantidade_comprar")
            if qd is None:
                qd = r.get("quantidade_proposta") or 0
            t = tot.setdefault(r["oc_id"], {"valor_venda": 0.0, "valor_custo": 0.0})
            t["valor_venda"] += float(r.get("preco_venda") or 0) * float(qd or 0)
            t["valor_custo"] += float(r.get("preco_custo") or 0) * float(qd or 0)
        for o in ocs:
            o.update(tot.get(o["id"], {"valor_venda": 0.0, "valor_custo": 0.0}))
            o["valor_lucro"] = o["valor_venda"] - o["valor_custo"]   # lucro bruto (R$)
    return ocs


@app.get("/ordens-compra/{oc_id}/itens")
async def itens_oc(oc_id: int, usuario: str = Depends(verificar_token)):
    """Retorna itens de uma OC"""
    sb = get_supabase()
    res = sb.table("oc_itens").select("*").eq("oc_id", oc_id).execute()
    return res.data


@app.put("/ordens-compra/{oc_id}")
async def atualizar_oc(
    oc_id: int, payload: dict, usuario: str = Depends(verificar_token)
):
    """Atualiza status e campos de uma OC"""
    sb = get_supabase()
    campos = {}
    for f in ["titulo","numero_po","status","frete_estimado","frete_real","obs"]:
        if f in payload:
            campos[f] = payload[f]
    sb.table("ordens_compra").update(campos).eq("id", oc_id).execute()
    return {"ok": True}


@app.delete("/ordens-compra/{oc_id}")
async def excluir_oc(oc_id: int, usuario: str = Depends(verificar_token)):
    """Exclui uma OC e todos os seus itens (limpeza de testes / OC errada).
    Apaga os oc_itens primeiro caso a FK não seja ON DELETE CASCADE."""
    sb = get_supabase()
    sb.table("oc_itens").delete().eq("oc_id", oc_id).execute()
    sb.table("ordens_compra").delete().eq("id", oc_id).execute()
    return {"ok": True, "excluida": oc_id}


@app.put("/oc-itens/{item_id}")
async def atualizar_item_oc(
    item_id: int, payload: dict, usuario: str = Depends(verificar_token)
):
    """Atualiza campos de um item de OC (preço custo, pagamento, rastreio etc)"""
    sb = get_supabase()
    campos = {}
    for f in ["quantidade_comprar","preco_custo","nome_fornecedor","link_fornecedor",
              "sku_fornecedor","forma_pagamento","numero_parcelas","data_vencimento",
              "final_cartao","status_pagamento","status_item","numero_pedido_fornecedor",
              "prazo_entrega","rastreio","obs"]:
        if f in payload:
            campos[f] = payload[f]
    sb.table("oc_itens").update(campos).eq("id", item_id).execute()
    return {"ok": True}


@app.get("/cartoes")
async def listar_cartoes(usuario: str = Depends(verificar_token)):
    """Cadastro leve de cartões. Preenche-se sozinho conforme as compras."""
    sb = get_supabase()
    res = sb.table("cartoes").select("*").order("final_cartao").execute()
    return res.data or []


@app.post("/cartoes")
async def upsert_cartao(payload: dict, usuario: str = Depends(verificar_token)):
    """Aprende/atualiza um cartão pelo final (4 díg.) + dia de vencimento (1-31).
    Editar o dia atualiza todas as compras daquele cartão, pois o vencimento
    é derivado daqui (não congelado no item)."""
    sb = get_supabase()
    final = (str(payload.get("final_cartao") or "")).strip()[-4:]
    if not final:
        raise HTTPException(status_code=400, detail="final_cartao obrigatório")
    registro = {"final_cartao": final}
    if payload.get("dia_vencimento") is not None:
        try:
            dia = int(payload["dia_vencimento"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="dia_vencimento inválido")
        registro["dia_vencimento"] = max(1, min(31, dia))
    if payload.get("apelido") is not None:
        registro["apelido"] = payload["apelido"]
    # upsert pelo final (final_cartao é único)
    sb.table("cartoes").upsert(registro, on_conflict="final_cartao").execute()
    return {"ok": True, **registro}


@app.delete("/oc-itens/{item_id}")
async def remover_item_oc(item_id: int, usuario: str = Depends(verificar_token)):
    """Remove item de uma OC"""
    sb = get_supabase()
    sb.table("oc_itens").delete().eq("id", item_id).execute()
    return {"ok": True}


@app.get("/ordens-compra/itens-consolidados")
async def itens_consolidados(
    todos: bool = False,
    usuario: str = Depends(verificar_token)
):
    """Visão consolidada de itens a comprar agrupados por descrição"""
    sb = get_supabase()

    # Buscar OCs ativas (não arquivadas, não disponíveis)
    q = sb.table("ordens_compra").select("id,titulo,usuario_email,usuario_nome")
    if not todos:
        q = q.eq("usuario_email", usuario)
    ocs_ativas = q.in_("status", ["rascunho","confirmada","parcialmente_comprada","comprada"]).execute()

    if not ocs_ativas.data:
        return []

    oc_ids = [oc["id"] for oc in ocs_ativas.data]
    oc_map = {oc["id"]: oc for oc in ocs_ativas.data}

    # Buscar itens pendentes dessas OCs
    itens_res = sb.table("oc_itens").select("*")\
        .in_("oc_id", oc_ids)\
        .in_("status_item", ["pendente","comprado"])\
        .execute()

    # Agrupar por descrição
    from collections import defaultdict
    grupos = defaultdict(list)
    for item in (itens_res.data or []):
        key = item["descricao"].strip().upper()
        grupos[key].append({
            **item,
            "oc_titulo": oc_map.get(item["oc_id"], {}).get("titulo", ""),
            "oc_usuario": oc_map.get(item["oc_id"], {}).get("usuario_nome", ""),
        })

    resultado = []
    for desc, itens in grupos.items():
        total_qty = sum(float(i.get("quantidade_comprar") or 0) for i in itens)
        unidade = itens[0].get("unidade", "UN")
        resultado.append({
            "descricao": desc,
            "unidade": unidade,
            "total_quantidade": total_qty,
            "total_ocs": len(itens),
            "itens": itens,
        })

    resultado.sort(key=lambda x: x["descricao"])
    return resultado


@app.post("/ordens-compra/arquivar-antigas")
async def arquivar_antigas(usuario: str = Depends(verificar_token)):
    """Arquiva OCs com status 'disponivel' há mais de 30 dias"""
    sb = get_supabase()
    from datetime import datetime, timedelta
    limite = (datetime.now() - timedelta(days=30)).isoformat()
    res = sb.table("ordens_compra")\
        .update({"status": "arquivada"})\
        .eq("status", "disponivel")\
        .lt("atualizado_em", limite)\
        .execute()
    return {"arquivadas": len(res.data) if res.data else 0}
