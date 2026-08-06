# -*- coding: utf-8 -*-
"""
ingestao.py — Kist Cabine de Compras
Converte QUALQUER entrada (.msg, .eml, planilha, PDF, imagem, texto colado) num
DOCUMENTO CANÔNICO: uma lista ORDENADA de blocos (texto, tabela, imagem, anexo).

═══════════════════════════════════════════════════════════════════════════
POR QUE ESTE MÓDULO EXISTE
═══════════════════════════════════════════════════════════════════════════
O norte: se o operador anexa o e-mail num chatbot qualquer e pergunta "quais
itens devo cotar", ele responde. O chatbot acerta porque NÃO HÁ MÁQUINA no meio
— ele recebe o documento e lê.

O /extrair errava porque tinha máquina no meio, e toda máquina precisava decidir
qual fonte vence:
  · piso de 5 KB           → tabela de 1 linha (1,4 KB) virava enfeite
  · teto de 4 imagens      → assinatura de 27 KB tomava a vaga da tabela
  · "anexo é o conteúdo"   → PDF cadastral sequestrava o corpo (RC 60938)
  · corpo cortado em 3.000 → 36 de 46 itens e o CNPJ descartados (Universal)
  · 1 chamada por anexo    → e-mail com 6 PDFs viraria 6 propostas

Não são cinco defeitos. É um: o e-mail era achatado em "um texto + um saco de
imagens sem ordem", e a partir daí toda decisão virava adivinhação.

Um e-mail é um documento linear: texto, tabela, imagem, texto, assinatura.
Este módulo preserva essa ordem e NÃO ELEGE VENCEDOR. Quem decide o que é
cotação é o modelo, lendo tudo — como o chatbot faz.

═══════════════════════════════════════════════════════════════════════════
MEDIDO NO CORPUS REAL (264 cotações de clientes do Kist app, 3 meses)
═══════════════════════════════════════════════════════════════════════════
  · 91% trazem imagem embutida no corpo → visão é o caminho PRINCIPAL
  · 54 de 64 partes de texto são iso-8859-1/windows-1252 → decode ingênuo
    de utf-8 apagaria acento em 84% dos e-mails, em silêncio
  · tabela HTML com colunas limpas é comum (Syntegon, Universal) → achatar
    em texto perde qual número é a quantidade
  · custo de mandar TODAS as imagens: pior caso 3.815 tokens. O teto de 4
    nunca economizou nada
"""

import hashlib
import io
import re
from html.parser import HTMLParser

__all__ = ["Bloco", "Documento", "ler_email", "ler_msg", "documento_de_texto",
           "documento_de_arquivo", "montar_payload", "consolidar_itens",
           "img_dimensao", "img_tokens", "img_descartavel"]


# ══════════════════════════════════════════════════════════════════════════
# ORÇAMENTO DE IMAGEM
# ══════════════════════════════════════════════════════════════════════════
IMG_MAX_N = 16
IMG_MAX_TOKENS = 8000       # ~US$ 0,024 de entrada no Sonnet, por extração
IMG_MIN_ALTURA = 12
IMG_MIN_LARGURA = 40
IMG_MIN_AREA = 1500
TEXTO_MAX_CHARS = 120000    # o corpo NUNCA é cortado antes disto


