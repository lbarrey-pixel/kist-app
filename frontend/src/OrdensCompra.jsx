import { useState, useEffect, useCallback } from "react";
import {
  brl, btnPrimary, btnGhost, Eyebrow, PageHeader, PoChip, CopyPo,
  IconSearch, IconBoard, IconList, IconDownload, IconX, IconLink, IconTrash, IconCheck, IconCopy, IconGoogle, lerContato } from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Marketplaces para pesquisa rápida por item (mesmo conjunto da tela de proposta).
const MARKETPLACES = [
  { nome: "Mercado Livre", label: "ML",  bg: "#FFE600", fg: "#2D3277", url: (q) => `https://lista.mercadolivre.com.br/${encodeURIComponent(q)}` },
  { nome: "Amazon",        label: "a",   bg: "#232F3E", fg: "#FF9900", url: (q) => `https://www.amazon.com.br/s?k=${encodeURIComponent(q)}` },
  { nome: "AliExpress",    label: "Ali", bg: "#E62E04", fg: "#FFFFFF", url: (q) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}` },
  { nome: "Shopee",        label: "S",   bg: "#EE4D2D", fg: "#FFFFFF", url: (q) => `https://shopee.com.br/search?keyword=${encodeURIComponent(q)}` },
  { nome: "eBay",          label: "eb",  bg: "#E53238", fg: "#FFFFFF", url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
];

const LANES = [
  { key: "aguardando", label: "Aguardando compra",  tint: "#1F6FEB", drop: "confirmada",            status: ["rascunho", "confirmada"] },
  { key: "parcial",    label: "Comprado parcial",   tint: "#7A5AF0", drop: "parcialmente_comprada", status: ["parcialmente_comprada"] },
  { key: "entrega",    label: "Aguardando entrega", tint: "#0E9AAE", drop: "comprada",              status: ["comprada"] },
  { key: "entrega_p",  label: "Entrega parcial",    tint: "#B7791F", drop: "entregue_parcial",      status: ["entregue_parcial"] },
  { key: "disponivel", label: "Disponível",         tint: "#4FA62E", drop: "disponivel",            status: ["disponivel"] },
];
const laneDe = (status) => LANES.find((l) => l.status.includes(status)) || LANES[0];
const STATUS_OPCOES = [
  ["rascunho", "Rascunho"], ["confirmada", "Aguardando compra"],
  ["parcialmente_comprada", "Comprado parcial"], ["comprada", "Aguardando entrega"],
  ["entregue_parcial", "Entrega parcial"], ["disponivel", "Disponível"], ["arquivada", "Arquivada"],
];
const STATUS_LABEL = {
  rascunho: "rascunho", confirmada: "aguardando compra",
  parcialmente_comprada: "comprado parcial", comprada: "aguardando entrega",
  entregue_parcial: "entrega parcial", disponivel: "disponível", arquivada: "arquivada",
};

export default function OrdensCompra({ token, usuario, novaOC, onNovaOCProcessada }) {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

  const [ocs, setOcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [vista, setVista] = useState("kanban");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [criando, setCriando] = useState(false);
  const [equipeToda, setEquipeToda] = useState(false);

  const carregar = useCallback(() => {
    setLoading(true);
    fetch(`${API}/ordens-compra?todos=${equipeToda}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setOcs(Array.isArray(d) ? d : d.ordens || []))
      .catch(() => setErro("Não foi possível carregar as ordens de compra."))
      .finally(() => setLoading(false));
  }, [token, equipeToda]);

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [equipeToda]);

  useEffect(() => {
    if (!novaOC || criando) return;
    const { proposta, itens, po } = novaOC;
    setCriando(true);
    const payload = {
      titulo: `${proposta.cliente} — proposta ${proposta.numero_proposta}`,
      numero_po: po,
      usuario_nome: usuario?.nome,
      status: "rascunho",
      cnpj: proposta.cnpj || null,
      cliente: proposta.cliente || null,
      uf: proposta.uf || null,
      itens: (itens || []).map((i) => ({
        item_proposta_id: i.id,
        descricao: i.descricao_final || i.descricao_original,
        quantidade_proposta: i.quantidade,
        quantidade_comprar: i.quantidade,
        unidade: i.unidade,
        preco_venda: i.preco_venda,
        preco_custo: i.preco_custo || 0,
        frete_vinda: i.frete_vinda || 0,
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
  const normPO = (s) => (s || "").toString().toUpperCase().replace(/O/g, "0").replace(/[^A-Z0-9]/g, "");
  const filtrados = ocs.filter((o) => {
    if (!q.trim()) return true;
    const nq = normPO(q);
    return (nq && normPO(o.numero_po).includes(nq)) ||
      norm(o.id).includes(norm(q)) ||
      norm(o.titulo).includes(norm(q)) || norm(o.cliente).includes(norm(q));
  });

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
    setOcs((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    setSel((s) => (s && s.id === id ? { ...s, status } : s));
    try {
      await fetch(`${API}/ordens-compra/${id}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ status }) });
    } catch (e) { carregar(); }
  }

  // ── Página de detalhe widescreen ─────────────────────────────────────────
  if (sel) {
    return (
      <OCDetalhe
        oc={sel}
        token={token}
        onClose={() => { setSel(null); carregar(); }}
        onChanged={carregar}
        onDeleted={aposExcluir}
      />
    );
  }

  // ── Lista / Kanban ────────────────────────────────────────────────────────
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
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub">
              <input type="checkbox" checked={equipeToda} onChange={(e) => setEquipeToda(e.target.checked)} className="accent-kist" />
              Ver equipe toda
            </label>
            <button onClick={arquivarAntigas} className={btnGhost}>Arquivar antigas</button>
          </>
        } />

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
        <Consolidados token={token} todos={equipeToda} />
      )}
    </div>
  );
}

/* ── Operador tag ────────────────────────────────────────────────────────── */
function OperadorTag({ nome }) {
  const ini = (nome || "?").trim().charAt(0).toUpperCase();
  return (
    <span title={nome || "—"}
      className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-paper text-[10px] font-semibold text-sub ring-1 ring-line2">
      {ini}
    </span>
  );
}

