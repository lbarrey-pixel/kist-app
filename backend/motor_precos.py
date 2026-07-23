# -*- coding: utf-8 -*-
"""
motor_precos.py — Motor de busca de preços na internet (Frente A).

Vive FORA do main.py de propósito: o /gerar-csv e o fmt_preco são invariantes
byte-idênticos de produção, e um subsistema de ~1.200 linhas enfiado no meio do
monólito é onde esse invariante morre por acidente. Aqui o main.py só importa e
chama — o CSV nunca é tocado por este arquivo.

FILOSOFIA (herda a do sistema):
  • A internet APRESENTA, nunca escreve preço no banco oficial. O número de venda
    que migra é sempre o que o operador lançou; a internet contribui origem/rastro.
  • Na dúvida, vazio > dado do item errado. Todo provedor devolve BRUTO; quem julga
    "é o mesmo item?" é o Sonnet, numa camada acima (Bloco 3).
  • Cada provedor só acende quando a credencial dele existe. Sem chave => dorme, e
    a cascata cai pro próximo. Nada quebra por falta de config.

Este é o BLOCO 1: config, câmbio, contrato Provider, normalização e o provider
SerpApi (Google Shopping). Roteador, demais provedores, camada 2 e telemetria
entram nos blocos seguintes.
"""

import os
import re
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
# Chaves entram como variável de ambiente no Render. Ausente => provider dorme.
SERPAPI_KEY   = os.environ.get("SERPAPI_KEY", "")
BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "")        # Bloco 2
EBAY_APP_ID   = os.environ.get("EBAY_APP_ID", "")          # Bloco 2

# TTL da ficha (camada 2): só refresca a origem se a última captura passou disso.
FICHA_TTL_HORAS = int(os.environ.get("FICHA_TTL_HORAS", "24"))

# Fatores de importação — o preço da internet estrangeira NÃO é o custo posto no
# Brasil. Multiplicamos para o operador ter ciência do custo estimado com tributos.
# Regra de negócio (Leonardo, 19/07): importação internacional dobra; Paraguai +20%.
FATOR_IMPORT_INTERNACIONAL = 2.0   # eBay, AliExpress: × cotação × 2
FATOR_IMPORT_PARAGUAI      = 1.2   # ComprasParaguai: × (cotação do próprio site) × 1.2
FATOR_NACIONAL             = 1.0   # SerpApi, Brave, Web Search: sem tributo de importação

# País/idioma para as buscas de varejo nacional.
SERP_GL = "br"      # geolocation
SERP_HL = "pt-br"   # host language

# Timeout padrão das chamadas HTTP externas (segundos). Curto: o fluxo é assíncrono
# item-a-item, e um provedor lento não pode travar a cascata inteira.
HTTP_TIMEOUT = 12

# CNPJ da Kist — NUNCA vaza para pedido de cotação nem para query externa.
KIST_CNPJ = "10573732000396"


# ── HTTP helper ───────────────────────────────────────────────────────────────
def _http_get_json(url: str, headers: dict = None, timeout: int = HTTP_TIMEOUT):
    """GET que devolve JSON, ou levanta. Stdlib (urllib) para não add dependência.

    Levanta em erro; quem chama decide se degrada (provider) ou propaga. Nenhuma
    exceção de rede pode derrubar o /extrair — o provider trata e devolve [].
    """
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "kist-motor/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# ══════════════════════════════════════════════════════════════════════════════
# LEITURA DA PÁGINA DO PRODUTO (refino 22/07)
# ══════════════════════════════════════════════════════════════════════════════
# ACHADO da rodada de 21/07: nos itens em que a engine ACERTOU a fonte, ela entregou
# a página de produto certa (superlight, dimensional) mas com preço NULO, marcando
# "sob consulta" — quando o preço ESTAVA na página. Causa: a engine lia só o SNIPPET
# do resultado de busca e nunca abria a página. Consequência: vencia sempre a metade
# errada de cada fonte (Google Web dava produto certo sem preço; Shopping dava preço
# com link inútil). Aqui a engine passa a ABRIR a página e ler o preço.

_PAGINA_TIMEOUT   = 8      # segundos por página
_PAGINA_MAX_BYTES = 600_000
_PAGINA_MAX       = 3      # no máximo 3 páginas por busca (custo de latência)

_UA_NAVEGADOR = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "pt-BR,pt;q=0.9",
}


def _http_get_text(url: str, timeout: int = _PAGINA_TIMEOUT) -> str:
    """GET de HTML, best-effort. Nunca levanta: devolve '' em qualquer falha —
    ler a página é um BÔNUS, não pode derrubar a busca."""
    try:
        req = urllib.request.Request(url, headers=_UA_NAVEGADOR)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(_PAGINA_MAX_BYTES).decode("utf-8", "replace")
    except Exception:
        return ""


# URL que NÃO é página de produto: resultado de busca, lista, categoria. Regra do
# Leonardo (21/07): "link de resultado de busca não identifica produto, não serve
# como origem e impede o operador de conferir — descarte esse candidato". Apareceu
# em 4 dos 7 itens refinados (google.com/search?ibp=oshop, lista.mercadolivre...).
_URL_NAO_PRODUTO = (
    "google.com/search", "google.com.br/search", "google.com/shopping",
    "lista.mercadolivre", "/busca", "/buscar", "/search?", "/pesquisa",
    "/categoria/", "/c/", "bing.com/search", "/s?k=",
)


def _url_de_produto(url: str) -> bool:
    """True se a URL aparenta ser a PÁGINA DO PRODUTO (comprável e auditável)."""
    u = (url or "").strip().lower()
    if not u.startswith("http"):
        return False
    return not any(p in u for p in _URL_NAO_PRODUTO)


def _num_br(txt) -> float | None:
    """Converte número de página BR/JSON: '1.234,56' e '1234.56' -> 1234.56."""
    s = re.sub(r"[^\d.,]", "", str(txt or "")).strip()
    if not s:
        return None
    m = re.search(r"[.,](\d{1,2})$", s)
    try:
        if m:
            dec = m.group(1)
            inteiro = re.sub(r"[.,]", "", s[: len(s) - len(dec) - 1])
            return float((inteiro or "0") + "." + dec)
        return float(re.sub(r"[.,]", "", s))
    except ValueError:
        return None


def _preco_de_html(html: str) -> float | None:
    """Extrai o preço de uma página SÓ de dados ESTRUTURADOS (JSON-LD schema.org e
    meta tags). Deliberadamente NÃO varre 'R$' no texto solto: ali moram parcelas
    ('12x de R$ 99'), preço riscado e frete, e preço inventado é pior que preço
    ausente. Não achou estruturado => None, e a ficha segue 'sob consulta'."""
    if not html:
        return None
    padroes = (
        r'"lowPrice"\s*:\s*"?([\d.,]+)"?',
        r'"price"\s*:\s*"?([\d.,]+)"?',
        r'itemprop=["\']price["\'][^>]*content=["\']([\d.,]+)["\']',
        r'content=["\']([\d.,]+)["\'][^>]*itemprop=["\']price["\']',
        r'property=["\']product:price:amount["\'][^>]*content=["\']([\d.,]+)["\']',
        r'property=["\']og:price:amount["\'][^>]*content=["\']([\d.,]+)["\']',
    )
    for p in padroes:
        for m in re.finditer(p, html, re.I):
            v = _num_br(m.group(1))
            if v and v > 0:
                return v
    return None


def _enriquecer_precos_por_pagina(cands: list) -> list:
    """Para candidatos SEM preço mas com página de produto: abre a página e tenta
    ler o preço. É o conserto do 'sob consulta' falso. Best-effort e limitado a
    _PAGINA_MAX páginas; falha só mantém o candidato sem preço (como hoje)."""
    lidas = 0
    for c in cands:
        if lidas >= _PAGINA_MAX:
            break
        if c.get("preco_brl") is not None:
            continue
        u = c.get("url") or ""
        if not _url_de_produto(u):
            continue
        lidas += 1
        preco = _preco_de_html(_http_get_text(u))
        if preco:
            # recalcula a conta de moeda/importação com o preço lido
            cot, conv, est = _normalizar(preco, c.get("moeda_original") or "BRL",
                                         c.get("fator_importacao") or FATOR_NACIONAL)
            c["preco_original"] = preco
            c["cotacao_usada"] = cot
            c["preco_convertido_brl"] = conv
            c["preco_estimado_brl"] = est
            c["preco_brl"] = est
            c["preco_da_pagina"] = True     # telemetria: veio da leitura da página
    return cands


def _so_paginas_de_produto(cands: list) -> list:
    """Descarta candidato cuja URL não é página de produto (link de busca/lista).
    Roda ANTES do juiz: o que não dá pra comprar nem auditar não deve nem ser julgado."""
    return [c for c in (cands or []) if _url_de_produto(c.get("url") or "")]


# ── Câmbio (AwesomeAPI) ───────────────────────────────────────────────────────
# Roda no backend (a rede do Claude não alcança a AwesomeAPI — mesma regra da
# BrasilAPI). Cache em memória com validade de 1h: a cotação do dia basta, e não
# se bate na API a cada item. Falha => devolve None e o candidato fica sem preco_brl
# (a ficha mostra a moeda original; melhor sem conversão do que com câmbio inventado).
_cambio_cache: dict = {}   # {"USD-BRL": (valor_float, timestamp_epoch)}
_CAMBIO_TTL = 3600         # 1h


def cotacao(par: str = "USD-BRL") -> float | None:
    """Cotação atual do par (ex.: 'USD-BRL', 'CNY-BRL'). None em falha."""
    par = par.upper().strip()
    now = time.time()
    hit = _cambio_cache.get(par)
    if hit and (now - hit[1]) < _CAMBIO_TTL:
        return hit[0]
    try:
        # https://economia.awesomeapi.com.br/last/USD-BRL  -> {"USDBRL": {"bid": "5.43", ...}}
        data = _http_get_json(f"https://economia.awesomeapi.com.br/last/{par}", timeout=8)
        chave = par.replace("-", "")
        val = float(data[chave]["bid"])
        _cambio_cache[par] = (val, now)
        return val
    except Exception:
        # Sem câmbio: devolve o último conhecido se houver, senão None.
        return hit[0] if hit else None


def _normalizar(preco, moeda: str, fator: float = FATOR_NACIONAL,
                cotacao_fornecida: float = None):
    """Devolve (cotacao_usada, preco_convertido_brl, preco_estimado_brl).

      • Nacional (BRL): cotacao_usada=None; convertido=preco; estimado=preco×fator
        (fator nacional é 1.0 => estimado == convertido).
      • Internacional: usa a cotação FORNECIDA se houver (caso Paraguai, do próprio
        site), senão a AwesomeAPI. convertido = preco×cotação; estimado = ×fator.
      • Câmbio indisponível => convertido/estimado = None. NUNCA inventa taxa.

    O `estimado` é o custo POSTO estimado (com tributo simulado); o `convertido` é
    o câmbio puro. A ficha mostra os dois + a cotação, para o operador ver a conta.
    """
    if preco is None:
        return (None, None, None)
    m = (moeda or "BRL").upper().strip()
    if m in ("BRL", "R$", ""):
        v = round(float(preco), 2)
        return (None, v, round(v * float(fator), 2))
    taxa = cotacao_fornecida if cotacao_fornecida else cotacao(f"{m}-BRL")
    if not taxa:
        return (None, None, None)
    conv = round(float(preco) * float(taxa), 2)
    return (round(float(taxa), 4), conv, round(conv * float(fator), 2))


