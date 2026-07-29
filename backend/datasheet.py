"""
datasheet.py — Orquestração do datasheet técnico da KIST.

Divisão de responsabilidade:
    datasheet_pdf.py  → geometria e desenho (puro, sem IA, sem rede)
    datasheet.py      → identificar o item, achar a foto, montar o conteúdo
    main.py           → endpoints, Storage, banco

PRINCÍPIO ZERO (o mesmo do motor de preços): NÃO INVENTAR.
    O motor errava porque a conferência web chutava MPN — buscava um código
    falso e trazia o item errado 5 a 22× mais barato, gravando `achou=true`.
    Aqui o estrago seria pior: o documento sai com a marca da KIST na frente do
    cliente final. Então:
      • fabricante e modelo só entram se vieram do cliente, da página de origem
        ou de fonte confirmada na busca — nunca de dedução;
      • se não dá pra cravar QUAL item é, o fluxo PARA e pergunta ao operador;
      • sem foto confirmada, o PDF sai SEM foto (nunca com foto parecida).

    Evidência de que isso importa: nos 3 datasheets de referência do Fábio, o do
    SFP genérico não tem foto nenhuma embutida — o ChatGPT DESENHOU um vetor
    quando não achou a foto real, violando a regra 4 do prompt dele próprio.

TODA CHAMADA AO MODELO USA `tool_use`, NÃO JSON CRU.
    Lição do `/analista/chat`: ele quebrava em 29% dos turnos porque fazia
    `json.loads` de prosa longa com quebra de linha e aspas, e o erro real
    morria no `except`. `tool_use` devolve estrutura validada pelo schema.

INJEÇÃO DE DEPENDÊNCIA: `buscar_pagina` e `baixar` entram por parâmetro.
    Isso deixa o módulo testável com stub (sem rede, sem chave) e permite
    plugar o fetcher que já existe no `motor_precos.py` em vez de manter duas
    implementações que divergem em três meses (a lição do `lerContato`).
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from datasheet_pdf import gerar_pdf, nome_arquivo, validar_dados

MODELO_TEXTO = "claude-sonnet-4-6"
MODELO_VISAO = "claude-sonnet-4-6"
TIMEOUT = 90.0

MAX_IMAGEM_BYTES = 8 * 1024 * 1024
MIN_LADO_IMAGEM = 200          # abaixo disso a foto fica ruim no A4


# ══════════════════════════════════════════════════════════════════════════
# 1. IDENTIFICAÇÃO
# ══════════════════════════════════════════════════════════════════════════
SYSTEM_IDENTIFICAR = """Você identifica QUAL produto está sendo ofertado, para montar um datasheet técnico.

Você recebe: a descrição que o cliente pediu, as specs complementares, a
descrição que a KIST preencheu e (às vezes) a página de origem do produto.

REGRA ABSOLUTA — NÃO INVENTE IDENTIFICADOR.
- Só afirme fabricante, modelo ou part number se ele estiver LITERALMENTE em
  algum dos textos que você recebeu.
- Se o cliente não deu código, o item NÃO TEM código. Deixe em branco.
- Nunca deduza marca a partir da categoria ("é um disjuntor, deve ser Schneider").
- Errar aqui gera um documento com a marca da KIST descrevendo o produto errado
  na frente do cliente final. Em branco é sempre melhor que chutado.

CONFIANÇA:
- "alta": dá pra cravar o produto — categoria clara e atributos suficientes para
  um datasheet correto. Não exige marca/modelo: um item genérico bem
  especificado ("cabo HDMI 2.0, 2 m, macho-macho") é alta.
- "media": dá pra montar, mas falta atributo que muda a especificação.
- "baixa": não dá pra saber que item é. Liste em `perguntas` o que precisa ser
  respondido e, se houver leituras possíveis, liste em `ambiguidade`.

