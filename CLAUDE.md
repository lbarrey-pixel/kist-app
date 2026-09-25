# kist-app — Kist Cabine de Compras

Sistema interno de cotação → proposta → Tiny → OC da Kist Soluções.
Backend FastAPI (`backend/main.py`) e frontend React/Vite (`frontend/src/App.jsx`), ambos no Render com deploy automático a partir do `main`. Banco: Supabase `owpmcoithvzdlhmfkvbe`.

## Leia antes de alterar código
- `docs/regras_commit_deploy_kist.md` — como testar, versionar, commitar e publicar.
- `docs/versionamento_kist_v3.59-v3.90.md` — o que mudou em cada versão e por quê, da v3.59 em diante (o nome do arquivo ficou histórico; o conteúdo segue atualizado). Versões até a v3.58 estão no núcleo do Analista (`config_kist['capacidades_nucleo']`).

## O essencial
- Push no `main` = produção. Não suba regra de negócio pendente de decisão.
- Dúvida de regra de negócio: pergunte ao Leonardo antes de codar.
- `fmt_preco` e `gerar_csv` são invariantes: hash AST idêntico antes e depois.
- Toda entrega de backend sobe `VERSAO_BACKEND` e ganha entrada no versionamento.
- Outra sessão pode estar mexendo no mesmo clone ao mesmo tempo: `git fetch` e `git diff` antes de subir versão e de commitar — comite só os seus trechos (detalhes nas regras de commit).
- Teste o frontend partindo de `frontend/src/main.jsx`. Teste lógica nova com dados reais do Supabase.
- Base de conhecimento (núcleo do Analista e tabela `conhecimento` dos bots) só é atualizada depois do deploy confirmado, com backup antes.
- O operador é a hierarquia superior: o sistema aprende com ele, nunca o sobrepõe.