# ── Candidato normalizado ─────────────────────────────────────────────────────
# Formato único que TODO provider devolve. O julgamento (Bloco 3) e a ficha
# consomem isto — nunca o payload cru da API.
#
# Preço importado carrega a CONTA INTEIRA, não só o número final:
#   preco_original + moeda  →  cotacao_usada  →  preco_convertido_brl (câmbio puro)
#                                             →  ×fator_importacao  →  preco_estimado_brl
# Assim o operador vê "US$ 42 × R$ 5,43 = R$ 228 × 2 (imposto) = R$ 456 posto".
def candidato(*, fonte_nome: str, tipo_preco: str, origem_tipo: str,
              titulo: str, preco, moeda: str = "BRL", url: str = "",
              seller: str = "", disponibilidade: str = "",
              mpn: str = "", apresentacao: str = "",
              fator_importacao: float = FATOR_NACIONAL,
              cotacao_fornecida: float = None) -> dict:
    try:
        preco_f = float(preco) if preco not in (None, "") else None
    except (TypeError, ValueError):
        preco_f = None
    cot, conv, est = _normalizar(preco_f, moeda, fator_importacao, cotacao_fornecida)
    return {
        "fonte_nome":            fonte_nome,
        "tipo_preco":            tipo_preco,        # 'varejo' | 'atacado'
        "origem_tipo":           origem_tipo,       # 'api' | 'web'
        "titulo":                (titulo or "").strip(),
        "mpn_detectado":         (mpn or "").strip(),
        "apresentacao":          (apresentacao or "").strip(),
        "preco_original":        preco_f,
        "moeda_original":        (moeda or "BRL").upper().strip(),
        "cotacao_usada":         cot,               # taxa aplicada (None se BRL/sem câmbio)
        "preco_convertido_brl":  conv,              # original × cotação, SEM tributo
        "fator_importacao":      float(fator_importacao),  # 1.0 nac / 2.0 import / 1.2 Paraguai
        "preco_estimado_brl":    est,               # × cotação × fator = custo POSTO estimado
        "preco_brl":             est,               # alias: referência p/ comparação/ordenação
        "seller":                (seller or "").strip(),
        "disponibilidade":       (disponibilidade or "").strip(),
        "url":                   (url or "").strip(),
        "capturado_em":          None,              # preenchido no upsert da ficha (Bloco 4)
    }


# ── Contrato do provedor ──────────────────────────────────────────────────────
class Provider:
    """Interface uniforme. O roteador não sabe qual provider é qual; só pergunta
    configurado()/atende() e chama buscar(). Subclasses definem o resto."""

    nome        = "base"
    tipo_preco  = "varejo"      # 'varejo' | 'atacado'
    origem_tipo = "api"         # 'api' | 'web' — define robustez do refresh (camada 2)

    def configurado(self) -> bool:
        """Tem credencial para operar? Sem chave => dorme, cascata cai pro próximo."""
        return True

    def atende(self, perfil: dict) -> bool:
        """Este provider faz sentido para este item? (ex.: Mouser só com MPN)."""
        return True

    def buscar(self, perfil: dict, ctx: dict = None) -> list[dict]:
        """Devolve lista de `candidato(...)` BRUTOS. Nunca julga, nunca levanta:
        erro de rede/parse => devolve []. Quem julga é o Bloco 3.

        `ctx` injeta dependências que alguns providers precisam sem importar do
        main.py (evita import circular): ctx = {"claude": <cliente>, "sb": <supabase>}.
        Providers que não usam IA (SerpApi, eBay) ignoram ctx."""
        raise NotImplementedError


# ── Provider: SerpApi (Google Shopping) ───────────────────────────────────────
class SerpApiShopping(Provider):
    """Degrau 1 do bloco nacional. Único que devolve PREÇO ESTRUTURADO (feed de
    shopping: vários sellers, preço já parseado), cobrindo ML + e-commerce BR num
    tiro só — a lista de domínios real da Kist (mercadolivre, dimensional, santil,
    lojaeletrica...) está toda no Google Shopping."""

    nome        = "Google Shopping"
    tipo_preco  = "varejo"
    origem_tipo = "web"     # o link é página de e-commerce => refresh best-effort

    def configurado(self) -> bool:
        return bool(SERPAPI_KEY)

    def buscar(self, perfil: dict, ctx: dict = None) -> list[dict]:
        termo = (perfil.get("consulta") or perfil.get("descricao") or "").strip()
        if not termo:
            return []
        params = {
            "engine": "google_shopping",
            "q": termo,
            "gl": SERP_GL,
            "hl": SERP_HL,
            "num": "20",
            "api_key": SERPAPI_KEY,
        }
        url = "https://serpapi.com/search.json?" + urllib.parse.urlencode(params)
        try:
            data = _http_get_json(url)
        except Exception:
            # Falha de rede/rate/chave: dorme silenciosamente, cascata segue.
            return []

        out = []
        for it in (data.get("shopping_results") or []):
            # extracted_price já vem numérico e em BRL (gl=br). price é o texto "R$ ...".
            preco = it.get("extracted_price")
            if preco in (None, ""):
                continue
            # PREFERE o link da LOJA ao product_link do Google: o product_link é um
            # google.com/search?ibp=oshop, que não identifica produto nem serve de
            # origem (medido em 21/07). Se sobrar só o link do Google, o candidato é
            # descartado abaixo — preço sem página comprável não vale como fonte.
            out.append(candidato(
                fonte_nome=self.nome,
                tipo_preco=self.tipo_preco,
                origem_tipo=self.origem_tipo,
                titulo=it.get("title") or "",
                preco=preco,
                moeda="BRL",
                url=it.get("link") or it.get("product_link") or "",
                seller=it.get("source") or "",              # loja/vendedor
                disponibilidade=it.get("delivery") or "",
            ))
        return _so_paginas_de_produto(out)


# ── Prompt: busca de preço na web crua (Sonnet) ───────────────────────────────
SYSTEM_BUSCA_PRECO = """Você pesquisa PREÇOS de um produto no varejo brasileiro para uma revenda B2B de infraestrutura de telecom e energia.

Use a busca web. Encontre anúncios do MESMO produto que foi pedido — mesma categoria, mesmo fabricante quando indicado, mesma bitola/dimensão. Divergiu em fabricante, categoria ou dimensão => NÃO é o mesmo produto, descarte.

Reconheça a APRESENTAÇÃO COMERCIAL de cada anúncio: metro avulso, caixa/bobina fechada (ex.: 305m), unidade. Quando o mesmo produto aparece em apresentações diferentes, traga as duas.

Responda APENAS com JSON válido — sem markdown, sem ```:
{"anuncios": [
  {"titulo": "...", "preco": 129.90, "loja": "nome da loja/vendedor", "url": "https://...", "apresentacao": "metro|caixa|unidade|outro"}
]}

Regras:
- preco em reais, número puro (ponto decimal). Sem "R$", sem texto.
- Se você ACHOU o produto certo numa loja mas o preço não aparece (é "sob consulta"), traga o anúncio mesmo assim com "preco": null — o operador quer ao menos o link de onde o item está à venda.
- Só o MESMO produto pedido. Na dúvida sobre a identidade, não inclua.
- Não achou o produto certo em lugar nenhum => {"anuncios": []}. Nunca invente preço ou loja."""


class WebSearchAnthropic(Provider):
    """Degrau final do bloco nacional. O Sonnet busca, LÊ e EXTRAI preço da web
    crua — reusa o padrão do /conferir (web_search_20250305, Sonnet 4.6). Mais
    caro por item que o Shopping estruturado, por isso é o último recurso: pega o
    item técnico de nicho que o feed de shopping não indexa.

    Usa a chave Anthropic que já existe (via ctx['claude']) — não precisa de config
    nova. Extrai preço em BRL (varejo nacional), fator nacional (sem imposto)."""

    nome        = "Web Search"
    tipo_preco  = "varejo"
    origem_tipo = "web"     # o link é página de e-commerce => refresh best-effort

    def configurado(self) -> bool:
        return True   # depende só do cliente Claude injetado no ctx

    def buscar(self, perfil: dict, ctx: dict = None) -> list[dict]:
        claude = (ctx or {}).get("claude")
        if claude is None:
            return []
        termo = (perfil.get("consulta") or perfil.get("descricao") or "").strip()
        if not termo:
            return []
        pedido = f"Produto pedido: {termo}"
        specs = (perfil.get("specs") or perfil.get("specs_complementares") or "").strip()
        if specs:
            pedido += f"\nEspecificações do cliente: {specs}"
        qtd = perfil.get("quantidade")
        if qtd:
            pedido += f"\nQuantidade: {qtd} {perfil.get('unidade') or 'UN'}"

        try:
            resp = claude.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1500,
                system=SYSTEM_BUSCA_PRECO,
                messages=[{"role": "user", "content": pedido}],
                tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}],
                timeout=90.0,
            )
        except Exception:
            return []

        # Junta só o texto (a resposta mistura blocos de busca e texto), tira cercas.
        texto = "\n".join(b.text for b in resp.content
                          if getattr(b, "type", "") == "text").strip()
        texto = re.sub(r'^```(?:json)?\s*', '', texto)
        texto = re.sub(r'\s*```$', '', texto.strip())
        try:
            data = json.loads(texto)
        except Exception:
            return []

        out = []
        for a in (data.get("anuncios") or []):
            tem_preco = a.get("preco") not in (None, "")
            tem_url = bool((a.get("url") or "").strip())
            # Sem preço E sem link não serve. Com link (mesmo sem preço) serve:
            # é o "achei onde o item está à venda", o piso que o operador quer.
            if not tem_preco and not tem_url:
                continue
            out.append(candidato(
                fonte_nome=self.nome,
                tipo_preco=self.tipo_preco,
                origem_tipo=self.origem_tipo,
                titulo=a.get("titulo") or "",
                preco=a.get("preco") if tem_preco else None,
                moeda="BRL",                       # varejo nacional
                url=a.get("url") or "",
                seller=a.get("loja") or "",
                apresentacao=a.get("apresentacao") or "",
            ))
        return out


# ══════════════════════════════════════════════════════════════════════════════
# BLOCO 3 — Fase 1 (interpretar), registry, roteador, cascata e julgamento
# ══════════════════════════════════════════════════════════════════════════════

