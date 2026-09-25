# Kist Cabine: versionamento v3.59 a v3.90

Atualizado em 23/09/2026. Continua o histórico até a v3.58 que está no núcleo do Analista (`config_kist['capacidades_nucleo']`).

Reconstruído dos diffs do git (`git diff <versão anterior> <versão> -- backend frontend`, sem `__pycache__`) e dos comentários do código marcados com "v3.NN". As mensagens de commit não trazem informação útil. Datas: data do commit (2026). Quando o comentário do código dá outra data para a decisão, ela aparece entre parênteses.

Legenda: **[B]** backend · **[F]** frontend · **DB** objetos de banco que o código usa (todos conferidos no Supabase em 23/09: existem) · **⚠** observação ou ponto incerto.

Versões que não têm commit próprio: **v3.69** está dentro de bcd73d0 (v3.70), **v3.71** dentro de 99a8b5f (v3.72), **v3.74** dentro de f54167b (v3.75) e **v3.78** dentro de 1bc7b11 (v3.79). Elas só aparecem nos comentários do código.

---

## v3.59 · 15/09 · 26ec2fa · "Outros itens ou serviços" no orçamento do Tiny
- [B] `POST /propostas/exportar-tiny`: novo campo `outros_itens`, que vai para `extras.descricao` do orçamento no Tiny. O Tiny guarda esse campo como HTML: texto puro vira `<p>` por linha, HTML enviado é respeitado, limite de 4000 caracteres. O campo também é completado a partir da proposta salva quando não vem no payload.
- [B] `POST /salvar-proposta`: passa a gravar `outros_itens`.
- [F] Novo textarea "Outros itens ou serviços" em "Dados da proposta (Tiny)", para o que não é item de linha (condição de frete, escopo, observação técnica). O campo é carregado ao reabrir a proposta.
- DB: `propostas.outros_itens` (coluna nova, necessária).

## v3.60 · 15/09 · 218f51f · Proposta encontrada pelo id interno ou pelo número
- [B] Novo helper `_resolver_proposta(sb, ref)`: procura primeiro pelo `id` interno e, se não achar, por `numero_proposta` exato. Número repetido devolve **409** com a lista de ids. Nada encontrado devolve **404**. As faixas de valores não se cruzam (id perto de 1.300, número a partir de 1.050.390). O teto int64 evita erro 500 do PostgREST.
- [B] `GET /propostas/{proposta_id}/detalhe` e `GET /propostas/{proposta_id}/itens`: o parâmetro passou de `int` para `str` e aceita os dois. `/itens` devolve 404 quando a proposta não existe (antes devolvia `[]`, que o agente entendia como "sem acesso").
- Motivo: os agentes (Kepler, bots do Leonardo) só conhecem o NÚMERO. Casos de 15/09: 1050863, 1050878 e 1050879.
- Regra: qualquer operador lê proposta de qualquer outro, sem filtro por dono.

## v3.61 · 17/09 · a13e121 · Pesquisa de preço pelo Dwight (webhook + retorno por item)
- [B] Novo escopo de API key **`pesquisa`**, restrito a uma lista fechada de rotas: `POST /propostas/{numero}/pesquisa-resultado` e `GET /api/whoami`. Se a chave vazar, o pior que ela faz é gravar uma sugestão que o operador ainda precisa aceitar. `/api/whoami` passa a listar esse escopo.
- [B] **Identidade estável do item**: `item_uid` (UUID). `/salvar-proposta` apaga e recria as linhas, então o `id` muda a cada auto-save. O `item_uid` acompanha o item e serve de âncora para o resultado da pesquisa. Sem uid válido no payload, o banco gera um (default da coluna).
- [B] Novas rotas:
  - `POST /propostas/{ref}/pesquisa-dwight`: dispara a pesquisa **só pela tela** (chave de API recebe 403). Envia os itens sem match ou com match incerto (`_item_elegivel_pesquisa`, espelho de `semMatchUtil`) em um POST assíncrono, numa thread, para `DWIGHT_WEBHOOK_URL`. Aceita `item_uids` e `forcar`. Um disparo repetido na mesma proposta dentro de 1 h, com item ainda aguardando, recebe 409. Sem as variáveis de ambiente, responde 503.
  - `POST /propostas/{ref}/pesquisa-resultado`: recebe o retorno do agente item a item, identificado pelo `item_uid`. Normaliza as ofertas (`loja, link, preco_pix, preco_cheio, estoque, pn, fabricante, sku, frete, prazo, obs`, no máximo 10) e aceita `escolha` e `telemetria`. **Nunca mexe em `itens_proposta`.** Item que não pertence à proposta é ignorado, com motivo.
  - `GET /propostas/{ref}/pesquisa-resultado`: último resultado por item. Um registro "aguardando" há mais de 3 h aparece como "expirado".
- [B] Contrato: o agente nunca chama `/salvar-proposta` e nunca exporta. Quem decide é o operador ("usar esta"). O envio é assíncrono porque uma chamada lenta ao webhook não pode segurar o worker ("foi assim que o backend congelou em julho").
- [F] O `item_uid` é criado no navegador (`novoUid`). Botão "🔎 pesquisar com o Dwight", card "Pesquisa do Dwight" na gaveta da internet com status, ofertas e "usar esta", polling a cada 20 s enquanto houver item aguardando. "usar esta" preenche custo (Pix, ou o cheio se não houver Pix) e origem. A venda fica em branco e o frete estimado não entra.
- DB: `itens_proposta.item_uid` (uuid com default), tabela `pesquisa_resultados` (proposta_id, numero_proposta, item_uid, external_key, origem, status, descricao, solicitado_por, resultado, telemetria, respondido_por, respondido_em, despacho_http, despacho_erro, criado_em). Env: `DWIGHT_WEBHOOK_URL`, `DWIGHT_WEBHOOK_KEY`, `CABINE_PUBLIC_URL`.

## v3.62 · 17/09 · 5eade75 · Imagem corrompida não derruba mais a cotação (caso Convergint)
- [B] `ingestao.py`: nova função `img_sanear()`, que devolve um de 4 estados: `ok`, `recuperada` (PNG truncado lido com `LOAD_TRUNCATED_IMAGES`, sob lock), `convertida` (BMP/TIFF ou imagem grande demais convertida para PNG/JPEG, lado máximo 2000 px) ou `ilegivel` (descartada). Limites: 7900 px de lado e 3,7 MB antes do base64.
- [B] `montar_payload` saneia todas as imagens antes de montar o pedido. A imagem recuperada entra com um rótulo que avisa o modelo. O relatório ganha `imagens_recuperadas`, `imagens_convertidas` e `imagens_ilegiveis`.
- [B] `/extrair`: rede de segurança. Se a API ainda assim recusar uma imagem (400), a extração é refeita **só com o texto**, o sistema avisa `extracao:imagem_recusada` e essa leitura parcial **não vai para o cache**. Novas notas para o operador: `imagem_recuperada` e `imagem_ilegivel`.
- Regra (Anelise, 17/09): uma imagem ruim nunca derruba a cotação. O que der para recuperar é recuperado e o operador é avisado.

## v3.63 · 17/09 · 7e24ad7 · Dwight pesquisa todos os itens; fonte sob demanda; carregamento automático
- [B] `POST /propostas/{ref}/pesquisa-dwight`: por **padrão vão TODOS os itens**, inclusive os que já têm preço e match exato (decisão do Leonardo, 17/09: "o mercado pode estar mais barato que o custo gravado"). `somente_sem_match: true` volta ao filtro antigo. Em vez do 409, o item que já está aguardando é pulado e aparece em `repetidos`.
- [B] Nova rota `GET /propostas/{ref}/fonte` (texto puro, `compacto=1` por padrão): o texto que a IA leu na extração, para o agente tirar dúvida sem receber 3,5 mil caracteres em toda pesquisa. O payload do webhook ganha `fonte` com a URL (um ponteiro, não o conteúdo). O escopo `pesquisa` passa a incluir essa rota.
- [F] Card do Dwight compacto, com botão "pesquisar este item" e "pesquisar de novo" (usa `forcar` e `item_uids`).
- [F] Regra de escrita `decidirEscrita` (Leonardo, 17/09): o Dwight escreve no item se o item **não tem origem**, ou se a oferta dele é **mais barata** que o custo atual. Item com origem e sem custo para comparar não é escrito. A **venda nunca é tocada**.
- [F] Botão "carregar itens do Dwight (n)", checkbox "preencher sozinho" (ligado por padrão, guardado em `localStorage kist_dwight_auto`, cada item é aplicado uma única vez) e "desfazer".
- [F] Rótulos das notas `imagem_recuperada` e `imagem_ilegivel` da v3.62.

## v3.64 · 17/09 · de88ff1 · Venda pela mediana de markup por item
- [B] Nova rota `POST /markup-itens`: markup mediano **por item**, do mais específico para o mais geral: este item com este cliente, depois este item com qualquer cliente, depois este cliente, depois o geral. "Este item" casa por `banco_id` ou pela descrição normalizada. Amostra mínima: 3 para item e 8 para cliente. Devolve `{fator, fonte, amostra}` por chave `k`.
- [F] Botão "carregar com venda (n)": carrega custo e origem do Dwight e preenche `preco_un = custo × fator` (arredondado em centavos) **só onde a venda estava em branco**.
- DB: RPC `markup_por_item(p_cnpj, p_itens, p_min_item, p_min_cliente)`.

## v3.65 · 17/09 · 212df7e · Balão de dúvida (Suporte)
- [B] `POST /analista/chat` ganha o campo `modo` (`chamado` por padrão, ou `suporte`). O modo suporte usa o prompt extra `SYSTEM_SUPORTE_EXTRA` (resposta em 2 a 5 linhas com tela e caminho, "não sei" quando não sabe, sem abrir chamado), **Haiku 4.5** em vez de Sonnet 4.6, `max_tokens` 1200, as últimas 12 mensagens, sem a ferramenta de ficha e sem contexto de anexos.
- [F] Novo `Suporte.jsx`: botão "?" fixo no canto, disponível em qualquer tela, com sugestões de pergunta e link "abrir em Requisições" para bug ou pedido de mudança.
- Motivo: a tela Requisições serve para levantar chamado. Quem só quer saber onde clicar ficava sem resposta ou perguntava no WhatsApp.

