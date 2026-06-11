import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function fmt(v) {
  if (!v && v !== 0) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return "";
  try { return new Date(v + "T00:00:00").toLocaleDateString("pt-BR"); } catch { return v; }
}

const STATUS_LABEL = {
  rascunho: "Rascunho", confirmada: "Confirmada",
  parcialmente_comprada: "Parcial", comprada: "Comprada",
  entregue_parcial: "Entregue parcial", disponivel: "Disponível", arquivada: "Arquivada"
};
const STATUS_COLOR = {
  rascunho: "bg-slate-100 text-slate-600",
  confirmada: "bg-blue-100 text-blue-700",
  parcialmente_comprada: "bg-amber-100 text-amber-700",
  comprada: "bg-purple-100 text-purple-700",
  entregue_parcial: "bg-orange-100 text-orange-700",
  disponivel: "bg-emerald-100 text-emerald-700",
  arquivada: "bg-slate-100 text-slate-400",
};
const ITEM_STATUS_COLOR = {
  pendente: "bg-slate-100 text-slate-500",
  comprado: "bg-blue-100 text-blue-700",
  entregue_parcial: "bg-amber-100 text-amber-700",
  entregue: "bg-emerald-100 text-emerald-700",
};
const STATUS_FLOW = ["rascunho","confirmada","parcialmente_comprada","comprada","entregue_parcial","disponivel"];