# ── Fase 1: interpretar a NECESSIDADE antes de buscar (REFORÇADA) ─────────────
# Interpretar vem ANTES de buscar. É a defesa contra "buscar bem o item errado".
# Usa SONNET (não Haiku): item técnico (FTP×UTP, Cat6×Cat5e, bitola, fabricante)
# precisa de um modelo que entende de verdade. A IA SIMULA O OPERADOR Kist —
# recebe o cérebro de domínio + as correções que o operador já ensinou
# (memoria_interpretacao) — e, quando fica incerta, CONFERE na web antes de buscar.

def _norm_entrada(s: str) -> str:
    """Réplica EXATA de _norm_entrada() do main.py e de norm_entrada() no Postgres.
    Se divergir, a memória grava com uma chave e busca com outra e o aprendizado
    some sem erro. NFD sem acento, lower, só alfanumérico, espaço colapsado."""
    import unicodedata as _ud
    t = _ud.normalize("NFD", (s or ""))
    t = "".join(c for c in t if _ud.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9]+", " ", t.lower())
    return re.sub(r"\s+", " ", t).strip()


SYSTEM_INTERPRETAR = """Você é um COMPRADOR SÊNIOR da Kist, revenda B2B de telecom e energia. Sua tarefa: ler o item que o cliente pediu e entender EXATAMENTE o que é — como um operador experiente entenderia — ANTES de buscar preço. Buscar o item errado desperdiça todo o resto.

DOMÍNIO (o que você conhece de cabeça):
- Cabos de rede: tipo (U/UTP, F/UTP=FTP, S/FTP) e categoria (Cat5e, Cat6, Cat6a) SÃO EXCLUDENTES — FTP≠UTP, Cat6≠Cat5e. Caixa fechada costuma ser 305m (1000ft). Vendem por metro OU por caixa.
- Cabos elétricos/energia: bitola (mm²) é excludente; a COR não muda o preço.
- Conectores (RJ45, keystone, coaxial), patch cords (medir o comprimento), patch panels, racks (U's), DIOs, cordões ópticos.
- Fontes/energia: fabricante (ex.: Mean Well) e modelo/MPN importam muito; tensão/corrente excludentes.
- Refletores/LED: potência (W) e tipo excludentes.
- Terminais de compressão, suportes, ferragens: bitola/dimensão excludentes.

Devolva SOMENTE JSON, sem markdown:
{
  "consulta": "termo de busca limpo e específico p/ achar ESTE item no varejo BR (fabricante + tipo + categoria + dimensão/bitola quando houver)",
  "fabricante": "marca se indicada, senão vazio",
  "mpn": "part number do fabricante, senão vazio",
  "categoria": "categoria curta (ex: cabo de rede, conector, fonte, refletor)",
  "atributos_excludentes": {"tipo": "", "categoria_tec": "", "bitola_dim": "", "outros": ""},
  "apresentacao_desejada": "metro | caixa | unidade | indiferente",
  "importado": false,
  "confianca": "alta | media | baixa",
  "precisa_conferir": false
}

REGRAS:
- atributos_excludentes: preencha só o que o cliente deixou claro; o que não puder divergir na busca. Deixe vazio o que não se aplica.
- confianca = "baixa" e precisa_conferir = true QUANDO você não tem certeza do que é o item (descrição vaga, sem fabricante/PN, ambígua entre categorias). Ser honesto aqui é melhor que chutar.
- "importado" só true se claramente sem equivalente nacional comum. Na dúvida, false.
- NÃO converta número de dimensão/código em unidade que o cliente não escreveu (ex.: "16 60" é dimensão, NÃO vire "16W 60°"; "9V" é a tensão da pilha, não impõe marca). Se não sabe o que o número significa, deixe como o cliente escreveu.
- Nunca invente fabricante/MPN. Vazio é melhor que errado."""


SYSTEM_CONFERIR_ITEM = """Você é um comprador técnico da Kist (telecom/energia). O cliente mandou a descrição de um item, às vezes ABREVIADA ou em CÓDIGO INTERNO (ex.: "W50 - WOMER MINI OUTDOOR ALUMINIO PAREDE W50 16 60" é um gabinete/rack outdoor da Womer). Sua missão é DESCOBRIR o que é o item usando SÓ o que você CONFIRMAR em páginas reais — nunca um palpite.

Use a busca web de verdade: procure os termos que o cliente deu (código, modelo, marca — Womer, Furukawa, Clamper, Fibersul, etc.), leia as páginas de fabricante e de lojas (dimensional, mercadolivre, etc.) e identifique o produto real.

REGRA DE OURO — NÃO INVENTAR:
- Só preencha "mpn"/"fabricante" se você VIU esse código/marca numa página real que corresponde ao item. Não achou o part number numa página? "mpn" fica VAZIO. Um código errado manda a busca para o produto ERRADO (o operador cota 5×–20× abaixo do item certo). Vazio é o resultado CERTO, não uma falha.
- "consulta" refinada = só marca/modelo/tipo que você CONFIRMOU + os termos do próprio cliente. Se não confirmou nada, repita os termos do cliente como estão. NUNCA acrescente um part number, marca ou atributo que você não viu numa página.
- Não converta dimensão/código em unidade que o cliente não escreveu ("16 60" é dimensão, não "16W 60°").

NÃO busque preço agora; só IDENTIFIQUE. Devolva SOMENTE JSON, sem markdown:
{
  "consulta": "termos do cliente + marca/modelo/tipo SÓ se confirmado numa página real",
  "fabricante": "", "mpn": "",
  "categoria": "",
  "atributos_excludentes": {"tipo": "", "categoria_tec": "", "bitola_dim": "", "outros": ""},
  "achou_identificacao": true
}
Confirmou o item numa página real => achou_identificacao=true e a consulta refinada (sem inventar). Não confirmou => achou_identificacao=false, "mpn" e "fabricante" VAZIOS, e "consulta" = os termos do cliente. Melhor devolver o termo do cliente do que um palpite que erra o alvo."""


def _correcoes_similares(entrada: str, sb, lim: int = 3) -> list:
    """Correções passadas do operador para inputs parecidos (memoria_interpretacao).
    Viram exemplos few-shot: a IA passa a interpretar como o operador ensinou."""
    if sb is None or not (entrada or "").strip():
        return []
    try:
        r = sb.rpc("memoria_interpretacao_similar",
                   {"termo": entrada, "min_sim": 0.45, "lim": lim}).execute()
        return r.data or []
    except Exception:
        return []


def _conferir_web(pedido: str, claude) -> dict:
    """Conferência web (tipo /conferir): Sonnet + web_search identifica o item vago
    ANTES de buscar preço. Retorna campos de refino, ou {} em falha."""
    if claude is None:
        return {}
    try:
        resp = claude.messages.create(
            model="claude-sonnet-4-6", max_tokens=800,
            system=SYSTEM_CONFERIR_ITEM,
            messages=[{"role": "user", "content": pedido}],
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
            timeout=90.0,
        )
        txt = "\n".join(b.text for b in resp.content
                        if getattr(b, "type", "") == "text").strip()
        txt = re.sub(r'^```(?:json)?\s*', '', txt); txt = re.sub(r'\s*```$', '', txt.strip())
        return json.loads(txt)
    except Exception:
        return {}


def interpretar(item: dict, claude, sb=None, avisos: list = None) -> dict:
    """PERFIL do item (base para rota + query + julgamento), com Sonnet que simula
    o operador, memória de interpretação (few-shot) e conferência web quando incerto.

    Falha da IA nunca trava: cai num perfil mínimo com a descrição como consulta."""
    desc  = (item.get("descricao") or item.get("descricao_original") or "").strip()
    specs = (item.get("specs_complementares") or "").strip()
    qtd   = item.get("quantidade")
    uni   = item.get("unidade") or "UN"

    base = {"descricao": desc, "specs": specs, "quantidade": qtd, "unidade": uni,
            "entrada_norm": _norm_entrada(f"{desc} {specs}".strip()),
            "consulta": desc, "mpn": "", "fabricante": "", "categoria": "",
            "atributos_excludentes": {}, "apresentacao_desejada": "indiferente",
            "importado": False, "confianca": "media", "conferiu_web": False}

    if not desc or claude is None:
        return base

    # Few-shot: correções que o operador já ensinou para inputs parecidos.
    exemplos = _correcoes_similares(base["entrada_norm"], sb)
    bloco_ex = ""
    if exemplos:
        linhas = []
        for e in exemplos:
            it = e.get("interpretacao") or {}
            linhas.append(f'- Para "{e.get("entrada_norm")}": '
                          f'{json.dumps(it, ensure_ascii=False)}')
        bloco_ex = ("\n\nO OPERADOR JÁ CORRIGIU interpretações parecidas — siga o padrão:\n"
                    + "\n".join(linhas))

    pedido = f"Descrição do cliente: {desc}\nEspecificações: {specs or '(não informou)'}"
    if qtd:
        pedido += f"\nQuantidade: {qtd} {uni}"
    pedido += bloco_ex

    try:
        resp = claude.messages.create(
            model="claude-sonnet-4-6", max_tokens=700,
            system=SYSTEM_INTERPRETAR,
            messages=[{"role": "user", "content": pedido}],
            temperature=0.0, timeout=45.0,
        )
        txt = resp.content[0].text.strip()
        txt = re.sub(r'^```(?:json)?\s*', '', txt); txt = re.sub(r'\s*```$', '', txt.strip())
        got = json.loads(txt)
        for k in ("consulta", "mpn", "fabricante", "categoria", "atributos_excludentes",
                  "apresentacao_desejada", "importado", "confianca"):
            if k in got:
                base[k] = got[k]
        if not (base.get("consulta") or "").strip():
            base["consulta"] = desc

        # Conferência web: o motor só é chamado para itens que o banco NÃO
        # resolveu — logo, são difíceis por definição. Replicamos o operador:
        # identificar o item na web ANTES de buscar preço (é o que ele faz no
        # Google/chat quando não conhece o item). Só pula quando já veio um MPN
        # cravado — aí a busca acha direto pelo part number.
        sem_mpn = not (base.get("mpn") or "").strip()
        if got.get("precisa_conferir") or base.get("confianca") in ("baixa", "media") or sem_mpn:
            ref = _conferir_web(pedido, claude)
            if ref:
                base["conferiu_web"] = True
                for k in ("consulta", "fabricante", "mpn", "categoria", "atributos_excludentes"):
                    if ref.get(k):
                        base[k] = ref[k]
    except Exception as e:
        if avisos is not None:
            avisos.append({"tipo": "interpretacao_falhou",
                           "detalhe": f"{type(e).__name__}: {e}"[:200]})
    return base


# ══════════════════════════════════════════════════════════════════════════════
# CONFIG EM RUNTIME (Fases 2/3/4) — roteamento vertical, faixas de preço e marcas
# importadas vivem em config_kist (editáveis SEM redeploy). Fallback embutido: se a
# config sumir, o motor não perde as regras críticas. Mesmo padrão do excludentes.
# ══════════════════════════════════════════════════════════════════════════════

