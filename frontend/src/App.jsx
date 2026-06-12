import { useState, useRef, useCallback, useEffect } from "react";
import Docs from "./Docs.jsx";
import Propostas from "./Propostas.jsx";
import OrdensCompra from "./OrdensCompra.jsx";
import {
  CONF, brl, btnPrimary, btnGhost, Eyebrow, StateLabel, PageHeader,
  CertaintyStrip, Sidebar,
  IconUpload, IconBolt, IconArrow, IconDownload, IconCheck, IconLink, IconX,
} from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const isLink = (s) => typeof s === "string" && /^https?:\/\//i.test(s.trim());

// ── Linha de item da revisão ───────────────────────────────────────────────
function ItemRow({ item, index, onChange, token, apiUrl }) {
  const [loadingPn, setLoadingPn] = useState(false);
  const [sugestoes, setSugestoes] = useState(null);
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);
  const [mostrarSpecs, setMostrarSpecs] = useState(false);
  const [mostrarOrigem, setMostrarOrigem] = useState(false);

  async function buscarSugestoes() {
    setLoadingPn(true); setSugestoes(null); setMostrarSugestoes(true);
    try {
      const res = await fetch(`${apiUrl}/sugerir-pn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ descricao: item.descricao_final }),
      });
      const data = await res.json();
      setSugestoes(data.sugestoes || []);
    } catch (e) { setSugestoes([]); }
    finally { setLoadingPn(false); }
  }

  function aplicarSugestao(s) {
    onChange(index, "descricao_final", `${s.fabricante} ${s.modelo} - ${s.specs}`);
    if (s.preco_estimado > 0) onChange(index, "preco_un", s.preco_estimado);
    setMostrarSugestoes(false); setSugestoes(null);
  }

  const confianca = item.confianca_match || "nenhuma";
  const c = CONF[confianca];
  const semPreco = !(item.preco_un > 0);
  const temOrigem = !!(item.link_fornecedor || item.fornecedor || item.sku_fornecedor);

  return (
    <>
      <tr className="group border-b border-line/70 last:border-0">
        <td className="relative w-1 p-0">
          <span className="absolute inset-y-1 left-0 w-[3px] rounded-full" style={{ background: c.rail }} />
        </td>
        <td className="py-2.5 pl-4 pr-2 text-center font-mono text-[11px] text-faint">
          {String(index + 1).padStart(2, "0")}
        </td>
        <td className="py-2 pr-3">
          <input
            className="w-full rounded-md bg-transparent px-1.5 py-1 text-[13px] text-ink cell-input"
            value={item.descricao_final}
            onChange={(e) => onChange(index, "descricao_final", e.target.value)}
          />
          <div className="mt-0.5 flex flex-wrap items-center gap-2 pl-1.5">
            <StateLabel conf={confianca} />
            {confianca === "baixa" && item.banco_candidato && (
              <span className="text-[11px] text-sub">
                ref. banco: <span className="text-faint">{item.banco_candidato}</span>
              </span>
            )}
            {item.sugerir_pn && (
              <button onClick={buscarSugestoes} disabled={loadingPn}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-kist hover:text-kist600 disabled:opacity-50">
                <IconBolt size={11} /> {loadingPn ? "buscando…" : "Sugerir PN"}
              </button>
            )}
            {item.specs_complementares && (
              <button onClick={() => setMostrarSpecs((v) => !v)} className="text-[11px] text-faint hover:text-sub">
                {mostrarSpecs ? "− specs originais" : "+ specs originais"}
              </button>
            )}
            <button onClick={() => setMostrarOrigem((v) => !v)}
              className={`text-[11px] hover:text-sub ${temOrigem ? "text-kist" : "text-faint"}`}>
              {mostrarOrigem ? "− origem do preço" : temOrigem ? "✓ origem do preço" : "+ origem do preço"}
            </button>
          </div>
          {mostrarSpecs && item.specs_complementares && (
            <div className="mt-1.5 whitespace-pre-wrap rounded-md border border-line bg-paper p-2 font-mono text-[11px] text-sub">
              {item.specs_complementares}
            </div>
          )}
        </td>
        <td className="py-2 pr-3">
          <input type="number"
            className="w-14 rounded-md bg-transparent px-1.5 py-1 text-right font-mono text-[12.5px] text-ink cell-input"
            value={item.quantidade}
            onChange={(e) => onChange(index, "quantidade", parseFloat(e.target.value))}
          />
        </td>
        <td className="py-2 pr-3">
          <input
            className="w-12 rounded-md bg-transparent px-1.5 py-1 font-mono text-[12px] text-faint cell-input"
            value={item.unidade}
            onChange={(e) => onChange(index, "unidade", e.target.value)}
          />
        </td>
        <td className="py-2 pr-4">
          <div className="flex items-center justify-end gap-1">
            <span className={`text-[11px] ${semPreco ? "text-amber" : "text-faint"}`}>R$</span>
            <input type="number" step="0.001" placeholder="—"
              className={`w-20 rounded-md bg-transparent px-1 py-1 text-right font-mono text-[12.5px] cell-input
                ${semPreco ? "text-amber placeholder:text-amber/70" : "text-ink"}`}
              value={item.preco_un}
              onChange={(e) => onChange(index, "preco_un", parseFloat(e.target.value) || 0)}
            />
          </div>
        </td>
      </tr>

      {/* Origem do preço — link OU texto livre · viaja junto pra OC */}
      {mostrarOrigem && (
        <tr className="border-b border-line/70 bg-paper/60">
          <td /><td />
          <td colSpan={4} className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-[280px] flex-1 items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                {isLink(item.link_fornecedor)
                  ? <IconLink size={13} className="flex-shrink-0 text-kist" />
                  : <span className="eyebrow flex-shrink-0 text-[9px] font-bold uppercase text-faint">Origem</span>}
                <input
                  className="w-full bg-transparent text-[12px] text-ink outline-none"
                  placeholder="link do fornecedor ou texto livre (ex: cotação WhatsApp 06/06)"
                  value={item.link_fornecedor || ""}
                  onChange={(e) => onChange(index, "link_fornecedor", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                <span className="text-[11px] text-faint">Fornecedor</span>
                <input
                  className="w-36 bg-transparent text-[12px] text-ink outline-none"
                  placeholder="nome"
                  value={item.fornecedor || ""}
                  onChange={(e) => onChange(index, "fornecedor", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                <span className="text-[11px] text-faint">SKU forn.</span>
                <input
                  className="w-28 bg-transparent font-mono text-[12px] text-ink outline-none"
                  placeholder="—"
                  value={item.sku_fornecedor || ""}
                  onChange={(e) => onChange(index, "sku_fornecedor", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                <span className="text-[11px] text-faint">Custo un.</span>
                <span className="text-[11px] text-faint">R$</span>
                <input type="number" step="0.01"
                  className="w-20 bg-transparent text-right font-mono text-[12px] text-ink outline-none"
                  placeholder="0,00"
                  value={item.preco_custo ?? ""}
                  onChange={(e) => onChange(index, "preco_custo", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                <span className="text-[11px] text-faint">Frete (item)</span>
                <span className="text-[11px] text-faint">R$</span>
                <input type="number" step="0.01"
                  className="w-20 bg-transparent text-right font-mono text-[12px] text-ink outline-none"
                  placeholder="0,00"
                  value={item.frete_vinda ?? ""}
                  onChange={(e) => onChange(index, "frete_vinda", parseFloat(e.target.value) || 0)}
                />
              </div>
              {item.preco_custo > 0 && (
                <span className="text-[11px] text-faint">
                  lucro un.{" "}
                  <span className={`font-mono ${(item.preco_un - item.preco_custo) >= 0 ? "text-signal" : "text-rose"}`}>
                    R$ {brl((item.preco_un || 0) - (item.preco_custo || 0))}
                  </span>
                </span>
              )}
            </div>
            <p className="mt-1.5 pl-1 text-[11px] text-faint">
              Essa referência acompanha o item quando a proposta virar ordem de compra. <span className="text-faint/80">Custo é interno — não vai pro Tiny.</span>
            </p>
          </td>
        </tr>
      )}

      {/* Sugestões de PN */}
      {mostrarSugestoes && (
        <tr className="border-b border-line/70 bg-paper/60">
          <td /><td />
          <td colSpan={4} className="px-3 pb-3 pt-1">
            <div className="rounded-xl border border-kist/20 bg-kist/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between">
                <Eyebrow>Sugestões de PN / modelo</Eyebrow>
                <button onClick={() => setMostrarSugestoes(false)} className="text-faint hover:text-rose"><IconX size={14} /></button>
              </div>
              {loadingPn ? (
                <div className="py-2 text-[12px] text-sub">Consultando…</div>
              ) : sugestoes && sugestoes.length > 0 ? (
                <div className="space-y-2">
                  {sugestoes.map((s, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-ink">{s.fabricante} {s.modelo}</span>
                          {s.atende_fabricante && (
                            <span className="rounded-full bg-signalbg px-1.5 py-0.5 text-[10px] font-medium text-signal">fabricante ok</span>
                          )}
                        </div>
                        <div className="mb-1 text-[12px] text-sub">{s.specs}</div>
                        {s.preco_estimado > 0 && (
                          <div className="text-[12px] text-sub">
                            Estimado: <span className="font-mono font-medium text-ink">R$ {brl(s.preco_estimado)}</span>
                          </div>
                        )}
                      </div>
                      <button onClick={() => aplicarSugestao(s)} className={btnPrimary}>Usar</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-2 text-[12px] text-sub">Nenhuma sugestão encontrada.</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [showDocs, setShowDocs] = useState(false);
  const [pagina, setPagina] = useState("nova"); // nova | propostas | ordens
  const [novaOCPayload, setNovaOCPayload] = useState(null);
  const [token, setToken] = useState(null);
  const [step, setStep] = useState("input");
  const [loading, setLoading] = useState(false);
  const [salvandoBanco, setSalvandoBanco] = useState(false);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [imagens, setImagens] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [numeroProposta, setNumeroProposta] = useState("");
  const [resultado, setResultado] = useState(null);
  const [stats, setStats] = useState(null);
  const [bancoInfo, setBancoInfo] = useState(null);
  const fileRef = useRef();

  // Carregar Google Identity Services
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true; script.defer = true;
    document.head.appendChild(script);
    return () => document.head.removeChild(script);
  }, []);

  // Stats e próximo número após login
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/banco/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then(setStats).catch(() => {});
    fetch(`${API}/proxima-proposta`)
      .then((r) => r.json()).then((d) => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
    const ka = setInterval(() => fetch(`${API}/ping`).catch(() => {}), 9 * 60 * 1000);
    return () => clearInterval(ka);
  }, [token]);

  // Capturar Ctrl+V de imagens
  useEffect(() => {
    if (!usuario) return;
    function handlePaste(e) {
      const items = e.clipboardData?.items || [];
      const imgs = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imgs.push(file);
        }
      }
      if (imgs.length > 0) {
        setImagens((prev) => [...prev, ...imgs].slice(0, 6));
        setArquivo(null);
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [usuario]);

  function handleGoogleResponse(response) {
    const credential = response.credential;
    const payload = JSON.parse(atob(credential.split(".")[1]));
    setToken(credential);
    setUsuario({ nome: payload.name, email: payload.email, foto: payload.picture });
    const renovarEm = payload.exp * 1000 - Date.now() - 5 * 60 * 1000;
    if (renovarEm > 0) {
      setTimeout(() => {
        if (window.google) {
          window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleResponse, ux_mode: "popup" });
          window.google.accounts.id.prompt(() => {});
        }
      }, renovarEm);
    }
  }

  function renderBotaoGoogle(el) {
    if (!el || !window.google || !GOOGLE_CLIENT_ID) return;
    window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleResponse, ux_mode: "popup" });
    window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with", locale: "pt-BR", width: 280 });
  }

  function logout() {
    setUsuario(null); setToken(null); setStep("input"); setResultado(null);
    setTexto(""); setArquivo(null); setImagens([]); setNumeroProposta(""); setErro("");
    setPagina("nova"); setNovaOCPayload(null); setShowDocs(false);
  }

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      const msgs = files.filter((f) => f.name.toLowerCase().endsWith(".msg") || f.name.toLowerCase().endsWith(".eml"));
      if (imgs.length > 0) { setImagens((prev) => [...prev, ...imgs].slice(0, 6)); return; }
      if (msgs.length > 0) { setArquivo(msgs[0]); setTexto(""); return; }
      setArquivo(files[0]); setTexto(""); return;
    }
    const plain = e.dataTransfer.getData("text/plain");
    const html = e.dataTransfer.getData("text/html");
    if (plain?.trim()) { setTexto(plain.trim()); setArquivo(null); }
    else if (html) {
      const tmp = document.createElement("div"); tmp.innerHTML = html;
      const txt = tmp.innerText || tmp.textContent || "";
      if (txt.trim()) { setTexto(txt.trim()); setArquivo(null); }
    }
  }, []);

  function handleArquivo(e) {
    const f = e.target.files[0];
    if (f) { setArquivo(f); setTexto(""); }
  }

  async function processar() {
    if (!numeroProposta.trim()) { setErro("Informe o número da proposta."); return; }
    if (!texto.trim() && !arquivo && imagens.length === 0) {
      setErro("Cole o texto, arraste um .msg, cole uma imagem (Ctrl+V) ou envie prints."); return;
    }
    setErro(""); setLoading(true);
    try {
      const form = new FormData();
      form.append("numero_proposta", numeroProposta);
      if (arquivo) form.append("arquivo", arquivo);
      else if (texto) form.append("texto", texto);
      imagens.forEach((img) => form.append("imagens", img));

      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 90000);
      let res;
      try {
        res = await fetch(`${API}/extrair`, { method: "POST", headers: authHeaders(), body: form, signal: controller.signal });
      } catch (fe) {
        clearTimeout(tid);
        if (fe.name === "AbortError") throw new Error("Tempo limite (90s). Tente com um e-mail mais curto.");
        throw fe;
      }
      clearTimeout(tid);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `Erro HTTP ${res.status}` }));
        if (res.status === 401 || res.status === 403) { setErro("Sessão expirada. Faça login novamente."); logout(); return; }
        throw new Error(err.detail || "Erro no servidor");
      }
      const data = await res.json();
      setResultado(data); setStep("resultado");
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); }
  }

  function atualizarItem(index, campo, valor) {
    setResultado((prev) => ({ ...prev, itens: prev.itens.map((item, i) => (i === index ? { ...item, [campo]: valor } : item)) }));
  }

  async function baixarCSV() {
    setLoading(true); setSalvandoBanco(true); setBancoInfo(null);
    try {
      const itensCom = resultado.itens.filter((i) => i.preco_un > 0);
      if (itensCom.length > 0) {
        try {
          const resBanco = await fetch(`${API}/upsert-precos`, {
            method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(resultado),
          });
          if (resBanco.ok) setBancoInfo(await resBanco.json());
        } catch (e) { console.warn("Aviso banco:", e); }
      }
      try {
        await fetch(`${API}/salvar-proposta`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ ...resultado, usuario_nome: usuario.nome }),
        });
      } catch (e) { console.warn("Aviso salvar proposta:", e); }
      setSalvandoBanco(false);
      const res = await fetch(`${API}/gerar-csv`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(resultado),
      });
      if (!res.ok) throw new Error("Erro ao gerar CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `proposta_${resultado.proposta}.csv`; a.click();
      URL.revokeObjectURL(url); setStep("download");
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); setSalvandoBanco(false); }
  }

  function reiniciar() {
    setStep("input"); setResultado(null); setBancoInfo(null);
    setTexto(""); setArquivo(null); setImagens([]); setNumeroProposta(""); setErro("");
    fetch(`${API}/proxima-proposta`).then((r) => r.json())
      .then((d) => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
  }

  function navegar(k) {
    if (k === "docs") { setShowDocs(true); return; }
    setShowDocs(false); setPagina(k);
  }
  const activeNav = showDocs ? "docs" : pagina;

  // ── TELA DE LOGIN ─────────────────────────────────────────────────────────
  if (!usuario) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper font-sans">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-10 text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-kist">
            <span className="font-mono text-xl font-semibold text-white">K</span>
          </div>
          <h1 className="text-[18px] font-semibold tracking-tight text-ink">Kist · Cabine</h1>
          <p className="mb-8 mt-1 text-[13px] text-sub">Entre com sua conta Google para acessar.</p>
          <div ref={(el) => { if (el) { if (window.google) renderBotaoGoogle(el); else { const t = setInterval(() => { if (window.google) { clearInterval(t); renderBotaoGoogle(el); } }, 100); setTimeout(() => clearInterval(t), 5000); } } }}
            className="mb-3 flex min-h-[44px] items-center justify-center"></div>
          <p className="text-[11.5px] text-faint">Acesso restrito à equipe Kist</p>
        </div>
      </div>
    );
  }

  // ── APP PRINCIPAL ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-paper font-sans text-ink antialiased">
      <Sidebar active={activeNav} onNavigate={navegar} usuario={usuario} stats={stats} onLogout={logout} />

      <main className="flex-1 overflow-auto">
        {showDocs ? (
          <div className="mx-auto max-w-5xl px-8 py-9"><Docs /></div>
        ) : pagina === "propostas" ? (
          <Propostas token={token} usuario={usuario}
            onCriarOC={(proposta, itens, po) => { setNovaOCPayload({ proposta, itens, po }); setPagina("ordens"); }} />
        ) : pagina === "ordens" ? (
          <OrdensCompra token={token} usuario={usuario}
            novaOC={novaOCPayload}
            onNovaOCProcessada={() => setNovaOCPayload(null)} />
        ) : (
          <div className="mx-auto max-w-5xl px-8 py-9">

            {/* INPUT */}
            {step === "input" && (
              <div className="mx-auto max-w-2xl rise">
                <PageHeader eyebrow="Etapa 1 de 3 · Entrada" title="Nova proposta"
                  sub="Arraste o .msg do Outlook, cole prints com Ctrl+V ou cole o texto do e-mail." />

                <div className="mt-7 space-y-5 rounded-2xl border border-line bg-surface p-6">
                  <div>
                    <label className="mb-1.5 block text-[12.5px] font-medium text-ink">
                      Número da proposta <span className="text-rose">*</span>
                    </label>
                    <input
                      className="w-full rounded-lg border border-line2 bg-paper px-3 py-2.5 font-mono text-[13.5px] text-ink cell-input"
                      placeholder="ex: 1050370" value={numeroProposta}
                      onChange={(e) => setNumeroProposta(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[12.5px] font-medium text-ink">E-mail ou prints da cotação</label>
                    <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                      onClick={() => !arquivo && !texto && imagens.length === 0 && fileRef.current.click()}
                      className={`cursor-pointer rounded-xl border-2 border-dashed transition-all
                        ${isDragging ? "border-kist bg-kist/[0.04]"
                          : imagens.length > 0 ? "border-kist/40 bg-kist/[0.03]"
                          : arquivo ? "border-kist/40 bg-kist/[0.03]"
                          : "border-line2 bg-paper hover:border-faint"}`}>
                      {imagens.length > 0 ? (
                        <div className="p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[12px] font-medium text-kist">{imagens.length} print(s) — cole mais com Ctrl+V</span>
                            <button onClick={(e) => { e.stopPropagation(); setImagens([]); }} className="text-[11px] text-faint hover:text-rose">limpar tudo</button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {imagens.map((img, i) => (
                              <div key={i} className="group/img relative">
                                <img src={URL.createObjectURL(img)} alt="" className="h-16 w-16 rounded-lg border border-line object-cover" />
                                <button onClick={(e) => { e.stopPropagation(); setImagens((prev) => prev.filter((_, j) => j !== i)); }}
                                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-rose text-[10px] text-white group-hover/img:flex">✕</button>
                              </div>
                            ))}
                            {imagens.length < 6 && (
                              <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-line2 text-center text-[10px] text-faint">+Ctrl+V</div>
                            )}
                          </div>
                        </div>
                      ) : arquivo ? (
                        <div className="flex items-center justify-between p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kist/10 text-kist"><IconUpload size={18} /></div>
                            <div>
                              <div className="text-[13px] font-medium text-ink">{arquivo.name}</div>
                              <div className="font-mono text-[11px] text-faint">{(arquivo.size / 1024).toFixed(0)} KB</div>
                            </div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setArquivo(null); }} className="px-2 text-faint hover:text-rose"><IconX size={16} /></button>
                        </div>
                      ) : texto ? (
                        <div className="p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[12px] font-medium text-sub">Texto colado</span>
                            <button onClick={() => setTexto("")} className="text-[11px] text-faint hover:text-rose">limpar</button>
                          </div>
                          <p className="line-clamp-3 font-mono text-[11.5px] text-sub">{texto.slice(0, 200)}…</p>
                        </div>
                      ) : (
                        <div className="px-6 py-10 text-center">
                          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-kist/10 text-kist"><IconUpload size={20} /></div>
                          <div className="text-[13.5px] font-medium text-ink">{isDragging ? "Solte aqui" : "Arraste o e-mail ou prints"}</div>
                          <div className="mt-1 text-[12px] text-sub">
                            Cole prints com <kbd className="rounded border border-line2 bg-surface px-1.5 py-0.5 font-mono text-[10.5px]">Ctrl</kbd>{" "}
                            <kbd className="rounded border border-line2 bg-surface px-1.5 py-0.5 font-mono text-[10.5px]">V</kbd>
                          </div>
                          <div className="mt-1 text-[11.5px] text-faint">Aceita .msg · PNG/JPG (até 6) · PDF · Excel</div>
                          <button onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }} className={`${btnGhost} mt-3`}>Procurar arquivo</button>
                        </div>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept=".msg,.eml" className="hidden" onChange={handleArquivo} />
                  </div>

                  <div className="relative py-1 text-center">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
                    <span className="relative bg-surface px-3 text-[11px] eyebrow uppercase text-faint">ou cole o texto</span>
                  </div>

                  <textarea rows={5}
                    className="w-full resize-none rounded-lg border border-line2 bg-paper px-3 py-2.5 font-mono text-[12.5px] text-ink cell-input"
                    placeholder="Cole aqui o conteúdo do e-mail de cotação…" value={texto}
                    onChange={(e) => { setTexto(e.target.value); setArquivo(null); }} />

                  {erro && <div className="rounded-lg border border-rose/30 bg-rosebg px-4 py-3 text-[13px] text-rose">{erro}</div>}

                  <button onClick={processar} disabled={loading} className={`${btnPrimary} w-full justify-center py-2.5`}>
                    {loading
                      ? <><span className="inline-block animate-spin"><IconBolt size={15} /></span> Extraindo e cruzando com o banco…</>
                      : <>Processar e-mail <IconArrow size={15} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* RESULTADO */}
            {step === "resultado" && resultado && (
              <div className="rise">
                <PageHeader eyebrow="Etapa 2 de 3 · Revisão"
                  title={`Proposta ${resultado.proposta}`}
                  sub={<span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{resultado.cliente}</span>
                    {resultado.cnpj && <span className="font-mono text-[12px] text-faint">{resultado.cnpj}</span>}
                    {resultado.rc_neg && <span className="rounded-md bg-paper px-2 py-0.5 font-mono text-[11px] text-sub">{resultado.rc_neg}</span>}
                  </span>}
                  actions={<>
                    <button onClick={reiniciar} className={btnGhost}>Recomeçar</button>
                    <button onClick={baixarCSV} disabled={loading || salvandoBanco} className={btnPrimary}>
                      {salvandoBanco
                        ? <><span className="inline-block animate-spin"><IconBolt size={15} /></span> Salvando…</>
                        : loading ? "Gerando…" : <><IconDownload size={15} /> Confirmar e baixar CSV</>}
                    </button>
                  </>} />

                <div className="mt-6"><CertaintyStrip itens={resultado.itens} /></div>

                {/* Dados da proposta para o Tiny — preenchidos aqui, exportados no CSV */}
                <div className="mt-4 rounded-xl border border-line bg-surface p-4">
                  <div className="eyebrow text-[10px] font-bold uppercase text-faint">Dados da proposta (Tiny)</div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="block">
                      <div className="text-[11.5px] text-sub">Prazo de entrega</div>
                      <input value={resultado.prazo_entrega || ""}
                        onChange={(e) => setResultado((p) => ({ ...p, prazo_entrega: e.target.value }))}
                        placeholder="ex: 15 dias úteis"
                        className="mt-1 w-full rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />
                    </label>
                    <label className="block">
                      <div className="text-[11.5px] text-sub">Frete (R$)</div>
                      <input inputMode="decimal" value={resultado.frete ?? ""}
                        onChange={(e) => setResultado((p) => ({ ...p, frete: e.target.value }))}
                        placeholder="0,00"
                        className="mt-1 w-full rounded-lg border border-line2 bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />
                    </label>
                  </div>
                </div>

                {erro && <div className="mt-3 rounded-lg border border-rose/30 bg-rosebg px-4 py-3 text-[13px] text-rose">{erro}</div>}

                <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line bg-paper/70">
                        <th className="w-1 p-0" />
                        <th className="py-2.5 pl-4 pr-2 text-center text-[10.5px] font-semibold uppercase eyebrow text-faint">#</th>
                        <th className="py-2.5 pr-3 text-left text-[10.5px] font-semibold uppercase eyebrow text-faint">Descrição</th>
                        <th className="py-2.5 pr-3 text-right text-[10.5px] font-semibold uppercase eyebrow text-faint">Qtd</th>
                        <th className="py-2.5 pr-3 text-left text-[10.5px] font-semibold uppercase eyebrow text-faint">Un</th>
                        <th className="py-2.5 pr-4 text-right text-[10.5px] font-semibold uppercase eyebrow text-faint">Preço un.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.itens.map((item, i) => (
                        <ItemRow key={i} item={item} index={i} onChange={atualizarItem} token={token} apiUrl={API} />
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-line bg-paper/50 px-4 py-3">
                    <span className="text-[12px] text-faint">Clique em qualquer campo para editar · preços salvos no banco ao confirmar</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] uppercase eyebrow text-faint">Total estimado</span>
                      <span className="font-mono text-[16px] font-semibold text-ink">
                        R$ {brl(resultado.itens.reduce((s, i) => s + (i.preco_un || 0) * (parseFloat(i.quantidade) || 0), 0))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Custo & lucro — uso INTERNO, não vai para o CSV do Tiny */}
                {(() => {
                  const num = (v) => { let s = String(v ?? "").trim(); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); return parseFloat(s) || 0; };
                  const prodVenda = resultado.itens.reduce((s, i) => s + (i.preco_un || 0) * (parseFloat(i.quantidade) || 0), 0);
                  const prodCusto = resultado.itens.reduce((s, i) => s + (i.preco_custo || 0) * (parseFloat(i.quantidade) || 0), 0);
                  const custoFreteItens = resultado.itens.reduce((s, i) => s + num(i.frete_vinda), 0); // frete único por item, SEM ×qtd
                  const freteCobr = num(resultado.frete);
                  const base = prodVenda + freteCobr;
                  const lucro = base - prodCusto - custoFreteItens;
                  const margem = base > 0 ? (lucro / base) * 100 : 0;
                  const temCusto = prodCusto > 0 || custoFreteItens > 0;
                  return (
                    <div className="mt-4 rounded-xl border border-line bg-surface p-4">
                      <div className="flex items-center justify-between">
                        <div className="eyebrow text-[10px] font-bold uppercase text-faint">Custo & lucro · uso interno</div>
                        <span className="rounded-md bg-paper px-2 py-0.5 text-[10px] font-medium text-faint">não exportado pro Tiny</span>
                      </div>
                      <div className="mt-3 rounded-lg bg-paper p-3 text-[12px]">
                        <div className="flex justify-between text-sub"><span>Venda (produtos)</span><span className="font-mono">R$ {brl(prodVenda)}</span></div>
                        {freteCobr > 0 && <div className="flex justify-between text-sub"><span>+ Frete cobrado</span><span className="font-mono">R$ {brl(freteCobr)}</span></div>}
                        <div className="flex justify-between text-sub"><span>− Custo (produtos)</span><span className="font-mono">R$ {brl(prodCusto)}</span></div>
                        {custoFreteItens > 0 && <div className="flex justify-between text-sub"><span>− Frete (custo)</span><span className="font-mono">R$ {brl(custoFreteItens)}</span></div>}
                        <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
                          <span className="font-medium text-ink">Previsão de lucro</span>
                          <span className={`font-mono text-[16px] font-semibold ${lucro >= 0 ? "text-signal" : "text-rose"}`}>R$ {brl(lucro)}</span>
                        </div>
                        <div className="text-right text-[10.5px] text-faint">{temCusto ? `${margem.toFixed(0)}% margem` : "informe os custos dos itens"}</div>
                      </div>
                      <div className="mt-2 text-[10.5px] text-faint">O frete de custo de cada item entra no campo “Frete (item)”, junto da origem do preço.</div>
                    </div>
                  );
                })()}
              </div>
            )}
            {step === "download" && (
              <div className="mx-auto max-w-md py-16 text-center rise">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-signalbg text-signal"><IconCheck size={26} /></div>
                <h2 className="text-[22px] font-semibold tracking-tight text-ink">CSV pronto</h2>
                <p className="mx-auto mt-2 max-w-xs text-[13.5px] text-sub">
                  O arquivo <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px] text-ink">proposta_{resultado?.proposta}.csv</code> foi baixado e está pronto para importar no Tiny.
                </p>
                {bancoInfo && (
                  <div className="mx-auto mt-5 max-w-xs rounded-lg border border-signal/30 bg-signalbg px-4 py-3 text-left text-[12.5px] text-signal">
                    Banco atualizado — <strong>{bancoInfo.atualizados}</strong> preços atualizados, <strong>{bancoInfo.inseridos}</strong> novos inseridos.
                  </div>
                )}
                <button onClick={reiniciar} className={`${btnPrimary} mt-6`}>Processar outra proposta</button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