def img_dimensao(b: bytes) -> tuple:
    """(largura, altura) lendo só o cabeçalho. Sem Pillow, sem decodificar.
    Formato desconhecido → (0, 0); quem chama trata como "não sei" e MANTÉM a
    imagem. Errar mandando é barato; errar descartando apaga a cotação."""
    b = b or b""
    try:
        if b[:8] == b"\x89PNG\r\n\x1a\n" and b[12:16] == b"IHDR":
            return (int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big"))
        if b[:6] in (b"GIF87a", b"GIF89a"):
            return (int.from_bytes(b[6:8], "little"), int.from_bytes(b[8:10], "little"))
        if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
            if b[12:16] == b"VP8X":
                return (int.from_bytes(b[24:27], "little") + 1,
                        int.from_bytes(b[27:30], "little") + 1)
            if b[12:16] == b"VP8 ":
                return (int.from_bytes(b[26:28], "little") & 0x3FFF,
                        int.from_bytes(b[28:30], "little") & 0x3FFF)
            if b[12:16] == b"VP8L":
                n = int.from_bytes(b[21:25], "little")
                return ((n & 0x3FFF) + 1, ((n >> 14) & 0x3FFF) + 1)
        if b[:3] == b"\xff\xd8\xff":
            i, n = 2, len(b)
            while i + 9 < n:
                if b[i] != 0xFF:
                    i += 1
                    continue
                marc = b[i + 1]
                if marc in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                            0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    return (int.from_bytes(b[i + 7:i + 9], "big"),
                            int.from_bytes(b[i + 5:i + 7], "big"))
                if marc in (0xD8, 0xD9) or 0xD0 <= marc <= 0xD7:
                    i += 2
                    continue
                i += 2 + int.from_bytes(b[i + 2:i + 4], "big")
    except Exception:
        pass
    return (0, 0)


def img_tokens(b: bytes) -> int:
    """Tokens ≈ área/750, com o teto de 1568px que a API aplica antes de tokenizar."""
    w, h = img_dimensao(b)
    if not w or not h:
        return max(300, min(1600, len(b or b"") // 40))
    maior = max(w, h)
    if maior > 1568:
        f = 1568 / maior
        w, h = w * f, h * f
    return max(50, int((w * h) / 750))


def img_descartavel(b: bytes) -> bool:
    """True SÓ para o que não pode ser conteúdo: espaçador, filete, pixel.

    Deliberadamente estreito. Não tenta separar assinatura de tabela por
    geometria — medido no corpus, o banner da assinatura do Grupo Cesari é
    385x33 e a tabela de itens dele é 388x38; o logo da Universal é 257x33.
    Não existe corte. Quem separa é o modelo, lendo.
    """
    w, h = img_dimensao(b)
    if not w or not h:
        return False
    return h < IMG_MIN_ALTURA or w < IMG_MIN_LARGURA or (w * h) < IMG_MIN_AREA


# ══════════════════════════════════════════════════════════════════════════
# DECODIFICAÇÃO
# ══════════════════════════════════════════════════════════════════════════
_CHARSET_ALIAS = {
    "ansi_x3.4-1968": "cp1252", "us-ascii": "cp1252", "ascii": "cp1252",
    "iso-8859-1": "cp1252", "latin-1": "cp1252", "latin1": "cp1252",
    "unicode-1-1-utf-7": "utf-7",
}


def decodificar(dados: bytes, charset=None) -> str:
    """Decodifica respeitando o charset DECLARADO, com cadeia de fallback.

    Medido no corpus: só 10 de 64 partes de texto são utf-8; 54 são
    iso-8859-1 ou windows-1252. `dados.decode("utf-8", "ignore")` — que é o
    que o main.py faz em cinco lugares — apaga TODOS os acentos desses 84%
    sem erro nenhum. A descrição do cliente é sagrada neste sistema; ela não
    pode chegar no banco sem acento porque alguém supôs utf-8.

    iso-8859-1 é promovido a cp1252 de propósito: cp1252 é superconjunto e
    cobre aspas curvas e travessão do Word, que clientes usam o tempo todo e
    que em iso-8859-1 puro viram caractere de controle.
    """
    if not dados:
        return ""
    if isinstance(dados, str):
        return dados
    cs = (charset or "").strip().lower().strip('"\'')
    cs = _CHARSET_ALIAS.get(cs, cs)
    tentativas = [cs] if cs else []
    tentativas += ["utf-8", "cp1252", "latin-1"]
    for enc in tentativas:
        if not enc:
            continue
        try:
            return dados.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return dados.decode("utf-8", "replace")


# ══════════════════════════════════════════════════════════════════════════
# BLOCO / DOCUMENTO
# ══════════════════════════════════════════════════════════════════════════
class Bloco:
    """Um pedaço do documento, na posição em que ele aparece.

    tipo: 'texto' | 'tabela' | 'imagem' | 'anexo'
    """

    __slots__ = ("tipo", "texto", "dados", "nome", "citado", "meta")

    def __init__(self, tipo, texto="", dados=b"", nome="", citado=False, meta=None):
        self.tipo = tipo
        self.texto = texto or ""
        self.dados = dados or b""
        self.nome = nome or ""
        self.citado = bool(citado)
        self.meta = meta or {}

    def __repr__(self):
        det = self.nome or (self.texto[:36].replace("\n", " ") if self.texto else "")
        return f"<{self.tipo}{'/citado' if self.citado else ''} {det!r}>"


class Documento:
    """Um e-mail (ou arquivo solto) com seus blocos EM ORDEM DE LEITURA."""

    def __init__(self, origem="", remetente="", destinatario="", data="", blocos=None):
        self.origem = origem
        self.remetente = remetente
        self.destinatario = destinatario
        self.data = data
        self.blocos = blocos or []

    # ── consultas ────────────────────────────────────────────────────────
    def imagens(self, incluir_citado=True):
        return [b for b in self.blocos if b.tipo == "imagem"
                and (incluir_citado or not b.citado)]

    def cabecalho(self):
        p = []
        if self.origem:
            p.append(f"Assunto: {self.origem}")
        if self.remetente:
            p.append(f"De: {self.remetente}")
        if self.destinatario:
            p.append(f"Para: {self.destinatario}")
        if self.data:
            p.append(f"Data: {self.data}")
        return "\n".join(p)

    def render_texto(self, limite=TEXTO_MAX_CHARS):
        """O documento como TEXTO, em ordem, com a imagem marcada no lugar dela.

        A marca de imagem importa: sem ela o modelo recebe as figuras soltas no
        fim e não sabe que a tabela do item 3 vem logo depois do parágrafo que
        diz "segue abaixo". Com ela, o texto e a figura continuam ligados.
        """
        partes, n_img = [], 0
        cab = self.cabecalho()
        if cab:
            partes.append(cab)
        for b in self.blocos:
            if b.tipo == "imagem":
                n_img += 1
                marca = f"[IMAGEM {n_img}"
                if b.nome:
                    marca += f" — {b.nome}"
                marca += " — o conteúdo dela vai anexado a esta mensagem]"
                partes.append(marca)
            elif b.tipo == "tabela":
                partes.append("[TABELA]\n" + b.texto)
            elif b.tipo == "anexo":
                partes.append(f"[ANEXO — {b.nome}]\n{b.texto}")
            elif b.texto.strip():
                partes.append(b.texto)
        txt = "\n\n".join(p for p in partes if p and p.strip())
        return txt[:limite]


# ══════════════════════════════════════════════════════════════════════════
# HTML → BLOCOS (a peça central)
# ══════════════════════════════════════════════════════════════════════════
_QUOTE_TEXTO = re.compile(
    r'-{2,}\s*mensagem\s+original|_{10,}|'
    r'\bDe\s*:\s.{0,120}?\bEnviad[ao]\s+em\s*:|'
    r'\bFrom\s*:\s.{0,120}?\bSent\s*:|\bOn\b.{0,90}\bwrote\s*:', re.I | re.S)

_BLOCO_FIM = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "blockquote"}


class _LeitorHTML(HTMLParser):
    """Percorre o HTML LINEARMENTE e emite blocos na ordem em que aparecem.

    Linear de propósito, não DOM: a ordem de leitura é a informação que o
    achatamento destruía. Tabela vira bloco 'tabela' com as CÉLULAS separadas,
    porque no corpus a Syntegon e a Universal mandam Requisição|Código|
    Descrição|Qtde|Um em colunas limpas — e virar texto corrido faz o modelo
    ter que adivinhar qual número é a quantidade.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocos = []
        self._buf = []
        self._citado = 0          # profundidade de blockquote
        self._viu_marca_citacao = False
        self._tab = []            # pilha de tabelas (aninhadas)
        self._ignora = 0          # dentro de <style>/<script>

    # -- utilidades -----------------------------------------------------
    def _flush(self):
        txt = "".join(self._buf).strip()
        self._buf = []
        if txt:
            if self._tab:
                self._tab[-1]["celula"].append(txt)
            else:
                if _QUOTE_TEXTO.search(txt):
                    self._viu_marca_citacao = True
                self.blocos.append(Bloco("texto", texto=txt, citado=self._e_citado()))

    def _e_citado(self):
        return self._citado > 0 or self._viu_marca_citacao

    # -- eventos --------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("style", "script"):
            self._ignora += 1
            return
        if self._ignora:
            return
        if tag == "img":
            self._flush()
            src = (a.get("src") or "").strip()
            cid = src[4:].strip("<> ") if src.lower().startswith("cid:") else ""
            self.blocos.append(Bloco("imagem", nome=a.get("alt") or "",
                                     citado=self._e_citado(),
                                     meta={"cid": cid, "src": src[:200]}))
            return
        if tag == "blockquote":
            self._flush()
            self._citado += 1
            return
        if tag == "table":
            self._flush()
            self._tab.append({"linhas": [], "linha": [], "celula": []})
            return
        if tag == "tr" and self._tab:
            self._flush()
            self._tab[-1]["linha"] = []
            return
        if tag in ("td", "th") and self._tab:
            self._flush()
            self._tab[-1]["celula"] = []
            return
        if tag in _BLOCO_FIM:
            self._flush()

    def handle_endtag(self, tag):
        if tag in ("style", "script"):
            self._ignora = max(0, self._ignora - 1)
            return
        if self._ignora:
            return
        if tag == "blockquote":
            self._flush()
            self._citado = max(0, self._citado - 1)
            return
        if tag in ("td", "th") and self._tab:
            self._flush()
            cel = " ".join(x for x in self._tab[-1]["celula"] if x).strip()
            self._tab[-1]["linha"].append(cel)
            self._tab[-1]["celula"] = []
            return
        if tag == "tr" and self._tab:
            self._flush()
            if self._tab[-1]["celula"]:
                self._tab[-1]["linha"].append(
                    " ".join(self._tab[-1]["celula"]).strip())
                self._tab[-1]["celula"] = []
            self._tab[-1]["linhas"].append(list(self._tab[-1]["linha"]))
            self._tab[-1]["linha"] = []
            return
        if tag == "table" and self._tab:
            self._flush()
            t = self._tab.pop()
            if t["linha"]:
                t["linhas"].append(list(t["linha"]))
            self._emitir_tabela(t["linhas"])
            return
        if tag in _BLOCO_FIM:
            self._flush()

    def handle_data(self, d):
        if self._ignora:
            return
        if d and d.strip():
            self._buf.append(re.sub(r'[ \t\r\f\v]+', ' ', d))
        elif d and self._buf:
            self._buf.append(" ")

    # -- tabelas --------------------------------------------------------
    def _emitir_tabela(self, linhas):
        """Tabela de DADOS vira bloco 'tabela'; tabela de LAYOUT vira texto.

        O Outlook monta assinatura e o e-mail inteiro com <table>. Medido no
        corpus: 76% dos e-mails têm <table>, e a maioria esmagadora é layout.
        Critério: >=2 linhas E alguma linha com >=2 células preenchidas.
        """
        linhas = [[c for c in ln] for ln in linhas if any(c.strip() for c in ln)]
        if not linhas:
            return
        max_col = max(len(ln) for ln in linhas)
        cheias = sum(1 for ln in linhas if len([c for c in ln if c.strip()]) >= 2)
        if len(linhas) >= 2 and max_col >= 2 and cheias >= 2:
            txt = "\n".join(" | ".join(c.strip() for c in ln) for ln in linhas)
            self.blocos.append(Bloco("tabela", texto=txt, citado=self._e_citado(),
                                     meta={"linhas": len(linhas), "colunas": max_col}))
        else:
            for ln in linhas:
                t = " ".join(c.strip() for c in ln if c.strip()).strip()
                if t:
                    if _QUOTE_TEXTO.search(t):
                        self._viu_marca_citacao = True
                    self.blocos.append(Bloco("texto", texto=t, citado=self._e_citado()))

    def fechar(self):
        while self._tab:
            t = self._tab.pop()
            if t["celula"]:
                t["linha"].append(" ".join(t["celula"]))
            if t["linha"]:
                t["linhas"].append(t["linha"])
            self._emitir_tabela(t["linhas"])
        self._flush()
        return self.blocos


def html_para_blocos(html: str):
    p = _LeitorHTML()
    try:
        p.feed(html or "")
    except Exception:
        pass
    try:
        return p.fechar()
    except Exception:
        return p.blocos


def texto_para_blocos(txt: str):
    """Corpo em texto puro: quebra em parágrafos e marca o trecho citado."""
    blocos, citado = [], False
    for pedaco in re.split(r'\n\s*\n', txt or ""):
        pedaco = pedaco.strip("\n").rstrip()
        if not pedaco.strip():
            continue
        if _QUOTE_TEXTO.search(pedaco):
            citado = True
        blocos.append(Bloco("texto", texto=pedaco, citado=citado))
    return blocos


# ══════════════════════════════════════════════════════════════════════════
# E-MAIL → DOCUMENTO
# ══════════════════════════════════════════════════════════════════════════
_EXT_IMG = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
_EXT_XLS = (".xlsx", ".xls", ".xlsm", ".ods")


def _classificar_anexo(nome, ctype):
    n = (nome or "").lower()
    c = (ctype or "").lower()
    if n.endswith(_EXT_IMG) or c.startswith("image/"):
        return "imagem"
    if n.endswith(_EXT_XLS) or "spreadsheet" in c or "excel" in c:
        return "planilha"
    if n.endswith(".pdf") or c == "application/pdf":
        return "pdf"
    if n.endswith((".csv", ".txt")) or c in ("text/csv", "text/plain"):
        return "texto"
    if n.endswith((".docx", ".doc")) or "word" in c:
        return "word"
    return "outro"


def _encaixar_imagens(blocos, imagens_por_cid, imagens_soltas):
    """Liga cada marca <img cid:x> aos bytes correspondentes.

    Imagem anexa que o HTML NÃO referencia entra no fim, marcada — pode ser o
    print que o cliente anexou em vez de colar. Nunca é descartada por isso.
    """
    usados = set()
    for b in blocos:
        if b.tipo != "imagem":
            continue
        cid = (b.meta or {}).get("cid") or ""
        dados = imagens_por_cid.get(cid)
        if dados is None and cid:
            for k, v in imagens_por_cid.items():
                if k.split("@")[0] == cid.split("@")[0]:
                    dados, cid = v, k
                    break
        if dados is not None:
            b.dados = dados
            usados.add(cid)
    # remove marcas sem bytes (imagem remota, rastreador) e imagem-lixo
    limpos = []
    for b in blocos:
        if b.tipo == "imagem":
            if not b.dados or img_descartavel(b.dados):
                continue
            w, h = img_dimensao(b.dados)
            b.meta.update({"largura": w, "altura": h, "bytes": len(b.dados)})
        limpos.append(b)
    for nome, dados in imagens_soltas:
        if img_descartavel(dados):
            continue
        w, h = img_dimensao(dados)
        limpos.append(Bloco("imagem", nome=nome, dados=dados,
                            meta={"largura": w, "altura": h, "bytes": len(dados),
                                  "anexa": True}))
    return limpos


def ler_email(bruto, conversores=None):
    """bytes de .eml → Documento. `conversores` = {'pdf': f(bytes)->str,
    'planilha': f(bytes)->str, 'word': f(bytes)->str} (opcionais)."""
    import email
    import email.policy
    conversores = conversores or {}
    if isinstance(bruto, (bytes, bytearray)):
        msg = email.message_from_bytes(bytes(bruto), policy=email.policy.default)
    else:
        msg = bruto

    def cab(k):
        try:
            v = msg.get(k, "")
            return re.sub(r'\s+', ' ', str(v)).strip()
        except Exception:
            return ""

    html, texto = "", ""
    img_cid, img_soltas, anexos = {}, [], []
    vistos_hash = set()

    for p in msg.walk():
        if p.get_content_maintype() == "multipart":
            continue
        ctype = (p.get_content_type() or "").lower()
        nome = p.get_filename() or ""
        try:
            dados = p.get_payload(decode=True) or b""
        except Exception:
            dados = b""
        if not dados:
            continue
        disp = (p.get_content_disposition() or "").lower()
        cid = (p.get("Content-ID") or "").strip("<> ")

        if ctype == "text/html" and disp != "attachment" and not html:
            html = decodificar(dados, p.get_content_charset())
            continue
        if ctype == "text/plain" and disp != "attachment" and not nome and not texto:
            texto = decodificar(dados, p.get_content_charset())
            continue

        # ── dedup por conteúdo ────────────────────────────────────────
        # A corrente de resposta repete a MESMA tabela dentro do trecho
        # citado. Medido no corpus: 14 duplicatas em 26 arquivos. Sem isto o
        # modelo vê a lista duas vezes e a proposta sai com item dobrado.
        h = hashlib.md5(dados).hexdigest()
        if h in vistos_hash:
            continue
        vistos_hash.add(h)

        kind = _classificar_anexo(nome, ctype)
        if kind == "imagem":
            if cid:
                img_cid[cid] = dados
            else:
                img_soltas.append((nome or "imagem", dados))
        else:
            anexos.append((nome or f"anexo.{kind}", kind, dados))

    blocos = html_para_blocos(html) if html.strip() else texto_para_blocos(texto)
    blocos = _encaixar_imagens(blocos, img_cid, img_soltas)

    # anexos convertidos entram DEPOIS do corpo, como blocos próprios.
    # Nunca substituem o corpo: foi promover anexo a "conteúdo" e rebaixar o
    # corpo a contexto que esvaziou a proposta da Universal (NEG-0040613) e
    # fez o PDF cadastral sequestrar o RC 60938.
    for nome, kind, dados in anexos:
        conv = conversores.get(kind)
        txt = ""
        if conv:
            try:
                txt = conv(dados) or ""
            except Exception as e:
                txt = f"(não consegui ler este anexo: {type(e).__name__})"
        if kind == "texto" and not txt:
            txt = decodificar(dados)[:20000]
        if not txt:
            txt = "(anexo não convertido — o operador precisa abrir à mão)"
        blocos.append(Bloco("anexo", texto=txt[:40000], nome=nome,
                            meta={"kind": kind, "bytes": len(dados)}))

    return Documento(origem=cab("Subject"), remetente=cab("From"),
                     destinatario=cab("To"), data=cab("Date"), blocos=blocos)


def ler_msg(bruto, conversores=None, tmp_dir="/tmp"):
    """bytes de .msg (Outlook) → Documento, pelo MESMO caminho do .eml.

    `.msg` e `.eml` são o mesmo documento em duas embalagens: o operador arrasta
    `.msg` do Outlook, e qualquer automação por IMAP entrega `.eml`. Ter dois
    caminhos faria os dois divergirem em três meses — a partir daqui só muda
    quem monta os blocos.

    INVARIANTE: os bytes vão pra disco antes do extract_msg. O mount de upload é
    read-only e dá I/O error em acesso aleatório. Caminho ÚNICO por arquivo: com
    dois .msg na mesma extração, o caminho fixo era truncado pelo segundo
    enquanto o handle OLE do primeiro seguia aberto.
    """
    import extract_msg
    import os
    conversores = conversores or {}
    caminho = os.path.join(
        tmp_dir, f"ing_{hashlib.md5(bruto).hexdigest()[:16]}.msg")
    with open(caminho, "wb") as f:
        f.write(bruto)
    m = None
    try:
        m = extract_msg.openMsg(caminho)

        def _txt(v):
            if isinstance(v, (bytes, bytearray)):
                return decodificar(bytes(v))
            return v or ""

        html = _txt(getattr(m, "htmlBody", "") or "")
        corpo = _txt(getattr(m, "body", "") or "")

        img_cid, img_soltas, anexos = {}, [], []
        vistos = set()
        for att in (m.attachments or []):
            dados = getattr(att, "data", None)
            if not isinstance(dados, (bytes, bytearray)) or not dados:
                continue
            dados = bytes(dados)
            h = hashlib.md5(dados).hexdigest()
            if h in vistos:          # a corrente repete a mesma tabela
                continue
            vistos.add(h)
            nome = (getattr(att, "longFilename", None)
                    or getattr(att, "shortFilename", None) or "")
            cid = (getattr(att, "cid", "") or "").strip("<> ")
            kind = _classificar_anexo(nome, "")
            if kind == "imagem":
                if cid:
                    img_cid[cid] = dados
                else:
                    img_soltas.append((nome or "imagem", dados))
            else:
                anexos.append((nome or f"anexo.{kind}", kind, dados))

        blocos = html_para_blocos(html) if html.strip() else texto_para_blocos(corpo)
        blocos = _encaixar_imagens(blocos, img_cid, img_soltas)
        for nome, kind, dados in anexos:
            conv = conversores.get(kind)
            txt = ""
            if conv:
                try:
                    txt = conv(dados) or ""
                except Exception as e:
                    txt = f"(não consegui ler este anexo: {type(e).__name__})"
            if kind == "texto" and not txt:
                txt = decodificar(dados)[:20000]
            if not txt:
                txt = "(anexo não convertido — o operador precisa abrir à mão)"
            blocos.append(Bloco("anexo", texto=txt[:40000], nome=nome,
                                meta={"kind": kind, "bytes": len(dados)}))

        return Documento(origem=(getattr(m, "subject", "") or "").strip(),
                         remetente=(getattr(m, "sender", "") or "").strip(),
                         destinatario=(getattr(m, "to", "") or "").strip(),
                         data=str(getattr(m, "date", "") or "").strip(),
                         blocos=blocos)
    finally:
        try:
            if m is not None:
                m.close()
        except Exception:
            pass
        try:
            os.remove(caminho)
        except Exception:
            pass


def documento_de_texto(txt, origem=""):
    return Documento(origem=origem, blocos=texto_para_blocos(txt or ""))


def documento_de_arquivo(nome, dados, conversores=None):
    """Arquivo solto (não e-mail): planilha, PDF, imagem, texto."""
    conversores = conversores or {}
    kind = _classificar_anexo(nome, "")
    if kind == "imagem":
        if img_descartavel(dados):
            return Documento(origem=nome)
        w, h = img_dimensao(dados)
        return Documento(origem=nome, blocos=[Bloco(
            "imagem", nome=nome, dados=dados,
            meta={"largura": w, "altura": h, "bytes": len(dados)})])
    conv = conversores.get(kind)
    txt = ""
    if conv:
        try:
            txt = conv(dados) or ""
        except Exception as e:
            txt = f"(não consegui ler: {type(e).__name__})"
    if not txt and kind == "texto":
        txt = decodificar(dados)[:40000]
    return Documento(origem=nome, blocos=[Bloco("anexo", texto=txt or "", nome=nome,
                                                meta={"kind": kind})])


# ══════════════════════════════════════════════════════════════════════════
# DOCUMENTOS → PAYLOAD DA API
# ══════════════════════════════════════════════════════════════════════════
def montar_payload(documentos, texto_extra="", max_imgs=IMG_MAX_N,
                   max_tokens_img=IMG_MAX_TOKENS):
    """Uma ÚNICA chamada com TODOS os documentos, em ordem.

    Uma chamada, não uma por anexo. A quebra em propostas é decidida pelo
    DESTINO, dentro do conteúdo — e um e-mail da Universal com 6 PDFs é UMA
    demanda, não seis. Uma chamada por arquivo transformava isso em 6 abas.

    Devolve (content, relatorio) — `content` no formato da API, `relatorio`
    com o que entrou e o que ficou de fora, para virar nota ao operador.
    """
    content, imagens = [], []
    partes_txt = []

    for i, doc in enumerate(documentos, 1):
        cabec = f"═══ DOCUMENTO {i} de {len(documentos)} ═══" if len(documentos) > 1 else ""
        corpo = doc.render_texto()
        if corpo.strip():
            partes_txt.append((cabec + "\n" + corpo).strip())
        for b in doc.imagens():
            imagens.append((doc, b))
    if texto_extra and texto_extra.strip():
        partes_txt.append("═══ TEXTO COLADO PELO OPERADOR ═══\n" + texto_extra.strip())

    texto_final = "\n\n".join(partes_txt)[:TEXTO_MAX_CHARS]
    if texto_final:
        content.append({"type": "text", "text": texto_final})

    # ── seleção de imagem: ordem do documento, teto por TOKEN ────────────
    # Sem heurística de posição, tamanho ou geometria — todas erraram quando
    # medidas. Em resposta (25% do corpus) a tabela fica DEPOIS da assinatura,
    # então "corpo antes do rodapé" é falso. O orçamento é folgado o bastante
    # para a pergunta não precisar de resposta: pior e-mail do corpus custa
    # 3.815 tokens.
    sel, gasto, cortadas, vistos = [], 0, 0, set()
    prioridade = sorted(imagens, key=lambda t: (t[1].citado, ))  # não-citado antes
    for doc, b in prioridade:
        h = hashlib.md5(b.dados).hexdigest()
        if h in vistos:
            continue
        vistos.add(h)
        tk = img_tokens(b.dados)
        if sel and (gasto + tk > max_tokens_img or len(sel) >= max_imgs):
            cortadas += 1
            continue
        sel.append((doc, b, tk))
        gasto += tk

    if sel:
        content.append({"type": "text", "text": (
            f"Seguem as {len(sel)} imagem(ns) embutida(s), na ordem em que "
            "aparecem. Algumas são logo, banner ou assinatura e não têm item "
            "nenhum — ignore essas em silêncio, sem comentar. As tabelas de "
            "itens são o que importa.")})
    import base64
    for n, (doc, b, tk) in enumerate(sel, 1):
        rot = f"[IMAGEM {n}"
        if len(documentos) > 1 and doc.origem:
            rot += f" — do documento: {doc.origem[:90]}"
        if b.citado:
            rot += " — está dentro de um trecho de resposta citado"
        rot += "]"
        content.append({"type": "text", "text": rot})
        content.append({"type": "image", "source": {
            "type": "base64", "media_type": media_type(b.dados),
            "data": base64.standard_b64encode(b.dados).decode()}})

    relatorio = {
        "documentos": len(documentos),
        "chars_texto": len(texto_final),
        "imagens_enviadas": len(sel),
        "imagens_cortadas": cortadas,
        "tokens_imagem": gasto,
        "duplicadas_descartadas": len(imagens) - len(vistos),
    }
    return content, relatorio


def media_type(b: bytes) -> str:
    """Tipo REAL pelos bytes. O Outlook nomeia toda imagem inline de
    'image.png' seja qual for o formato, e a API devolve 400 quando o
    media_type declarado não bate com o conteúdo."""
    b = b or b""
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


# ══════════════════════════════════════════════════════════════════════════
# REGRA DE NEGÓCIO: linha idêntica repetida SOMA
# ══════════════════════════════════════════════════════════════════════════
def _chave_item(it):
    cod = str(it.get("codigo_cliente") or "").strip().lower()
    desc = re.sub(r'\s+', ' ', str(it.get("descricao_original")
                                   or it.get("descricao") or "")).strip().lower()
    un = str(it.get("unidade") or "").strip().lower()
    specs = re.sub(r'\s+', ' ', str(it.get("specs_complementares") or "")).strip().lower()
    return (cod, desc, un, specs)


def _num(v):
    try:
        return float(str(v).replace(".", "").replace(",", ".")) if isinstance(v, str) else float(v)
    except Exception:
        return 0.0


def consolidar_itens(itens):
    """Linha idêntica repetida DENTRO DA MESMA PROPOSTA soma as quantidades.

    Regra do operador, confirmada nos dados: na Syntegon RC 24202087 o cliente
    repetiu as mesmas 5 linhas na MESMA tabela, e a proposta 1050722 saiu com
    2/2/4/2/6 — somado, 5 itens, não 10.

    Isso hoje acontece por SORTE: nada no prompt manda somar, e a regra escrita
    diz o contrário ("NUNCA junte") — ela existe para itens em propostas
    DIFERENTES, mas o modelo pode aplicá-la aqui e devolver 10 linhas. Aí o
    valor da proposta dobra e ninguém percebe, porque 10 linhas parecem
    válidas. Determinístico aqui e a regra passa a existir de verdade.

    A quebra por DESTINO vem antes e não é tocada: isto roda DENTRO de uma
    proposta, ou seja, dentro de um destino. Item igual em destinos diferentes
    são duas entregas e continuam duas linhas, em propostas diferentes.
    """
    saida, indice = [], {}
    for it in itens or []:
        if not isinstance(it, dict):
            saida.append(it)
            continue
        k = _chave_item(it)
        if not any(k[:2]):                 # sem código e sem descrição: não agrupa
            saida.append(it)
            continue
        if k in indice:
            alvo = indice[k]
            alvo["quantidade"] = _num(alvo.get("quantidade")) + _num(it.get("quantidade"))
            alvo["_somado_de"] = alvo.get("_somado_de", 1) + 1
        else:
            novo = dict(it)
            indice[k] = novo
            saida.append(novo)
    return saida
