"""Conhecimento de pesquisa da Kist (v3.82).

O que os bots descobrem numa pesquisa, separado pelo tempo que vale:

  EXTRATO      -> o PROCESSO de uma pesquisa (um lote): o que tentou, onde
                  procurou, o que descartou e por quê. Serve para auditar e
                  melhorar o bot.
  JULGAMENTO   -> por item DESTA cotação: escolhida e motivo, riscos, o que
                  validar com o cliente.
  FICHA        -> identidade do item, da Kist INTEIRA: PN, fabricante, specs
                  críticas, equivalências. Equivalência dita por bot é só
                  SUGESTÃO; vira regra quando o operador confirma.
  OBSERVAÇÕES  -> toda oferta vista (inclusive as descartadas). Evidência de
                  mercado — NUNCA entra no banco de preços (`produtos`).
  VEREDITO     -> automático: a escolha do bot bateu com o que saiu na
                  proposta / foi comprado?

Este módulo é PURO (sem banco, sem rede): valida e normaliza o que os bots
mandam e decide vereditos. O main.py grava e serve.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional
from urllib.parse import urlparse

MAX_PASSOS = 40
MAX_OBSERVADAS = 10
MAX_RISCOS = 3
MAX_EQUIV = 8
MAX_SPECS = 12
MAX_TXT = 800
MAX_RESUMO = 2000

RELACOES = {"equivalente", "incompativel", "a_validar"}
_RELACAO_ALIAS = {"compativel": "equivalente", "equivalent": "equivalente", "igual": "equivalente",
                  "incompatible": "incompativel", "nao_serve": "incompativel", "não serve": "incompativel",
                  "validar": "a_validar", "duvida": "a_validar"}


def txt(v, limite: int = MAX_TXT) -> str:
    s = re.sub(r"\s+", " ", str(v if v is not None else "")).strip()
    return s[:limite]


def _lista_txt(v, maximo: int, limite: int = 300) -> list:
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        t = txt(x, limite)
        if t and t not in out:
            out.append(t)
        if len(out) >= maximo:
            break
    return out


def num(v) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        f = float(s)
        return f if f > 0 else None
    except ValueError:
        return None


def pn_norm(v) -> str:
    return re.sub(r"[^A-Z0-9\-]", "", str(v or "").upper())[:40]


def desc_norm(v) -> str:
    s = unicodedata.normalize("NFKD", str(v or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s.lower())).strip()[:300]


# PN: token com letra E número, 5 a 20 caracteres, hífen permitido (0W6YC4,
# 161-BBRX, A2883FS4PRO). Palavras comuns com número ("8TB", "12G") ficam de fora
# pelo tamanho mínimo e pela lista de unidades.
_UNIDADES = re.compile(r"^\d+(TB|GB|MB|G|W|V|A|MM|CM|M|MHZ|GHZ|K|KG|MAH|PCS|UN|X)$")


def extrair_pns(texto: str) -> list:
    achados = []
    for tok in re.findall(r"[A-Za-z0-9][A-Za-z0-9\-]{3,19}[A-Za-z0-9]", str(texto or "")):
        t = tok.upper()
        if not (re.search(r"[A-Z]", t) and re.search(r"\d", t)):
            continue
        if _UNIDADES.match(t) or re.fullmatch(r"CAT\d+[A-Z]?", t):
            continue
        if t not in achados:
            achados.append(t)
    return achados[:5]


def chave_ficha(pn: str, descricao: str) -> str:
    p = pn_norm(pn)
    if p:
        return f"pn:{p}"
    d = desc_norm(descricao)
    return f"desc:{d}" if d else ""


# ── contrato de retorno ─────────────────────────────────────────────────────

def normalizar_julgamento(v) -> Optional[dict]:
    if not isinstance(v, dict):
        return None
    j = {
        "escolhida": txt(v.get("escolhida"), 160),
        "motivo": txt(v.get("motivo")),
        "riscos": _lista_txt(v.get("riscos"), MAX_RISCOS),
        "validar_com_cliente": _lista_txt(v.get("validar_com_cliente"), MAX_RISCOS),
        "confianca": txt(v.get("confianca"), 20).lower() or None,
    }
    return j if (j["escolhida"] or j["motivo"] or j["riscos"] or j["validar_com_cliente"]) else None


def normalizar_identidade(v) -> Optional[dict]:
    if not isinstance(v, dict):
        return None
    equivs = []
    for e in (v.get("equivalencias") or [])[:MAX_EQUIV]:
        if not isinstance(e, dict):
            continue
        outro = pn_norm(e.get("pn") or e.get("pn_outro"))
        rel = str(e.get("relacao") or "").strip().lower()
        rel = _RELACAO_ALIAS.get(rel, rel)
        if not outro or rel not in RELACOES:
            continue
        # Regra: equivalência sem fonte NÃO entra (bot não pode inventar).
        fonte = txt(e.get("fonte"), 200)
        if not fonte:
            continue
        equivs.append({"pn_outro": outro, "relacao": rel, "motivo": txt(e.get("motivo"), 300),
                       "fonte": fonte, "confianca": txt(e.get("confianca"), 20).lower() or None})
    ident = {
        "pn": pn_norm(v.get("pn")),
        "fabricante": txt(v.get("fabricante"), 80),
        "specs": _lista_txt(v.get("specs_criticas") or v.get("specs"), MAX_SPECS, 60),
        "equivalencias": equivs,
    }
    return ident if (ident["pn"] or ident["specs"] or equivs) else None


def normalizar_observada(o: dict, escolhida: bool = False) -> Optional[dict]:
    if not isinstance(o, dict):
        return None
    preco = num(o.get("preco") if o.get("preco") is not None else
                (o.get("preco_pix") if o.get("preco_pix") is not None else o.get("preco_cheio")))
    ob = {
        "loja": txt(o.get("loja") or o.get("fornecedor"), 120),
        "pais": txt(o.get("pais"), 3).upper() or None,
        "preco": preco,
        "moeda": (txt(o.get("moeda"), 3).upper() or "BRL"),
        "estoque": txt(o.get("estoque"), 60) or None,
        "condicao": txt(o.get("condicao"), 30).lower() or None,
        "link": txt(o.get("link") or o.get("url"), 600) or None,
        "escolhida": bool(escolhida or o.get("escolhida")),
    }
    if ob["link"] and not ob["link"].lower().startswith(("http://", "https://")):
        ob["link"] = None
    return ob if (ob["loja"] or ob["link"]) and (ob["preco"] or ob["link"]) else None


def observacoes_do_item(r: dict, ofertas_norm: list, escolha: int) -> list:
    """Observações de um item. Se o bot mandou `mercado.observadas`, vale ela;
    senão as próprias ofertas viram observação (cataloga sem o bot mudar nada)."""
    merc = r.get("mercado") if isinstance(r.get("mercado"), dict) else {}
    brutas = merc.get("observadas") if isinstance(merc.get("observadas"), list) else None
    out = []
    if brutas is not None:
        for o in brutas[:MAX_OBSERVADAS]:
            ob = normalizar_observada(o)
            if ob:
                out.append(ob)
    else:
        for i, o in enumerate((ofertas_norm or [])[:MAX_OBSERVADAS]):
            # Oferta com preço divergente (v3.84): não se sabe qual valor vale —
            # a observação guarda loja e link, sem preço.
            preco_ob = None if o.get("preco_divergente") else (o.get("preco_pix") or o.get("preco_cheio"))
            ob = normalizar_observada({**o, "preco": preco_ob, "preco_pix": None, "preco_cheio": None},
                                      escolhida=(i == escolha))
            if ob:
                out.append(ob)
    return out


def resumo_mercado(r: dict) -> str:
    merc = r.get("mercado") if isinstance(r.get("mercado"), dict) else {}
    return txt(merc.get("resumo"), 400)


def normalizar_extrato(v) -> Optional[dict]:
    if not isinstance(v, dict):
        return None
    passos = []
    for p in (v.get("passos") or [])[:MAX_PASSOS]:
        if not isinstance(p, dict):
            continue
        ps = {
            "item_id": txt(p.get("item_id"), 40).lower() or None,
            "etapa": txt(p.get("etapa"), 60),
            "fonte": txt(p.get("fonte"), 120),
            "consulta": txt(p.get("consulta"), 300),
            "resultado": txt(p.get("resultado"), 400),
            "decisao": txt(p.get("decisao"), 300),
            "ms": int(p["ms"]) if str(p.get("ms", "")).isdigit() else None,
        }
        if ps["etapa"] or ps["resultado"] or ps["decisao"]:
            passos.append(ps)
    ext = {
        "resumo": txt(v.get("resumo"), MAX_RESUMO),
        "passos": passos,
        "limitacoes": _lista_txt(v.get("limitacoes") or v.get("faltou"), 8),
        "sugestoes": _lista_txt(v.get("sugestoes") or v.get("sugestoes_bot"), 8),
        "saude": _lista_txt(v.get("saude"), 8),
    }
    return ext if (ext["resumo"] or passos or ext["limitacoes"] or ext["saude"]) else None


# ── veredito automático ─────────────────────────────────────────────────────

def _host_path(link: str) -> str:
    try:
        u = urlparse(str(link or "").strip())
        if not u.netloc:
            return ""
        host = u.netloc.lower().removeprefix("www.")
        return host + u.path.rstrip("/").lower()
    except Exception:
        return ""


def _loja_norm(v) -> str:
    return re.sub(r"[^a-z0-9]", "", desc_norm(v))


def _mesma_oferta(of: dict, item: dict) -> bool:
    l1, l2 = _host_path(of.get("link")), _host_path(item.get("link_fornecedor"))
    if l1 and l2:
        return l1 == l2
    a, b = _loja_norm(of.get("loja")), _loja_norm(item.get("fornecedor") or item.get("nome_fornecedor"))
    return bool(a and b and (a == b or a in b or b in a))


def veredito(ofertas: list, escolha: int, item_final: dict, tolerancia_custo: float = 0.15) -> Optional[dict]:
    """Compara o que o bot recomendou com o que saiu (proposta) ou foi comprado (OC).

    acertou          -> saiu com a oferta recomendada
    custo_divergente -> mesma oferta, custo final longe do preço do bot
    escolheu_outra   -> saiu com outra oferta que o bot também trouxe
    nao_achou        -> saiu com uma origem que o bot não trouxe
    None             -> sem origem no item final: não dá para julgar
    """
    ofertas = [o for o in (ofertas or []) if isinstance(o, dict)]
    if not ofertas:
        return None
    tem_origem = bool(item_final.get("link_fornecedor") or item_final.get("fornecedor")
                      or item_final.get("nome_fornecedor"))
    if not tem_origem:
        return None
    if not (0 <= int(escolha or 0) < len(ofertas)):
        escolha = 0
    rec = ofertas[escolha]
    if _mesma_oferta(rec, item_final):
        custo = num(item_final.get("preco_custo"))
        preco_bot = num(rec.get("preco_pix")) or num(rec.get("preco_cheio"))
        if rec.get("preco_divergente") and custo:
            # O operador escolheu um dos dois; compara com o mais próximo.
            cands = [v for v in (num(rec.get("preco_pix")), num(rec.get("preco_cheio"))) if v]
            preco_bot = min(cands, key=lambda v: abs(v - custo)) if cands else preco_bot
        if preco_bot and custo and abs(custo - preco_bot) / preco_bot > tolerancia_custo:
            return {"veredito": "custo_divergente", "preco_bot": preco_bot, "custo_final": custo,
                    "loja": rec.get("loja")}
        return {"veredito": "acertou", "loja": rec.get("loja")}
    for i, of in enumerate(ofertas):
        if i != escolha and _mesma_oferta(of, item_final):
            return {"veredito": "escolheu_outra", "recomendada": rec.get("loja"), "usada": of.get("loja")}
    return {"veredito": "nao_achou", "recomendada": rec.get("loja"),
            "usada": item_final.get("fornecedor") or item_final.get("nome_fornecedor")
                     or _host_path(item_final.get("link_fornecedor"))}


# ── contexto para o operador e para o bot ───────────────────────────────────

def faixa_precos(observacoes: list) -> Optional[dict]:
    precos = sorted(o["preco"] for o in observacoes if o.get("preco") and (o.get("moeda") or "BRL") == "BRL")
    if not precos:
        return None
    meio = len(precos) // 2
    mediana = precos[meio] if len(precos) % 2 else (precos[meio - 1] + precos[meio]) / 2
    datas = [str(o.get("observado_em") or "")[:10] for o in observacoes if o.get("observado_em")]
    return {"min": round(precos[0], 2), "mediana": round(mediana, 2), "max": round(precos[-1], 2),
            "n": len(precos), "ultima": max(datas) if datas else None}


def alertas(equivalencias: list) -> list:
    """Frases curtas para a linha do item. Confirmadas primeiro; sugeridas marcadas."""
    out = []
    ordem = sorted(equivalencias or [], key=lambda e: 0 if e.get("status") == "confirmada" else 1)
    for e in ordem:
        if e.get("status") == "rejeitada":
            continue
        tag = "" if e.get("status") == "confirmada" else " (a validar)"
        if e["relacao"] == "incompativel":
            out.append(f"{e['pn_outro']} NÃO serve{': ' + e['motivo'] if e.get('motivo') else ''}{tag}")
        elif e["relacao"] == "equivalente":
            out.append(f"equivale a {e['pn_outro']}{tag}")
        else:
            out.append(f"{e['pn_outro']}: compatibilidade a validar{tag}")
    return out[:4]


def bloco_contexto_bot(ficha: dict, equivalencias: list, observacoes: list) -> dict:
    """O que o bot recebe no envio para um item já conhecido. Curto, com teto."""
    return {
        "pn": ficha.get("pn") or None,
        "fabricante": ficha.get("fabricante") or None,
        "specs_criticas": (ficha.get("specs") or [])[:MAX_SPECS],
        "equivalencias": [{"pn": e["pn_outro"], "relacao": e["relacao"], "motivo": e.get("motivo"),
                           "status": e.get("status")}
                          for e in (equivalencias or []) if e.get("status") != "rejeitada"][:MAX_EQUIV],
        "ultimas_ofertas": [{"loja": o.get("loja"), "pais": o.get("pais"), "preco": o.get("preco"),
                             "moeda": o.get("moeda"), "estoque": o.get("estoque"),
                             "data": str(o.get("observado_em") or "")[:10]}
                            for o in (observacoes or [])[:5]],
        "instrucao": "Já pesquisado pela Kist. Confirme o preço atual; não refaça a identificação "
                     "se o PN bater. Equivalência com status 'sugerida' ainda não foi validada.",
    }


def texto_ficha(ficha: dict, equivalencias: list, observacoes: list) -> str:
    """Ficha em texto compacto (para bots)."""
    linhas = [f"FICHA {ficha.get('pn') or ficha.get('descricao_ref')}",
              f"fabricante: {ficha.get('fabricante') or '-'} · pesquisas: {ficha.get('n_pesquisas', 0)}"]
    if ficha.get("specs"):
        linhas.append("specs críticas: " + ", ".join(ficha["specs"]))
    for e in equivalencias or []:
        linhas.append(f"- {e['relacao']} {e['pn_outro']} [{e.get('status')}] {e.get('motivo') or ''}".rstrip())
    fx = faixa_precos(observacoes or [])
    if fx:
        linhas.append(f"preço observado (BRL): mín {fx['min']} · mediana {fx['mediana']} · máx {fx['max']} "
                      f"({fx['n']} obs., última {fx['ultima']})")
    for o in (observacoes or [])[:8]:
        linhas.append(f"  {str(o.get('observado_em') or '')[:10]} {o.get('loja')} {o.get('pais') or ''} "
                      f"{o.get('preco') or '-'} {o.get('moeda') or ''} estoque:{o.get('estoque') or '-'}"
                      f"{' *escolhida' if o.get('escolhida') else ''}")
    return "\n".join(linhas) + "\n"


GUIA_RETORNO = """GUIA DO RETORNO DE PESQUISA (POST /propostas/{numero}/pesquisa-resultado)

