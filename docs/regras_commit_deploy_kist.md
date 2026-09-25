# Regras de commit e deploy — kist-app

Vale para toda conversa deste projeto. Atualizado em 25/09/2026.

## 1. Onde está o código
- Repositório: `lbarrey-pixel/kist-app`, branch `main`.
- O Render tem **deploy automático a partir do `main`**. Push no `main` = produção. Backend e frontend sobem juntos.
- O clone de trabalho do Leonardo é **`C:\Users\VevecoPC\Documents\GitHub\kist-app`**. Esse é o que o GitHub Desktop usa.
- Existe um segundo clone em `Documents\kistapp\kist-app`. Não gravar nele. Se o GitHub Desktop não mostrar uma alteração, a primeira suspeita é clone errado.

## 2. Antes de mexer
1. Partir do código que está no `main` agora, nunca de memória ou de uma versão antiga. Na nuvem, clonar ou dar `git fetch`. No PC, conferir que o arquivo local é igual ao do `main`.
2. Consultar o histórico do projeto e o versionamento (`versionamento_kist_*.md`) para não desfazer regra já decidida.
3. Regra de negócio com dúvida: **perguntar antes de codar.** Número, limite ou corte que o Leonardo não deu vem declarado como suposição e fica fácil de mudar (constante).
4. Achou um dado suspeito durante a análise (preço discrepante, flag de erro, campo vazio)? **Parar e levar ao Leonardo antes de escrever a correção**, não no fim.

## 3. Testes obrigatórios antes de entregar
- Backend: `python -m py_compile backend/main.py`.
- **Invariantes do CSV:** hash AST de `fmt_preco` e `gerar_csv` idêntico antes e depois (use `ast.walk`, porque as duas funções ficam dentro da rota). Hoje: `gerar_csv 2c02ff110c…`, `fmt_preco 8968deaba9…` (md5 de `ast.dump`, 10 primeiros caracteres).
- Frontend: bundle do esbuild **a partir de `frontend/src/main.jsx`** (o entry point do Vite), não do `App.jsx`.
- Lógica nova: teste com **dados reais** do Supabase (a proposta do caso), não só com dado inventado.
- Função duplicada entre backend e frontend (ex.: `_pix_suspeito` e `pixSuspeito`): testar as duas e marcar no comentário "espelho — mudou um, mude o outro".

## 4. Versão
- Toda entrega de backend sobe `VERSAO_BACKEND` em `backend/main.py` (ex.: 3.82 → 3.83).
- Comentário no código com a tag da versão e o porquê (`# v3.83 — regra do Leonardo, caso R-1375`).
- O versionamento em `.md` ganha a entrada da versão no mesmo dia.
- **Sessões em paralelo (25/09):** mais de uma conversa do Claude pode estar mexendo no MESMO clone ao mesmo tempo. Logo antes de subir a versão, `git fetch` + conferir o `VERSAO_BACKEND` atual e o topo do versionamento — se outra sessão já usou o número, pegue o próximo. Nunca reaproveitar um número que outra sessão marcou no código, mesmo que ela ainda não tenha commitado.

## 5. Commit
- Só os arquivos alterados. Nunca `__pycache__`, `.pyc`, `node_modules` ou arquivo de teste.
- Mensagem: `vX.YY — o que mudou em uma linha`. Exemplo: `v3.83 — venda automática do Dwight + Pix suspeito usa preço cheio`.
- **Pelo GitHub Desktop:** 1) `git pull` (Fetch/Pull) antes de tudo; 2) conferir a lista de arquivos alterados; 3) Commit to main; 4) Push origin.
- **Pelo Claude na nuvem:** a conversa precisa começar com o repositório `lbarrey-pixel/kist-app` selecionado no seletor de repositório. O app Claude já está instalado no GitHub com acesso a todos os repositórios. Uma conversa aberta sem o repositório não consegue fazer push (erro 403) e não dá para incluir depois: abra outra.
- **Antes de commitar, `git diff` arquivo por arquivo.** Trecho que você não escreveu é de outra sessão em andamento: não entra no seu commit. Comite só os seus trechos (`git apply --cached` com um patch só deles) e avise a outra sessão que o HEAD andou.
- Se o Claude gravar arquivos direto na pasta local, o commit e o push **são do próprio Claude** (`git commit` + `git push origin main`), sem esperar o Leonardo passar pelo GitHub Desktop. Regra do Leonardo, 24/09: "sempre você sobe, não há mais commits pela minha parte".

## 6. Depois do push
1. Conferir que o `main` no GitHub tem o commit (`git fetch` e `git log origin/main`).
2. Conferir que o Render publicou os DOIS serviços: o backend pela versão em `/openapi.json` (`info.version`, rota aberta); o frontend pelo nome do pacote `assets/index-*.js` servido na página. Em 23/09 o auto-deploy do **kist-frontend não disparou** com o push e foi preciso publicar à mão pelo painel.
3. **Só depois do deploy confirmado** atualizar as bases de conhecimento:
   - `config_kist['capacidades_nucleo']` (Analista **e o balão de Suporte**, que usa o mesmo núcleo): backup antes em `capacidades_nucleo_bkp_AAAAMMDD`, texto com dollar-quoting `$nucleo$…$nucleo$`, cabeçalho "Versão do núcleo" atualizado. Se a versão escrita no núcleo for diferente do `VERSAO_BACKEND` em produção, os dois agentes recebem o aviso "seu conhecimento pode estar atrasado" — em 25/09 o núcleo estava na v3.90 com produção na v3.107. Prefira trocar trechos (`replace`) e acrescentar seção nova no fim a reescrever o texto inteiro.
   - tabela `conhecimento` (bots, servida por `/contexto`): backup `_bkp_AAAAMMDD_conhecimento`; a coluna `versao` sobe sozinha.
   - guias servidos pela API (`/api/guia/*`) mudam no código, então vão no mesmo commit.
4. Validar o caso real que motivou a mudança (ex.: abrir a R-1375 e ver o custo certo).

## 7. Banco (Supabase `owpmcoithvzdlhmfkvbe`)
- Mudança de banco é deploy: testar contra o banco real.
- Backup nomeado (`_bkp_AAAAMMDD_tabela`) antes de qualquer UPDATE ou DELETE em lote.
- Campo novo = coluna + persistência na rota que grava + leitura na rota que lê + tela.
- Valor novo numa coluna com `CHECK` (ex.: `pesquisa_vereditos.veredito`) exige migration ampliando a trava **antes** do deploy do código que grava o valor. Em 25/09 a categoria `sem_oferta` foi recusada pelo banco e só apareceu no recálculo — o código engolia o erro.

## 8. Nunca
- Push no `main` com regra de negócio pendente de decisão.
- Editar `fmt_preco` ou `gerar_csv`, nem a docstring deles.
- Afirmar que subiu, que está igual ou que funcionou sem ter conferido por dois caminhos.
