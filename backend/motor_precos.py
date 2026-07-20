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
            out.append(candidato(
                fonte_nome=self.nome,
                tipo_preco=self.tipo_preco,
                origem_tipo=self.origem_tipo,
                titulo=it.get("title") or "",
                preco=preco,
                moeda="BRL",
                url=it.get("product_link") or it.get("link") or "",
                seller=it.get("source") or "",              # loja/vendedor
                disponibilidade=it.get("delivery") or "",
            ))
        return out


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
- Só o MESMO produto pedido. Na dúvida, não inclua.
- Não achou o produto certo => {"anuncios": []}. Nunca invente preço ou loja."""


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
            if a.get("preco") in (None, ""):
                continue
            out.append(candidato(
                fonte_nome=self.nome,
                tipo_preco=self.tipo_preco,
                origem_tipo=self.origem_tipo,
                titulo=a.get("titulo") or "",
                preco=a.get("preco"),
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
- Nunca invente fabricante/MPN. Vazio é melhor que errado."""


SYSTEM_CONFERIR_ITEM = """Você é um comprador técnico da Kist (telecom/energia). O item abaixo veio VAGO. Use a busca web para descobrir O QUE É — fabricante provável, part number, tipo e categoria técnica — para que a busca de preço seguinte mire o item certo.

NÃO busque preço agora; só IDENTIFIQUE o item. Devolva SOMENTE JSON, sem markdown:
{
  "consulta": "termo de busca refinado com o que você descobriu",
  "fabricante": "", "mpn": "",
  "categoria": "",
  "atributos_excludentes": {"tipo": "", "categoria_tec": "", "bitola_dim": "", "outros": ""},
  "achou_identificacao": true
}
Se a web não esclareceu, repita o melhor palpite e achou_identificacao=false. Nunca invente."""


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

        # Conferência web condicional: item incerto => descobre antes de buscar.
        if got.get("precisa_conferir") or base.get("confianca") == "baixa":
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


# ── Registry ──────────────────────────────────────────────────────────────────
def montar_registry() -> dict:
    """Providers disponíveis. Ausentes (Brave, importados) entram aqui quando
    implementados/plugados — a cascata os pega por posição, sem mudar código."""
    return {
        "serpapi":   SerpApiShopping(),
        "websearch": WebSearchAnthropic(),
        # "brave":     BraveSearch(),        # degrau 2 nacional — quando plugar a chave
        # "ebay":      EbayBrowse(),         # bloco importado — depois
        # "aliexpress":AliExpress(),
        # "paraguai":  ComprasParaguai(),
    }


# ── Roteador: monta a cascata na ordem de prioridade, filtra por disponível ───
def _ordem_nacional(reg: dict) -> list:
    # Google Shopping (estruturado) -> Brave (índice indep.) -> Web Search (Sonnet).
    return [reg.get("serpapi"), reg.get("brave"), reg.get("websearch")]


def _ordem_importada(reg: dict) -> list:
    # eBay -> AliExpress -> ComprasParaguai (todos carimbados importado).
    return [reg.get("ebay"), reg.get("aliexpress"), reg.get("paraguai")]


def rotear(perfil: dict, reg: dict) -> tuple:
    """Devolve (cascata_nacional, cascata_importada), já filtradas por
    configurado() e atende(). O bloco importado só é acionado se o nacional
    voltar vazio (regra do Leonardo: tenta aqui, se não achar, busca fora)."""
    nac = [p for p in _ordem_nacional(reg) if p and p.configurado() and p.atende(perfil)]
    imp = [p for p in _ordem_importada(reg) if p and p.configurado() and p.atende(perfil)]
    return nac, imp


