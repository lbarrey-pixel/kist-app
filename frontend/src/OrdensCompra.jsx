import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  brl, btnPrimary, btnGhost, Eyebrow, PageHeader, PoChip, CopyPo,
  IconSearch, IconBoard, IconList, IconDownload, IconX, IconLink, IconTrash, IconCheck,
} from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Trilhas do quadro (agrupam status finos). `drop` = status aplicado ao arrastar pra cá.
const LANES = [
  { key: "rascunho",   label: "Rascunho",   tint: "#9FA8B8", drop: "rascunho",   status: ["rascunho"] },
  { key: "confirmada", label: "Confirmada", tint: "#1F6FEB", drop: "confirmada", status: ["confirmada"] },
  { key: "compra",     label: "Em compra",  tint: "#7A5AF0", drop: "comprada",   status: ["parcialmente_comprada", "comprada", "entregue_parcial"] },
  { key: "disponivel", label: "Disponível", tint: "#4FA62E", drop: "disponivel", status: ["disponivel"] },
];
const laneDe = (status) => LANES.find((l) => l.status.includes(status)) || LANES[0];
const STATUS_OPCOES = [
  ["rascunho", "Rascunho"], ["confirmada", "Confirmada"],
  ["parcialmente_comprada", "Parc. comprada"], ["comprada", "Comprada"],
  ["entregue_parcial", "Entr. parcial"], ["disponivel", "Disponível"], ["arquivada", "Arquivada"],
];
const STATUS_LABEL = {
  rascunho: "rascunho", confirmada: "confirmada", parcialmente_comprada: "parc. comprada",
  comprada: "comprada", entregue_parcial: "entr. parcial", disponivel: "disponível", arquivada: "arquivada",
};

