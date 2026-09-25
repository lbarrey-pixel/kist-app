"""email_monitor.py — monitor automático de e-mail de cotação (v3.97).

POR QUE EXISTE
--------------
Regra do Leonardo, 25/09: o e-mail de cotação que chega de cliente conhecido
(Convergint, Universal, Grupo Cesari etc.) deve virar proposta na Cabine
sozinho — matching, Dwight, mediana — e ficar esperando revisão. O Leonardo
chega de manhã, abre as propostas marcadas, revisa e exporta pro Tiny ele
mesmo. Nada disto aqui chama o Tiny: a exportação continua manual, de
propósito (decisão do Leonardo, mesma conversa) — só o que vem ANTES da
revisão é automático.

DESENHO
-------
1. Entra na caixa (IMAP, e-mail hospedado na KingHost — sem Microsoft 365,
   sem Graph API disponível) a cada alguns minutos.
2. Busca só nos domínios de cliente conhecido (tabela `clientes_dominios`,
   a mesma fonte que o CRM usa pra "isso é cliente" — sem proposta prévia,
   sem entrada aqui).
3. Assunto tem que bater num filtro de palavras-chave de cotação (validado
   contra 146 assuntos reais de propostas já confirmadas: 96,6% de acerto —
   ver docs/versionamento). Sem bater, fica de fora do automático — o
   Leonardo trata como sempre tratou.
4. E-mail de RESPOSTA numa thread já vista (mesmo domínio + assunto
   normalizado, sem "RE:"/"ENC:"/etc.) é ignorado — regra explícita do
   Leonardo: reply de assunto conhecido não é pedido novo.
5. Passou nos dois filtros → chama `_extrair_nucleo` (a MESMA função que o
   `/extrair` da tela usa, sem HTTP) pra criar o rascunho com matching, marca
   `criado_via='email_auto'`, e aciona o Dwight pela rota normal
   (`/propostas/{numero}/pesquisa-dwight`) com uma chave de escopo
   `dwight_dispatch` — a MESMA trava (cotação real, teto de disparo) que
   vale pra qualquer outro agente que não seja o Leonardo na tela.

O QUE ISTO NÃO FAZ
-------------------
Não exporta pro Tiny. Não manda e-mail. Não decide preço nem markup (isso é
o motor de mediana, que já roda dentro do fluxo normal). Não lê nenhuma
caixa fora da lista de domínios conhecidos.

SEGREDOS
--------
KIST_IMAP_HOST / KIST_IMAP_USER / KIST_IMAP_PASSWORD (Render). Sem as três,
o monitor não inicia — silencioso, não derruba o backend. A chave do Dwight
(KIST_EMAIL_MONITOR_DWIGHT_KEY) é uma chave de API comum, escopo
'dwight_dispatch', igual a qualquer chave de agente.
"""
from __future__ import annotations

import email
import imaplib
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime

import requests
from supabase import create_client

log = logging.getLogger("email_monitor")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://owpmcoithvzdlhmfkvbe.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
CABINE_PUBLIC_URL = os.environ.get("CABINE_PUBLIC_URL", "https://kist-backend.onrender.com").rstrip("/")

IMAP_HOST = os.environ.get("KIST_IMAP_HOST", "")
IMAP_USER = os.environ.get("KIST_IMAP_USER", "")
IMAP_PASSWORD = os.environ.get("KIST_IMAP_PASSWORD", "")
DWIGHT_DISPATCH_KEY = os.environ.get("KIST_EMAIL_MONITOR_DWIGHT_KEY", "")
DONO_EMAIL = os.environ.get("KIST_EMAIL_MONITOR_DONO", "leonardobarrey@gmail.com").strip().lower()

INTERVALO_S = int(os.environ.get("KIST_EMAIL_MONITOR_INTERVALO_S", "300"))  # 5 min
JANELA_DIAS = 3   # busca redundante de propósito — o message_id evita reprocessar

# Regra do Leonardo, 25/09: nunca entrar no passado — só processa e-mail
# recebido a partir de HOJE (o dia em que o monitor foi ligado de vez em
# produção). Evita reabrir/duplicar cotação de dias atrás que ele já tratou
# na mão. Ajustável por variável de ambiente se precisar mudar o piso depois.
DATA_MINIMA = os.environ.get("KIST_EMAIL_MONITOR_DATA_MINIMA", "2026-09-25")

