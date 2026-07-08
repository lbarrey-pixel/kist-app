import {
  Eyebrow, PageHeader,
  IconNova, IconList, IconBoard, IconChat, IconBolt, IconLink,
} from "./kist-ui.jsx";

// Documentação interna — gerada a partir do núcleo de capacidades (v3.11).
// Visão do operador: o que o sistema faz e onde fica.

const SECOES = [
  {
    n: "01", Icon: IconNova, titulo: "Nova proposta",
    desc: "Transforma o pedido do cliente em proposta e no CSV do Tiny.",
    itens: [
      ["Extração automática", "Arraste o .msg do Outlook, cole prints (Ctrl+V), um PDF, um Excel ou o texto do e-mail. O sistema lê os itens — inclusive de tabelas e imagens — e separa em várias propostas se houver clientes diferentes."],
      ["Match com o banco", "Cada item é comparado com o banco de preços e ganha um selo: EXATO, SIMILAR, INCERTO ou SEM MATCH. Fabricante, categoria ou bitola diferente não casa. A descrição do cliente é preservada."],
      ["Origem do preço", "Em cada item, dentro de “origem do preço”, você registra custo, link/fornecedor e SKU. Em match EXATO isso já vem preenchido do banco. É interno — não vai pro Tiny — e viaja pra OC."],
      ["Custo & lucro", "O painel interno mostra venda − custo − frete, com lucro e margem ao vivo. Nada disso é exportado pro Tiny."],
      ["Exportar", "Gera o CSV no formato exato do Tiny. O número da proposta é reservado automaticamente pra dois operadores não colidirem."],
    ],
  },
  {
    n: "02", Icon: IconList, titulo: "Propostas",
    desc: "Todo o histórico da equipe, pesquisável.",
    itens: [
      ["Buscar e filtrar", "Por número, cliente, CNPJ ou item, com intervalo de datas. Marque “ver equipe toda” pra sair só das suas."],
      ["Abrir e editar", "Reabra qualquer proposta pra ajustar itens e preços."],
      ["Aprovar → OC", "Selecione os itens aprovados, informe a PO do cliente e vire ordem de compra."],
    ],
  },
  {
    n: "03", Icon: IconBoard, titulo: "Ordens de compra",
    desc: "Kanban de compras com o modelo financeiro.",
    itens: [
      ["Kanban", "Cards por status (rascunho, confirmada, comprada, disponível)."],
      ["Financeiro ao vivo", "Custo, imposto, frete de vinda e ida, lucro bruto e líquido, margem."],
      ["Identidade do cliente", "CNPJ, razão social e UF vêm da Receita na criação e são editáveis."],
      ["Itens da OC", "Adicione, edite ou remova item a item. Custo e origem chegam preenchidos da proposta."],
      ["Itens consolidados", "Uma visão que agrupa por descrição os itens a comprar de todas as OCs ativas — pra comprar o mesmo item de várias OCs de uma vez."],
      ["Cartões", "Cadastro leve por final do cartão e dia de vencimento. Editar o dia atualiza todas as compras daquele cartão."],
    ],
  },
  {
    n: "04", Icon: IconLink, titulo: "Receber PO",
    desc: "A ordem de compra que o cliente devolve vira OC.",
    itens: [
      ["Entrada da PO", "Suba o .msg, PDF ou imagem da PO. O sistema lê os itens com IA e parsers dos formatos conhecidos (Embraer/SAP, Convergint)."],
      ["Casamento", "Acha a proposta pelo CNPJ do cliente (+ descrição e preço) e lista as candidatas."],
      ["Monta a OC", "Os itens da PO são preservados 100%. A proposta casada só empresta custo/origem quando há certeza de ser o mesmo item — na dúvida, deixa em branco."],
    ],
  },
  {
    n: "05", Icon: IconBolt, titulo: "Banco de preços",
    desc: "Cresce sozinho conforme você usa.",
    itens: [
      ["Alimentação automática", "Ao confirmar a proposta, os itens com preço sobem/atualizam no banco. Custo e origem entram junto quando preenchidos — e campo vazio nunca apaga o que já existia."],
      ["Custo e origem", "Além da venda, o banco guarda custo, link, fornecedor e SKU por produto."],
      ["Alertas", "Anexe um alerta (texto ou imagem) a um produto pra ele reaparecer quando o item voltar a ser cotado."],
    ],
  },
  {
    n: "06", Icon: IconChat, titulo: "Requisições",
    desc: "Sugira melhorias e relate problemas — e acompanhe.",
    itens: [
      ["Conversar", "Fale com o analista do sistema do jeito que vier. Ele entende a dor, checa se já dá pra fazer, e monta uma ficha com a solicitação, a dor e como o sistema deve se comportar depois."],
      ["Confirmar", "O chamado só é aberto depois que você confirma a ficha. Aí você recebe o número."],
      ["Meus chamados", "Acompanhe o andamento. Quando algo é resolvido e sobe pra produção, aparece aqui como “no ar”."],
    ],
  },
];

function Secao({ n, Icon, titulo, desc, itens }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-kist/10 text-kist">
          <Icon size={18} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="eyebrow font-mono text-[11px] font-semibold text-faint">{n}</span>
            <h2 className="text-[16px] font-semibold tracking-tight text-ink">{titulo}</h2>
          </div>
          <p className="text-[12.5px] text-sub">{desc}</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {itens.map(([t, d]) => (
          <div key={t} className="rounded-xl bg-paper/60 p-3">
            <dt className="text-[12.5px] font-semibold text-ink">{t}</dt>
            <dd className="mt-0.5 text-[12.5px] leading-relaxed text-sub">{d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function Docs() {
  return (
    <div className="rise">
      <PageHeader eyebrow="Manual · uso interno" title="Como o sistema funciona"
        sub="O que a Cabine de Compras faz hoje e onde cada coisa fica. Sentiu falta de algo? Peça em Requisições." />

      <div className="mt-8 space-y-4">
        {SECOES.map((s) => <Secao key={s.n} {...s} />)}
      </div>

      <div className="mt-10 rounded-2xl border border-line bg-surface p-6">
        <Eyebrow>Novidades</Eyebrow>
        <ul className="mt-3 space-y-3">
          <li className="flex gap-3">
            <span className="mt-0.5 font-mono text-[11px] font-semibold text-kist">v3.11</span>
            <span className="text-[12.5px] text-sub">
              <strong className="text-ink">Requisições.</strong> Analista interno pra sugerir melhorias e relatar bugs,
              com acompanhamento dos chamados e aviso quando a correção sobe pra produção.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 font-mono text-[11px] font-semibold text-kist">v3.10</span>
            <span className="text-[12.5px] text-sub">
              <strong className="text-ink">Custo e origem no banco.</strong> Custo, link e fornecedor passam a ser
              guardados por produto e já vêm preenchidos numa cotação nova quando o item é o mesmo.
            </span>
          </li>
        </ul>
      </div>

      <p className="mt-6 text-center text-[11px] text-faint">
        Kist · Cabine de Compras · v3.11 · atualizado em 08/07/2026
      </p>
    </div>
  );
}
