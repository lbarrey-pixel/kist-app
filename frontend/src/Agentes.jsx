// ──────────────────────────────────────────────────────────────────────────
// Agentes.jsx — painel de governança dos agentes autônomos (v3.40)
//
// O PROPÓSITO decide o layout: esta tela não existe para admirar quantos bots
// temos. Existe para responder, em cinco segundos e no celular, "há algo que
// eu precise olhar agora?". Por isso o topo mostra RISCO, não contagem, e a
// lista vem ordenada por risco em vez de alfabética — o que exige atenção
// aparece primeiro, sempre.
//
// Uma chamada só (RPC agentes_painel) monta tudo. Tela que faz uma requisição
// por agente não é aberta no celular, e é no celular que ela é útil.
// ──────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo } from "react";
import {
  PageHeader, Eyebrow, btnGhost,
  IconSearch, IconX,
} from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "https://kist-backend.onrender.com";

// ── Regras de risco ───────────────────────────────────────────────────────
// Explícitas e num lugar só: o que conta como problema é decisão de negócio,
// não detalhe espalhado pelo JSX.
const CALADO_H = 24;

function riscos(a) {
  const out = [];
  const h = horas(a.silencio);
  if (a.tarefas_sem_aprovacao > 0)
    out.push({ k: "sem_ok", peso: 3 + a.tarefas_sem_aprovacao,
      txt: `${a.tarefas_sem_aprovacao} ${a.tarefas_sem_aprovacao === 1 ? "tarefa grava" : "tarefas gravam"} sem aprovação` });
  if (!a.leu_contexto)
    out.push({ k: "sem_ctx", peso: 6, txt: "nunca leu o contexto" });
  if (a.erros > 0)
    out.push({ k: "erro", peso: 8 + Number(a.erros), txt: `${a.erros} ${a.erros === 1 ? "erro" : "erros"}` });
  if (a.pendentes > 0)
    out.push({ k: "pend", peso: 10, txt: `${a.pendentes} aguardando aprovação` });
  if (h !== null && h >= CALADO_H)
    out.push({ k: "calado", peso: 5, txt: `calado há ${fmtDur(a.silencio)}` });
  if (a.acessos_sensiveis > 3)
    out.push({ k: "sens", peso: 2, txt: `${a.acessos_sensiveis} acessos sensíveis` });
  return out;
}

const TOM = {
  pend:    "bg-kist/10 text-kist",
  erro:    "bg-rose/10 text-rose",
  sem_ctx: "bg-amber/10 text-amber",
  calado:  "bg-amber/10 text-amber",
  sem_ok:  "bg-amber/10 text-amber",
  sens:    "bg-sub/10 text-sub",
};