O que já existia continua igual: resultados[{item_id, status, ofertas[...], escolha}].
Seções NOVAS, todas opcionais — bot que não mandar continua funcionando:

POR ITEM (dentro de cada resultado):
  julgamento: {escolhida, motivo, riscos[<=3], validar_com_cliente[<=3], confianca}
      -> aparece no card da gaveta; riscos e "validar" aparecem antes de enviar ao cliente.
  identidade: {pn, fabricante, specs_criticas[<=12],
               equivalencias[{pn, relacao: equivalente|incompativel|a_validar, motivo, fonte, confianca}]}
      -> ficha do item, da Kist inteira. Equivalência SEM fonte é descartada.
         Toda equivalência vinda de bot entra como SUGESTÃO; só o operador confirma.
  mercado: {observadas[<=10 {loja, pais, preco, moeda, estoque, condicao, link}], resumo}
      -> toda oferta VISTA, inclusive as descartadas. Evidência de mercado; não é banco de preços.
         Sem 'observadas', a Cabine usa as próprias 'ofertas'.

  telemetria: {tempo_ms, buscas, paginas, tokens_entrada, tokens_saida, custo_usd, modelo}
      -> (v3.110) é o que permite calcular CUSTO POR BUSCA USADA no seu painel de desempenho
         (GET /pesquisa/desempenho). Some entrada e saída de TODAS as chamadas de modelo feitas
         para aquele item; custo_usd = o que você pagou por elas. Item que veio do SEU cache:
         custo_usd 0. A Cabine não estima nada — sem esses campos, o painel diz "sem custo
         informado".

POR PESQUISA (no topo do corpo, junto de external_key):
  extrato: {resumo, passos[<=40 {item_id, etapa, fonte, consulta, resultado, decisao, ms}],
            limitacoes[], sugestoes[], saude[]}
      -> o PROCESSO. Registre ENQUANTO pesquisa, não um relato escrito no fim.
         'saude' = problema do bot (ex.: fonte bloqueada), não do item.

REGRAS: não inventar (seção sem informação fica de fora); respeitar os tetos;
nunca reescrever a descrição do cliente.

NO ENVIO você pode receber, por item, 'conhecimento': o que a Kist já sabe
(PN, specs, equivalências, últimas ofertas). Use para pesquisar só o que falta.
"""
