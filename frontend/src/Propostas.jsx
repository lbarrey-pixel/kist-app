import { useState, useEffect, useCallback, Fragment } from "react";
import ReceberPO from "./ReceberPO.jsx";
import {
  brl, btnPrimary, btnGhost, Eyebrow, PageHeader, StateLabel,
  IconSearch, IconArrow, IconCheck, IconX, IconBolt, IconTrash,
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

export default function Propostas({ token, usuario, onCriarOC, onAbrirProposta }) {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const [mostrarPO, setMostrarPO] = useState(false);

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [equipeToda, setEquipeToda] = useState(false);
  // v3.98 — propostas que o monitor de e-mail criou sozinho (criado_via
  // 'email_auto') ficam em rascunho esperando o operador revisar antes de
  // exportar pro Tiny. Filtro só some da lista, não muda nada no backend.
  const [soRevisao, setSoRevisao] = useState(false);

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

  async function excluir(p, e) {
    e.stopPropagation();
    const id = p.id ?? p.numero_proposta;
    if (!window.confirm(`Excluir a proposta ${p.numero_proposta} (${p.cliente})?\nEsta ação não pode ser desfeita.`)) return;
    try {
      const r = await fetch(`${API}/propostas/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) throw new Error();
      setLista((prev) => prev.filter((x) => (x.id ?? x.numero_proposta) !== id));
      if (expandida === id) setExpandida(null);
    } catch {
      alert("Não foi possível excluir a proposta.");
    }
  }

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
  const pendentesRevisao = lista.filter((p) => p.criado_via === "email_auto" && p.status === "rascunho");
  const listaExibida = soRevisao ? pendentesRevisao : lista;
  const propAberta = listaExibida.find((p) => (p.id ?? p.numero_proposta) === expandida);

  return (
    <div className="mx-auto max-w-6xl px-8 py-9 rise">
      <PageHeader eyebrow="Histórico" title="Propostas"
        sub="Tudo que sua equipe gerou. Abra uma proposta, selecione itens e aprove para virar OC."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setMostrarPO(true)} className={btnPrimary}>
              <IconBolt size={15} /> Receber PO
            </button>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub">
              <input type="checkbox" checked={equipeToda} onChange={(e) => setEquipeToda(e.target.checked)} className="accent-kist" />
              Ver equipe toda
            </label>
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] transition-colors ${
              soRevisao ? "border-kist/40 bg-kist/[0.06] text-kist" : "border-line2 bg-surface text-sub"}`}>
              <input type="checkbox" checked={soRevisao} onChange={(e) => setSoRevisao(e.target.checked)} className="accent-kist" />
              Só pra revisar
              {pendentesRevisao.length > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-kist px-1.5 text-[10.5px] font-semibold text-white">
                  {pendentesRevisao.length}
                </span>
              )}
            </label>
          </div>
        } />

      {mostrarPO && (
        <ReceberPO token={token} usuario={usuario} onCriarOC={onCriarOC} onClose={() => setMostrarPO(false)} />
      )}

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
              {/* v3.85 — número/valor/data não quebram linha; status mora com o número;
                  ações compactas (Abrir · lixeira · seta) numa coluna de largura fixa. */}
              {["Proposta", "Cliente", "Itens", "Valor", "Data", "Resp.", ""].map((h, i) => (
                <th key={i} className={`whitespace-nowrap px-4 py-2.5 text-[10.5px] font-semibold uppercase eyebrow text-faint ${i === 2 || i === 3 ? "text-right" : i === 5 ? "text-center" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-faint">Carregando…</td></tr>
            ) : listaExibida.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-faint">
                {soRevisao ? "Nada esperando revisão." : "Nenhuma proposta encontrada."}
              </td></tr>
            ) : listaExibida.map((p) => {
              const id = p.id ?? p.numero_proposta;
              const aberta = expandida === id;
              return (
                <Fragment key={id}>
                  <tr onClick={() => abrir(p)}
                    className={`group cursor-pointer border-b border-line/70 transition-colors ${aberta ? "bg-kist/[0.03]" : "hover:bg-paper/60"}`}>
                    <td className="w-px whitespace-nowrap px-4 py-3">
                      <div className="font-mono text-[13px] font-medium text-kist">{p.numero_proposta}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {p.status === "rascunho" && (
                          <span className="inline-block rounded-md bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber">
                            Rascunho
                          </span>
                        )}
                        {p.criado_via === "email_auto" && (
                          <span title="Criada sozinha a partir de e-mail de cotação — confira antes de exportar pro Tiny"
                            className="inline-block rounded-md bg-kist/10 px-1.5 py-0.5 text-[10px] font-semibold text-kist">
                            ✉ Revisar
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="w-full max-w-0 px-4 py-3">
                      <div className="truncate text-[13px] font-medium text-ink" title={p.cliente}>{p.cliente}</div>
                      {p.cnpj && <div className="truncate font-mono text-[11px] text-faint">{p.cnpj}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[13px] text-sub">{p.total_itens}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[13px] font-medium text-ink">R$ {brl(p.valor_total_estimado)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-sub">
                      {(p.data_geracao || "").slice(0, 10).split("-").reverse().join("/")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-paper text-[11px] font-semibold text-sub" title={p.usuario_nome}>
                        {(p.usuario_nome || "?").charAt(0).toUpperCase()}
                      </span>
                    </td>
                    <td className="w-px whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {onAbrirProposta && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onAbrirProposta(p.id ?? p.numero_proposta); }}
                            title="Abrir a proposta para editar"
                            className="rounded-md border border-line2 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-sub hover:border-kist/40 hover:text-kist">
                            Abrir
                          </button>
                        )}
                        <button
                          onClick={(e) => excluir(p, e)}
                          title="Excluir proposta"
                          className="rounded-md p-1.5 text-faint/70 hover:bg-rosebg hover:text-rose">
                          <IconTrash size={14} />
                        </button>
                        <span title={aberta ? "Fechar itens" : "Ver itens"}
                          className={`inline-flex h-6 w-6 items-center justify-center text-faint transition-transform group-hover:text-sub ${aberta ? "rotate-90" : ""}`}>
                          <IconArrow size={13} />
                        </span>
                      </div>
                    </td>
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
