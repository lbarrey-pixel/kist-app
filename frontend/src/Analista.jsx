import { useState, useEffect, useRef, useCallback } from "react";
import {
  btnPrimary, btnGhost, Eyebrow, PageHeader, IconArrow, IconX,
  IconUpload, IconDownload,
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

// ── Anexos ─────────────────────────────────────────────────────────────────
// O arquivo NÃO trafega no chat: sobe direto pro Storage, o backend lê UMA vez
// e guarda o resumo. É o resumo que o analista enxerga a cada turno.
const ANX = {
  enviando: { label: "subindo…",      fg: "#555555", bg: "#F1F1F4" },
  lendo:    { label: "lendo…",        fg: "#175FD3", bg: "#E8F0FE" },
  lido:     { label: "lido",          fg: "#357A1E", bg: "#EAF5E5" },
  parcial:  { label: "lido em parte", fg: "#8A5A12", bg: "#FBF1DD" },
  nao_lido: { label: "só anexado",    fg: "#8A5A12", bg: "#FBF1DD" },
  erro:     { label: "falhou",        fg: "#A82F2F", bg: "#FBE9E9" },
};
const EXT_OK = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.msg,.eml,.xlsx,.xls,.xlsm,.csv,.tsv,.txt,.md,.log,.json,.docx,.zip";

// Chamado que o próprio sistema abriu ao detectar que falhou. O operador vê
// junto dos dele — ele foi quem sofreu a falha, então merece acompanhar.
const ORIGEM = {
  sistema: { label: "auto-detectado", bg: "#EEF2F7", fg: "#3D556E", dot: "#5B7A9C" },
};
const fmtTam = (b) => {
  const n = Number(b) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
};
const novaSessao = () =>
  (globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

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

function OrigemBadge({ ch }) {
  const c = ORIGEM[ch.origem];
  if (!c) return null;
  const n = Number(ch.ocorrencias) || 1;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold eyebrow"
      style={{ background: c.bg, color: c.fg }} title="O sistema detectou a falha sozinho e abriu este chamado">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
      {c.label}{n > 1 ? ` · ${n}×` : ""}
    </span>
  );
}

// ── Chip de anexo durante a conversa ───────────────────────────────────────
function AnexoChip({ a, onRemover }) {
  const c = ANX[a.status] || ANX.nao_lido;
  const ocupado = a.status === "enviando" || a.status === "lendo";
  return (
    <div className="flex max-w-full items-center gap-2 rounded-lg border border-line2 bg-paper py-1 pl-2.5 pr-1.5"
      title={a.erro || a.resumo || a.nome}>
      <span className="min-w-0 max-w-[190px] truncate text-[12px] font-medium text-ink">{a.nome}</span>
      <span className="font-mono text-[10.5px] text-faint">{fmtTam(a.tamanho)}</span>
      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold eyebrow"
        style={{ background: c.bg, color: c.fg }}>{c.label}</span>
      {!ocupado && (
        <button onClick={() => onRemover(a)} title="Remover anexo"
          className="rounded p-0.5 text-faint transition-colors hover:bg-surface hover:text-rose">
          <IconX size={13} />
        </button>
      )}
    </div>
  );
}

// ── Ficha de confirmação (o operador vê antes de abrir) ────────────────────
function FichaCard({ ficha, anexos, onConfirm, onAdjust, enviando }) {
  const jaSup = !!ficha.ja_suportado;
  const anx = (anexos || []).filter((a) => a.status !== "enviando");
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
        {anx.length > 0 && (
          <div>
            <dt className="eyebrow text-[10px] font-semibold uppercase text-faint">Anexos que vão junto</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {anx.map((a) => (
                <span key={a.tmp} className="rounded-md bg-paper px-1.5 py-0.5 font-mono text-[10.5px] text-sub">{a.nome}</span>
              ))}
            </dd>
          </div>
        )}
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
    content: `Oi${primeiroNome ? ", " + primeiroNome : ""}! Sou o analista do sistema. Me conta a melhoria que você quer sugerir ou o problema que encontrou — pode ser do jeito que vier. Se tiver print, PDF, planilha ou o e-mail, anexa aqui embaixo que eu leio.`,
  };
  const [msgs, setMsgs] = useState([intro]);
  const [texto, setTexto] = useState("");
  const [ficha, setFicha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [anexos, setAnexos] = useState([]);
  const [arrastando, setArrastando] = useState(false);
  const [sessaoId, setSessaoId] = useState(novaSessao);
  const fimRef = useRef(null);
  const inputFileRef = useRef(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, ficha, loading, anexos]);

  const subindo = anexos.some((a) => a.status === "enviando" || a.status === "lendo");
  const pendentes = anexos.filter((a) => !a.anunciado && a.status !== "enviando" && a.status !== "lendo");
  const podeEnviar = !loading && !subindo && (!!texto.trim() || pendentes.length > 0);

  // Upload: o navegador sobe DIRETO pro Storage (signed URL) — o Render free não
  // aguenta 50 MB atravessando a instância. Se a signed URL falhar, cai pro proxy.
  async function subir(file) {
    const tmp = `t${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    setErro("");
    setAnexos((p) => [...p, { tmp, nome: file.name, tamanho: file.size, status: "enviando" }]);
    const marcar = (patch) => setAnexos((p) => p.map((a) => (a.tmp === tmp ? { ...a, ...patch } : a)));
    try {
      const r = await fetch(`${API}/chamados/anexos/assinar`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sessao_id: sessaoId, nome: file.name, tamanho: file.size, mime: file.type || "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.detail || "arquivo recusado");

      let subiu = false;
      if (d.modo === "signed" && d.url) {
        try {
          const up = await fetch(d.url, {
            method: "PUT",
            headers: { "x-upsert": "true", ...(file.type ? { "Content-Type": file.type } : {}) },
            body: file,
          });
          subiu = up.ok;
        } catch (e) { subiu = false; }
      }
      if (!subiu) {
        const fd = new FormData();
        fd.append("arquivo", file);
        const up2 = await fetch(`${API}/chamados/anexos/${d.anexo_id}/upload`, {
          method: "POST", headers: authHeaders(), body: fd,
        });
        if (!up2.ok) throw new Error("não consegui subir o arquivo");
      }

      marcar({ id: d.anexo_id, status: "lendo" });
      const rl = await fetch(`${API}/chamados/anexos/${d.anexo_id}/ler`, { method: "POST", headers: authHeaders() });
      const dl = await rl.json().catch(() => ({}));
      if (!rl.ok) throw new Error(dl.detail || "não consegui ler o arquivo");
      marcar({ id: d.anexo_id, status: dl.status || "nao_lido", resumo: dl.resumo || "" });
    } catch (e) {
      marcar({ status: "erro", erro: String(e.message || e) });
      setErro(`"${file.name}": ${e.message || e}`);
    }
  }

  function escolher(files) {
    Array.from(files || []).forEach((f) => subir(f));
    if (inputFileRef.current) inputFileRef.current.value = "";
  }

  async function remover(a) {
    setAnexos((p) => p.filter((x) => x.tmp !== a.tmp));
    if (!a.id) return;
    try { await fetch(`${API}/chamados/anexos/${a.id}`, { method: "DELETE", headers: authHeaders() }); } catch (e) {}
  }

  async function enviar() {
    if (!podeEnviar) return;
    let t = texto.trim();
    if (!t && pendentes.length > 0) t = `(anexei: ${pendentes.map((a) => a.nome).join(", ")})`;
    setErro(""); setFicha(null);
    const novos = [...msgs, { role: "user", content: t }];
    setMsgs(novos); setTexto(""); setLoading(true);
    setAnexos((p) => p.map((a) => (a.status !== "enviando" && a.status !== "lendo" ? { ...a, anunciado: true } : a)));
    try {
      // manda só as mensagens reais (descarta a saudação estática inicial)
      const mensagens = novos.slice(1).map(({ role, content }) => ({ role, content }));
      const r = await fetch(`${API}/analista/chat`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ mensagens, operador_nome: usuario?.nome || "", sessao_id: sessaoId }),
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
          sessao_id: sessaoId,
        }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error();
      const num = String(d.numero).padStart(4, "0");
      const nAnx = Number(d.anexos) || 0;
      setFicha(null);
      setMsgs((prev) => [...prev, {
        role: "assistant",
        content: `Pronto — registrei como chamado #${num}${nAnx ? ` com ${nAnx} anexo${nAnx > 1 ? "s" : ""}` : ""}. `
          + `Você acompanha o andamento na aba "Meus chamados". Quer registrar mais alguma coisa?`,
      }]);
      // conversa nova = sessão nova (os anexos já foram amarrados ao chamado)
      setAnexos([]);
      setSessaoId(novaSessao());
      onAberto?.();
    } catch (e) {
      setErro("Não consegui registrar o chamado. Tenta de novo.");
    } finally { setEnviando(false); }
  }

  return (
    <div className={`relative rounded-2xl border bg-surface transition-colors ${arrastando ? "border-kist" : "border-line"}`}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={(e) => { e.preventDefault(); setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer?.files); }}>

      {arrastando && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-kist/[0.06]">
          <span className="rounded-lg bg-kist px-3 py-1.5 text-[12.5px] font-medium text-white">Solte aqui pra anexar</span>
        </div>
      )}

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
            <FichaCard ficha={ficha} anexos={anexos} enviando={enviando}
              onConfirm={confirmar} onAdjust={() => setFicha(null)} />
          </div>
        )}
        <div ref={fimRef} />
      </div>

      {erro && <div className="mx-4 mb-2 rounded-lg border border-rose/30 bg-rosebg px-3 py-2 text-[12.5px] text-rose">{erro}</div>}

      {anexos.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line px-3 py-3">
          {anexos.map((a) => <AnexoChip key={a.tmp} a={a} onRemover={remover} />)}
        </div>
      )}

      <div className={`flex items-end gap-2 p-3 ${anexos.length ? "" : "border-t border-line"}`}>
        <input ref={inputFileRef} type="file" multiple accept={EXT_OK} className="hidden"
          onChange={(e) => escolher(e.target.files)} />
        <button onClick={() => inputFileRef.current?.click()} className={btnGhost}
          title="Anexar arquivo (print, PDF, planilha, e-mail, zip)">
          <IconUpload size={15} />
        </button>
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onPaste={(e) => { const f = e.clipboardData?.files; if (f && f.length) { e.preventDefault(); escolher(f); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          rows={1} placeholder="Escreva sua sugestão ou problema… (Ctrl+V cola print, ou arraste o arquivo aqui)"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint" />
        <button onClick={enviar} disabled={!podeEnviar} className={btnPrimary}>
          {subindo ? "Lendo anexo…" : <>Enviar <IconArrow size={15} /></>}
        </button>
      </div>
    </div>
  );
}

// ── Anexos de um chamado já aberto (download) ─────────────────────────────
export function AnexosDoChamado({ token, chamadoId }) {
  const [lista, setLista] = useState(null);
  const [aberto, setAberto] = useState(false);

  async function abrir() {
    const vai = !aberto;
    setAberto(vai);
    if (!vai || lista !== null) return;
    try {
      const r = await fetch(`${API}/chamados/${chamadoId}/anexos`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setLista(d.anexos || []);
    } catch (e) { setLista([]); }
  }

  return (
    <div className="mt-2">
      <button onClick={abrir} className="flex items-center gap-1.5 text-[11.5px] text-faint hover:text-sub">
        <span>{aberto ? "▾" : "▸"}</span> anexos
      </button>
      {aberto && (
        <div className="mt-1.5 space-y-1">
          {lista === null && <div className="text-[11.5px] text-faint">carregando…</div>}
          {lista !== null && lista.length === 0 && <div className="text-[11.5px] text-faint">nenhum anexo.</div>}
          {(lista || []).map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] text-sub transition-colors hover:border-faint hover:text-ink">
              <IconDownload size={13} />
              <span className="min-w-0 flex-1 truncate">{a.nome}</span>
              <span className="font-mono text-[10.5px] text-faint">{fmtTam(a.tamanho)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Meus chamados (acompanhamento + aviso de "no ar") ──────────────────────
function MeusChamados({ token, onVisto }) {
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
    onVisto?.();
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
              <OrigemBadge ch={c} />
              <span className="ml-auto"><StatusBadge s={c.status} /></span>
            </div>
            <div className="mt-1.5 text-[13.5px] font-medium text-ink">{c.titulo || c.solicitacao}</div>
            {c.solicitacao && c.titulo && <div className="mt-0.5 text-[12.5px] text-sub">{c.solicitacao}</div>}
            {c.origem === "sistema" && (
              <div className="mt-1.5 text-[12px] text-faint">
                Você não precisou abrir este — o sistema percebeu a falha sozinho enquanto você trabalhava.
              </div>
            )}
            <AnexosDoChamado token={token} chamadoId={c.id} />
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
export default function Analista({ token, usuario, onAlertasChange }) {
  const [aba, setAba] = useState("chat");
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="mx-auto max-w-3xl px-8 py-9 rise">
      <PageHeader eyebrow="Suporte interno" title="Requisições"
        sub="Fale com o analista pra sugerir uma melhoria ou relatar um problema. Anexe print, PDF, planilha, e-mail ou zip — ele lê. Acompanhe seus chamados aqui." />

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
          : <MeusChamados token={token} key={reloadKey} onVisto={onAlertasChange} />}
      </div>
    </div>
  );
}