# Vertical -> palavras-chave (kw, regex/substring) + domínios preferidos (ordem =
# prioridade). Minerado do gabarito real (blueprint §2a). fire_alarm/cftv/optica ANTES
# de modulo/cabo para o item de nicho não cair no genérico. Ordem do dict importa.
_ROTEAMENTO_FALLBACK = {
    "fire_alarm":      {"kw": ["notifire","notifier","kidde","edwards","vigilant","simplex",
                               "acionador manual endere","gsa-","ki-osd","ki-sb","ki-hrd",
                               "fmm-","fcm-","frm-","siga-","detector.*(fumaca|calor|temperatura).*(intelig|endere)"],
                        "dominios": ["mercadolivre.com.br","medsegsolucoes.com.br","ghtech.com.br"]},
    "cftv":            {"kw": ["camera","câmera","balun","dvr","nvr","vipc","vhd","xas","cftv",
                               "domo","bullet","full color","sensor magnetico","botao de saida"],
                        "dominios": ["loja.digitalsat.com.br","mercadolivre.com.br"]},
    "optica":          {"kw": ["optic","óptic","fibra","dio ","sc/apc","lc/apc","acoplador",
                               "fibersul","cfoa","24fo","patch cord optic","monomodo"],
                        "dominios": ["dimensional.com.br","sawasul.com.br","santil.com.br","mercadolivre.com.br"]},
    "rack_infra":      {"kw": ["rack","bastidor","bandeja","regua.*tomada","calha.*rack"," 1u",
                               "gabinete","outdoor","patch panel","guia de cabo","chassi"],
                        "dominios": ["dimensional.com.br","santil.com.br","mercadolivre.com.br"]},
    "dps":             {"kw": ["dps","surto","clamper","protetor de surto"],
                        "dominios": ["lojaclamper.com.br","mercadolivre.com.br","dimensional.com.br"]},
    "cabo":            {"kw": ["cabo","coaxial","rg6","rg59","utp","ftp","cat5","cat6","flexivel","flexível"],
                        "dominios": ["cirilocabos.com.br","lojaeletrica.com.br","mercadolivre.com.br"]},
    "disjuntor":       {"kw": ["disjuntor","contator","minidisjuntor"],
                        "dominios": ["mercadolivre.com.br","superproatacado.com.br","dimensional.com.br"]},
    "modulo_eletrico": {"kw": ["tomada","interruptor","modulo","módulo","placa","pial","legrand",
                               "dimmer","espelho","suporte 4x2","611","615","618","675"],
                        "dominios": ["mercadolivre.com.br","dimensional.com.br","lina.com.br","lojaeletrica.com.br"]},
    "hd_storage":      {"kw": ["hd ","disco rigido","disco rígido","wd purple","purple","ssd",
                               "seagate","western digital","wd10","wd22","wd42","wd63","wd84","wd85","wd101"],
                        "dominios": ["mercadolivre.com.br","loja.digitalsat.com.br"]},
    "ferramenta":      {"kw": ["furadeira","parafusadeira","broca","alicate","ferramenta","serra"],
                        "dominios": ["lfmaquinaseferramentas.com.br","dutramaquinas.com.br","mercadolivre.com.br"]},
    "energia":         {"kw": ["bateria","fonte","nobreak","no-break","carregador","estacionaria","vrla"],
                        "dominios": ["mercadolivre.com.br","dimensional.com.br"]},
    "comum":           {"kw": [], "dominios": ["mercadolivre.com.br","amazon.com.br"]},
}

# Piso de preço por vertical (Fase 3), derivado do p10 de preco_custo do histórico.
# Preço achado ABAIXO do piso + item com "sinal premium" => suspeito (genérico barato
# no lugar do item certo). NÃO bloqueia: marca "revisar" e não conta como validado.
_FAIXAS_FALLBACK = {
    "fire_alarm": 90.0, "hd_storage": 300.0, "cftv": 10.0, "optica": 0.5,
    "rack_infra": 8.0, "dps": 30.0, "disjuntor": 5.0, "cabo": 1.0,
    "modulo_eletrico": 2.0, "energia": 5.0, "ferramenta": 3.0, "comum": 0.0,
}

# Sinais de "item premium/identidade" por vertical: só com um destes no texto o piso
# marca suspeito (evita flag em acessório barato legítimo, ex.: base de detector R$38).
_SINAIS_PREMIUM = {
    "fire_alarm": ["endere","intelig","dupla ac","dupla aç","notif","kidde","edwards",
                   "vigilant","simplex","gsa-","fmm-","fcm-","frm-","siga-"],
    "hd_storage": ["purple","surveillance","western digital","wd"],
    "cftv":       ["full color","intelig","vipc"],
    "optica":     ["apc","monomodo"],
}

# Marcas/linhas ESTRANGEIRAS sem varejo BR comum => elegível à rota importado (Fase 4).
# Kidde DETECTOR (KI-*) é nacional na ML — NÃO entra; só linhas de módulo GSA/FMM/FCM/
# FRM/SIGA e marcas de rede estrangeiras.
_MARCAS_IMPORTADAS_FALLBACK = [
    "notifier","notifire","edwards","vigilant","kentec",
    "gsa-","fmm-","fcm-","frm-","siga-",
    "fortinet","fortigate","zyxel","grandstream","eizo",
]


def _carregar_cfg(sb, chave: str, fallback):
    """Lê config_kist[chave] (jsonb/texto) em runtime; fallback embutido se ausente."""
    if sb is None:
        return fallback
    try:
        r = sb.table("config_kist").select("valor").eq("chave", chave).limit(1).execute()
        if r.data and r.data[0].get("valor") is not None:
            v = r.data[0]["valor"]
            if isinstance(v, str):
                try:
                    v = json.loads(v)
                except Exception:
                    return v or fallback   # excludentes é texto puro
            return v or fallback
    except Exception:
        pass
    return fallback


def _classificar_vertical(perfil: dict, rot: dict) -> str:
    """Vertical do item por palavra-chave (desc+consulta+specs+categoria). Determinístico,
    sem IA. Primeira vertical cujo kw casa vence (ordem do dict); senão 'comum'."""
    txt = " ".join(str(perfil.get(k) or "") for k in
                   ("descricao", "consulta", "specs", "categoria")).lower()
    for vert, cfg in (rot or {}).items():
        if vert == "comum":
            continue
        for kw in (cfg.get("kw") or []):
            try:
                if re.search(kw, txt):
                    return vert
            except re.error:
                if kw in txt:
                    return vert
    return "comum"


def _eh_importado(perfil: dict, marcas: list) -> bool:
    """Item de marca/linha estrangeira sem varejo BR comum (elegível à rota importado)."""
    if perfil.get("importado"):
        return True
    txt = " ".join(str(perfil.get(k) or "") for k in
                   ("descricao", "consulta", "specs", "fabricante", "mpn")).lower()
    return any(str(m).lower() in txt for m in (marcas or []))


# ── Registry ──────────────────────────────────────────────────────────────────
def montar_registry() -> dict:
    """Providers disponíveis. Cada um dorme se falta credencial (SERPAPI_KEY). Os
    importados (Fase 4) reusam o SerpApi google + câmbio — sem chave nova."""
    return {
        "serpapi":    SerpApiShopping(),
        "google_web": SerpApiGoogleWeb(),
        "websearch":  WebSearchAnthropic(),
        "import_mkt": SerpApiImport(),        # eBay/AliExpress via Google (Fase 4)
        "paraguai":   ComprasParaguaiWeb(),   # comprasparaguai.com.br (Fase 4)
    }


# ── Roteador: monta a cascata na ordem de prioridade, filtra por disponível ───
def _ordem_nacional(reg: dict) -> list:
    # ORDEM INVERTIDA em 22/07, com dado da rodada de 21/07: dos 7 itens refinados,
    # o Google Shopping produziu o card errado em 6 (câmera CVI no lugar de IP, NVR
    # genérico, fragmento de trilho, cordão sem polimento...) e SEMPRE com link de
    # busca inútil; o Google Web achou a PÁGINA DO PRODUTO nos fornecedores reais do
    # operador (superlight, dimensional). Ele é o buscador do operador — vem primeiro.
    # O Shopping fica de reserva (preço estruturado quando o Web não resolve), e agora
    # só entra com link de loja. Web Search (índice Anthropic) fecha como rede final.
    return [reg.get("google_web"), reg.get("serpapi"), reg.get("websearch")]


def _ordem_importada(reg: dict) -> list:
    # Marketplace importado (eBay/AliExpress) -> ComprasParaguai.
    return [reg.get("import_mkt"), reg.get("paraguai")]


def rotear(perfil: dict, reg: dict) -> tuple:
    """Devolve (cascata_nacional, cascata_importada), filtradas por configurado()/
    atende(). Ambas sempre construídas; QUANDO rodar a importada é decisão da cascata
    (regra do Leonardo: tenta nacional, escala pra fora se não validar)."""
    nac = [p for p in _ordem_nacional(reg) if p and p.configurado() and p.atende(perfil)]
    imp = [p for p in _ordem_importada(reg) if p and p.configurado() and p.atende(perfil)]
    return nac, imp


# ── Julgamento: Sonnet decide identidade e agrupa por apresentação ────────────
SYSTEM_JULGAR = """Você recebe o PEDIDO de um cliente e CANDIDATOS de preço achados na internet. Você trabalha para uma revenda B2B de telecom/energia.

Decida quais candidatos são O MESMO produto pedido — mesmo fabricante (quando indicado), mesma categoria, mesma dimensão/bitola. Divergiu em qualquer um => NÃO é o mesmo, descarte.

ATRIBUTOS EXCLUDENTES (divergiu = NÃO é o mesmo, mesmo que o preço bata):
- Disjuntor: número de POLOS (mono ≠ bi ≠ tri), amperagem, curva.
- Tomada/módulo: a COR pode ser corrente (vermelho = 20A) — cor diferente pode ser item diferente.
- Óptica: conector/polimento (APC ≠ UPC; verde = APC), modo (SM ≠ MM), nº de fibras.
- Cabo de rede: tipo (UTP ≠ FTP) e categoria (Cat6 ≠ Cat5e). Cabo elétrico: bitola (mm²).

CUIDADO COM O GENÉRICO BARATO: se o pedido é um item PROFISSIONAL/ENDEREÇÁVEL/de linha específica (ex.: acionador/detector/módulo ENDEREÇÁVEL de alarme de incêndio, marca Kidde/Notifier/Edwards) e o candidato é claramente uma versão GENÉRICA/residencial muito mais barata, NÃO é o mesmo — descarte. Um módulo de incêndio endereçável não custa R$ 15.

REGRA DE OURO — NÃO CONFIRMÁVEL ≠ CONFIRMADO: quando o cliente informa um atributo (IP, APC, FTP, bipolar, 20A, SM, Cat6, marca/modelo), o candidato só é "o mesmo" se aquele atributo aparecer EXPLÍCITO no título/trecho do candidato. Se o anúncio não declara o atributo, ou não dá para identificar fabricante/modelo em item profissional, ele NÃO entra — ausência de informação nunca conta como coincidência. Mostrar menos e certo é melhor que carimbar barato e errado.
Casos reais que essa regra evita: cliente pediu câmera "IP" e veio uma HD/CVI (analógica) de R$ 90; cliente pediu cordão óptico "APC" e veio um anúncio sem polimento declarado; cliente pediu NVR "Hikvision" e veio NVR genérico.

MARCA: se o cliente CITOU a marca, candidato de outra marca ou sem marca declarada é descartado. Se o cliente NÃO citou marca, não imponha nenhuma — qualquer marca serve desde que cumpra as specs, e vence o melhor custo-benefício ENTRE OS QUE CUMPREM (não o mais barato da lista).

O QUE SERVE × O QUE NÃO SERVE: descarte fragmento, amostra, miniatura ou peça de prototipagem quando o pedido é de obra (ex.: "trilho DIN" se vende em barra de 1m/2m — um pedaço de poucos centímetros não atende). Entre variantes que TODAS servem (ex.: haste de aterramento 1,2m e 2,4m, quando o cliente não especificou), todas são válidas e vence a mais barata.

Agrupe os que sobraram por APRESENTAÇÃO comercial (metro, caixa/bobina, unidade). Em cada apresentação, escolha o de MENOR preço.

Devolva JSON — sem markdown, sem ```:
{
  "apresentacoes": [
    {"apresentacao":"caixa","preco_brl":489.90,"fonte":"Google Shopping","seller":"LojaX","url":"https://...","obs":"305m"}
  ],
  "resumo": "uma linha sobre o que encontrou"
}

Se NENHUM candidato for o mesmo produto: {"apresentacoes": [], "resumo": "não encontrei o mesmo item"}.

Se você RECONHECE o mesmo produto mas NENHUM candidato tem preço (só página de fabricante, marca, ou "sob consulta"): devolva UMA apresentação com "preco_brl": null, a url do fabricante/página do produto, "seller" o nome do fabricante e "obs": "sob consulta". É o "achei o item, cote direto" — melhor que dizer que não achou.
Nunca invente preço, fonte ou url — use só o que veio nos candidatos."""


