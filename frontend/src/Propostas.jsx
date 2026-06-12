import { useState, useEffect, useCallback, Fragment } from "react";
import {
  brl, btnPrimary, btnGhost, Eyebrow, PageHeader, StateLabel,
  IconSearch, IconArrow, IconCheck, IconX, IconBolt,
} from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

/* ── Modal de aprovação — captura a PO do cliente ─────────────────────────── */
function ApprovalModal({ proposta, itens, onClose, onConfirm }) {
  const [po, setPo] = useState("");
  const totalSel = itens.reduce((s, i) => s + (i.preco_venda || 0) * (i.quantidade || 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} />
      <div className="slide-in relative w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <Eyebrow>Aprovação · proposta → ordem de compra</Eyebrow>
        <h3 className="mt-1.5 text-[18px] font-semibold tracking-tight text-ink">
          Aprovar proposta {proposta.numero_proposta}
        </h3>
        <p className="mt-1 text-[13px] text-sub">
          {proposta.cliente} aprovou. Informe o número da <strong>PO</strong> emitida pelo cliente — é a
          referência que ele vai usar pra falar com vocês daqui pra frente.
        </p>

        <div className="mt-4 flex items-center justify-between rounded-lg bg-paper px-3 py-2 text-[12.5px]">
          <span className="text-sub">{itens.length} {itens.length === 1 ? "item selecionado" : "itens selecionados"}</span>
          <span className="font-mono font-medium text-ink">R$ {brl(totalSel)}</span>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-[12.5px] font-medium text-ink">Nº da PO do cliente</label>
          <input value={po} onChange={(e) => setPo(e.target.value)} autoFocus
            className="w-full rounded-lg border border-line2 bg-paper px-3 py-2.5 font-mono text-[13.5px] text-ink cell-input"
            placeholder="ex: PO-2026-0820 · OC 4471 · 4500219887" />
          <p className="mt-1.5 text-[11.5px] text-faint">
            Qualquer nomenclatura (PO, OC, nº SAP). Pode deixar vazio e vincular depois, no painel da OC.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancelar</button>
          <button onClick={() => onConfirm(po.trim() || null)} className={btnPrimary}>
            Criar OC <IconArrow size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Propostas({ token, usuario, onCriarOC }) {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [equipeToda, setEquipeToda] = useState(false);

  const [expandida, setExpandida] = useState(null);     // proposta_id aberta
  const [itensProp, setItensProp] = useState({});       // { [proposta_id]: itens[] }
  const [loadingItens, setLoadingItens] = useState(false);
  const [selecionados, setSelecionados] = useState({}); // { [item_id]: true }
  const [aprovando, setAprovando] = useState(null);

  const carregar = useCallback(() => {
    setLoading(true); setErro("");
    const params = new URLSearchParams();
    if (busca.trim()) params.set("busca", busca.trim());
    if (dataInicio) params.set("data_inicio", dataInicio);
    if (dataFim) params.set("data_fim", dataFim);
    if (equipeToda) params.set("todos", "true");
    else if (usuario?.email) params.set("usuario_email", usuario.email);
    fetch(`${API}/propostas?${params.toString()}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setLista(Array.isArray(d) ? d : d.propostas || []))
      .catch(() => setErro("Não foi possível carregar as propostas."))
      .finally(() => setLoading(false));
  }, [busca, dataInicio, dataFim, equipeToda, usuario, token]);

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [equipeToda]);

  async function abrir(prop) {
    const id = prop.id ?? prop.numero_proposta;
    if (expandida === id) { setExpandida(null); return; }
    setExpandida(id); setSelecionados({});
    if (!itensProp[id]) {
      setLoadingItens(true);
      try {
        const res = await fetch(`${API}/propostas/${id}/itens`, { headers: authHeaders() });
        const data = await res.json();
        setItensProp((prev) => ({ ...prev, [id]: Array.isArray(data) ? data : data.itens || [] }));
      } catch (e) { setItensProp((prev) => ({ ...prev, [id]: [] })); }
      finally { setLoadingItens(false); }
    }
  }

  function toggleItem(itemId) {
    setSelecionados((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  const itensAbertos = expandida != null ? (itensProp[expandida] || []) : [];
  const idsSelecionados = Object.keys(selecionados).filter((k) => selecionados[k]);
  const itensSelecionados = itensAbertos.filter((i) => selecionados[i.id]);
  const propAberta = lista.find((p) => (p.id ?? p.numero_proposta) === expandida);

  return (
    <div className="mx-auto max-w-5xl px-8 py-9 rise">
      <PageHeader eyebrow="Histórico" title="Propostas"
        sub="Tudo que sua equipe gerou. Abra uma proposta, selecione itens e aprove para virar OC."
        actions={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub">
            <input type="checkbox" checked={equipeToda} onChange={(e) => setEquipeToda(e.target.checked)} className="accent-kist" />
            Ver equipe toda
          </label>
        } />

      {/* Filtros */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-line2 bg-surface px-3 py-2 text-[13px] text-faint">
          <IconSearch size={15} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.key === "Enter" && carregar()}
            className="w-64 bg-transparent text-ink outline-none placeholder:text-faint"
            placeholder="número, cliente, CNPJ ou item (ex: MC200L)" />
        </div>
        <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          className="rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub outline-none" />
        <span className="text-faint">→</span>
        <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          className="rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub outline-none" />
        <button onClick={carregar} className={btnGhost}>Filtrar</button>
      </div>

      {erro && <div className="mt-4 rounded-lg border border-rose/30 bg-rosebg px-4 py-3 text-[13px] text-rose">{erro}</div>}

      <div className="mt-5 overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-paper/70">
              {["Proposta", "Cliente", "Itens", "Valor", "Data", "Resp.", ""].map((h, i) => (
                <th key={i} className={`px-4 py-2.5 text-[10.5px] font-semibold uppercase eyebrow text-faint ${i === 2 || i === 3 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-faint">Carregando…</td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-faint">Nenhuma proposta encontrada.</td></tr>
            ) : lista.map((p) => {
              const id = p.id ?? p.numero_proposta;
              const aberta = expandida === id;
              return (
                <Fragment key={id}>
                  <tr onClick={() => abrir(p)}
                    className={`group cursor-pointer border-b border-line/70 transition-colors ${aberta ? "bg-kist/[0.03]" : "hover:bg-paper/60"}`}>
                    <td className="px-4 py-3 font-mono text-[13px] font-medium text-kist">{p.numero_proposta}</td>
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-medium text-ink">{p.cliente}</div>
                      {p.cnpj && <div className="font-mono text-[11px] text-faint">{p.cnpj}</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-sub">{p.total_itens}</td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] font-medium text-ink">R$ {brl(p.valor_total_estimado)}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-sub">{(p.data_geracao || "").slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-paper text-[11px] font-semibold text-sub" title={p.usuario_nome}>
                        {(p.usuario_nome || "?").charAt(0).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[12px] text-faint">{aberta ? "fechar" : "abrir"}</td>
                  </tr>

                  {aberta && (
                    <tr className="border-b border-line/70 bg-paper/40">
                      <td colSpan={7} className="px-4 py-3">
                        {loadingItens && !itensProp[id] ? (
                          <div className="py-4 text-center text-[12.5px] text-faint">Carregando itens…</div>
                        ) : (
                          <div className="space-y-1">
                            {(itensProp[id] || []).length > 0 && (() => {
                              const lst = itensProp[id] || [];
                              const todos = lst.every((it) => selecionados[it.id]);
                              return (
                                <label className="flex cursor-pointer items-center gap-3 rounded-lg border-b border-line/50 px-2 py-1.5 hover:bg-surface">
                                  <input type="checkbox" checked={todos}
                                    onChange={() => setSelecionados((prev) => {
                                      const novo = { ...prev };
                                      lst.forEach((it) => { novo[it.id] = !todos; });
                                      return novo;
                                    })}
                                    className="accent-kist" />
                                  <span className="flex-1 text-[12px] font-medium text-sub">{todos ? "Desmarcar todos" : "Selecionar todos"}</span>
                                  <span className="text-[11px] text-faint">{lst.length} {lst.length === 1 ? "item" : "itens"}</span>
                                </label>
                              );
                            })()}
                            {(itensProp[id] || []).map((it) => (
                              <label key={it.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface">
                                <input type="checkbox" checked={!!selecionados[it.id]} onChange={() => toggleItem(it.id)} className="accent-kist" />
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{it.descricao_final || it.descricao_original}</span>
                                {it.confianca_match && <StateLabel conf={it.confianca_match} />}
                                <span className="font-mono text-[12px] text-sub">{it.quantidade} {it.unidade}</span>
                                <span className="w-24 text-right font-mono text-[12px] text-ink">R$ {brl(it.preco_venda)}</span>
                              </label>
                            ))}
                            {(itensProp[id] || []).length === 0 && (
                              <div className="py-3 text-center text-[12px] text-faint">Sem itens nesta proposta.</div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Barra de ação flutuante quando há itens selecionados */}
      {idsSelecionados.length > 0 && propAberta && (
        <div className="sticky bottom-6 mt-4 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_8px_30px_rgba(11,31,58,0.12)]">
          <div className="text-[13px] text-sub">
            <span className="font-medium text-ink">{idsSelecionados.length}</span> {idsSelecionados.length === 1 ? "item" : "itens"} de{" "}
            <span className="font-mono text-ink">{propAberta.numero_proposta}</span> · {propAberta.cliente}
          </div>
          <button onClick={() => setAprovando(propAberta)} className={btnPrimary}>
            <IconCheck size={15} /> Aprovar → criar OC
          </button>
        </div>
      )}

      {aprovando && (
        <ApprovalModal proposta={aprovando} itens={itensSelecionados}
          onClose={() => setAprovando(null)}
          onConfirm={(po) => {
            onCriarOC(aprovando, itensSelecionados, po);
            setAprovando(null);
          }} />
      )}
    </div>
  );
}
