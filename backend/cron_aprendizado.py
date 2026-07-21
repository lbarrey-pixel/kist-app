#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════════════════
# cron_aprendizado.py — JOB NOTURNO do motor de preços (Kist Cabine de Compras)
# ══════════════════════════════════════════════════════════════════════════════
# Roda 1x/dia (madrugada). Fecha a metade que o aprendizado em tempo real não cobre:
# estuda o DIA INTEIRO do operador — inclusive o que ele DESCARTOU — e ajusta o motor.
#
# FRONTEIRA DE SEGURANÇA (decisão do Leonardo):
#   • DADO PURO (observabilidade) -> escreve sozinho:
#       - balanço diário honesto (achou × achou_validado, por vertical/fonte) em motor_diagnostico
#   • MUDANÇA DE REGRA -> vira PROPOSTA em motor_propostas (status='pendente'), NUNCA auto-aplica:
#       - roteamento: domínio que o operador usou de verdade e não está na config
#       - faixa de preço (piso de magnitude) que destoou do custo real
#     Cada proposta traz o SQL pronto (`sql_aplicar`) — o Leonardo revê e roda se aprovar.
#   O operador é a hierarquia superior. A IA não reescreve as próprias regras sozinha.
#
# IDEMPOTÊNCIA: marca d'água (config_kist['cron_ultima_rodada']) — o balanço diário só
# processa o que entrou DEPOIS da última rodada, pra não contar duas vezes. A análise de
# propostas re-varre uma janela móvel (padrão precisa acumular) e deduplica por índice.
#
# Determinístico: SEM IA, SEM reescrever regra. Reusa as funções do próprio motor
# (fonte única da verdade: classificação de vertical e as configs).
# ══════════════════════════════════════════════════════════════════════════════

import os
import re
import json
import sys
from datetime import datetime, timezone, timedelta

from supabase import create_client

# reusa a inteligência do motor (uma fonte só) — import leve, sem efeito colateral
from motor_precos import (
    _classificar_vertical, _carregar_cfg,
    _ROTEAMENTO_FALLBACK, _FAIXAS_FALLBACK,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://owpmcoithvzdlhmfkvbe.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

# domínios "genéricos" cobertos pelo passo Shopping — não viram proposta de roteamento
DOMINIOS_GENERICOS = {"mercadolivre.com.br", "amazon.com.br", "google.com",
                      "americanas.com.br", "magazineluiza.com.br", "shopee.com.br"}
JANELA_PROPOSTAS_DIAS = 21     # padrão de roteamento precisa acumular alguns dias
MIN_USOS_REROTA       = 3      # domínio usado >= isso na vertical vira proposta
MIN_AMOSTRAS_FAIXA    = 8      # só mexe no piso com base amostral suficiente


# ── util ──────────────────────────────────────────────────────────────────────
def _dominio(url: str) -> str:
    """Extrai o host de uma URL (sem esquema/www). '' se não der."""
    m = re.match(r'^\s*https?://(?:www\.)?([^/]+)', (url or "").strip(), re.I)
    return (m.group(1).lower() if m else "").strip()


def _num(v):
    try:
        return float(re.sub(r'[^0-9.]', '', str(v)))
    except (TypeError, ValueError):
        return None


def _log(msg: str):
    print(f"[cron_aprendizado {datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}",
          flush=True)


# ── PARTE A — balanço diário honesto (auto-escreve em motor_diagnostico) ───────
def balanco_diario(sb, desde_iso: str) -> dict:
    """Lê motor_precos_log desde a marca d'água e resume achou × achou_validado por
    vertical e por fonte. Grava UMA linha-resumo em motor_diagnostico (observabilidade,
    não é regra). Devolve o resumo (também vai pro stdout do cron)."""
    linhas = (sb.table("motor_precos_log").select("*")
              .gt("criado_em", desde_iso).order("criado_em").execute().data) or []
    total = len(linhas)
    achou = sum(1 for r in linhas if r.get("achou"))
    valid = sum(1 for r in linhas if r.get("achou_validado"))
    por_fonte = {}
    for r in linhas:
        f = r.get("fonte_resolveu") or "(nenhuma)"
        d = por_fonte.setdefault(f, {"n": 0, "validado": 0})
        d["n"] += 1
        if r.get("achou_validado"):
            d["validado"] += 1
    resumo = {
        "buscas": total, "achou": achou, "achou_validado": valid,
        "pct_achou": round(100 * achou / total, 1) if total else 0.0,
        "pct_validado": round(100 * valid / total, 1) if total else 0.0,
        "por_fonte": por_fonte,
    }
    hoje = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-3))).date().isoformat()
    try:
        sb.table("motor_diagnostico").insert({
            "rodada": hoje,
            "descricao_input": f"[BALANÇO NOTURNO] {total} buscas no período",
            "engine_achou": achou > 0,
            "observacao": ("Balanço automático do cron. "
                           f"achou={resumo['pct_achou']}% · validado={resumo['pct_validado']}%. "
                           + json.dumps(resumo, ensure_ascii=False)),
        }).execute()
    except Exception as e:
        _log(f"WARN: não gravou balanço em motor_diagnostico: {e}")
    return resumo


