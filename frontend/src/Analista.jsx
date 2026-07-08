import { useState, useEffect, useRef, useCallback } from "react";
import {
  btnPrimary, btnGhost, Eyebrow, PageHeader, IconArrow, IconX,
} from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Tokens de status/tipo (alinhados ao design "Cabine") ───────────────────
const STATUS = {
  aberto:             { label: "Aberto",             bg: "#FBF1DD", fg: "#8A5A12", dot: "#B7791F" },
  em_desenvolvimento: { label: "Em desenvolvimento", bg: "#E8F0FE", fg: "#175FD3", dot: "#1F6FEB" },
  em_producao:        { label: "Em produção",        bg: "#E6F3FB", fg: "#0E6BA8", dot: "#1F9FE0" },
  finalizado:         { label: "Finalizado",         bg: "#EAF5E5", fg: "#357A1E", dot: "#4FA62E" },
  ja_suportada:       { label: "Já dava pra fazer",  bg: "#F1F1F4", fg: "#555555", dot: "#999999" },
  duplicada:          { label: "Duplicado",          bg: "#F1F1F4", fg: "#555555", dot: "#999999" },
  rejeitada:          { label: "Recusado",           bg: "#FBE9E9", fg: "#A82F2F", dot: "#D14343" },
};
const TIPO = {
  bug:      { label: "Bug",      bg: "#FBE9E9", fg: "#A82F2F" },
  melhoria: { label: "Melhoria", bg: "#E8F0FE", fg: "#175FD3" },
  duvida:   { label: "Dúvida",   bg: "#FBF1DD", fg: "#8A5A12" },
};

function StatusBadge({ s }) {
  const c = STATUS[s] || STATUS.aberto;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold eyebrow"
      style={{ background: c.bg, color: c.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} /> {c.label}
    </span>
  );
}
function TipoBadge({ t }) {
  const c = TIPO[t] || TIPO.melhoria;
  return <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold eyebrow" style={{ background: c.bg, color: c.fg }}>{c.label}</span>;
}

// ── Ficha de confirmação (o operador vê antes de abrir) ────────────────────
function FichaCard({ ficha, onConfirm, onAdjust, enviando }) {
  const jaSup = !!ficha.ja_suportado;
  const Campo = ({ rotulo, valor }) => valor ? (
    <div>
      <dt className="eyebrow text-[10px] font-semibold uppercase text-faint">{rotulo}</dt>
      <dd className="mt-0.5 text-[13px] text-sub">{valor}</dd>
    </div>
  ) : null;
  return (
    <div className={`rounded-xl border p-4 ${jaSup ? "border-line2 bg-paper" : "border-kist/30 bg-kist/[0.03]"}`}>
      <div className="flex items-center gap-2">
        <Eyebrow>{jaSup ? "Isso o sistema já faz" : "Pronto pra abrir o chamado"}</Eyebrow>
        <TipoBadge t={ficha.tipo} />
      </div>
      {ficha.titulo && <h4 className="mt-1.5 text-[15px] font-semibold tracking-tight text-ink">{ficha.titulo}</h4>}
      <dl className="mt-3 space-y-2.5">
        <Campo rotulo="Solicitação" valor={ficha.solicitacao} />
        <Campo rotulo="Dor que resolve" valor={ficha.dor} />
        <Campo rotulo="Como o sistema deve se comportar" valor={ficha.comportamento_esperado} />
        <Campo rotulo="Parecer do analista" valor={ficha.parecer} />
      </dl>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onAdjust} className={btnGhost} disabled={enviando}>Continuar ajustando</button>
        <button onClick={onConfirm} className={btnPrimary} disabled={enviando}>
          {enviando ? "Registrando…" : jaSup ? "Registrar mesmo assim" : <>Confirmar e abrir chamado <IconArrow size={15} /></>}
        </button>
      </div>
    </div>
  );
}

