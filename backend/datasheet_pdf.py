"""
datasheet_pdf.py — Template do DATASHEET TÉCNICO da KIST.

Renderização PURA: sem IA, sem rede, sem Supabase. Recebe um dicionário já
montado e devolve os bytes do PDF. Isso é de propósito — o template é a parte
que precisa ser determinística e testável sozinha.

POR QUE reportlab E NÃO WeasyPrint/HTML:
    WeasyPrint exige Cairo/Pango instalados no SISTEMA. No Render isso é `apt`,
    que o requirements.txt não controla — o boot quebraria. reportlab e Pillow
    são wheels de Python puro.

POR QUE A GEOMETRIA VIVE AQUI E NÃO NO PROMPT:
    As seções 7 e 8 do prompt que o Fábio usa no ChatGPT (não sobrepor, não
    quebrar palavra feio, renderizar em PNG e revisar visualmente) existem
    porque o ChatGPT reinventa o layout a cada PDF. Aqui o layout é fixo:
      • os 4 boxes têm altura IGUAL por construção (mesma linha de tabela);
      • a tabela de specs é um flowable — ela não invade nada, ela EMPURRA,
        e quebra para a página 2 sozinha repetindo o cabeçalho;
      • a imagem entra com proporção preservada (contain), nunca esticada;
      • texto que não cabe DIMINUI em degraus e depois quebra em 2 linhas.
    Ou seja: as regras viraram propriedade do template, não instrução para IA.

REGRA 6 DO PROMPT (informações proibidas) é responsabilidade de quem monta o
dicionário, não deste módulo — mas `validar_dados()` faz a última varredura
determinística por preço/fornecedor/link antes de deixar passar.
"""

from __future__ import annotations

import io
import re
from typing import Any, Dict, List, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# ── Identidade visual (prompt do Fábio, seção 2) ──────────────────────────────
AZUL_KIST = colors.HexColor("#2F61B5")
BORDA_SUAVE = colors.HexColor("#B9CBE9")
TEXTO_PRINCIPAL = colors.HexColor("#1F242A")
TEXTO_SECUNDARIO = colors.HexColor("#546171")
BRANCO = colors.white
LINHA_TABELA = colors.HexColor("#D8E2F0")

PAGINA = A4
LARGURA, ALTURA = PAGINA
MARGEM = 45.0
CONTEUDO = LARGURA - 2 * MARGEM          # 505.28 pt

# Bloco "herói": imagem à esquerda, 4 boxes à direita (prompt, seção 2.e/2.f)
HERO_ALTURA = 155.0
IMG_LARGURA = 225.0
HERO_GAP = 15.0
BOXES_LARGURA = CONTEUDO - IMG_LARGURA - HERO_GAP   # 265.28
BOX_GAP = 11.0
BOX_LARGURA = (BOXES_LARGURA - BOX_GAP) / 2.0
BOX_ALTURA = (HERO_ALTURA - BOX_GAP) / 2.0

CABECALHO_ALTURA = 78.0
RODAPE_Y = MARGEM + 26.0

FONTE = "Helvetica"
FONTE_B = "Helvetica-Bold"

MAX_DESTAQUES = 4
MAX_SPECS = 26  # teto de segurança; acima disso vira ruído para o cliente final


# ── Utilidades de texto ───────────────────────────────────────────────────────
def _txt(v: Any) -> str:
    """Normaliza para string limpa de uma linha."""
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def _encolhe(texto: str, fonte: str, tamanho: float, largura: float,
             minimo: float = 6.5, passo: float = 0.5) -> float:
    """Devolve o maior tamanho <= `tamanho` em que o texto cabe em UMA linha.

    Se nem no mínimo couber, devolve o mínimo — e quem chama quebra em 2 linhas.
    É o substituto determinístico da instrução 'não comprima a fonte
    excessivamente' que o prompt precisava dar para a IA.
    """
    t = tamanho
    while t > minimo and stringWidth(texto, fonte, t) > largura:
        t -= passo
    return max(t, minimo)


