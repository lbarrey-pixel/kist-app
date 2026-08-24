"""
ia_uso.py — contabilidade de tokens da API Anthropic, por USUÁRIO e por FUNÇÃO.

POR QUE ASSIM
-------------
São 20 pontos de chamada a `claude.messages.create(...)` espalhados por
main.py, motor_precos.py e datasheet.py. Instrumentar os 20 na mão significa
(a) 20 edições agora e (b) esquecer o 21º daqui a um mês. Em vez disso, o
`get_claude()` passa a devolver um ENVELOPE em volta do cliente da Anthropic.
Quem chama continua escrevendo `claude.messages.create(...)` — nada muda no
código chamador, inclusive nos módulos que recebem o cliente pelo ctx.

QUEM CHAMOU: lido da pilha de execução (módulo + nome da função). É
determinístico, não depende de ninguém lembrar de passar um rótulo, e cobre
função nova automaticamente.

QUEM É O USUÁRIO: um contextvar setado pelo middleware HTTP a partir do token
Bearer. Setado ANTES do endpoint rodar, então propaga tanto para endpoint
async quanto para os síncronos (que a Starlette roda em threadpool copiando o
contexto). Sem token / cron / boot → "(sistema)".

REGRA DE OURO: contabilizar NUNCA pode derrubar a chamada. Todo o registro
está sob try/except mudo, e a gravação é feita por uma thread de fundo em
lotes — a chamada da IA não espera o Supabase.
"""

from __future__ import annotations

import atexit
import contextvars
import json
import queue
import sys
import threading
import time
from typing import Any, Dict, Optional

# ── Estado do módulo ──────────────────────────────────────────────────────────
_USUARIO: contextvars.ContextVar[str] = contextvars.ContextVar("ia_usuario", default="")
_criar_supabase = None        # fábrica injetada pelo main.py
_sb_proprio = None            # cliente DEDICADO desta thread — ver nota abaixo
_sb_lock = threading.Lock()
_fila: "queue.Queue[dict]" = queue.Queue(maxsize=5000)
_worker: Optional[threading.Thread] = None
_LOTE = 25                    # grava a cada 25 registros
_INTERVALO = 8.0              # ...ou a cada 8 segundos, o que vier primeiro

# ── Tabela de preços (USD por 1 milhão de tokens) ─────────────────────────────
# Fallback embutido; a fonte de verdade é config_kist['precos_ia'], lida em
# RUNTIME. Preço de modelo muda sem aviso e sem merecer um redeploy — mesmo
# padrão do mapa de excludentes.
_PRECOS_FALLBACK = {
    "claude-sonnet-4-6":  {"in": 3.00, "out": 15.00, "cache_w": 3.75, "cache_r": 0.30},
    "claude-haiku-4-5":   {"in": 1.00, "out":  5.00, "cache_w": 1.25, "cache_r": 0.10},
    "claude-opus-4":      {"in": 5.00, "out": 25.00, "cache_w": 6.25, "cache_r": 0.50},
    "_default":           {"in": 3.00, "out": 15.00, "cache_w": 3.75, "cache_r": 0.30},
    # Ferramenta de busca web: cobrada por BUSCA, não por token.
    "_web_search_por_1k": 10.00,
}
_precos_cache: Dict[str, Any] = {}
_precos_em = 0.0


def _sb():
    """Cliente Supabase EXCLUSIVO da telemetria.

    Não reusar o singleton do main.py. O cliente do Supabase carrega um pool
    httpx com sockets keep-alive; quando a thread de fundo grava telemetria ao
    mesmo tempo em que o request está lendo a memória de matching, as duas
    disputam a mesma conexão e o socket devolve
    `ReadError: [Errno 11] Resource temporarily unavailable`.

    O sintoma aparece na operação, não na telemetria: quem perde a leitura é a
    proposta. Contabilizar tokens não pode custar um match. Uma conexão própria
    isola por completo — o custo é um socket a mais, ocioso quase o tempo todo.
    """
    global _sb_proprio
    if _sb_proprio is None and _criar_supabase is not None:
        with _sb_lock:
            if _sb_proprio is None:
                try:
                    _sb_proprio = _criar_supabase()
                except Exception:
                    return None
    return _sb_proprio