// ── Conversa com o analista ────────────────────────────────────────────────
function ChatAnalista({ token, usuario, onAberto }) {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const primeiroNome = (usuario?.nome || "").trim().split(" ")[0];
  const intro = {
    role: "assistant",
    content: `Oi${primeiroNome ? ", " + primeiroNome : ""}! Sou o analista do sistema. Me conta a melhoria que você quer sugerir ou o problema que encontrou — pode ser do jeito que vier.`,
  };
  const [msgs, setMsgs] = useState([intro]);
  const [texto, setTexto] = useState("");
  const [ficha, setFicha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const fimRef = useRef(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, ficha, loading]);

  async function enviar() {
    const t = texto.trim();
    if (!t || loading) return;
    setErro(""); setFicha(null);
    const novos = [...msgs, { role: "user", content: t }];
    setMsgs(novos); setTexto(""); setLoading(true);
    try {
      // manda só as mensagens reais (descarta a saudação estática inicial)
      const mensagens = novos.slice(1).map(({ role, content }) => ({ role, content }));
      const r = await fetch(`${API}/analista/chat`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ mensagens, operador_nome: usuario?.nome || "" }),
      });
      const d = await r.json();
      setMsgs((prev) => [...prev, { role: "assistant", content: d.reply || "…" }]);
      if (d.ficha) setFicha(d.ficha);
    } catch (e) {
      setErro("Não consegui falar com o analista agora. Tenta de novo em instantes.");
    } finally { setLoading(false); }
  }

  async function confirmar() {
    if (!ficha) return;
    setEnviando(true); setErro("");
    try {
      const descricao = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      const r = await fetch(`${API}/chamados`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          tipo: ficha.tipo, titulo: ficha.titulo, solicitacao: ficha.solicitacao,
          dor: ficha.dor, comportamento_esperado: ficha.comportamento_esperado,
          area: ficha.area, ja_suportado: !!ficha.ja_suportado,
          parecer_analista: ficha.parecer || "", prioridade: ficha.prioridade || "media",
          descricao_operador: descricao,
          transcript: msgs.map(({ role, content }) => ({ role, content })),
          operador_nome: usuario?.nome || "",
        }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error();
      const num = String(d.numero).padStart(4, "0");
      setFicha(null);
      setMsgs((prev) => [...prev, {
        role: "assistant",
        content: `Pronto — registrei como chamado #${num}. Você acompanha o andamento na aba "Meus chamados". Quer registrar mais alguma coisa?`,
      }]);
      onAberto?.();
    } catch (e) {
      setErro("Não consegui registrar o chamado. Tenta de novo.");
    } finally { setEnviando(false); }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="max-h-[52vh] min-h-[280px] space-y-3 overflow-auto px-4 py-4">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed
              ${m.role === "user" ? "bg-kist text-white" : "bg-paper text-ink"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-paper px-3.5 py-2 text-[13px] text-faint">analista está digitando…</div>
          </div>
        )}
        {ficha && (
          <div className="pt-1">
            <FichaCard ficha={ficha} enviando={enviando} onConfirm={confirmar} onAdjust={() => setFicha(null)} />
          </div>
        )}
        <div ref={fimRef} />
      </div>

      {erro && <div className="mx-4 mb-2 rounded-lg border border-rose/30 bg-rosebg px-3 py-2 text-[12.5px] text-rose">{erro}</div>}

      <div className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          rows={1} placeholder="Escreva sua sugestão ou problema… (Enter envia, Shift+Enter quebra linha)"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint" />
        <button onClick={enviar} disabled={loading || !texto.trim()} className={btnPrimary}>
          Enviar <IconArrow size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Meus chamados (acompanhamento + aviso de "no ar") ──────────────────────
function MeusChamados({ token }) {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    fetch(`${API}/chamados`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setLista(d.chamados || []))
      .catch(() => setLista([]))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  async function marcarVisto(id) {
    setLista((prev) => prev.map((c) => (c.id === id ? { ...c, avisar_operador: false } : c)));
    try { await fetch(`${API}/chamados/${id}/visto`, { method: "POST", headers: authHeaders() }); } catch (e) {}
  }

  if (loading) return <div className="py-10 text-center text-[13px] text-faint">Carregando…</div>;
  if (lista.length === 0) return (
    <div className="rounded-xl border border-dashed border-line2 bg-surface px-6 py-10 text-center">
      <div className="text-[13.5px] font-medium text-ink">Você ainda não abriu nenhum chamado.</div>
      <div className="mt-1 text-[12.5px] text-sub">Vá em "Conversar" pra sugerir uma melhoria ou relatar um problema.</div>
    </div>
  );

  return (
    <div className="space-y-2.5">
      {lista.map((c) => {
        const noAr = c.avisar_operador && (c.status === "em_producao" || c.status === "finalizado");
        return (
          <div key={c.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] font-medium text-faint">#{String(c.numero).padStart(4, "0")}</span>
              <TipoBadge t={c.tipo} />
              <span className="ml-auto"><StatusBadge s={c.status} /></span>
            </div>
            <div className="mt-1.5 text-[13.5px] font-medium text-ink">{c.titulo || c.solicitacao}</div>
            {c.solicitacao && c.titulo && <div className="mt-0.5 text-[12.5px] text-sub">{c.solicitacao}</div>}
            {noAr && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-signal/30 px-3 py-2" style={{ background: "#EAF5E5" }}>
                <div className="text-[12.5px] font-medium text-signal">✓ Resolvido e no ar — pode usar!</div>
                <button onClick={() => marcarVisto(c.id)} title="Marcar como lido"
                  className="rounded-md p-1 text-signal/70 hover:bg-white/40 hover:text-signal">
                  <IconX size={14} />
                </button>
              </div>
            )}
            {c.status === "ja_suportada" && c.parecer_analista && (
              <div className="mt-2 rounded-lg bg-paper px-3 py-2 text-[12px] text-sub">{c.parecer_analista}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────
export default function Analista({ token, usuario }) {
  const [aba, setAba] = useState("chat");
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="mx-auto max-w-3xl px-8 py-9 rise">
      <PageHeader eyebrow="Suporte interno" title="Requisições"
        sub="Fale com o analista pra sugerir uma melhoria ou relatar um problema. Acompanhe seus chamados aqui." />

      <div className="mt-6 inline-flex rounded-lg border border-line2 bg-surface p-0.5">
        {[["chat", "Conversar"], ["meus", "Meus chamados"]].map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${aba === k ? "bg-kist text-white" : "text-sub hover:text-ink"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {aba === "chat"
          ? <ChatAnalista token={token} usuario={usuario} onAberto={() => setReloadKey((k) => k + 1)} />
          : <MeusChamados token={token} key={reloadKey} />}
      </div>
    </div>
  );
}