# ── Julgamento: Sonnet decide identidade e agrupa por apresentação ────────────
SYSTEM_JULGAR = """Você recebe o PEDIDO de um cliente e CANDIDATOS de preço achados na internet. Você trabalha para uma revenda B2B de telecom/energia.

Decida quais candidatos são O MESMO produto pedido — mesmo fabricante (quando indicado), mesma categoria, mesma dimensão/bitola. Divergiu em qualquer um => NÃO é o mesmo, descarte.

Agrupe os que sobraram por APRESENTAÇÃO comercial (metro, caixa/bobina, unidade). Em cada apresentação, escolha o de MENOR preço.

Devolva JSON — sem markdown, sem ```:
{
  "apresentacoes": [
    {"apresentacao":"caixa","preco_brl":489.90,"fonte":"Google Shopping","seller":"LojaX","url":"https://...","obs":"305m"}
  ],
  "resumo": "uma linha sobre o que encontrou"
}

Se NENHUM candidato for o mesmo produto: {"apresentacoes": [], "resumo": "não encontrei o mesmo item"}.
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
    try:
        resp = claude.messages.create(
            model="claude-sonnet-4-6", max_tokens=1200,
            system=SYSTEM_JULGAR,
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
            for campo in ("tipo_preco", "origem_tipo", "moeda_original", "preco_original",
                          "cotacao_usada", "preco_convertido_brl", "fator_importacao",
                          "preco_estimado_brl"):
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
    return {"apresentacoes": list(melhor.values()),
            "resumo": "(sem IA de julgamento — melhor por apresentação)"}


# ── Cascata: executa em ordem, para na primeira fonte que resolve ─────────────
def buscar_cascata(perfil: dict, reg: dict, ctx: dict) -> dict:
    """Percorre a cascata nacional; para na primeira fonte cujo julgamento acha
    o MESMO item. Nacional vazio => tenta a cascata importada. Devolve a ficha
    (apresentações + resumo) mais telemetria por fonte."""
    nac, imp = rotear(perfil, reg)
    telemetria = []

    def _tentar(cascata, bloco):
        for prov in cascata:
            t0 = time.time()
            cands = prov.buscar(perfil, ctx)
            reg_tel = {"fonte": prov.nome, "bloco": bloco, "n_brutos": len(cands),
                       "ms": int((time.time() - t0) * 1000)}
            if cands:
                ficha = julgar(perfil, cands, ctx)
                reg_tel["n_apresentacoes"] = len(ficha.get("apresentacoes") or [])
                telemetria.append(reg_tel)
                if ficha.get("apresentacoes"):
                    ficha["fonte_resolveu"] = prov.nome
                    return ficha
            else:
                reg_tel["n_apresentacoes"] = 0
                telemetria.append(reg_tel)
        return None

    ficha = _tentar(nac, "nacional")
    if not ficha:
        ficha = _tentar(imp, "importado")   # só roda se houver providers importados ativos
    if not ficha:
        ficha = {"apresentacoes": [], "resumo": "nada encontrado", "fonte_resolveu": None}

    ficha["telemetria"] = telemetria
    ficha["perfil"] = {k: perfil.get(k) for k in
                       ("consulta", "mpn", "fabricante", "categoria",
                        "apresentacao_desejada", "importado")}
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
            "n_apresentacoes": len(ficha.get("apresentacoes") or []),
            "ms_total":        ms_total,
            "telemetria":      ficha.get("telemetria"),
            "usuario_email":   usuario_email,
        }).execute()
    except Exception:
        pass


def resolver_ficha(item: dict, sb, claude, usuario_email: str = None,
                   cnpj: str = None, termo_rebusca: str = None) -> dict:
    """ORQUESTRADOR do motor. Percorre camada 2 -> camada 3.

    A CAMADA 1 (banco de preços) NÃO é aqui — é o matching existente do /extrair.
    O motor só é chamado para itens SEM match no banco. Então começa na camada 2.

      • Camada 2: ficha viva e fresca (< TTL) => serve direto (rápido, barato).
      • Camada 2 velha (> TTL) ou inexistente => Camada 3 (descoberta), que salva
        a ficha nova (aposentando a antiga) para virar camada 2 futura.

    `termo_rebusca`: o operador reescreveu o termo (correção implícita, sinal forte)
    => usa o termo dele E ensina a memória de interpretação.
    `cnpj`: âncora do nó da internet (registra o acerto quando resolve).
    """
    t0 = time.time()
    ctx = {"claude": claude, "sb": sb}
    perfil = interpretar(item, claude, sb=sb)

    # Correção implícita: o operador reescreveu. Usa o termo dele e APRENDE.
    if (termo_rebusca or "").strip():
        aprender_correcao_reescrita(sb, perfil.get("entrada_norm"), termo_rebusca, claude)
        perfil["consulta"] = termo_rebusca.strip()

    termo = perfil.get("consulta")

    # ── CAMADA 2 ─────────────────────────────────────────────────────────────
    aps2, mais_velha = buscar_camada2(perfil, sb)
    if aps2 and mais_velha is not None and mais_velha < FICHA_TTL_HORAS:
        ficha = {
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
        registrar_log(sb, termo, 2, ficha, int((time.time() - t0) * 1000), usuario_email)
        return ficha

    # ── CAMADA 3 (nova ou revalidação de ficha > TTL) ────────────────────────
    reg = montar_registry()
    ficha = buscar_cascata(perfil, reg, ctx)
    ficha["camada"] = 3
    if ficha.get("apresentacoes"):
        salvar_ficha(perfil, ficha["apresentacoes"], sb)   # vira camada 2 futura
    registrar_log(sb, termo, 3, ficha, int((time.time() - t0) * 1000), usuario_email)
    return ficha


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