export default function OrdensCompra({ token, usuario, novaOC, onNovaOCProcessada }) {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

  const [ocs, setOcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [vista, setVista] = useState("kanban"); // kanban | lista | consolidados
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(() => {
    setLoading(true);
    fetch(`${API}/ordens-compra`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setOcs(Array.isArray(d) ? d : d.ordens || []))
      .catch(() => setErro("Não foi possível carregar as ordens de compra."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  // Criação de OC a partir de uma proposta aprovada (carrega a origem junto)
  useEffect(() => {
    if (!novaOC || criando) return;
    const { proposta, itens, po } = novaOC;
    setCriando(true);
    const payload = {
      titulo: `${proposta.cliente} — proposta ${proposta.numero_proposta}`,
      numero_po: po,
      usuario_nome: usuario?.nome,
      status: "rascunho",
      itens: (itens || []).map((i) => ({
        item_proposta_id: i.id,
        descricao: i.descricao_final || i.descricao_original,
        quantidade_proposta: i.quantidade,
        quantidade_comprar: i.quantidade,
        unidade: i.unidade,
        preco_venda: i.preco_venda,
        // origem do preço viaja junto pra facilitar a compra:
        nome_fornecedor: i.fornecedor || null,
        link_fornecedor: i.link_fornecedor || null,
        sku_fornecedor: i.sku_fornecedor || null,
      })),
    };
    fetch(`${API}/ordens-compra`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) })
      .then((r) => r.json())
      .then(() => { carregar(); })
      .catch(() => setErro("Falha ao criar a OC."))
      .finally(() => { setCriando(false); onNovaOCProcessada && onNovaOCProcessada(); });
  }, [novaOC]);

  const norm = (s) => (s || "").toString().toLowerCase();
  const filtrados = ocs.filter((o) =>
    !q.trim() ||
    norm(o.numero_po).includes(norm(q)) || norm(o.id).includes(norm(q)) ||
    norm(o.titulo).includes(norm(q)) || norm(o.cliente).includes(norm(q)));

  async function arquivarAntigas() {
    try {
      await fetch(`${API}/ordens-compra/arquivar-antigas`, { method: "POST", headers: jsonHeaders() });
      carregar();
    } catch (e) {}
  }

  function aposExcluir(id) {
    setOcs((prev) => prev.filter((o) => (o.id ?? o.numero_oc) !== id));
    setSel(null);
  }

  async function moverStatus(id, status) {
    setOcs((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));   // otimista
    setSel((s) => (s && s.id === id ? { ...s, status } : s));
    try {
      await fetch(`${API}/ordens-compra/${id}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ status }) });
    } catch (e) { carregar(); }
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-9 rise">
      <PageHeader eyebrow="Compras" title="Ordens de compra"
        sub="Busque pela PO do cliente. Clique numa OC para custos, fornecedores, origem e margem."
        actions={
          <>
            <div className="flex items-center gap-2 rounded-lg border border-line2 bg-surface px-3 py-2 text-[13px] text-faint">
              <IconSearch size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                className="w-44 bg-transparent text-ink outline-none placeholder:text-faint"
                placeholder="PO, OC, cliente…" />
            </div>
            <button onClick={arquivarAntigas} className={btnGhost}>Arquivar antigas</button>
          </>
        } />

      {/* Alternador de vista */}
      <div className="mt-5 inline-flex rounded-lg border border-line2 bg-surface p-0.5">
        {[["kanban", "Kanban", IconBoard], ["lista", "Lista", IconList], ["consolidados", "Itens consolidados", IconList]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => setVista(k)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors
              ${vista === k ? "bg-ink text-white" : "text-sub hover:text-ink"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {erro && <div className="mt-4 rounded-lg border border-rose/30 bg-rosebg px-4 py-3 text-[13px] text-rose">{erro}</div>}
      {loading ? (
        <div className="mt-8 text-center text-[13px] text-faint">Carregando…</div>
      ) : vista === "kanban" ? (
        <Kanban ocs={filtrados} onSelect={setSel} onMove={moverStatus} />
      ) : vista === "lista" ? (
        <Lista ocs={filtrados} onSelect={setSel} />
      ) : (
        <Consolidados token={token} />
      )}

      {sel && (
        <SlideOver oc={sel} token={token}
          onClose={() => setSel(null)}
          onChanged={carregar}
          onDeleted={aposExcluir} />
      )}
    </div>
  );
}

/* ── Vista Kanban (com arrastar entre colunas) ─────────────────────────────── */
function Kanban({ ocs, onSelect, onMove }) {
  const [over, setOver] = useState(null);
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {LANES.map((lane) => {
        const cards = ocs.filter((o) => laneDe(o.status).key === lane.key);
        const ativo = over === lane.key;
        return (
          <div key={lane.key} className="flex flex-col"
            onDragOver={(e) => { e.preventDefault(); setOver(lane.key); }}
            onDragLeave={() => setOver((o) => (o === lane.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const raw = e.dataTransfer.getData("text/plain");
              if (!raw) return;
              const id = isNaN(Number(raw)) ? raw : Number(raw);
              onMove(id, lane.drop);
            }}>
            <div className="mb-2.5 flex items-center gap-2 px-1">
              <span className="h-2 w-2 rounded-full" style={{ background: lane.tint }} />
              <span className="text-[12px] font-semibold text-ink">{lane.label}</span>
              <span className="font-mono text-[11px] text-faint">{cards.length}</span>
            </div>
            <div className={`flex min-h-[88px] flex-col gap-2.5 rounded-xl p-1 transition-colors ${ativo ? "bg-kist/[0.06] ring-1 ring-inset ring-kist/30" : ""}`}>
              {cards.map((oc) => <OCCard key={oc.id} oc={oc} onClick={() => onSelect(oc)} />)}
              {cards.length === 0 && (
                <div className="rounded-xl border border-dashed border-line2 px-3 py-6 text-center text-[11.5px] text-faint">
                  {ativo ? "soltar aqui" : "vazio"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OCCard({ oc, onClick }) {
  const venda = oc.valor_venda ?? oc.total_venda ?? 0;
  const custo = oc.valor_custo ?? oc.total_custo ?? 0;
  const margem = venda > 0 ? ((venda - custo) / venda) * 100 : 0;
  const tint = laneDe(oc.status).tint;
  return (
    <div role="button" tabIndex={0} draggable
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(oc.id)); e.dataTransfer.effectAllowed = "move"; }}
      className="w-full cursor-grab select-none rounded-xl border border-line bg-surface p-3.5 text-left transition-all hover:border-line2 hover:shadow-[0_1px_3px_rgba(11,31,58,0.06)] active:cursor-grabbing">
      <div className="flex items-center justify-between gap-2">
        <PoChip po={oc.numero_po} />
        <span className="flex-shrink-0 font-mono text-[11px] text-faint">{oc.id}</span>
      </div>
      <div className="mt-2 text-[13px] font-medium leading-snug text-ink">{oc.titulo}</div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="font-mono text-[14px] font-semibold text-ink">R$ {brl(venda)}</div>
          <div className="mt-0.5 text-[11px] text-faint">{STATUS_LABEL[oc.status] || oc.status} · venda</div>
        </div>
        {venda > 0 && (
          <div className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `${tint}14`, color: tint }}>
            {margem.toFixed(0)}% margem
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Vista Lista ───────────────────────────────────────────────────────────── */
function Lista({ ocs, onSelect }) {
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-paper/70">
            {["PO", "OC", "Título", "Status", "Venda", ""].map((h, i) => (
              <th key={i} className={`px-4 py-2.5 text-[10.5px] font-semibold uppercase eyebrow text-faint ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ocs.map((oc) => (
            <tr key={oc.id} onClick={() => onSelect(oc)} className="group cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-paper/60">
              <td className="px-4 py-3"><PoChip po={oc.numero_po} /></td>
              <td className="px-4 py-3 font-mono text-[12px] text-sub">{oc.id}</td>
              <td className="px-4 py-3 text-[13px] font-medium text-ink">{oc.titulo}</td>
              <td className="px-4 py-3 text-[12px] text-sub">{STATUS_LABEL[oc.status] || oc.status}</td>
              <td className="px-4 py-3 text-right font-mono text-[13px] font-medium text-ink">R$ {brl(oc.valor_venda ?? oc.total_venda ?? 0)}</td>
              <td className="px-4 py-3 text-right text-[12px] text-faint">abrir</td>
            </tr>
          ))}
          {ocs.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px] text-faint">Nenhuma OC.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ── Vista Itens consolidados ──────────────────────────────────────────────── */
function Consolidados({ token }) {
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${API}/ordens-compra/itens-consolidados`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setItens(Array.isArray(d) ? d : d.itens || []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false));
  }, [token]);
  if (loading) return <div className="mt-8 text-center text-[13px] text-faint">Carregando…</div>;
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-paper/70">
            {["Produto", "Qtd total", "Em OCs"].map((h, i) => (
              <th key={i} className={`px-4 py-2.5 text-[10.5px] font-semibold uppercase eyebrow text-faint ${i === 1 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((it, i) => (
            <tr key={i} className="border-b border-line/70 last:border-0">
              <td className="px-4 py-3 text-[13px] text-ink">{it.descricao}</td>
              <td className="px-4 py-3 text-right font-mono text-[13px] text-ink">{it.total_quantidade} {it.unidade}</td>
              <td className="px-4 py-3 font-mono text-[12px] text-sub">{it.total_ocs ?? "—"}</td>
            </tr>
          ))}
          {itens.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-[13px] text-faint">Nada consolidado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ── Painel lateral ────────────────────────────────────────────────────────── */
function SlideOver({ oc, token, onClose, onChanged, onDeleted }) {
  const jsonHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
  const ocId = oc.id ?? oc.numero_oc;

  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [po, setPo] = useState(oc.numero_po || null);
  const [poInput, setPoInput] = useState("");
  const [status, setStatus] = useState(oc.status || "rascunho");
  const [frete, setFrete] = useState(oc.frete_real ?? oc.frete_estimado ?? 0);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/ordens-compra/${ocId}/itens`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setItens(Array.isArray(d) ? d : d.itens || []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false));
  }, [ocId, token]);

  const totVenda = itens.reduce((s, i) => s + (i.preco_venda || 0) * (i.quantidade_comprar ?? i.quantidade_proposta ?? 0), 0);
  const totCusto = itens.reduce((s, i) => s + (i.preco_custo || 0) * (i.quantidade_comprar ?? i.quantidade_proposta ?? 0), 0);
  const margem = totVenda > 0 ? ((totVenda - totCusto) / totVenda) * 100 : 0;

  async function salvarOC(campos) {
    try {
      await fetch(`${API}/ordens-compra/${ocId}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(campos) });
      onChanged && onChanged();
    } catch (e) {}
  }
  function vincularPO() {
    const v = poInput.trim(); if (!v) return;
    setPo(v); salvarOC({ numero_po: v });
  }
  function mudarStatus(novo) {
    setStatus(novo); salvarOC({ status: novo });
  }
  async function salvarItem(itemId, campos) {
    setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...campos } : i)));
    try {
      await fetch(`${API}/oc-itens/${itemId}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(campos) });
    } catch (e) {}
  }
  async function excluirOC() {
    try {
      await fetch(`${API}/ordens-compra/${ocId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      onDeleted && onDeleted(ocId);
    } catch (e) {}
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="slide-in relative flex h-screen w-[460px] flex-col bg-surface shadow-2xl">
        {/* Cabeçalho — PO em destaque */}
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <PoChip po={po} size="lg" />
                {po && <CopyPo po={po} />}
              </div>
              <h3 className="mt-2 text-[16px] font-semibold tracking-tight text-ink">{oc.titulo}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
                <span className="font-mono text-sub">{oc.id}</span>
                {oc.cliente && <><span>·</span><span>{oc.cliente}</span></>}
                <span>·</span>
                <select value={status} onChange={(e) => mudarStatus(e.target.value)}
                  className="rounded-md border border-line2 bg-paper px-1.5 py-0.5 text-[11px] font-medium text-ink outline-none focus:ring-1 focus:ring-kist">
                  {STATUS_OPCOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <button onClick={onClose} className="flex-shrink-0 rounded-md p-1 text-faint hover:bg-paper hover:text-ink"><IconX size={18} /></button>
          </div>
          {!po && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber/30 bg-amberbg px-2.5 py-2">
              <input value={poInput} onChange={(e) => setPoInput(e.target.value)}
                placeholder="Informar nº da PO do cliente"
                className="flex-1 bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:text-amber/70" />
              <button onClick={vincularPO} className="flex-shrink-0 rounded-md bg-amber px-2.5 py-1 text-[11.5px] font-medium text-white">Vincular PO</button>
            </div>
          )}
        </div>

        {/* Totais */}
        <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
          {[["Venda", totVenda, "text-ink"], ["Custo", totCusto, "text-sub"], ["Margem", null, "text-signal"]].map(([l, v, cls], i) => (
            <div key={i} className="bg-surface px-4 py-3">
              <div className="text-[10.5px] uppercase eyebrow text-faint">{l}</div>
              <div className={`mt-0.5 font-mono text-[14px] font-semibold ${cls}`}>
                {v === null ? `${margem.toFixed(0)}%` : `R$ ${brl(v)}`}
              </div>
            </div>
          ))}
        </div>

        {/* Itens */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <Eyebrow>Itens · custo & origem</Eyebrow>
            <label className="flex items-center gap-1.5 text-[11px] text-faint">
              frete R$
              <input type="number" value={frete}
                onChange={(e) => setFrete(parseFloat(e.target.value) || 0)}
                onBlur={() => salvarOC({ frete_real: frete })}
                className="w-16 rounded border border-line2 bg-paper px-1.5 py-0.5 text-right font-mono text-[11px] text-ink outline-none" />
            </label>
          </div>

          {loading ? (
            <div className="py-6 text-center text-[12.5px] text-faint">Carregando itens…</div>
          ) : (
            <div className="space-y-2">
              {itens.map((it) => {
                const link = it.link_fornecedor;
                const isUrl = typeof link === "string" && /^https?:\/\//i.test(link);
                return (
                  <div key={it.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[12.5px] font-medium leading-snug text-ink">{it.descricao}</div>
                      <select value={it.status_item || "pendente"}
                        onChange={(e) => salvarItem(it.id, { status_item: e.target.value })}
                        className={`flex-shrink-0 rounded-md border border-line2 bg-surface px-1.5 py-0.5 text-[10.5px] font-medium outline-none
                          ${it.status_item === "entregue" ? "text-signal" : it.status_item === "comprado" ? "text-kist" : "text-sub"}`}>
                        <option value="pendente">pendente</option>
                        <option value="comprado">comprado</option>
                        <option value="entregue_parcial">entr. parcial</option>
                        <option value="entregue">entregue</option>
                      </select>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <div className="text-faint">Qtd</div>
                        <div className="font-mono text-ink">{it.quantidade_comprar ?? it.quantidade_proposta} {it.unidade}</div>
                      </div>
                      <div>
                        <div className="text-faint">Custo un.</div>
                        <div className="flex items-center gap-0.5">
                          <span className="text-faint">R$</span>
                          <input type="number" step="0.001" defaultValue={it.preco_custo || ""}
                            onBlur={(e) => salvarItem(it.id, { preco_custo: parseFloat(e.target.value) || 0 })}
                            placeholder="—"
                            className="w-16 rounded bg-paper px-1 py-0.5 text-right font-mono text-ink outline-none focus:bg-white focus:ring-1 focus:ring-kist" />
                        </div>
                      </div>
                      <div>
                        <div className="text-faint">Venda un.</div>
                        <div className="font-mono text-ink">R$ {brl(it.preco_venda)}</div>
                      </div>
                    </div>

                    {/* Origem do preço — herdada da proposta */}
                    <div className="mt-2 border-t border-line/70 pt-2">
                      <div className="flex items-center gap-1.5">
                        {isUrl ? <IconLink size={12} className="flex-shrink-0 text-kist" />
                               : <span className="eyebrow flex-shrink-0 text-[9px] font-bold uppercase text-faint">Origem</span>}
                        <input defaultValue={link || ""}
                          onBlur={(e) => salvarItem(it.id, { link_fornecedor: e.target.value })}
                          placeholder="link ou texto da origem do preço"
                          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-sub outline-none placeholder:text-faint" />
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <input defaultValue={it.nome_fornecedor || ""}
                          onBlur={(e) => salvarItem(it.id, { nome_fornecedor: e.target.value })}
                          placeholder="fornecedor"
                          className="flex-1 bg-transparent text-[11.5px] text-sub outline-none placeholder:text-faint" />
                        {isUrl && (
                          <a href={link} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-kist hover:underline">abrir ↗</a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {itens.length === 0 && <div className="py-6 text-center text-[12.5px] text-faint">Sem itens.</div>}
            </div>
          )}
        </div>

        {/* Rodapé — ações + exclusão */}
        {confirmDel ? (
          <div className="border-t border-rose/30 bg-rosebg px-5 py-3">
            <div className="text-[12.5px] font-medium text-rose">Excluir {oc.id} e seus {itens.length} itens?</div>
            <div className="mt-0.5 text-[11.5px] text-rose/80">Ação permanente. Para apenas tirar do quadro, arquive em vez de excluir.</div>
            <div className="mt-2.5 flex items-center gap-2">
              <button onClick={() => setConfirmDel(false)} className={`${btnGhost} flex-1 justify-center`}>Cancelar</button>
              <button onClick={excluirOC}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:brightness-95">
                <IconTrash size={14} /> Excluir definitivamente
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-t border-line px-5 py-3">
            <button onClick={() => setConfirmDel(true)} title="Excluir OC"
              className="inline-flex items-center justify-center rounded-lg border border-line2 px-2.5 py-2 text-faint transition-colors hover:border-rose/40 hover:bg-rosebg hover:text-rose">
              <IconTrash size={15} />
            </button>
            <button onClick={() => window.print()} className={`${btnGhost} flex-1 justify-center`}><IconDownload size={14} /> Exportar / PDF</button>
            <button onClick={() => mudarStatus("confirmada")} className={`${btnPrimary} flex-1 justify-center`}>
              <IconCheck size={14} /> Confirmar OC
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