def julgar(perfil: dict, candidatos: list, ctx: dict) -> dict:
    """Sonnet filtra por identidade e agrupa por apresentação. Enriqulece cada
    apresentação escolhida com tipo_preco/origem_tipo/cotação da fonte original
    (para a ficha mostrar varejo/atacado e a conta de importação)."""
    claude = (ctx or {}).get("claude")
    vazio = {"apresentacoes": [], "resumo": ""}
    if not candidatos:
        return vazio

    # indexa candidatos por url para recuperar os campos de origem depois do julgamento
    por_url = {}
    linhas = []
    for c in candidatos:
        u = c.get("url") or f"#{len(linhas)}"
        por_url[u] = c
        linhas.append(
            f"- apresentacao={c.get('apresentacao') or '?'} | preco_brl={c.get('preco_brl')} "
            f"| fonte={c.get('fonte_nome')} | seller={c.get('seller')} | url={u} "
            f"| titulo={(c.get('titulo') or '')[:80]}"
        )

    if claude is None:
        # Sem IA: não julga identidade; devolve o melhor por apresentação, cru.
        return _agrupar_sem_ia(candidatos)

    pedido = (f"PEDIDO:\n  Descrição: {perfil.get('descricao')}\n"
              f"  Specs: {perfil.get('specs') or '(não informou)'}\n"
              f"  Fabricante: {perfil.get('fabricante') or '(?)'} | MPN: {perfil.get('mpn') or '(?)'}\n"
              f"  Apresentação desejada: {perfil.get('apresentacao_desejada')}\n\n"
              f"CANDIDATOS:\n" + "\n".join(linhas))
    # injeta o mapa de excludentes em RUNTIME (config_kist['excludentes_matching']),
    # o mesmo que o matcher do banco usa — o juiz da internet passa a aplicar as
    # mesmas regras de "o que não pode divergir" por categoria.
    sys_julgar = SYSTEM_JULGAR
    exc = (ctx or {}).get("excludentes")
    if exc:
        sys_julgar = SYSTEM_JULGAR + "\n\nEXCLUDENTES POR CATEGORIA (config da operação):\n" + str(exc)
    try:
        resp = claude.messages.create(
            model="claude-sonnet-4-6", max_tokens=1200,
            system=sys_julgar,
            messages=[{"role": "user", "content": pedido}],
            temperature=0.0, timeout=60.0,
        )
        txt = resp.content[0].text.strip()
        txt = re.sub(r'^```(?:json)?\s*', '', txt); txt = re.sub(r'\s*```$', '', txt.strip())
        out = json.loads(txt)
    except Exception:
        return _agrupar_sem_ia(candidatos)

    # enriquece cada apresentação com os metadados da fonte (varejo/atacado, conta importação)
    for ap in (out.get("apresentacoes") or []):
        src = por_url.get(ap.get("url"))
        if src:
            # `titulo` e `mpn_detectado` entram para AUDITORIA: na revisão de 21/07 o
            # operador não conseguiu dizer o que a engine tinha proposto, porque a
            # ficha guardava só preço e link. Sem o título, o ciclo de refino trava.
            for campo in ("tipo_preco", "origem_tipo", "moeda_original", "preco_original",
                          "cotacao_usada", "preco_convertido_brl", "fator_importacao",
                          "preco_estimado_brl", "titulo", "mpn_detectado",
                          "disponibilidade", "preco_da_pagina"):
                ap.setdefault(campo, src.get(campo))
    return {"apresentacoes": out.get("apresentacoes") or [], "resumo": out.get("resumo") or ""}


def _agrupar_sem_ia(candidatos: list) -> dict:
    """Fallback sem IA: melhor (menor preco_brl) por apresentação, sem veredito."""
    melhor = {}
    for c in candidatos:
        ap = c.get("apresentacao") or "outro"
        p = c.get("preco_brl")
        if p is None:
            continue
        if ap not in melhor or p < melhor[ap]["preco_brl"]:
            melhor[ap] = {
                "apresentacao": ap, "preco_brl": p, "fonte": c.get("fonte_nome"),
                "seller": c.get("seller"), "url": c.get("url"), "obs": "",
                "tipo_preco": c.get("tipo_preco"), "origem_tipo": c.get("origem_tipo"),
                "moeda_original": c.get("moeda_original"), "preco_original": c.get("preco_original"),
                "cotacao_usada": c.get("cotacao_usada"),
                "preco_convertido_brl": c.get("preco_convertido_brl"),
                "fator_importacao": c.get("fator_importacao"),
                "preco_estimado_brl": c.get("preco_estimado_brl"),
            }
    if not melhor:
        # Nada com preço, mas achou o item em algum lugar (link) => sob consulta.
        for c in candidatos:
            if (c.get("url") or "").strip():
                return {"apresentacoes": [{
                    "apresentacao": "sob consulta", "preco_brl": None,
                    "fonte": c.get("fonte_nome"), "seller": c.get("seller"),
                    "url": c.get("url"), "obs": "sob consulta",
                }], "resumo": "item achado, sem preço público"}
    return {"apresentacoes": list(melhor.values()),
            "resumo": "(sem IA de julgamento — melhor por apresentação)"}


# ── Validador de magnitude (Fase 3) ──────────────────────────────────────────
def _validar_magnitude(perfil: dict, ficha: dict, faixas: dict) -> dict:
    """Marca `suspeito` na apresentação cujo preço está ABAIXO do piso da vertical
    E o item tem "sinal premium" (endereçável, marca de incêndio, purple...). Não
    remove nada — o operador vê tudo; só define `achou_validado` (métrica honesta) e
    escreve um aviso na obs. Item sem preço (sob consulta) não é suspeito de magnitude."""
    vertical = perfil.get("vertical") or "comum"
    piso = 0.0
    try:
        piso = float((faixas or {}).get(vertical) or 0.0)
    except (TypeError, ValueError):
        piso = 0.0
    sinais = _SINAIS_PREMIUM.get(vertical, [])
    txt = " ".join(str(perfil.get(k) or "") for k in
                   ("descricao", "consulta", "specs", "mpn")).lower()
    tem_sinal = any(s in txt for s in sinais) if sinais else False

    aps = ficha.get("apresentacoes") or []
    algum_ok = False
    for ap in aps:
        p = ap.get("preco_brl")
        if p is None:
            ap["suspeito"] = False           # sob consulta: identidade achada, não é magnitude
            algum_ok = True
            continue
        try:
            suspeito = bool(piso and tem_sinal and float(p) < piso)
        except (TypeError, ValueError):
            suspeito = False
        ap["suspeito"] = suspeito
        if suspeito:
            aviso = (f"⚠ R$ {float(p):.2f} abaixo do piso da vertical "
                     f"(R$ {piso:.0f}) — pode ser genérico, revisar")
            ap["obs"] = (f"{ap.get('obs')} · {aviso}").strip(" ·") if ap.get("obs") else aviso
        else:
            algum_ok = True
    ficha["achou"] = bool(aps)
    ficha["achou_validado"] = bool(aps) and algum_ok
    ficha["vertical"] = vertical
    return ficha


def _melhor_ficha(a: dict, b: dict) -> dict:
    """Escolhe entre a ficha nacional (a) e a importada (b). Prioriza VALIDADA; depois
    a que tem apresentação com preço; empate => mantém a nacional (varejo BR primeiro)."""
    if not a or not a.get("apresentacoes"):
        return b or a
    if not b or not b.get("apresentacoes"):
        return a
    if a.get("achou_validado") and not b.get("achou_validado"):
        return a
    if b.get("achou_validado") and not a.get("achou_validado"):
        return b
    def _tem_preco(f):
        return any(ap.get("preco_brl") is not None for ap in (f.get("apresentacoes") or []))
    if _tem_preco(a):
        return a
    if _tem_preco(b):
        return b
    return a


