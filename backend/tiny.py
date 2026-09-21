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

# Limite do codigo do produto no Tiny. A proposta 1050862 falhou com um SKU de
# 47 caracteres derivado da descricao ("BATERIA-SELADA-UNIPOWER-12V-12A-UNIPOWER-UP12120");
# a mesma proposta passou com "UP-12120". Codigo curto tambem e mais util para
# quem procura o produto na tela depois.
LIMITE_SKU = 30

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
    extra_cab = kw.pop("headers", {}) or {}
    ja_renovou, ja_esperou = False, False
    # v3.72: até 3 tentativas — uma para token vencido (401), uma para limite
    # de requisições (429). O limite é de 30/min POR CONTA, dividido com os
    # bots do Fábio: estourar no meio de uma exportação era o que fazia a
    # busca de contato "não achar" cliente que existia.
    for _ in range(3):
        cab = {"Authorization": f"Bearer {token()}",
               "Content-Type": "application/json", **extra_cab}
        r = requests.request(metodo.upper(), url, headers=cab, timeout=40, **kw)
        if r.status_code == 401 and not ja_renovou:
            ja_renovou = True
            with _lock:
                _cache["exp"] = 0.0        # força renovação
            continue
        if r.status_code == 429 and not ja_esperou:
            ja_esperou = True
            try:
                espera = float(r.headers.get("Retry-After") or 20)
            except (TypeError, ValueError):
                espera = 20.0
            time.sleep(max(1.0, min(espera, 30.0)))
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


# ── Orçamento (proposta comercial) ───────────────────────────────────────────
# O Tiny chama de "orçamento" o que a Kist chama de proposta. É o conceito
# certo: a venda só existe quando o cliente aprova e devolve a PO — e o Tiny
# tem rota para converter orçamento em pedido nesse momento.

def _digitos(v) -> str:
    return "".join(c for c in str(v or "") if c.isdigit())


def resolver_contato(cnpj: str) -> dict:
    """Localiza o cliente no Tiny pelo CNPJ/CPF — pelo contrato OFICIAL (v3.72).

    Documentação Olist ERP API v3, GET /contatos: o filtro é `cpfCnpj`. A versão
    anterior tentava 5 parâmetros × 2 formatos = até 10 chamadas por busca, 8
    delas com nomes que a API não documenta. Com o limite de 30/min dividido
    com os bots do Fábio, isso estourava — e o erro era engolido como "não
    achei". Agora: só `cpfCnpj`, só em dois formatos (dígitos e mascarado),
    e o resultado diz EXATAMENTE o que aconteceu.

    status:
      "encontrado"    -> `contato` preenchido (prefere ativo; avisa inativo/duplicado)
      "ausente"       -> a API respondeu e não existe ninguém com esse documento
      "excluido"      -> existe, mas só como EXCLUÍDO no Tiny (não dá para usar
                         nem recadastrar por cima sem decidir o que fazer)
      "indeterminado" -> a API falhou; NÃO se sabe se existe (nunca cadastrar aqui)
      "invalido"      -> documento com tamanho errado
    """
    dig = _digitos(cnpj)
    if len(dig) not in (11, 14):
        return {"status": "invalido", "contato": None, "avisos": [], "tentativas": [],
                "erro": f"documento com {len(dig)} dígitos"}
    tentativas, achados, erro = [], [], ""
    for valor in (dig, _cnpj_mascarado(dig)):
        try:
            r = chamar("GET", "/contatos", params={"cpfCnpj": valor, "limit": 20})
        except Exception as e:
            erro = str(e)[:300]
            tentativas.append({"cpfCnpj": valor, "erro": erro})
            continue
        itens = (r or {}).get("itens") or []
        tentativas.append({"cpfCnpj": valor, "retornou": len(itens)})
        for c in itens:
            if _digitos(c.get("cpfCnpj")) == dig and all(c.get("id") != a.get("id") for a in achados):
                achados.append(c)
        if achados:
            break

    usaveis = [c for c in achados if str(c.get("situacao") or "B").upper() != "E"]
    if usaveis:
        ativos = [c for c in usaveis if str(c.get("situacao") or "B").upper() in ("B", "A")]
        pool = ativos or usaveis
        escolhido = sorted(pool, key=lambda c: int(c.get("id") or 0))[0]
        avisos = []
        if len(usaveis) > 1:
            avisos.append(f"Há {len(usaveis)} contatos com este documento no Tiny; usei o id "
                          f"{escolhido.get('id')} ({'ativo' if ativos else 'inativo'}, o mais antigo).")
        if str(escolhido.get("situacao") or "B").upper() == "I":
            avisos.append("O contato está INATIVO no Tiny. O orçamento vai para ele mesmo assim; "
                          "reative no Tiny se for voltar a vender para este cliente.")
        return {"status": "encontrado", "contato": escolhido, "avisos": avisos,
                "tentativas": tentativas, "erro": ""}
    if achados:
        return {"status": "excluido", "contato": achados[0], "avisos": [],
                "tentativas": tentativas,
                "erro": "o cliente existe no Tiny, mas está EXCLUÍDO"}
    if erro:
        return {"status": "indeterminado", "contato": None, "avisos": [],
                "tentativas": tentativas, "erro": erro}
    return {"status": "ausente", "contato": None, "avisos": [], "tentativas": tentativas,
            "erro": ""}