## v3.66 · 17/09 · 9315a33 · Matching em lotes; planilha lida por inteiro (NEG 0043770)
- [B] O matching com Haiku roda em **lotes de 8 itens** (antes, uma chamada com todos). Caso de 17/09, com 41 itens: um prompt de 42 mil tokens, uma resposta truncada e um timeout de 136 s derrubaram o matching da proposta inteira. Agora um lote que falha deixa sem match só os itens dele. `max_tokens` passou de 6000 para 4000.
- [B] `_extrair_excel_bytes` foi reescrita: a planilha vira texto **fiel, linha a linha**, sem adivinhar cabeçalho (o pivot do Coupa com "Rótulos de Linha" fazia 41 itens virarem 1). Limites de 600 linhas por aba e 90 mil caracteres, com o corte declarado no texto. Fallback para `xlrd` (.xls).
- [B] Planilha que não abre gera um aviso `ingestao:planilha_nao_lida` em vez de silêncio.
- Regra (ingestao.py): "errar mandando é barato; errar descartando apaga a cotação".

## v3.67 · 17/09 · d8c1043 · Lotes de matching em paralelo; timeout de 240 s
- [B] Os lotes de matching rodam em paralelo com `ThreadPoolExecutor`, **no máximo 4** ao mesmo tempo, para não bater no rate limit. O tempo total passa a ser o do lote mais lento.
- [F] Timeout do `/extrair` na tela passou de 120 s para 240 s, com mensagem nova.

## v3.68 · 17/09 · 9f91a34 · Extração assíncrona (job + polling)
- [B] `POST /extrair` agora só lê os arquivos, grava o job e devolve `{job_id, status:"processando"}` em menos de 1 s. O trabalho pesado (`_extrair_nucleo`) roda numa thread com conexão própria ao Supabase.
- [B] Nova rota `GET /extrair-status/{job_id}`: devolve `processando`, `concluido` (com o resultado) ou 500 com o erro. Job inexistente dá 404.
- [F] `_extrairAssincrono`: consulta a cada 3 s, com teto de segurança de 15 min e mensagens de progresso ("Lendo o material…", "Cruzando com o banco de preços…").
- Motivo: a extração de 41 itens levava de 160 a 215 s, e qualquer teto fixo estouraria de novo.
- DB: tabela `extracoes_jobs` (job_id, usuario_email, numero_proposta, status, resultado jsonb, erro, concluido_em).
- ⚠ O decorador `@app.post("/extrair")` aparece **duplicado** a partir desta versão (e continua duplicado na v3.83). A rota fica registrada duas vezes. Deve ser inofensivo, mas é um resto de edição.

## v3.70 · 21/09 · bcd73d0 · (inclui v3.69) Curral para bot disparar pesquisa; contato no Tiny
- **v3.69** [B] `POST /propostas/exportar-tiny`: opção `criar_contato_se_ausente` (opt-in), que cadastra o cliente no Tiny com dados da BrasilAPI quando ele não existe (caso Igreja Universal, filial de Porto Alegre). O padrão continua sendo recusar. A resposta ganha `contato_criado`.
- **v3.69** [B] O matching passa a ler o JSON com `raw_decode`, que aceita texto depois do JSON válido (erro "Extra data" num caso de 25 itens em 17/09).
- **v3.70** [B] Novo escopo **`dwight_dispatch`**: `POST /propostas/{numero}/pesquisa-dwight` e `GET /api/whoami`. Quem dispara pela chave passa por um "curral" (Leonardo, 18/09: "proibir não é o caminho, o caminho é desenhar o curral"):
  - `_validar_cotacao_real`: CNPJ de 14 dígitos válido, cliente com 3 caracteres ou mais, e pelo menos um item com descrição real (não placeholder). Se não passar, **422**.
  - `_limite_disparo_api`: no máximo 5 disparos por hora e 150 itens por 24 h, por chave. Se passar do limite, **429**.
  - A tela **não passa** pelo curral ("o julgamento ali é do Leonardo").
- [B] `pesquisa_resultados.disparado_por` recebe `tela` ou `api`.
- [F] (commit 4dba4a7, 18/09) `planoCarregamentoDwight`, uma função pura. Corrige o bug do caso Convergint em 18/09: um item que já tinha o mesmo custo do Dwight não recebia a venda calculada.
- DB: coluna `pesquisa_resultados.disparado_por`.

## v3.72 · 21/09 · 99a8b5f · (inclui v3.71) Exportação ao Tiny refeita pelo contrato oficial da API v3 + prévia
- [B] Nova rota **`POST /propostas/exportar-tiny/previa`**: modela o orçamento exatamente como vai sair (cliente encontrado, a cadastrar ou bloqueado, itens, total, avisos e erros) **sem escrever nada no Tiny**. `POST /propostas/exportar-tiny` usa a **mesma** modelagem e responde 422 se houver erro.
- [B] `_modelar_orcamento_tiny`, uma função pura. SKU repetido com descrição diferente ganha sufixo `-2`, `-3`. Descrição com mais de 120 caracteres vai inteira no complemento da linha. Quantidade ≤ 0 bloqueia o envio. Preço 0 só gera aviso.
- [B] Mudança de regra em relação à v3.69: **o cliente ausente passa a ser cadastrado por padrão** com dados da Receita (desliga com `"criar_contato_se_ausente": false`). Cliente com consulta falhando ("indeterminado") ou EXCLUÍDO no Tiny **nunca** é cadastrado, para evitar duplicata no ERP.
- [B] `tiny.py`:
  - `resolver_contato`: só o filtro documentado `cpfCnpj`, em dígitos e com máscara. Devolve `encontrado`, `ausente`, `excluido`, `indeterminado` ou `invalido`. Prefere contato ativo e avisa quando é inativo ou duplicado.
  - `montar_corpo_contato`: `situacao "B"`, `tipos: [id]` via `GET /contatos/tipos`, sem `codigo`. Corrige a v3.69, que mandava `situacao "A"`, `tiposContato` e `codigo`=CNPJ.
  - `achar_produto` só com `codigo`.
  - `garantir_produtos`: resolve `produto.id` antes do POST, no cadastro usa `tipo "S"` e devolve a lista de produtos reaproveitados ou cadastrados.
  - `atualizar_orcamento` (`PUT /orcamentos/{id}`) **não existia**, embora o main.py a chamasse, e toda reexportação caía em erro.
  - `chamar()`: novas tentativas em 401 e em 429 (respeita `Retry-After`, até 30 s). O limite de 30 req/min por conta é dividido com os bots do Fábio.
- [B] Condição de pagamento: `tipo "Parcelas"` no lugar de `"P"` (o comentário diz que "a v3.71 mandava tipo P", o valor que o Tiny devolve na leitura, não o que aceita na escrita). ⚠ Não há commit v3.71 separado e `"P"` já estava no código da v3.58, então o que a v3.71 mudou além disso não dá para reconstruir.
- [B] O corpo do orçamento **deixou de enviar** `situacao: "Rascunho"` e `numeroProposta`. A resposta ganha `total`, `produtos` e `avisos`, e `tiny_numero` só é gravado quando vem.
- [F] Exportar agora chama primeiro a prévia, depois pede confirmação (`mensagemPreviaTiny`) e só então envia. A mensagem de sucesso mostra criado ou atualizado, cliente cadastrado, produtos novos e avisos.

## v3.73 · 21/09 · fb5d4f8 · Fila e cache da pesquisa (a unidade passa a ser o item)
- [B] Decisão do Leonardo (21/09): "5 disparos por hora" contava a coisa errada.
  - **Cache**: um item pesquisado com resultado encontrado vale até o **mesmo horário do próximo dia útil** (horário de Brasília; pesquisa de sexta às 10h vale até segunda às 10h). A chave do cache é a descrição do cliente mais as specs, normalizadas. Só resultado "concluído" com ofertas entra no cache. A cópia do cache não renova o prazo. `forcar` ignora o cache.
  - **Fila**: status `na_fila`, lotes de até **5 itens da mesma proposta**, **no máximo 2 lotes** em andamento. A fila anda (`_bombear_fila`, com lock e claim) depois de cada disparo, de cada retorno e de cada consulta da tela. Não há rotina agendada.
  - O teto por hora saiu. Fica só a trava diária de **300 itens em 24 h por chave**, contando só o que foi para a fila (item do cache não conta).
- [B] A resposta do disparo mudou para `{cache, na_fila, enviados_agora, enviados, itens_cache, itens_fila, repetidos}`. `GET .../pesquisa-resultado` passa a devolver `origem` e `na_fila`, e `aguardando` inclui a fila.
- [F] Status "Na fila do Dwight…", selo "do cache · pesquisado em dd/mm hh:mm" e `resumoDisparoDwight`.
- DB: `pesquisa_resultados.chave_cache`, status novo `na_fila`, `origem` pode ser `cache`.

## v3.75 · 21/09 · f54167b · (inclui v3.74) Regras de campo do Tiny numa fonte só; condição de pagamento normalizada
- **v3.74** [B] `_normalizar_condicao` (caso Thiago, proposta 1050910: "30", "30 dias" e "30d" eram recusados). Converte `30`, `30 dias`, `30d` e `30 ddl` para `30`; `30/60/90` e `30 e 60` para `30 60 90`; `3x` e `3 vezes` para `3x`; mantém `30+2x`; qualquer outra coisa vai como **texto livre**, que o Tiny sempre aceita.
- **v3.75** [B] `_CAMPOS_TINY` vira a fonte única de formato, exemplos e destino de cada campo. Dela saem a dica na tela, a validação da prévia, o guia dos bots e a tradução do erro do Tiny (`_traduzir_erro_tiny`).
- [B] Nova rota **`GET /api/guia/exportacao-tiny`**: texto puro, ou `?formato=json`. O guia entra nos escopos `pesquisa` e `dwight_dispatch` (`/api/guia/*`), e `/api/whoami` ganha `guias`.
- [B] Regra (Leonardo, 21/09): **campo em branco vai em branco**. A validade padrão de 7 dias e o frete 0 inventado acabaram. Validade: 1 a 365 dias, e "15 dias" vira 15. Desconto em `%` é convertido em reais sobre o subtotal dos itens.
- [B] Envio com **recuo**: se o Tiny recusar por causa da condição, a exportação tenta de novo com a condição em texto livre e, se ainda falhar, sem condição, e avisa o operador. Toda tentativa é gravada em log.
- [B] Um retorno do Dwight para um envio **cancelado** (`despacho_erro` começando com "cancelado") é descartado ("recomeço no modelo novo, 21/09"). ⚠ Nenhum código grava "cancelado" em `despacho_erro`. Pelo visto isso é feito à mão, por SQL.
- [F] `DicaTiny` embaixo dos campos, alimentada pelo guia JSON. Botão **"Reconectar o Tiny"** quando o OAuth caiu: busca `GET /tiny/autorizar` (rota que já existia) com o token e abre em outra aba. ⚠ O comentário marca esse trecho como "v3.73", mas ele entrou neste commit.
- DB: tabela `tiny_exportacoes_log` (numero_proposta, usuario_email, tentativa, ok, etapa, condicao_original, condicao_enviada, erro, tiny_id).