# ── PARTE B — propostas de roteamento (a partir do uso REAL do operador) ───────
def propostas_roteamento(sb, rot_cfg: dict):
    """Onde o operador tirou preço (link_fornecedor) numa janela móvel, por vertical.
    Domínio de nicho usado >= MIN_USOS_REROTA e AUSENTE da config -> proposta de
    adicionar ao roteamento. Genéricos (ML/Amazon/Google) são ignorados (já cobertos
    pelo passo Shopping). NÃO aplica — só propõe, com SQL pronto."""
    desde = (datetime.now(timezone.utc) - timedelta(days=JANELA_PROPOSTAS_DIAS)).isoformat()
    itens = (sb.table("itens_proposta")
             .select("descricao_original,specs_complementares,link_fornecedor,criado_em")
             .gt("criado_em", desde).execute().data) or []

    # tally (vertical, dominio) -> contagem + exemplos
    tally = {}
    for it in itens:
        dom = _dominio(it.get("link_fornecedor") or "")
        if not dom or dom in DOMINIOS_GENERICOS:
            continue
        perfil = {"descricao": (it.get("descricao_original") or "").lower(),
                  "consulta": (it.get("descricao_original") or "").lower(),
                  "specs": (it.get("specs_complementares") or "").lower(), "categoria": ""}
        vert = _classificar_vertical(perfil, rot_cfg)
        k = (vert, dom)
        d = tally.setdefault(k, {"n": 0, "ex": []})
        d["n"] += 1
        if len(d["ex"]) < 3:
            d["ex"].append((it.get("descricao_original") or "")[:60])

    novas = 0
    for (vert, dom), d in sorted(tally.items(), key=lambda x: -x[1]["n"]):
        if d["n"] < MIN_USOS_REROTA:
            continue
        atuais = (rot_cfg.get(vert) or {}).get("dominios") or []
        if dom in atuais:
            continue
        # monta a config nova (domínio no fim da lista da vertical) e o SQL de aplicar
        nova_cfg = json.loads(json.dumps(rot_cfg))           # cópia profunda
        nova_cfg.setdefault(vert, {"kw": [], "dominios": []})
        nova_cfg[vert].setdefault("dominios", [])
        if dom not in nova_cfg[vert]["dominios"]:
            nova_cfg[vert]["dominios"].append(dom)
        js = json.dumps(nova_cfg, ensure_ascii=False).replace("$cfg$", "")
        sql = ("insert into config_kist (chave, valor) values "
               f"('roteamento_vertical', $cfg${js}$cfg$) "
               "on conflict (chave) do update set valor=excluded.valor;")
        chave = f"{vert}|{dom}"
        try:
            sb.table("motor_propostas").insert({
                "tipo": "roteamento_dominio", "vertical": vert, "chave": chave,
                "proposta": {"vertical": vert, "adicionar_dominio": dom},
                "evidencia": {"usos_na_janela": d["n"], "dias_janela": JANELA_PROPOSTAS_DIAS,
                              "exemplos": d["ex"]},
                "sql_aplicar": sql,
            }).execute()
            novas += 1
            _log(f"proposta roteamento: {vert} += {dom} (usado {d['n']}x)")
        except Exception as e:
            # provável colisão com o índice único (proposta idêntica já pendente) — ok
            if "duplicate" not in str(e).lower() and "unique" not in str(e).lower():
                _log(f"WARN proposta roteamento {chave}: {e}")
    return novas


