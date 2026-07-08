import { useState, useEffect, useCallback } from "react";
import {
  btnPrimary, btnGhost, Eyebrow, PageHeader, IconArrow, IconCheck,
} from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const PIPELINE = ["aberto", "em_desenvolvimento", "em_producao", "finalizado"];
const COL = {
  aberto:             { label: "Aberto",             rail: "#B7791F" },
  em_desenvolvimento: { label: "Em desenvolvimento", rail: "#1F6FEB" },
  em_producao:        { label: "Em produção",        rail: "#1F9FE0" },
  finalizado:         { label: "Finalizado",         rail: "#4FA62E" },
};
const TIPO = {
  bug:      { label: "Bug",      bg: "#FBE9E9", fg: "#A82F2F" },
  melhoria: { label: "Melhoria", bg: "#E8F0FE", fg: "#175FD3" },
  duvida:   { label: "Dúvida",   bg: "#FBF1DD", fg: "#8A5A12" },
};
const PRIO = {
  alta:  { label: "Alta",  dot: "#D14343" },
  media: { label: "Média", dot: "#B7791F" },
  baixa: { label: "Baixa", dot: "#9AA3AF" },
};

function TipoBadge({ t }) {
  const c = TIPO[t] || TIPO.melhoria;
  return <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold eyebrow" style={{ background: c.bg, color: c.fg }}>{c.label}</span>;
}

