import { useEffect, useState } from "react";
import { brl, btnGhost, IconX, IconSearch } from "./kist-ui.jsx";

// ── Conhecimento de pesquisa (v3.82) ─────────────────────────────────────────
// Ficha do item (Kist inteira), observações de mercado, equivalências que só o
// operador confirma, extrato de cada pesquisa e o boletim dos bots.

function _api(apiUrl, token, caminho, opts = {}) {
  return fetch(`${apiUrl}${caminho}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `erro ${r.status}`);
    return d;
  });
}

export function dataBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function textoFaixa(fx) {
  if (!fx || !fx.n) return "";
  return fx.min === fx.max ? `R$ ${brl(fx.min)}` : `R$ ${brl(fx.min)}–${brl(fx.max)}`;
}

// Selo na linha do item: "já pesquisado", faixa de preço e alertas.
export function ConhecimentoSelo({ conhecimento, onAbrir }) {
  if (!conhecimento) return null;
  const c = conhecimento;
  const fx = textoFaixa(c.faixa);
  const titulo = [
    `Já pesquisado pela Kist (${c.n_pesquisas || 1}×)${c.pn ? ` · PN ${c.pn}` : ""}`,
    fx ? `preço observado ${fx} (${c.faixa.n} ofertas, última ${c.faixa.ultima || "—"})` : "",
    ...(c.alertas || []),
  ].filter(Boolean).join("\n");
  return (
    <>
      <button onClick={onAbrir} title={titulo}
        className="rounded bg-kist/10 px-1.5 py-0.5 font-mono text-[10.5px] text-kist hover:bg-kist/20">
        📚 já pesquisado{fx ? ` · ${fx}` : ""}
      </button>
      {(c.alertas || []).slice(0, 2).map((a, i) => (
        <span key={i} title={a}
          className={`max-w-[260px] truncate rounded px-1.5 py-0.5 text-[10.5px] ${a.includes("NÃO serve") ? "bg-rose/10 text-rose" : "bg-amber/10 text-amber"}`}>
          ⚠ {a}
        </span>
      ))}
    </>
  );
}

function Modal({ titulo, onClose, children }) {
  useEffect(() => {
    const f = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-6" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[15px] font-semibold text-ink">{titulo}</div>
          <button onClick={onClose} className="text-faint hover:text-ink"><IconX size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ListaPassos({ passos, itemUid }) {
  const lista = (passos || []).filter((p) => !itemUid || !p.item_id || p.item_id === String(itemUid).toLowerCase());
  if (!lista.length) return <div className="text-[12px] text-faint">Sem passos registrados.</div>;
  return (
    <ol className="space-y-1.5">
      {lista.map((p, i) => (
        <li key={i} className="rounded-md bg-paper px-2.5 py-1.5 text-[12px]">
          <div className="flex justify-between gap-2">
            <span className="font-medium text-ink">{i + 1}. {p.etapa || "passo"}{p.fonte ? ` · ${p.fonte}` : ""}</span>
            {p.ms ? <span className="font-mono text-[10.5px] text-faint">{(p.ms / 1000).toFixed(1)} s</span> : null}
          </div>
          {p.consulta && <div className="text-sub">consulta: <span className="font-mono">{p.consulta}</span></div>}
          {p.resultado && <div className="text-sub">resultado: {p.resultado}</div>}
          {p.decisao && <div className="text-ink">→ {p.decisao}</div>}
        </li>
      ))}
    </ol>
  );
}

function BlocoExtrato({ ext, itemUid }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-faint">
        {ext.motor === "kistbot" ? "KistBot Dwight" : "Dwight"} · {dataBR(ext.criado_em)}
      </div>
      {ext.resumo && <p className="whitespace-pre-line text-[13px] text-ink">{ext.resumo}</p>}
      <ListaPassos passos={ext.passos} itemUid={itemUid} />
      {(ext.limitacoes || []).length > 0 && (
        <div className="text-[12px] text-amber"><b>O que faltou:</b> {ext.limitacoes.join(" · ")}</div>
      )}
      {(ext.saude || []).length > 0 && (
        <div className="text-[12px] text-rose"><b>Saúde do bot:</b> {ext.saude.join(" · ")}</div>
      )}
      {(ext.sugestoes || []).length > 0 && (
        <div className="text-[12px] text-sub"><b>Sugestões do bot:</b> {ext.sugestoes.join(" · ")}</div>
      )}
    </div>
  );
}

// Extrato de UMA pesquisa (no card do item: só os passos daquele item).
export function ExtratoModal({ token, apiUrl, extratoId, itemUid, onClose }) {
  const [ext, setExt] = useState(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    _api(apiUrl, token, `/pesquisa/extratos/${extratoId}`).then(setExt).catch((e) => setErro(e.message));
  }, [extratoId]);
  return (
    <Modal titulo="Extrato da pesquisa" onClose={onClose}>
      {erro ? <div className="text-[12px] text-rose">{erro}</div>
        : !ext ? <div className="text-[12px] text-faint">Carregando…</div>
        : <BlocoExtrato ext={ext} itemUid={itemUid} />}
    </Modal>
  );
}

// Extrato da proposta: pontos a validar + julgamento de cada item + extratos.
export function ExtratosPropostaModal({ token, apiUrl, numero, onClose }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    _api(apiUrl, token, `/propostas/${encodeURIComponent(numero)}/extratos`).then(setD).catch((e) => setErro(e.message));
  }, [numero]);
  return (
    <Modal titulo={`Extrato da pesquisa · ${numero}`} onClose={onClose}>
      {erro ? <div className="text-[12px] text-rose">{erro}</div> : !d ? <div className="text-[12px] text-faint">Carregando…</div> : (
        <div className="space-y-5">
          {(d.pontos_a_validar || []).length > 0 && (
            <div className="rounded-lg border border-amber/40 bg-amber/10 p-3">
              <div className="mb-1 text-[12px] font-semibold text-amber">Validar com o cliente antes de enviar</div>
              {d.pontos_a_validar.map((p, i) => (
                <div key={i} className="text-[12px] text-ink">• <span className="text-sub">{p.item}:</span> {p.ponto}</div>
              ))}
            </div>
          )}
          <div>
            <div className="eyebrow mb-2 text-[10px] font-bold uppercase text-faint">Julgamento por item</div>
            {(d.julgamentos || []).length === 0 && <div className="text-[12px] text-faint">Nenhuma pesquisa concluída.</div>}
            {(d.julgamentos || []).map((j, i) => {
              const of = (j.resultado?.ofertas || [])[j.resultado?.escolha || 0];
              return (
                <div key={i} className="mb-2 rounded-md bg-paper px-3 py-2 text-[12px]">
                  <div className="font-medium text-ink">{j.descricao}</div>
                  <div className="text-sub">
                    {of ? `${of.loja || "—"}${of.preco_pix || of.preco_cheio ? ` · R$ ${brl(of.preco_pix || of.preco_cheio)}` : ""}` : "—"}
                    {j.julgamento?.motivo ? ` — ${j.julgamento.motivo}` : ""}
                  </div>
                  {j.resultado?.resumo_mercado && <div className="text-faint">mercado: {j.resultado.resumo_mercado}</div>}
                  {(j.julgamento?.riscos || []).map((r, k) => <div key={k} className="text-rose">⚠ {r}</div>)}
                </div>
              );
            })}
          </div>
          <div>
            <div className="eyebrow mb-2 text-[10px] font-bold uppercase text-faint">Processo ({(d.extratos || []).length} pesquisa{(d.extratos || []).length === 1 ? "" : "s"})</div>
            {(d.extratos || []).length === 0 && <div className="text-[12px] text-faint">O bot ainda não mandou extrato.</div>}
            {(d.extratos || []).map((e) => (
              <div key={e.id} className="mb-4 border-l-2 border-line pl-3"><BlocoExtrato ext={e} /></div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

const ROTULO_VEREDITO = { acertou: "acertou", escolheu_outra: "escolheu outra", nao_achou: "não achou", custo_divergente: "custo divergente", sem_oferta: "sem oferta" };

function Boletim({ token, apiUrl }) {
  const [b, setB] = useState(null);
  useEffect(() => { _api(apiUrl, token, "/pesquisa/boletim?dias=30").then(setB).catch(() => setB({ vereditos: [] })); }, []);
  if (!b) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="eyebrow mb-2 text-[10px] font-bold uppercase text-faint">Boletim dos bots · 30 dias</div>
      {(b.vereditos || []).length === 0 ? (
        <div className="text-[12px] text-faint">Sem vereditos ainda — eles nascem quando uma proposta pesquisada é exportada ou vira compra.</div>
      ) : (
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-faint">
            <th className="py-1">Bot</th><th>Momento</th><th className="text-right">Total</th>
            {Object.values(ROTULO_VEREDITO).map((r) => <th key={r} className="text-right">{r}</th>)}
            <th className="text-right">Acerto</th>
          </tr></thead>
          <tbody>
            {b.vereditos.map((v, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{v.motor === "kistbot" ? "KistBot" : "Dwight"}</td>
                <td>{v.momento === "compra" ? "compra" : "proposta"}</td>
                <td className="text-right font-mono">{v.total}</td>
                {Object.keys(ROTULO_VEREDITO).map((k) => <td key={k} className="text-right font-mono">{v[k]}</td>)}
                <td className="text-right font-mono font-semibold">{v.taxa_acerto != null ? `${v.taxa_acerto}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(b.saude_mais_citada || []).length > 0 && (
        <div className="mt-2 text-[11.5px] text-sub">
          <b>Problemas mais citados:</b> {b.saude_mais_citada.slice(0, 4).map((s) => `${s.problema} (${s.vezes}×)`).join(" · ")}
        </div>
      )}
    </div>
  );
}

