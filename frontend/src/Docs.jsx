import { useState } from "react";
import { PageHeader, Eyebrow } from "./kist-ui.jsx";

const VERSAO = "v3.6.1";

const CONF = {
  alta: ["#357A1E", "#EAF5E5", "Exato"], media: ["#175FD3", "#E8F0FE", "Similar"],
  baixa: ["#8A5A12", "#FBF1DD", "Incerto"], nenhuma: ["#A82F2F", "#FBE9E9", "Sem match"],
};
const Tag = ({ k }) => {
  const [fg, bg, label] = CONF[k];
  return <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: fg, background: bg }}>{label}</span>;
};
const Pill = ({ children }) => <span className="rounded-md border border-line2 bg-paper px-1.5 py-0.5 font-mono text-[12px] text-sub">{children}</span>;

function Bloco({ titulo, children }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h3 className="text-[15px] font-semibold text-ink">{titulo}</h3>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-sub">{children}</div>
    </div>
  );
}
const Li = ({ children }) => (
  <div className="flex gap-2"><span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-faint" /><span>{children}</span></div>
);

/* Manual */
function Manual() {
  return (
    <div className="space-y-3">
      <Bloco titulo="O que o sistema faz">
        <p>A Cabine transforma e-mails e prints de cotação em propostas prontas pro Tiny, cruzando cada item com o banco de preços via IA. Aprovada a proposta, ela vira uma ordem de compra (OC), onde a equipe controla custo, fornecedor, rastreio, pagamento e lucro.</p>
        <p className="text-ink">Fluxo: <strong>cotação &rarr; proposta &rarr; ordem de compra &rarr; controle financeiro.</strong></p>
      </Bloco>

      <Bloco titulo="Nova proposta">
        <p><strong className="text-ink">1. Entrada</strong> &mdash; informe o número e traga a cotação: arraste o <Pill>.msg</Pill>, cole prints com <Pill>Ctrl+V</Pill>, cole o texto, ou anexe PDF/Excel/CSV (lidos automaticamente).</p>
        <p><strong className="text-ink">2. Confiança</strong> &mdash; cada item recebe um nível: <Tag k="alta" /> e <Tag k="media" /> usam o banco; <Tag k="baixa" /> preserva a descrição do cliente e mostra o candidato; <Tag k="nenhuma" /> zera o preço pra cotar manual. A barra de triagem resume tudo no topo.</p>
        <p><strong className="text-ink">3. Revisão</strong> &mdash; tudo editável. Por item: <strong>origem do preço</strong> (link ou texto, que viaja pra OC), <strong>sugerir PN</strong> e <strong>specs originais</strong>. Em &ldquo;Confirmar e baixar CSV&rdquo;, salva os preços, registra a proposta e gera o arquivo do Tiny.</p>
      </Bloco>

      <Bloco titulo="Propostas">
        <p>Histórico com busca, filtro por data e &ldquo;Ver equipe toda&rdquo;. Abra uma proposta, selecione os itens aprovados e clique em <strong>&ldquo;Aprovar &rarr; criar OC&rdquo;</strong> &mdash; o sistema pede a <strong>PO do cliente</strong> (pode vincular depois).</p>
      </Bloco>

      <Bloco titulo="Ordens de compra">
        <Li><strong className="text-ink">PO do cliente</strong> &mdash; número que o cliente emite e usa pra falar com vocês. Fica em destaque, com copiar e busca. Sem ela ainda: &ldquo;PO pendente&rdquo;.</Li>
        <Li><strong className="text-ink">Funil (Kanban)</strong> &mdash; Aguardando compra &rarr; Comprado parcial &rarr; Comprado (aguard. entrega) &rarr; Entrega parcial &rarr; Disponível. Mova <strong>arrastando</strong> o card ou pelo <strong>seletor de status</strong> no painel.</Li>
        <Li><strong className="text-ink">Visões</strong> &mdash; Kanban, Lista e Itens consolidados (mesmo produto somado entre OCs). Em todas, a <strong>tag do operador</strong> e o filtro &ldquo;Ver equipe toda&rdquo;.</Li>
        <Li><strong className="text-ink">Painel</strong> &mdash; Venda, Custo e <strong>Lucro bruto</strong> (R$ e margem). Por item: custo real (com frete de vinda embutido), lucro bruto un./item, origem, e <strong>compra &amp; entrega</strong> (pedido do fornecedor, prazo, rastreio).</Li>
        <Li><strong className="text-ink">Excluir &times; Arquivar</strong> &mdash; excluir apaga em definitivo (teste); arquivar só tira do quadro e mantém o histórico.</Li>
      </Bloco>

      <Bloco titulo="Pagamento e cartões">
        <p>Forma de pagamento <strong>opcional</strong>, lançada <strong>por item</strong>. Cartão: parcelas &middot; final &middot; dia de vencimento. Boleto: parcelas &middot; vencimento. Pix/TED: sem extras. Depois de preenchido, vira resumo de uma linha.</p>
        <p><strong className="text-ink">Cartão que aprende</strong> &mdash; informou final + dia uma vez, o sistema guarda. Nas próximas, digitou o final &rarr; o dia vem sozinho e as parcelas são projetadas. Editar o dia recalcula todas as compras daquele cartão.</p>
      </Bloco>

      <Bloco titulo="Regras de matching">
        <Li>Fabricante, categoria ou bitola diferentes &rarr; sem match.</Li>
        <Li>Cor de cabo não muda preço.</Li>
        <Li>Na dúvida, o sistema prefere errar pra menos a inventar um match.</Li>
      </Bloco>
    </div>
  );
}