`nome_produto` é comercial e limpo, em português, sem código de fornecedor, sem
preço, sem nome de loja. `subtitulo` é uma linha técnica curta."""

FERRAMENTA_IDENTIFICAR = {
    "name": "identificar_produto",
    "description": "Devolve a identificação do produto ofertado.",
    "input_schema": {
        "type": "object",
        "properties": {
            "nome_produto": {"type": "string", "description": "Nome comercial limpo"},
            "fabricante": {"type": "string", "description": "Só se literal na fonte; senão vazio"},
            "modelo": {"type": "string", "description": "Só se literal na fonte; senão vazio"},
            "categoria": {"type": "string"},
            "subtitulo": {"type": "string", "description": "Uma linha técnica curta"},
            "confianca": {"type": "string", "enum": ["alta", "media", "baixa"]},
            "ambiguidade": {"type": "array", "items": {"type": "string"},
                            "description": "Leituras possíveis quando não dá pra cravar"},
            "perguntas": {"type": "array", "items": {"type": "string"},
                          "description": "O que perguntar ao operador"},
            "termos_busca": {"type": "array", "items": {"type": "string"},
                             "description": "2 a 4 consultas para buscar a ficha técnica"},
        },
        "required": ["nome_produto", "confianca"],
    },
}


def _bloco_ferramenta(resp, nome: str) -> Optional[Dict[str, Any]]:
    """Extrai o input do tool_use pelo NOME, não pela posição.

    Resposta com busca web vem misturada (texto + server_tool_use +
    web_search_tool_result + tool_use). Indexar por posição quebra.
    """
    for b in getattr(resp, "content", []) or []:
        if getattr(b, "type", "") == "tool_use" and getattr(b, "name", "") == nome:
            entrada = getattr(b, "input", None)
            if isinstance(entrada, dict):
                return entrada
            if isinstance(entrada, str):
                try:
                    return json.loads(entrada)
                except Exception:
                    return None
    return None


def _texto_da_resposta(resp) -> str:
    return "\n".join(b.text for b in (getattr(resp, "content", []) or [])
                     if getattr(b, "type", "") == "text").strip()


def _norm(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def contexto_do_item(item: Dict[str, Any], fonte_texto: str = "",
                     pagina: str = "") -> str:
    """Monta o texto que o modelo lê. Mesma espinha do /conferir.

    A origem (link, fornecedor) entra como INSUMO de identificação e nunca
    chega ao documento — a regra 6 do prompt proíbe citar fornecedor, e o
    `validar_dados` do template varre isso no fim.
    """
    p = ["### O QUE O CLIENTE PEDIU",
         f"Descrição: {_norm(item.get('descricao_original')) or '(vazio)'}"]
    sp = _norm(item.get("specs_complementares"))
    p.append(f"Specs complementares: {sp}" if sp
             else "Specs complementares: (o cliente não informou)")
    if item.get("codigo_cliente"):
        p.append(f"Código do item no ERP do cliente: {item['codigo_cliente']}")

    p.append("\n### O QUE A KIST ESTÁ OFERTANDO")
    p.append(f"Descrição preenchida: {_norm(item.get('descricao_final')) or '(não preenchida)'}")
    if _norm(item.get("sku_fornecedor")):
        p.append(f"SKU na origem: {item['sku_fornecedor']}")
    if _norm(item.get("link_fornecedor")):
        p.append(f"Página de origem (INSUMO INTERNO — nunca citar no documento): "
                 f"{item['link_fornecedor']}")

    if pagina:
        p.append("\n### CONTEÚDO LIDO DA PÁGINA DE ORIGEM")
        p.append(pagina[:12000])
    if fonte_texto:
        p.append("\n### E-MAIL / ANEXOS ORIGINAIS DO CLIENTE")
        p.append(fonte_texto[:10000])
    return "\n".join(p)


def identificar(claude, item: Dict[str, Any], fonte_texto: str = "",
                pagina: str = "", pistas: str = "") -> Dict[str, Any]:
    """Descobre QUAL item é. Não busca specs ainda — só identidade."""
    ctx = contexto_do_item(item, fonte_texto, pagina)
    if pistas:
        ctx += f"\n\n### CORREÇÃO DO OPERADOR (vale mais que tudo acima)\n{pistas}"

    resp = claude.messages.create(
        model=MODELO_TEXTO, max_tokens=1200, system=SYSTEM_IDENTIFICAR,
        messages=[{"role": "user", "content": ctx}],
        tools=[FERRAMENTA_IDENTIFICAR],
        tool_choice={"type": "tool", "name": "identificar_produto"},
        temperature=0, timeout=TIMEOUT,
    )
    dados = _bloco_ferramenta(resp, "identificar_produto") or {}
    ident = {
        "nome_produto": _norm(dados.get("nome_produto")),
        "fabricante": _norm(dados.get("fabricante")),
        "modelo": _norm(dados.get("modelo")),
        "categoria": _norm(dados.get("categoria")),
        "subtitulo": _norm(dados.get("subtitulo")),
        "confianca": (dados.get("confianca") or "baixa").lower(),
        "ambiguidade": [_norm(a) for a in (dados.get("ambiguidade") or []) if _norm(a)],
        "perguntas": [_norm(q) for q in (dados.get("perguntas") or []) if _norm(q)],
        "termos_busca": [_norm(t) for t in (dados.get("termos_busca") or []) if _norm(t)],
    }

    # ── Trava anti-invenção, determinística ────────────────────────────────
    # O prompt já proíbe deduzir identificador, mas prompt não é garantia. Se o
    # fabricante/modelo não aparece em NENHUM texto de entrada, ele foi
    # inventado — some com ele e registra. É o mesmo remédio do MPN chutado.
    fonte_toda = " ".join([
        _norm(item.get("descricao_original")), _norm(item.get("descricao_final")),
        _norm(item.get("specs_complementares")), _norm(item.get("sku_fornecedor")),
        pagina or "", fonte_texto or "", pistas or "",
    ]).lower()
    ident["descartado"] = []
    for campo in ("fabricante", "modelo"):
        valor = ident.get(campo) or ""
        if valor and valor.lower() not in fonte_toda:
            ident["descartado"].append(f"{campo}='{valor}' (não estava em nenhuma fonte)")
            ident[campo] = ""

    ident["precisa_operador"] = (ident["confianca"] == "baixa"
                                or not ident["nome_produto"]
                                or bool(ident["ambiguidade"]))
    return ident


# ══════════════════════════════════════════════════════════════════════════
# 2. CONTEÚDO (specs, destaques, introdução)
# ══════════════════════════════════════════════════════════════════════════
SYSTEM_CONTEUDO = """Você monta o conteúdo de um datasheet técnico da KIST Soluções, que será
enviado ao CLIENTE FINAL.

Use a busca web para levantar a ficha técnica. Prefira, nesta ordem:
1. site oficial do fabricante;
2. fonte técnica confiável (norma, catálogo, distribuidor autorizado);
3. o que o cliente informou.

NUNCA INVENTE part number, marca, certificação, dimensão, desempenho ou
compatibilidade. Se uma característica varia por versão e você não confirmou,
deixe de fora ou use redação tecnicamente segura. Para item genérico, inclua
apenas o que é praticamente universal naquele tipo de produto.
Ficha magra e correta é melhor que ficha cheia e chutada.