def _quebra_2(texto: str, fonte: str, tamanho: float, largura: float) -> List[str]:
    """Quebra em no máximo 2 linhas, SEM partir palavra no meio.

    Isso mata o 'velocidad / e' que o prompt reclama na seção 7.
    """
    if stringWidth(texto, fonte, tamanho) <= largura:
        return [texto]
    palavras = texto.split(" ")
    linha, linhas = "", []
    for p in palavras:
        tentativa = (linha + " " + p).strip()
        if stringWidth(tentativa, fonte, tamanho) <= largura or not linha:
            linha = tentativa
        else:
            linhas.append(linha)
            linha = p
        if len(linhas) == 2:
            break
    if linha and len(linhas) < 2:
        linhas.append(linha)
    return linhas[:2] or [texto]


# ── Estilos de parágrafo ──────────────────────────────────────────────────────
EST_INTRO = ParagraphStyle(
    "intro", fontName=FONTE, fontSize=9, leading=12.6,
    textColor=TEXTO_PRINCIPAL, alignment=TA_LEFT, spaceAfter=0,
)
EST_TAB_CAB = ParagraphStyle(
    "tabcab", fontName=FONTE_B, fontSize=8.5, leading=11,
    textColor=BRANCO, alignment=TA_LEFT,
)
EST_TAB_CAR = ParagraphStyle(
    "tabcar", fontName=FONTE_B, fontSize=8.5, leading=11,
    textColor=TEXTO_PRINCIPAL, alignment=TA_LEFT,
)
EST_TAB_ESP = ParagraphStyle(
    "tabesp", fontName=FONTE, fontSize=8.5, leading=11,
    textColor=TEXTO_PRINCIPAL, alignment=TA_LEFT,
)


# ── Flowables ─────────────────────────────────────────────────────────────────
class _Cabecalho(Flowable):
    """Logo à esquerda, 'DATASHEET TÉCNICO' centralizado na PÁGINA, e o bloco
    nome/modelo/subtítulo à direita do logo. Fecha com a régua azul.

    Altura FIXA: o cabeçalho nunca empurra o conteúdo de forma imprevisível.
    Nome e modelo encolhem em degraus se forem longos.
    """

    def __init__(self, nome: str, modelo: str, subtitulo: str,
                 logo: Optional[Any], largura: float = CONTEUDO):
        super().__init__()
        self.nome = _txt(nome)
        self.modelo = _txt(modelo)
        self.subtitulo = _txt(subtitulo)
        self.logo = logo
        self.largura = largura
        self.height = CABECALHO_ALTURA
        self.width = largura

    def wrap(self, aw, ah):
        return (self.largura, self.height)

    def draw(self):
        c = self.canv
        h = self.height

        # Logo: proporção preservada (regra 2 e 4 do prompt), caixa 118x40
        x_texto = 130.0
        if self.logo is not None:
            cx_l, cx_a = 118.0, 40.0
            iw, ih = self.logo.getSize()
            esc = min(cx_l / iw, cx_a / ih)
            lw, lh = iw * esc, ih * esc
            c.drawImage(self.logo, 0, h - 30 - lh / 2, width=lw, height=lh,
                        mask="auto")
            x_texto = max(130.0, lw + 22.0)

        # "DATASHEET TÉCNICO" — centralizado na página inteira
        c.setFillColor(AZUL_KIST)
        c.setFont(FONTE_B, 18)
        centro = (LARGURA / 2.0) - MARGEM
        c.drawCentredString(centro, h - 22, "DATASHEET TÉCNICO")

        disp = self.largura - x_texto
        y = h - 41

        t_nome = _encolhe(self.nome, FONTE_B, 11, disp, minimo=8.0)
        c.setFillColor(TEXTO_PRINCIPAL)
        c.setFont(FONTE_B, t_nome)
        c.drawString(x_texto, y, self.nome)
        y -= 12.5

        if self.modelo:
            t_mod = _encolhe(self.modelo, FONTE_B, 11, disp, minimo=8.0)
            c.setFont(FONTE_B, t_mod)
            c.drawString(x_texto, y, self.modelo)
            y -= 11.5

        if self.subtitulo:
            t_sub = _encolhe(self.subtitulo, FONTE, 8.5, disp, minimo=6.5)
            c.setFillColor(TEXTO_SECUNDARIO)
            c.setFont(FONTE, t_sub)
            c.drawString(x_texto, y, self.subtitulo)

        # Régua azul de fechamento
        c.setStrokeColor(AZUL_KIST)
        c.setLineWidth(1.6)
        c.line(0, 2, self.largura, 2)