# ── PARTE C — refresh do piso de magnitude (proposta, não aplica) ──────────────
def propostas_faixas(sb, rot_cfg: dict, faixas_cfg: dict):
    """Recalcula o p10 de preco_custo por vertical (janela ampla) e, se o piso atual
    destoar muito do real, PROPÕE novo piso. Não aplica."""
    desde = (datetime.now(timezone.utc) - timedelta(days=180)).isoformat()
    itens = (sb.table("itens_proposta")
             .select("descricao_original,specs_complementares,preco_custo,criado_em")
             .gt("criado_em", desde).execute().data) or []

    custos = {}   # vertical -> [custos]
    for it in itens:
        c = _num(it.get("preco_custo"))
        if not c or c <= 0:
            continue
        perfil = {"descricao": (it.get("descricao_original") or "").lower(),
                  "consulta": (it.get("descricao_original") or "").lower(),
                  "specs": (it.get("specs_complementares") or "").lower(), "categoria": ""}
        vert = _classificar_vertical(perfil, rot_cfg)
        custos.setdefault(vert, []).append(c)

    def p10(vals):
        vals = sorted(vals)
        i = max(0, int(0.10 * (len(vals) - 1)))
        return vals[i]

    novas = 0
    nova_faixa = dict(faixas_cfg)
    mudou = False
    detalhes = []
    for vert, vals in custos.items():
        if len(vals) < MIN_AMOSTRAS_FAIXA:
            continue
        novo = round(p10(vals), 2)
        atual = float(faixas_cfg.get(vert) or 0.0)
        # só propõe se destoar >50% pra qualquer lado
        if atual > 0 and 0.5 * atual <= novo <= 1.5 * atual:
            continue
        nova_faixa[vert] = novo
        mudou = True
        detalhes.append({"vertical": vert, "piso_atual": atual, "piso_sugerido": novo,
                         "amostras": len(vals)})

    if mudou:
        js = json.dumps(nova_faixa, ensure_ascii=False)
        sql = ("insert into config_kist (chave, valor) values "
               f"('faixas_preco_vertical', $cfg${js}$cfg$) "
               "on conflict (chave) do update set valor=excluded.valor;")
        chave = "faixas|" + datetime.now(timezone.utc).date().isoformat()
        try:
            sb.table("motor_propostas").insert({
                "tipo": "faixa_preco", "vertical": None, "chave": chave,
                "proposta": {"faixas_preco_vertical": nova_faixa},
                "evidencia": {"mudancas": detalhes},
                "sql_aplicar": sql,
            }).execute()
            novas += 1
            _log(f"proposta faixas: {len(detalhes)} vertical(is) fora da faixa")
        except Exception as e:
            if "duplicate" not in str(e).lower() and "unique" not in str(e).lower():
                _log(f"WARN proposta faixas: {e}")
    return novas


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    if not SUPABASE_KEY:
        _log("ERRO: SUPABASE_KEY ausente no ambiente. Abortando.")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # marca d'água
    wm_row = (sb.table("config_kist").select("valor").eq("chave", "cron_ultima_rodada")
              .limit(1).execute().data)
    desde = (wm_row[0]["valor"] if wm_row else
             (datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
    agora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _log(f"início · processando desde {desde}")

    rot_cfg    = _carregar_cfg(sb, "roteamento_vertical",   _ROTEAMENTO_FALLBACK)
    faixas_cfg = _carregar_cfg(sb, "faixas_preco_vertical", _FAIXAS_FALLBACK)

    # cada parte é isolada: uma falhar não derruba o resto
    resumo = {}
    try:
        resumo = balanco_diario(sb, desde)
        _log(f"balanço: {resumo.get('buscas')} buscas · "
             f"achou {resumo.get('pct_achou')}% · validado {resumo.get('pct_validado')}%")
    except Exception as e:
        _log(f"ERRO balanço: {e}")

    n_rota = n_faixa = 0
    try:
        n_rota = propostas_roteamento(sb, rot_cfg)
    except Exception as e:
        _log(f"ERRO propostas roteamento: {e}")
    try:
        n_faixa = propostas_faixas(sb, rot_cfg, faixas_cfg)
    except Exception as e:
        _log(f"ERRO propostas faixas: {e}")

    # avança a marca d'água só depois de tudo (idempotência)
    try:
        sb.table("config_kist").update({"valor": agora}).eq("chave", "cron_ultima_rodada").execute()
    except Exception as e:
        _log(f"ERRO ao avançar marca d'água: {e}")

    _log(f"fim · propostas novas: {n_rota} roteamento, {n_faixa} faixa · "
         f"marca d'água -> {agora}")


if __name__ == "__main__":
    main()