## v3.76 · 21/09 · 4d109ff · Banco de preços volta a aprender na exportação pelo número
- [B] `POST /upsert-precos`: aceita `preco_venda` (item vindo do banco), além de `preco_un`, e usa `descricao_original` quando falta `descricao_final`. Antes, exportar só pelo número marcava todo item como "sem preço" e o banco não aprendia nada, **sem avisar**.
- [B] Antes de inserir um produto, procura também pela descrição original do cliente. Evita produto duplicado sem custo e sem link quando a descrição comercial foi reescrita (caso da bolsa IW14080, 21/09).
- DB: `produtos` (sem mudança de schema).

## v3.77 · 21/09 · 5e41388 · Número de proposta único (R-&lt;id&gt;) e unificação com o número do Tiny
- [B] `_criar_rascunho`: a proposta nasce como rascunho com número **`R-<id>`**, onde o id vem do banco e nunca repete. Caso de 21/09: Thiago, Leonardo e o bot receberam todos o 1050912 ("maior + 1"), e o último a salvar apagou os outros.
- [B] `GET /proxima-proposta` agora **cria** um rascunho e devolve `{proximo: "R-…", rascunho: true}`. O cálculo antigo ficou só como fallback.
- [B] `POST /extrair`: `numero_proposta` deixou de ser obrigatório. Novo `criar_rascunhos` (padrão 1): **cada proposta gerada vira um rascunho na hora**.
- [B] `POST /salvar-proposta`: sem número, abre um rascunho. O upsert procura pelo número atual **ou** pelo `numero_rascunho` e não desfaz o nome dado pelo Tiny. A resposta ganha `numero`.
- [B] Exportar ao Tiny: a proposta **passa a se chamar pelo número que o Tiny devolveu**. O número R- fica guardado em `numero_rascunho` e continua funcionando como referência (`_achar_por_numero`, `_resolver_proposta`). Se o número do Tiny já estiver em outra proposta, a proposta mantém o R- e o operador recebe um aviso. A resposta ganha `numero_final` e `numero_anterior`.
- [F] Sai o campo "Número da proposta *". Todas as abas são salvas logo depois da extração (`salvarTodas`; caso 1050917, em que uma aba não aberta se perdia). "Adicionar itens" manda `criar_rascunhos=0`. Depois de exportar, a aba passa a mostrar o número do Tiny.
- DB: `propostas.numero_rascunho` (coluna nova).

## v3.79 · 21/09 · 1bc7b11 · (inclui v3.78) Segundo motor de pesquisa: KistBot Dwight
- **v3.78** [B] Motores configuráveis em `_motores()`: `dwight` e `kistbot` (env `KISTBOTS_DWIGHT_WEBHOOK_URL` e `KISTBOTS_DWIGHT_WEBHOOK_KEY`). Mesmas regras para os dois (fila, cache compartilhado, curral e retorno pela gaveta), mas **cada motor tem sua fila** e seu limite de lotes em andamento. A `external_key` inclui o motor e o payload ganha `motor`.
- [B] Novas rotas:
  - `POST /propostas/{ref}/pesquisa-kistbot-dwight`: disparo pelo KistBot, também liberado para o escopo `dwight_dispatch`.
  - `GET /pesquisa/motores`: quais motores estão configurados.
  - `POST /pesquisa/ping/{motor}`: testa a conexão com `{action:"ping", dry_run:true}`, sem criar pesquisa.
- [B] O cache passa a aceitar `origem` igual a `dwight` ou `kistbot`. A listagem devolve `motor`.
- **v3.79** [F] Botão "🔎 pesquisar com o KistBot Dwight", desativado com "(aguardando túnel)" quando o motor não está configurado. O card mostra o nome do motor.
- DB: coluna `pesquisa_resultados.motor`.

## v3.80 · 21/09 · 8b74b98 · Frete de ida (custo por proposta)
- [B] `POST /salvar-proposta` grava `frete_ida` **só quando o campo vem no payload**, para que um bot que não conhece o campo não zere o valor lançado.
- [B] `POST /ordens-compra`: a OC herda `frete_ida` do payload ou, se não vier, da proposta de origem dos itens (só quando todos os itens vêm de uma única proposta).
- [F] `calcularCustoLucro` (função pura): o custo total é produtos + **frete de vinda por item (sem multiplicar pela quantidade)** + **frete de ida por proposta**. A receita é a venda mais o frete cobrado, e a NF é 12% sobre a receita. `lucroUnitario` rateia o frete de vinda pela quantidade. Novo campo "Frete de ida" no painel de custo e lucro.
- Regra: os fretes de vinda e de ida são **custo interno e não vão ao Tiny**. O frete cobrado é receita e vai.
- DB: `propostas.frete_ida`, `ordens_compra.frete_ida`.

## v3.81 · 21/09 · 716bd2f · Guia de campos da proposta para bots
- [B] `_CAMPOS_PROPOSTA` e nova rota **`GET /api/guia/proposta`** (texto ou `?formato=json`): o que um bot pode gravar no `/salvar-proposta`, incluindo `frete_ida`, `itens[].frete_vinda`, `item_uid` e a fórmula de custo e lucro.
- [B] O guia de exportação ao Tiny passa a avisar que `frete_ida` e `frete_vinda` não vão ao Tiny. `/api/whoami` lista os dois guias.
- Motivo: sem o guia, os bots só usariam os campos de frete se adivinhassem o nome.

## v3.82 · 22/09 · f57fb4a · Conhecimento de pesquisa: ficha do item, mercado, extrato, veredito
- [B] Novo módulo `conhecimento.py` (puro, sem banco e sem rede; o import é protegido e, sem ele, a pesquisa funciona como antes). Cinco camadas: **extrato** (o processo de um lote), **julgamento** (por item desta cotação), **ficha** (identidade do item para a Kist inteira: PN, fabricante, specs, equivalências), **observações de mercado** (toda oferta vista, que **nunca** entra em `produtos`) e **veredito** automático.
- [B] Contrato de retorno ampliado em `POST .../pesquisa-resultado`, todo opcional: `julgamento`, `identidade`, `mercado` e `extrato`. Regras:
  - **equivalência sem fonte é descartada**;
  - toda equivalência vinda de bot entra como `sugerida`;
  - uma decisão do operador nunca é sobrescrita;
  - falhar ao catalogar nunca derruba o retorno.
- [B] O envio ao bot inclui, para item já conhecido, o bloco `conhecimento` (PN, specs, equivalências, últimas 5 ofertas e a instrução "confirme o preço; não refaça a identificação").
- [B] Veredito automático (`acertou`, `custo_divergente` com tolerância de 15%, `escolheu_outra`, `nao_achou`) calculado em dois momentos: na **exportação ao Tiny** e na **criação da OC** ("sinal mais forte, é dinheiro").
- [B] A prévia da exportação lista `pontos_a_validar` (riscos e "validar com cliente" do último julgamento) e os soma aos avisos.
- [B] Novas rotas:
  - `GET /catalogo/itens?q=`
  - `GET /catalogo/itens/{ref}` (`?formato=texto` para bots)
  - `POST /catalogo/equivalencias/{eid}` (**só pela tela**; chave de API recebe 403)
  - `POST /catalogo/contexto`
  - `GET /propostas/{ref}/extratos`
  - `GET /pesquisa/extratos/{eid}`
  - `GET /pesquisa/boletim?dias=30`
  - `GET /api/guia/pesquisa-retorno`

  As rotas `GET /catalogo/itens[/…]` entram nos escopos `pesquisa` e `dwight_dispatch`. `/api/whoami` ganha o guia `pesquisa_retorno` e `catalogo`.
- [F] Nova página **Catálogo** (`Catalogo.jsx`, item na barra lateral), selo "📚 já pesquisado · faixa" e alertas de equivalência na linha do item, botão "📋 extrato da pesquisa" (modal com os pontos a validar, os julgamentos e os extratos) e bloco de julgamento e "ver extrato" no card do Dwight.
- DB: tabelas novas `itens_ficha`, `itens_equivalencias`, `mercado_observacoes`, `pesquisa_extratos`, `pesquisa_vereditos`; colunas novas `pesquisa_resultados.julgamento` e `pesquisa_resultados.extrato_id`.
- ⚠ `GET /propostas/{ref}/pesquisa-resultado` continua selecionando só `item_uid,status,resultado,telemetria,external_key,criado_em,respondido_em,despacho_erro,origem,motor`, **sem `julgamento` nem `extrato_id`**. Pela leitura do código, o bloco "por quê / ⚠ riscos / ? validar / ver extrato" do card do item não chega a aparecer. O resumo de mercado aparece, porque vem dentro de `resultado`. O modal "extrato da pesquisa" da proposta funciona por outra rota. Isso não foi testado em execução.

## v3.83 · 23/09 · commit do Leonardo pelo GitHub Desktop · Venda automática e Pix suspeito
- [F] **"Preencher sozinho" também preenche a venda** (custo × mediana via `/markup-itens`), igual ao "carregar com venda". Se o markup falhar, custo e origem entram mesmo assim e a venda fica em branco. `precisaCarregarDwight`: "carregar com venda" também aparece para item que já tem custo e está com a venda em branco. A venda digitada pelo operador nunca é sobrescrita.
- [B] ⚠ **Substituído na v3.84.** **Pix suspeito** (regra do Leonardo, 23/09, caso R-1375: Duracell R$ 19,69 × R$ 198,90): um Pix **mais de 35% abaixo do cheio**, ou uma oferta cuja `obs` fala em OCR ou outlier, é tratado como erro de leitura. `_norm_oferta` anula `preco_pix`, guarda o valor em `preco_pix_descartado` e acrescenta uma nota em `obs`. O custo passa a ser o cheio.
- [F] `pixSuspeito` é o espelho da regra do backend (o comentário diz "mudou um, mude o outro"). `custoDaOferta`, `usarOfertaDwight` e `aplicarOfertaDwight` passam a usar o cheio quando o Pix é suspeito. O card mostra "Pix R$ X descartado".
- ⚠ Como o backend já anula `preco_pix` nos retornos novos, o rótulo "Pix descartado" do card (que exige `preco_pix != null`) só aparece para resultados gravados **antes** da v3.83. Nos retornos novos, o aviso fica só no texto de `obs`.
- DB: nenhum objeto novo (`preco_pix_descartado` fica dentro do jsonb `resultado`).

