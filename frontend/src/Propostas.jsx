import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function fmt(v) {
  if (!v && v !== 0) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR");
}

export default function Propostas({ token, usuario, onCriarOC }) {
  const [propostas, setPropostas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtros, setFiltros] = useState({ numero: "", cnpj: "", data_inicio: "", data_fim: "", todos: false });
  const [selecionada, setSelecionada] = useState(null);
  const [itens, setItens] = useState([]);
  const [loadingItens, setLoadingItens] = useState(false);
  const [itensSelecionados, setItensSelecionados] = useState({});

  const authH = { Authorization: `Bearer ${token}` };

  async function buscar() {
    setLoading(true);
    const p = new URLSearchParams();
    if (filtros.numero) p.set("numero", filtros.numero);
    if (filtros.cnpj) p.set("cnpj", filtros.cnpj);
    if (filtros.data_inicio) p.set("data_inicio", filtros.data_inicio);
    if (filtros.data_fim) p.set("data_fim", filtros.data_fim);
    if (filtros.todos) p.set("todos", "true");
    const res = await fetch(`${API}/propostas?${p}`, { headers: authH });
    const data = await res.json();
    setPropostas(data);
    setLoading(false);
  }

  async function abrirProposta(p) {
    setSelecionada(p);
    setItensSelecionados({});
    setLoadingItens(true);
    const res = await fetch(`${API}/propostas/${p.id}/itens`, { headers: authH });
    const data = await res.json();
    setItens(data);
    setLoadingItens(false);
  }

  function toggleItem(id) {
    setItensSelecionados(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function selecionarTodos() {
    const todos = {};
    itens.forEach(i => { todos[i.id] = true; });
    setItensSelecionados(todos);
  }

  function criarOC() {
    const selecionados = itens.filter(i => itensSelecionados[i.id]);
    if (!selecionados.length) return;
    onCriarOC(selecionada, selecionados);
  }

  useEffect(() => { buscar(); }, []);

  const qtdSelecionados = Object.values(itensSelecionados).filter(Boolean).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Propostas</h1>
          <p className="text-sm text-slate-500">Consulte e gerencie propostas geradas</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-2 gap-3 mb-3 sm:grid-cols-4">
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Nº proposta" value={filtros.numero}
            onChange={e => setFiltros(p => ({ ...p, numero: e.target.value }))} />
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="CNPJ ou cliente" value={filtros.cnpj}
            onChange={e => setFiltros(p => ({ ...p, cnpj: e.target.value }))} />
          <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filtros.data_inicio}
            onChange={e => setFiltros(p => ({ ...p, data_inicio: e.target.value }))} />
          <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filtros.data_fim}
            onChange={e => setFiltros(p => ({ ...p, data_fim: e.target.value }))} />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={filtros.todos}
              onChange={e => setFiltros(p => ({ ...p, todos: e.target.checked }))}
              className="rounded" />
            Ver propostas de toda a equipe
          </label>
          <button onClick={buscar} disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Lista de propostas */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">{propostas.length} propostas encontradas</span>
          </div>
          <div className="overflow-y-auto max-h-[500px]">
            {propostas.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">Nenhuma proposta encontrada</div>
            ) : propostas.map(p => (
              <div key={p.id} onClick={() => abrirProposta(p)}
                className={`px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-blue-50 transition-colors ${selecionada?.id === p.id ? "bg-blue-50 border-l-4 border-l-blue-500" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">#{p.numero_proposta}</span>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{p.total_itens} itens</span>
                    </div>
                    <div className="text-sm text-slate-600 truncate">{p.cliente}</div>
                    <div className="text-xs text-slate-400">{p.cnpj} · {fmtDate(p.data_geracao)}</div>
                    <div className="text-xs text-slate-400">{p.usuario_email}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-medium text-slate-800">R$ {fmt(p.valor_total_estimado)}</div>
                    <div className="text-xs text-emerald-600">{p.com_preco} com preço</div>
                    {p.sem_preco > 0 && <div className="text-xs text-amber-600">{p.sem_preco} sem preço</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detalhe da proposta */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {!selecionada ? (
            <div className="flex items-center justify-center h-full py-20 text-slate-400 text-sm">
              Selecione uma proposta para ver os itens
            </div>
          ) : (
            <>
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-slate-800">#{selecionada.numero_proposta} — {selecionada.cliente}</span>
                  <div className="text-xs text-slate-400">{selecionada.rc_neg}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={selecionarTodos} className="text-xs text-blue-600 hover:text-blue-800">Selecionar todos</button>
                  {qtdSelecionados > 0 && (
                    <button onClick={criarOC}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded-lg font-medium">
                      + OC com {qtdSelecionados} {qtdSelecionados === 1 ? "item" : "itens"}
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-y-auto max-h-[460px]">
                {loadingItens ? (
                  <div className="text-center py-8 text-slate-400 text-sm">Carregando itens...</div>
                ) : itens.map(item => (
                  <div key={item.id} onClick={() => toggleItem(item.id)}
                    className={`px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 flex items-start gap-3 ${itensSelecionados[item.id] ? "bg-blue-50" : ""}`}>
                    <input type="checkbox" checked={!!itensSelecionados[item.id]}
                      onChange={() => toggleItem(item.id)}
                      className="mt-1 rounded flex-shrink-0" onClick={e => e.stopPropagation()} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-800">{item.descricao_final}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {item.quantidade} {item.unidade} · R$ {fmt(item.preco_venda)}/un
                        {item.fornecedor && <span className="ml-2 text-blue-600">📦 {item.fornecedor}</span>}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-slate-700 flex-shrink-0">
                      R$ {fmt(item.preco_venda * item.quantidade)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