NUNCA INCLUA, em nenhum campo:
preço, valor, desconto, frete, imposto, condição de pagamento, nome de
fornecedor/distribuidor/marketplace/vendedor, link, referência a anúncio,
carrinho, cotação ou proposta, nem qualquer frase dizendo de onde os dados
vieram. O documento tem a identidade da KIST e as specs do item, mais nada.

FORMATO:
- `introducao`: um parágrafo objetivo, 2 a 3 linhas, sem marketing vazio.
- `destaques`: EXATAMENTE 4. São o que mais importa ao cliente (capacidade,
  velocidade, interface, alcance, resolução, tamanho, potência). Rótulo curto,
  valor curto — eles vivem em caixas pequenas.
- `specs`: da mais relevante para a menos. Só o que interessa ao cliente final.
  Unidades padronizadas. Entre 6 e 20 linhas.
- `fontes`: de onde saiu a informação (uso interno, não vai no documento).

Português do Brasil."""

FERRAMENTA_CONTEUDO = {
    "name": "montar_datasheet",
    "description": "Devolve o conteúdo do datasheet.",
    "input_schema": {
        "type": "object",
        "properties": {
            "nome_produto": {"type": "string"},
            "modelo": {"type": "string"},
            "subtitulo": {"type": "string"},
            "introducao": {"type": "string"},
            "destaques": {
                "type": "array",
                "items": {"type": "object",
                          "properties": {"rotulo": {"type": "string"},
                                         "valor": {"type": "string"}},
                          "required": ["rotulo", "valor"]},
                "description": "Exatamente 4",
            },
            "specs": {
                "type": "array",
                "items": {"type": "object",
                          "properties": {"caracteristica": {"type": "string"},
                                         "especificacao": {"type": "string"}},
                          "required": ["caracteristica", "especificacao"]},
            },
            "fontes": {"type": "array", "items": {"type": "string"}},
            "paginas_oficiais": {
                "type": "array", "items": {"type": "string"},
                "description": "URLs de páginas de PRODUTO do fabricante ou de "
                               "catálogo oficial que você consultou. É de onde "
                               "sai a melhor foto. Só URLs que você realmente viu.",
            },
            "incertezas": {"type": "array", "items": {"type": "string"},
                           "description": "O que não deu para confirmar"},
        },
        "required": ["nome_produto", "introducao", "destaques", "specs"],
    },
}


def montar_conteudo(claude, ident: Dict[str, Any], contexto: str,
                    critica: str = "", anterior: Optional[Dict[str, Any]] = None,
                    max_buscas: int = 5, modo: str = "tecnico",
                    system_comercial: str = "") -> Dict[str, Any]:
    """Levanta specs e monta o conteúdo.

    `critica` + `anterior` são o loop de reprovação: sem a versão anterior em
    mãos o modelo regera do zero e sorteia de novo. Com ela, ele corrige o que
    o operador apontou e preserva o resto.
    """
    partes = [contexto, "\n### IDENTIFICAÇÃO CONFIRMADA",
              f"Produto: {ident.get('nome_produto')}",
              f"Fabricante: {ident.get('fabricante') or '(não informado — não deduza)'}",
              f"Modelo: {ident.get('modelo') or '(não informado — não deduza)'}",
              f"Categoria: {ident.get('categoria') or '(não classificada)'}"]

    if anterior and critica:
        partes.append("\n### VERSÃO ANTERIOR (o operador REPROVOU)")
        partes.append(json.dumps({
            "introducao": anterior.get("introducao"),
            "destaques": anterior.get("destaques"),
            "specs": anterior.get("specs"),
        }, ensure_ascii=False)[:6000])
        partes.append("\n### O QUE O OPERADOR APONTOU (corrija ISTO)")
        partes.append(critica)
        partes.append("\nCorrija o que ele apontou e PRESERVE o resto. "
                      "O operador é a hierarquia superior: se ele afirma um dado "
                      "técnico, aceite mesmo que sua busca diga outra coisa.")
    elif critica:
        partes.append("\n### ORIENTAÇÃO DO OPERADOR")
        partes.append(critica)

    # MODO COMERCIAL: sem busca web. `tool_choice` força a ferramenta, porque
    # sem web_search o modelo tende a responder em prosa.
    if modo == "comercial":
        resp = claude.messages.create(
            model=MODELO_TEXTO, max_tokens=4000,
            system=system_comercial or SYSTEM_CONTEUDO,
            messages=[{"role": "user", "content": "\n".join(partes)}],
            tools=[FERRAMENTA_CONTEUDO],
            tool_choice={"type": "tool", "name": "montar_datasheet"},
            temperature=0, timeout=TIMEOUT,
        )
    else:
        resp = claude.messages.create(
            model=MODELO_TEXTO, max_tokens=4000, system=SYSTEM_CONTEUDO,
            messages=[{"role": "user", "content": "\n".join(partes)}],
            tools=[{"type": "web_search_20250305", "name": "web_search",
                    "max_uses": max_buscas},
                   FERRAMENTA_CONTEUDO],
            temperature=0, timeout=TIMEOUT,
        )
    dados = _bloco_ferramenta(resp, "montar_datasheet") or {}

    destaques = [{"rotulo": _norm(d.get("rotulo")), "valor": _norm(d.get("valor"))}
                 for d in (dados.get("destaques") or [])][:4]
    specs = [{"caracteristica": _norm(s.get("caracteristica")),
              "especificacao": _norm(s.get("especificacao"))}
             for s in (dados.get("specs") or [])
             if _norm(s.get("caracteristica")) or _norm(s.get("especificacao"))]

    conteudo = {
        "nome_produto": _norm(dados.get("nome_produto")) or ident.get("nome_produto", ""),
        "modelo": _norm(dados.get("modelo")) or ident.get("modelo", ""),
        "subtitulo": _norm(dados.get("subtitulo")) or ident.get("subtitulo", ""),
        "introducao": _norm(dados.get("introducao")),
        "destaques": destaques,
        "specs": specs,
        "fontes": [_norm(f) for f in (dados.get("fontes") or []) if _norm(f)],
        "paginas_oficiais": [_norm(u) for u in (dados.get("paginas_oficiais") or [])
                             if _norm(u).startswith("http")],
        "incertezas": [_norm(i) for i in (dados.get("incertezas") or []) if _norm(i)],
        "buscas": [b.input.get("query", "") for b in (getattr(resp, "content", []) or [])
                   if getattr(b, "type", "") == "server_tool_use"
                   and isinstance(getattr(b, "input", None), dict)],
    }
    return conteudo



# ══════════════════════════════════════════════════════════════════════════
# MODO COMERCIAL — o prompt do Fábio, cru
#
# O modo "tecnico" (acima) identifica, busca na web e valida. O modo
# "comercial" NÃO busca: entrega o prompt que o Fábio já usava no ChatGPT e
# deixa o modelo montar a apresentação a partir do que o item diz.
#
# É mais rápido e não depende de rede. Em troca, as especificações saem da
# memória do modelo, não de fonte verificada — por isso a revisão do operador
# deixa de ser conferência e passa a ser a ÚNICA validação. Está dito na tela.
#
# Vive em config_kist['datasheet_prompt_comercial'] quando existir, para o
# Fábio afinar o próprio prompt sem redeploy. O texto abaixo é o padrão.
# ══════════════════════════════════════════════════════════════════════════
PROMPT_COMERCIAL_PADRAO = """Você vai criar datasheets profissionais em PDF para a KIST Soluções.

