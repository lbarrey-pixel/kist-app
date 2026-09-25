"""
Le o JSON gerado a partir do export oficial do LinkedIn (Configuracoes >
Privacidade de Dados > "Obter uma copia dos seus dados", que inclui
messages.csv) e ADICIONA ao CRM sem duplicar dominio:

- Dominio novo -> cria a linha em leads_prospeccao_dominios.
- Dominio que ja existe -> so enriquece com contato + interacao novos.

So entra quem: (a) Leonardo comecou a conversa, e (b) a pessoa respondeu com
e-mail ou telefone de contato no texto.

Uso:
    python scripts/carregar_leads_linkedin.py --json achados_final.json --dono leonardobarrey@gmail.com
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

DOMINIOS_GENERICOS = {
    "gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br", "yahoo.com",
    "live.com", "icloud.com", "uol.com.br", "bol.com.br", "terra.com.br",
    "kistsolucoes.com.br",
}


def compacta(s, limite):
    if not s:
        return s
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limite]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--dono", required=True, help="e-mail do operador dono (quem exportou o LinkedIn)")
    args = ap.parse_args()

    env_path = Path(__file__).parent / ".env"
    load_dotenv(env_path)
    url = os.environ.get("SUPABASE_URL", "https://owpmcoithvzdlhmfkvbe.supabase.co")
    key = os.environ.get("SUPABASE_KEY")
    if not key:
        print("ERRO: SUPABASE_KEY nao definido em scripts/.env", file=sys.stderr)
        sys.exit(1)
    sb = create_client(url, key)

    with open(args.json, encoding="utf-8") as f:
        achados = json.load(f)

    dono = args.dono.strip().lower()

    # 1) reune por dominio (uma pessoa pode ter 2+ e-mails do mesmo dominio)
    por_dominio = {}
    sem_dominio = []
    for a in achados:
        doms = [d for d in (a.get("dominios") or []) if d not in DOMINIOS_GENERICOS]
        if not doms:
            sem_dominio.append(a)
            continue
        for dom in doms:
            entry = por_dominio.setdefault(dom, {"contatos": [], "empresa": None, "primeiro_envio": None, "ultimo_envio": None})
            if a.get("empresa") and not entry["empresa"]:
                entry["empresa"] = a["empresa"][:120]
            for email in a["emails"]:
                if email.split("@", 1)[1].lower() != dom:
                    continue
                entry["contatos"].append({
                    "email": email.lower(), "nome": a["nome"], "cargo": a.get("cargo"),
                    "telefone": (a["telefones"][0] if a["telefones"] else None),
                    "data": a["data"], "primeiro_envio": a["primeiro_envio"],
                    "trecho": a["trecho"], "profile_url": a.get("profile_url"),
                })
            pe, ue = a["primeiro_envio"], a["data"]
            if not entry["primeiro_envio"] or pe < entry["primeiro_envio"]:
                entry["primeiro_envio"] = pe
            if not entry["ultimo_envio"] or ue > entry["ultimo_envio"]:
                entry["ultimo_envio"] = ue

    print(f"Dominios distintos encontrados: {len(por_dominio)}")
    print(f"Achados sem dominio (so telefone): {len(sem_dominio)}")
    for a in sem_dominio:
        print(f"  - {a['nome']} | {a.get('empresa')} | tel: {a['telefones']}")

    existentes_resp = sb.table("leads_prospeccao_dominios").select("id,dominio").in_(
        "dominio", list(por_dominio.keys())
    ).execute()
    id_por_dominio = {r["dominio"]: r["id"] for r in existentes_resp.data}
    novos_dominios = [d for d in por_dominio if d not in id_por_dominio]
    print(f"Dominios NOVOS (nao existiam): {len(novos_dominios)} -> {novos_dominios}")
    print(f"Dominios que ja existiam (so enriquecidos): {len(por_dominio) - len(novos_dominios)}")

    if novos_dominios:
        linhas = []
        for dom in novos_dominios:
            info = por_dominio[dom]
            linhas.append({
                "dominio": dom, "empresa": info["empresa"], "status": "frio",
                "estagio_funil": "respondeu", "teve_resposta": True, "dono_email": dono,
                "primeiro_envio": info["primeiro_envio"], "ultimo_envio": info["ultimo_envio"],
                "ultimo_contato_em": info["ultimo_envio"],
            })
        sb.table("leads_prospeccao_dominios").upsert(linhas, on_conflict="dominio").execute()
        resp2 = sb.table("leads_prospeccao_dominios").select("id,dominio").in_("dominio", novos_dominios).execute()
        for r in resp2.data:
            id_por_dominio[r["dominio"]] = r["id"]

    contatos_rows, interacoes_rows = [], []
    for dom, info in por_dominio.items():
        dom_id = id_por_dominio.get(dom)
        if not dom_id:
            continue
        vistos_email = set()
        for c in info["contatos"]:
            if c["email"] in vistos_email:
                continue
            vistos_email.add(c["email"])
            contatos_rows.append({
                "dominio_id": dom_id, "email": c["email"], "nome": compacta(c["nome"], 200),
                "cargo": compacta(c.get("cargo"), 200), "telefone": c.get("telefone"),
                "origem": "prospeccao",
            })
            interacoes_rows.append({
                "dominio_id": dom_id, "email": c["email"], "nome": compacta(c["nome"], 200),
                "telefone": c.get("telefone"), "data_interacao": c["data"],
                "assunto": f"LinkedIn — {c.get('profile_url') or ''}"[:500],
                "trecho": compacta(c["trecho"], 2000), "canal": "linkedin", "direcao": "recebido",
                "origem": "importacao_linkedin",
                "outlook_entry_id": f"linkedin:{c['profile_url']}:{c['data']}:{c['email']}"[:255],
            })

    print(f"Gravando {len(contatos_rows)} contatos...")
    if contatos_rows:
        sb.table("leads_prospeccao_contatos").upsert(contatos_rows, on_conflict="dominio_id,email").execute()
    print(f"Gravando {len(interacoes_rows)} interacoes...")
    if interacoes_rows:
        sb.table("leads_prospeccao_interacoes").upsert(interacoes_rows, on_conflict="outlook_entry_id").execute()

    print("\nConcluido.")


if __name__ == "__main__":
    main()
