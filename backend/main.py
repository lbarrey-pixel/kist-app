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
Extraia itens de cotação de e-mails, textos, planilhas ou imagens e retorne JSON.

RETORNE APENAS JSON VÁLIDO. Sem markdown, sem ```json, sem ```. Só o objeto JSON puro.

Formato — SEMPRE retorne um array de propostas, mesmo que seja apenas uma:
{
  "propostas": [
    {
      "titulo": "identificador curto da demanda (ex: 'SC 18712 Rack', 'RC 45321', 'Planilha 1')",
      "cliente": "NOME DO CLIENTE",
      "cnpj": "XX.XXX.XXX/XXXX-XX ou null",
      "rc_neg": "RC XXXXX ou NEG-XXXXXXX ou null",
      "itens": [
        {
          "descricao": "descrição comercial curta — máx 120 chars",
          "descricao_original": "texto exato do cliente, preservado integralmente",
          "specs_complementares": "specs técnicas ou PN se presentes, senão null",
          "quantidade": 1,
          "unidade": "UN",
          "sugerir_pn": false
        }
      ]
    }
  ]
}

QUANDO CRIAR MÚLTIPLAS PROPOSTAS:
- O conteúdo traz seções claramente separadas por arquivo/planilha/aba → uma proposta por seção
- O e-mail menciona explicitamente múltiplos projetos, RCs ou solicitações distintas → uma por demanda
- Lista de itens é única (mesmo que longa) → uma única proposta

REGRAS DE DESCRIÇÃO:
- "descricao": sempre curta e comercial. Formato: [Categoria] [Marca/Modelo] [Spec principal]
- "descricao_original": preservar EXATAMENTE como veio, sem alterar nada
- "specs_complementares": preencher quando original for longa ou tabela; incluir PN/código se presente
- "sugerir_pn": true SÓ para itens de alto valor (notebook, servidor, switch gerenciável, UPS,
  câmera IP, storage) sem modelo específico definido. Commodities → sempre false

REGRAS GERAIS:
- Extraia TODOS os itens, inclusive de imagens/prints
- quantidade = número, nunca string
- Em tabelas com coluna Qtd/Quantidade/QTDE: leia a célula exata da coluna. A quantidade NÃO
  é o número da linha nem o código do item. Verifique cada linha antes de confirmar.
- Em tabelas com coluna PN/Código/Nº do item/SKU: inclua em specs_complementares como "PN: XXXXX"
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

def _fazer_matching(itens_raw: list, claude, sb) -> list:
    """Faz matching dos itens extraídos com o banco de preços via Claude Haiku.
    Reutilizável pelo endpoint /extrair para cada proposta individualmente."""
    import json as _jm

    if not itens_raw:
        return []

    # Buscar candidatos em lote
    try:
        res_batch = sb.table("produtos")            .select("descricao,preco_un,proposta_tiny,data_ref")            .order("data_ref", desc=True).limit(500).execute()
        todos_candidatos = res_batch.data or []
    except Exception:
        todos_candidatos = []

    itens_txt = ""
    for i, item in enumerate(itens_raw):
        itens_txt += f"\nItem {i}: {item.get('descricao', '')}"

    candidatos_por_item = []
    candidatos_txt = ""
    for i, item in enumerate(itens_raw):
        candidatos = _prefiltro_candidatos(item.get("descricao", ""), todos_candidatos)
        candidatos_por_item.append(candidatos)
        if candidatos:
            candidatos_txt += f"\n\n--- Candidatos para Item {i} ({item.get('descricao','')[:60]}) ---\n"
            for j, c in enumerate(candidatos[:20]):
                candidatos_txt += f"  [{j}] {c.get('descricao','')} | R$ {c.get('preco_un',0)} | ref {c.get('proposta_tiny','')}\n"

    prompt_matching = f"""Itens solicitados:{itens_txt}

Candidatos do banco de preços:{candidatos_txt}

Para cada item, identifique qual candidato é o mesmo produto ou retorne null se nenhum for adequado.
Lembre: fabricante diferente = null. Categoria diferente = null. Seja rigoroso."""

    try:
        resp_match = claude.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=3000,
            system=SYSTEM_MATCHING,
            messages=[{"role": "user", "content": prompt_matching}],
            temperature=0.0, timeout=30.0
        )
        raw_match = resp_match.content[0].text.strip()
        raw_match = re.sub(r'^```(?:json)?\s*', '', raw_match)
        raw_match = re.sub(r'\s*```$', '', raw_match.strip())
        matches = {m["indice"]: m for m in _jm.loads(raw_match).get("matches", [])}
    except Exception:
        matches = {}

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
            desc_final = match["banco_descricao"]
            preco_un = float(match.get("banco_preco") or 0)
            proposta_ref = match.get("banco_proposta", "")
            obs_item = f"{'✓' if confianca == 'alta' else '~'} ref {proposta_ref}" if proposta_ref else ""
        elif confianca == "baixa" and match.get("banco_descricao"):
            desc_final = desc
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

    return itens_com_preco