class _CaixaImagem(Flowable):
    """Box branco com borda suave. A foto entra CONTAIN e centralizada.

    Nunca estica, nunca achata, nunca corta o produto (regra 4 do prompt).
    Sem foto confirmada, o box não é desenhado — quem monta o documento decide
    o layout alternativo. Foto errada é pior que foto ausente.
    """

    def __init__(self, imagem: Optional[Any], largura: float = IMG_LARGURA,
                 altura: float = HERO_ALTURA):
        super().__init__()
        self.imagem = imagem
        self.width = largura
        self.height = altura

    def wrap(self, aw, ah):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        c.setStrokeColor(BORDA_SUAVE)
        c.setFillColor(BRANCO)
        c.setLineWidth(0.9)
        c.roundRect(0, 0, self.width, self.height, 7, stroke=1, fill=1)
        if self.imagem is None:
            return
        pad = 12.0
        cx_l, cx_a = self.width - 2 * pad, self.height - 2 * pad
        iw, ih = self.imagem.getSize()
        esc = min(cx_l / iw, cx_a / ih)          # CONTAIN: nunca distorce
        lw, lh = iw * esc, ih * esc
        c.drawImage(self.imagem, (self.width - lw) / 2.0, (self.height - lh) / 2.0,
                    width=lw, height=lh, mask="auto")


class _CaixaDestaque(Flowable):
    """Um dos 4 boxes: rótulo azul em cima, valor escuro embaixo, centralizados.

    Altura fixa => os quatro ficam alinhados e com alturas iguais por
    construção, que é o que a seção 7 do prompt pede.
    """

    def __init__(self, rotulo: str, valor: str,
                 largura: float = BOX_LARGURA, altura: float = BOX_ALTURA):
        super().__init__()
        self.rotulo = _txt(rotulo)
        self.valor = _txt(valor)
        self.width = largura
        self.height = altura

    def wrap(self, aw, ah):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        c.setStrokeColor(BORDA_SUAVE)
        c.setFillColor(BRANCO)
        c.setLineWidth(0.9)
        c.roundRect(0, 0, self.width, self.height, 7, stroke=1, fill=1)

        util = self.width - 14.0
        meio = self.width / 2.0

        t_rot = _encolhe(self.rotulo, FONTE_B, 8.5, util, minimo=6.5)
        c.setFillColor(AZUL_KIST)
        c.setFont(FONTE_B, t_rot)
        c.drawCentredString(meio, self.height - 21, self.rotulo)

        # Valor: tenta 1 linha encolhendo; se não couber nem no piso, 2 linhas.
        t_val = _encolhe(self.valor, FONTE_B, 10.5, util, minimo=7.5)
        c.setFillColor(TEXTO_PRINCIPAL)
        if stringWidth(self.valor, FONTE_B, t_val) <= util:
            c.setFont(FONTE_B, t_val)
            c.drawCentredString(meio, self.height / 2.0 - 10, self.valor)
        else:
            linhas = _quebra_2(self.valor, FONTE_B, t_val, util)
            c.setFont(FONTE_B, t_val)
            y = self.height / 2.0 - 6
            for ln in linhas:
                c.drawCentredString(meio, y, ln)
                y -= t_val + 1.6


# ── Documento ─────────────────────────────────────────────────────────────────
class _Doc(BaseDocTemplate):
    """Rodapé mínimo: régua azul + número da página (prompt, seção 2.h).

    Sem dados de contato por padrão — só quando explicitamente pedido.
    """

    def __init__(self, buf, contato: Optional[str] = None, **kw):
        super().__init__(buf, pagesize=PAGINA,
                         leftMargin=MARGEM, rightMargin=MARGEM,
                         topMargin=MARGEM, bottomMargin=RODAPE_Y + 8, **kw)
        self.contato = contato
        frame = Frame(MARGEM, RODAPE_Y + 8, CONTEUDO,
                      ALTURA - MARGEM - RODAPE_Y - 8, id="corpo",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="pad", frames=[frame],
                                            onPage=self._rodape)])

    def _rodape(self, c, doc):
        c.saveState()
        c.setStrokeColor(AZUL_KIST)
        c.setLineWidth(1.2)
        c.line(MARGEM, RODAPE_Y, LARGURA - MARGEM, RODAPE_Y)
        c.setFillColor(TEXTO_SECUNDARIO)
        c.setFont(FONTE, 7.5)
        c.drawRightString(LARGURA - MARGEM, RODAPE_Y - 11, f"Página {doc.page}")
        if self.contato:
            c.setFont(FONTE, 7.5)
            c.drawString(MARGEM, RODAPE_Y - 11, self.contato)
        c.restoreState()


