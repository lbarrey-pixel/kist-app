# Benchmark do KistBot Dwight — o que a Cabine mede e como usar para melhorar o bot

Documento para quem mantém o KistBot Dwight. Escrito em 25/09/2026 a partir de dados reais da Cabine de Compras (Kist). Números de hoje: 27 buscas do bot já avaliadas, de 8 propostas, desde 22/09.

## 1. A ideia em uma frase

Toda vez que uma proposta com pesquisa do bot é **exportada pro Tiny**, a Cabine compara automaticamente o que o bot recomendou com o que o operador de fato mandou pro cliente. Nenhum humano avalia nada: se a proposta saiu com a oferta do bot, ele acertou; se saiu com outra coisa, o operador corrigiu. O bot passa a ter um placar real, gerado pelo trabalho de verdade, sem ninguém precisar preencher formulário.

## 2. O que é medido

Cada item pesquisado pelo bot recebe **um veredito** no momento da exportação:

| Veredito | Significa | Categoria |
|---|---|---|
| `acertou` | a proposta saiu com a oferta que o bot recomendou | **usada** |
| `custo_divergente` | mesma loja, mas o custo final ficou mais de 15% longe do preço que o bot trouxe | **corrigida** (preço) |
| `escolheu_outra` | o operador usou outra oferta que o bot também trouxe, não a recomendada | **corrigida** (troca) |
| `nao_achou` | o operador usou uma loja que o bot **não trouxe** | **corrigida** (troca) |
| `sem_oferta` | o bot não trouxe oferta nenhuma e o operador achou sozinho | **bot não achou** |

Regras que valem saber:
- Só entra proposta **exportada**. Rascunho não conta. Reexportar substitui o veredito anterior.
- O veredito é **por motor**: se dois bots pesquisaram o mesmo item, cada um tem o seu.
- Item que saiu sem origem nenhuma (sem loja e sem link) não gera veredito — não dá pra julgar.
- Cada veredito guarda o **retrato do momento**: loja e preço que o bot sugeriu, loja e custo com que saiu, os dois links. Se o item mudar depois, o veredito não muda.

Indicadores derivados:
- **taxa_uso** = usadas ÷ total. O placar bruto.
- **taxa_uso_com_oferta** = usadas ÷ (total − sem_oferta). **Qualidade da recomendação** quando o bot trouxe algo. É o número que mede a inteligência.
- **taxa_sem_oferta** = sem_oferta ÷ total. **Cobertura da busca.** É o número que mede as rotas.

## 3. Como acessar

Duas formas, mesma fonte.

**Tela:** Cabine → menu lateral → **Desempenho**. Hoje / 7 dias / 30 dias / compilado ou datas livres; filtro por operador e por bot; tabelas por dia e por operador; item a item com "bot sugeriu × saiu com", links clicáveis e a frase do que mudou. Atualiza sozinha a cada minuto.

**API** (a própria chave do KistBot, escopo `pesquisa`, já tem acesso):

```
GET https://kist-backend.onrender.com/pesquisa/desempenho?dias=7&formato=texto
Authorization: Bearer kist_sk_...
```

Parâmetros: `de`/`ate` (AAAA-MM-DD, horário de Brasília), `dias=N`, `operador=` (padrão: todos), `motor=kistbot|dwight|todos`, `momento=exportacao|compra`. Sem período = compilado completo. Sem `formato=texto` vem JSON com `resumo`, `por_dia`, `por_operador` e `itens`.

Cada item, no JSON:

```
loja_bot, preco_bot, link_bot        o que o bot recomendou
usada, custo_final, link_final       com o que a proposta saiu
diferenca_pct                        custo final × preço do bot
veredito, categoria
mudanca                              frase pronta, ex.: "trocou Leroy Merlin (R$ 37,90)
                                     por Technoluz (R$ 28,69) — loja que o bot não trouxe"
```

Exemplo real, formato texto:

```
- 2026-09-25 1051042 UNIVERSAL · PAINEL LED REDONDO 24W SOBREPOR 6500K · corrigida/nao_achou
  trocou Leroy Merlin (R$ 37,90) por Technoluz (R$ 28,69) — loja que o bot não trouxe
  link do bot: https://www.leroymerlin.com.br/painel-led-24w-redondo-sobrepor-6500k-...
  link que saiu: https://www.technoluz.com/painel-led-24-w-lux-redondo-sobrepor-6500k-taschibra
```

A base de conhecimento do bot (`GET /contexto?secoes=desempenho_bots`) tem o mesmo guia, escrito pra ele ler.

## 4. O placar de hoje (compilado, 22 a 25/09)

| | Itens | % |
|---|---|---|
| Usadas como o bot trouxe | 8 | 30% |
| Corrigidas — trocou de loja | 6 | 22% |
| Corrigidas — mesma loja, preço errado | 6 | 22% |
| Bot não achou | 7 | 26% |
| **Total** | **27** | |

- Uso quando trouxe oferta: **40%** (8 de 20).
- Por dia: 23/09 → 25% · 24/09 → 20% · **25/09 → 55%**. A curva está subindo.

## 5. O que os dados já mostram — três frentes de trabalho

### 5.1 Leitura de preço (6 de 27 — o problema mais barato de resolver)

Nos **seis** casos de "mesma loja, preço errado", o link que o bot recomendou é **exatamente a mesma página** que saiu na proposta. A loja estava certa; o número, não.