def _precos() -> Dict[str, Any]:
    """Lê config_kist['precos_ia'] com cache de 10 min. Falhou → fallback."""
    global _precos_cache, _precos_em
    if _precos_cache and (time.time() - _precos_em) < 600:
        return _precos_cache
    tab = dict(_PRECOS_FALLBACK)
    try:
        sb = _sb()
        if sb is not None:
            r = sb.table("config_kist").select("valor").eq("chave", "precos_ia").execute()
            if r.data:
                v = r.data[0].get("valor")
                if isinstance(v, str):
                    v = json.loads(v)
                if isinstance(v, dict):
                    tab.update(v)
    except Exception:
        pass
    _precos_cache, _precos_em = tab, time.time()
    return tab


def _preco_do_modelo(modelo: str) -> Dict[str, float]:
    tab = _precos()
    m = (modelo or "").lower()
    for chave, val in tab.items():
        if chave.startswith("_"):
            continue
        if m.startswith(chave):
            return val
    return tab.get("_default", _PRECOS_FALLBACK["_default"])


# ── Identidade ────────────────────────────────────────────────────────────────
def set_usuario(email: str) -> None:
    try:
        _USUARIO.set((email or "").strip().lower())
    except Exception:
        pass


def get_usuario() -> str:
    try:
        return _USUARIO.get() or "(sistema)"
    except Exception:
        return "(sistema)"


def configurar(criar_supabase) -> None:
    """Chamado uma vez pelo main.py.

    Recebe uma FÁBRICA (que cria um cliente novo), não o getter do singleton:
    a telemetria roda em thread própria e precisa da sua própria conexão.
    """
    global _criar_supabase
    _criar_supabase = criar_supabase
    _garantir_worker()


# ── Quem chamou ───────────────────────────────────────────────────────────────
# Rótulo de negócio por (módulo, prefixo de função). O que não casar fica com o
# nome do módulo — nunca inventamos etapa que não existe.
_ETAPAS = {
    ("main", "extrair"):            "proposta",
    ("main", "_chamar_extracao"):   "proposta_extracao",
    ("main", "_chamar_com_content"): "proposta_extracao",
    ("main", "_fazer_matching"):    "proposta_matching",
    ("main", "_matching"):          "proposta_matching",
    ("main", "conferir"):           "conferir_ia",
    ("main", "analista"):           "analista",
    ("main", "_ler_po"):            "receber_po",
    ("main", "_casar"):             "receber_po",
    ("main", "casar_po"):           "receber_po",
    ("main", "_leitura_anexo"):     "leitura_anexo",
    ("main", "_anexo"):             "leitura_anexo",
    ("motor_precos", ""):           "motor_busca",
    ("datasheet", ""):              "datasheet",
    ("cron_aprendizado", ""):       "cron",
}


def _origem() -> tuple:
    """(modulo, funcao, etapa) do primeiro frame fora deste módulo."""
    modulo, funcao = "?", "?"
    try:
        f = sys._getframe(1)
        while f is not None:
            nome = f.f_globals.get("__name__", "")
            if nome != __name__:
                modulo = nome.split(".")[-1] or "?"
                funcao = f.f_code.co_name or "?"
                break
            f = f.f_back
    except Exception:
        pass
    etapa = _ETAPAS.get((modulo, funcao))
    if etapa is None:
        for (m, pref), rot in _ETAPAS.items():
            if m == modulo and pref and funcao.startswith(pref):
                etapa = rot
                break
    if etapa is None:
        etapa = _ETAPAS.get((modulo, ""), modulo)
    return modulo, funcao, etapa