## v3.84 · 23/09 · Preço divergente pede confirmação; auto-save grava a última edição
- **Regra do Pix revista (Leonardo, 23/09).** O teste real mostrou que "usar o cheio" também erra: trena de bolso Ferramac com Pix R$ 19,27 e cheio R$ 716,90, chave ajustável com Pix R$ 74,79 e cheio R$ 3.097. A divergência diz que um dos dois preços está errado, mas não qual. Decisão: **sempre pedir confirmação.**
  - [B] `_norm_oferta` guarda os dois preços e marca `preco_divergente: true` quando o Pix está mais de 35% abaixo do cheio ou o `obs` fala em OCR/outlier. Não anula mais o Pix (`preco_pix_descartado` só existe nos retornos gravados pela v3.83).
  - [B] `conhecimento.py`: observação de mercado de oferta divergente é gravada sem preço. O veredito compara o custo final com o mais próximo dos dois preços.
  - [F] `precoDivergente`, `pixDaOferta` e `custoDaOferta` (devolve null quando a oferta é divergente): nada é carregado sozinho, nem custo nem venda. O card mostra "confirme: [Pix R$ X] [cheio R$ Y]". O botão escolhido marca o item como `_preco_confirmado` (vale só na sessão aberta).
  - [F] `custoAConfirmar`: se o item já tem como custo um dos dois preços de uma oferta divergente e ninguém confirmou, a venda automática não é calculada, e o card avisa em vermelho.
- **Auto-save gravava o estado anterior à última edição** (bug antigo, achado no teste da R-1375: digitado 331,37, gravado 331,30, e o "Salvar rascunho" não regravava). O timer do salvamento era criado antes de o React aplicar a mudança e depois limpava o "modificado". Correção: o save lê o estado mais recente por `ref` (`propostasRef`, `propostaIdxRef`) e só limpa o "modificado" se não houve edição durante o envio (`modSeqRef`); se houve, agenda outro. Save com erro HTTP continua como "modificado".
- **"Desfazer" do Dwight** passa a guardar também os itens que só ganharam venda. Antes voltava só os que tiveram custo reescrito.
- Dados: `mercado_observacoes` 146 e 272 (Pix de OCR de 19,40 e 19,69) ficaram sem preço (backup `_bkp_20260923_mercado_observacoes`). R-1375: o Duracell ficou com custo 198,90 e venda 331,37, confirmados pelo Leonardo (backup `_bkp_20260923_itens_r1375`).
- Propostas antigas com custo tirado de oferta divergente (vão aparecer com o aviso no card): 1050902 (terrômetro, 4.333,26), 1050903 (estilete, trena 19,27, torquês, chave ajustável 74,79), 1051007 e 1051012.

## v3.103 · 25/09 · Badge "Revisar" presa depois do Tiny + assunto retroativo
- **Achado pelo Leonardo**: exportou a R-1433 pro Tiny (virou 1051041) e a badge "✉ Revisar" continuou aparecendo. Causa: a badge e o filtro "Só pra revisar" checavam `status === "rascunho"` — mas exportar pro Tiny **não muda o `status`** da proposta (confirmado: 1051041 está com `tiny_numero` preenchido e `status` ainda "rascunho"). Quem sinaliza "já foi exportada" é `tiny_numero`, não `status`.
- **[F]** `Propostas.jsx`: badge e filtro agora checam `criado_via === 'email_auto' && !tiny_numero`.
- **Achado junto**: `assunto_email` não aparecia nas 4 propostas de hoje porque elas foram criadas ANTES desse campo existir no código (v3.100 saiu depois). Preenchido retroativamente pelo texto já guardado em `email_cotacoes_monitor` — daqui pra frente toda proposta nova do monitor já nasce com o campo certo.

## v3.102 · 25/09 · Motor Dwight "normal" desativado em toda a Cabine
- **Regra do Leonardo, 25/09**: desativar o motor Dwight "normal" na Cabine inteira — não só na automação, em qualquer lugar que alguém possa disparar pesquisa. Sem apagar nada: reversível por variável de ambiente, o dia que precisar voltar.
- **[B]** `DWIGHT_MOTOR_ATIVO` (env, default `0`/desativado): `_motores()` só devolve `url`/`key` de verdade pro motor `dwight` quando essa variável está ligada; desativado, ele fica com a MESMA cara de "não configurado" que a tela e o `/pesquisa-dwight` já sabiam tratar antes de o túnel do KistBot existir — nenhum estado novo, nenhuma rota nova.
- **[F]** Botão "🔎 Dwight" na barra de ferramentas ganhou a mesma trava visual que o botão do KistBot já tinha (cinza, com aviso) — antes ele não checava `motores.dwight` e ficava clicável mesmo sem motor configurado. Pesquisa de item individual (botão na linha do item) e o valor padrão da função `pesquisarComDwight` passaram a usar `"kistbot"` em vez de `"dwight"`.
- Pra ligar de volta um dia: `DWIGHT_MOTOR_ATIVO=1` no Render, sem deploy de código.

## v3.101 · 25/09 · Dwight não estava disparando de verdade + motor errado
- **Achado testando o disparo de ponta a ponta**: nenhuma das propostas automáticas tinha pesquisa rodando. Causa: a chave de API do monitor de e-mail (`KIST_EMAIL_MONITOR_DWIGHT_KEY`) foi gerada com prefixo `kist_` — o sistema só reconhece chave de API com `kist_sk_` (`API_KEY_PREFIXO`, `main.py`). Sem o prefixo certo, `_verificar_token_str` tentava decodificar a chave como token de login do Google e falhava com 401 — e `_acionar_dwight` só logava aviso, sem avisar ninguém. Corrigido: hash da chave atualizado no Supabase (`api_chaves`) e o valor certo no Render. Testado direto contra produção: `200 OK`, itens de verdade entrando na fila.
- **Regra do Leonardo, 25/09**: automação sempre aciona o motor **KistBot Dwight** (`/propostas/{numero}/pesquisa-kistbot-dwight`), nunca o Dwight "normal" (`/pesquisa-dwight`) — são dois motores distintos (`_motores()`, cada um com webhook e chave próprios). `email_monitor.py` disparava pro motor errado; corrigido.
- As 4 propostas de hoje (R-1433, R-1434, R-1437, R-1438) foram redisparadas manualmente pelo motor certo depois da correção, com `forcar: true` (o disparo errado anterior já tinha marcado os itens como "na fila").

## v3.100 · 25/09 · Assunto do e-mail na proposta + limpeza de escopo (só hoje pra valer)
- **Achado revisando a lista de propostas**: mesmo depois do piso de data (v3.99), sobrou lixo de ANTES do piso entrar no ar — 6 propostas do e-mail do Universal de 23/09 (a reprocessada corretamente, mas de um e-mail de antes de hoje) e 1 do Convergint de 22/09 (recriada sem querer quando o Claude apagou o registro de controle dela durante a investigação, e o poller antigo, ainda sem o piso, reprocessou antes do deploy da v3.99 terminar). Mais uma órfã "TMP-＜uuid＞" — `_criar_rascunho` cria a linha com nome provisório e depois renomeia pra "R-＜id＞"; a renomeação falhou uma vez (rajada de criações em sequência do Universal) e a linha ficou travada com o nome provisório, sem `criado_via`, sem dono, sem itens. Limpeza: 8 propostas removidas direto no banco, sobrando só as 4 de e-mail de hoje de verdade (conferido contra o Outlook do Leonardo).
- **[B]** `_criar_rascunho`: se a renomeação falhar, apaga a linha recém-criada antes de propagar o erro — não deixa mais "TMP-..." órfão pra trás.
- **Regra do Leonardo, 25/09**: precisa ver de qual e-mail cada cotação automática veio, sem abrir a proposta. Coluna nova `propostas.assunto_email` (opcional — só quem informa preenche; tela normal não usa), preenchida pelo monitor de e-mail com o assunto original. Aparece na lista de Propostas, embaixo do cliente.
- DB: `propostas.assunto_email` (nova, opcional).

## v3.99 · 25/09 · Monitor de e-mail: restart duplicava proposta + piso de data
- **Achado no primeiro dia em produção**: pouco depois do deploy da v3.98, um restart do Render (o próprio deploy) pegou o monitor NO MEIO de um e-mail do Universal com várias propostas (uma por destino de entrega — comum nesse cliente). O processo antigo morreu depois de criar alguns rascunhos mas antes de gravar "e-mail já visto"; o processo novo, sem saber disso, reprocessou o MESMO e-mail do zero. Resultado real: 1 e-mail virou 12 propostas (6 vazias/órfãs do processo interrompido + 6 completas do reprocessamento), e uma delas nasceu com o número inválido "-2" (fallback de número quando `_criar_rascunho` falha, com `numero_proposta` vazio). Limpeza feita na hora: 11 propostas vazias/duplicadas apagadas, a "-2" renomeada pra R-1432 (os 24 itens dela estavam corretos, só o nome que quebrou).
- **[B]** `email_monitor.py`: `_marcar_em_processamento` grava a linha de controle (upsert por `message_id`, `motivo='em_processamento'`) ANTES de chamar `_extrair_nucleo`, não depois. Um restart a partir daqui não reprocessa mais — pior caso vira "ficou em_processamento" (raro, só em restart), nunca mais proposta duplicada. `_finalizar_registro` atualiza a mesma linha no final (sucesso ou erro).
- **Regra do Leonardo, 25/09**: o monitor nunca busca e-mail de antes de HOJE — `DATA_MINIMA` (env `KIST_EMAIL_MONITOR_DATA_MINIMA`, default `2026-09-25`, o dia em que foi ligado em produção pra valer) trava o piso da busca, mesmo com a janela rolante de `JANELA_DIAS` (redundância contra o monitor ficar fora do ar). Evita reabrir cotação antiga que ele já tratou na mão antes de o monitor existir.

