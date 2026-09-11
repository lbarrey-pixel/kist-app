"""api_log — uma linha por requisição HTTP feita com chave de API.

POR QUE EXISTE
--------------
`ia_uso` responde "quanto o Fábio gastou". Não responde "quanto a INTEGRAÇÃO do
Fábio gastou", porque a chave de API roda como o operador dono e as duas coisas
compartilham o mesmo e-mail. Este log fecha essa lacuna: registra a requisição,
e o `req_id` amarra a ela as chamadas de IA que ela disparou.

Só registra tráfego com chave de API. Requisição da tela (Google OAuth) não
entra — seria dobrar o volume de escrita para registrar o que `ia_uso` já cobre.

DESENHO
-------
Escrita assíncrona, em thread e conexão PRÓPRIAS. Vem da lição do chamado #16
(24/08/2026): a telemetria compartilhava o cliente Supabase com o request e as
duas disputavam o socket. Recurso de infraestrutura não se compartilha entre a
operação e o que observa a operação.

Perder um registro de log é aceitável. Derrubar ou atrasar a operação por causa
dele, não. Toda função aqui engole exceção por decisão, não por descuido.
"""
from __future__ import annotations

import atexit
import queue
import threading
import time
import uuid
from typing import Optional

_FILA_MAX = 2000
_LOTE = 25
_INTERVALO = 5.0

_fila: "queue.Queue[dict]" = queue.Queue(maxsize=_FILA_MAX)
_criar_supabase = None
_sb_proprio = None
_sb_lock = threading.Lock()
_worker: Optional[threading.Thread] = None


def novo_req_id() -> str:
    """Id curto o suficiente para ler no log, longo o suficiente para não colidir."""
    return uuid.uuid4().hex[:16]


def configurar(criar_supabase) -> None:
    """Recebe uma FÁBRICA (cria cliente novo), não o singleton do main.py."""
    global _criar_supabase
    _criar_supabase = criar_supabase
    _garantir_worker()


def _sb():
    global _sb_proprio
    if _sb_proprio is not None:
        return _sb_proprio
    with _sb_lock:
        if _sb_proprio is None and _criar_supabase is not None:
            try:
                _sb_proprio = _criar_supabase()
            except Exception:
                return None
    return _sb_proprio


def registrar(req_id: str, chave_id, usuario_email: str, escopo: str,
              metodo: str, rota: str, status: int, ms: int,
              bloqueado: bool = False, motivo: str = "",
              user_agent: str = "", ip: str = "") -> None:
    """Enfileira o registro de uma requisição. Nunca levanta."""
    try:
        linha = {
            "req_id": (req_id or "")[:32],
            "chave_id": chave_id,
            "usuario_email": (usuario_email or "")[:120],
            "escopo": (escopo or "")[:20],
            "metodo": (metodo or "")[:10],
            "rota": (rota or "")[:300],
            "status": int(status) if status is not None else None,
            "ms": int(ms),
            "bloqueado": bool(bloqueado),
            "motivo": (motivo or "")[:300],
            "user_agent": (user_agent or "")[:300],
            "ip": (ip or "")[:60],
        }
        _fila.put_nowait(linha)
        if _fila.qsize() >= _LOTE:
            _garantir_worker()
    except Exception:
        # Fila cheia é sinal de que o banco está lento. Descartar o log é a
        # resposta certa: a alternativa é bloquear a requisição do operador.
        pass


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
            sb.table("api_uso_log").insert(linhas).execute()
    except Exception:
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
        _worker = threading.Thread(target=_laco, name="api_log", daemon=True)
        _worker.start()


@atexit.register
def _no_fim() -> None:
    try:
        _drenar()
    except Exception:
        pass