function Ficha({ token, apiUrl, id, onVoltar }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [extrato, setExtrato] = useState(null);
  const carregar = () => _api(apiUrl, token, `/catalogo/itens/${id}`).then(setD).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, [id]);
  async function decidir(eid, status) {
    try { await _api(apiUrl, token, `/catalogo/equivalencias/${eid}`, { method: "POST", body: JSON.stringify({ status }) }); carregar(); }
    catch (e) { setErro(e.message); }
  }
  if (erro) return <div className="text-[12px] text-rose">{erro}</div>;
  if (!d) return <div className="text-[12px] text-faint">Carregando…</div>;
  const f = d.ficha;
  return (
    <div className="space-y-4">
      <button onClick={onVoltar} className="text-[12px] text-kist hover:underline">← voltar</button>
      <div>
        <div className="font-mono text-[18px] font-semibold text-ink">{f.pn || "sem PN"}</div>
        <div className="text-[13px] text-sub">{f.descricao_ref}</div>
        <div className="mt-1 text-[11.5px] text-faint">
          {f.fabricante || "fabricante —"} · {f.n_pesquisas} pesquisa(s) · atualizada {dataBR(f.atualizado_em)}
        </div>
        {(f.specs || []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {f.specs.map((s, i) => <span key={i} className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink">{s}</span>)}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line p-3">
        <div className="eyebrow mb-2 text-[10px] font-bold uppercase text-faint">Equivalências e incompatibilidades</div>
        {d.equivalencias.length === 0 && <div className="text-[12px] text-faint">Nenhuma registrada.</div>}
        {d.equivalencias.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-[12px] first:border-0">
            <div>
              <span className={`font-medium ${e.relacao === "incompativel" ? "text-rose" : "text-ink"}`}>
                {e.relacao === "incompativel" ? "NÃO serve" : e.relacao === "equivalente" ? "equivale" : "a validar"}: {e.pn_outro}
              </span>
              {e.motivo && <span className="text-sub"> — {e.motivo}</span>}
              <div className="text-[10.5px] text-faint">fonte: {e.fonte || "—"} · {e.status}{e.decidido_por ? ` por ${e.decidido_por}` : ""}</div>
            </div>
            {e.status === "sugerida" && (
              <div className="flex gap-1">
                <button onClick={() => decidir(e.id, "confirmada")} className={`${btnGhost} px-2 py-1 text-[11px]`}>confirmar</button>
                <button onClick={() => decidir(e.id, "rejeitada")} className={`${btnGhost} px-2 py-1 text-[11px]`}>rejeitar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line p-3">
        <div className="eyebrow mb-2 text-[10px] font-bold uppercase text-faint">
          Mercado observado {d.faixa ? `· ${textoFaixa(d.faixa)} · mediana R$ ${brl(d.faixa.mediana)}` : ""}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-faint"><th className="py-1">Data</th><th>Loja</th><th>País</th><th className="text-right">Preço</th><th>Estoque</th><th></th></tr></thead>
            <tbody>
              {d.observacoes.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="py-1">{dataBR(o.observado_em)}</td>
                  <td>{o.link ? <a href={o.link} target="_blank" rel="noreferrer" className="text-kist hover:underline">{o.loja || "link"}</a> : o.loja}
                    {o.escolhida && <span className="ml-1 text-[10px] text-signal">escolhida</span>}</td>
                  <td>{o.pais || "—"}</td>
                  <td className="text-right font-mono">{o.preco ? `${o.moeda && o.moeda !== "BRL" ? o.moeda + " " : "R$ "}${brl(o.preco)}` : "—"}</td>
                  <td>{o.estoque || "—"}</td>
                  <td>{o.extrato_id && <button onClick={() => setExtrato(o.extrato_id)} className="text-[11px] text-kist hover:underline">extrato</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {d.propostas.length > 0 && (
        <div className="text-[12px] text-sub">
          <b>Apareceu em:</b> {d.propostas.map((p) => `${p.numero} (${p.cliente || "—"})`).join(" · ")}
        </div>
      )}
      {extrato && <ExtratoModal token={token} apiUrl={apiUrl} extratoId={extrato} onClose={() => setExtrato(null)} />}
    </div>
  );
}

export default function Catalogo({ token, apiUrl, fichaInicial = null }) {
  const [q, setQ] = useState("");
  const [itens, setItens] = useState([]);
  const [aberta, setAberta] = useState(fichaInicial);
  const [erro, setErro] = useState("");
  const buscar = (termo) =>
    _api(apiUrl, token, `/catalogo/itens?q=${encodeURIComponent(termo || "")}`)
      .then((d) => { setItens(d.itens || []); setErro(""); }).catch((e) => setErro(e.message));
  useEffect(() => { buscar(""); }, []);
  useEffect(() => { if (fichaInicial) setAberta(fichaInicial); }, [fichaInicial]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-9">
      <div>
        <div className="eyebrow text-[10px] font-bold uppercase text-faint">Conhecimento da Kist</div>
        <h1 className="text-[22px] font-semibold text-ink">Catálogo de pesquisas</h1>
        <p className="text-[12.5px] text-sub">Tudo o que os bots e os operadores já pesquisaram, de todos os clientes: identidade do item, equivalências, preços vistos e o processo de cada pesquisa.</p>
      </div>
      {aberta ? (
        <Ficha token={token} apiUrl={apiUrl} id={aberta} onVoltar={() => setAberta(null)} />
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-line2 bg-surface px-3">
              <IconSearch size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") buscar(q); }}
                placeholder="PN ou descrição (ex.: 0W6YC4, bateria Dell)"
                className="w-full bg-transparent py-2 text-[13px] text-ink outline-none" />
            </div>
            <button onClick={() => buscar(q)} className={btnGhost}>Buscar</button>
          </div>
          {erro && <div className="text-[12px] text-rose">{erro}</div>}
          <div className="rounded-xl border border-line bg-surface">
            {itens.length === 0 && <div className="p-4 text-[12px] text-faint">Nada encontrado.</div>}
            {itens.map((f) => (
              <button key={f.id} onClick={() => setAberta(f.id)}
                className="flex w-full items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-left first:border-0 hover:bg-paper">
                <div>
                  <div className="font-mono text-[13px] text-ink">{f.pn || "—"}</div>
                  <div className="text-[12px] text-sub">{f.descricao_ref}</div>
                </div>
                <div className="text-right text-[11px] text-faint">{f.n_pesquisas} pesquisa(s)<br />{dataBR(f.atualizado_em)}</div>
              </button>
            ))}
          </div>
          <Boletim token={token} apiUrl={apiUrl} />
        </>
      )}
    </div>
  );
}