# ── Cascata: roteia por vertical, valida magnitude, escala pro importado ──────
def buscar_cascata(perfil: dict, reg: dict, ctx: dict) -> dict:
    """Fase 1 já entregou a `consulta` (crua ou interpretada). Aqui:
      • Fase 2: classifica a vertical e injeta os domínios preferidos no perfil (os
        providers web escopam a busca no distribuidor certo).
      • Roda a cascata NACIONAL, julga (com excludentes) e VALIDA a magnitude (Fase 3).
      • Fase 4: se não VALIDOU no BR (nada, ou só suspeito), escala pra cascata
        IMPORTADA (eBay/AliExpress/Paraguai) e fica com a melhor ficha.
    Uma linha de telemetria por fonte tentada; nunca levanta."""
    rot    = (ctx or {}).get("rot_cfg") or _ROTEAMENTO_FALLBACK
    faixas = (ctx or {}).get("faixas")  or _FAIXAS_FALLBACK
    marcas = (ctx or {}).get("marcas")  or _MARCAS_IMPORTADAS_FALLBACK

    vertical = _classificar_vertical(perfil, rot)
    perfil["vertical"] = vertical
    perfil["dominios_preferidos"] = (rot.get(vertical) or {}).get("dominios") or []
    importado_elig = _eh_importado(perfil, marcas)

    nac, imp = rotear(perfil, reg)
    telemetria = []

    def _tentar(cascata, bloco):
        for prov in cascata:
            t0 = time.time()
            cands = prov.buscar(perfil, ctx)
            rt = {"fonte": prov.nome, "bloco": bloco, "n_brutos": len(cands),
                  "ms": int((time.time() - t0) * 1000)}
            if cands:
                f = julgar(perfil, cands, ctx)
                rt["n_apresentacoes"] = len(f.get("apresentacoes") or [])
                telemetria.append(rt)
                if f.get("apresentacoes"):
                    f["fonte_resolveu"] = prov.nome
                    return f
            else:
                rt["n_apresentacoes"] = 0
                telemetria.append(rt)
        return None

    # NACIONAL primeiro (varejo BR costuma ser mais barato quando existe).
    ficha = _tentar(nac, "nacional")
    if ficha:
        ficha = _validar_magnitude(perfil, ficha, faixas)

    # ESCALA pro IMPORTADO quando o BR não validou (nada, ou só suspeito) e há rota
    # importada disponível. Cobre item estrangeiro sem varejo BR (GSA/Notifier/eBay,
    # HD grande via Paraguai) e o genérico-barato que o validador reprovou.
    precisa_importar = (ficha is None) or (not ficha.get("achou_validado"))
    if precisa_importar and imp and (importado_elig or ficha is None):
        fimp = _tentar(imp, "importado")
        if fimp:
            fimp = _validar_magnitude(perfil, fimp, faixas)
            ficha = _melhor_ficha(ficha, fimp)

    if ficha is None:
        ficha = {"apresentacoes": [], "resumo": "nada encontrado",
                 "fonte_resolveu": None, "achou": False, "achou_validado": False}

    ficha["telemetria"] = telemetria
    ficha["vertical"] = vertical
    ficha["importado_elegivel"] = importado_elig
    ficha["perfil"] = {k: perfil.get(k) for k in
                       ("consulta", "mpn", "fabricante", "categoria",
                        "apresentacao_desejada", "importado", "vertical")}
    return ficha


# ══════════════════════════════════════════════════════════════════════════════
# BLOCO 4 — Camada 2 (cache de fichas + TTL), telemetria e orquestrador
# ══════════════════════════════════════════════════════════════════════════════

def _idade_horas(ts) -> float:
    """Horas desde o timestamp ISO da captura. Sem data => 'infinito' (força refresh)."""
    if not ts:
        return 1e9
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0
    except Exception:
        return 1e9


def salvar_ficha(perfil: dict, apresentacoes: list, sb) -> None:
    """Persiste as apresentações em fichas_mercado (uma linha cada) — vira camada 2
    na próxima vez. Antes de inserir, APOSENTA as fichas anteriores da mesma busca
    (revalidação substitui, não acumula). Falha ao salvar nunca derruba o fluxo."""
    if not apresentacoes or sb is None:
        return
    termo = (perfil.get("consulta") or perfil.get("descricao") or "").strip()
    if not termo:
        return
    rows = []
    for ap in apresentacoes:
        rows.append({
            "descricao_busca": termo,
            "mpn":         perfil.get("mpn") or None,
            "fabricante":  perfil.get("fabricante") or None,
            "categoria":   perfil.get("categoria") or None,
            "apresentacao": ap.get("apresentacao"),
            "preco":       ap.get("preco_original"),
            "moeda":       ap.get("moeda_original") or "BRL",
            "preco_brl":   ap.get("preco_brl") if ap.get("preco_brl") is not None else ap.get("preco_estimado_brl"),
            "tipo_preco":  ap.get("tipo_preco"),
            "origem_tipo": ap.get("origem_tipo"),
            "fonte_nome":  ap.get("fonte"),
            "fonte_url":   ap.get("url"),
            "seller":      ap.get("seller"),
            "veredito":    ap.get("veredito") or "mesmo",
            "detalhe":     ap,     # jsonb: guarda a conta de importação inteira
        })
    try:
        sb.table("fichas_mercado").update({"origem_morta": True}).eq("descricao_busca", termo).execute()
        sb.table("fichas_mercado").insert(rows).execute()
    except Exception:
        pass


def buscar_camada2(perfil: dict, sb):
    """Ficha viva similar? Devolve (apresentacoes, idade_mais_velha_horas) ou (None, None).
    Melhor (menor preço) por apresentação, do grupo mais similar. Quem decide se a
    idade serve (< TTL) é o orquestrador."""
    if sb is None:
        return None, None
    termo = (perfil.get("consulta") or perfil.get("descricao") or "").strip()
    if not termo:
        return None, None
    try:
        r = sb.rpc("buscar_fichas_similares", {"termo": termo, "min_sim": 0.35, "lim": 30}).execute()
        rows = r.data or []
    except Exception:
        return None, None
    if not rows:
        return None, None

    alvo = rows[0]["descricao_busca"]           # grupo mais similar
    melhor, mais_velha = {}, 0.0
    for x in rows:
        if x.get("descricao_busca") != alvo:
            continue
        p = x.get("preco_brl")
        if p is None:
            continue
        ap = x.get("apresentacao") or "outro"
        mais_velha = max(mais_velha, _idade_horas(x.get("capturado_em")))
        if ap not in melhor or p < melhor[ap]["preco_brl"]:
            det = dict(x.get("detalhe") or {})
            det.update({
                "apresentacao": ap, "preco_brl": p,
                "fonte": x.get("fonte_nome"), "url": x.get("fonte_url"),
                "tipo_preco": x.get("tipo_preco"), "origem_tipo": x.get("origem_tipo"),
            })
            melhor[ap] = det
    if not melhor:
        return None, None
    return list(melhor.values()), mais_velha


def registrar_log(sb, descricao_busca, camada, ficha, ms_total, usuario_email=None) -> None:
    """Telemetria por resolução. Alimenta o benchmark da Fase 2. Nunca derruba."""
    if sb is None:
        return
    try:
        sb.table("motor_precos_log").insert({
            "descricao_busca": descricao_busca,
            "camada":          camada,
            "fonte_resolveu":  ficha.get("fonte_resolveu"),
            "achou":           bool(ficha.get("apresentacoes")),
            "achou_validado":  bool(ficha.get("achou_validado")),
            "n_apresentacoes": len(ficha.get("apresentacoes") or []),
            "ms_total":        ms_total,
            "telemetria":      ficha.get("telemetria"),
            "usuario_email":   usuario_email,
        }).execute()
    except Exception:
        pass


def _perfil_cru(item: dict) -> dict:
    """Perfil MÍNIMO a partir da descrição CRUA do cliente — SEM IA, SEM interpretar,
    SEM inventar identificador. consulta = o que o cliente escreveu (+ as specs que
    ELE deu). É o Princípio Zero do blueprint: só o que o cliente deu. Espelha o
    shape que `interpretar()` devolve, para a cascata/julgamento/cache funcionarem
    sem mudança."""
    desc  = (item.get("descricao") or item.get("descricao_original") or "").strip()
    specs = (item.get("specs_complementares") or "").strip()
    qtd   = item.get("quantidade")
    uni   = item.get("unidade") or "UN"
    # consulta crua = descrição + specs (AMBOS dados pelo cliente). Nada inventado.
    consulta = desc
    if specs and specs.lower() not in desc.lower():
        consulta = f"{desc} {specs}".strip()
    return {
        "descricao": desc, "specs": specs, "quantidade": qtd, "unidade": uni,
        "entrada_norm": _norm_entrada(f"{desc} {specs}".strip()),
        "consulta": consulta, "mpn": "", "fabricante": "", "categoria": "",
        "atributos_excludentes": {}, "apresentacao_desejada": "indiferente",
        "importado": False, "confianca": "media", "conferiu_web": False,
    }


def _entrada_pobre(perfil: dict) -> bool:
    """Entrada curta demais para buscar literal: <=3 palavras E sem specs.
    Medido em 21/07: 'Trilho Dim' e 'Cordão optco APC' — nesses a busca crua devolve
    o resultado mais barato que casou as palavras, não o item. Já 'DPS Classe II,
    1 Pólo, Uc 275VAC' (com specs) a crua acertou de primeira."""
    desc  = (perfil.get("descricao") or "").strip()
    specs = (perfil.get("specs") or "").strip()
    if specs:
        return False
    return len([p for p in re.split(r"\s+", desc) if p]) <= 3


def _passada(perfil: dict, reg: dict, ctx: dict, sb) -> dict:
    """Uma passada de resolução para UM perfil: camada 2 (cache vivo < TTL) e, se
    não servir, camada 3 (cascata de descoberta). NÃO loga e NÃO persiste — quem
    decide salvar/logar é o orquestrador (uma linha de log por chamada do motor).
    Devolve sempre uma ficha (apresentacoes podem vir vazias)."""
    # ── camada 2 — ficha viva e fresca serve direto ──────────────────────────
    aps2, mais_velha = buscar_camada2(perfil, sb)
    if aps2 and mais_velha is not None and mais_velha < FICHA_TTL_HORAS:
        return {
            "apresentacoes": aps2,
            "resumo": "cache (camada 2)",
            "fonte_resolveu": "cache",
            "camada": 2,
            "idade_horas": round(mais_velha, 1),
            "perfil": {k: perfil.get(k) for k in
                       ("consulta", "mpn", "fabricante", "categoria",
                        "apresentacao_desejada", "importado")},
            "telemetria": [{"fonte": "cache", "bloco": "camada2",
                            "idade_horas": round(mais_velha, 1)}],
        }
    # ── camada 3 — descoberta (cascata + julgamento) ─────────────────────────
    ficha = buscar_cascata(perfil, reg, ctx)
    ficha["camada"] = 3
    return ficha