@app.post("/extrair")
async def extrair_email(
    texto: str = Form(None),
    arquivos: list[UploadFile] = File(default=[]),   # múltiplos arquivos (email + Excels + PDFs)
    imagens: list[UploadFile] = File(default=[]),
    numero_proposta: str = Form(...),
    token_form: str = Form(None),
    request: Request = None,
    usuario: str = Depends(verificar_token)
):
    """Extrai itens do e-mail/prints/planilhas e faz matching com o banco.
    Aceita múltiplos arquivos simultaneamente; retorna uma ou mais propostas."""

    import json as _json_ext

    imgs_msg: list = []        # imagens embutidas nos .msg
    contexto_email = ""        # body/assunto do email (contexto de cliente/CNPJ)
    conteudo_files: list = []  # [(nome, texto)] por arquivo de conteúdo (Excel, PDF)
    todas_imgs_len = 0

    _IMG_SKIP_EXT = re.compile(r'logo|logotipo|assinatura|signature|bullet|icon', re.I)

    def _extrair_excel_bytes(data, fname):
        try:
            import openpyxl, io as _io
            wb = openpyxl.load_workbook(_io.BytesIO(data), read_only=True, data_only=True)
            partes = []
            for sname in wb.sheetnames:
                ws = wb[sname]
                linhas = []
                for row in ws.iter_rows(values_only=True):
                    vals = [str(c).strip() if c is not None else "" for c in row]
                    if any(v and v != "None" for v in vals):
                        linhas.append(" | ".join(vals))
                if linhas:
                    partes.append(f"[ABA: {sname}]\n" + "\n".join(linhas[:300]))
            return "\n\n".join(partes)
        except Exception:
            return ""

    # ── Processar cada arquivo enviado ──────────────────────────────────────
    for arq in (arquivos or []):
        if not (arq and arq.filename):
            continue
        fname = arq.filename
        flo = fname.lower()
        dados = await arq.read()

        if flo.endswith(".msg"):
            # Email: extrai corpo (contexto) + anexos do email
            with open("/tmp/ext_upload.msg", "wb") as _f:
                _f.write(dados)
            _msg = extract_msg.openMsg("/tmp/ext_upload.msg")
            corpo = (_msg.body or "").strip()
            contexto_email += f"Assunto: {_msg.subject}\n\nCorpo:\n{corpo}\n\n"

            for att in _msg.attachments:
                afn = (att.longFilename or att.shortFilename or "").lower()
                if not att.data:
                    continue
                if afn.endswith((".xlsx", ".xls", ".xlsm")):
                    xl = _extrair_excel_bytes(att.data, afn)
                    if xl.strip():
                        conteudo_files.append((att.longFilename or att.shortFilename, xl))
                elif afn.endswith(".pdf") and not _PDF_SKIP.search(afn):
                    pt = _pdf_po_texto(att.data)
                    if pt.strip():
                        conteudo_files.append((att.longFilename or att.shortFilename, pt))
                elif afn.endswith((".png", ".jpg", ".jpeg", ".webp")):
                    if not _IMG_SKIP_EXT.search(afn) and len(att.data) >= 5000:
                        imgs_msg.append((afn, att.data))

        elif flo.endswith((".xlsx", ".xls", ".xlsm")):
            xl = _extrair_excel_bytes(dados, fname)
            if xl.strip():
                conteudo_files.append((fname, xl))

        elif flo.endswith(".pdf"):
            pt = _pdf_po_texto(dados)
            if pt.strip():
                conteudo_files.append((fname, pt))

        elif flo.endswith((".png", ".jpg", ".jpeg", ".webp")):
            if not _IMG_SKIP_EXT.search(flo):
                imgs_msg.append((flo, dados))

        else:
            try:
                contexto_email += dados.decode("utf-8", "ignore")[:4000] + "\n\n"
            except Exception:
                pass

    if texto:
        contexto_email += texto

    # ── Montar chamadas de extração ──────────────────────────────────────────
    # Regra: um arquivo de conteúdo (Excel/PDF) = uma proposta candidata
    # Sem arquivos de conteúdo = tudo junto em uma chamada (body + imagens)
    imgs_validas = [img for img in (imagens or []) if img and img.filename]
    todas_imgs_len = len(imgs_validas) + len(imgs_msg)
    modelo_extracao = "claude-sonnet-4-6" if todas_imgs_len > 0 else "claude-haiku-4-5-20251001"
    claude = get_claude()

    propostas_raw: list = []

    async def _chamar_extracao(payload_txt, imgs_inline=None, imgs_upload=None):
        """Monta o payload e chama o Claude para extração."""
        msg_content = []
        if payload_txt.strip():
            msg_content.append({"type": "text", "text": payload_txt[:12000]})
        if imgs_inline:
            msg_content.append({"type": "text", "text": f"Analise também {len(imgs_inline)} imagem(ns):"})
            for _, img_bytes in (imgs_inline or [])[:4]:
                msg_content.append({"type": "image", "source": {"type": "base64",
                    "media_type": "image/png", "data": _b64.standard_b64encode(img_bytes).decode()}})
        if imgs_upload:
            for img in (imgs_upload or [])[:4]:
                ib = await img.read()
                flo2 = (img.filename or "").lower()
                mt = "image/jpeg" if flo2.endswith((".jpg", ".jpeg")) else "image/png"
                msg_content.append({"type": "image", "source": {"type": "base64", "media_type": mt,
                    "data": _b64.standard_b64encode(ib).decode()}})
        if not msg_content:
            return []
        resp = claude.messages.create(
            model=modelo_extracao, max_tokens=4000,
            system=SYSTEM_EXTRACAO,
            messages=[{"role": "user", "content": msg_content}],
        )
        raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        raw = re.sub(r'^```json\s*', '', raw); raw = re.sub(r'\s*```$', '', raw)
        try:
            parsed = _json_ext.loads(raw)
            # Normalizar: se retornar formato antigo (sem propostas[]), encapsular
            if "itens" in parsed and "propostas" not in parsed:
                parsed = {"propostas": [parsed]}
            return parsed.get("propostas", [])
        except Exception:
            return []

    if conteudo_files:
        # Uma chamada por arquivo de conteúdo
        for nome_arq, conteudo_arq in conteudo_files:
            ctx = f"CONTEXTO (cliente/CNPJ/referência do e-mail):\n{contexto_email[:3000]}\n\n" \
                  f"CONTEÚDO PARA COTAÇÃO — arquivo: {nome_arq}\n{conteudo_arq}"
            props = await _chamar_extracao(ctx)
            for p in props:
                p.setdefault("titulo", nome_arq)
            propostas_raw.extend(props)
    else:
        # Tudo junto (body + imagens)
        props = await _chamar_extracao(contexto_email, imgs_inline=imgs_msg, imgs_upload=imgs_validas)
        propostas_raw.extend(props)

    if not propostas_raw:
        propostas_raw = [{"titulo": "", "cliente": "", "cnpj": None,
                          "rc_neg": None, "itens": []}]

    # ── Matching com banco + atribuição de números de proposta ──────────────
    try:
        base_num = int(numero_proposta)
    except Exception:
        base_num = None

    t0 = time.time()
    resultado_propostas = []
    for idx_p, prop_raw in enumerate(propostas_raw):
        num_prop = str(base_num + idx_p) if base_num is not None else (
            numero_proposta if idx_p == 0 else f"{numero_proposta}-{idx_p + 1}")
        prop_raw["proposta"] = num_prop

        itens_brutos = prop_raw.get("itens", []) or []
        if not itens_brutos:
            resultado_propostas.append({**prop_raw, "itens": []})
            continue

        # Matching com o banco de preços
        sb = get_supabase()
        try:
            itens_enriquecidos = _fazer_matching(itens_brutos, claude, sb)
        except Exception:
            itens_enriquecidos = itens_brutos

        resultado_propostas.append({**prop_raw, "itens": itens_enriquecidos})

    elapsed = time.time() - t0

    return {"propostas": resultado_propostas, "elapsed": round(elapsed, 2)}


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