# ── Validação determinística (regra 6 do prompt) ──────────────────────────────
_PROIBIDO = [
    (re.compile(r"R\$\s*\d", re.I), "preço em reais"),
    (re.compile(r"\bUS\$|\bUSD\b|\bEUR\b", re.I), "valor em moeda estrangeira"),
    (re.compile(r"\bpre[çc]o\b|\bvalor unit|\bdesconto\b|\bfrete\b|\bimposto",
                re.I), "termo comercial"),
    (re.compile(r"https?://|www\.", re.I), "link"),
    (re.compile(r"mercado\s*livre|mercadolivre|amazon|aliexpress|ebay|shopee|"
                r"aliexpress|aliexpres", re.I), "marketplace"),
    (re.compile(r"\bfornecedor\b|\bdistribuidor\b|\bvendedor\b|\banúncio\b|"
                r"\banuncio\b|\bcarrinho\b|\bcota[çc][ãa]o\b|\bproposta\b",
                re.I), "referência comercial interna"),
]


def validar_dados(dados: Dict[str, Any]) -> List[str]:
    """Varredura final por conteúdo proibido. Determinística, sem IA.

    A IA que monta o conteúdo já é instruída a não incluir nada disso; esta
    função é a rede embaixo — se algo passar, o documento não sai calado.
    """
    problemas: List[str] = []
    campos: List[Tuple[str, str]] = [
        ("nome", _txt(dados.get("nome_produto"))),
        ("modelo", _txt(dados.get("modelo"))),
        ("subtítulo", _txt(dados.get("subtitulo"))),
        ("introdução", _txt(dados.get("introducao"))),
    ]
    for d in (dados.get("destaques") or [])[:MAX_DESTAQUES]:
        campos.append(("destaque", f"{_txt(d.get('rotulo'))} {_txt(d.get('valor'))}"))
    for s in (dados.get("specs") or [])[:MAX_SPECS]:
        campos.append(("spec", f"{_txt(s.get('caracteristica'))} "
                               f"{_txt(s.get('especificacao'))}"))
    for rotulo, texto in campos:
        if not texto:
            continue
        for rx, oq in _PROIBIDO:
            if rx.search(texto):
                problemas.append(f"{rotulo}: {oq} — {texto[:70]}")
                break
    if not _txt(dados.get("nome_produto")):
        problemas.append("nome do produto vazio")
    return problemas


# ── Montagem ──────────────────────────────────────────────────────────────────
def _abre_imagem(dados_img: Optional[bytes]):
    """Abre bytes como ImageReader do reportlab. Falha vira None (sem foto)."""
    if not dados_img:
        return None
    try:
        from PIL import Image
        from reportlab.lib.utils import ImageReader
        im = Image.open(io.BytesIO(dados_img))
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.mode else "RGB")
        # Fundo branco para PNG transparente — o datasheet tem fundo branco.
        if im.mode == "RGBA":
            from PIL import Image as _I
            fundo = _I.new("RGB", im.size, (255, 255, 255))
            fundo.paste(im, mask=im.split()[-1])
            im = fundo
        return ImageReader(im)
    except Exception:
        return None


def _tabela_specs(specs: List[Dict[str, str]]) -> Table:
    linhas = [[Paragraph("Característica", EST_TAB_CAB),
               Paragraph("Especificação", EST_TAB_CAB)]]
    for s in specs[:MAX_SPECS]:
        car = _txt(s.get("caracteristica"))
        esp = _txt(s.get("especificacao"))
        if not car and not esp:
            continue
        linhas.append([Paragraph(car, EST_TAB_CAR), Paragraph(esp, EST_TAB_ESP)])

    col0 = 148.0
    t = Table(linhas, colWidths=[col0, CONTEUDO - col0], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), AZUL_KIST),
        ("TEXTCOLOR", (0, 0), (-1, 0), BRANCO),
        ("GRID", (0, 0), (-1, -1), 0.5, LINHA_TABELA),
        ("BOX", (0, 0), (-1, -1), 0.7, BORDA_SUAVE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]))
    return t