// ── Modal de resolução (obrigatória ao ir pra produção/finalizado) ─────────
function ResolucaoModal({ chamado, statusAlvo, onClose, onConfirmar }) {
  const [texto, setTexto] = useState(chamado.resolucao || "");
  const alvo = COL[statusAlvo]?.label || statusAlvo;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} />
      <div className="slide-in relative w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <Eyebrow>Mover para {alvo}</Eyebrow>
        <h3 className="mt-1.5 text-[17px] font-semibold tracking-tight text-ink">#{String(chamado.numero).padStart(4, "0")} · {chamado.titulo}</h3>
        <p className="mt-2 text-[12.5px] text-sub">
          Descreva o que foi entregue. Esse texto vira o changelog que o analista passa a conhecer — e é o que o operador vê como "no ar".
        </p>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus rows={3}
          placeholder="ex: adicionei o botão Duplicar proposta na tela de propostas; clona itens e preços."
          className="mt-3 w-full resize-none rounded-lg border border-line2 bg-paper px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-faint" />
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancelar</button>
          <button onClick={() => onConfirmar(texto.trim())} className={btnPrimary} disabled={!texto.trim()}>
            <IconCheck size={15} /> Mover e avisar o operador
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ ch, onMover, onAbrir, aberto, onAtualizar }) {
  const idx = PIPELINE.indexOf(ch.status);
  const prio = PRIO[ch.prioridade] || PRIO.media;
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] font-medium text-faint">#{String(ch.numero).padStart(4, "0")}</span>
        <TipoBadge t={ch.tipo} />
        <span className="ml-auto flex items-center gap-1 text-[10.5px] text-faint" title={`Prioridade ${prio.label}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: prio.dot }} /> {prio.label}
        </span>
      </div>
      <button onClick={onAbrir} className="mt-1.5 block w-full text-left text-[13px] font-medium leading-snug text-ink hover:text-kist">
        {ch.titulo || ch.solicitacao}
      </button>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-faint">
        {ch.area && <span className="rounded bg-paper px-1.5 py-0.5">{ch.area}</span>}
        {ch.ja_suportado && <span className="rounded bg-paper px-1.5 py-0.5">já existia</span>}
        <span className="ml-auto" title={ch.operador_nome || ch.operador_email}>{ch.operador_nome || "?"}</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-line/70 pt-2">
        <button disabled={idx <= 0} onClick={() => onMover(ch, PIPELINE[idx - 1])}
          className="rounded-md p-1 text-faint transition-colors enabled:hover:bg-paper enabled:hover:text-ink disabled:opacity-30" title="Voltar etapa">
          <IconArrow size={15} style={{ transform: "rotate(180deg)" }} />
        </button>
        <button onClick={onAbrir} className="text-[11px] text-faint hover:text-sub">{aberto ? "fechar" : "detalhes"}</button>
        <button disabled={idx >= PIPELINE.length - 1} onClick={() => onMover(ch, PIPELINE[idx + 1])}
          className="rounded-md p-1 text-faint transition-colors enabled:hover:bg-paper enabled:hover:text-kist disabled:opacity-30" title="Avançar etapa">
          <IconArrow size={15} />
        </button>
      </div>

      {aberto && (
        <div className="mt-2 space-y-2 border-t border-line/70 pt-2.5">
          {[["Solicitação", ch.solicitacao], ["Dor", ch.dor], ["Comportamento esperado", ch.comportamento_esperado], ["Parecer", ch.parecer_analista], ["Resolução", ch.resolucao]].map(([r, v]) => v ? (
            <div key={r}>
              <div className="eyebrow text-[9px] font-semibold uppercase text-faint">{r}</div>
              <div className="text-[12px] text-sub">{v}</div>
            </div>
          ) : null)}
          <div className="flex items-center gap-2 pt-1">
            <label className="text-[11px] text-faint">Prioridade</label>
            <select value={ch.prioridade || "media"} onChange={(e) => onAtualizar(ch, { prioridade: e.target.value })}
              className="rounded-md border border-line2 bg-paper px-2 py-1 text-[12px] text-ink outline-none">
              <option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option>
            </select>
            <button onClick={() => onAtualizar(ch, { status: "duplicada" })} className="ml-auto text-[11px] text-faint hover:text-sub">duplicado</button>
            <button onClick={() => onAtualizar(ch, { status: "rejeitada" })} className="text-[11px] text-faint hover:text-rose">recusar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChamadosAdmin({ token, usuario }) {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [abertoId, setAbertoId] = useState(null);
  const [resolvendo, setResolvendo] = useState(null); // { ch, statusAlvo }
  const [mostrarTriados, setMostrarTriados] = useState(false);

  const carregar = useCallback(() => {
    setLoading(true); setErro("");
    fetch(`${API}/chamados`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setLista(d.chamados || []))
      .catch(() => setErro("Não foi possível carregar os chamados."))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  async function patch(ch, body) {
    // atualização otimista
    setLista((prev) => prev.map((c) => (c.id === ch.id ? { ...c, ...body } : c)));
    try {
      await fetch(`${API}/chamados/${ch.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
    } catch (e) { carregar(); }
  }

  function mover(ch, novoStatus) {
    // entrar em produção/finalizado exige registrar a resolução
    if (novoStatus === "em_producao" || novoStatus === "finalizado") {
      setResolvendo({ ch, statusAlvo: novoStatus });
      return;
    }
    patch(ch, { status: novoStatus });
  }

  async function arquivarConcluidos() {
    try {
      const r = await fetch(`${API}/chamados/arquivar-concluidos`, { method: "POST", headers: authHeaders() });
      const d = await r.json();
      carregar();
      if (d.arquivados === 0) setErro("Nada pra arquivar — nenhum chamado em produção ou finalizado no quadro.");
    } catch (e) { setErro("Não foi possível arquivar agora."); }
  }

  const naPipeline = lista.filter((c) => PIPELINE.includes(c.status));
  const triados = lista.filter((c) => ["ja_suportada", "duplicada", "rejeitada"].includes(c.status));

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-9 rise">
      <PageHeader eyebrow="Controle · admin" title="Admin dos chamados"
        sub="Sugestões e bugs da equipe. Mova pelas etapas; ao chegar em produção, o operador é avisado."
        actions={
          <button onClick={arquivarConcluidos} className={btnGhost} title="Some do quadro; permanece na base e no changelog">
            Arquivar concluídos
          </button>
        } />

      {erro && <div className="mt-4 rounded-lg border border-amber/30 bg-amberbg px-4 py-2.5 text-[12.5px] text-amber">{erro}</div>}

      {loading ? (
        <div className="mt-8 text-center text-[13px] text-faint">Carregando…</div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PIPELINE.map((st) => {
              const cards = naPipeline.filter((c) => c.status === st);
              return (
                <div key={st} className="flex flex-col">
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: COL[st].rail }} />
                    <span className="text-[12.5px] font-semibold text-ink">{COL[st].label}</span>
                    <span className="font-mono text-[11px] text-faint">{cards.length}</span>
                  </div>
                  <div className="flex flex-col gap-2.5 rounded-xl bg-paper/50 p-2 min-h-[80px]">
                    {cards.length === 0 && <div className="px-2 py-6 text-center text-[11.5px] text-faint">—</div>}
                    {cards.map((c) => (
                      <Card key={c.id} ch={c}
                        aberto={abertoId === c.id}
                        onAbrir={() => setAbertoId(abertoId === c.id ? null : c.id)}
                        onMover={mover}
                        onAtualizar={patch} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {triados.length > 0 && (
            <div className="mt-8">
              <button onClick={() => setMostrarTriados((v) => !v)} className="flex items-center gap-2 text-[12.5px] font-medium text-sub hover:text-ink">
                <span>{mostrarTriados ? "▾" : "▸"}</span> Triados · já suportados, duplicados e recusados ({triados.length})
              </button>
              {mostrarTriados && (
                <div className="mt-3 space-y-2">
                  {triados.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                      <span className="font-mono text-[11px] text-faint">#{String(c.numero).padStart(4, "0")}</span>
                      <TipoBadge t={c.tipo} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{c.titulo || c.solicitacao}</span>
                      <span className="text-[11px] text-faint">{c.status === "ja_suportada" ? "já existia" : c.status === "duplicada" ? "duplicado" : "recusado"}</span>
                      <button onClick={() => patch(c, { status: "aberto" })} className="text-[11px] text-faint hover:text-kist" title="Reabrir no quadro">reabrir</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {resolvendo && (
        <ResolucaoModal chamado={resolvendo.ch} statusAlvo={resolvendo.statusAlvo}
          onClose={() => setResolvendo(null)}
          onConfirmar={(texto) => { patch(resolvendo.ch, { status: resolvendo.statusAlvo, resolucao: texto }); setResolvendo(null); }} />
      )}
    </div>
  );
}
