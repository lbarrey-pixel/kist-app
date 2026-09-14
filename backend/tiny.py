"""tiny.py — integração com a API v3 do Tiny (Olist).

POR QUE EXISTE
--------------
Hoje toda proposta da Kist vira um CSV que alguém importa à mão no Tiny. Isso
vale para os três sócios, não só para os agentes. Esta integração tira o passo
manual do caminho.

DESENHO
-------
OAuth2 (Keycloak). O fluxo tem três momentos e só o primeiro precisa de humano:

  1. O operador abre /tiny/autorizar e aprova no Tiny. Uma vez.
  2. O Tiny volta em /tiny/callback com um código; trocamos por access+refresh.
  3. Daí em diante o access é renovado sozinho pelo refresh, antes de expirar.

SEGREDOS
--------
client_id e client_secret vivem em variável de ambiente — nunca no código, nunca
no banco. Os tokens vivem no banco, numa tabela sem SELECT público, lidos e
gravados por RPC security definer. O refresh_token do Tiny alcança faturamento:
vazar isso é pior que vazar uma chave nossa.

O QUE ESTE MÓDULO NÃO FAZ
-------------------------
Não decide o que mandar para o Tiny. Ele transporta. A regra de negócio de o
que vira pedido, com que itens e que preço, fica em main.py, onde já está o
resto — e onde o invariante do CSV continua sendo a referência do formato.
"""
from __future__ import annotations

import os
import time
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import requests

AUTH_URL = os.environ.get(
    "TINY_AUTH_URL", "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth")
TOKEN_URL = os.environ.get(
    "TINY_TOKEN_URL", "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token")