def _cnpj_valido(cnpj: str) -> bool:
    """Valida CNPJ pelos dígitos verificadores (independe de formatação)."""
    n = re.sub(r"\D", "", cnpj or "")
    if len(n) != 14 or n == n[0] * 14:
        return False
    def dv(base, pesos):
        s = sum(int(d) * p for d, p in zip(base, pesos)); r = s % 11
        return "0" if r < 2 else str(11 - r)
    p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; p2 = [6] + p1
    return n[12] == dv(n[:12], p1) and n[13] == dv(n[:13], p2)


def _cnpj_formatado(cnpj: str) -> str:
    """Reformata os 14 dígitos no padrão 00.000.000/0000-00."""
    n = re.sub(r"\D", "", cnpj or "")
    if len(n) != 14:
        return cnpj or ""
    return f"{n[:2]}.{n[2:5]}.{n[5:8]}/{n[8:12]}-{n[12:]}"


def _cep_formatado(cep: str) -> str:
    n = re.sub(r"\D", "", str(cep or ""))
    return f"{n[:5]}-{n[5:]}" if len(n) == 8 else (str(cep or ""))


def _consulta_receita(cnpj_digitos: str) -> dict:
    """Busca dados cadastrais na BrasilAPI (base da Receita Federal).
    Retorna {} em QUALQUER falha (timeout, fora do ar, CNPJ não achado) —
    a geração da proposta nunca é bloqueada por causa disto."""
    try:
        import urllib.request, json as _json
        url = f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_digitos}"
        req = urllib.request.Request(url, headers={"User-Agent": "kist-cabine/1.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            return _json.load(resp) or {}
    except Exception:
        return {}


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

    # Tratamento do CNPJ: válido entra formatado; inválido fica vazio (pra não
    # travar a importação) e o valor captado é sinalizado nas Observações.
    cnpj_raw = (payload.get("cnpj", "") or "").strip()
    cnpj_ok = _cnpj_valido(cnpj_raw)
    cnpj_saida = _cnpj_formatado(cnpj_raw) if cnpj_ok else ""
    aviso_cnpj = "" if (cnpj_ok or not cnpj_raw) else f"CNPJ captado (INVÁLIDO, conferir): {cnpj_raw}"

    # Para CNPJ válido, busca dados cadastrais na Receita (BrasilAPI).
    # Regra: a cotação manda — só preenchemos campos que vierem VAZIOS.
    # Se a consulta falhar, segue com o que tem (rec = {}).
    rec = _consulta_receita(re.sub(r"\D", "", cnpj_raw)) if cnpj_ok else {}
    def _vazio_ou(atual, receita):
        a = (atual or "").strip()
        return a if a else (str(receita).strip() if receita else "")

    nome_contato = _vazio_ou(payload.get("cliente", ""), rec.get("razao_social"))
    cep_val      = _vazio_ou("", _cep_formatado(rec.get("cep")) if rec.get("cep") else "")
    municipio_val= _vazio_ou("", rec.get("municipio"))
    uf_val       = _vazio_ou("", rec.get("uf"))
    endereco_val = _vazio_ou("", rec.get("logradouro"))
    numero_val   = _vazio_ou("", rec.get("numero"))
    bairro_val   = _vazio_ou("", rec.get("bairro"))

    # Campos preenchidos na tela de conferência
    prazo_entrega = (str(payload.get("prazo_entrega", "") or "")).strip()
    def _frete_fmt(v):
        s = str(v or "").strip()
        if not s:
            return "0,00"
        if "," in s:
            s = s.replace(".", "").replace(",", ".")
        try:
            return f"{float(s):.2f}".replace(".", ",")
        except Exception:
            return "0,00"
    frete_val = _frete_fmt(payload.get("frete"))

    rows = []
    for item in payload.get("itens", []):
        r = {c: '' for c in COLUNAS}
        r['Número da proposta'] = payload.get("proposta", "")
        r['Data'] = hoje
        r['Nome do contato'] = nome_contato
        r['Tipo de Pessoa'] = 'J'
        r['CPF/CNPJ'] = cnpj_saida
        r['CEP'] = cep_val
        r['Município'] = municipio_val
        r['UF'] = uf_val
        r['Endereço'] = endereco_val
        r['Endereço Nro'] = numero_val
        r['Bairro'] = bairro_val
        r['Desconto'] = '0,00'
        r['Frete'] = frete_val
        obs_base = payload.get("rc_neg", "") or ""
        r['Observações'] = f"{obs_base} | {aviso_cnpj}".strip(" |") if aviso_cnpj else obs_base
        r['Validade'] = '5'
        r['Prazo de Entrega'] = prazo_entrega
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
        "frete_recebimento": float(payload.get("frete_recebimento") or 0),
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
                "preco_custo":       float(i.get("preco_custo") or 0),
                "frete_vinda":       float(i.get("frete_vinda") or 0),
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
    busca: str = None,
    numero: str = None,
    cnpj: str = None,
    usuario_email: str = None,
    data_inicio: str = None,
    data_fim: str = None,
    todos: bool = False,
    limit: int = 50,
    usuario: str = Depends(verificar_token)
):
    """Lista propostas com filtros.
    `busca` é a busca única da barra de pesquisa: casa com número da proposta,
    cliente, CNPJ OU descrição de item (ex.: 'Convergint' ou 'MC200L')."""
    sb = get_supabase()
    q = sb.table("propostas").select("*").order("data_geracao", desc=True).limit(limit)

    # Por padrão mostra só do usuário autenticado, salvo se todos=True
    if not todos:
        q = q.eq("usuario_email", usuario)

    if busca and busca.strip():
        # sanitiza p/ não quebrar a sintaxe do filtro OR do PostgREST
        termo = re.sub(r"[,()*]", " ", busca.strip()).strip()
        if termo:
            # propostas cujos ITENS casam na descrição
            ids_por_item = []
            try:
                it = (sb.table("itens_proposta")
                        .select("proposta_id")
                        .or_(f"descricao_final.ilike.*{termo}*,descricao_original.ilike.*{termo}*")
                        .limit(500).execute())
                ids_por_item = list({r["proposta_id"] for r in (it.data or []) if r.get("proposta_id") is not None})
            except Exception:
                ids_por_item = []
            or_parts = [
                f"numero_proposta.ilike.*{termo}*",
                f"cliente.ilike.*{termo}*",
                f"cnpj.ilike.*{termo}*",
            ]
            if ids_por_item:
                or_parts.append(f"id.in.({','.join(str(i) for i in ids_por_item)})")
            q = q.or_(",".join(or_parts))

    # filtros específicos (compatibilidade / uso programático)
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

# ============================================================================
# Casar PO do cliente com proposta salva (matcher) — reusa leitura .msg/PDF + Claude
# ============================================================================
SYSTEM_PO = """Você recebe o texto de uma ORDEM DE COMPRA (PO) enviada por um cliente.
O texto pode incluir tabelas no formato "Coluna1 | Coluna2 | ..." — use essas tabelas como fonte principal.
A coluna "Qnt", "Quantidade", "QTDE" ou "Qty" é a quantidade do item. Dimensões na descrição (ex: "430MM X 240MM X 300MM") NÃO são quantidade.
Extraia em JSON PURO (sem markdown, sem ``` ):
{"itens":[{"descricao":"...","quantidade":0,"preco_unitario":0}],"destino":"endereço/cidade-UF de entrega ou ''"}
quantidade e preco_unitario são números (ponto decimal). Sem preço -> 0. Não invente itens. Só o JSON."""

SYSTEM_PROP_TINY = """Você recebe o texto de uma PROPOSTA COMERCIAL / orçamento (sistema Tiny).
Extraia em JSON PURO (sem markdown, sem ``` ):
{"cliente":"...","cnpj":"...","numero_proposta":"...","itens":[{"descricao":"...","quantidade":0,"preco_venda":0}]}
Números com ponto decimal. Sem dado -> "" ou 0. Não invente itens. Só o JSON."""

def _pdf_po_texto(data):
    """Extrai texto de PDF de PO.
    - Sempre inclui página 1 (CNPJ, número da PO).
    - Para PDFs com padrão 'Item:NNNNN' (Embraer/SAP): inclui APENAS as páginas
      que contêm itens, descartando as páginas de T&C.
    - Para outros PDFs: comportamento original (extract_tables + extract_text).
    """
    try:
        import pdfplumber, io as _io
        partes = []
        with pdfplumber.open(_io.BytesIO(data)) as pdf:
            textos_paginas = [(page.extract_text() or "").strip() for page in pdf.pages]

        tem_item_nnnnn = any(re.search(r'\bItem:\d{5}', t) for t in textos_paginas)

        if tem_item_nnnnn:
            for i, txt in enumerate(textos_paginas):
                if i == 0 or re.search(r'\bItem:\d{5}', txt):
                    if txt:
                        partes.append(txt)
        else:
            with pdfplumber.open(_io.BytesIO(data)) as pdf:
                for page in pdf.pages:
                    for table in (page.extract_tables() or []):
                        # Pular tabelas header-only (1 linha) — a IA usaria
                        # a tabela vazia como "fonte principal" e ignoraria
                        # o extract_text onde os itens realmente estão
                        if len(table or []) <= 1:
                            continue
                        rows = []
                        for row in (table or []):
                            cells = [str(c or "").replace("\n", " ").strip() for c in row]
                            rows.append(" | ".join(cells))
                        if rows:
                            partes.append("\n".join(rows))
                    txt = (page.extract_text() or "").strip()
                    if txt:
                        partes.append(txt)

        return "\n\n".join(partes)
    except Exception:
        return ""


# ═══════════════════════════════════════════════════════════════════════════
# EXTRAÇÃO DE PO — Arquitetura em 3 camadas:
#   1. Parser determinístico (regex com âncoras confiáveis, sem IA)
#   2. Validação cruzada independente (subtotal PDF × soma dos itens)
#   3. IA como fallback + revalidação
# ═══════════════════════════════════════════════════════════════════════════

def _parse_numero(s):
    """Converte número do PDF para float detectando o formato separador.
    - '6.00' ou '11.00'  → ponto decimal (Anglo/SAP) → float direto
    - '59,60'            → vírgula decimal (BR)
    - '1.234,56'         → ponto milhar + vírgula decimal (BR extenso)
    """
    s = re.sub(r'[^\d.,]', '', s or '')
    if not s:
        return 0.0
    if '.' in s and ',' in s:
        return float(s.replace('.', '').replace(',', '.'))
    elif ',' in s:
        return float(s.replace(',', '.'))
    else:
        return float(s)


def _extrair_validacao_po(texto):
    """Extrai dados de validação INDEPENDENTES do corpo do PDF
    (subtotal, valor total, n° de itens). Usados para checar qualquer
    método de extração sem se basear nos itens em si."""
    dados = {}
    m = re.search(r'[Ss]ubtotal\s+R\$\s*([\d.]+,\d{2})', texto)
    if m:
        dados['subtotal'] = _parse_numero(m.group(1))
    m = re.search(r'[Vv]alor\s+[Tt]otal[:\s]+R\$\s*([\d.]+,\d{2})', texto)
    if m:
        dados['valor_total'] = _parse_numero(m.group(1))
    # "Total dos itens 479,78" (formato proposta Kist/Tiny)
    m = re.search(r'[Tt]otal\s+dos\s+itens\s+([\d.,]+)', texto)
    if m and 'subtotal' not in dados:
        dados['subtotal'] = _parse_numero(m.group(1))
    # "Número de itens: N"
    m = re.search(r'[Nn][uú]mero\s+de\s+itens[:\s]+(\d+)', texto)
    if m:
        dados['n_itens'] = int(m.group(1))
    return dados


def _validar_itens_po(itens, dados_val):
    """Valida itens extraídos contra os totais independentes do PDF.
    Retorna (ok: bool, avisos: list[str]).
    - Subtotal: soma(qtde × preco) deve bater com o subtotal do PDF (tol. R$1)
    - Contagem: n° itens deve bater com 'Número de itens' do PDF (se presente)
    """
    if not itens:
        return False, ['nenhum item extraído']
    avisos = []
    sub_calc = sum(_parse_numero(str(i.get('quantidade', 0))) *
                   _parse_numero(str(i.get('preco_unitario', 0))) for i in itens)
    if 'subtotal' in dados_val and dados_val['subtotal'] > 0:
        diff = abs(sub_calc - dados_val['subtotal'])
        if diff > 1.0:
            avisos.append(
                f"subtotal diverge: calculado R${sub_calc:.2f} "
                f"≠ PDF R${dados_val['subtotal']:.2f} (Δ R${diff:.2f})"
            )
    if 'n_itens' in dados_val and len(itens) != dados_val['n_itens']:
        avisos.append(
            f"contagem diverge: extraídos {len(itens)} "
            f"≠ PDF {dados_val['n_itens']} itens"
        )
    return len(avisos) == 0, avisos


def _parsear_itens_convergint(texto):
    """Parser determinístico para POs no formato Convergint / SAP Business One.
    Âncora principal: data DD/MM/YYYY divide descrição dos dados numéricos.
    Cada linha de item tem: SEQ SKU DESCRIÇÃO DATA [UNID] QTDE R$ PREÇO R$ TOTAL

    Detectado por: presença de 'DD/MM/YYYY' + 'R$ X,XX  R$ X,XX' em linhas de item.
    Validação item-a-item: QTDE × PREÇO ≈ TOTAL (tolerância R$0,02/unidade).
    """
    if not re.search(
        r'^\s*\d+\s+\S+\s.+\d{2}/\d{2}/\d{4}.+R\$\s*[\d.]+,\d{2}\s+R\$',
        texto, re.M
    ):
        return None

    ITEM_PAT = re.compile(
        r'^\s*(\d+)\s+'          # seq
        r'(\S+)\s+'               # SKU
        r'(.+?)\s+'                # descrição (lazy, não cruza linha)
        r'\d{2}/\d{2}/\d{4}\s+' # data (âncora, consumida)
        r'(?:[A-Za-zÀ-ÿ]{1,4}\s+)?' # unidade opcional (UN/un/PC/m…)
        r'(\d+[.,]\d{1,3})\s+'   # quantidade
        r'R\$\s*([\d.]+,\d{2})\s+' # preço unitário
        r'R\$\s*([\d.]+,\d{2})', # valor total
        re.MULTILINE
    )

    # Remove NCM da descrição — capturado porque fica entre descrição e data no PDF.
    # Trata NCMs limpos (8536.90.90) e garbled (PR8A5T3A6.90.90).
    _NCM_TRAIL  = re.compile(r'\s+\S*\.\d{2}\.\d{2}\S*$')
    _PREP_TRAIL = re.compile(r'\s+(?:DE|DO|DA|DOS|DAS|EM|NO|NA|E|A|O|,)\s*$', re.I)
    def _limpar_desc(d):
        d = _NCM_TRAIL.sub('', d).strip()
        return _PREP_TRAIL.sub('', d).strip()

    itens = []
    for m in ITEM_PAT.finditer(texto):
        desc  = _limpar_desc(m.group(3).strip())
        qtd   = _parse_numero(m.group(4))
        preco = _parse_numero(m.group(5))
        total = _parse_numero(m.group(6))

        # Validação item: qtde × preço ≈ total (tol. 2 cents por unidade)
        esperado = round(qtd * preco, 2)
        preco_ok = abs(esperado - total) <= max(0.02 * max(1, qtd), 0.05)
        itens.append({
            'descricao':    desc,
            'quantidade':   qtd,
            'preco_unitario': preco if preco_ok else 0.0,
        })

    return itens if itens else None


def _parsear_itens_po_nativo(texto):
    """Parser direto para POs no formato Item:NNNNN (Embraer, SAP e similares).
    Retorna lista de itens ou None se padrão não detectado."""
    if not re.search(r'\bItem:\d{5}', texto):
        return None

    itens = []
    blocos = re.split(r'(?=\bItem:\d{5}\b)', texto)
    skip_prefixes = ("Quantidade", "Utiliza", "GPX", "Item:", "Assinado", "ValorTotal")

    for bloco in blocos:
        if not re.match(r'\s*Item:\d{5}', bloco):
            continue
        linhas = [l.strip() for l in bloco.split("\n") if l.strip()]
        if not linhas:
            continue
        linha1 = linhas[0]
        pn = ""
        pn_m = re.search(r'\bPN:(\S+)', linha1)
        if pn_m:
            pn = pn_m.group(1).rstrip("-/")
        den = ""
        den_m = re.search(r'Denomina\w+:(.+)$', linha1, re.I)
        if den_m:
            den = den_m.group(1).strip()
        qtd, preco = 1, 0.0
        for linha in linhas[1:5]:
            m = re.match(r'\d{2}\.\w{3,4}\.\d{4}\s+(\d+)\s+\w+\s+([\d.]+,\d{2})', linha)
            if m:
                qtd = int(m.group(1))
                try:
                    preco = float(m.group(2).replace(".", "").replace(",", "."))
                except Exception:
                    pass
                break
        complemento = ""
        for linha in linhas[2:7]:
            if any(linha.startswith(p) for p in skip_prefixes):
                continue
            if re.match(r'\d{2}\.\w{3,4}\.\d{4}', linha):
                continue
            if re.match(r'^[A-Z\xC0-\xFF0-9/,.+ ()*\-]+$', linha) and len(linha) > 3:
                complemento = linha
                break
        if complemento:
            descricao = f"{complemento} PN:{pn}" if pn else complemento
        elif den:
            descricao = f"{den} PN:{pn}" if pn else den
        else:
            descricao = f"PN:{pn}" if pn else ""
        if descricao:
            itens.append({"descricao": descricao, "quantidade": qtd, "preco_unitario": preco})

    return itens if itens else None

# PDFs irrelevantes em emails de PO (políticas, T&Cs, etc.)
_PDF_SKIP = re.compile(
    r'politic|policy|pagamento|payment|entrega|delivery|termo|term|condi',
    re.I
)

async def _ler_po(arquivo):
    nome = (arquivo.filename or "").lower()
    dados = await arquivo.read()
    if nome.endswith(".msg"):
        with open("/tmp/po_upload.msg", "wb") as f:
            f.write(dados)
        msg = extract_msg.openMsg("/tmp/po_upload.msg")

        # PDFs relevantes primeiro — body depois (body é conversa, PDF tem os dados da PO)
        # Pula PDFs de política/T&C que inflam o conteúdo sem agregar nada útil
        pdfs_txt = []
        for att in msg.attachments:
            fn = (att.longFilename or att.shortFilename or "").lower()
            if att.data and fn.endswith(".pdf") and not _PDF_SKIP.search(fn):
                t = _pdf_po_texto(att.data)
                if t.strip():
                    pdfs_txt.append(t)

        corpo = f"Assunto: {msg.subject}\n\n{(msg.body or '').strip()}"
        partes = pdfs_txt + [corpo]
        return "\n\n[---]\n\n".join(p for p in partes if p.strip())
    if nome.endswith(".pdf"):
        return _pdf_po_texto(dados)
    try:
        return dados.decode("utf-8", "ignore")
    except Exception:
        return ""

def _digitos(s):
    return re.sub(r"\D", "", s or "")

def _toks(s):
    return set(re.findall(r"[a-z0-9]+", (s or "").lower()))

def _item_certo(dtok, preco_po, prop_item):
    """Só consideramos 'mesmo item' (e emprestamos dado de compra) com ALTA certeza:
    descrição idêntica, OU preço exato + descrição bem parecida. Senão, NÃO carrega."""
    itoks = _toks(prop_item.get("descricao_final") or prop_item.get("descricao_original"))
    if not dtok or not itoks:
        return False
    inter = len(dtok & itoks); uni = len(dtok | itoks)
    sim = (inter / uni) if uni else 0.0
    pv = float(prop_item.get("preco_venda") or 0)
    preco_bate = preco_po > 0 and pv > 0 and abs(pv - preco_po) < 0.01
    return (dtok == itoks) or (preco_bate and sim >= 0.6)

def _casar_propostas(cnpjs_dig, itens_match):
    """Casa propostas: CNPJ COMPLETO é o principal; a RAIZ (8 díg.) é filtro extra de confiança."""
    sb = get_supabase()
    full = {c for c in cnpjs_dig if len(c) == 14}
    roots = {c[:8] for c in full}
    if not roots:
        return []
    try:
        props = (sb.table("propostas")
                   .select("id,numero_proposta,cliente,cnpj,data_geracao")
                   .order("data_geracao", desc=True).limit(3000).execute().data) or []
    except Exception:
        props = []
    casadas = [p for p in props if _digitos(p.get("cnpj"))[:8] in roots]
    if not casadas:
        return []
    ids = [p["id"] for p in casadas]
    try:
        itens = (sb.table("itens_proposta").select("*")
                   .in_("proposta_id", ids).limit(4000).execute().data) or []
    except Exception:
        itens = []
    por_prop = {}
    for it in itens:
        por_prop.setdefault(it["proposta_id"], []).append(it)
    po_toks = [(_toks(i.get("descricao")), float(i.get("preco_unitario") or 0)) for i in (itens_match or [])]
    cands = []
    for p in casadas:
        lista = por_prop.get(p["id"], [])
        score = 0.0
        for pt, ppreco in po_toks:
            melhor = 0.0
            for it in lista:
                itoks = _toks(it.get("descricao_final") or it.get("descricao_original"))
                if not pt or not itoks:
                    continue
                inter = len(pt & itoks); uni = len(pt | itoks)
                sim = (inter / uni) if uni else 0.0
                pv = float(it.get("preco_venda") or 0)
                if ppreco and pv and abs(pv - ppreco) < 0.01:
                    sim += 0.5
                melhor = max(melhor, sim)
            score += melhor
        # CNPJ COMPLETO igual = principal (sobe muito); raiz só (filial difer.) fica abaixo
        cnpj_exato = _digitos(p.get("cnpj")) in full
        if cnpj_exato:
            score += 5.0
        cands.append({"proposta": p, "score": round(score, 2), "cnpj_exato": cnpj_exato, "itens": lista})
    cands.sort(key=lambda c: (c["score"], c["proposta"].get("data_geracao") or ""), reverse=True)
    return cands[:8]

def _enriquecer_itens_po(itens_po):
    """Pra cada item da PO, busca no histórico (itens_proposta) e puxa custo/link/fornecedor/frete/PN."""
    sb = get_supabase()
    out = []
    for i in (itens_po or []):
        desc = i.get("descricao") or ""
        preco_po = float(i.get("preco_unitario") or 0)
        enr = {"descricao": desc, "quantidade": i.get("quantidade") or 1, "preco_unitario": preco_po,
               "preco_venda": preco_po, "preco_custo": 0.0, "frete_vinda": 0.0,
               "fornecedor": "", "link_fornecedor": "", "sku_fornecedor": "", "match_banco": False}
        dtok = _toks(desc)
        chave = max(dtok, key=len, default="")
        chave = re.sub(r"[,()*]", "", chave)
        if len(chave) >= 3:
            try:
                r = (sb.table("itens_proposta")
                       .select("descricao_final,descricao_original,preco_venda,preco_custo,frete_vinda,fornecedor,link_fornecedor,sku_fornecedor")
                       .or_(f"descricao_final.ilike.*{chave}*,descricao_original.ilike.*{chave}*")
                       .limit(25).execute().data) or []
            except Exception:
                r = []
            best, bsim = None, -1.0
            for it in r:
                if _item_certo(dtok, preco_po, it):
                    itoks = _toks(it.get("descricao_final") or it.get("descricao_original"))
                    uni = len(dtok | itoks); inter = len(dtok & itoks)
                    sim = (inter / uni) if uni else 0.0
                    if sim > bsim:
                        bsim, best = sim, it
            if best:
                enr.update({
                    "preco_custo": float(best.get("preco_custo") or 0),
                    "frete_vinda": float(best.get("frete_vinda") or 0),
                    "fornecedor": best.get("fornecedor") or "",
                    "link_fornecedor": best.get("link_fornecedor") or "",
                    "sku_fornecedor": best.get("sku_fornecedor") or "",
                    "match_banco": True,
                })  # preco_venda fica o da PO (preservado)
        out.append(enr)
    return out

def _montar_itens_oc(itens_po, prop_itens):
    """OC = itens da PO (descrição/qtd/preço PRESERVADOS). A proposta só empresta o dado de compra."""
    out = []
    for i in (itens_po or []):
        desc = i.get("descricao") or ""
        dtok = _toks(desc)
        preco_po = float(i.get("preco_unitario") or 0)
        oc = {"descricao": desc, "quantidade": i.get("quantidade") or 1,
              "preco_venda": preco_po,   # PREÇO DA PO
              "preco_custo": 0.0, "frete_vinda": 0.0,
              "fornecedor": "", "link_fornecedor": "", "sku_fornecedor": "",
              "item_proposta_id": None, "match_proposta": False}
        best, bsim = None, -1.0
        for it in (prop_itens or []):
            if _item_certo(dtok, preco_po, it):
                itoks = _toks(it.get("descricao_final") or it.get("descricao_original"))
                uni = len(dtok | itoks); inter = len(dtok & itoks)
                sim = (inter / uni) if uni else 0.0
                if sim > bsim:
                    bsim, best = sim, it
        if best:
            oc.update({
                "preco_custo": float(best.get("preco_custo") or 0),
                "frete_vinda": float(best.get("frete_vinda") or 0),
                "fornecedor": best.get("fornecedor") or "",
                "link_fornecedor": best.get("link_fornecedor") or "",
                "sku_fornecedor": best.get("sku_fornecedor") or "",
                "item_proposta_id": best.get("id"),
                "match_proposta": True,
            })
        out.append(oc)
    return out

@app.post("/casar-po")
async def casar_po(
    arquivo: UploadFile = File(None),
    proposta_tiny: list[UploadFile] = File(default=[]),
    texto: str = Form(None),
    usuario: str = Depends(verificar_token)
):
    """Recebe a PO do cliente (.msg/.pdf/texto), extrai e casa com propostas salvas.
    proposta_tiny aceita múltiplos arquivos (cliente comprou de 2+ cotações distintas)."""
    conteudo = ""
    if arquivo and arquivo.filename:
        conteudo = await _ler_po(arquivo)
    elif texto:
        conteudo = texto
    if not (conteudo or "").strip():
        return {"erro": "Não consegui ler o conteúdo. Tente o PDF da PO ou cole o texto."}

    cnpjs = re.findall(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}", conteudo)
    cnpjs_dig = list(dict.fromkeys([_digitos(c) for c in cnpjs if len(_digitos(c)) == 14]))
    pos = re.findall(r"PO[-\s]?\d{5,}", conteudo, re.I)
    po_num = pos[0].strip() if pos else ""

    import json as _json_po
    itens_po, destino = [], ""
    avisos_extracao: list[str] = []

    # ── Extrai dados de validação independentes (subtotal, n° itens) ─────────
    dados_val = _extrair_validacao_po(conteudo)

    # ── Camada 1: parser determinístico Embraer/SAP (Item:NNNNN) ─────────────
    _candidato = _parsear_itens_po_nativo(conteudo)
    if _candidato:
        ok, av = _validar_itens_po(_candidato, dados_val)
        if ok:
            itens_po = _candidato
            dest_m = re.search(r'SHIP\s+TO[:\s]+(.+?)(?=\n\n|\Z)', conteudo, re.I | re.S)
            if dest_m:
                destino = " ".join(dest_m.group(1).split())[:120]
        else:
            avisos_extracao.extend([f"[parser Embraer] {a}" for a in av])
            itens_po = _candidato  # parser determinístico tem precedência mesmo com aviso

    # ── Camada 2: parser determinístico Convergint/SAP-BO (data-anchored) ────
    if not itens_po:
        _candidato = _parsear_itens_convergint(conteudo)
        if _candidato:
            ok, av = _validar_itens_po(_candidato, dados_val)
            if ok:
                itens_po = _candidato
            else:
                avisos_extracao.extend([f"[parser Convergint] {a}" for a in av])
                itens_po = _candidato  # usar mesmo assim; aviso fica registrado

    # ── Camada 3: IA como fallback universal ──────────────────────────────────
    if not itens_po:
        try:
            # Enriquece o prompt com os dados de validação como dica para a IA
            hint = ""
            if dados_val.get("subtotal"):
                hint = f"\n\n[VALIDAÇÃO] Subtotal esperado: R$ {dados_val['subtotal']:.2f}"
                if dados_val.get("n_itens"):
                    hint += f" | {dados_val['n_itens']} itens."
            claude = get_claude()
            r = claude.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=2000,
                system=SYSTEM_PO,
                messages=[{"role": "user", "content": conteudo[:12000] + hint}],
            )
            t = "".join(b.text for b in r.content if getattr(b, "type", "") == "text").strip()
            t = t.strip("`")
            if t.lower().startswith("json"):
                t = t[4:]
            _ia_data = _json_po.loads(t)
            itens_ia  = _ia_data.get("itens", []) or []
            destino   = _ia_data.get("destino", "") or ""
            ok, av = _validar_itens_po(itens_ia, dados_val)
            if ok:
                itens_po = itens_ia
            else:
                avisos_extracao.extend([f"[IA] {a}" for a in av])
                itens_po = itens_ia  # melhor que vazio
        except Exception:
            pass

    # Propostas do Tiny (opcional, múltiplas) — reforço da busca
    itens_match = list(itens_po)
    for pt_file in (proposta_tiny or []):
        if not (pt_file and pt_file.filename):
            continue
        try:
            import json as _json
            ptxt = await _ler_po(pt_file)
            if not ptxt.strip():
                continue
            claude = get_claude()
            rp = claude.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=2500,
                system=SYSTEM_PROP_TINY,
                messages=[{"role": "user", "content": ptxt[:8000]}],
            )
            tp = "".join(b.text for b in rp.content if getattr(b, "type", "") == "text").strip().strip("`")
            if tp.lower().startswith("json"):
                tp = tp[4:]
            prop_tiny = _json.loads(tp)
            for it in (prop_tiny.get("itens") or []):
                itens_match.append({"descricao": it.get("descricao"), "preco_unitario": it.get("preco_venda") or 0})
            cnpj_prop = _digitos(prop_tiny.get("cnpj") or "")
            if len(cnpj_prop) == 14 and cnpj_prop not in cnpjs_dig:
                cnpjs_dig.append(cnpj_prop)
        except Exception:
            continue

    candidatas = _casar_propostas(cnpjs_dig, itens_match)
    for c in candidatas:
        c["itens_oc"] = _montar_itens_oc(itens_po, c.get("itens"))

    KIST_CNPJ = "10573732000396"
    cnpj_cliente = next((c for c in cnpjs_dig if len(c) == 14 and c != KIST_CNPJ), "")
    cnpjs_uniq = list(dict.fromkeys(cnpjs))

    return {
        "po_numero": po_num,
        "cnpjs": cnpjs_uniq,
        "cnpj_cliente": cnpj_cliente,
        "destino": destino,
        "itens_po": _enriquecer_itens_po(itens_po),
        "candidatas": candidatas,
        "avisos": avisos_extracao,  # lista de divergências de validação (vazia = tudo OK)
    }