export default function OrdensCompra({ token, usuario, novaOC, onNovaOCProcessada }) {
  const [visao, setVisao] = useState("kanban"); // kanban | lista | itens
  const [ocs, setOcs] = useState([]);
  const [ocAberta, setOcAberta] = useState(null);
  const [itensOC, setItensOC] = useState([]);
  const [itensConsolidados, setItensConsolidados] = useState([]);
  const [todos, setTodos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editandoItem, setEditandoItem] = useState(null);

  const authH = { Authorization: `Bearer ${token}` };

  const carregar = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API}/ordens-compra?todos=${todos}&limit=200`, { headers: authH });
    setOcs(await res.json());
    setLoading(false);
  }, [todos, token]);

  const carregarConsolidados = useCallback(async () => {
    const res = await fetch(`${API}/ordens-compra/itens-consolidados?todos=${todos}`, { headers: authH });
    setItensConsolidados(await res.json());
  }, [todos, token]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (visao === "itens") carregarConsolidados(); }, [visao, carregarConsolidados]);

  // Processar nova OC vinda da tela de Propostas
  useEffect(() => {
    if (!novaOC) return;
    async function criar() {
      const res = await fetch(`${API}/ordens-compra`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH },
        body: JSON.stringify({
          titulo: `${novaOC.proposta.numero_proposta} — ${novaOC.proposta.cliente}`,
          usuario_nome: usuario.nome,
          itens: novaOC.itens.map(i => ({
            item_proposta_id: i.id,
            descricao: i.descricao_final,
            quantidade_proposta: i.quantidade,
            quantidade_comprar: i.quantidade,
            unidade: i.unidade,
            preco_venda: i.preco_venda,
            fornecedor: i.fornecedor || "",
            link_fornecedor: i.link_fornecedor || "",
            sku_fornecedor: i.sku_fornecedor || "",
          })),
        }),
      });
      const data = await res.json();
      await carregar();
      const ocRes = await fetch(`${API}/ordens-compra/${data.oc_id}/itens`, { headers: authH });
      setItensOC(await ocRes.json());
      const ocData = (await (await fetch(`${API}/ordens-compra?limit=200&todos=true`, { headers: authH })).json())
        .find(o => o.id === data.oc_id);
      setOcAberta(ocData);
      setVisao("kanban");
      onNovaOCProcessada();
    }
    criar();
  }, [novaOC]);

  async function abrirOC(oc) {
    setOcAberta(oc);
    const res = await fetch(`${API}/ordens-compra/${oc.id}/itens`, { headers: authH });
    setItensOC(await res.json());
  }

  async function atualizarStatusOC(oc_id, status) {
    await fetch(`${API}/ordens-compra/${oc_id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...authH },
      body: JSON.stringify({ status }),
    });
    carregar();
    if (ocAberta?.id === oc_id) setOcAberta(prev => ({ ...prev, status }));
  }

  async function salvarItem(item_id, campos) {
    await fetch(`${API}/oc-itens/${item_id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...authH },
      body: JSON.stringify(campos),
    });
    if (ocAberta) {
      const res = await fetch(`${API}/ordens-compra/${ocAberta.id}/itens`, { headers: authH });
      setItensOC(await res.json());
    }
    if (visao === "itens") carregarConsolidados();
  }

  async function removerItem(item_id) {
    await fetch(`${API}/oc-itens/${item_id}`, { method: "DELETE", headers: authH });
    if (ocAberta) {
      const res = await fetch(`${API}/ordens-compra/${ocAberta.id}/itens`, { headers: authH });
      setItensOC(await res.json());
    }
  }

  // Calcular totais da OC aberta
  const totalVenda = itensOC.reduce((s, i) => s + (i.preco_venda || 0) * (i.quantidade_comprar || 1), 0);
  const totalCusto = itensOC.reduce((s, i) => s + (i.preco_custo || 0) * (i.quantidade_comprar || 1), 0);
  const frete = ocAberta?.frete_real || ocAberta?.frete_estimado || 0;
  const margemBruta = totalVenda - totalCusto - Number(frete);
  const pctMargem = totalVenda > 0 ? (margemBruta / totalVenda * 100) : 0;

  // Agrupar OCs por status para Kanban
  const ocsPorStatus = {};
  STATUS_FLOW.forEach(s => { ocsPorStatus[s] = ocs.filter(o => o.status === s); });

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Ordens de Compra</h1>
          <p className="text-sm text-slate-500">Gerencie suas compras e acompanhe pedidos</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} className="rounded" />
            Ver equipe toda
          </label>
          <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
            {[["kanban","Kanban"],["lista","Lista"],["itens","Itens"]].map(([v,l]) => (
              <button key={v} onClick={() => setVisao(v)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${visao === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── VISÃO KANBAN ─────────────────────────────────── */}
      {visao === "kanban" && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUS_FLOW.filter(s => s !== "arquivada").map(status => (
            <div key={status} className="flex-shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>
                <span className="text-xs text-slate-400">{ocsPorStatus[status]?.length || 0}</span>
              </div>
              <div className="space-y-2 min-h-[100px]">
                {(ocsPorStatus[status] || []).map(oc => (
                  <div key={oc.id} onClick={() => abrirOC(oc)}
                    className={`bg-white border rounded-xl p-3 cursor-pointer hover:shadow-md transition-all ${ocAberta?.id === oc.id ? "border-blue-400 shadow-md" : "border-slate-200"}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="text-sm font-medium text-slate-800 leading-tight">{oc.titulo || `OC #${oc.id}`}</div>
                    </div>
                    <div className="text-xs text-slate-400 mb-2">
                      {new Date(oc.criado_em).toLocaleDateString("pt-BR")}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{oc.usuario_email?.split("@")[0]}</span>
                      {oc.frete_real > 0 && <span className="text-xs text-slate-400">frete R$ {fmt(oc.frete_real)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── VISÃO LISTA ──────────────────────────────────── */}
      {visao === "lista" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">OC / Título</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Responsável</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Data</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Frete</th>
                <th className="px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ocs.map(oc => (
                <tr key={oc.id} onClick={() => abrirOC(oc)}
                  className={`cursor-pointer hover:bg-slate-50 ${ocAberta?.id === oc.id ? "bg-blue-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">{oc.titulo || `OC #${oc.id}`}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{oc.usuario_email?.split("@")[0]}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(oc.criado_em?.slice(0,10))}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[oc.status]}`}>{STATUS_LABEL[oc.status]}</span></td>
                  <td className="px-4 py-3 text-right text-slate-600 text-xs">{oc.frete_real > 0 ? `R$ ${fmt(oc.frete_real)}` : "—"}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── VISÃO ITENS CONSOLIDADOS ─────────────────────── */}
      {visao === "itens" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Itens a comprar — visão consolidada</span>
            <span className="text-xs text-slate-400">{itensConsolidados.length} produtos distintos</span>
          </div>
          {itensConsolidados.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">Nenhum item pendente</div>
          ) : itensConsolidados.map((grupo, gi) => (
            <div key={gi} className="border-b border-slate-100 last:border-0">
              <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-slate-800">{grupo.descricao}</span>
                  <span className="ml-2 text-xs text-slate-400">{grupo.total_quantidade} {grupo.unidade} em {grupo.total_ocs} {grupo.total_ocs === 1 ? "OC" : "OCs"}</span>
                </div>
                <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">Total: {grupo.total_quantidade} {grupo.unidade}</span>
              </div>
              {grupo.itens.map((item, ii) => (
                <div key={ii} className="px-4 py-2 flex items-center gap-3 border-t border-slate-100 bg-white hover:bg-slate-50">
                  <span className="text-xs text-slate-400 w-28 flex-shrink-0 truncate">{item.oc_titulo || `OC #${item.oc_id}`}</span>
                  <span className="text-xs text-slate-500 w-20 flex-shrink-0">{item.quantidade_comprar} {grupo.unidade}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${ITEM_STATUS_COLOR[item.status_item]}`}>{item.status_item}</span>
                  {item.nome_fornecedor && <span className="text-xs text-blue-600 flex-shrink-0">📦 {item.nome_fornecedor}</span>}
                  {item.link_fornecedor && (
                    <a href={item.link_fornecedor} target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-blue-500 hover:underline flex-shrink-0">🔗 link</a>
                  )}
                  <span className="text-xs text-slate-400 ml-auto flex-shrink-0">{item.oc_usuario}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── PAINEL LATERAL — DETALHE DA OC ───────────────── */}
      {ocAberta && (
        <div className="fixed inset-y-0 right-0 w-[580px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
          {/* Header da OC */}
          <div className="border-b border-slate-200 px-5 py-4 flex-shrink-0">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-slate-800 truncate">{ocAberta.titulo || `OC #${ocAberta.id}`}</div>
                <div className="text-xs text-slate-400">{ocAberta.usuario_email} · {fmtDate(ocAberta.criado_em?.slice(0,10))}</div>
              </div>
              <button onClick={() => setOcAberta(null)} className="text-slate-400 hover:text-slate-600 text-xl flex-shrink-0">✕</button>
            </div>
            {/* Status flow */}
            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_FLOW.map((s, i) => (
                <button key={s} onClick={() => atualizarStatusOC(ocAberta.id, s)}
                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${ocAberta.status === s ? STATUS_COLOR[s] + " font-semibold" : "text-slate-400 hover:bg-slate-100"}`}>
                  {i > 0 && <span className="mr-1">›</span>}{STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Totais */}
          {totalVenda > 0 && (
            <div className="border-b border-slate-100 px-5 py-3 flex-shrink-0 bg-slate-50">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div><div className="text-xs text-slate-400">Venda</div><div className="text-sm font-semibold text-slate-800">R$ {fmt(totalVenda)}</div></div>
                <div><div className="text-xs text-slate-400">Custo</div><div className="text-sm font-semibold text-slate-700">R$ {fmt(totalCusto)}</div></div>
                <div><div className="text-xs text-slate-400">Frete</div>
                  <input type="number" step="0.01"
                    className="w-full text-sm font-semibold text-center border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded"
                    defaultValue={ocAberta.frete_real || 0}
                    onBlur={async e => {
                      await fetch(`${API}/ordens-compra/${ocAberta.id}`, {
                        method: "PUT", headers: { "Content-Type": "application/json", ...authH },
                        body: JSON.stringify({ frete_real: parseFloat(e.target.value) || 0 })
                      });
                      setOcAberta(prev => ({ ...prev, frete_real: parseFloat(e.target.value) || 0 }));
                    }} />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Margem</div>
                  <div className={`text-sm font-semibold ${margemBruta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {pctMargem.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Itens */}
          <div className="flex-1 overflow-y-auto">
            {itensOC.map(item => (
              <ItemOC key={item.id} item={item}
                onSalvar={campos => salvarItem(item.id, campos)}
                onRemover={() => removerItem(item.id)}
                editando={editandoItem === item.id}
                onToggleEditar={() => setEditandoItem(prev => prev === item.id ? null : item.id)}
              />
            ))}
          </div>

          {/* Footer — exportar */}
          <div className="border-t border-slate-200 px-5 py-3 flex-shrink-0 flex gap-2">
            <button onClick={() => exportarOC(ocAberta, itensOC)}
              className="flex-1 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium py-2 rounded-lg">
              ⬇ Exportar planilha
            </button>
            <button onClick={() => window.print()}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
              🖨 Imprimir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemOC({ item, onSalvar, onRemover, editando, onToggleEditar }) {
  const [campos, setCampos] = useState({
    preco_custo: item.preco_custo || 0,
    nome_fornecedor: item.nome_fornecedor || "",
    link_fornecedor: item.link_fornecedor || "",
    sku_fornecedor: item.sku_fornecedor || "",
    forma_pagamento: item.forma_pagamento || "",
    numero_parcelas: item.numero_parcelas || 1,
    data_vencimento: item.data_vencimento || "",
    status_pagamento: item.status_pagamento || "pendente",
    numero_pedido_fornecedor: item.numero_pedido_fornecedor || "",
    prazo_entrega: item.prazo_entrega || "",
    rastreio: item.rastreio || "",
    status_item: item.status_item || "pendente",
    obs: item.obs || "",
    quantidade_comprar: item.quantidade_comprar || item.quantidade_proposta || 1,
  });

  const margem = campos.preco_custo > 0
    ? ((item.preco_venda - campos.preco_custo) / item.preco_venda * 100).toFixed(1)
    : null;

  async function salvar() {
    await onSalvar(campos);
    onToggleEditar();
  }

  return (
    <div className={`border-b border-slate-100 ${editando ? "bg-blue-50" : ""}`}>
      <div className="px-5 py-3 flex items-start gap-3 cursor-pointer" onClick={onToggleEditar}>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-800">{item.descricao}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-slate-400">{campos.quantidade_comprar} {item.unidade}</span>
            <span className="text-xs text-slate-400">venda R$ {Number(item.preco_venda).toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>
            {campos.preco_custo > 0 && <span className="text-xs text-slate-500">custo R$ {Number(campos.preco_custo).toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>}
            {margem && <span className={`text-xs font-medium ${Number(margem) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{margem}% margem</span>}
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              campos.status_item === "entregue" ? "bg-emerald-100 text-emerald-700" :
              campos.status_item === "comprado" ? "bg-blue-100 text-blue-700" :
              campos.status_item === "entregue_parcial" ? "bg-amber-100 text-amber-700" :
              "bg-slate-100 text-slate-500"}`}>{campos.status_item}</span>
            {campos.nome_fornecedor && <span className="text-xs text-blue-600">📦 {campos.nome_fornecedor}</span>}
            {campos.rastreio && <span className="text-xs text-purple-600">📬 {campos.rastreio}</span>}
          </div>
        </div>
        <span className="text-slate-400 text-xs mt-1">{editando ? "▲" : "▼"}</span>
      </div>

      {editando && (
        <div className="px-5 pb-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Qtd a comprar</label>
              <input type="number" step="0.001" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.quantidade_comprar}
                onChange={e => setCampos(p => ({ ...p, quantidade_comprar: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Preço de custo</label>
              <input type="number" step="0.001" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.preco_custo}
                onChange={e => setCampos(p => ({ ...p, preco_custo: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Status item</label>
              <select className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.status_item}
                onChange={e => setCampos(p => ({ ...p, status_item: e.target.value }))}>
                <option value="pendente">Pendente</option>
                <option value="comprado">Comprado</option>
                <option value="entregue_parcial">Entregue parcial</option>
                <option value="entregue">Entregue</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Fornecedor</label>
              <input className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.nome_fornecedor}
                onChange={e => setCampos(p => ({ ...p, nome_fornecedor: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Link / SKU</label>
              <input className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                placeholder="https:// ou SKU"
                value={campos.link_fornecedor}
                onChange={e => setCampos(p => ({ ...p, link_fornecedor: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Forma pgto</label>
              <select className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.forma_pagamento}
                onChange={e => setCampos(p => ({ ...p, forma_pagamento: e.target.value }))}>
                <option value="">—</option>
                <option value="cartao_credito">Cartão crédito</option>
                <option value="boleto">Boleto</option>
                <option value="pix">Pix</option>
                <option value="ted">TED</option>
              </select>
            </div>
            {(campos.forma_pagamento === "cartao_credito" || campos.forma_pagamento === "boleto") && (
              <div>
                <label className="text-xs text-slate-500 block mb-1">Parcelas</label>
                <input type="number" min="1" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  value={campos.numero_parcelas}
                  onChange={e => setCampos(p => ({ ...p, numero_parcelas: parseInt(e.target.value) || 1 }))} />
              </div>
            )}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Vencimento</label>
              <input type="date" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.data_vencimento}
                onChange={e => setCampos(p => ({ ...p, data_vencimento: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Nº pedido fornecedor</label>
              <input className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.numero_pedido_fornecedor}
                onChange={e => setCampos(p => ({ ...p, numero_pedido_fornecedor: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Prazo entrega</label>
              <input type="date" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.prazo_entrega}
                onChange={e => setCampos(p => ({ ...p, prazo_entrega: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Rastreio</label>
              <input className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={campos.rastreio}
                onChange={e => setCampos(p => ({ ...p, rastreio: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1">Observação</label>
            <input className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              value={campos.obs}
              onChange={e => setCampos(p => ({ ...p, obs: e.target.value }))} />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={salvar} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-1.5 rounded-lg">Salvar</button>
            <button onClick={onToggleEditar} className="px-4 py-1.5 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">Cancelar</button>
            <button onClick={() => { if (confirm("Remover item?")) onRemover(); }}
              className="px-3 py-1.5 text-red-500 hover:bg-red-50 text-sm rounded-lg border border-red-200">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

function exportarOC(oc, itens) {
  const rows = [
    ["Descrição","Qtd","Un","Preço Venda","Preço Custo","Margem %","Fornecedor","Link","SKU","Forma Pgto","Parcelas","Vencimento","Nº Pedido","Prazo Entrega","Rastreio","Status","Obs"],
    ...itens.map(i => {
      const margem = i.preco_custo > 0 ? ((i.preco_venda - i.preco_custo) / i.preco_venda * 100).toFixed(1) : "";
      return [
        i.descricao, i.quantidade_comprar, i.unidade,
        i.preco_venda, i.preco_custo, margem,
        i.nome_fornecedor, i.link_fornecedor, i.sku_fornecedor,
        i.forma_pagamento, i.numero_parcelas, i.data_vencimento,
        i.numero_pedido_fornecedor, i.prazo_entrega, i.rastreio,
        i.status_item, i.obs
      ];
    })
  ];
  const csv = rows.map(r => r.map(c => `"${(c||"").toString().replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `OC_${oc.titulo || oc.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
