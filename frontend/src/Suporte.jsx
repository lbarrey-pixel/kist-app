import { useState, useRef, useEffect } from "react";

// ── Balão de dúvida (v3.65) ──────────────────────────────────────────────────
// Um botão discreto no canto. O operador pergunta "onde fica", "como faço",
// "o sistema já faz isso?" e recebe resposta curta, com o caminho na tela.
//
// Por que existe: a tela Requisições é para LEVANTAR chamado — ela pergunta a
// dor, a frequência, o contorno, e monta ficha. Quem só quer saber onde clicar
// não vai abrir chamado para isso; fica sem resposta ou pergunta no WhatsApp.
//
// Mesmo conhecimento do Analista (núcleo + entregas + estado real do banco),
// objetivo diferente: responder, não registrar. Por isso o backend roda o modo
// `suporte` sem a ferramenta de ficha e com o modelo mais barato — o
// conhecimento vem no prompt, a tarefa é ler e apontar.

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const SUGESTOES = [
  "Como funciona a pesquisa do Dwight?",
  "De onde vem o preço de venda sugerido?",
  "Por que um item não casou com o banco?",
];

export default function Suporte({ token, usuario, onAbrirRequisicoes }) {
  const [aberto, setAberto] = useState(false);
  const [conversa, setConversa] = useState([]);
  const [rascunho, setRascunho] = useState("");
  const [pensando, setPensando] = useState(false);
  const fimRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (aberto) {
      fimRef.current?.scrollIntoView({ block: "end" });
      inputRef.current?.focus();
    }
  }, [aberto, conversa, pensando]);

  // Esc fecha. Atalho de teclado sem depender do mouse chegar ao canto.
  useEffect(() => {
    if (!aberto) return;
    const h = (e) => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [aberto]);

  if (!token) return null;

  async function perguntar(texto) {
    const q = (texto ?? rascunho).trim();
    if (!q || pensando) return;
    setRascunho("");
    const historico = [...conversa, { role: "user", content: q }];
    setConversa(historico);
    setPensando(true);
    try {
      const r = await fetch(`${API}/analista/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          modo: "suporte",
          operador_nome: usuario?.nome || "",
          mensagens: historico.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setConversa((c) => [...c, { role: "assistant", content: d.reply || "(sem resposta)" }]);
    } catch (e) {
      setConversa((c) => [...c, {
        role: "assistant", erro: true,
        content: `Não consegui responder agora (${e.message}). Tente de novo em um instante.`,
      }]);
    } finally { setPensando(false); }
  }

  return (
    <>
      {/* botão discreto, canto inferior direito */}
      {!aberto && (
        <button onClick={() => setAberto(true)} title="Dúvida sobre o sistema"
          className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-line2 bg-surface text-[17px] text-sub shadow-lg transition-colors hover:border-kist hover:text-kist">
          ?
        </button>
      )}

      {aberto && (
        <div className="fixed bottom-5 right-5 z-40 flex max-h-[70vh] w-[92vw] max-w-[380px] flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3.5 py-2.5">
            <div>
              <div className="text-[12.5px] font-semibold text-ink">Dúvida sobre o sistema</div>
              <div className="text-[10.5px] text-faint">responde pelo que o sistema realmente faz</div>
            </div>
            <div className="flex items-center gap-1">
              {conversa.length > 0 && (
                <button onClick={() => setConversa([])} title="Limpar"
                  className="rounded px-1.5 py-0.5 text-[10.5px] text-faint hover:text-sub">limpar</button>
              )}
              <button onClick={() => setAberto(false)} title="Fechar (Esc)"
                className="rounded px-1.5 py-0.5 text-[15px] leading-none text-faint hover:text-ink">×</button>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
            {conversa.length === 0 && (
              <div className="space-y-2">
                <div className="text-[12px] text-sub">
                  Pergunte onde fica, como faz, ou se o sistema já faz aquilo. Para registrar bug ou
                  pedido de mudança, o caminho é a tela Requisições.
                </div>
                <div className="flex flex-col items-start gap-1">
                  {SUGESTOES.map((sg, i) => (
                    <button key={i} onClick={() => perguntar(sg)}
                      className="rounded-md border border-line2 bg-surface px-2 py-1 text-left text-[11.5px] text-sub hover:border-kist hover:text-kist">
                      {sg}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {conversa.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-xl px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
                  m.role === "user" ? "bg-kist/10 text-ink"
                    : m.erro ? "border border-rose/30 bg-rosebg text-rose"
                    : "border border-line2 bg-surface text-ink"}`}>
                  {m.content}
                </div>
              </div>
            ))}

            {pensando && <div className="text-[11.5px] text-faint">pensando…</div>}
            <div ref={fimRef} />
          </div>

          <div className="border-t border-line bg-surface px-2.5 py-2">
            <div className="flex items-end gap-1.5">
              <textarea ref={inputRef} value={rascunho} rows={1}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(); } }}
                placeholder="sua dúvida…"
                className="max-h-24 flex-1 resize-y rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-kist" />
              <button onClick={() => perguntar()} disabled={pensando || !rascunho.trim()}
                className="rounded-lg border border-line2 px-2.5 py-1.5 text-[11.5px] font-medium text-kist hover:border-kist disabled:opacity-40">
                enviar
              </button>
            </div>
            {onAbrirRequisicoes && (
              <button onClick={() => { setAberto(false); onAbrirRequisicoes(); }}
                className="mt-1.5 text-[10.5px] text-faint hover:text-kist">
                é bug ou pedido de mudança? abrir em Requisições
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