API_BASE = os.environ.get("TINY_API_BASE", "https://api.tiny.com.br/public-api/v3")
CLIENT_ID = os.environ.get("TINY_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("TINY_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get(
    "TINY_REDIRECT_URI", "https://kist-backend.onrender.com/tiny/callback")

# Renova com folga: token que expira no meio de uma chamada vira erro que o
# operador não entende. 90s cobre a latência do Render mais a do Tiny.
FOLGA_S = 90

_sb_factory = None
_lock = threading.Lock()
_estados: dict = {}          # state -> timestamp (CSRF do OAuth)
_cache: dict = {"tok": None, "exp": 0.0}


def configurar(criar_supabase) -> None:
    global _sb_factory
    _sb_factory = criar_supabase


def _sb():
    if _sb_factory is None:
        raise RuntimeError("tiny.configurar() não foi chamado")
    return _sb_factory()


def configurado() -> bool:
    return bool(CLIENT_ID and CLIENT_SECRET)


# ── Autorização (uma vez, com humano) ────────────────────────────────────────
def url_autorizacao() -> str:
    """Monta a URL para o operador aprovar no Tiny.

    O `state` é anti-CSRF: sem ele, alguém poderia induzir o callback com um
    código próprio e conectar OUTRA conta Tiny à nossa instalação.
    """
    if not configurado():
        raise RuntimeError("TINY_CLIENT_ID/TINY_CLIENT_SECRET ausentes no ambiente")
    st = secrets.token_urlsafe(24)
    with _lock:
        agora = time.time()
        # limpa estados velhos de tentativas abandonadas
        for k, v in list(_estados.items()):
            if agora - v > 900:
                _estados.pop(k, None)
        _estados[st] = agora
    from urllib.parse import urlencode
    q = urlencode({
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid",
        "response_type": "code",
        "state": st,
    })
    return f"{AUTH_URL}?{q}"


def estado_valido(st: str) -> bool:
    with _lock:
        nasceu = _estados.pop(st, None)
    return bool(nasceu) and (time.time() - nasceu) <= 900


def trocar_codigo(code: str, por: str = "") -> dict:
    """Troca o código da autorização por access_token + refresh_token."""
    r = requests.post(TOKEN_URL, timeout=25, data={
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "code": code,
    })
    if r.status_code != 200:
        raise RuntimeError(f"Tiny recusou o código ({r.status_code}): {r.text[:200]}")
    return _guardar(r.json(), por=por)


def _guardar(d: dict, por: str = "") -> dict:
    agora = datetime.now(timezone.utc)
    exp = agora + timedelta(seconds=int(d.get("expires_in") or 3600))
    rexp = None
    if d.get("refresh_expires_in"):
        rexp = agora + timedelta(seconds=int(d["refresh_expires_in"]))
    try:
        _sb().rpc("tiny_token_gravar", {
            "p_access": d.get("access_token"),
            "p_refresh": d.get("refresh_token"),
            "p_expira": exp.isoformat(),
            "p_refresh_expira": rexp.isoformat() if rexp else None,
            "p_escopo": d.get("scope"),
            "p_conta": None,
            "p_por": por or None,
        }).execute()
    except Exception as e:
        raise RuntimeError(f"não consegui guardar o token: {e}")
    with _lock:
        _cache["tok"] = d.get("access_token")
        _cache["exp"] = time.time() + int(d.get("expires_in") or 3600) - FOLGA_S
    return {"expira_em": exp.isoformat(), "tem_refresh": bool(d.get("refresh_token"))}


# ── Uso corrente (sem humano) ────────────────────────────────────────────────
def _renovar(refresh: str) -> str:
    r = requests.post(TOKEN_URL, timeout=25, data={
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": refresh,
    })
    if r.status_code != 200:
        # Refresh morto = precisa de humano de novo. A mensagem tem que dizer
        # isso, senão vira "erro 400" e ninguém sabe o que fazer.
        raise RuntimeError(
            f"a autorização do Tiny expirou ({r.status_code}). "
            "Abra /tiny/autorizar e aprove novamente.")
    _guardar(r.json())
    return r.json().get("access_token")


def token() -> str:
    """Devolve um access_token válido, renovando se necessário."""
    with _lock:
        if _cache["tok"] and _cache["exp"] > time.time():
            return _cache["tok"]
    try:
        d = (_sb().rpc("tiny_token_ler", {}).execute().data or [])
    except Exception as e:
        raise RuntimeError(f"não consegui ler o token do Tiny: {e}")
    if not d:
        raise RuntimeError("Tiny não autorizado. Abra /tiny/autorizar uma vez.")
    linha = d[0]
    exp = linha.get("expira_em")
    if exp:
        try:
            quando = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
            if quando > datetime.now(timezone.utc) + timedelta(seconds=FOLGA_S):
                with _lock:
                    _cache["tok"] = linha["access_token"]
                    _cache["exp"] = quando.timestamp() - FOLGA_S
                return linha["access_token"]
        except Exception:
            pass
    if not linha.get("refresh_token"):
        raise RuntimeError("Tiny sem refresh_token. Abra /tiny/autorizar de novo.")
    return _renovar(linha["refresh_token"])


def chamar(metodo: str, caminho: str, **kw) -> Any:
    """Chamada à API do Tiny, com token renovado e erro legível.

    Uma repetição em caso de 401: o token pode ter morrido entre a validação e
    a chamada. Mais de uma repetição seria laço — e o Tiny limita a 30
    requisições por minuto POR CONTA, compartilhadas com qualquer outra
    integração que a Kist já tenha.
    """
    url = caminho if caminho.startswith("http") else f"{API_BASE}{caminho}"
    for tentativa in (1, 2):
        cab = {"Authorization": f"Bearer {token()}",
               "Content-Type": "application/json"}
        cab.update(kw.pop("headers", {}) if tentativa == 1 else {})
        r = requests.request(metodo.upper(), url, headers=cab, timeout=40, **kw)
        if r.status_code == 401 and tentativa == 1:
            with _lock:
                _cache["exp"] = 0.0        # força renovação
            continue
        if r.status_code == 429:
            raise RuntimeError(
                "Tiny recusou por limite de requisições (30/min por conta, "
                "compartilhado com outras integrações). Tente de novo em 1 minuto.")
        if r.status_code >= 400:
            raise RuntimeError(f"Tiny {r.status_code}: {r.text[:300]}")
        if not r.content:
            return None
        try:
            return r.json()
        except Exception:
            return r.text
    raise RuntimeError("Tiny recusou a autenticação duas vezes seguidas.")


def estado() -> dict:
    """Se está conectado, sem devolver segredo nenhum."""
    base = {"configurado": configurado(), "redirect_uri": REDIRECT_URI,
            "api_base": API_BASE}
    try:
        d = (_sb().rpc("tiny_estado", {}).execute().data or [])
        if d:
            base.update(d[0])
        else:
            base["conectado"] = False
    except Exception as e:
        base["conectado"] = None
        base["erro"] = str(e)[:150]
    return base