@app.post("/ordens-compra")
async def criar_oc(payload: dict, usuario: str = Depends(verificar_token)):
    """Cria uma nova ordem de compra"""
    sb = get_supabase()
    # imposto padrão (config que o operador pode sobrescrever depois)
    imposto_def = 12.0
    try:
        c = sb.table("config_kist").select("valor").eq("chave", "imposto_percent_default").limit(1).execute()
        if c.data:
            imposto_def = float(c.data[0]["valor"])
    except Exception:
        pass
    # identidade do cliente: CNPJ + razão social + UF (puxa da Receita se houver CNPJ)
    cnpj_in = re.sub(r"\D", "", payload.get("cnpj") or "")
    cnpj_oc = payload.get("cnpj") or None
    cliente_oc = payload.get("cliente") or None
    uf_oc = payload.get("uf") or None
    if _cnpj_valido(cnpj_in):
        cnpj_oc = _cnpj_formatado(cnpj_in)
        try:
            rec = _consulta_receita(cnpj_in)
            if rec.get("razao_social"):
                cliente_oc = rec["razao_social"]
            if not uf_oc and rec.get("uf"):
                uf_oc = rec["uf"]
        except Exception:
            pass
    res = sb.table("ordens_compra").insert({
        "titulo":        payload.get("titulo", ""),
        "numero_po":     (payload.get("numero_po") or None),   # PO do cliente (pode ser nula/pendente)
        "usuario_email": usuario,
        "usuario_nome":  payload.get("usuario_nome", ""),
        "status":        "rascunho",
        "obs":           payload.get("obs", ""),
        "imposto_percent": imposto_def,
        "cnpj":          cnpj_oc,
        "cliente":       cliente_oc,
        "uf":            uf_oc,
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
                "preco_custo":         float(i.get("preco_custo") or 0),
                "frete_vinda":         float(i.get("frete_vinda") or 0),
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

    # Totais por OC (venda, custo, fretes, imposto, lucros) para os cards e dashboard
    if ocs:
        ids = [o["id"] for o in ocs]
        itens = sb.table("oc_itens").select(
            "oc_id,preco_venda,preco_custo,frete_vinda,quantidade_comprar,quantidade_proposta"
        ).in_("oc_id", ids).execute().data or []
        tot = {}
        for r in itens:
            qd = r.get("quantidade_comprar")
            if qd is None:
                qd = r.get("quantidade_proposta") or 0
            t = tot.setdefault(r["oc_id"], {"valor_venda": 0.0, "valor_custo": 0.0, "soma_frete_vinda_itens": 0.0})
            t["valor_venda"] += float(r.get("preco_venda") or 0) * float(qd or 0)
            t["valor_custo"] += float(r.get("preco_custo") or 0) * float(qd or 0)
            t["soma_frete_vinda_itens"] += float(r.get("frete_vinda") or 0)
        for o in ocs:
            base = tot.get(o["id"], {"valor_venda": 0.0, "valor_custo": 0.0, "soma_frete_vinda_itens": 0.0})
            o.update({"valor_venda": base["valor_venda"], "valor_custo": base["valor_custo"]})
            # frete de vinda efetivo: soma dos itens se houver, senão o global
            soma_itens = base["soma_frete_vinda_itens"]
            frete_vinda = soma_itens if soma_itens > 0 else float(o.get("frete_vinda_global") or 0)
            frete_ida = float(o.get("frete_ida") or 0)
            cobrado = bool(o.get("frete_ida_cobrado"))
            imposto_pct = float(o.get("imposto_percent") if o.get("imposto_percent") is not None else 12)
            custo_total = base["valor_custo"] + frete_vinda + frete_ida
            nota = base["valor_venda"] + (frete_ida if cobrado else 0.0)
            lucro_bruto = nota - custo_total
            imposto = nota * imposto_pct / 100.0
            lucro_liquido = lucro_bruto - imposto
            o["frete_vinda_efetivo"] = frete_vinda
            o["custo_total"] = custo_total
            o["nota"] = nota
            o["imposto_valor"] = imposto
            o["valor_lucro"] = lucro_bruto          # lucro bruto (R$) — compat
            o["lucro_bruto"] = lucro_bruto
            o["lucro_liquido"] = lucro_liquido
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
    for f in ["titulo","numero_po","status","frete_estimado","frete_real","obs",
              "frete_vinda_global","frete_ida","frete_ida_cobrado","imposto_percent",
              "cnpj","cliente","uf"]:
        if f in payload:
            campos[f] = payload[f]
    # CNPJ editado na mão: grava formatado se for válido (senão, o que veio)
    if "cnpj" in campos and campos["cnpj"]:
        dig = re.sub(r"\D", "", campos["cnpj"])
        if _cnpj_valido(dig):
            campos["cnpj"] = _cnpj_formatado(dig)
    if "uf" in campos and campos["uf"]:
        campos["uf"] = str(campos["uf"]).strip().upper()[:2]
    sb.table("ordens_compra").update(campos).eq("id", oc_id).execute()
    # o imposto que o operador definir vira o novo padrão (sobrescreve)
    if "imposto_percent" in payload and payload["imposto_percent"] is not None:
        try:
            sb.table("config_kist").upsert(
                {"chave": "imposto_percent_default", "valor": str(float(payload["imposto_percent"]))},
                on_conflict="chave"
            ).execute()
        except Exception:
            pass
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
    """Atualiza campos de um item de OC"""
    sb = get_supabase()
    campos = {}
    for f in ["descricao","unidade","quantidade_comprar","preco_venda","preco_custo",
              "frete_vinda","nome_fornecedor","link_fornecedor","sku_fornecedor",
              "forma_pagamento","numero_parcelas","data_vencimento","final_cartao",
              "status_pagamento","status_item","numero_pedido_fornecedor",
              "prazo_entrega","rastreio","obs"]:
        if f in payload:
            campos[f] = payload[f]
    if not campos:
        return {"ok": True}
    sb.table("oc_itens").update(campos).eq("id", item_id).execute()
    return {"ok": True}


@app.post("/oc-itens")
async def adicionar_item_oc(payload: dict, usuario: str = Depends(verificar_token)):
    """Adiciona um novo item a uma OC existente"""
    sb = get_supabase()
    oc_id = payload.get("oc_id")
    if not oc_id:
        raise HTTPException(status_code=400, detail="oc_id obrigatorio")
    row = {
        "oc_id": oc_id,
        "descricao": payload.get("descricao") or "",
        "unidade": payload.get("unidade") or "UN",
        "quantidade_proposta": float(payload.get("quantidade") or 1),
        "quantidade_comprar": float(payload.get("quantidade") or 1),
        "preco_venda": float(payload.get("preco_venda") or 0),
        "preco_custo": float(payload.get("preco_custo") or 0),
        "frete_vinda": 0.0,
        "status_item": "pendente",
    }
    res = sb.table("oc_itens").insert(row).execute()
    novo = res.data[0] if res.data else row
    return novo


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