OBJETIVO
Os datasheets serão enviados a clientes finais para revenda de equipamentos. Portanto, o documento deve parecer um material técnico/comercial próprio da KIST, contendo somente:
1. identidade visual da KIST;
2. nome e imagem real do produto;
3. descrição objetiva;
4. especificações técnicas relevantes.

REGRAS OBRIGATÓRIAS

2. IDENTIDADE VISUAL
- Estrutura visual padrão:
  a) cabeçalho com logotipo e "DATASHEET TÉCNICO";
  b) nome do produto e modelo;
  c) subtítulo técnico curto;
  d) introdução objetiva;
  e) imagem real do produto à esquerda;
  f) quatro boxes com os principais destaques à direita;
  g) tabela completa de especificações;
  h) rodapé mínimo com linha e número da página.

5. ESPECIFICAÇÕES TÉCNICAS
- Use as informações da PÁGINA DE ORIGEM do item e da descrição enviada. Não consulte nem cite nenhuma outra fonte.
- Se a página de origem não trouxer uma característica, deixe-a de fora. Ficha curta e correta é melhor que ficha cheia e suposta.
- Para produtos genéricos, inclua apenas características altamente prováveis e praticamente universais para aquele tipo de item.
- Não invente part number, marca, certificação, dimensão, desempenho ou compatibilidade.
- Quando uma característica variar por versão e não estiver confirmada, não inclua ou use redação tecnicamente segura.
- Mantenha unidades padronizadas e claras.
- Destaque nos quatro boxes as informações mais úteis, como capacidade, velocidade, interface, alcance, resolução, tamanho ou potência.
- A tabela deve conter somente informações relevantes ao cliente final.

6. INFORMAÇÕES PROIBIDAS
Nunca inclua no datasheet:
- preço, valor, desconto, economia, frete ou impostos;
- condições de pagamento;
- nome do fornecedor, distribuidor, marketplace ou vendedor;
- onde a KIST está comprando o item;
- links de compra;
- referência a carrinho, proposta, cotação, anúncio ou página consultada;
- frase dizendo de onde os dados foram extraídos;
- observações internas de compra ou revenda;
- comentários como "imagem obtida do anúncio";
- justificativas sobre omissão de preço;
- referências a fontes, pesquisas ou processo de criação;
- informações que não interessam ao cliente final;
- quadro "Observações" com informações internas ou comerciais.

O documento deve conter apenas a identidade da KIST e as especificações do item.

7. LAYOUT E REVISÃO VISUAL
- Evite que uma palavra fique quebrada de forma feia.
- Revise acentos, unidades, nomenclaturas e coerência técnica.

Português do Brasil."""

# O contrato de saída. O prompt do Fábio foi escrito para um assistente que
# DESENHA o PDF; aqui quem desenha é o template, então o modelo precisa saber
# em que campos devolver. É o único acréscimo — e fica separado, para o texto
# dele continuar sendo o dele.
_CONTRATO_COMERCIAL = """