def _hero(imagem, destaques: List[Dict[str, str]]) -> Table:
    """Imagem à esquerda + 4 boxes à direita.

    SEM imagem confirmada: os 4 boxes ocupam a largura inteira. O documento
    fica intencional em vez de exibir um retângulo vazio — que é o que denuncia
    'faltou a foto' na cara do cliente final.
    """
    dl = (destaques or [])[:MAX_DESTAQUES]
    while len(dl) < MAX_DESTAQUES:
        dl.append({"rotulo": "", "valor": ""})

    if imagem is None:
        larg = (CONTEUDO - BOX_GAP) / 2.0
        grade = Table(
            [[_CaixaDestaque(dl[0].get("rotulo"), dl[0].get("valor"), larg),
              _CaixaDestaque(dl[1].get("rotulo"), dl[1].get("valor"), larg)],
             [_CaixaDestaque(dl[2].get("rotulo"), dl[2].get("valor"), larg),
              _CaixaDestaque(dl[3].get("rotulo"), dl[3].get("valor"), larg)]],
            colWidths=[larg, BOX_GAP + larg], rowHeights=[BOX_ALTURA, BOX_GAP + BOX_ALTURA])
        grade.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ]))
        return grade

    grade = Table(
        [[_CaixaDestaque(dl[0].get("rotulo"), dl[0].get("valor")),
          _CaixaDestaque(dl[1].get("rotulo"), dl[1].get("valor"))],
         [_CaixaDestaque(dl[2].get("rotulo"), dl[2].get("valor")),
          _CaixaDestaque(dl[3].get("rotulo"), dl[3].get("valor"))]],
        colWidths=[BOX_LARGURA, BOX_GAP + BOX_LARGURA],
        rowHeights=[BOX_ALTURA, BOX_GAP + BOX_ALTURA])
    grade.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))

    hero = Table([[_CaixaImagem(imagem), grade]],
                 colWidths=[IMG_LARGURA, HERO_GAP + BOXES_LARGURA],
                 rowHeights=[HERO_ALTURA])
    hero.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
    return hero


def gerar_pdf(dados: Dict[str, Any],
              logo_bytes: Optional[bytes] = None,
              imagem_bytes: Optional[bytes] = None,
              contato_rodape: Optional[str] = None) -> bytes:
    """Monta o PDF e devolve os bytes.

    `dados`:
        nome_produto : str  (obrigatório)
        modelo       : str
        subtitulo    : str   — subtítulo técnico curto
        introducao   : str   — parágrafo objetivo
        destaques    : [{rotulo, valor}] até 4
        specs        : [{caracteristica, especificacao}]

    `contato_rodape`: só preenchido quando o operador pedir explicitamente
    (prompt, seção 2: sem contato no rodapé por padrão).
    """
    logo = _abre_imagem(logo_bytes)
    imagem = _abre_imagem(imagem_bytes)

    buf = io.BytesIO()
    doc = _Doc(buf, contato=contato_rodape)

    hist: List[Any] = [
        _Cabecalho(dados.get("nome_produto"), dados.get("modelo"),
                   dados.get("subtitulo"), logo),
        Spacer(1, 13),
    ]

    intro = _txt(dados.get("introducao"))
    if intro:
        hist.append(Paragraph(intro, EST_INTRO))
        hist.append(Spacer(1, 13))

    hist.append(_hero(imagem, dados.get("destaques") or []))
    hist.append(Spacer(1, 16))

    specs = dados.get("specs") or []
    if specs:
        hist.append(_tabela_specs(specs))

    doc.build(hist)
    return buf.getvalue()


def nome_arquivo(dados: Dict[str, Any]) -> str:
    """datasheet_kist_<produto>_<modelo>.pdf (prompt, seção 1)."""
    def _slug(s: str) -> str:
        s = _txt(s).lower()
        trocas = {"á": "a", "à": "a", "ã": "a", "â": "a", "é": "e", "ê": "e",
                  "í": "i", "ó": "o", "ô": "o", "õ": "o", "ú": "u", "ç": "c"}
        for k, v in trocas.items():
            s = s.replace(k, v)
        s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
        return re.sub(r"_+", "_", s)

    partes = [p for p in ("datasheet_kist", _slug(dados.get("nome_produto")),
                          _slug(dados.get("modelo"))) if p]
    return ("_".join(partes) or "datasheet_kist")[:120] + ".pdf"