/* ── Kanban ──────────────────────────────────────────────────────────────── */
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
  const custoProd = oc.valor_custo ?? oc.total_custo ?? 0;
  const lucro = oc.lucro_bruto ?? oc.valor_lucro ?? (venda - custoProd);
  const liquido = oc.lucro_liquido;
  const base = oc.nota ?? venda;
  const margem = base > 0 ? (lucro / base) * 100 : 0;
  const tint = laneDe(oc.status).tint;
  return (
    <div role="button" tabIndex={0} draggable
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(oc.id)); e.dataTransfer.effectAllowed = "move"; }}
      className="w-full cursor-grab select-none rounded-xl border border-line bg-surface p-3.5 text-left transition-all hover:border-line2 hover:shadow-[0_1px_3px_rgba(11,31,58,0.06)] active:cursor-grabbing">
      <div className="flex items-center justify-between gap-2">
        <PoChip po={oc.numero_po} />
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <OperadorTag nome={oc.usuario_nome} />
          <span className="font-mono text-[11px] text-faint">{oc.id}</span>
        </div>
      </div>
      <div className="mt-2 leading-snug">
        <div className="text-[13px] font-medium text-ink">{oc.cliente || oc.titulo}</div>
        {(oc.uf || oc.cnpj) && (
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">{oc.uf ? `${oc.uf} · ` : ""}{oc.cnpj || ""}</div>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="font-mono text-[14px] font-semibold text-ink">R$ {brl(venda)}</div>
          {custoProd > 0 ? (
            <div className="mt-0.5 text-[11px]">
              <span className="text-faint">bruto </span>
              <span className={`font-mono font-medium ${lucro >= 0 ? "text-signal" : "text-rose"}`}>R$ {brl(lucro)}</span>
              {liquido != null && <span className="text-faint"> · líq <span className={`font-mono ${liquido >= 0 ? "text-signal" : "text-rose"}`}>R$ {brl(liquido)}</span></span>}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-faint">{STATUS_LABEL[oc.status] || oc.status} · custo pendente</div>
          )}
        </div>
        {custoProd > 0 && (
          <div className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `${tint}14`, color: tint }}>
            {margem.toFixed(0)}% margem
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Lista ───────────────────────────────────────────────────────────────── */
function Lista({ ocs, onSelect }) {
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-paper/70">
            {["PO", "OC", "Título", "Status", "Resp.", "Venda", ""].map((h, i) => (
              <th key={i} className={`px-4 py-2.5 text-[10.5px] font-semibold uppercase eyebrow text-faint ${i === 5 ? "text-right" : "text-left"}`}>{h}</th>
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
              <td className="px-4 py-3"><OperadorTag nome={oc.usuario_nome} /></td>
              <td className="px-4 py-3 text-right font-mono text-[13px] font-medium text-ink">R$ {brl(oc.valor_venda ?? oc.total_venda ?? 0)}</td>
              <td className="px-4 py-3 text-right text-[12px] text-faint">abrir</td>
            </tr>
          ))}
          {ocs.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-faint">Nenhuma OC.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ── Itens consolidados ──────────────────────────────────────────────────── */
function Consolidados({ token, todos }) {
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`${API}/ordens-compra/itens-consolidados?todos=${todos}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setItens(Array.isArray(d) ? d : d.itens || []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false));
  }, [token, todos]);
  if (loading) return <div className="mt-8 text-center text-[13px] text-faint">Carregando…</div>;
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-paper/70">
            {["Produto", "Qtd total", "Em OCs", "Operadores"].map((h, i) => (
              <th key={i} className={`px-4 py-2.5 text-[10.5px] font-semibold uppercase eyebrow text-faint ${i === 1 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((it, i) => {
            const ops = [...new Set((it.itens || []).map((x) => x.oc_usuario).filter(Boolean))];
            return (
              <tr key={i} className="border-b border-line/70 last:border-0">
                <td className="px-4 py-3 text-[13px] text-ink">{it.descricao}</td>
                <td className="px-4 py-3 text-right font-mono text-[13px] text-ink">{it.total_quantidade} {it.unidade}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-sub">{it.total_ocs ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {ops.map((nome, j) => <OperadorTag key={j} nome={nome} />)}
                    {ops.length === 0 && <span className="text-[12px] text-faint">—</span>}
                  </div>
                </td>
              </tr>
            );
          })}
          {itens.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-[13px] text-faint">Nada consolidado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ── Pagamento por item ──────────────────────────────────────────────────── */
const FORMAS = [
  ["cartao", "Cartão"], ["boleto", "Boleto"], ["pix", "Pix"], ["ted", "TED"],
];
const FORMA_LABEL = { cartao: "Cartão", boleto: "Boleto", pix: "Pix", ted: "TED" };

function diasNoMes(ano, mes) { return new Date(ano, mes + 1, 0).getDate(); }
function vencimentosCartao(dia, parcelas, hoje = new Date()) {
  if (!dia) return [];
  const n = Math.max(1, parseInt(parcelas) || 1);
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  let inicio = (hoje.getDate() <= dia) ? 0 : 1;
  const datas = [];
  for (let i = 0; i < n; i++) {
    const ano = base.getFullYear();
    const mes = base.getMonth() + inicio + i;
    const d = new Date(ano, mes, 1);
    const diaClamp = Math.min(dia, diasNoMes(d.getFullYear(), d.getMonth()));
    datas.push(new Date(d.getFullYear(), d.getMonth(), diaClamp));
  }
  return datas;
}
const fmtData = (d) => d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : "";
const _addDiasHoje = (n) => { const d = new Date(); d.setDate(d.getDate() + (parseInt(n) || 0)); return d.toISOString().slice(0, 10); };
const _diasDeHoje = (iso) => {
  if (!iso) return "";
  const b = new Date(); b.setHours(0, 0, 0, 0);
  const a = new Date(iso + "T00:00:00");
  return Math.max(0, Math.round((a - b) / 86400000));
};

function PagamentoItem({ it, cartoes, onSalvar, onAprenderCartao }) {
  const [editing, setEditing] = useState(false);
  const [forma, setForma] = useState(it.forma_pagamento || "");
  const [parcelas, setParcelas] = useState(it.numero_parcelas || 1);
  const [final, setFinal] = useState(it.final_cartao || "");
  const [venc, setVenc] = useState(it.data_vencimento ? String(it.data_vencimento).slice(0, 10) : "");
  const [diaTmp, setDiaTmp] = useState("");
  const [diasBoleto, setDiasBoleto] = useState("");

  const final4 = String(final).slice(-4);
  const cartaoDia = cartoes[final4];
  const dia = (parseInt(diaTmp) || cartaoDia) || null;
  const diaShown = diaTmp !== "" ? diaTmp : (cartaoDia != null ? String(cartaoDia) : "");
  const datas = forma === "cartao" && dia ? vencimentosCartao(dia, parcelas) : [];
  const diasBoletoShown = diasBoleto !== "" ? diasBoleto : (venc ? String(_diasDeHoje(venc)) : "");

  function salvarCartao() {
    onSalvar({ forma_pagamento: "cartao", numero_parcelas: Number(parcelas) || 1, final_cartao: final4 || null });
  }
  function gravarDia() {
    const d = Math.max(1, Math.min(31, parseInt(diaTmp) || 0));
    if (d && final4.length === 4) onAprenderCartao(final4, d);
  }

  if (!editing) {
    if (!forma) {
      return <button onClick={() => setEditing(true)} className="mt-2 text-[11px] font-medium text-kist hover:text-kist600">+ forma de pagamento</button>;
    }
    let resumo = FORMA_LABEL[forma] || forma;
    if (forma === "cartao") resumo = `Cartão ${parcelas}x` + (final4 ? ` · final ${final4}` : "") + (dia ? ` · 1ª ${fmtData(datas[0])}` : "");
    else if (forma === "boleto") resumo = `Boleto ${parcelas}x` + (venc ? ` · vence ${venc.split("-").reverse().join("/")}` : "");
    return (
      <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-paper px-2.5 py-1.5">
        <span className="text-[11px] text-sub">{resumo}</span>
        <button onClick={() => setEditing(true)} className="text-[11px] font-medium text-faint hover:text-kist">editar</button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-line bg-paper p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow text-[9px] font-bold uppercase text-faint">Forma de pagamento</span>
        <button onClick={() => setEditing(false)} className="text-[11px] font-medium text-kist hover:text-kist600">concluir</button>
      </div>
      <div className="flex flex-wrap gap-1">
        {FORMAS.map(([v, l]) => (
          <button key={v} onClick={() => { setForma(v); onSalvar({ forma_pagamento: v }); }}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${forma === v ? "bg-ink text-white" : "border border-line2 bg-surface text-sub hover:text-ink"}`}>{l}</button>
        ))}
      </div>
      {forma === "cartao" && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <label className="block w-20">
              <div className="text-[10.5px] text-faint">Parcelas</div>
              <input type="number" min="1" value={parcelas}
                onChange={(e) => setParcelas(e.target.value)} onBlur={salvarCartao}
                className="w-full rounded bg-surface px-1.5 py-1 font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
            </label>
            <label className="block w-28">
              <div className="text-[10.5px] text-faint">Final do cartão</div>
              <input inputMode="numeric" maxLength={4} value={final} placeholder="0000"
                onChange={(e) => { setFinal(e.target.value.replace(/\D/g, "").slice(0, 4)); setDiaTmp(""); }}
                onBlur={salvarCartao}
                className="w-full rounded bg-surface px-1.5 py-1 font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
            </label>
            {final4.length === 4 && (
              <label className="block w-24">
                <div className="text-[10.5px] text-faint">Vence dia</div>
                <input type="number" min="1" max="31" value={diaShown} placeholder="10"
                  onChange={(e) => setDiaTmp(e.target.value)} onBlur={gravarDia}
                  className="w-full rounded bg-surface px-1.5 py-1 font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
              </label>
            )}
          </div>
          {final4.length === 4 && cartaoDia == null && diaTmp === "" && (
            <div className="text-[10.5px] text-amber">Cartão novo — informe o dia de vencimento da fatura (fica salvo pros próximos).</div>
          )}
          {dia != null && datas.length > 0 && (
            <div className="rounded-md bg-surface px-2 py-1.5">
              <div className="text-[10px] uppercase eyebrow text-faint">Projeção das parcelas</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {datas.map((d, i) => (
                  <span key={i} className="rounded bg-paper px-1.5 py-0.5 font-mono text-[10.5px] text-sub">{i + 1}ª {fmtData(d)}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {forma === "boleto" && (
        <div className="mt-2 space-y-1.5">
          <div className="flex gap-2">
            <label className="block w-16">
              <div className="text-[10.5px] text-faint">Parcelas</div>
              <input type="number" min="1" value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
                onBlur={() => onSalvar({ forma_pagamento: "boleto", numero_parcelas: Number(parcelas) || 1 })}
                className="w-full rounded bg-surface px-1.5 py-1 font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
            </label>
            <label className="block w-24">
              <div className="text-[10.5px] text-faint">Vencimento (dias)</div>
              <input inputMode="numeric" placeholder="ex: 28" value={diasBoletoShown}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setDiasBoleto(v);
                  setVenc(v ? _addDiasHoje(v) : "");
                }}
                onBlur={() => onSalvar({ forma_pagamento: "boleto", numero_parcelas: Number(parcelas) || 1, data_vencimento: venc || null })}
                className="w-full rounded bg-surface px-1.5 py-1 font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
            </label>
            <label className="block flex-1">
              <div className="text-[10.5px] text-faint">Data de vencimento</div>
              <input type="date" value={venc}
                onChange={(e) => { setVenc(e.target.value); setDiasBoleto(e.target.value ? String(_diasDeHoje(e.target.value)) : ""); }}
                onBlur={() => onSalvar({ forma_pagamento: "boleto", numero_parcelas: Number(parcelas) || 1, data_vencimento: venc || null })}
                className="w-full rounded bg-surface px-1.5 py-1 text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
            </label>
          </div>
          <div className="text-[10px] text-faint">Conta a partir de hoje — informe os dias (ex: 28D) ou a data; um atualiza o outro.</div>
        </div>
      )}
      {(forma === "pix" || forma === "ted") && (
        <div className="mt-2 text-[11px] text-faint">Sem campos adicionais para {FORMA_LABEL[forma]}.</div>
      )}
    </div>
  );
}

/* ── OCDetalhe — página widescreen ──────────────────────────────────────── */
function OCDetalhe({ oc, token, onClose, onChanged, onDeleted }) {
  const jsonHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
  const ocId = oc.id ?? oc.numero_oc;

  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [po, setPo] = useState(oc.numero_po || null);
  const [poInput, setPoInput] = useState(oc.numero_po || "");
  const [cliente, setCliente] = useState(oc.cliente || "");
  const [uf, setUf] = useState(oc.uf || "");
  const [cnpj, setCnpj] = useState(oc.cnpj || "");
  const [status, setStatus] = useState(oc.status || "rascunho");
  const [freteVindaGlobal, setFreteVindaGlobal] = useState(oc.frete_vinda_global ?? 0);
  const [freteIda, setFreteIda] = useState(oc.frete_ida ?? 0);
  const [idaCobrado, setIdaCobrado] = useState(!!oc.frete_ida_cobrado);
  const [imposto, setImposto] = useState(oc.imposto_percent ?? 12);
  const [confirmDel, setConfirmDel] = useState(false);
  const [cartoes, setCartoes] = useState({});
  const [novoItem, setNovoItem] = useState(null); // null = oculto; {} = formulário aberto

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/ordens-compra/${ocId}/itens`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setItens(Array.isArray(d) ? d : d.itens || []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false));
  }, [ocId, token]);

  useEffect(() => {
    fetch(`${API}/cartoes`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const map = {};
        (Array.isArray(d) ? d : []).forEach((c) => { if (c.final_cartao != null) map[String(c.final_cartao)] = c.dia_vencimento; });
        setCartoes(map);
      })
      .catch(() => {});
  }, [token]);

  async function aprenderCartao(final, dia) {
    const f = String(final || "").trim().slice(-4);
    if (!f || !dia) return;
    setCartoes((prev) => ({ ...prev, [f]: dia }));
    try {
      await fetch(`${API}/cartoes`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ final_cartao: f, dia_vencimento: dia }) });
    } catch (e) {}
  }

  // Cálculos financeiros
  const totVenda = itens.reduce((s, i) => s + (i.preco_venda || 0) * (i.quantidade_comprar ?? i.quantidade_proposta ?? 0), 0);
  const totCusto = itens.reduce((s, i) => s + (i.preco_custo || 0) * (i.quantidade_comprar ?? i.quantidade_proposta ?? 0), 0);
  const somaVindaItens = itens.reduce((s, i) => s + (parseFloat(i.frete_vinda) || 0), 0);
  const freteVindaEfetivo = somaVindaItens > 0 ? somaVindaItens : (parseFloat(freteVindaGlobal) || 0);
  const freteIdaNum = parseFloat(freteIda) || 0;
  const impostoPct = parseFloat(imposto) || 0;
  const custoTotal = totCusto + freteVindaEfetivo + freteIdaNum;
  const nota = totVenda + (idaCobrado ? freteIdaNum : 0);
  const totLucro = nota - custoTotal;
  const impostoValor = nota * impostoPct / 100;
  const lucroLiquido = totLucro - impostoValor;
  const margem = nota > 0 ? (totLucro / nota) * 100 : 0;

  async function salvarOC(campos) {
    try {
      await fetch(`${API}/ordens-compra/${ocId}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(campos) });
      onChanged && onChanged();
    } catch (e) {}
  }
  function salvarPO() {
    const v = poInput.trim();
    setPo(v || null); salvarOC({ numero_po: v || null });
  }
  function mudarStatus(novo) {
    setStatus(novo); salvarOC({ status: novo });
  }
  // Só muda a tela, sem gravar — pro parser preencher os campos enquanto ele digita.
  function setCampoItem(itemId, campos) {
    setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...campos } : i)));
  }

  // Mesma regra do backend (_rastreavel_oc): rastrear é saber QUEM e COMO.
  // Item rastreável com custo alimenta o banco de preços quando a OC sai de rascunho.
  function rastreavelOC(it) {
    const link = (it.link_fornecedor || "").trim();
    const nome = (it.nome_fornecedor || "").trim();
    const cont = (it.fornecedor_contato || "").trim();
    return !!(link || (nome && cont)) && Number(it.preco_custo) > 0 && Number(it.preco_venda) > 0;
  }
  function faltaOC(it) {
    const f = [];
    const nome = (it.nome_fornecedor || "").trim();
    if (!(it.link_fornecedor || "").trim() && !(nome && (it.fornecedor_contato || "").trim()))
      f.push(nome ? `falta o contato do ${nome}` : "falta a origem");
    if (!(Number(it.preco_venda) > 0)) f.push("falta o preço de venda");
    return f.join(" e ") || "falta lastro";
  }

  // O contato leva a algum lugar? wa.me com o pedido pronto, mailto, tel: ou a URL.
  function acionavel(it) {
    const c = (it.fornecedor_contato || "").trim();
    const canal = it.fornecedor_canal || "";
    if (!c) return (it.link_fornecedor || "").match(/^https?:\/\//i) ? it.link_fornecedor : "";
    if (/^https?:\/\//i.test(c)) return c;
    if (canal === "whatsapp") {
      let d = c.replace(/\D/g, "");
      if (d.length < 8) return "";
      if (d.length <= 11) d = "55" + d;
      const txt = ["Olá! Preciso de cotação para:", "", it.descricao || "",
        Number(it.quantidade_comprar) > 0 ? `Quantidade: ${it.quantidade_comprar} ${it.unidade || "UN"}` : "",
        (it.sku_fornecedor || "").trim() ? `Referência: ${it.sku_fornecedor}` : "",
        "", "Obrigado!"].filter(Boolean).join("\n");
      return `https://wa.me/${d}?text=${encodeURIComponent(txt)}`;
    }
    if (canal === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))
      return `mailto:${c}?subject=${encodeURIComponent("Cotação — " + (it.descricao || "").slice(0, 60))}`;
    if (canal === "telefone") {
      const d = c.replace(/\D/g, "");
      return d.length >= 8 ? `tel:+${d.length <= 11 ? "55" + d : d}` : "";
    }
    return "";
  }

  // Ele cola, o sistema separa. Nunca sobrescreve o que ele já digitou.
  function lerEAplicar(it, txt) {
    const r = lerContato(txt);
    if (!r) { salvarItem(it.id, { fornecedor_contato: txt }); return; }
    const campos = { fornecedor_contato: r.contato || txt };
    if (r.canal && !it.fornecedor_canal) campos.fornecedor_canal = r.canal;
    if (r.quem && !(it.nome_fornecedor || "").trim()) campos.nome_fornecedor = r.quem;
    if (r.canal === "link" && !(it.link_fornecedor || "").trim()) campos.link_fornecedor = r.contato;
    salvarItem(it.id, campos);
  }

  async function salvarItem(itemId, campos) {
    setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...campos } : i)));
    try {
      await fetch(`${API}/oc-itens/${itemId}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(campos) });
    } catch (e) {}
  }
  async function adicionarItem() {
    const desc = (novoItem?.descricao || "").trim();
    if (!desc) return;
    try {
      const r = await fetch(`${API}/oc-itens`, {
        method: "POST", headers: jsonHeaders(),
        body: JSON.stringify({
          oc_id: ocId,
          descricao: desc,
          unidade: novoItem?.unidade || "UN",
          quantidade: parseFloat(novoItem?.quantidade) || 1,
          preco_venda: parseFloat(novoItem?.preco_venda) || 0,
          preco_custo: parseFloat(novoItem?.preco_custo) || 0,
        }),
      });
      const novo = await r.json();
      setItens((prev) => [...prev, novo]);
      setNovoItem(null);
    } catch (e) {}
  }
  async function excluirItem(itemId) {
    setItens((prev) => prev.filter((i) => i.id !== itemId));
    try {
      await fetch(`${API}/oc-itens/${itemId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {}
  }
  async function excluirOC() {
    try {
      await fetch(`${API}/ordens-compra/${ocId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      onDeleted && onDeleted(ocId);
    } catch (e) {}
  }

  function imprimirOC() {
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const statusLabel = STATUS_LABEL[oc.status] || oc.status || "—";
    const cnpjVal = oc.cnpj || oc.cnpj_cliente || "—";
    const entrega = oc.endereco_entrega || oc.endereco || "—";
    const linhas = itens.map((it, i) => {
      const qd = it.quantidade_comprar ?? it.quantidade_proposta ?? 0;
      const venda = it.preco_venda || 0;
      const st = (it.status_item || "—").replace(/_/g, " ");
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${esc(it.descricao)}</strong></td>
        <td class="c">${esc(qd)} ${esc(it.unidade || "")}</td>
        <td>${esc(it.nome_fornecedor || "—")}</td>
        <td class="c">${esc(st)}</td>
        <td class="r">R$ ${brl(venda)}</td>
        <td class="r">R$ ${brl(venda * qd)}</td>
      </tr>`;
    }).join("");
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>OC ${esc(oc.id)} — ${esc(oc.titulo)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0B1F3A; margin: 0; font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0B1F3A; padding-bottom: 10px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; border-radius: 8px; background: #1F6FEB; color: #fff; font-weight: bold; font-size: 18px; display:flex; align-items:center; justify-content:center; }
  .brand small { color: #5B6577; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
  h1 { font-size: 17px; margin: 0; }
  .meta { text-align: right; font-size: 12px; }
  .meta .po { font-size: 16px; font-weight: bold; }
  .status { display:inline-block; margin-top:4px; background:#E8F0FE; color:#175FD3; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:bold; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 14px 0 6px; }
  .grid div { font-size: 12px; }
  .lbl { color: #97A0AF; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #5B6577; border-bottom: 1.5px solid #0B1F3A; padding: 6px 6px; }
  td { border-bottom: 1px solid #E7EAF1; padding: 6px 6px; vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  tfoot td { border-top: 2px solid #0B1F3A; border-bottom: none; font-weight: bold; font-size: 13px; padding-top: 8px; }
  .foot { margin-top: 22px; font-size: 10px; color: #97A0AF; text-align: center; border-top: 1px solid #E7EAF1; padding-top: 8px; }
  h1, h2 { margin: 0; }
</style></head><body>
  <div class="top">
    <div class="brand"><div class="mark">K</div><div><h1>Ordem de Compra</h1><small>Kist · Cabine de Compras</small></div></div>
    <div class="meta">
      <div class="lbl">PO do cliente</div>
      <div class="po">${esc(oc.numero_po || "—")}</div>
      <div class="status">${esc(statusLabel)}</div>
    </div>
  </div>
  <div class="grid">
    <div><div class="lbl">Título</div>${esc(oc.titulo || "—")}</div>
    <div><div class="lbl">OC interna</div>${esc(oc.id)}</div>
    <div><div class="lbl">Cliente</div>${esc(oc.cliente || "—")}</div>
    <div><div class="lbl">CNPJ</div>${esc(cnpjVal)}</div>
    <div style="grid-column:1/3"><div class="lbl">Endereço de entrega</div>${esc(entrega)}</div>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>Descrição</th><th class="c">Qtd</th><th>Fornecedor</th><th class="c">Status</th><th class="r">Venda un.</th><th class="r">Total</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr><td colspan="6" class="r">Total de venda</td><td class="r">R$ ${brl(totVenda)}</td></tr></tfoot>
  </table>
  <div class="foot">Emitido em ${new Date().toLocaleDateString("pt-BR")} · Documento interno Kist Soluções</div>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) { alert("Permita pop-ups para gerar o relatório em PDF."); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 350);
  }

  function abrirTodosLinks() {
    const links = [...new Set(itens.map((it) => it.link_fornecedor).filter((l) => l && /^https?:\/\//i.test(l)))];
    if (!links.length) { alert("Nenhum link de compra (URL) cadastrado nos itens."); return; }
    let bloqueado = false;
    links.forEach((l) => { const w = window.open(l, "_blank", "noopener"); if (!w) bloqueado = true; });
    if (bloqueado) alert("Seu navegador bloqueou algumas abas. Permita pop-ups deste site para abrir todos os links de uma vez.");
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── Barra de contexto (sticky) ─────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-6 py-2.5 backdrop-blur-sm">
        {/* Voltar */}
        <button onClick={onClose}
          className="mr-1 flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-sub transition-colors hover:bg-paper hover:text-ink">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Compras
        </button>
        <div className="h-4 w-px bg-line2" />

        {/* Cliente editável */}
        <input value={cliente} onChange={(e) => setCliente(e.target.value)}
          onBlur={() => cliente !== (oc.cliente || "") && salvarOC({ cliente: cliente.trim() || null })}
          placeholder="Razão social / cliente"
          className="rounded px-1 py-0.5 text-[13.5px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint/60 hover:bg-paper focus:bg-paper focus:ring-1 focus:ring-kist" />

        {/* UF editável */}
        <input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))}
          onBlur={() => uf !== (oc.uf || "") && salvarOC({ uf: uf.trim().toUpperCase() || null })}
          placeholder="UF" maxLength={2}
          className="w-10 rounded border border-line2 bg-paper px-1.5 py-0.5 text-center font-mono text-[11.5px] text-ink outline-none focus:ring-1 focus:ring-kist placeholder:text-faint/60" />

        {/* CNPJ editável */}
        <input value={cnpj} onChange={(e) => setCnpj(e.target.value)}
          onBlur={() => cnpj !== (oc.cnpj || "") && salvarOC({ cnpj: cnpj.trim() || null })}
          placeholder="CNPJ"
          className="w-40 rounded border border-line2 bg-paper px-2 py-0.5 font-mono text-[11.5px] text-ink outline-none focus:ring-1 focus:ring-kist placeholder:text-faint/60" />

        <div className="h-4 w-px bg-line2" />

        {/* PO editável */}
        <div className="flex items-center gap-1.5 rounded-md border border-line2 bg-paper px-2 py-0.5">
          <span className="eyebrow text-[9px] font-bold uppercase text-faint">PO</span>
          <input value={poInput} onChange={(e) => setPoInput(e.target.value)} onBlur={salvarPO}
            placeholder="nº da PO"
            className="w-36 bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:text-faint/60" />
          {po && <CopyPo po={po} />}
        </div>

        {/* Status */}
        <select value={status} onChange={(e) => mudarStatus(e.target.value)}
          className="rounded-md border border-line2 bg-paper px-2 py-1 text-[11.5px] font-medium text-ink outline-none focus:ring-1 focus:ring-kist">
          {STATUS_OPCOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <span className="font-mono text-[11px] text-faint">{oc.id}</span>

        {/* Ações */}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={abrirTodosLinks} title="Abrir todos os links de compra"
            className="inline-flex items-center justify-center rounded-lg border border-line2 px-2.5 py-1.5 text-faint transition-colors hover:border-kist/40 hover:bg-kist/5 hover:text-kist">
            <IconLink size={15} />
          </button>
          <button onClick={imprimirOC} className={`${btnGhost} py-1.5`}><IconDownload size={14} /> Exportar PDF</button>
          <button onClick={() => mudarStatus("confirmada")} className={`${btnPrimary} py-1.5`}>
            <IconCheck size={14} /> Confirmar OC
          </button>
        </div>
      </div>

      {/* ── Corpo: itens (principal) + sidebar financeira ────────────────── */}
      <div className="flex flex-1 items-start">

        {/* Itens — coluna principal */}
        <div className="min-w-0 flex-1 px-8 py-6">
          <div className="mb-4 flex items-center justify-between">
            <Eyebrow>Itens · {itens.length} produto{itens.length !== 1 ? "s" : ""}</Eyebrow>
            <button
              onClick={() => setNovoItem({ descricao: "", unidade: "UN", quantidade: "1", preco_venda: "", preco_custo: "" })}
              className="inline-flex items-center gap-1 rounded-lg border border-line2 px-2.5 py-1 text-[12px] text-sub hover:border-kist/40 hover:text-kist">
              + Adicionar item
            </button>
          </div>

          {loading ? (
            <div className="py-10 text-center text-[13px] text-faint">Carregando itens…</div>
          ) : (
            <div className="space-y-3">
              {itens.map((it) => {
                const link = it.link_fornecedor;
                const isUrl = typeof link === "string" && /^https?:\/\//i.test(link);
                const qd = it.quantidade_comprar ?? it.quantidade_proposta ?? 0;
                const lucroUn = (it.preco_venda || 0) - (it.preco_custo || 0);
                const lucroItem = lucroUn * qd;
                const corLucro = lucroUn >= 0 ? "text-signal" : "text-rose";
                return (
                  <div key={it.id} className="rounded-xl border border-line bg-surface p-4">

                    {/* Linha 1 — descrição + status */}
                    <div className="flex items-start justify-between gap-4">
                      <textarea defaultValue={it.descricao}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== it.descricao) salvarItem(it.id, { descricao: v }); }}
                        rows={2}
                        className="flex-1 resize-none rounded bg-paper px-1.5 py-0.5 text-[13.5px] font-medium leading-snug text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-kist" />
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <select value={it.status_item || "pendente"}
                          onChange={(e) => salvarItem(it.id, { status_item: e.target.value })}
                          className={`rounded-md border border-line2 bg-paper px-2 py-0.5 text-[11px] font-medium outline-none focus:ring-1 focus:ring-kist
                            ${it.status_item === "entregue" ? "text-signal" : it.status_item === "comprado" ? "text-kist" : "text-sub"}`}>
                          <option value="pendente">pendente</option>
                          <option value="comprado">comprado</option>
                          <option value="entregue_parcial">entr. parcial</option>
                          <option value="entregue">entregue</option>
                        </select>
                        <button onClick={() => excluirItem(it.id)}
                          className="text-[10.5px] text-faint/60 hover:text-rose" title="Excluir item">
                          × excluir
                        </button>
                      </div>
                    </div>

                    {/* Pesquisa rápida por marketplace */}
                    <div className="mt-2 flex items-center gap-1">
                      <span className="mr-0.5 text-[10px] text-faint">buscar:</span>
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(it.descricao || "")}`}
                        target="_blank" rel="noopener noreferrer" title="Buscar no Google"
                        className="flex-shrink-0 rounded-md p-1 text-faint/60 transition-colors hover:bg-paper hover:text-ink">
                        <IconGoogle size={14} />
                      </a>
                      {MARKETPLACES.map((mp) => (
                        <a key={mp.nome}
                          href={mp.url(it.descricao || "")}
                          target="_blank" rel="noopener noreferrer"
                          title={`Buscar em ${mp.nome}`}
                          className="flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] px-[3px] text-[9px] font-bold leading-none transition-opacity hover:opacity-80"
                          style={{ background: mp.bg, color: mp.fg }}>
                          {mp.label}
                        </a>
                      ))}
                    </div>

                    {/* Linha 2 — números: qtd | custo | venda | frete | lucro */}
                    <div className="mt-3 grid grid-cols-5 gap-3 border-t border-line/60 pt-3 text-[11.5px]">
                      {/* Qtd + Unidade */}
                      <div>
                        <div className="text-faint">Qtd</div>
                        <div className="mt-0.5 flex items-center gap-1">
                          <input type="number" step="1" min="0" defaultValue={qd}
                            onBlur={(e) => { const v = parseFloat(e.target.value) || 0; if (v !== qd) salvarItem(it.id, { quantidade_comprar: v }); }}
                            className="w-14 rounded bg-paper px-1 py-0.5 text-right font-mono text-ink outline-none focus:ring-1 focus:ring-kist" />
                          <input defaultValue={it.unidade || "UN"}
                            onBlur={(e) => { const v = e.target.value.trim() || "UN"; if (v !== it.unidade) salvarItem(it.id, { unidade: v }); }}
                            className="w-12 rounded bg-paper px-1 py-0.5 font-mono text-[11px] text-faint outline-none focus:ring-1 focus:ring-kist" />
                        </div>
                      </div>
                      {/* Custo un */}
                      <div>
                        <div className="text-faint">Custo un.</div>
                        <div className="mt-0.5 flex items-center gap-0.5">
                          <span className="text-faint">R$</span>
                          <input type="number" step="0.001" defaultValue={it.preco_custo || ""}
                            onBlur={(e) => salvarItem(it.id, { preco_custo: parseFloat(e.target.value) || 0 })}
                            placeholder="—"
                            className="w-20 rounded bg-paper px-1 py-0.5 text-right font-mono text-ink outline-none focus:bg-white focus:ring-1 focus:ring-kist" />
                        </div>
                      </div>
                      {/* Venda un */}
                      <div>
                        <div className="text-faint">Venda un.</div>
                        <div className="mt-0.5 flex items-center gap-0.5">
                          <span className="text-faint">R$</span>
                          <input type="number" step="0.01" defaultValue={it.preco_venda || ""}
                            onBlur={(e) => { const v = parseFloat(e.target.value) || 0; if (v !== it.preco_venda) salvarItem(it.id, { preco_venda: v }); }}
                            placeholder="—"
                            className="w-20 rounded bg-paper px-1 py-0.5 text-right font-mono text-ink outline-none focus:bg-white focus:ring-1 focus:ring-kist" />
                        </div>
                      </div>
                      {/* Frete vinda */}
                      <div>
                        <div className="text-faint">Frete vinda</div>
                        <div className="mt-0.5 flex items-center gap-0.5">
                          <span className="text-faint">R$</span>
                          <input type="number" step="0.01" defaultValue={it.frete_vinda || ""}
                            onBlur={(e) => salvarItem(it.id, { frete_vinda: parseFloat(e.target.value) || 0 })}
                            placeholder="—"
                            className="w-20 rounded bg-paper px-1 py-0.5 text-right font-mono text-ink outline-none focus:bg-white focus:ring-1 focus:ring-kist" />
                        </div>
                      </div>
                      {/* Lucro */}
                      <div>
                        <div className="text-faint">Lucro bruto</div>
                        <div className={`mt-0.5 font-mono font-medium ${corLucro}`}>R$ {brl(lucroItem)}</div>
                        <div className={`text-[10px] ${corLucro} opacity-70`}>un. R$ {brl(lucroUn)}</div>
                      </div>
                    </div>

                    {/* Linha 3 — origem: QUEM | POR ONDE | CONTATO (mesmo setup da proposta).
                        A OC é onde o operador está comprando: é AQUI que ele tem o WhatsApp
                        do fornecedor na mão. Item rastreável alimenta o banco de preços. */}
                    <div className="mt-3 border-t border-line/60 pt-3 text-[11.5px]">
                      {!rastreavelOC(it) && it.preco_custo > 0 && (
                        <div className="mb-2 rounded border border-amber/30 bg-amberbg px-2 py-1 text-[11px] text-amber">
                          ⚠ Sem lastro — {faltaOC(it)}. Este custo <b>não vai</b> pro banco de preços.
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-3">
                        <div>
                          <div className="text-faint">Quem</div>
                          <input value={it.nome_fornecedor || ""}
                            onChange={(e) => setCampoItem(it.id, { nome_fornecedor: e.target.value })}
                            onBlur={(e) => salvarItem(it.id, { nome_fornecedor: e.target.value })}
                            placeholder="DigitalSAT"
                            className="mt-0.5 w-full rounded bg-paper px-1.5 py-0.5 text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-kist" />
                        </div>
                        <div>
                          <div className="text-faint">Por onde</div>
                          <select value={it.fornecedor_canal || ""}
                            onChange={(e) => { setCampoItem(it.id, { fornecedor_canal: e.target.value });
                                               salvarItem(it.id, { fornecedor_canal: e.target.value }); }}
                            className="mt-0.5 w-full cursor-pointer rounded bg-paper px-1.5 py-0.5 text-ink outline-none focus:ring-1 focus:ring-kist">
                            <option value="">—</option>
                            <option value="link">link</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="email">e-mail</option>
                            <option value="telefone">telefone</option>
                            <option value="loja">loja</option>
                            <option value="outro">outro</option>
                          </select>
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-faint">Contato</span>
                            {acionavel(it) && <a href={acionavel(it)} target="_blank" rel="noreferrer"
                              className="text-[10.5px] font-medium text-kist hover:underline">abrir ↗</a>}
                          </div>
                          <input value={it.fornecedor_contato || ""}
                            onChange={(e) => setCampoItem(it.id, { fornecedor_contato: e.target.value })}
                            onBlur={(e) => lerEAplicar(it, e.target.value)}
                            onPaste={(e) => { const t = e.clipboardData.getData("text");
                                              setTimeout(() => lerEAplicar(it, t), 0); }}
                            placeholder="cole o link, o WhatsApp ou o e-mail"
                            className="mt-0.5 w-full rounded bg-paper px-1.5 py-0.5 text-sub outline-none placeholder:text-faint focus:ring-1 focus:ring-kist" />
                        </div>
                        <div>
                          <div className="text-faint">SKU / referência</div>
                          <input defaultValue={it.sku_fornecedor || ""}
                            onBlur={(e) => salvarItem(it.id, { sku_fornecedor: e.target.value })}
                            placeholder="—"
                            className="mt-0.5 w-full rounded bg-paper px-1.5 py-0.5 font-mono text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-kist" />
                        </div>
                      </div>
                    </div>

                    {/* Linha 4 — compra: pedido | prazo | rastreio */}
                    <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line/60 pt-3 text-[11.5px]">
                      <div>
                        <div className="text-faint">Pedido forn.</div>
                        <input defaultValue={it.numero_pedido_fornecedor || ""}
                          onBlur={(e) => salvarItem(it.id, { numero_pedido_fornecedor: e.target.value })}
                          placeholder="nº do pedido"
                          className="mt-0.5 w-full rounded bg-paper px-1.5 py-0.5 font-mono text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-kist" />
                      </div>
                      <div>
                        <div className="text-faint">Prazo entrega</div>
                        <input defaultValue={it.prazo_entrega || ""}
                          onBlur={(e) => salvarItem(it.id, { prazo_entrega: e.target.value })}
                          placeholder="ex: 15 dias"
                          className="mt-0.5 w-full rounded bg-paper px-1.5 py-0.5 text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-kist" />
                      </div>
                      <div>
                        <div className="text-faint">Rastreio</div>
                        <div className="mt-0.5 flex items-center gap-1">
                          <input defaultValue={it.rastreio || ""}
                            onBlur={(e) => salvarItem(it.id, { rastreio: e.target.value })}
                            placeholder="código de rastreio"
                            className="min-w-0 flex-1 rounded bg-paper px-1.5 py-0.5 font-mono text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-kist" />
                          {it.rastreio && (
                            <button onClick={() => { try { navigator.clipboard?.writeText(it.rastreio); } catch (e) {} }}
                              className="shrink-0 rounded px-1 py-0.5 text-faint hover:text-kist" title="copiar rastreio">
                              <IconCopy size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Pagamento */}
                    <PagamentoItem it={it} cartoes={cartoes}
                      onSalvar={(campos) => salvarItem(it.id, campos)}
                      onAprenderCartao={aprenderCartao} />
                  </div>
                );
              })}
              {itens.length === 0 && !novoItem && <div className="py-10 text-center text-[13px] text-faint">Sem itens.</div>}

              {/* Formulário de novo item */}
              {novoItem && (
                <div className="rounded-xl border-2 border-dashed border-kist/30 bg-kist/3 p-4">
                  <div className="mb-3 text-[12px] font-semibold text-sub">Novo item</div>
                  <div className="space-y-2">
                    <textarea
                      value={novoItem.descricao}
                      onChange={(e) => setNovoItem((p) => ({ ...p, descricao: e.target.value }))}
                      placeholder="Descrição do item *"
                      rows={2}
                      className="w-full resize-none rounded-lg border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-kist placeholder:text-faint" />
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <div className="text-[10px] text-faint">Qtd</div>
                        <input type="number" min="0" step="1" value={novoItem.quantidade}
                          onChange={(e) => setNovoItem((p) => ({ ...p, quantidade: e.target.value }))}
                          className="mt-0.5 w-full rounded border border-line2 bg-paper px-2 py-1 text-right font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
                      </div>
                      <div>
                        <div className="text-[10px] text-faint">Unidade</div>
                        <input value={novoItem.unidade}
                          onChange={(e) => setNovoItem((p) => ({ ...p, unidade: e.target.value.toUpperCase() }))}
                          className="mt-0.5 w-full rounded border border-line2 bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
                      </div>
                      <div>
                        <div className="text-[10px] text-faint">Venda un. (R$)</div>
                        <input type="number" step="0.01" value={novoItem.preco_venda}
                          onChange={(e) => setNovoItem((p) => ({ ...p, preco_venda: e.target.value }))}
                          placeholder="0,00"
                          className="mt-0.5 w-full rounded border border-line2 bg-paper px-2 py-1 text-right font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
                      </div>
                      <div>
                        <div className="text-[10px] text-faint">Custo un. (R$)</div>
                        <input type="number" step="0.01" value={novoItem.preco_custo}
                          onChange={(e) => setNovoItem((p) => ({ ...p, preco_custo: e.target.value }))}
                          placeholder="0,00"
                          className="mt-0.5 w-full rounded border border-line2 bg-paper px-2 py-1 text-right font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={adicionarItem} disabled={!novoItem.descricao.trim()}
                        className={`${btnPrimary} ${!novoItem.descricao.trim() ? "opacity-50" : ""}`}>
                        <IconCheck size={14} /> Adicionar
                      </button>
                      <button onClick={() => setNovoItem(null)} className={btnGhost}>Cancelar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sidebar financeira (sticky) ───────────────────────────────── */}
        <div className="w-72 shrink-0 self-start border-l border-line bg-paper/50 px-5 py-6" style={{ position: "sticky", top: "49px" }}>

          {/* Resumo financeiro */}
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-faint">Venda</span>
              <span className="font-mono text-[14px] font-semibold text-ink">R$ {brl(totVenda)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-faint">Custo produtos</span>
              <span className="font-mono text-[13px] text-sub">R$ {brl(totCusto)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-faint">Frete de vinda</span>
              <span className="font-mono text-[13px] text-sub">R$ {brl(freteVindaEfetivo)}</span>
            </div>
            {freteIdaNum > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-faint">Frete de ida</span>
                <span className="font-mono text-[13px] text-sub">R$ {brl(freteIdaNum)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <span className="text-[11px] font-medium text-sub">Lucro bruto</span>
              <span className={`font-mono text-[13px] font-semibold ${totLucro >= 0 ? "text-signal" : "text-rose"}`}>
                R$ {brl(totLucro)}
              </span>
            </div>
            {totCusto > 0 && (
              <div className="flex items-center justify-end">
                <span className="rounded-md bg-paper px-1.5 py-0.5 text-[10.5px] font-semibold text-sub ring-1 ring-line">
                  {margem.toFixed(0)}% margem
                </span>
              </div>
            )}
          </div>

          {/* Fretes & imposto */}
          <div className="mt-5 space-y-3 border-t border-line pt-5">
            <label className="block">
              <div className="text-[10px] uppercase eyebrow text-faint">Frete vinda (R$)</div>
              <input type="number" step="0.01"
                value={somaVindaItens > 0 ? somaVindaItens.toFixed(2) : freteVindaGlobal}
                disabled={somaVindaItens > 0}
                onChange={(e) => setFreteVindaGlobal(parseFloat(e.target.value) || 0)}
                onBlur={() => somaVindaItens === 0 && salvarOC({ frete_vinda_global: parseFloat(freteVindaGlobal) || 0 })}
                className={`mt-1 w-full rounded border border-line2 px-2.5 py-1.5 text-right font-mono text-[12px] outline-none focus:ring-1 focus:ring-kist ${somaVindaItens > 0 ? "bg-line text-faint" : "bg-surface text-ink"}`} />
              {somaVindaItens > 0 && <div className="mt-1 text-[10px] text-faint">Somado dos itens. Zere os itens para lançar valor global.</div>}
            </label>
            <label className="block">
              <div className="text-[10px] uppercase eyebrow text-faint">Frete ida (R$)</div>
              <input type="number" step="0.01" value={freteIda}
                onChange={(e) => setFreteIda(e.target.value)}
                onBlur={() => salvarOC({ frete_ida: parseFloat(freteIda) || 0 })}
                className="mt-1 w-full rounded border border-line2 bg-surface px-2.5 py-1.5 text-right font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-sub">
              <input type="checkbox" checked={idaCobrado}
                onChange={(e) => { setIdaCobrado(e.target.checked); salvarOC({ frete_ida_cobrado: e.target.checked }); }}
                className="accent-kist" />
              ida cobrada do cliente
            </label>
            <label className="block">
              <div className="text-[10px] uppercase eyebrow text-faint">Imposto %</div>
              <input type="number" step="0.1" value={imposto}
                onChange={(e) => setImposto(e.target.value)}
                onBlur={() => salvarOC({ imposto_percent: parseFloat(imposto) || 0 })}
                className="mt-1 w-full rounded border border-line2 bg-surface px-2.5 py-1.5 text-right font-mono text-[12px] text-ink outline-none focus:ring-1 focus:ring-kist" />
            </label>
          </div>

          {/* Lucro líquido */}
          <div className="mt-5 space-y-1.5 border-t border-line pt-5">
            <div className="flex items-baseline justify-between text-[11.5px] text-sub">
              <span>Nota</span>
              <span className="font-mono">R$ {brl(nota)}</span>
            </div>
            <div className="flex items-baseline justify-between text-[11.5px] text-sub">
              <span>Imposto</span>
              <span className="font-mono text-rose">− R$ {brl(impostoValor)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-[11px] uppercase eyebrow text-faint">Lucro líquido</span>
              <span className={`font-mono text-[18px] font-semibold ${lucroLiquido >= 0 ? "text-signal" : "text-rose"}`}>
                R$ {brl(lucroLiquido)}
              </span>
            </div>
          </div>

          {/* Excluir */}
          <div className="mt-6 border-t border-line pt-5">
            {confirmDel ? (
              <div>
                <div className="text-[12px] font-medium text-rose">Excluir {oc.id} e seus {itens.length} itens?</div>
                <div className="mt-0.5 text-[11px] text-rose/80">Ação permanente.</div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setConfirmDel(false)} className={`${btnGhost} flex-1 justify-center text-[12px]`}>Cancelar</button>
                  <button onClick={excluirOC}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-95">
                    <IconTrash size={13} /> Excluir
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line2 px-3 py-2 text-[12px] text-faint transition-colors hover:border-rose/40 hover:bg-rosebg hover:text-rose">
                <IconTrash size={13} /> Excluir OC
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