# Validado em 25/09 contra 146 assuntos reais de propostas confirmadas
# (usuario_email = Leonardo): 141 bateram (96,6%). Os 5 que não batem são
# assunto de item/anexo sem palavra de pedido — ficam fora do automático.
#
# \b em TODA alternativa: sem isso, "licita[çc][aã]o" batia como SUBSTRING
# dentro de "soLICITAÇÃO" — ou seja, qualquer "Solicitação de..." (quase
# todo assunto real) passava pelo ramo de licitação por acidente. Achado
# rodando o filtro contra e-mail real (dry-run, 25/09) antes de ligar em
# produção — nenhuma proposta chegou a nascer por causa disso.
#
# "pedido de compra" (sem "solicitação"/"cotação" na frente) foi removido:
# testado contra os 146 assuntos reais confirmados, ele nunca é o único
# motivo de um acerto (tudo que ele pega, outro ramo também pega) — e no
# e-mail real ele batia em CONFIRMAÇÃO de PO já emitida ("RE: CONFIRMAÇÃO
# PEDIDO DE COMPRA || OC 115452"), que não é cotação nova nenhuma.
_RE_COTACAO = re.compile(
    r"\bcota[cç][aã]o|\bsolicit.{0,15}cota|\brfq|\bor[çc]amento|"
    r"\bsolicit.{0,15}compra|\bsolicit.{0,15}proposta|\blicita[çc][aã]o|\bRC\s*\d|\bpreg[aã]o",
    re.I,
)

_RE_PREFIXO_REPLY = re.compile(
    r"^\s*(re|res|enc|fw|fwd|encam|resposta\s+autom[aá]tica)\s*:\s*", re.I,
)


def _normalizar_assunto(assunto: str) -> str:
    """Tira prefixo de resposta/encaminhamento (repetido ou não) e uniformiza
    espaço/caixa, pra comparar 'é a mesma conversa de antes?'."""
    s = assunto or ""
    while True:
        novo = _RE_PREFIXO_REPLY.sub("", s)
        if novo == s:
            break
        s = novo
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def _decodificar(valor):
    if not valor:
        return ""
    partes = decode_header(valor)
    saida = []
    for texto, cod in partes:
        if isinstance(texto, bytes):
            try:
                saida.append(texto.decode(cod or "utf-8", errors="replace"))
            except LookupError:
                saida.append(texto.decode("utf-8", errors="replace"))
        else:
            saida.append(texto)
    return "".join(saida)


def _dominio_do_endereco(addr: str) -> str:
    _, email_addr = parseaddr(addr or "")
    return email_addr.split("@")[-1].lower() if "@" in email_addr else ""


def _corpo_e_anexos(msg: email.message.Message):
    """Extrai o texto (prioriza text/plain) e a lista [(nome, bytes), ...] de
    anexos de um e-mail já parseado."""
    corpo_partes = []
    anexos = []
    if msg.is_multipart():
        for parte in msg.walk():
            content_type = parte.get_content_type()
            disposicao = str(parte.get("Content-Disposition") or "")
            nome = parte.get_filename()
            if nome:
                nome = _decodificar(nome)
            if "attachment" in disposicao.lower() or (nome and "inline" not in disposicao.lower()):
                try:
                    payload = parte.get_payload(decode=True)
                except Exception:
                    payload = None
                if payload:
                    anexos.append((nome or f"anexo_{len(anexos) + 1}", payload))
                continue
            if content_type == "text/plain" and "attachment" not in disposicao.lower():
                try:
                    charset = parte.get_content_charset() or "utf-8"
                    corpo_partes.append(parte.get_payload(decode=True).decode(charset, errors="replace"))
                except Exception:
                    pass
    else:
        try:
            charset = msg.get_content_charset() or "utf-8"
            payload = msg.get_payload(decode=True)
            if payload:
                corpo_partes.append(payload.decode(charset, errors="replace"))
        except Exception:
            pass
    corpo = "\n".join(p for p in corpo_partes if p).strip()
    if not corpo:
        corpo = "[sem texto simples no corpo — ver anexos]"
    return corpo, anexos


def _dominios_conhecidos(sb) -> list[str]:
    r = (sb.table("clientes_dominios").select("dominio")
           .eq("usuario_email", DONO_EMAIL).execute())
    return sorted({(l.get("dominio") or "").lower() for l in (r.data or []) if l.get("dominio")})


def _ja_visto(sb, message_id: str) -> bool:
    r = (sb.table("email_cotacoes_monitor").select("id")
           .eq("message_id", message_id).limit(1).execute())
    return bool(r.data)


def _thread_conhecida(sb, dominio: str, assunto_norm: str) -> bool:
    if not assunto_norm:
        return False
    r = (sb.table("email_cotacoes_monitor").select("id")
           .eq("dominio", dominio).eq("assunto_normalizado", assunto_norm)
           .eq("bateu_filtro", True).limit(1).execute())
    return bool(r.data)