## v3.98 · 25/09 · Correção do monitor (itens não persistiam) + tela de revisão no Cabine
- **Achado em produção, no primeiro e-mail real processado** (25/09, R-1414, ControllerBMS/EXACQVISION): a proposta nasceu com `criado_via='email_auto'` certinho, mas **zero itens** em `itens_proposta` e o Dwight não achou nada pra pesquisar (`pesquisa_resultados` vazio). Causa: `_extrair_nucleo` (usado pelo `/extrair`) só grava o CABEÇALHO da proposta via `_criar_rascunho` — os itens do matching ficam só na resposta, em memória; é o `/salvar-proposta`, chamado pela TELA depois que o operador vê o resultado, que persiste `itens_proposta` de verdade. O monitor de e-mail nunca chamava esse segundo passo.
- **[B]** Extraído `_salvar_proposta_nucleo(sb, usuario, payload)` — o corpo de `/salvar-proposta`, sem nada de FastAPI/HTTP — pra poder ser chamado direto. A rota `/salvar-proposta` virou um wrapper de uma linha. Comportamento idêntico, mesma função, dois chamadores.
- **[B]** `email_monitor.py`: depois do `_extrair_nucleo`, cada proposta criada agora passa pelo `_salvar_proposta_nucleo` (itens do match, status "rascunho") antes de marcar `criado_via` e acionar o Dwight.
- A proposta R-1414 (o teste real que revelou o bug) ficou vazia em produção — o Leonardo pode excluir ela na tela, sem risco.
- **[F]** Tela "Propostas": selo "✉ Revisar" na linha de qualquer proposta com `criado_via='email_auto'` (ao lado do "Rascunho"), e filtro "Só pra revisar" no cabeçalho com contador — pra achar rápido de manhã o que o monitor criou sozinho.

## v3.97 · 25/09 · Monitor automático de e-mail de cotação (backend/email_monitor.py)
- **Regra do Leonardo, 25/09**: e-mail de cotação de cliente conhecido deve virar proposta sozinho — matching, Dwight, mediana — e ficar em "revisão". O Leonardo abre de manhã, revisa, exporta pro Tiny e manda ao cliente ELE MESMO. Nada disto exporta pro Tiny nem manda e-mail — só o que vem ANTES da revisão é automático.
- **Por que IMAP, não Microsoft Graph**: o e-mail da Kist é hospedado na KingHost (`imap.kinghost.net`), sem Microsoft 365 — Graph API não existe pra essa conta. IMAP com usuário/senha resolve igual, rodando 24h no próprio backend (sem depender do PC/Outlook do Leonardo ligado).
- **[B]** Tabela nova `email_cotacoes_monitor` (Supabase): log de todo e-mail visto nos domínios de `clientes_dominios`, se bateu no filtro, se virou proposta. `message_id` (único) evita processar o mesmo e-mail duas vezes; `(dominio, assunto_normalizado)` identifica thread já vista.
- **[B]** Filtro de assunto validado com dado real: extraí de `propostas.fonte_texto` (que já guarda "Assunto: ..." de toda cotação por e-mail) os 146 assuntos de propostas confirmadas do Leonardo e testei o regex contra eles — **96,6% de acerto (141/146)**. Os 5 que não batem são assunto de item/anexo sem palavra de pedido ("MATERIAL PARA MARINGÁ", "ITENS 1.pdf" etc.) — ficam de fora do automático, tratados manual como sempre.
- **Dois bugs achados testando contra e-mail real** (dry-run local, sem gravar nada nem acionar Dwight, antes de ligar em produção):
  - `licita[çc][aã]o` sem borda de palavra batia como SUBSTRING dentro de "**so**LICITAÇÃO" — ou seja, quase todo assunto real (que começa com "Solicitação de...") passava pelo ramo de licitação sem querer. Corrigido com `\b` em toda alternativa do regex.
  - `pedido de compra` (sem "solicitação"/"cotação" na frente) batia em CONFIRMAÇÃO de PO já emitida ("RE: CONFIRMAÇÃO PEDIDO DE COMPRA || OC 115452"), não em cotação nova — e testado contra os 146 assuntos confirmados, essa palavra nunca é o único motivo de um acerto. Removida.
  - "Resposta automática: Cotação SC ..." (auto-reply/fora do escritório) não era reconhecida como resposta porque o prefixo "RE:"/"ENC:" não cobria esse caso — acrescentado ao normalizador de assunto.
- **[B]** Reply/continuação de thread já vista é ignorada de propósito (regra explícita do Leonardo, não só heurística de conveniência): `(dominio, assunto_normalizado)` já registrado com `bateu_filtro=true` → e-mail novo da mesma thread não cria proposta nem aciona Dwight de novo.
- **[B]** Reaproveita `_extrair_nucleo` (o mesmo núcleo do `/extrair` da tela, chamado direto, sem HTTP) pra criar o rascunho com matching; marca `propostas.criado_via='email_auto'`; aciona `/propostas/{numero}/pesquisa-dwight` (`somente_sem_match: true`) com uma chave de escopo `dwight_dispatch` nova — a MESMA trava de "cotação real" e teto de disparo que vale pra qualquer agente que não seja o Leonardo na tela (v3.70), sem nenhum código novo de segurança.
- **Pendente do Leonardo** (o Claude não tem permissão de escrever em `api_chaves` — bloqueado pelo modo automático): rodar o INSERT da chave `dwight_dispatch` (SQL fornecido) e cadastrar `KIST_IMAP_HOST`, `KIST_IMAP_USER`, `KIST_IMAP_PASSWORD`, `KIST_EMAIL_MONITOR_DWIGHT_KEY` no Render. Sem essas variáveis o monitor fica desligado (loga e sai, não derruba o backend).
- **Próximo passo, ainda não feito**: tela "para revisar" no Cabine (filtrar propostas por `criado_via='email_auto'`) — hoje dá pra achar pela lista normal de propostas, mas sem destaque próprio.
- DB: `email_cotacoes_monitor` (nova). `propostas.criado_via` (coluna já existia, sem uso; primeira vez preenchida).

## v3.96 · 24/09 · Marcador de versão da v3.95 era discreto demais + levado ao CRM
- **Achado pelo Leonardo, pelo celular**: acessou o Cabine depois do deploy da v3.95 e não notou o badge de versão. Causa: `fixed bottom-1.5 right-2`, texto 10px cinza-claro (`text-faint`), perto do balão de suporte (`fixed bottom-5 right-5`) — em mobile, `position: fixed` rente à borda também corre risco de ficar sob a barra do navegador.
- [F] `frontend/src/Versao.jsx`: `VersaoBadge` (chip com borda/fundo, ainda `fixed`) ficou só para a tela de login, que não tem sidebar. Novo `VersaoInline`, texto no FLUXO normal da página (sem `position: fixed`) — usado no rodapé da `Sidebar` (`kist-ui.jsx`), logo abaixo do nome do usuário. Garantia de visibilidade sem depender de z-index ou viewport de mobile.
- [F] Mesmo esquema (hash do commit + `version.json` + checagem a cada 5 min/troca de aba + atualização forçada) replicado no `crm-dashboard`, que é um app Vite separado (`crm-dashboard/vite.config.js`, `crm-dashboard/src/versao.js`): versão no rodapé do card de login e no cabeçalho (`topo-usuario`), ao lado do nome do operador. Os dois serviços deployam do mesmo commit do monorepo, então mostram sempre o mesmo hash.
- Testado com `vite preview` nos dois apps + token forjado no `localStorage` pra ver a tela logada sem backend: badge aparece nítido nas duas telas dos dois apps.

## v3.95 · 24/09 · Frontend: marcador de versão + auto-update forçado
- **Pedido do Leonardo, 24/09**: o operador precisa sempre saber se está na versão publicada mais recente da Cabine; se não estiver, atualizar sozinho, derrubando os cookies.
- [F] `vite.config.js`: identifica o build pelo hash curto do commit (`git rev-parse --short HEAD`, cai para `"dev"` se não achar git) e injeta em `__APP_VERSION__`; um plugin (`writeBundle`) grava `dist/version.json` (`{version, build}`) depois de cada build, servido como arquivo estático junto com o `index.html`.
- [F] Novo `src/versao.js` (hook `useVersaoCheck`) e `src/Versao.jsx` (`<VersaoBadge/>`): mostra `v<hash>` fixo no canto inferior direito, em qualquer tela (login e app principal, adicionado nos dois `return` do `App.jsx`). A cada 5 min e sempre que a aba volta a ficar visível, busca `/version.json` (`cache: "no-store"`, cache-bust por query string) e compara com a versão rodando. Diferente → limpa os cookies do domínio (login continua de pé, mora em `localStorage` desde a v3.85, não em cookie) e recarrega com `location.replace` e um parâmetro de cache-bust na URL.
- Testado localmente com `vite preview`: badge mostra o hash do build; sobrescrever `dist/version.json` com um valor diferente e recarregar a aba dispara a atualização forçada (URL ganha `?_v=<timestamp>`); restaurado o valor original, o comportamento volta ao normal sem loop.
- Não bumpou `VERSAO_BACKEND` por causa de código de rota nenhum; sobe junto só pra manter o deploy conferível pelo `/openapi.json` (mesmo padrão da v3.89).

## v3.94 · 24/09 · /casar-po: reconhece PO com underscore e "Pedido de Compra" sem o prefixo "PO"
- **Achado pelo Leonardo**: assunto de e-mail como `PO_215086 KIST SOLUCOES...` e texto de PDF como `Pedido de Compra Nº 215086` não batiam com o regex antigo (`PO[-\s]?\d{5,}`, só aceitava hífen ou espaço logo depois de "PO"). `po_numero` voltava vazio e a OC nascia com "PO pendente" mesmo com o número claramente no texto.
- [B] Novo helper `_extrair_num_po(texto)`, regex ampliado: `PO[-_\s]?` **ou** `Pedido de Compra [Nº ]?`, os dois seguidos de `\d{5,}`. Usado nos dois pontos do `/casar-po` que extraem o número (texto/e-mail e resposta bruta do Sonnet). Formatos antigos (`PO-12345`, `PO 12345`, `PO12345`) continuam batendo. `po_numero` continua voltando só os dígitos, sem prefixo.

