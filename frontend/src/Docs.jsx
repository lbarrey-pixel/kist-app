import { PageHeader, Eyebrow } from "./kist-ui.jsx";

const SECOES = [
  {
    titulo: "Como funciona o matching",
    itens: [
      "A IA pré-filtra até 20 candidatos por item e decide com temperature 0.",
      "Preferência sempre por falso negativo a falso positivo: na dúvida, marca como sem match.",
      "Fabricante, categoria e bitola diferentes nunca casam. Cor de cabo não diferencia preço.",
    ],
  },
  {
    titulo: "Léxico de confiança",
    itens: [
      "Exato e Similar usam a descrição do banco e o preço do banco.",
      "Incerto preserva a descrição original do cliente e mostra o candidato do banco.",
      "Sem match zera o preço para cotação manual.",
    ],
  },
  {
    titulo: "Origem do preço",
    itens: [
      "Cada item pode registrar a origem do preço orçado — link do fornecedor ou texto livre.",
      "Essa referência viaja com o item quando a proposta vira ordem de compra, agilizando a compra.",
    ],
  },
  {
    titulo: "PO do cliente",
    itens: [
      "Ao aprovar a proposta, informe o número da PO emitida pelo cliente (PO, OC ou nº SAP).",
      "A PO é a referência usada pelo cliente em toda a comunicação e fica em destaque na OC.",
      "Pode ficar pendente e ser vinculada depois, no painel da OC.",
    ],
  },
  {
    titulo: "Layout do CSV Tiny",
    itens: [
      "45 colunas, separador vírgula, codificação utf-8-sig.",
      "Situação sempre Rascunho. Tipo de pessoa J. Desconto e frete zerados.",
    ],
  },
];

export default function Docs() {
  return (
    <div className="mx-auto max-w-2xl rise">
      <PageHeader eyebrow="Manual" title="Documentação"
        sub="Como o sistema decide um match, regras de negócio e fluxo de propostas e OCs." />
      <div className="mt-6 space-y-3">
        {SECOES.map((s, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-[14px] font-semibold text-ink">{s.titulo}</div>
            <ul className="mt-2 space-y-1.5">
              {s.itens.map((t, j) => (
                <li key={j} className="flex gap-2 text-[12.5px] leading-relaxed text-sub">
                  <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-faint" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-line bg-paper px-4 py-3">
        <Eyebrow>Suporte</Eyebrow>
        <p className="mt-1 text-[12.5px] text-sub">leonardo@kistsolucoes.com.br · (48) 9940-6747</p>
      </div>
    </div>
  );
}