/* Novidades + versionamento */
const RELEASES = [
  ["v3.6.1", "patch", "Correções", ["Faixa branca do painel da OC corrigida.", "Correção do build do frontend."], true],
  ["v3.6", "menor", "Visão da equipe", ["\u201cVer equipe toda\u201d nas três visões.", "Tag do operador nos cards, lista e consolidados."]],
  ["v3.5", "menor", "Pagamento e cartões", ["Forma de pagamento por item.", "Cartão inteligente: aprende final \u2192 dia e projeta parcelas."]],
  ["v3.4", "menor", "Lucro bruto", ["Lucro bruto em valores (item e OC).", "Base do dashboard executivo."]],
  ["v3.3", "menor", "Funil completo", ["Kanban de 5 estágios + arrastar/seletor.", "Pedido do fornecedor, prazo e rastreio por item."]],
  ["v3.2", "menor", "Excluir OC", ["Exclusão de OC com confirmação."]],
  ["v3.1", "menor", "PO do cliente", ["Captura da PO na aprovação, com busca e cópia.", "Origem do preço viaja da proposta pra OC."]],
  ["v3.0", "maior", "Redesign \u201cCabine\u201d", ["Sidebar, tipografia e cores da marca.", "Triagem de confiança na revisão."]],
  ["v2.x", "base", "Sistema original", ["E-mail \u2192 CSV do Tiny, banco de preços e matching IA."]],
];
const KIND = {
  patch: ["#8A5A12", "#FBF1DD"], menor: ["#357A1E", "#EAF5E5"],
  maior: ["#175FD3", "#E8F0FE"], base: ["#175FD3", "#E8F0FE"],
};

function Novidades() {
  return (
    <div className="space-y-3">
      <Bloco titulo="Como ler a versão — MAIOR.MENOR.PATCH">
        <p>Cada número tem um papel; o da direita reseta quando o do meio sobe, e o do meio quando o da esquerda sobe &mdash; nunca vira lista infinita.</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {[["Maior", "3", "Reformulação grande"], ["Menor", "6", "Função nova"], ["Patch", "1", "Correção / ajuste"]].map(([l, n, d]) => (
            <div key={l} className="rounded-lg border border-line bg-paper p-2.5">
              <div className="eyebrow text-[10px] uppercase text-faint">{l}</div>
              <div className="font-mono text-[14px] font-semibold text-ink">{n}</div>
              <div className="mt-0.5 text-[11.5px] text-sub">{d}</div>
            </div>
          ))}
        </div>
      </Bloco>

      <div className="rounded-xl border border-line bg-surface p-5">
        <Eyebrow>Linha do tempo</Eyebrow>
        <div className="mt-3 space-y-4">
          {RELEASES.map(([ver, kind, titulo, itens, atual]) => {
            const [fg, bg] = KIND[kind];
            return (
              <div key={ver} className="border-l-2 border-line pl-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[14px] font-semibold text-ink">{ver}</span>
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase eyebrow" style={{ color: fg, background: bg }}>{kind}</span>
                  <span className="text-[13px] font-medium text-sub">{titulo}</span>
                  {atual && <span className="text-[11px] font-semibold text-signal">você está aqui</span>}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {itens.map((t, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] text-sub">
                      <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-faint" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Docs() {
  const [aba, setAba] = useState("manual");
  return (
    <div className="mx-auto max-w-2xl rise">
      <PageHeader eyebrow="Documentação" title="Manual & novidades"
        sub="Como o sistema funciona e o que mudou em cada versão."
        actions={<span className="rounded-md border border-line2 bg-paper px-2.5 py-1 font-mono text-[12px] text-sub">{VERSAO}</span>} />

      <div className="mt-5 inline-flex rounded-lg border border-line2 bg-surface p-0.5">
        {[["manual", "Manual"], ["novidades", "Novidades"]].map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`rounded-md px-4 py-1.5 text-[12.5px] font-medium transition-colors ${aba === k ? "bg-ink text-white" : "text-sub hover:text-ink"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="mt-5">{aba === "manual" ? <Manual /> : <Novidades />}</div>

      <div className="mt-4 rounded-xl border border-line bg-paper px-4 py-3">
        <Eyebrow>Suporte</Eyebrow>
        <p className="mt-1 text-[12.5px] text-sub">leonardo@kistsolucoes.com.br · (48) 9940-6747</p>
      </div>
    </div>
  );
}