## (sem bump de versão) · 25/09 · CRM: leads importados do export oficial do LinkedIn
- **Contexto**: base de e-mail estava "capada" — Fábio e Thiago tinham muito mais leads reais do que o rastreado só pelo Outlook. LinkedIn não tem API pra ler inbox/Sales Navigator de terceiros (e automatizar login pra raspar viola os Termos de Uso e arrisca a conta) — o caminho oficial e seguro é o próprio LinkedIn exportar os dados (Configurações e Privacidade → "Obter uma cópia dos seus dados", incluindo Mensagens).
- `scripts/carregar_leads_linkedin.py`: lê o `messages.csv` do export, filtra só conversas que o OPERADOR começou (não quem foi abordado por outros) E cuja resposta trouxe e-mail ou telefone de contato no texto. Cruza com `leads_prospeccao_dominios` pra nunca duplicar domínio — domínio novo cria linha, domínio existente só ganha contato + interação novos (`canal=linkedin`, `origem=importacao_linkedin`).
- DB: `leads_prospeccao_interacoes.origem` ganhou o valor `importacao_linkedin` na constraint de check.
- Dados (25/09, export do Leonardo): 23 conversas qualificaram (ele começou + resposta com contato), 19 domínios distintos, 6 domínios novos (`unimedchapeco.coop.br`, `unisc.br`, `azimutyachts.com.br`, `unicamp.br`, `acscientifica.com.br`, `portobello.com.br`), 13 já existiam e só ganharam o contato do LinkedIn a mais. 3 pessoas retornaram só com telefone (sem e-mail) — ficaram de fora porque o schema atual exige um domínio; reportado ao Leonardo pra decidir o que fazer com esses.

## v3.93 · 24/09 · CRM: correção — ver é de todo mundo, editar é do dono
- **Correção da regra da v3.92** (Leonardo, mesmo dia): a trava de dono foi longe demais — bloqueava até a LEITURA. A regra certa: **ver os leads é de todo mundo** (Leonardo, Thiago e Fábio enxergam a base inteira); só **mudar estágio ou registrar contato** continua travado no dono (ou admin).
- [B] `GET /crm/leads`, `GET /crm/leads/{dominio}`, `GET /crm/painel`, `GET /crm/leads/stream`: removida a trava de leitura. Parâmetro `todos` (antes só-admin) virou `dono=<email>` — filtra por um operador específico; sem o parâmetro, vem tudo, pra qualquer chave autenticada.
- [B] `_crm_exige_dono()` renomeada para `_crm_exige_dono_para_editar()`, usada só em `POST .../contato` e `POST .../estagio`.
- [F] Dashboard: o toggle "ver de todos" (só admin) virou um seletor "Ver: todo mundo / Leonardo / Thiago / Fábio", disponível pra qualquer um. Painel de detalhe mostra aviso de "somente leitura" e desabilita os formulários de estágio/contato quando o lead não é do usuário logado (nem admin).

## v3.92 · 24/09 · CRM: dono por lead (trava de acesso do bot) + qualificação automática por IA
- **Achado depurando a base com o Leonardo**: `public.clientes_dominios` (a fonte de "isso já é cliente") estava desatualizada há meses e só sincronizada pro Leonardo — Equatorial Energia (27+ propostas confirmadas pelo Fábio) e outros 7 domínios apareciam como "frio". Corrigido rodando `dominios_observados` pelos 3 operadores; a Americanas continua fora da base de e-mail porque o domínio real das propostas dela é `americanas.io` e o do Equatorial é o portal `coupa.com` — nenhum dos dois nunca apareceu num e-mail de prospecção rastreado (não é bug, é limite do método de extração por Outlook).
- **Regra do Leonardo, 24/09**: cada bot roda como o operador dono da chave de API e só pode enxergar/mexer nos PRÓPRIOS leads — bot do Thiago não vê lead do Fábio.
  - DB: `leads_prospeccao_dominios.dono_email`. Preenchido por quem prospectou PRIMEIRO (extração passa a marcar a caixa de origem — `tbackup@` e `thiago@` = Thiago; `fabio@` e `contato@` = Fábio; `leonardo@` e a caixa local = Leonardo) ou, para cliente convertido, por quem gerou a proposta (`clientes_dominios.usuario_email`, que também passou a ser gravado por operador real em vez de um valor genérico).
  - [B] `_crm_exige_dono()`: toda rota de leitura/escrita de um lead específico (`GET /crm/leads/{dominio}`, `POST .../contato`, `POST .../estagio`) devolve 403 se `dono_email` for de outro operador. Lead sem dono (ainda não atribuído) só é visível para `ADMIN_EMAILS`.
  - [B] `GET /crm/leads`, `GET /crm/painel` e `GET /crm/leads/stream` filtram por `dono_email = usuário da chave`; `todos=1` só funciona pra quem está em `ADMIN_EMAILS`.
  - [F] Toggle "ver de todos" no dashboard (só aparece pra admin) e selo do dono em cada card/detalhe.
- **Qualificação automática** (regra do Leonardo: "qualificado" é interesse REAL — reunião marcada, pergunta específica — não "cadastramos você" ou "encaminhei pro setor"): `POST /crm/leads/{dominio}/contato` com `direcao=recebido` avança `frio/aquecendo → respondeu` sozinho e, se vier texto, classifica com Haiku (`SYSTEM_CRM_QUALIFICA`) — se for interesse real, avança direto pra `qualificado`. Nunca mexe em estágios que já são decisão explícita (`proposta_enviada`, `convertido`, `descartado`).
- **[F]** Dashboard: histórico de interação ganha "ver e-mail completo" (expande o texto truncado e mostra remetente/telefone/assunto/pasta de origem).
- Dados (24/09): base foi de 534 para 556 domínios (22 clientes convertidos que nunca passaram por e-mail de prospecção entraram direto); 30 domínios com dono corrigido em `clientes_dominios`.

## v3.91 · 24/09 · CRM de leads frios (base + API para os bots)
- **Contexto** (Leonardo, 24/09): anos de prospecção por LinkedIn/LinkedHelper/e-mail geraram centenas de contatos que responderam mas nunca viraram cotação. Objetivo: catalogar esses leads "frios" e abrir caminho para os bots reativarem contato.
- **Extração** (fora do deploy, roda local): `scripts/extrair_leads_email.py` varre, via Outlook local (COM/`pywin32`), as pastas de Itens Enviados de todas as contas do perfil (incluindo as aninhadas dentro da Caixa de Entrada, típico de conta IMAP) atrás dos assuntos de prospecção usados pela equipe (Leonardo, Thiago, Fábio — 5 variantes de assunto), e cruza com as Caixas de Entrada de todas as contas para achar qualquer interação (resposta direta ou outro contato do mesmo domínio). `scripts/carregar_leads_supabase.py` faz a carga (upsert) no Supabase, cruzando com `clientes_dominios` para excluir quem já é cliente.
- **[B]** Novas rotas, escopo de API igual a qualquer outra rota do sistema (leitura lê, escrita também grava — nenhum mecanismo novo):
  - `GET /crm/leads`: fila de leads, filtra por `estagio`, `status`, `teve_resposta`, `busca` (domínio).
  - `GET /crm/leads/{dominio}`: lead + contatos prospectados + histórico de interações.
  - `POST /crm/leads/{dominio}/contato`: bot (ou humano) registra uma nova tentativa de contato ou resposta recebida.
  - `POST /crm/leads/{dominio}/estagio`: avança/muda o estágio do funil (`frio → aquecendo → respondeu → qualificado → proposta_enviada → convertido/descartado`); `convertido`/`descartado` também refletem em `status`.
  - `GET /crm/painel`: contagens agregadas por estágio.
  - `GET /crm/leads/stream`: SSE — o backend sonda o banco a cada poucos segundos e empurra só o que mudou; escolhido no lugar do Supabase Realtime direto no navegador para não expor chave nenhuma do Supabase nem exigir um provedor de login novo (o dashboard usa o mesmo login Google já restrito a `USUARIOS_PERMITIDOS`).
- DB: tabelas novas `leads_prospeccao_dominios`, `leads_prospeccao_contatos`, `leads_prospeccao_interacoes` (RLS ligado, sem policy — só a service role, usada pelo backend, lê/grava). Colunas de funil em `leads_prospeccao_dominios`: `estagio_funil`, `proximo_followup_em`, `responsavel_bot`, `observacao`, `ultimo_contato_em`. Colunas de canal em `leads_prospeccao_interacoes`: `canal`, `direcao`, `origem`.
- Dados (24/09): 534 domínios prospectados nos últimos 36 meses, 645 contatos, 6.299 interações; 220 domínios já tiveram alguma resposta; 3 já eram clientes (excluídos da fila de leads frios, permanecem com `status=convertido`).
- ⚠ Dashboard (frontend separado, tempo real via SSE) ainda não construído — próxima etapa.

## v3.90 · 23/09 · Uma proposta por arquivo para a Construcap; matching tenta de novo
- **Lei por cliente** (Leonardo, 23/09): para o CNPJ de ORIGEM 63.945.143/0001-96 (Consórcio Construcap Copasa OHLA, BR-040), cada ARQUIVO anexo vira UMA proposta própria, mesmo com o mesmo destino. Arquivo com dois destinos dentro continua quebrando por destino. Para todos os outros clientes continua a regra geral de DESTINO (caso Universal: 6 PDFs = uma aba).
  - [B] `CNPJS_UMA_PROPOSTA_POR_ARQUIVO` (constante — cliente novo entra ali) e `_cnpjs_no_texto`. Na extração, se o texto do e-mail traz um desses CNPJs e há mais de um arquivo anexo, entra no começo do pedido uma instrução "REGRA DESTE CLIENTE" com a lista de arquivos e o pedido de usar a identificação do documento como título. Nota nova ao operador: `uma_por_arquivo`.
  - [F] Rótulo da nota.
- **Matching com nova tentativa** (pendência do teste da v3.87): um lote de 1 item devolveu 348 linhas de JSON indentado, bateu o teto de 4000 tokens, o JSON veio cortado e o item ficou sem match. Agora: prompt pede JSON compacto (motivo curto, até 5 diferenças), teto de 8000 tokens, timeout de 60 s, e resposta cortada ou JSON quebrado ganha UMA nova tentativa — lote de vários itens dividido ao meio, item sozinho repete. Só depois disso vira aviso.
- Dados: rascunhos vazios do Thiago apagados a pedido do Leonardo — R-1390, R-1391, R-1392 (sem itens) e R-1394 (só o item "Itens não extraídos…"). Backup `_bkp_20260923_propostas_vazias_thiago` e `_bkp_20260923_itens_vazias_thiago`. R-1393 (Fábio, Convergint, 8 itens) mantido.