---
FORMATO DA RESPOSTA
O layout, o logotipo, as cores, as margens e o controle de sobreposição já são
garantidos pelo template — você não desenha nada. Devolva apenas o CONTEÚDO
pela ferramenta `montar_datasheet`: nome, modelo, subtítulo, introdução,
exatamente 4 destaques e a tabela de especificações."""


def prompt_comercial(sb=None) -> str:
    """Prompt do modo comercial: config_kist se houver, senão o padrão."""
    texto = ""
    if sb is not None:
        try:
            r = sb.table("config_kist").select("valor")\
                .eq("chave", "datasheet_prompt_comercial").limit(1).execute()
            texto = ((r.data or [{}])[0].get("valor") or "").strip()
        except Exception:
            texto = ""
    return (texto or PROMPT_COMERCIAL_PADRAO) + _CONTRATO_COMERCIAL

# ══════════════════════════════════════════════════════════════════════════
# 3. FOTO REAL
# ══════════════════════════════════════════════════════════════════════════
_RX_MLB = re.compile(r"(MLB)-?(\d{6,})", re.I)
_RX_META = re.compile(
    r'<meta[^>]+(?:property|name)\s*=\s*["\'](?:og:image(?::secure_url)?|twitter:image)["\']'
    r'[^>]*content\s*=\s*["\']([^"\']+)["\']', re.I)
_RX_META_INV = re.compile(
    r'<meta[^>]+content\s*=\s*["\']([^"\']+)["\'][^>]*'
    r'(?:property|name)\s*=\s*["\'](?:og:image(?::secure_url)?|twitter:image)["\']', re.I)
_RX_LDJSON = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
                        re.I | re.S)
_RX_IMG = re.compile(r'<img\b([^>]*)>', re.I)
_RX_ATRIB = re.compile(
    r'(?:^|\s)(src|data-src|data-original|data-lazy|data-zoom-image|data-large_image|srcset)'
    r'\s*=\s*["\']([^"\']+)["\']', re.I)
_RX_LINK_IMG = re.compile(
    r'<link[^>]+rel=["\']image_src["\'][^>]*href=["\']([^"\']+)["\']', re.I)

# Nao e' foto de produto. Filtro DETERMINISTICO, antes de gastar chamada de visao.
# Nasceu de um caso real: a pagina do fabricante ADATA devolvia
# `adata_logo_1200_630.png` como og:image; a visao recusou certo, mas era a unica
# candidata e o item ficou sem foto.
_LIXO_IMAGEM = re.compile(
    r'logo|logotipo|brand|marca[-_]|icon|sprite|placeholder|banner|bandeira|'
    r'avatar|selo|pixel|spacer|blank|loading|spinner|whatsapp|facebook|instagram|'
    r'youtube|twitter|linkedin|pagamento|payment|boleto|pix[-_]|cartao|visa|master|'
    r'carrinho|cart[-_]|favicon|thumb[-_]?nail[-_]?default|sem[-_]imagem|no[-_]image',
    re.I)
# Ao contrario, isto CHEIRA a foto de produto.
_BOM_IMAGEM = re.compile(r'produto|product|media|imagens?|images?|photo|foto|upload|catalog',
                         re.I)


def _pontua_imagem(url: str) -> int:
    """Ordena candidatas. Quanto maior, mais cedo entra na fila."""
    p = 0
    if _BOM_IMAGEM.search(url):
        p += 3
    if re.search(r'\.(jpe?g|png|webp)(\?|$)', url, re.I):
        p += 2
    m = re.search(r'(\d{3,4})\s*[xX]\s*(\d{3,4})', url)
    if m and min(int(m.group(1)), int(m.group(2))) >= 400:
        p += 2
    if re.search(r'(^|[^0-9])(\d{1,2})x\2($|[^0-9])', url):
        p -= 1
    return p


def _absoluta(url: str, base: str) -> str:
    if not url:
        return ""
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("http"):
        return url
    m = re.match(r"(https?://[^/]+)", base or "")
    if m and url.startswith("/"):
        return m.group(1) + url
    return url


def urls_de_imagem(html: str, base_url: str = "") -> List[str]:
    """Candidatas a foto do produto numa página de loja/fabricante.

    Regex em vez de BeautifulSoup de propósito: evita mais uma dependência de
    produção para ganhar pouco.

    TRES CAMADAS, nesta ordem de confianca:
      1. og:image / twitter:image — convencao estavel, quem publica produto quer
         que o link fique bonito no WhatsApp;
      2. JSON-LD (schema.org/Product) — dado estruturado;
      3. as tags <img> da pagina — a rede de baixo.

    A camada 3 nasceu de um caso real: a memoria ADATA da mazer.com.br nao tem
    og:image nem JSON-LD; a foto do produto e' um <img> comum, e o item saiu sem
    imagem nos dois modos. Sem esta camada, toda loja que nao preenche meta tag
    fica de fora — e sao muitas.
    """
    achadas: List[str] = []
    for rx in (_RX_META, _RX_META_INV):
        for m in rx.finditer(html or ""):
            u = _absoluta(_norm(m.group(1)), base_url)
            # og:image de site de FABRICANTE costuma ser o logo institucional.
            # Recusar aqui poupa uma chamada de visao e, mais importante, nao
            # deixa a unica vaga da fila ser gasta com um logotipo.
            if u and u not in achadas and not _LIXO_IMAGEM.search(u):
                achadas.append(u)
    for m in _RX_LDJSON.finditer(html or ""):
        try:
            dado = json.loads(m.group(1))
        except Exception:
            continue
        pilha = [dado]
        while pilha:
            no = pilha.pop()
            if isinstance(no, dict):
                img = no.get("image")
                if isinstance(img, str):
                    u = _absoluta(_norm(img), base_url)
                    if u and u not in achadas:
                        achadas.append(u)
                elif isinstance(img, list):
                    for i in img:
                        if isinstance(i, str):
                            u = _absoluta(_norm(i), base_url)
                            if u and u not in achadas:
                                achadas.append(u)
                pilha.extend(v for v in no.values() if isinstance(v, (dict, list)))
            elif isinstance(no, list):
                pilha.extend(no)

    # ── Camada 3: <img> da pagina ──────────────────────────────────────────
    for m in _RX_LINK_IMG.finditer(html or ""):
        u = _absoluta(_norm(m.group(1)), base_url)
        if u and u not in achadas:
            achadas.append(u)

    brutas: List[str] = []
    for m in _RX_IMG.finditer(html or ""):
        atrs = m.group(1)
        for _a, valor in _RX_ATRIB.findall(atrs):
            # data-uri e' imagem embutida (placeholder de lazy-load). Testar ANTES
            # de partir por virgula: "data:image/gif;base64,R0lGOD" TEM virgula, e
            # o split fazia a metade final virar URL candidata.
            if _norm(valor).lower().startswith("data:"):
                continue
            # srcset traz "url 1x, url 2x": fica com a ultima (maior)
            for pedaco in reversed(valor.split(",")):
                cru = _norm(pedaco.split()[0]) if pedaco.strip() else ""
                if not cru or cru.startswith("data:"):
                    continue
                u = _absoluta(cru, base_url)
                if u and u not in brutas and u not in achadas:
                    brutas.append(u)
                break

    # Descarta o obvio (logo, icone, selo de pagamento) SEM gastar visao, e
    # ordena o resto pelo que cheira a foto de produto.
    limpas = [u for u in brutas if not _LIXO_IMAGEM.search(u)]
    limpas.sort(key=_pontua_imagem, reverse=True)
    achadas.extend(limpas[:12])
    return achadas


def urls_imagem_mercadolivre(link: str, buscar_json: Callable[[str], Any]) -> List[str]:
    """API oficial do ML: o item traz `pictures` em alta, sem scraping.

    Cobre a maior fatia dos links da base (287 de 823 itens com origem, dos
    quais 255 carregam o ID MLB na URL).
    """
    m = _RX_MLB.search(link or "")
    if not m:
        return []
    item_id = f"{m.group(1).upper()}{m.group(2)}"
    try:
        dado = buscar_json(f"https://api.mercadolibre.com/items/{item_id}")
    except Exception:
        return []
    if not isinstance(dado, dict):
        return []
    urls = []
    for p in (dado.get("pictures") or []):
        u = _norm(p.get("secure_url") or p.get("url"))
        if u:
            urls.append(u)
    if not urls and _norm(dado.get("thumbnail")):
        urls.append(_norm(dado["thumbnail"]))
    return urls


def _imagem_utilizavel(dados: bytes) -> Tuple[bool, str]:
    """Rejeita o que não serve: quebrado, pequeno demais, ou pesado demais."""
    if not dados:
        return False, "vazio"
    if len(dados) > MAX_IMAGEM_BYTES:
        return False, "arquivo grande demais"
    try:
        from PIL import Image
        import io as _io
        im = Image.open(_io.BytesIO(dados))
        im.verify()
        im = Image.open(_io.BytesIO(dados))
        w, h = im.size
    except Exception as e:
        return False, f"não é imagem legível ({type(e).__name__})"
    if min(w, h) < MIN_LADO_IMAGEM:
        return False, f"resolução baixa ({w}x{h})"
    return True, f"{w}x{h}"


SYSTEM_CONFIRMAR_FOTO = """Você confere se uma FOTO corresponde ao PRODUTO descrito.