| Item | Loja | Bot leu | Preço real |
|---|---|---|---|
| Mini disjuntor bipolar 25A Schneider | Eletrolico | R$ 109,78 | R$ 35,45 |
| Lixadeira/esmerilhadeira 2 baterias | Magazine Luiza | R$ 399,00 | R$ 1.999,00 |
| Impressora 3D Kobra S1 Combo | Mercado Livre | R$ 3.773,00 | R$ 4.879,00 |
| Soprador térmico Dewalt 20V | Mercado Livre | R$ 1.148,21 | R$ 900,00 |
| Carregador Duracell | Mercado Livre | R$ 19,69 | R$ 158,90 |
| Carregador de pilha 9V | Mercado Livre | R$ 19,80 | R$ 24,90 |

Padrões prováveis: preço de **variação/kit** diferente do pedido (lixadeira: 399 é sem bateria, 1.999 é o kit com 2), preço de **outro item da mesma página** (disjuntor 25A a 109 é preço de caixa ou de outro modelo), **OCR** pegando o número errado do print (Duracell, já marcado com `[preço: ocr]`).

Ações: (a) quando a página tem variações, confirmar que o preço lido é da variação que bate com a descrição pedida (quantidade, kit, cor, amperagem); (b) validar o preço lido contra o **preço observado historicamente pela Kist** — a Cabine já entrega isso no envio, no bloco `conhecimento` de cada item (faixa min–max de ofertas anteriores): R$ 109 pra um disjuntor de R$ 35 cairia fora da faixa; (c) quando Pix e cheio vierem de OCR, mandar os dois como leu e marcar na `obs` — a Cabine já trata isso como divergente e pede confirmação ao operador em vez de carregar sozinha.

### 5.2 Cobertura das rotas (7 de 27)

Quando o bot não trouxe nada, onde o operador achou:

| Loja onde o operador achou | vezes |
|---|---|
| Mercado Livre | 4 |
| Amazon | 2 |
| Dimensional, Loja Elétrica, Technoluz, eBay, surveillance-video | 1 cada |

**Quatro dos sete "não achou" estavam no Mercado Livre** — a fonte que o bot mais usa. O extrato mostra a causa provável: a busca no ML é feita com **uma frase única do item** (etapa `busca`, decisão "frase única do item"); se a frase não bate, vem "15 anúncios" errados ou nada. Ações: segunda tentativa com consulta reformulada (PN sozinho, marca + modelo, descrição sem os adjetivos) antes de desistir; e Amazon como rota de fallback para commodity (2 casos).

### 5.3 Escolha da loja (6 de 27)

Quando o bot trouxe oferta e o operador trocou de loja:

- Lojas que o bot recomendou e foram rejeitadas: Dimensional ×2, Mercado Livre ×2, Leroy Merlin, Depocasa.
- Lojas que o operador preferiu: Dimensional, Loja Elétrica, Coopera, Technoluz, eFácil, FG.

O operador trocou por **preço menor** em 5 dos 6 casos (Painel LED: 37,90 → 28,69; tomada Zeffia: 11,49 → 8,99). Só no disjuntor mono 20A pagou mais (7,99 → 8,88) — provavelmente estoque ou confiança na loja. Ação: quando houver mais de uma oferta plausível, trazer **mais de uma** (o contrato aceita até 10) ordenadas por preço, em vez de uma só; a Cabine mostra todas e registra `escolheu_outra` (que ainda conta contra o bot, mas menos que `nao_achou`, e ensina qual loja o operador prefere).

### 5.4 A confiança declarada não está calibrada

| Confiança que o bot declarou | itens | usadas |
|---|---|---|
| alta | 14 | 4 (29%) |
| baixa | 5 | 1 |
| média | 1 | 1 |
| (sem julgamento) | 7 | 2 |

"Alta" hoje acerta 29% — não está separando os casos bons dos ruins. Vale usar o veredito pra recalibrar: se a Cabine corrigiu, o que o bot chamou de "alta" não era. Com a confiança calibrada, a Cabine poderia no futuro carregar sozinha só o que é "alta" de verdade e pedir confirmação no resto.

## 6. Ciclo sugerido

1. **Uma vez por semana**, o bot (ou o Fábio) lê `?dias=7&formato=texto` — custa poucos tokens.
2. Para cada `corrigida`, abrir `link_bot` e `link_final` lado a lado e classificar: preço de variação errada? OCR? loja pior? consulta mal formulada?
3. Para cada `sem_oferta`, abrir `link_final`: a loja estava no alcance do bot? A consulta que ele fez (está no extrato: `GET /propostas/{ref}/extratos`) chegaria lá com outra frase?
4. Mudar uma coisa por vez e olhar a curva por dia. Com 27 itens, cada item vale quase 4 pontos percentuais — não tirar conclusão de um dia só; olhar a semana.

## 7. O que a Cabine não mede (ainda)

- **Custo por busca.** O bot manda tempo, número de buscas e páginas abertas (mediana de 70 s por item, 1,2 buscas, 1,6 páginas), mas **não manda tokens nem custo em dólar**. Sem isso não dá pra calcular custo por busca usada, que é o número que diz se o bot se paga. Pedido: incluir `tokens_entrada`, `tokens_saida`, `custo_usd` e `modelo` na `telemetria` de cada retorno — a Cabine será ajustada para guardar e mostrar.
- **Compra.** Existe um segundo momento de veredito, na criação da ordem de compra (`momento=compra`) — sinal mais forte que a proposta, porque é dinheiro saindo. Ainda tem poucos dados.
- **Vereditos anteriores a 25/09** foram recalculados pelo estado atual do item; os novos guardam o retrato do momento da exportação.

## 8. Aviso sobre o motor "Dwight"

Desde 25/09 o motor Dwight original está desativado na Cabine (não apagado). Toda pesquisa — automática, pela tela ou por item — vai para o KistBot Dwight. O que o bot melhorar a partir daqui aparece no placar sem ruído de outro motor.