## v3.89 · 23/09 · Login renova sozinho também depois de recarregar a página
- [F] O token do Google vale 1 h. A renovação silenciosa (5 min antes de vencer) só era agendada no login por CLIQUE. Quem voltava com o token guardado — refresh, aba nova; mais comum desde a v3.85 — passava da 1 h com a tela parecendo logada e toda chamada dando **401**. Agora um efeito em `[token]` agenda a renovação a partir de qualquer token ativo. Achado no teste da v3.87 (token restaurado às 13:06, vencido às 14:06, extração recusada com 401).
- [B] Só `VERSAO_BACKEND` = 3.89.

## v3.88 · 23/09 · Acerto de cache da pesquisa grava o motor do botão
- **Caso** (23/09): R-1393, alicate decapador 7" (item `26d16dbf…`), já pesquisado pelo KistBot Dwight na R-1384 às 15:27 UTC. O botão do KistBot Dwight dava HTTP 500 e nada era gravado. O mesmo aconteceu na R-1389 e, em 22/09, no redisparo parcial da R-1364 (anel hid0019).
- **Causa**: em `_disparar_pesquisa`, a linha copiada do cache (`origem='cache'`) não tinha a chave `motor`, e a linha da fila tinha. O insert em lote do PostgREST junta as chaves de todas as linhas, então a linha do cache ia com `motor` NULL explícito e o Postgres recusava o lote inteiro (23502, a coluna é NOT NULL). Num lote só de cache, a coluna caía no default `'dwight'`: não dava erro, mas o motor ficava errado quando o botão era o do KistBot.
- [B] A linha do cache grava o motor do botão que disparou: `kistbot` em `/pesquisa-kistbot-dwight`, `dwight` em `/pesquisa-dwight`. Vale para o acerto de cache e para o redisparo parcial (mesmo caminho). O webhook continua chamado só para os itens fora do cache (`para_fila`). O contrato da gaveta (`/pesquisa-resultado`) não mudou.
- Teste no banco real, numa transação desfeita: a linha antiga (motor NULL) volta 23502; o lote cache (`kistbot`) + fila da R-1393 grava.

## v3.87 · 23/09 · PDF digitalizado é lido pela imagem
- **Caso** (Thiago, 23/09): e-mail da Construcap (Consórcio BR-040) com 4 PDFs — RIM 1212, RIM 1214, 0617_001 e Requisição 1084. Todos DIGITALIZADOS: 0 caracteres na camada de texto. O leitor de PDF (`_pdf_po_texto`, pdfplumber) só extrai texto, então cada anexo virava "(anexo não convertido — o operador precisa abrir à mão)" e a IA devolvia um item-placeholder ("Itens não extraídos…", R-1394). Mandando o PDF sozinho, o conteúdo ia vazio e a extração quebrava com `JSONDecodeError` (R-1390 a R-1392).
- [B] `ingestao.py`: um só construtor de bloco de anexo (`_bloco_anexo`) para `.eml`, `.msg` e arquivo solto (antes o mesmo código em 3 lugares). PDF com menos de `PDF_VISUAL_MIN_CHARS` (30) caracteres úteis — ou que o conversor não leu, ou maior que `_PDF_MAX_BYTES` — fica marcado `pdf_visual` e guarda os bytes.
- [B] `montar_payload`: PDF `pdf_visual` vai INTEIRO para a IA como bloco `document` (a API lê a imagem de cada página), com rótulo pedindo código/quantidade/unidade exatamente como escritos e sem adivinhar o ilegível. Tetos: 8 PDFs por extração, 10 MB cada, 24 MB no total (a API aceita 32 MB por pedido). O relatório ganha `pdfs_visuais`, `pdfs_visuais_nomes` e `pdfs_visuais_cortados`.
- [B] `main.py`: PDF visual conta como imagem na escolha do modelo (Sonnet); o hash do cache inclui o `document`; a rede de segurança da v3.62 também cobre PDF recusado pela API (refaz só com o texto e avisa). Notas novas ao operador: `pdf_visual` ("lido pela imagem — confira códigos e quantidades") e `pdf_visual_cortado`.
- [F] Rótulos das duas notas novas.
- Sem mudança de regra de negócio: a quebra em propostas continua pela regra de DESTINO.
- **Teste real** (produção, 23/09, o `.msg` do Thiago): 4 propostas e 55 itens — RIM 1212 (3), RIM 1121/0617_001 (2), RIM 1214 (37), RIM 1084 (13). A IA seguiu o pedido do cliente de "uma proposta para cada documento". Conferido contra o PDF: RIM 1212 3/3; RIM 1214 36/37 — o item 7 (arruela Ø1.1/4") saiu 38, o PDF diz **36** (erro de leitura da imagem; é o caso que a nota `pdf_visual` manda conferir). Tempo: 2 min 10 s.

## v3.86 · 23/09 · Reorganização visual: proposta, itens e lista
Decisão de layout delegada pelo Leonardo (23/09: "decida como um designer profissional"). Nenhuma regra de negócio mudou; só lugar, agrupamento e rótulo.
- [F] **Largura**: a tela da proposta e a lista de Propostas passam de `max-w-5xl` (1024px) para `max-w-6xl` (1152px). O espaço já existia e ficava vazio dos lados.
- [F] **Topo da proposta**: fica só com as ações da proposta, numa linha: Recomeçar (link discreto), "✓ Salvo hh:mm", Salvar rascunho, Exportar para o Tiny e **Confirmar e baixar CSV** (principal, na ponta). Antes eram 8 botões que quebravam em 2 ou 3 linhas. `btnPrimary` e `btnGhost` passam a ter `whitespace-nowrap`; o `PageHeader` deixa as ações quebrarem para a direita sem espremer o título.
- [F] **Barra de ferramentas** (card abaixo da triagem) com dois grupos com rótulo: **Pesquisa de preço** (🔎 Dwight, 🔎 KistBot Dwight, 📋 extrato, carregar…, preencher sozinho, desfazer) e **Documentos** (gerar e baixar datasheets e apresentações, que saíram do topo). "Itens aguardando" e as mensagens da pesquisa ficam numa linha própria embaixo. Botão novo `btnTool`/`btnToolKist` em `kist-ui.jsx`.
- [F] **Cabeçalho do item** em três linhas: 1) descrição + atalhos de busca; 2) ESTADO (selo, código do cliente, herdado, já pesquisado, motor de preços, termo de busca à direita); 3) AÇÕES (descrição complementar, origem, datasheet, apresentação, excluir na ponta). Antes era tudo numa linha que quebrava sem ordem, e o termo de busca sumia espremido.
- [F] **Lista de Propostas**: "Rascunho" embaixo do número; cliente ocupa a sobra e é cortado com "…" (nome inteiro no hover); valor, data e itens não quebram; data em dd/mm/aaaa; ações viram **Abrir** · lixeira · seta que gira ao abrir os itens (antes "Abrir e editar", "excluir", "ver itens" quebrando em duas linhas).
- Teste: o build novo foi carregado dentro da aba logada do Leonardo, contra os dados reais (lista de Propostas e R-1375), antes do push; sem erro no console.
- [B] Só `VERSAO_BACKEND` = 3.86.

## v3.85 · 23/09 · Gaveta do item não vaza mais; login vale em todas as abas
- [F] **Gaveta "motor de preços" quebrava o card** (problema antigo, desde que o card do Dwight entrou na coluna da internet, v3.61). A caixa "Referência de mercado na internet" / "Buscando preço…" tinha `h-full` (100% da coluna) e ficava EMBAIXO do card do Dwight: sobrava a altura do card, que vazava por cima do item seguinte. Além disso, o "procurar outro no banco" é forçado na coluna 1 e abria uma 2ª linha na grade; a coluna da internet caía nessa linha, desalinhada do card do banco. Correção: coluna da internet em `flex flex-col gap-2` com a caixa em `flex-1`, presa em `md:col-start-2 md:row-start-1 md:row-span-2`; grade em `md:items-start`. Visto e testado na R-1375, item 03.
- [F] **Login em `localStorage`** (pedido do Leonardo, 23/09). Antes ficava no `sessionStorage` e cada aba nova pedia login. Token vencido continua sendo descartado ao abrir; e-mail fora da equipe também.
- [B] Só `VERSAO_BACKEND` = 3.85, para o deploy ser conferível.

---

## ROTAS NOVAS OU ALTERADAS v3.59–v3.90