def resolver_ficha(item: dict, sb, claude, usuario_email: str = None,
                   cnpj: str = None, termo_rebusca: str = None) -> dict:
    """ORQUESTRADOR do motor. Percorre camada 2 -> camada 3, em DUAS PASSADAS.

    A CAMADA 1 (banco de preços) NÃO é aqui — é o matching existente do /extrair.
    O motor só é chamado para itens SEM match no banco.

    FRENTE 1 — CRUA PRIMEIRO (decisão do Leonardo, blueprint 20/07):
      1) PASSA CRUA: busca com a descrição do cliente COMO ELE ESCREVEU (+ specs que
         ele deu), SEM interpretar e SEM inventar identificador. É rápida, barata e
         não tem como alucinar MPN — a maioria dos itens (commodity, cabo, patch,
         bobina) resolve aqui.
      2) SÓ SE A CRUA NÃO ACHAR: interpreta (Sonnet, com a regra de NÃO inventar) e
         re-busca. É o caminho do item cifrado (ex.: W50 da Womer) — caro e raro,
         por isso é o último recurso, não o padrão. Também derruba a latência: a
         interpretação pesada (2 chamadas Sonnet) some do caminho comum.

    `termo_rebusca`: o operador reescreveu o termo (correção implícita, sinal forte)
      => usa o termo DELE direto (nem crua nem interpretação) e ensina a memória.
    `cnpj`: âncora do nó da internet (registra o acerto quando resolve).

    Sempre UMA linha em motor_precos_log por chamada. A telemetria carrega a `etapa`
    (crua | interpretada | reescrita | cache) para o monitoramento medir a verdade —
    quanto resolve na crua vs. quanto precisa de interpretação.
    """
    t0 = time.time()
    ctx = {
        "claude": claude, "sb": sb,
        "rot_cfg":     _carregar_cfg(sb, "roteamento_vertical",   _ROTEAMENTO_FALLBACK),
        "faixas":      _carregar_cfg(sb, "faixas_preco_vertical", _FAIXAS_FALLBACK),
        "marcas":      _carregar_cfg(sb, "marcas_importadas",     _MARCAS_IMPORTADAS_FALLBACK),
        "excludentes": _carregar_cfg(sb, "excludentes_matching",  ""),
    }
    reg = montar_registry()

    def _ms():
        return int((time.time() - t0) * 1000)

    def _entregar(perfil, ficha, etapa):
        """Persiste (só camada 3 com resultado), loga UMA vez e devolve a ficha."""
        ficha["etapa"] = etapa
        if ficha.get("apresentacoes") and ficha.get("camada") == 3:
            salvar_ficha(perfil, ficha["apresentacoes"], sb)   # vira camada 2 futura
        registrar_log(sb, perfil.get("consulta") or perfil.get("descricao"),
                      ficha.get("camada", 3), ficha, _ms(), usuario_email)
        return ficha

    # ── CAMINHO 0 — operador REESCREVEU o termo (sinal forte). Usa o dele. ─────
    if (termo_rebusca or "").strip():
        perfil = interpretar(item, claude, sb=sb)   # herda entrada_norm/specs/excludentes
        aprender_correcao_reescrita(sb, perfil.get("entrada_norm"), termo_rebusca, claude)
        perfil["consulta"] = termo_rebusca.strip()
        ficha = _passada(perfil, reg, ctx, sb)
        return _entregar(perfil, ficha, "reescrita")

    # ── PASSA 1 — CRUA (descrição do cliente, sem IA, sem inventar) ───────────
    perfil_cru = _perfil_cru(item)

    # EXCEÇÃO (refino 21/07): ENTRADA POBRE não rende busca literal. "Trilho Dim"
    # (2 palavras, typo de DIN) trouxe um fragmento de trilho de R$3,78 de loja de
    # eletrônica; "Cordão optco APC" trouxe anúncio sem polimento declarado. Quando o
    # cliente escreve pouquíssimo e sem specs, o texto cru não tem o que ancorar —
    # interpretar PRIMEIRO (corrige o termo técnico) vale mais que buscar literal.
    # Entrada rica continua na crua, que é rápida e barata e funciona (caso do DPS,
    # que a engine acertou com 1 centavo de diferença).
    if _entrada_pobre(perfil_cru):
        perfil_int = interpretar(item, claude, sb=sb)
        ficha_int = _passada(perfil_int, reg, ctx, sb)
        if ficha_int.get("apresentacoes"):
            return _entregar(perfil_int, ficha_int, "interpretada_entrada_pobre")
        # interpretação não achou: a crua ainda é a rede de segurança
        ficha_cru = _passada(perfil_cru, reg, ctx, sb)
        return _entregar(perfil_cru, ficha_cru, "crua_apos_entrada_pobre")

    ficha_cru = _passada(perfil_cru, reg, ctx, sb)
    if ficha_cru.get("apresentacoes"):
        return _entregar(perfil_cru, ficha_cru, "crua")

    # guarda a telemetria da crua p/ juntar no log final (visibilidade num registro só)
    tel_crua = [{"etapa": "crua", **t} for t in (ficha_cru.get("telemetria") or [])]

    # ── PASSA 2 — FALLBACK: crua não achou => interpreta (sem inventar) e re-busca ─
    perfil_int = interpretar(item, claude, sb=sb)
    mudou = (_norm_entrada(perfil_int.get("consulta") or "")
             != _norm_entrada(perfil_cru.get("consulta") or ""))
    if mudou:
        ficha = _passada(perfil_int, reg, ctx, sb)
    else:
        # interpretação não mudou o termo => re-buscar seria repetir a crua. Não gasta.
        ficha = {"apresentacoes": [], "camada": 3, "fonte_resolveu": None,
                 "resumo": "crua não achou; interpretação não mudou o termo",
                 "telemetria": []}

    # junta a telemetria das duas passadas num log só
    ficha["telemetria"] = tel_crua + [{"etapa": "interpretada", **t}
                                       for t in (ficha.get("telemetria") or [])]
    etapa = "interpretada" if ficha.get("apresentacoes") else "crua+interpretada_sem_resultado"
    return _entregar(perfil_int, ficha, etapa)


# ══════════════════════════════════════════════════════════════════════════════
# BLOCO 5 (motor) — Aprendizado: nó da internet + memória de interpretação
# ══════════════════════════════════════════════════════════════════════════════

# ── Nó de resultado por CNPJ (memoria_internet) ───────────────────────────────
def aprender_no_internet(sb, entrada_norm: str, cnpj: str, origem: dict) -> None:
    """Grava/reforça o nó "(CNPJ + input) -> internet, esta origem". Chamado no
    /upsert-precos quando origem_escolha='internet'. Sem CNPJ, não grava (o nó
    fica sem âncora — coerente com 'na dúvida, não aprende')."""
    if sb is None or not entrada_norm or not (cnpj or "").strip():
        return
    try:
        ex = sb.table("memoria_internet").select("id,acertos") \
               .eq("entrada_norm", entrada_norm).eq("cnpj", cnpj).limit(1).execute()
        if ex.data:
            sb.table("memoria_internet").update({
                "acertos": (ex.data[0].get("acertos") or 0) + 1,
                "origem": origem, "ultima_vez": datetime.now(timezone.utc).isoformat()
            }).eq("id", ex.data[0]["id"]).execute()
        else:
            sb.table("memoria_internet").insert({
                "entrada_norm": entrada_norm, "cnpj": cnpj, "origem": origem
            }).execute()
    except Exception:
        pass


def tem_no_internet(sb, entrada: str, cnpj: str):
    """Consulta o nó por (CNPJ + input similar). Usado pelo /extrair para marcar
    itens que devem AUTO-buscar a internet. Devolve a origem aprendida ou None."""
    if sb is None or not (entrada or "").strip() or not (cnpj or "").strip():
        return None
    try:
        r = sb.rpc("memoria_internet_match",
                   {"termo": entrada, "cnpj_in": cnpj, "min_sim": 0.45}).execute()
        rows = r.data or []
        return rows[0].get("origem") if rows else None
    except Exception:
        return None


# ── Memória de interpretação (global) ─────────────────────────────────────────
def aprender_interpretacao(sb, entrada_norm: str, interpretacao: dict) -> None:
    """Grava/reforça 'input deste tipo se entende assim' (memoria_interpretacao)."""
    if sb is None or not entrada_norm or not interpretacao:
        return
    try:
        ex = sb.table("memoria_interpretacao").select("id,acertos") \
               .eq("entrada_norm", entrada_norm).limit(1).execute()
        if ex.data:
            sb.table("memoria_interpretacao").update({
                "interpretacao": interpretacao,
                "acertos": (ex.data[0].get("acertos") or 0) + 1,
                "ultima_vez": datetime.now(timezone.utc).isoformat()
            }).eq("id", ex.data[0]["id"]).execute()
        else:
            sb.table("memoria_interpretacao").insert({
                "entrada_norm": entrada_norm, "interpretacao": interpretacao
            }).execute()
    except Exception:
        pass


def aprender_correcao_reescrita(sb, entrada_norm_original: str, termo_reescrito: str, claude) -> None:
    """Sinal FORTE: o operador reescreveu o termo. Interpreta o termo reescrito
    (o que ele quis dizer) e grava como a interpretação certa do input ORIGINAL —
    assim, input parecido ao original já sai interpretado como o operador ensinou."""
    if sb is None or not entrada_norm_original or not (termo_reescrito or "").strip():
        return
    interp = interpretar({"descricao": termo_reescrito}, claude, sb=sb)
    correta = {k: interp.get(k) for k in
               ("consulta", "fabricante", "mpn", "categoria", "atributos_excludentes",
                "apresentacao_desejada")}
    correta["origem_correcao"] = "reescrita_operador"
    aprender_interpretacao(sb, entrada_norm_original, correta)


# ══════════════════════════════════════════════════════════════════════════════
# BLOCO 6 (motor) — Google Web: a busca web normal do Google (não o feed Shopping)
# ══════════════════════════════════════════════════════════════════════════════
# O Shopping é só o feed de produtos; item industrial de nicho (gabinete Womer,
# suporte) não está lá. Mas ESTÁ na busca web do Google — foi assim que o operador
# achou o dimensional. Este provider usa o engine 'google' do SerpApi (mesma chave)
# e deixa o Sonnet ler os resultados orgânicos e extrair preço/link.

SYSTEM_EXTRAIR_GOOGLE = """Você recebe RESULTADOS DA BUSCA WEB DO GOOGLE para um produto que uma revenda B2B de telecom/energia procura. Cada resultado tem título, link e um trecho.

Identifique quais resultados são o MESMO produto pedido — mesmo fabricante, categoria e dimensão. Para cada um que for o mesmo, extraia o PREÇO se ele aparecer no título ou no trecho, e o link da loja.

Responda APENAS JSON, sem markdown, sem ```:
{"anuncios": [
  {"titulo": "...", "preco": 2690.00, "loja": "dimensional", "url": "https://...", "apresentacao": "unidade"}
]}

Regras:
- preco: número em reais se aparecer; senão null — MAS traga o link mesmo assim (o operador quer saber onde o item está à venda).
- Prioridade: LOJAS que vendem o item (dimensional, mercadolivre, lojas de telecom/energia). Se NENHUMA loja vende, mas você encontrou a página do FABRICANTE ou do produto (ex.: o site da marca), traga esse link com preco=null e loja="(fabricante)" — o operador cota direto. É melhor que dizer que não achou.
- Ignore fóruns, PDFs de manual, e resultados que claramente não são o produto.
- Só o MESMO produto pedido. Divergiu em fabricante/categoria/dimensão, descarte.
- Nada é o mesmo => {"anuncios": []}. Nunca invente."""