def achar_contato(cnpj: str) -> Optional[dict]:
    """Compatibilidade: o contato encontrado, ou None se ausente.

    Levanta erro quando NÃO dá para saber (API fora, token, limite) ou quando o
    contato está excluído — nesses dois casos "None" levaria a um cadastro
    duplicado no ERP.
    """
    res = resolver_contato(cnpj)
    if res["status"] == "encontrado":
        return res["contato"]
    if res["status"] in ("ausente", "invalido"):
        return None
    raise RuntimeError(res["erro"] or res["status"])


def _cnpj_mascarado(d: str) -> str:
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return d


_tipo_cliente_cache: dict = {}


def tipo_contato_cliente_id() -> Optional[int]:
    """Id do tipo de contato "Cliente" nesta conta (GET /contatos/tipos).

    O cadastro recebe `tipos: [id]` — lista de INTEIROS, um por tipo. O id muda
    de conta para conta, por isso é consultado (uma vez por processo) em vez de
    fixado. Falhar aqui não impede o cadastro: o contato só nasce sem tipo.
    """
    if "id" in _tipo_cliente_cache:
        return _tipo_cliente_cache["id"]
    try:
        r = chamar("GET", "/contatos/tipos", params={"limit": 100})
    except Exception:
        return None
    escolhido = None
    for t in (r or {}).get("itens") or []:
        if str(t.get("perfilContato")) == "1":
            escolhido = t.get("id")
            break
    if escolhido is None:
        for t in (r or {}).get("itens") or []:
            if "cliente" in str(t.get("nome") or "").lower():
                escolhido = t.get("id")
                break
    _tipo_cliente_cache["id"] = escolhido
    return escolhido


def montar_corpo_contato(cnpj: str, receita: dict, tipo_cliente_id: Optional[int] = None) -> dict:
    """Corpo do POST /contatos, só com campos DOCUMENTADOS (v3.72). Função pura.

    Corrige a v3.69, que mandava `situacao: "A"` (no Tiny, contato "A" é "Ativo
    COM ACESSO AO SISTEMA" — o certo é "B", Ativo), `tiposContato` (campo que
    não existe; o certo é `tipos`, lista de ids) e `codigo` = CNPJ (o código é
    do Tiny, não nosso).
    """
    dig = _digitos(cnpj)
    receita = receita or {}
    tipo_log = str(receita.get("descricao_tipo_de_logradouro") or "").strip()
    logradouro = str(receita.get("logradouro") or "").strip()
    if tipo_log and logradouro and not logradouro.upper().startswith(tipo_log.upper()):
        logradouro = f"{tipo_log} {logradouro}"
    cep = _digitos(receita.get("cep"))
    if len(cep) == 8:
        cep = f"{cep[:5]}-{cep[5:]}"
    nome = str(receita.get("razao_social") or "").strip()
    fantasia = str(receita.get("nome_fantasia") or "").strip()
    corpo = {
        "nome": (nome or fantasia or f"CNPJ {_cnpj_mascarado(dig)}")[:100],
        "tipoPessoa": "J" if len(dig) == 14 else "F",
        "cpfCnpj": _cnpj_mascarado(dig),
        "situacao": "B",
    }
    if fantasia:
        corpo["fantasia"] = fantasia[:60]
    email = str(receita.get("email") or "").strip().lower()
    if email and "@" in email:
        corpo["email"] = email[:100]
    tel = str(receita.get("ddd_telefone_1") or "").strip()
    if tel:
        corpo["telefone"] = tel[:20]
    if logradouro or receita.get("municipio"):
        corpo["endereco"] = {
            "endereco": logradouro[:100],
            "numero": str(receita.get("numero") or "S/N").strip()[:15] or "S/N",
            "complemento": str(receita.get("complemento") or "").strip()[:60],
            "bairro": str(receita.get("bairro") or "").strip()[:60],
            "municipio": str(receita.get("municipio") or "").strip()[:60],
            "cep": cep,
            "uf": str(receita.get("uf") or "").strip().upper()[:2],
            "pais": "Brasil",
        }
    if tipo_cliente_id:
        corpo["tipos"] = [int(tipo_cliente_id)]
    return corpo


def criar_contato(cnpj: str, receita: dict) -> dict:
    """Cadastra o cliente no Tiny (POST /contatos). A API devolve só `{id}`;
    o nome e o corpo enviado voltam junto para a Cabine mostrar o que criou."""
    if len(_digitos(cnpj)) not in (11, 14):
        raise RuntimeError(f"documento inválido para cadastro: {cnpj!r}")
    corpo = montar_corpo_contato(cnpj, receita, tipo_contato_cliente_id())
    r = chamar("POST", "/contatos", json=corpo)
    cid = (r or {}).get("id")
    if not cid:
        raise RuntimeError("o Tiny aceitou o cadastro mas não devolveu o id do contato")
    return {"id": cid, "nome": corpo["nome"], "cpfCnpj": corpo["cpfCnpj"],
            "situacao": "B", "corpo_enviado": corpo}