| Método e rota | Para que serve | Versão |
|---|---|---|
| POST /propostas/exportar-tiny | aceita `outros_itens` (extras.descricao) | v3.59 |
| POST /salvar-proposta | grava `outros_itens` | v3.59 |
| GET /propostas/{ref}/detalhe | aceita id interno ou número; 409 se o número se repetir | v3.60 |
| GET /propostas/{ref}/itens | aceita id ou número; 404 em vez de `[]` | v3.60 |
| POST /salvar-proposta | persiste `item_uid` | v3.61 |
| POST /propostas/{ref}/pesquisa-dwight | dispara a pesquisa de preço no webhook do Dwight | v3.61 |
| POST /propostas/{ref}/pesquisa-resultado | retorno do agente por `item_uid` (não mexe nos itens) | v3.61 |
| GET /propostas/{ref}/pesquisa-resultado | último resultado por item; "expirado" depois de 3 h | v3.61 |
| GET /api/whoami | lista os escopos `pesquisa` e `dwight_dispatch`, `guias` e `catalogo` | v3.61 / v3.70 / v3.75 / v3.81 / v3.82 |
| POST /extrair | sanear e recuar quando a imagem é recusada | v3.62 |
| POST /propostas/{ref}/pesquisa-dwight | todos os itens por padrão; `somente_sem_match`; `repetidos` em vez de 409 | v3.63 |
| GET /propostas/{ref}/fonte | texto da extração em texto puro, sob demanda | v3.63 |
| POST /markup-itens | markup mediano por item (RPC `markup_por_item`) | v3.64 |
| POST /analista/chat | `modo: "suporte"` (Haiku, curto, sem ficha) | v3.65 |
| POST /extrair | planilha fiel linha a linha; matching em lotes | v3.66 |
| POST /extrair | lotes em paralelo (até 4) | v3.67 |
| POST /extrair | assíncrono, devolve `job_id` | v3.68 |
| GET /extrair-status/{job_id} | andamento do job de extração | v3.68 |
| POST /propostas/exportar-tiny | `criar_contato_se_ausente` (opt-in) | v3.69 |
| POST /propostas/{ref}/pesquisa-dwight | aceita chave `dwight_dispatch` com curral (422/429) | v3.70 |
| POST /propostas/exportar-tiny/previa | prévia sem escrever no Tiny | v3.72 |
| POST /propostas/exportar-tiny | mesma modelagem da prévia; cadastro de cliente por padrão; PUT em reexportação | v3.72 |
| POST /propostas/{ref}/pesquisa-dwight | cache de 1 dia útil + fila (5 itens por lote, 2 lotes em andamento) | v3.73 |
| POST /propostas/{ref}/pesquisa-resultado | puxa o próximo lote da fila | v3.73 |
| GET /propostas/{ref}/pesquisa-resultado | devolve `origem` e `na_fila`; empurra a fila | v3.73 |
| GET /api/guia/exportacao-tiny | guia de campos do Tiny (texto ou json) | v3.75 |
| POST /propostas/exportar-tiny | condição normalizada, recuo, log, erro traduzido | v3.74 / v3.75 |
| POST /propostas/{ref}/pesquisa-resultado | descarta retorno de envio cancelado | v3.75 |
| POST /upsert-precos | aceita `preco_venda` e procura pela descrição original | v3.76 |
| GET /proxima-proposta | cria um rascunho `R-<id>` | v3.77 |
| POST /extrair | `numero_proposta` opcional; `criar_rascunhos` | v3.77 |
| POST /salvar-proposta | sem número abre rascunho; upsert por número ou `numero_rascunho`; devolve `numero` | v3.77 |
| POST /propostas/exportar-tiny | renomeia a proposta para o número do Tiny; `numero_final` | v3.77 |
| POST /propostas/{ref}/pesquisa-kistbot-dwight | disparo pelo KistBot Dwight | v3.78 |
| GET /pesquisa/motores | motores configurados | v3.78 |
| POST /pesquisa/ping/{motor} | teste de conexão com o motor | v3.78 |
| POST /salvar-proposta | `frete_ida` (só quando vem no payload) | v3.80 |
| POST /ordens-compra | herda `frete_ida` da proposta; veredito da compra (v3.82) | v3.80 / v3.82 |
| GET /api/guia/proposta | guia de campos do `/salvar-proposta` | v3.81 |
| GET /catalogo/itens | busca de fichas por PN ou descrição | v3.82 |
| GET /catalogo/itens/{ref} | ficha completa (json ou texto) | v3.82 |
| POST /catalogo/equivalencias/{eid} | operador confirma ou rejeita equivalência (só pela tela) | v3.82 |
| POST /catalogo/contexto | o que a Kist já sabe de cada item | v3.82 |
| GET /propostas/{ref}/extratos | extratos, julgamentos e pontos a validar da proposta | v3.82 |
| GET /pesquisa/extratos/{eid} | um extrato | v3.82 |
| GET /pesquisa/boletim | boletim dos bots (vereditos, saúde, tempo médio) | v3.82 |
| GET /api/guia/pesquisa-retorno | contrato do retorno com as seções de conhecimento | v3.82 |
| POST /propostas/{ref}/pesquisa-resultado | grava extrato, julgamento, ficha, equivalências e observações | v3.82 |
| POST /propostas/exportar-tiny/previa | `pontos_a_validar` | v3.82 |
| POST /propostas/{ref}/pesquisa-resultado | anula Pix suspeito (`preco_pix_descartado`) | v3.83 |
| POST /propostas/{ref}/pesquisa-resultado | marca `preco_divergente` e guarda os dois preços | v3.84 |
| POST /extrair | PDF digitalizado vai como documento para leitura visual | v3.87 |
| POST /propostas/{ref}/pesquisa-dwight e /pesquisa-kistbot-dwight | linha copiada do cache grava o motor do botão (antes: NULL → 500) | v3.88 |

## REGRAS DE NEGÓCIO NOVAS

| Regra | Versão |
|---|---|
| Proposta é encontrada pelo id interno ou pelo número; número duplicado devolve 409 e não escolhe sozinho | v3.60 |
| Qualquer operador lê proposta de qualquer outro (sem filtro por dono) | v3.60 |
| Agente de pesquisa nunca salva proposta nem exporta; só devolve sugestão, e quem decide é o operador | v3.61 |
| Escopo `pesquisa`: a chave só grava resultado de pesquisa (e depois lê a fonte, os guias e o catálogo) | v3.61 |
| Imagem ruim nunca derruba a cotação: recupera o que der e avisa; se não der, lê só o texto; leitura parcial não vai para o cache | v3.62 |
| O Dwight pesquisa TODOS os itens por padrão, inclusive os que já têm preço, porque o mercado pode estar mais barato | v3.63 |
| O Dwight só escreve no item se o item está sem origem ou se a oferta é mais barata que o custo atual; a venda nunca é tocada por ele | v3.63 |
| O preenchimento automático aplica cada item uma única vez; se o operador desfizer ou mexer, não volta a escrever | v3.63 |
| Venda sugerida = custo × markup mediano (item com cliente > item > cliente > geral; amostra mínima de 3 para item e 8 para cliente), só onde a venda está em branco | v3.64 |
| O balão de suporte responde curto, diz "não sei" quando não sabe e não abre chamado | v3.65 |
| Planilha vai inteira para o modelo ("errar mandando é barato; errar descartando apaga a cotação"); falha de leitura vira aviso | v3.66 |
| Falha num lote de matching só deixa sem match os itens daquele lote | v3.66 |
| Chave de bot pode disparar pesquisa, mas só para cotação real (CNPJ válido, cliente, itens reais); a tela não passa por essa trava | v3.70 |
| A prévia da exportação e a exportação usam a mesma modelagem: o que a prévia mostra é o que sai | v3.72 |
| Cliente ausente no Tiny é cadastrado por padrão com dados da Receita; excluído ou com consulta falhando nunca é cadastrado | v3.72 |
| Reexportar atualiza o mesmo orçamento no Tiny em vez de criar outro | v3.72 |
| Pesquisa com resultado encontrado vale até o mesmo horário do próximo dia útil (BRT); a cópia do cache não renova o prazo; "não encontrado" pesquisa de novo | v3.73 |
| Fila de pesquisa: lotes de até 5 itens da mesma proposta, no máximo 2 lotes em andamento por motor; trava diária de 300 itens por chave, sem contar o cache | v3.73 / v3.78 |
| Condição de pagamento fora do formato de parcelas vai como texto livre e nunca trava a exportação | v3.74 |
| Campo em branco vai em branco para o Tiny (sem validade de 7 dias nem frete 0 inventados); desconto em % é convertido em reais | v3.75 |
| Formato de cada campo do Tiny vem de uma fonte única (tela, prévia, guia dos bots e tradução de erro) | v3.75 |
| Retorno atrasado de pesquisa cancelada é descartado | v3.75 |
| O banco de preços procura também pela descrição original do cliente antes de criar produto | v3.76 |
| Número de proposta é exclusivo: rascunho `R-<id>`; depois de exportada, a proposta passa a usar o número do Tiny e o R- continua valendo como referência | v3.77 |
| Todas as abas geradas numa extração são salvas na hora | v3.77 |
| Todos os motores de pesquisa seguem as mesmas regras e compartilham o cache, cada um com sua fila | v3.78 |
| Frete de vinda = custo por item (sem multiplicar pela quantidade); frete de ida = custo por proposta; nenhum dos dois vai ao Tiny; o frete de ida segue para a OC | v3.80 |
| Um bot que omite `frete_ida` não zera o valor já lançado | v3.80 |
| Observação de mercado nunca entra no banco de preços (`produtos`) | v3.82 |
| Equivalência dita por bot é só sugestão e precisa ter fonte; vira regra só por decisão do operador, na tela | v3.82 |
| Veredito automático do bot na exportação e na compra (custo divergente acima de 15%) | v3.82 |
| Riscos e pontos "validar com cliente" aparecem na prévia antes de enviar ao cliente | v3.82 |
| "Preencher sozinho" também preenche a venda (custo × mediana); sem markup, entra só o custo; a venda do operador nunca é sobrescrita | v3.83 |
| ~~Pix mais de 35% abaixo do cheio, ou marcado como OCR/outlier, é descartado e o custo passa a ser o preço cheio~~ (substituída) | v3.83 |
| Pix e cheio divergentes (mais de 35%, ou OCR/outlier) não carregam custo nem venda sozinhos: o operador escolhe no card | v3.84 |
| O auto-save sempre grava a última edição; save com erro continua pendente | v3.84 |
| O login da Cabine vale em todas as abas do navegador (localStorage) | v3.85 |
| PDF digitalizado (sem texto) é lido pela imagem das páginas e o operador é avisado para conferir | v3.87 |
| Construcap BR-040 (CNPJ 63.945.143/0001-96): uma proposta por arquivo anexo, mesmo com o mesmo destino; demais clientes seguem a regra de destino | v3.90 |

## Objetos de banco usados pela primeira vez neste intervalo (todos existem no Supabase, conferido em 23/09)

| Objeto | Versão |
|---|---|
| `propostas.outros_itens` | v3.59 |
| `itens_proposta.item_uid` (uuid com default) | v3.61 |
| tabela `pesquisa_resultados` | v3.61 |
| RPC `markup_por_item` | v3.64 |
| tabela `extracoes_jobs` | v3.68 |
| `pesquisa_resultados.disparado_por` | v3.70 |
| `pesquisa_resultados.chave_cache` e status `na_fila` | v3.73 |
| tabela `tiny_exportacoes_log` | v3.75 |
| `propostas.numero_rascunho` | v3.77 |
| `pesquisa_resultados.motor` | v3.78 |
| `propostas.frete_ida` e `ordens_compra.frete_ida` | v3.80 |
| tabelas `itens_ficha`, `itens_equivalencias`, `mercado_observacoes`, `pesquisa_extratos`, `pesquisa_vereditos` | v3.82 |
| `pesquisa_resultados.julgamento` e `pesquisa_resultados.extrato_id` | v3.82 |

Nenhuma chave de `config_kist` foi adicionada ou lida pela primeira vez neste intervalo. Variáveis de ambiente novas: `DWIGHT_WEBHOOK_URL`, `DWIGHT_WEBHOOK_KEY` e `CABINE_PUBLIC_URL` (v3.61); `KISTBOTS_DWIGHT_WEBHOOK_URL` e `KISTBOTS_DWIGHT_WEBHOOK_KEY` (v3.78).