Responda `confere=true` apenas se a imagem mostra, claramente, o produto
descrito (ou um exemplar do mesmo tipo, quando o item é genérico).

Responda `confere=false` quando:
- a imagem mostra outro produto, ou uma categoria diferente;
- é banner, logotipo de marca, selo, ícone, embalagem sem o produto,
  imagem de site quebrado, placeholder ou foto de ambiente sem o item;
- você não consegue determinar o que é.

Na dúvida, `false`. Um datasheet sem foto é aceitável;
um datasheet com a foto errada é um erro na frente do cliente final."""

FERRAMENTA_CONFIRMAR = {
    "name": "conferir_foto",
    "description": "Diz se a foto corresponde ao produto.",
    "input_schema": {
        "type": "object",
        "properties": {
            "confere": {"type": "boolean"},
            "o_que_vejo": {"type": "string"},
            "motivo": {"type": "string"},
        },
        "required": ["confere", "o_que_vejo"],
    },
}


def confirmar_foto(claude, imagem: bytes, mime: str,
                   ident: Dict[str, Any]) -> Tuple[bool, str]:
    """Olha a foto antes de deixá-la entrar no PDF.

    É o único passo de 'controle de qualidade visual' que sobrou do prompt
    original — e sobrou porque o layout a gente controla, mas a foto vem da
    internet e ninguém garante o que ela mostra.
    """
    descricao = ", ".join(x for x in [ident.get("nome_produto"),
                                      ident.get("fabricante"),
                                      ident.get("modelo")] if x)
    try:
        resp = claude.messages.create(
            model=MODELO_VISAO, max_tokens=500, system=SYSTEM_CONFIRMAR_FOTO,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64",
                                             "media_type": mime,
                                             "data": _b64(imagem)}},
                {"type": "text", "text": f"Produto esperado: {descricao}"},
            ]}],
            tools=[FERRAMENTA_CONFIRMAR],
            tool_choice={"type": "tool", "name": "conferir_foto"},
            temperature=0, timeout=TIMEOUT,
        )
    except Exception as e:
        return False, f"não consegui conferir a foto ({type(e).__name__})"
    d = _bloco_ferramenta(resp, "conferir_foto") or {}
    ok = bool(d.get("confere"))
    return ok, _norm(d.get("motivo")) or _norm(d.get("o_que_vejo"))


def _b64(dados: bytes) -> str:
    import base64
    return base64.b64encode(dados).decode("ascii")


def _mime_de(dados: bytes) -> str:
    if dados[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if dados[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return "image/webp"
    if dados[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/png"


def achar_foto(claude, ident: Dict[str, Any], link: str,
               baixar: Callable[[str], bytes],
               buscar_pagina: Callable[[str], str],
               buscar_json: Callable[[str], Any],
               paginas_oficiais: Optional[List[str]] = None,
               html_origem: str = "",
               tentativas: int = 8) -> Dict[str, Any]:
    """Procura a foto real, na ordem de confiança, e CONFIRMA antes de aceitar.

    ORDEM DAS FONTES — depende de conhecermos o fabricante:
      • com fabricante  → página oficial primeiro. A foto do fabricante é limpa,
        em fundo branco e sem marca d'água de vendedor. É a que combina com um
        documento que leva o logo da KIST.
      • sem fabricante (item genérico) → anúncio/loja primeiro, porque não
        existe página oficial para procurar.

    Item SEM link também procura: as páginas oficiais vêm da busca web feita no
    levantamento das specs. Antes disso, item sem link saía sempre sem foto —
    e a maioria dos itens sem link é perfeitamente encontrável.

    Sem candidata confirmada, devolve `imagem=None` e o motivo. O endpoint pede
    a foto ao operador em vez de inventar.
    """
    oficiais = [u for u in (paginas_oficiais or []) if _norm(u).startswith("http")]

    def _do_anuncio() -> List[Tuple[str, str]]:
        saida: List[Tuple[str, str]] = []
        for u in urls_imagem_mercadolivre(link, buscar_json):
            saida.append((u, "anuncio"))
        if link and not saida:
            # `gerar()` ja' leu esta pagina. Reusar evita a segunda requisicao e
            # garante que a extracao veja exatamente o mesmo HTML.
            html = html_origem
            if not html:
                try:
                    html = buscar_pagina(link)
                except Exception:
                    html = ""
            for u in urls_de_imagem(html or "", link):
                saida.append((u, "anuncio"))
        return saida

    def _do_fabricante() -> List[Tuple[str, str]]:
        saida: List[Tuple[str, str]] = []
        for pagina_url in oficiais[:3]:
            try:
                html = buscar_pagina(pagina_url)
            except Exception:
                continue
            for u in urls_de_imagem(html or "", pagina_url):
                saida.append((u, "fabricante"))
        return saida

    # ORDEM — o ANUNCIO DO PROPRIO ITEM vem primeiro, sempre.
    #
    # Eu tinha colocado o fabricante na frente quando a marca era conhecida,
    # argumentando que a foto dele e' mais limpa. O caso da memoria ADATA
    # mostrou o contrario: o site do fabricante devolveu o logotipo
    # institucional como og:image, a visao recusou (certo), e o item ficou sem
    # foto mesmo tendo foto boa na pagina de origem.
    #
    # A pagina de origem e' a do ITEM EXATO que estamos ofertando. O site do
    # fabricante e' da linha de produtos. Origem primeiro, fabricante como
    # reforco.
    candidatas = _do_anuncio() + _do_fabricante()

    vistas, fila = set(), []
    for u, de_onde in candidatas:
        if u not in vistas:
            vistas.add(u)
            fila.append((u, de_onde))

    recusadas: List[str] = []
    for url, de_onde in fila[:tentativas]:
        try:
            dados = baixar(url)
        except Exception as e:
            recusadas.append(f"{url[:70]} — download falhou ({type(e).__name__})")
            continue
        ok, nota = _imagem_utilizavel(dados)
        if not ok:
            recusadas.append(f"{url[:70]} — {nota}")
            continue
        mime = _mime_de(dados)
        confere, motivo = confirmar_foto(claude, dados, mime, ident)
        if confere:
            return {"imagem": dados, "mime": mime, "url": url,
                    "origem": de_onde, "recusadas": recusadas, "nota": nota}
        recusadas.append(f"{url[:70]} — não confere: {motivo}")

    return {"imagem": None, "mime": "", "url": "", "origem": "ausente",
            "recusadas": recusadas,
            "nota": "nenhuma foto confirmada — peça o link ou o arquivo ao operador"}


# ══════════════════════════════════════════════════════════════════════════
# 4. ORQUESTRAÇÃO
# ══════════════════════════════════════════════════════════════════════════
def gerar(claude, item: Dict[str, Any], logo_bytes: bytes,
          baixar: Callable[[str], bytes],
          buscar_pagina: Callable[[str], str],
          buscar_json: Callable[[str], Any],
          fonte_texto: str = "",
          pistas: str = "",
          critica: str = "",
          anterior: Optional[Dict[str, Any]] = None,
          imagem_operador: Optional[bytes] = None,
          contato_rodape: str = "",
          modo: str = "tecnico",
          system_comercial: str = "") -> Dict[str, Any]:
    """Fluxo completo de um item.

    Devolve sempre um dicionário — nunca levanta por falha de conteúdo. Quando
    não dá pra seguir, volta com `precisa_operador=True` e as perguntas.
    """
    comercial = (modo == "comercial")

    link = _norm(item.get("link_fornecedor"))
    pagina = ""
    # OS DOIS MODOS leem a pagina de origem. A diferenca esta' no RESTO:
    #   tecnico   -> pagina + busca web (fabricante, catalogos, fontes tecnicas)
    #   comercial -> SOMENTE a pagina de origem. Nada de busca web.
    # Ler a origem no comercial nao e' "buscar em outra fonte": e' ler o anuncio
    # do proprio item. E' o que impede o modelo de escrever a spec de memoria.
    if link:
        try:
            pagina = (buscar_pagina(link) or "")[:20000]
        except Exception:
            pagina = ""

    if comercial:
        # Sem etapa de identificação: o prompt do Fábio parte da descrição do
        # item, e é isso que ele pediu — gera, aprova ou corrige. Uma chamada
        # ao modelo em vez de duas.
        ident = {
            "nome_produto": _norm(item.get("descricao_final")
                                  or item.get("descricao_original")),
            "fabricante": "", "modelo": "", "categoria": "", "subtitulo": "",
            "confianca": "operador", "ambiguidade": [], "perguntas": [],
            "termos_busca": [], "descartado": [], "precisa_operador": False,
        }
    else:
        ident = identificar(claude, item, fonte_texto=fonte_texto,
                            pagina=pagina, pistas=pistas)
        if ident.get("precisa_operador"):
            return {"etapa": "identificacao", "precisa_operador": True,
                    "identificacao": ident, "avisos": ident.get("descartado") or []}

    contexto = contexto_do_item(item, fonte_texto, pagina)
    if comercial and _norm(pistas):
        contexto += f"\n\n### ORIENTAÇÃO DO OPERADOR\n{pistas}"
    conteudo = montar_conteudo(claude, ident, contexto,
                               critica=critica, anterior=anterior,
                               modo=modo, system_comercial=system_comercial)

    # ── Foto ───────────────────────────────────────────────────────────────
    if imagem_operador:
        ok, nota = _imagem_utilizavel(imagem_operador)
        foto = ({"imagem": imagem_operador, "mime": _mime_de(imagem_operador),
                 "url": "", "origem": "operador", "recusadas": [], "nota": nota}
                if ok else
                {"imagem": None, "mime": "", "url": "", "origem": "ausente",
                 "recusadas": [f"arquivo do operador: {nota}"], "nota": nota})
    else:
        foto = achar_foto(claude, ident, link, baixar, buscar_pagina, buscar_json,
                          paginas_oficiais=conteudo.get("paginas_oficiais") or [],
                          html_origem=pagina)

    # ── Regra 6: varredura determinística antes de desenhar ────────────────
    problemas = validar_dados(conteudo)
    if problemas:
        conteudo = _limpar(conteudo, problemas)
        problemas_restantes = validar_dados(conteudo)
    else:
        problemas_restantes = []

    pdf = gerar_pdf(conteudo, logo_bytes=logo_bytes,
                    imagem_bytes=foto.get("imagem"),
                    contato_rodape=contato_rodape or None)

    avisos: List[str] = []
    avisos += [f"identificação: descartei {d}" for d in (ident.get("descartado") or [])]
    if foto.get("imagem") is None:
        avisos.append("sem foto confirmada — o PDF saiu sem imagem")
    avisos += [f"conteúdo removido pela regra 6: {p}" for p in problemas]
    avisos += [f"⚠ ainda proibido após limpeza: {p}" for p in problemas_restantes]
    avisos += [f"não confirmado: {i}" for i in (conteudo.get("incertezas") or [])]

    if comercial:
        if pagina:
            avisos.append("modo apresentação comercial: montado SÓ com a página de "
                          "origem do item, sem busca na internet")
        elif link:
            avisos.append("modo apresentação comercial: não consegui ler a página de "
                          "origem — as especificações saíram do modelo, confira uma a uma")
        else:
            avisos.append("modo apresentação comercial: este item não tem link de "
                          "origem, então não houve fonte nenhuma — as especificações "
                          "saíram do modelo, confira uma a uma")

    return {
        "etapa": "pronto",
        "modo": modo,
        "precisa_operador": False,
        "identificacao": ident,
        "conteudo": conteudo,
        "foto": {k: v for k, v in foto.items() if k != "imagem"},
        "tem_foto": foto.get("imagem") is not None,
        "imagem_bytes": foto.get("imagem"),
        "pdf_bytes": pdf,
        "nome_arquivo": nome_arquivo(conteudo),
        "avisos": avisos,
    }


def _limpar(conteudo: Dict[str, Any], problemas: List[str]) -> Dict[str, Any]:
    """Remove os campos que o validador reprovou.

    Preferimos PERDER a linha a publicá-la: uma spec a menos não machuca
    ninguém; 'Fornecedor: Dimensional' num documento que vai pro cliente, sim.
    Campos estruturais (nome) não são removidos — o endpoint devolve o aviso e
    o operador resolve na revisão.
    """
    c = dict(conteudo)
    rotulos = {p.split(":", 1)[0] for p in problemas}

    if "subtítulo" in rotulos:
        c["subtitulo"] = ""
    if "introdução" in rotulos:
        c["introducao"] = ""
    if "destaque" in rotulos:
        c["destaques"] = [d for d in (c.get("destaques") or [])
                          if not validar_dados({"nome_produto": "x",
                                                "destaques": [d]})]
    if "spec" in rotulos:
        c["specs"] = [s for s in (c.get("specs") or [])
                      if not validar_dados({"nome_produto": "x", "specs": [s]})]
    return c