def _registrar(sb, *, message_id, dominio, remetente, assunto, assunto_norm,
                data_email, bateu_filtro, motivo, proposta_numero=None):
    try:
        sb.table("email_cotacoes_monitor").insert({
            "message_id": message_id, "dominio": dominio, "remetente": remetente,
            "assunto": assunto, "assunto_normalizado": assunto_norm,
            "data_email": data_email, "bateu_filtro": bateu_filtro, "motivo": motivo,
            "proposta_numero": proposta_numero,
        }).execute()
    except Exception as e:
        log.warning("email_monitor: falhou registrar %s: %s", message_id, e)


def _marcar_em_processamento(sb, *, message_id, dominio, remetente, assunto,
                              assunto_norm, data_email):
    """Grava a linha de controle ANTES de chamar `_extrair_nucleo`, não
    depois (correção v3.99). Achado em produção, 25/09: um restart do Render
    no meio de um e-mail grande do Universal (várias propostas, uma por
    destino) matou o processo antes dele chegar no registro final — o
    próximo ciclo, sem saber que aquele e-mail já tinha sido tentado,
    reprocessou tudo de novo e duplicou. Registrando aqui, o `message_id` já
    conta como visto mesmo se o processo morrer no meio; o pior caso vira
    "ficou em_processamento e não terminou" (raro, só em restart), não mais
    "duplicou a proposta inteira"."""
    try:
        sb.table("email_cotacoes_monitor").upsert({
            "message_id": message_id, "dominio": dominio, "remetente": remetente,
            "assunto": assunto, "assunto_normalizado": assunto_norm,
            "data_email": data_email, "bateu_filtro": True, "motivo": "em_processamento",
        }, on_conflict="message_id").execute()
    except Exception as e:
        log.warning("email_monitor: falhou marcar em_processamento %s: %s", message_id, e)


def _finalizar_registro(sb, message_id: str, *, motivo: str, proposta_numero=None):
    try:
        sb.table("email_cotacoes_monitor").update({
            "motivo": motivo, "proposta_numero": proposta_numero,
        }).eq("message_id", message_id).execute()
    except Exception as e:
        log.warning("email_monitor: falhou finalizar registro %s: %s", message_id, e)


def _acionar_dwight(numero: str):
    """Aciona o motor KISTBOT DWIGHT (`/pesquisa-kistbot-dwight`), não o Dwight
    "normal" (`/pesquisa-dwight`) — são dois motores distintos (`_motores()`
    em main.py), com webhook e chave próprios (`KISTBOTS_DWIGHT_WEBHOOK_*`).
    Regra do Leonardo, 25/09."""
    if not DWIGHT_DISPATCH_KEY:
        log.warning("email_monitor: sem KIST_EMAIL_MONITOR_DWIGHT_KEY — proposta %s "
                    "criada, mas KistBot Dwight NÃO foi acionado.", numero)
        return
    try:
        r = requests.post(
            f"{CABINE_PUBLIC_URL}/propostas/{numero}/pesquisa-kistbot-dwight",
            json={"somente_sem_match": True},
            headers={"Authorization": f"Bearer {DWIGHT_DISPATCH_KEY}"},
            timeout=20,
        )
        if r.status_code >= 300:
            log.warning("email_monitor: pesquisa-kistbot-dwight recusou %s: %s %s",
                        numero, r.status_code, r.text[:300])
    except Exception as e:
        log.warning("email_monitor: falhou acionar KistBot Dwight pra %s: %s", numero, e)


