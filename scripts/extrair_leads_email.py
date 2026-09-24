"""
Reconstroi a base de leads frios de prospeccao a partir do Outlook local:

1. Varre TODAS as pastas de "Itens Enviados" (em TODAS as contas/stores do
   perfil, inclusive as aninhadas dentro da Caixa de Entrada em contas IMAP)
   atras de e-mails com um dos assuntos de prospeccao da Kist -> lista mestra
   de dominios/contatos prospectados, com a data em que o contato foi
   estabelecido (primeiro envio).
2. Para cada dominio prospectado, varre TODAS as caixas de entrada (todas as
   contas) atras de qualquer interacao (resposta direta ou outro contato do
   mesmo dominio) -> historico de interacoes e contatos.
3. Cruza os dominios encontrados com public.clientes_dominios no Supabase e
   remove quem ja virou cliente (tem proposta gerada).
4. Grava o resultado consolidado em JSON (dominios / contatos / interacoes)
   para carga posterior no Supabase.

Requisitos: Outlook aberto e logado, pacote pywin32 instalado.

Uso:
    python scripts/extrair_leads_email.py --meses 36 --json saida.json
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta

import win32com.client

ASSUNTOS_PROSPECCAO = {
    "apresentação e cadastro fornecedor kist",
    "apresentação kist - fornecedor estratégico",
    "apresentação fornecedor kist - itens básicos aos complexos",
    "apresentação fornecedor kist",
    "apresentação e cadastro kist - fornecedor",
}

NOMES_PASTA_ENVIADOS = {"itens enviados", "sent", "sent items", "enviados", "itens enviados (this computer only)"}
NOMES_PASTA_ENTRADA = {"caixa de entrada", "inbox"}

# Dono do lead = quem prospectou primeiro (Leonardo, 24/09): usado pra restringir
# qual bot pode interagir com qual lead. tbackup e' backup do Thiago; contato@ e'
# a caixa do Fabio (confirmado por ele).
STORE_PARA_DONO = {
    "arquivo de dados do outlook": "leonardobarrey@gmail.com",
    "leonardo@kistsolucoes.com.br": "leonardobarrey@gmail.com",
    "thiago@kistsolucoes.com.br": "thiagokist@gmail.com",
    "tbackup@kistsolucoes.com.br": "thiagokist@gmail.com",
    "fabio@kistsolucoes.com.br": "fabiokist@gmail.com",
    "contato@kistsolucoes.com.br": "fabiokist@gmail.com",
}

DOMINIOS_GENERICOS = {
    "gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br", "yahoo.com",
    "live.com", "icloud.com", "uol.com.br", "bol.com.br", "terra.com.br",
    "kistsolucoes.com.br",
}

RE_TELEFONE = re.compile(r"\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b")


def resolver_smtp(mail_item):
    try:
        if mail_item.SenderEmailType == "EX":
            exch_user = mail_item.Sender.GetExchangeUser()
            if exch_user:
                return exch_user.PrimarySmtpAddress
        return mail_item.SenderEmailAddress
    except Exception:
        try:
            return mail_item.SenderEmailAddress
        except Exception:
            return None


def resolver_smtp_recipient(recipient):
    try:
        if recipient.AddressEntry.Type == "EX":
            exch_user = recipient.AddressEntry.GetExchangeUser()
            if exch_user:
                return exch_user.PrimarySmtpAddress
        return recipient.Address
    except Exception:
        try:
            return recipient.Address
        except Exception:
            return None


def iterar_pastas(pasta):
    yield pasta
    try:
        for sub in pasta.Folders:
            yield from iterar_pastas(sub)
    except Exception:
        pass


def achar_pastas(store_root, nomes_possiveis):
    achadas = []
    for pasta in iterar_pastas(store_root):
        if pasta.Name.strip().lower() in nomes_possiveis:
            achadas.append(pasta)
    return achadas


def extrair_telefone(texto):
    m = RE_TELEFONE.search(texto or "")
    return m.group(0) if m else None


def coletar_prospectados(namespace, desde):
    stores = list(namespace.Folders)
    prospectados = {}
    total_emails_prospeccao = 0

    for store in stores:
        pastas_enviados = achar_pastas(store, NOMES_PASTA_ENVIADOS)
        for pasta_enviados in pastas_enviados:
            for pasta in iterar_pastas(pasta_enviados):
                try:
                    items = pasta.Items
                except Exception:
                    continue
                try:
                    items = items.Restrict(
                        "[SentOn] >= '" + desde.strftime("%m/%d/%Y %H:%M %p") + "'"
                    )
                except Exception:
                    pass

                for item in items:
                    try:
                        if item.Class != 43:
                            continue
                        assunto = (item.Subject or "").strip().lower()
                        if assunto not in ASSUNTOS_PROSPECCAO:
                            continue

                        total_emails_prospeccao += 1
                        enviado_em = item.SentOn.isoformat() if item.SentOn else None
                        dono = STORE_PARA_DONO.get(store.Name.strip().lower())

                        for rec in item.Recipients:
                            if rec.Type not in (1, 2):  # olTo=1, olCC=2
                                continue
                            email = resolver_smtp_recipient(rec)
                            if not email or "@" not in email:
                                continue
                            email = email.lower().strip()
                            dominio = email.split("@", 1)[1]
                            if dominio in DOMINIOS_GENERICOS:
                                continue

                            d = prospectados.setdefault(dominio, {
                                "contatos": {}, "primeiro_envio": enviado_em, "ultimo_envio": enviado_em,
                                "dono_email": dono,
                            })
                            d["contatos"][email] = rec.Name or email
                            if enviado_em:
                                if not d["primeiro_envio"] or enviado_em < d["primeiro_envio"]:
                                    d["primeiro_envio"] = enviado_em
                                    d["dono_email"] = dono  # dono = quem mandou o PRIMEIRO contato
                                if not d["ultimo_envio"] or enviado_em > d["ultimo_envio"]:
                                    d["ultimo_envio"] = enviado_em
                    except Exception as e:
                        print(f"  [aviso] item ilegivel em Itens Enviados ({store.Name}): {e}", file=sys.stderr)
                        continue

    print(f"  (e-mails de prospeccao encontrados nos Itens Enviados: {total_emails_prospeccao})")
    return prospectados


def coletar_interacoes(namespace, desde, dominios_alvo):
    interacoes = []
    stores = list(namespace.Folders)

    for store in stores:
        pastas_entrada = achar_pastas(store, NOMES_PASTA_ENTRADA)
        for pasta_entrada in pastas_entrada:
            for pasta in iterar_pastas(pasta_entrada):
                # nao descer dentro da propria pasta de enviados aninhada na entrada (IMAP)
                if pasta.Name.strip().lower() in NOMES_PASTA_ENVIADOS:
                    continue
                try:
                    items = pasta.Items
                except Exception:
                    continue
                try:
                    items = items.Restrict(
                        "[ReceivedTime] >= '" + desde.strftime("%m/%d/%Y %H:%M %p") + "'"
                    )
                except Exception:
                    pass

                for item in items:
                    try:
                        if item.Class != 43:
                            continue
                        email = resolver_smtp(item)
                        if not email or "@" not in email:
                            continue
                        email = email.lower().strip()
                        dominio = email.split("@", 1)[1]
                        if dominio not in dominios_alvo:
                            continue

                        corpo = (item.Body or "")[:1500]
                        interacoes.append({
                            "dominio": dominio,
                            "email": email,
                            "nome": item.SenderName or "",
                            "telefone": extrair_telefone(corpo),
                            "data": item.ReceivedTime.isoformat() if item.ReceivedTime else None,
                            "assunto": (item.Subject or "").strip(),
                            "trecho": corpo.strip(),
                            "outlook_entry_id": item.EntryID,
                            "pasta": f"{store.Name} / {pasta.Name}",
                        })
                    except Exception as e:
                        print(f"  [aviso] item ilegivel em '{pasta.Name}': {e}", file=sys.stderr)
                        continue

    return interacoes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meses", type=int, default=36)
    ap.add_argument("--json", required=True, help="caminho do arquivo JSON de saida (UTF-8)")
    args = ap.parse_args()

    desde = datetime.now() - timedelta(days=args.meses * 30)

    print(f"Conectando ao Outlook local... (desde {desde:%d/%m/%Y})")
    outlook = win32com.client.Dispatch("Outlook.Application")
    namespace = outlook.GetNamespace("MAPI")

    print("Passo 1/2: varrendo Itens Enviados (todas as contas) por assuntos de prospeccao...")
    prospectados = coletar_prospectados(namespace, desde)
    print(f"  {len(prospectados)} dominios prospectados encontrados.")

    print("Passo 2/2: varrendo todas as Caixas de Entrada por interacoes desses dominios...")
    interacoes = coletar_interacoes(namespace, desde, set(prospectados.keys()))
    print(f"  {len(interacoes)} interacoes encontradas.")

    dominios_com_interacao = {i["dominio"] for i in interacoes}

    saida = {
        "gerado_em": datetime.now().isoformat(),
        "meses": args.meses,
        "dominios": [
            {
                "dominio": dom,
                "contatos_prospectados": [
                    {"email": e, "nome": n} for e, n in info["contatos"].items()
                ],
                "primeiro_envio": info["primeiro_envio"],
                "ultimo_envio": info["ultimo_envio"],
                "dono_email": info.get("dono_email"),
                "teve_resposta": dom in dominios_com_interacao,
            }
            for dom, info in prospectados.items()
        ],
        "interacoes": interacoes,
    }

    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=2)

    print(f"\nJSON gravado em {args.json}")
    print(f"  dominios prospectados: {len(prospectados)}")
    print(f"  dominios com resposta/interacao: {len(dominios_com_interacao)}")


if __name__ == "__main__":
    main()