# ── Gravação em lote (thread de fundo) ────────────────────────────────────────
def _drenar(bloqueante: bool = False) -> None:
    linhas = []
    try:
        primeiro = _fila.get(timeout=_INTERVALO) if bloqueante else _fila.get_nowait()
        linhas.append(primeiro)
    except Exception:
        pass
    while len(linhas) < 200:
        try:
            linhas.append(_fila.get_nowait())
        except Exception:
            break
    if not linhas:
        return
    try:
        sb = _sb()
        if sb is not None:
            sb.table("ia_uso").insert(linhas).execute()
    except Exception:
        # Perder telemetria é aceitável. Derrubar a operação por causa dela, não.
        pass


def _laco() -> None:
    while True:
        try:
            _drenar(bloqueante=True)
        except Exception:
            time.sleep(_INTERVALO)


def _garantir_worker() -> None:
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_laco, name="ia_uso", daemon=True)
        _worker.start()


@atexit.register
def _no_fim() -> None:
    try:
        _drenar()
    except Exception:
        pass


def registrar(modelo: str, uso: Any, ms: int, ok: bool,
              modulo: str, funcao: str, etapa: str,
              erro: str = "", extra: Optional[dict] = None) -> None:
    """Enfileira um registro. Nunca levanta."""
    try:
        t_in = int(getattr(uso, "input_tokens", 0) or 0)
        t_out = int(getattr(uso, "output_tokens", 0) or 0)
        c_w = int(getattr(uso, "cache_creation_input_tokens", 0) or 0)
        c_r = int(getattr(uso, "cache_read_input_tokens", 0) or 0)
        buscas = 0
        stu = getattr(uso, "server_tool_use", None)
        if stu is not None:
            buscas = int(getattr(stu, "web_search_requests", 0) or 0)

        p = _preco_do_modelo(modelo)
        custo = (t_in * p["in"] + t_out * p["out"]
                 + c_w * p.get("cache_w", p["in"]) + c_r * p.get("cache_r", 0.0)) / 1_000_000.0
        custo += buscas * (_precos().get("_web_search_por_1k", 10.0) / 1000.0)

        linha = {
            "usuario_email": get_usuario(),
            "modulo": modulo, "funcao": funcao, "etapa": etapa,
            "modelo": modelo or "?",
            "tokens_in": t_in, "tokens_out": t_out,
            "cache_write": c_w, "cache_read": c_r,
            "web_search": buscas,
            "custo_usd": round(custo, 6),
            "ms": int(ms), "ok": bool(ok),
            "erro": (erro or "")[:300],
        }
        if extra:
            linha["detalhe"] = extra
        _fila.put_nowait(linha)
        if _fila.qsize() >= _LOTE:
            _garantir_worker()
    except Exception:
        pass


# ── O envelope ────────────────────────────────────────────────────────────────
class _MessagesContado:
    """Espelha `client.messages`, contando o que passa pelo `create`."""

    def __init__(self, real):
        self._real = real

    def create(self, *args, **kwargs):
        modulo, funcao, etapa = _origem()
        modelo = kwargs.get("model") or (args[0] if args else "") or "?"
        t0 = time.time()
        try:
            resp = self._real.create(*args, **kwargs)
        except Exception as e:
            registrar(str(modelo), None, int((time.time() - t0) * 1000), False,
                      modulo, funcao, etapa, erro=f"{type(e).__name__}: {e}")
            raise
        try:
            registrar(str(getattr(resp, "model", modelo) or modelo),
                      getattr(resp, "usage", None),
                      int((time.time() - t0) * 1000), True, modulo, funcao, etapa)
        except Exception:
            pass
        return resp

    def __getattr__(self, nome):
        return getattr(self._real, nome)


class ClaudeContado:
    """Envelope transparente do cliente da Anthropic."""

    def __init__(self, real):
        self._real = real
        self.messages = _MessagesContado(real.messages)

    def __getattr__(self, nome):
        return getattr(self._real, nome)


def envolver(cliente):
    """Devolve o cliente embrulhado. Qualquer falha → cliente cru (nunca quebra)."""
    try:
        return ClaudeContado(cliente)
    except Exception:
        return cliente