// ── Helpers de duração (o backend manda interval do Postgres) ─────────────
function horas(intervalo) {
  if (!intervalo) return null;
  const s = String(intervalo);
  const dias = /(\d+)\s*day/.exec(s);
  const hms = /(\d+):(\d+):/.exec(s);
  let h = dias ? Number(dias[1]) * 24 : 0;
  if (hms) h += Number(hms[1]);
  return h;
}
function fmtDur(intervalo) {
  const h = horas(intervalo);
  if (h === null) return "—";
  if (h < 1) {
    const m = /(\d+):(\d+):/.exec(String(intervalo));
    return m ? `${Number(m[2])} min` : "agora";
  }
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)} dias`;
}
const primeiroNome = (email) => (email || "?").split("@")[0];

export default function Agentes({ token, usuario, isAdmin }) {
  const [aba, setAba] = useState("painel");
  const [dias, setDias] = useState(7);
  const [linhas, setLinhas] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [ficha, setFicha] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [soRisco, setSoRisco] = useState(false);

  const cab = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const q = `dias=${dias}${isAdmin ? "&todos=1" : ""}`;
      const r = await fetch(`${API}/agentes/painel?${q}`, { headers: cab });
      if (!r.ok) throw new Error(`painel ${r.status}`);
      const d = await r.json();
      setLinhas(d.agentes || []);
    } catch (e) {
      setErro(String(e.message || e));
    } finally {
      setCarregando(false);
    }
  }

  async function carregarEventos() {
    try {
      const r = await fetch(`${API}/agentes/eventos?limite=150${isAdmin ? "&todos=1" : ""}`, { headers: cab });
      if (r.ok) setEventos((await r.json()).eventos || []);
    } catch { /* silencioso: a lista principal continua útil sem isso */ }
  }

  async function abrirFicha(slug) {
    setFicha({ slug, carregando: true });
    try {
      const r = await fetch(`${API}/agentes/${encodeURIComponent(slug)}`, { headers: cab });
      if (!r.ok) throw new Error(`ficha ${r.status}`);
      setFicha({ slug, carregando: false, ...(await r.json()) });
    } catch (e) {
      setFicha({ slug, carregando: false, erro: String(e.message || e) });
    }
  }

  useEffect(() => { carregar(); }, [dias]);
  useEffect(() => { if (aba === "eventos") carregarEventos(); }, [aba]);

  // Ordenação por risco: o que precisa de atenção sobe. Alfabética seria
  // arrumada e inútil — ninguém rola uma lista atrás de problema.
  const ordenadas = useMemo(() => {
    const comRisco = linhas.map((a) => {
      const rs = riscos(a);
      return { ...a, _riscos: rs, _peso: rs.reduce((s, r) => s + r.peso, 0) };
    });
    const t = busca.trim().toLowerCase();
    return comRisco
      .filter((a) => !soRisco || a._riscos.length > 0)
      .filter((a) => !t || [a.slug, a.nome, a.papel, a.dono_email, a.agente_pai]
        .some((c) => (c || "").toLowerCase().includes(t)))
      .sort((a, b) => b._peso - a._peso || a.slug.localeCompare(b.slug));
  }, [linhas, busca, soRisco]);

  const resumo = useMemo(() => {
    const r = { total: linhas.length, semOk: 0, semCtx: 0, calados: 0, erros: 0, pend: 0, donos: new Set(), custo: 0 };
    for (const a of linhas) {
      r.semOk += a.tarefas_sem_aprovacao || 0;
      if (!a.leu_contexto) r.semCtx++;
      const h = horas(a.silencio);
      if (h !== null && h >= CALADO_H) r.calados++;
      r.erros += Number(a.erros || 0);
      r.pend += Number(a.pendentes || 0);
      r.donos.add(a.dono_email);
      r.custo += Number(a.custo_medido || 0);
    }
    return r;
  }, [linhas]);

  const porDono = useMemo(() => {
    const m = new Map();
    for (const a of ordenadas) {
      if (!m.has(a.dono_email)) m.set(a.dono_email, []);
      m.get(a.dono_email).push(a);
    }
    return [...m.entries()];
  }, [ordenadas]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-9">
      <PageHeader
        eyebrow="Governança"
        title="Agentes"
        sub="Quem opera sobre a Kist, com que alcance e o que fez."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
              className="rounded-lg border border-line2 bg-surface px-2.5 py-2 text-[13px] text-sub">
              <option value={1}>24 horas</option>
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
            </select>
            <button onClick={() => { carregar(); if (aba === "eventos") carregarEventos(); }}
              className={btnGhost}>Atualizar</button>
          </div>
        }
      />

      {/* ── O que exige atenção. Cartão zerado fica apagado, não some: a
             ausência de problema é informação, e layout que dança a cada
             carregamento cansa mais do que informa. ── */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Cartao n={resumo.pend}    rot="aguardando você" tom={resumo.pend ? "kist" : null} />
        <Cartao n={resumo.erros}   rot="erros"           tom={resumo.erros ? "rose" : null} />
        <Cartao n={resumo.semCtx}  rot="sem ler contexto" tom={resumo.semCtx ? "amber" : null} />
        <Cartao n={resumo.calados} rot={`calados +${CALADO_H}h`} tom={resumo.calados ? "amber" : null} />
        <Cartao n={resumo.semOk}   rot="gravam sem aprovação" tom={resumo.semOk ? "amber" : null} />
        <Cartao n={resumo.total}   rot={`agentes · ${resumo.donos.size} ${resumo.donos.size === 1 ? "dono" : "donos"}`} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-line2 bg-surface px-3 py-2">
          <IconSearch size={15} className="text-faint" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="agente, dono, papel…"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint" />
          {busca && <button onClick={() => setBusca("")} className="text-faint hover:text-ink"><IconX size={14} /></button>}
        </div>
        <button onClick={() => setSoRisco(!soRisco)}
          className={soRisco
            ? "rounded-lg bg-amber/15 px-3 py-2 text-[13px] font-medium text-amber"
            : btnGhost}>
          Só com alerta
        </button>
        <div className="flex rounded-lg border border-line2 bg-surface p-0.5">
          {[["painel", "Painel"], ["eventos", "Atividade"]].map(([k, l]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors
                ${aba === k ? "bg-kist text-white" : "text-sub hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-[12.5px] text-rose">
          Não consegui carregar: {erro}
        </div>
      )}

      {aba === "painel" ? (
        carregando ? (
          <Vazio txt="Carregando…" />
        ) : ordenadas.length === 0 ? (
          <Vazio txt={soRisco ? "Nenhum agente com alerta." : "Nenhum agente registrado ainda."} />
        ) : (
          porDono.map(([dono, lista]) => (
            <div key={dono} className="mb-6">
              <div className="mb-2 flex items-baseline gap-2">
                <Eyebrow>{primeiroNome(dono)}</Eyebrow>
                <span className="text-[11.5px] text-faint">{lista.length} {lista.length === 1 ? "agente" : "agentes"}</span>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {lista.map((a) => <Cartucho key={a.slug} a={a} onAbrir={() => abrirFicha(a.slug)} />)}
              </div>
            </div>
          ))
        )
      ) : (
        <Atividade eventos={eventos} onAbrir={abrirFicha} />
      )}

      {ficha && <Ficha f={ficha} onFechar={() => setFicha(null)} />}
    </div>
  );
}

// ── Peças ─────────────────────────────────────────────────────────────────
function Cartao({ n, rot, tom }) {
  const cor = tom === "rose" ? "text-rose" : tom === "amber" ? "text-amber"
            : tom === "kist" ? "text-kist" : "text-ink";
  return (
    <div className={`rounded-xl border bg-surface px-3 py-2.5 ${tom ? "border-line2" : "border-line"}`}>
      <div className={`font-mono text-[19px] font-semibold leading-none ${n ? cor : "text-faint"}`}>{n}</div>
      <div className="mt-1 text-[11px] leading-tight text-sub">{rot}</div>
    </div>
  );
}

function Cartucho({ a, onAbrir }) {
  return (
    <button onClick={onAbrir}
      className="group rounded-xl border border-line bg-surface p-3.5 text-left transition-colors hover:border-faint">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-[13.5px] font-semibold text-ink">{a.slug}</span>
            {a.agente_pai && <span className="text-[11px] text-faint">↳ {a.agente_pai}</span>}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase
              ${a.autonomia === "autonomo" ? "bg-rose/10 text-rose"
                : a.autonomia === "misto" ? "bg-amber/10 text-amber" : "bg-signal/10 text-signal"}`}>
              {a.autonomia || "?"}
            </span>
          </div>
          {a.papel && <div className="mt-0.5 truncate text-[12.5px] text-sub">{a.papel}</div>}
        </div>
        <div className="text-right">
          <div className="font-mono text-[12px] text-sub">{a.eventos || 0} ev</div>
          <div className="text-[10.5px] text-faint">{fmtDur(a.silencio)}</div>
        </div>
      </div>

      {a._riscos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {a._riscos.map((r) => (
            <span key={r.k} className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${TOM[r.k]}`}>{r.txt}</span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>{a.tarefas} tarefas · {a.tarefas_que_escrevem} gravam</span>
        <span>{a.acessos} acessos</span>
        {Number(a.custo_medido) > 0 && <span className="font-mono">US$ {Number(a.custo_medido).toFixed(3)}</span>}
      </div>
    </button>
  );
}

function Atividade({ eventos, onAbrir }) {
  if (!eventos.length) return <Vazio txt="Nenhum evento reportado ainda." />;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {eventos.map((e) => {
        const ruim = e.status === "erro" || e.tipo === "erro";
        const pend = e.status === "pendente" || e.tipo === "aprovacao_pendente";
        return (
          <div key={e.id} className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 last:border-0">
            <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full
              ${ruim ? "bg-rose" : pend ? "bg-kist" : "bg-signal"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <button onClick={() => onAbrir(e.agente_slug)}
                  className="font-mono text-[12.5px] font-medium text-ink hover:text-kist">
                  {e.agente_slug || "—"}
                </button>
                {e.tarefa && <span className="text-[12px] text-sub">{e.tarefa}</span>}
                {e.referencia && <span className="rounded bg-paper px-1.5 font-mono text-[11px] text-sub">{e.referencia}</span>}
              </div>
              {e.resumo && <div className="mt-0.5 text-[12.5px] leading-snug text-sub">{e.resumo}</div>}
            </div>
            <div className="flex-shrink-0 text-right text-[10.5px] text-faint">
              {new Date(e.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {Number(e.custo_usd) > 0 && <div className="font-mono">US$ {Number(e.custo_usd).toFixed(3)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Ficha({ f, onFechar }) {
  const a = f.agente || {};
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={onFechar}>
      <div onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-xl overflow-auto bg-paper shadow-2xl">
        <div className="sticky top-0 flex items-center gap-3 border-b border-line bg-surface px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[15px] font-semibold text-ink">{f.slug}</div>
            {a.papel && <div className="truncate text-[12.5px] text-sub">{a.papel}</div>}
          </div>
          <button onClick={onFechar} className="rounded-md p-1.5 text-faint hover:bg-paper hover:text-ink">
            <IconX size={17} />
          </button>
        </div>

        {f.carregando ? <Vazio txt="Carregando…" />
         : f.erro ? <div className="px-5 py-4 text-[13px] text-rose">{f.erro}</div>
         : (
          <div className="space-y-5 px-5 py-4">
            <Campos a={a} />

            <Bloco titulo={`Tarefas (${(f.tarefas || []).length})`}>
              {(f.tarefas || []).map((t) => (
                <div key={t.id} className="border-b border-line py-2 last:border-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-medium text-ink">{t.nome}</span>
                    {t.escreve && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase
                        ${t.exige_aprovacao ? "bg-signal/10 text-signal" : "bg-amber/10 text-amber"}`}>
                        {t.exige_aprovacao ? "grava · com aprovação" : "grava · sem aprovação"}
                      </span>
                    )}
                    {t.criticidade && <span className="text-[11px] text-faint">{t.criticidade}</span>}
                  </div>
                  {t.descricao && <div className="mt-0.5 text-[12.5px] leading-snug text-sub">{t.descricao}</div>}
                  {t.sistemas?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.sistemas.map((s) => (
                        <span key={s} className="rounded bg-paper px-1.5 py-0.5 text-[10.5px] text-sub">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Bloco>

            <Bloco titulo={`Acessos (${(f.acessos || []).length})`}>
              {(f.acessos || []).map((x) => (
                <div key={x.id} className="flex items-start gap-2 border-b border-line py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] font-medium text-ink">{x.sistema}</span>
                      {x.escopo && <span className="text-[11px] text-faint">{x.escopo}</span>}
                      {x.dados_sensiveis && (
                        <span className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber">
                          dado sensível
                        </span>
                      )}
                    </div>
                    {x.finalidade && <div className="mt-0.5 text-[12.5px] leading-snug text-sub">{x.finalidade}</div>}
                  </div>
                </div>
              ))}
            </Bloco>

            {(f.eventos_recentes || []).length > 0 && (
              <Bloco titulo="Últimos eventos">
                {f.eventos_recentes.slice(0, 15).map((e, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-line py-1.5 text-[12.5px] last:border-0">
                    <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full
                      ${e.status === "erro" ? "bg-rose" : e.status === "pendente" ? "bg-kist" : "bg-signal"}`} />
                    <div className="min-w-0 flex-1">
                      <span className="text-sub">{e.tarefa || e.tipo}</span>
                      {e.resumo && <span className="text-faint"> · {e.resumo}</span>}
                    </div>
                    <span className="flex-shrink-0 text-[10.5px] text-faint">
                      {new Date(e.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </Bloco>
            )}

            {a.instrucoes && (
              <Bloco titulo="Instruções declaradas">
                <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-snug text-sub">
                  {a.instrucoes}
                </pre>
              </Bloco>
            )}
            {a.como_replicar && (
              <Bloco titulo="Como replicar">
                <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-snug text-sub">
                  {a.como_replicar}
                </pre>
              </Bloco>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Campos({ a }) {
  const itens = [
    ["dono", a.dono_email], ["plataforma", a.plataforma], ["modelo", a.modelo],
    ["autonomia", a.autonomia], ["status", a.status], ["versão", a.versao],
    ["gatilho", a.gatilho],
    ["contexto", a.ctx_visto ? "lido" : "NUNCA LEU"],
  ].filter(([, v]) => v);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-line bg-surface p-3.5">
      {itens.map(([k, v]) => (
        <div key={k}>
          <div className="eyebrow text-[10px] uppercase text-faint">{k}</div>
          <div className={`text-[12.5px] ${v === "NUNCA LEU" ? "font-medium text-amber" : "text-ink"}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

const Bloco = ({ titulo, children }) => (
  <div>
    <Eyebrow>{titulo}</Eyebrow>
    <div className="mt-1.5 rounded-xl border border-line bg-surface px-3.5 py-1">{children}</div>
  </div>
);

const Vazio = ({ txt }) => (
  <div className="rounded-xl border border-dashed border-line2 py-12 text-center text-[13px] text-faint">{txt}</div>
);