def achar_produto(sku: str) -> Optional[dict]:
    """Produto pelo código/SKU (GET /produtos?codigo=) — parâmetro DOCUMENTADO.

    A versão anterior tentava 7 parâmetros por item (6 inexistentes na API) —
    numa proposta de 15 itens, até 105 consultas contra um limite de 30/min.
    Excluído não conta como existente. Erro de API sobe: tratar falha como
    "não existe" cadastrava o produto duas vezes.
    """
    s_ = (sku or "").strip()
    if not s_:
        return None
    r = chamar("GET", "/produtos", params={"codigo": s_, "limit": 20})
    for p in (r or {}).get("itens") or []:
        if (str(p.get("sku") or "").strip().upper() == s_.upper()
                and str(p.get("situacao") or "A").upper() != "E"):
            return p
    return None


def garantir_produtos(corpo: dict) -> list:
    """Resolve o `produto.id` de cada item ANTES de enviar o orçamento (v3.72).

    Pela documentação, o item do orçamento só aceita `produto: {id}` (id
    obrigatório). A versão anterior mandava sku/descrição, esperava o Tiny
    recusar, e só então resolvia — uma chamada perdida por exportação. Agora:
    procura pelo código; se não existir, cadastra; e devolve a lista do que foi
    reaproveitado ou criado, para a Cabine mostrar.

    ATENÇÃO ao campo `tipo`: no CADASTRO de produto, "S" = simples ("P" é
    recusado); no item do orçamento ele nem vai — só o id.
    """
    resolvidos = []
    cache: dict = {}
    for it in corpo.get("itens", []):
        p = it.get("produto") or {}
        if p.get("id"):
            continue
        sku = (p.get("sku") or "").strip()[:LIMITE_SKU]
        if sku.upper() in cache:
            it["produto"] = {"id": cache[sku.upper()]}
            continue
        achado = achar_produto(sku)
        if achado and achado.get("id"):
            pid = achado["id"]
            resolvidos.append({"sku": sku, "id": pid, "acao": "reaproveitado"})
        else:
            cadastro = {
                "sku": sku,
                "descricao": (p.get("descricao") or "")[:120],
                "tipo": "S",
                "unidade": p.get("unidade") or "UN",
                "situacao": "A",
                "precos": {"preco": float(it.get("valorUnitario") or 0)},
            }
            pid, sku_final = None, sku
            try:
                novo = chamar("POST", "/produtos", json=cadastro)
                pid = (novo or {}).get("id")
            except Exception as e:
                msg = str(e).lower()
                duplicado = "409" in msg or ("sku" in msg and any(
                    x in msg for x in ("existe", "duplic", "cadastrad")))
                if not duplicado:
                    raise RuntimeError(f"[cadastro do produto '{sku}'] {e}")
                # O código existe (talvez EXCLUÍDO, que a busca ignora de
                # propósito): cadastra com sufixo em vez de derrubar a proposta.
                base = sku[:LIMITE_SKU - 3]
                for n in range(2, 6):
                    alt = f"{base}-{n}"
                    ach = achar_produto(alt)
                    if ach and ach.get("id"):
                        pid, sku_final = ach["id"], alt
                        break
                    try:
                        novo = chamar("POST", "/produtos", json={**cadastro, "sku": alt})
                        pid, sku_final = (novo or {}).get("id"), alt
                        if pid:
                            break
                    except Exception:
                        continue
            if not pid:
                raise RuntimeError(
                    f"[cadastro do produto '{sku}'] não consegui cadastrar nem localizar "
                    "o produto no Tiny. Informe o SKU do fornecedor no item e tente de novo.")
            resolvidos.append({"sku": sku_final, "id": pid, "acao": "cadastrado"})
        cache[sku.upper()] = pid
        it["produto"] = {"id": pid}
    return resolvidos


def criar_orcamento(corpo: dict) -> dict:
    """POST /orcamentos com todos os produtos já resolvidos por id.
    Devolve {id, numeroProposta, produtos: [...]}."""
    produtos = garantir_produtos(corpo)
    try:
        r = chamar("POST", "/orcamentos", json=corpo) or {}
    except Exception as e:
        raise RuntimeError(f"[orcamento] {e}")
    return {**r, "produtos": produtos}


def atualizar_orcamento(id_orcamento: int, corpo: dict) -> dict:
    """PUT /orcamentos/{id} — regerar uma proposta já exportada atualiza o MESMO
    orçamento em vez de criar outro. A API responde 204 (sem corpo).

    Esta função NÃO EXISTIA até a v3.72, embora o main.py a chamasse: toda
    reexportação de proposta já enviada caía em erro."""
    produtos = garantir_produtos(corpo)
    try:
        chamar("PUT", f"/orcamentos/{int(id_orcamento)}", json=corpo)
    except Exception as e:
        raise RuntimeError(f"[atualizar orcamento {id_orcamento}] {e}")
    return {"id": int(id_orcamento), "produtos": produtos}
