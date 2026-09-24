"""
Le o JSON gerado por extrair_leads_email.py e grava (upsert) em:
  public.leads_prospeccao_dominios
  public.leads_prospeccao_contatos
  public.leads_prospeccao_interacoes

Cruza com public.clientes_dominios para excluir/marcar quem ja e cliente
(tem proposta gerada no Kist).

Credenciais: le SUPABASE_URL / SUPABASE_KEY de scripts/.env (nao versionado).
SUPABASE_KEY precisa ser a service_role key (Project Settings > API no
Supabase), porque as tabelas leads_prospeccao_* tem RLS sem policy.

Uso:
    python scripts/carregar_leads_supabase.py --json <caminho_do_json>
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


def limpa_dominio(dom):
    return dom.strip().strip("'\".,;:").lower()


def limpa_texto(s):
    if not s:
        return s
    return s.strip().strip("'\"").strip()


def compacta(s, limite):
    if not s:
        return s
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limite]


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    args = ap.parse_args()

    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        print(f"ERRO: {env_path} nao encontrado. Crie o arquivo com SUPABASE_KEY=<service_role key>.", file=sys.stderr)
        sys.exit(1)
    load_dotenv(env_path)

    url = os.environ.get("SUPABASE_URL", "https://owpmcoithvzdlhmfkvbe.supabase.co")
    key = os.environ.get("SUPABASE_KEY")
    if not key:
        print("ERRO: SUPABASE_KEY nao definido em scripts/.env", file=sys.stderr)
        sys.exit(1)

    sb = create_client(url, key)

    with open(args.json, encoding="utf-8") as f:
        data = json.load(f)

    print("Buscando dominios que ja sao clientes (public.clientes_dominios)...")
    resp = sb.table("clientes_dominios").select("dominio").execute()
    ja_clientes = {row["dominio"].lower() for row in resp.data if row.get("dominio")}
    print(f"  {len(ja_clientes)} dominios ja clientes.")

    dominios_raw = {}
    for item in data["dominios"]:
        dom = limpa_dominio(item["dominio"])
        if len(dom) < 4 or "." not in dom or dom in DOMINIOS_GENERICOS:
            continue
        agg = dominios_raw.setdefault(dom, {
            "contatos": {}, "primeiro_envio": None, "ultimo_envio": None, "teve_resposta": False
        })
        for c in item["contatos_prospectados"]:
            email = limpa_texto(c["email"]).lower()
            if "@" not in email:
                continue
            agg["contatos"][email] = limpa_texto(c["nome"]) or email
        for campo in ("primeiro_envio", "ultimo_envio"):
            v = item.get(campo)
            if v:
                if campo == "primeiro_envio" and (not agg[campo] or v < agg[campo]):
                    agg[campo] = v
                if campo == "ultimo_envio" and (not agg[campo] or v > agg[campo]):
                    agg[campo] = v
        agg["teve_resposta"] = agg["teve_resposta"] or item["teve_resposta"]

    print(f"Dominios validos extraidos: {len(dominios_raw)}")

    dominios_rows = []
    for dom, info in dominios_raw.items():
        status = "convertido" if dom in ja_clientes else "frio"
        dominios_rows.append({
            "dominio": dom,
            "primeiro_envio": info["primeiro_envio"],
            "ultimo_envio": info["ultimo_envio"],
            "teve_resposta": info["teve_resposta"],
            "status": status,
        })

    print(f"Gravando {len(dominios_rows)} dominios...")
    for lote in chunked(dominios_rows, 200):
        sb.table("leads_prospeccao_dominios").upsert(lote, on_conflict="dominio").execute()

    print("Buscando ids dos dominios gravados...")
    id_por_dominio = {}
    for lote in chunked(list(dominios_raw.keys()), 200):
        resp = sb.table("leads_prospeccao_dominios").select("id,dominio").in_("dominio", lote).execute()
        for row in resp.data:
            id_por_dominio[row["dominio"]] = row["id"]

    contatos_rows = []
    vistos = set()
    for dom, info in dominios_raw.items():
        dom_id = id_por_dominio.get(dom)
        if not dom_id:
            continue
        for email, nome in info["contatos"].items():
            key = (dom_id, email)
            if key in vistos:
                continue
            vistos.add(key)
            contatos_rows.append({
                "dominio_id": dom_id,
                "email": email,
                "nome": compacta(nome, 200),
                "origem": "prospeccao",
            })

    print(f"Gravando {len(contatos_rows)} contatos prospectados...")
    for lote in chunked(contatos_rows, 300):
        sb.table("leads_prospeccao_contatos").upsert(lote, on_conflict="dominio_id,email").execute()

    interacoes_rows = []
    vistos_int = set()
    for it in data["interacoes"]:
        dom = limpa_dominio(it["dominio"])
        dom_id = id_por_dominio.get(dom)
        if not dom_id:
            continue
        eid = it.get("outlook_entry_id")
        if not eid or eid in vistos_int:
            continue
        vistos_int.add(eid)
        interacoes_rows.append({
            "dominio_id": dom_id,
            "email": limpa_texto(it.get("email")),
            "nome": compacta(limpa_texto(it.get("nome")), 200),
            "telefone": limpa_texto(it.get("telefone")),
            "data_interacao": it.get("data"),
            "assunto": compacta(it.get("assunto"), 500),
            "trecho": compacta(it.get("trecho"), 2000),
            "pasta_outlook": it.get("pasta"),
            "outlook_entry_id": eid,
        })

    print(f"Gravando {len(interacoes_rows)} interacoes...")
    for lote in chunked(interacoes_rows, 300):
        sb.table("leads_prospeccao_interacoes").upsert(lote, on_conflict="outlook_entry_id").execute()

    print("\nConcluido.")
    print(f"  dominios: {len(dominios_rows)} (dos quais {sum(1 for r in dominios_rows if r['status']=='convertido')} ja sao clientes)")
    print(f"  contatos: {len(contatos_rows)}")
    print(f"  interacoes: {len(interacoes_rows)}")


if __name__ == "__main__":
    main()