class SerpApiGoogleWeb(Provider):
    """Busca WEB do Google (engine 'google'), o mesmo Google do operador. Acha a
    página do distribuidor para item de nicho que não está no feed de Shopping.
    O Sonnet lê os resultados orgânicos e extrai preço/link."""

    nome        = "Google Web"
    tipo_preco  = "varejo"
    origem_tipo = "web"

    def configurado(self) -> bool:
        return bool(SERPAPI_KEY)

    def buscar(self, perfil: dict, ctx: dict = None) -> list[dict]:
        termo = (perfil.get("consulta") or perfil.get("descricao") or "").strip()
        if not termo:
            return []

        def _fetch(q):
            params = {"engine": "google", "q": q, "gl": SERP_GL, "hl": SERP_HL,
                      "num": "10", "api_key": SERPAPI_KEY}
            try:
                return _http_get_json("https://serpapi.com/search.json?" + urllib.parse.urlencode(params))
            except Exception:
                return {}

        # Fase 2 — ESCOPA no distribuidor da vertical primeiro (ex.: CFTV=digitalsat,
        # óptica=dimensional/sawasul, DPS=clamper). Se o escopo não trouxer nada, cai
        # pra busca aberta. É como o operador procura: no fornecedor certo, não no genérico.
        doms = perfil.get("dominios_preferidos") or []
        data = {}
        if doms:
            escopo = " OR ".join(f"site:{d}" for d in doms[:4])
            data = _fetch(f"{termo} ({escopo})")
            if not (data.get("organic_results") or data.get("shopping_results")):
                data = _fetch(termo)
        else:
            data = _fetch(termo)

        linhas = []
        for r in (data.get("organic_results") or [])[:10]:
            u = r.get("link") or ""
            if not u:
                continue
            linhas.append(f"- titulo: {r.get('title') or ''}\n  link: {u}\n  trecho: {(r.get('snippet') or '')[:220]}")
        # o Google Web às vezes traz produtos com preço inline
        for r in (data.get("shopping_results") or [])[:5]:
            u = r.get("product_link") or r.get("link") or ""
            if not u:
                continue
            linhas.append(f"- titulo: {r.get('title') or ''}\n  link: {u}\n  preco: {r.get('extracted_price')}\n  loja: {r.get('source') or ''}")
        if not linhas:
            return []

        claude = (ctx or {}).get("claude")
        if claude is None:
            return []
        pedido = (f"PRODUTO PROCURADO: {perfil.get('consulta')}\n"
                  f"Fabricante: {perfil.get('fabricante') or '?'} | Categoria: {perfil.get('categoria') or '?'}\n\n"
                  f"RESULTADOS DO GOOGLE:\n" + "\n".join(linhas))
        try:
            resp = claude.messages.create(
                model="claude-sonnet-4-6", max_tokens=1200,
                system=SYSTEM_EXTRAIR_GOOGLE,
                messages=[{"role": "user", "content": pedido}],
                temperature=0.0, timeout=60.0,
            )
            txt = "\n".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
            txt = re.sub(r'^```(?:json)?\s*', '', txt); txt = re.sub(r'\s*```$', '', txt.strip())
            got = json.loads(txt)
        except Exception:
            return []

        out = []
        for a in (got.get("anuncios") or []):
            if not (a.get("url") or "").strip():
                continue
            out.append(candidato(
                fonte_nome=self.nome, tipo_preco=self.tipo_preco, origem_tipo=self.origem_tipo,
                titulo=a.get("titulo") or "", preco=a.get("preco"), moeda="BRL",
                url=a.get("url") or "", seller=a.get("loja") or "",
                apresentacao=a.get("apresentacao") or "",
            ))
        # (1) só página de produto — link de busca/lista não serve de origem;
        # (2) quem veio sem preço tem a página ABERTA para ler o preço de verdade.
        out = _so_paginas_de_produto(out)
        out = _enriquecer_precos_por_pagina(out)
        return out

# ══════════════════════════════════════════════════════════════════════════════
# BLOCO 7 (motor) — Rota IMPORTADO (Fase 4): eBay/AliExpress + ComprasParaguai
# ══════════════════════════════════════════════════════════════════════════════
# Item de marca/linha estrangeira sem varejo BR (Notifier FMM-1, módulos GSA da
# Kidde/Edwards/Vigilant, HD grande) o operador cota fora. Reusa o engine 'google'
# do SerpApi (mesma chave) escopado nos sites de importado, e o câmbio da AwesomeAPI
# + fator de importação já existentes. Sem credencial nova.

SYSTEM_EXTRAIR_IMPORT = """Você recebe RESULTADOS DE BUSCA de sites de importação (eBay, AliExpress) para um produto que uma revenda B2B de telecom/energia procura importar. Cada resultado tem título, link e trecho.

Identifique quais são o MESMO produto pedido — mesmo fabricante, modelo/part number, categoria. Para cada um que for o mesmo, extraia o PREÇO na MOEDA ORIGINAL (US$ no eBay/AliExpress US) e o link do anúncio.

Responda APENAS JSON, sem markdown, sem ```:
{"anuncios": [
  {"titulo": "...", "preco": 42.00, "moeda": "USD", "loja": "ebay", "url": "https://..."}
]}

Regras:
- preco: número na moeda original (ponto decimal). moeda: "USD" por padrão no eBay/AliExpress US.
- Se achou o item mas sem preço claro, traga o link com preco=null (o operador cota).
- Só o MESMO produto (mesmo PN/modelo). Divergiu, descarte.
- Nada é o mesmo => {"anuncios": []}. Nunca invente preço, loja ou url."""


class SerpApiImport(Provider):
    """Marketplace importado (eBay/AliExpress) via engine 'google' do SerpApi, escopado
    nos sites de importação, gl=us. O Sonnet lê e extrai preço em USD; o candidato
    carrega a conta de importação (× câmbio × fator internacional)."""

    nome        = "Importado (eBay/AliExpress)"
    tipo_preco  = "varejo"
    origem_tipo = "web"

    def configurado(self) -> bool:
        return bool(SERPAPI_KEY)

    def buscar(self, perfil: dict, ctx: dict = None) -> list[dict]:
        termo = (perfil.get("consulta") or perfil.get("descricao") or "").strip()
        if not termo:
            return []
        claude = (ctx or {}).get("claude")
        if claude is None:
            return []
        q = f"{termo} (site:ebay.com OR site:aliexpress.com)"
        params = {"engine": "google", "q": q, "gl": "us", "hl": "en",
                  "num": "10", "api_key": SERPAPI_KEY}
        try:
            data = _http_get_json("https://serpapi.com/search.json?" + urllib.parse.urlencode(params))
        except Exception:
            return []

        linhas = []
        for r in (data.get("organic_results") or [])[:10]:
            u = r.get("link") or ""
            if not u:
                continue
            linhas.append(f"- titulo: {r.get('title') or ''}\n  link: {u}\n  trecho: {(r.get('snippet') or '')[:220]}")
        for r in (data.get("shopping_results") or [])[:5]:
            u = r.get("product_link") or r.get("link") or ""
            if not u:
                continue
            linhas.append(f"- titulo: {r.get('title') or ''}\n  link: {u}\n  preco: {r.get('extracted_price')}\n  moeda: USD")
        if not linhas:
            return []

        pedido = (f"PRODUTO PROCURADO: {perfil.get('consulta')}\n"
                  f"Fabricante: {perfil.get('fabricante') or '?'} | MPN: {perfil.get('mpn') or '?'}\n\n"
                  f"RESULTADOS (importado):\n" + "\n".join(linhas))
        try:
            resp = claude.messages.create(
                model="claude-sonnet-4-6", max_tokens=1200,
                system=SYSTEM_EXTRAIR_IMPORT,
                messages=[{"role": "user", "content": pedido}],
                temperature=0.0, timeout=60.0,
            )
            txt = "\n".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
            txt = re.sub(r'^```(?:json)?\s*', '', txt); txt = re.sub(r'\s*```$', '', txt.strip())
            got = json.loads(txt)
        except Exception:
            return []

        out = []
        for a in (got.get("anuncios") or []):
            if not (a.get("url") or "").strip():
                continue
            out.append(candidato(
                fonte_nome=self.nome, tipo_preco=self.tipo_preco, origem_tipo=self.origem_tipo,
                titulo=a.get("titulo") or "", preco=a.get("preco"),
                moeda=(a.get("moeda") or "USD"),
                url=a.get("url") or "", seller=a.get("loja") or "ebay",
                fator_importacao=FATOR_IMPORT_INTERNACIONAL,
            ))
        return out


class ComprasParaguaiWeb(Provider):
    """ComprasParaguai (comprasparaguai.com.br) — site BR-facing que já mostra preço em
    R$. Reusa o engine 'google' escopado no site. Preço em BRL, fator Paraguai (×1,2)."""

    nome        = "ComprasParaguai"
    tipo_preco  = "varejo"
    origem_tipo = "web"

    def configurado(self) -> bool:
        return bool(SERPAPI_KEY)

    def buscar(self, perfil: dict, ctx: dict = None) -> list[dict]:
        termo = (perfil.get("consulta") or perfil.get("descricao") or "").strip()
        if not termo:
            return []
        claude = (ctx or {}).get("claude")
        if claude is None:
            return []
        params = {"engine": "google", "q": f"{termo} site:comprasparaguai.com.br",
                  "gl": SERP_GL, "hl": SERP_HL, "num": "10", "api_key": SERPAPI_KEY}
        try:
            data = _http_get_json("https://serpapi.com/search.json?" + urllib.parse.urlencode(params))
        except Exception:
            return []

        linhas = []
        for r in (data.get("organic_results") or [])[:10]:
            u = r.get("link") or ""
            if not u:
                continue
            linhas.append(f"- titulo: {r.get('title') or ''}\n  link: {u}\n  trecho: {(r.get('snippet') or '')[:220]}")
        for r in (data.get("shopping_results") or [])[:5]:
            u = r.get("product_link") or r.get("link") or ""
            if not u:
                continue
            linhas.append(f"- titulo: {r.get('title') or ''}\n  link: {u}\n  preco: {r.get('extracted_price')}")
        if not linhas:
            return []

        pedido = (f"PRODUTO PROCURADO: {perfil.get('consulta')}\n"
                  f"Fabricante: {perfil.get('fabricante') or '?'} | MPN: {perfil.get('mpn') or '?'}\n\n"
                  f"RESULTADOS (ComprasParaguai, preços em R$):\n" + "\n".join(linhas))
        try:
            resp = claude.messages.create(
                model="claude-sonnet-4-6", max_tokens=1000,
                system=SYSTEM_EXTRAIR_GOOGLE,
                messages=[{"role": "user", "content": pedido}],
                temperature=0.0, timeout=60.0,
            )
            txt = "\n".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
            txt = re.sub(r'^```(?:json)?\s*', '', txt); txt = re.sub(r'\s*```$', '', txt.strip())
            got = json.loads(txt)
        except Exception:
            return []

        out = []
        for a in (got.get("anuncios") or []):
            if not (a.get("url") or "").strip():
                continue
            out.append(candidato(
                fonte_nome=self.nome, tipo_preco=self.tipo_preco, origem_tipo=self.origem_tipo,
                titulo=a.get("titulo") or "", preco=a.get("preco"), moeda="BRL",
                url=a.get("url") or "", seller=a.get("loja") or "comprasparaguai",
                apresentacao=a.get("apresentacao") or "",
                fator_importacao=FATOR_IMPORT_PARAGUAI,
            ))
        return out
