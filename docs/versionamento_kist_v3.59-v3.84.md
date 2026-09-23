# Kist Cabine: versionamento v3.59 a v3.84

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

---

## ROTAS NOVAS OU ALTERADAS v3.59–v3.84

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