def _processar_email(sb, msg: email.message.Message, dominio: str):
    message_id = (msg.get("Message-ID") or "").strip()
    if not message_id:
        return  # sem Message-ID não dá pra deduplicar com segurança — pula
    if _ja_visto(sb, message_id):
        return

    remetente = _decodificar(msg.get("From"))
    assunto = _decodificar(msg.get("Subject"))
    assunto_norm = _normalizar_assunto(assunto)
    try:
        data_email = parsedate_to_datetime(msg.get("Date")).isoformat()
    except Exception:
        data_email = None

    bate = bool(_RE_COTACAO.search(assunto))
    if not bate:
        _registrar(sb, message_id=message_id, dominio=dominio, remetente=remetente,
                   assunto=assunto, assunto_norm=assunto_norm, data_email=data_email,
                   bateu_filtro=False, motivo="sem_palavra_de_cotacao")
        return

    if _thread_conhecida(sb, dominio, assunto_norm):
        _registrar(sb, message_id=message_id, dominio=dominio, remetente=remetente,
                   assunto=assunto, assunto_norm=assunto_norm, data_email=data_email,
                   bateu_filtro=False, motivo="reply_de_thread_conhecida")
        return

    # Marca ANTES de processar (ver _marcar_em_processamento) — um restart
    # daqui pra baixo não reprocessa nem duplica este e-mail.
    _marcar_em_processamento(sb, message_id=message_id, dominio=dominio, remetente=remetente,
                              assunto=assunto, assunto_norm=assunto_norm, data_email=data_email)

    corpo, anexos = _corpo_e_anexos(msg)
    texto_fonte = f"Assunto: {assunto}\nDe: {remetente}\nData: {data_email or ''}\n\n{corpo}"

    # Import tardio: evita ciclo (main importa este módulo, no fim do arquivo).
    from main import _extrair_nucleo, _salvar_proposta_nucleo

    numero_criado = None
    try:
        resultado = _extrair_nucleo(
            sb, DONO_EMAIL, "", "0", "0", texto_fonte, anexos, [], criar_rascunhos=True,
        )
        # `_extrair_nucleo` só grava o CABEÇALHO da proposta (via `_criar_rascunho`)
        # — os itens do match ficam só na resposta, em memória. É `/salvar-proposta`
        # (aqui chamado direto, mesma função) que persiste `itens_proposta` de
        # verdade; sem isto a proposta nascia vazia e o Dwight não achava item
        # nenhum pra pesquisar (achado testando contra a caixa real, 25/09).
        numeros = []
        for p in (resultado.get("propostas") or []):
            numero = p.get("proposta")
            if not numero:
                continue
            _salvar_proposta_nucleo(sb, DONO_EMAIL, {
                "proposta": numero,
                "cliente": p.get("cliente") or "",
                "cnpj": p.get("cnpj"),
                "itens": p.get("itens") or [],
                "status": "rascunho",
                "usuario_nome": "Monitor de e-mail",
                "fonte_texto": p.get("fonte_texto") or texto_fonte,
                "assunto_email": assunto,
            })
            numeros.append(numero)
        if numeros:
            numero_criado = ", ".join(numeros)
            sb.table("propostas").update({"criado_via": "email_auto"}) \
              .in_("numero_proposta", numeros).execute()
            for num in numeros:
                _acionar_dwight(num)
    except Exception as e:
        log.error("email_monitor: falhou processar %s (%s): %s", message_id, assunto, e)
        _finalizar_registro(sb, message_id, motivo=f"erro_extracao: {type(e).__name__}: {e}"[:500])
        return

    _finalizar_registro(sb, message_id, motivo="processado", proposta_numero=numero_criado)
    log.info("email_monitor: %s -> proposta(s) %s (revisão pendente)", assunto, numero_criado)


def _rodar_ciclo(sb):
    dominios = _dominios_conhecidos(sb)
    if not dominios:
        log.info("email_monitor: nenhum domínio conhecido em clientes_dominios pra %s.", DONO_EMAIL)
        return

    m = imaplib.IMAP4_SSL(IMAP_HOST, 993, timeout=30)
    try:
        m.login(IMAP_USER, IMAP_PASSWORD)
        m.select("INBOX", readonly=True)
        # Nunca busca antes de DATA_MINIMA (regra do Leonardo, 25/09) — a janela
        # rolante de JANELA_DIAS só existe pra aguentar o monitor ficar fora do
        # ar por um tempo sem perder e-mail; ela não pode empurrar a busca pra
        # antes do piso.
        piso = datetime.strptime(DATA_MINIMA, "%Y-%m-%d")
        desde_dt = max(datetime.now() - timedelta(days=JANELA_DIAS), piso)
        desde = desde_dt.strftime("%d-%b-%Y")
        for dominio in dominios:
            typ, dados = m.search(None, f'(SINCE {desde} FROM "{dominio}")')
            if typ != "OK":
                continue
            for msg_id in dados[0].split():
                typ, msg_data = m.fetch(msg_id, "(BODY.PEEK[])")
                if typ != "OK" or not msg_data or not msg_data[0]:
                    continue
                try:
                    msg = email.message_from_bytes(msg_data[0][1])
                    _processar_email(sb, msg, dominio)
                except Exception as e:
                    log.error("email_monitor: erro lendo mensagem %s de %s: %s", msg_id, dominio, e)
    finally:
        try:
            m.logout()
        except Exception:
            pass


def _loop():
    if not (IMAP_HOST and IMAP_USER and IMAP_PASSWORD):
        log.info("email_monitor: KIST_IMAP_HOST/USER/PASSWORD não configurados — monitor desligado.")
        return
    log.info("email_monitor: iniciado (host=%s, dono=%s, intervalo=%ss).",
              IMAP_HOST, DONO_EMAIL, INTERVALO_S)
    while True:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)  # conexão própria por ciclo — thread isolada
        try:
            _rodar_ciclo(sb)
        except Exception as e:
            log.error("email_monitor: ciclo falhou: %s", e)
        time.sleep(INTERVALO_S)


def iniciar():
    """Chamado uma vez, na subida do backend. Não faz nada se faltar segredo —
    silencioso de propósito, pra nunca derrubar o resto da API."""
    threading.Thread(target=_loop, daemon=True).start()
