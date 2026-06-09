import { useState, useRef, useCallback, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const CONFIANCA_STYLE = {
  alta:   "bg-emerald-100 text-emerald-700",
  media:  "bg-blue-100 text-blue-700",
  baixa:  "bg-amber-100 text-amber-700",
  nenhuma:"bg-red-50 text-red-500",
};
const CONFIANCA_LABEL = { alta: "✓ exato", media: "~ similar", baixa: "⚠ incerto", nenhuma: "sem match" };

function Badge({ count, tipo }) {
  const cores = { total:"bg-slate-100 text-slate-700", preco:"bg-emerald-100 text-emerald-700", sem:"bg-amber-100 text-amber-700" };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cores[tipo]}`}>{count}</span>;
}

function ItemRow({ item, index, onChange, token, apiUrl }) {
  const [loadingPn, setLoadingPn] = useState(false);
  const [sugestoes, setSugestoes] = useState(null);
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);
  const [mostrarSpecs, setMostrarSpecs] = useState(false);

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

  return (
    <>
      <tr className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
        <td className="px-3 py-2 text-xs text-slate-400 w-8">{index + 1}</td>
        <td className="px-3 py-2">
          <input className="w-full text-sm border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5"
            value={item.descricao_final} onChange={e => onChange(index, "descricao_final", e.target.value)} />
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs px-1.5 py-0.5 rounded ${CONFIANCA_STYLE[confianca]}`}>
              {CONFIANCA_LABEL[confianca]}
            </span>
            {item.obs && <span className="text-xs text-slate-400 truncate max-w-[200px]">{item.obs}</span>}
            {item.sugerir_pn && (
              <button onClick={buscarSugestoes} disabled={loadingPn}
                className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50">
                {loadingPn ? "⟳ buscando..." : "✦ Sugerir PN"}
              </button>
            )}
            {item.specs_complementares && (
              <button onClick={() => setMostrarSpecs(v => !v)} className="text-xs text-slate-400 hover:text-slate-600">
                {mostrarSpecs ? "▲ ocultar specs" : "▼ specs originais"}
              </button>
            )}
          </div>
          {mostrarSpecs && item.specs_complementares && (
            <div className="mt-1 text-xs text-slate-500 bg-slate-50 rounded p-2 font-mono whitespace-pre-wrap border border-slate-200">
              {item.specs_complementares}
            </div>
          )}
        </td>
        <td className="px-3 py-2 w-16">
          <input type="number" className="w-full text-xs text-center border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5"
            value={item.quantidade} onChange={e => onChange(index, "quantidade", parseFloat(e.target.value))} />
        </td>
        <td className="px-3 py-2 w-14">
          <input className="w-full text-xs text-center border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5"
            value={item.unidade} onChange={e => onChange(index, "unidade", e.target.value)} />
        </td>
        <td className="px-3 py-2 w-28">
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400">R$</span>
            <input type="number" step="0.001"
              className={`w-full text-xs text-right border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5 ${item.preco_un > 0 ? "text-slate-800" : "text-amber-600 font-medium"}`}
              value={item.preco_un} onChange={e => onChange(index, "preco_un", parseFloat(e.target.value) || 0)} />
          </div>
        </td>
      </tr>
      {mostrarSugestoes && (
        <tr className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
          <td></td>
          <td colSpan={4} className="px-3 pb-3">
            <div className="border border-blue-200 rounded-lg bg-blue-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-blue-700">Sugestões de PN / modelo</span>
                <button onClick={() => setMostrarSugestoes(false)} className="text-xs text-slate-400 hover:text-red-400">✕</button>
              </div>
              {loadingPn ? (
                <div className="text-xs text-slate-500 py-2">Consultando...</div>
              ) : sugestoes && sugestoes.length > 0 ? (
                <div className="space-y-2">
                  {sugestoes.map((s, i) => (
                    <div key={i} className="bg-white rounded-lg border border-blue-100 p-2.5 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-slate-800">{s.fabricante} {s.modelo}</span>
                          {s.atende_fabricante && <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">✓ fabricante ok</span>}
                        </div>
                        <div className="text-xs text-slate-500 mb-1">{s.specs}</div>
                        {s.preco_estimado > 0 && (
                          <div className="text-xs text-slate-600">Estimado: <span className="font-medium">R$ {s.preco_estimado.toLocaleString("pt-BR", {minimumFractionDigits:2})}</span></div>
                        )}
                      </div>
                      <button onClick={() => aplicarSugestao(s)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg flex-shrink-0">
                        Usar
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-2">Nenhuma sugestão encontrada.</div>
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
      .then(r => r.json()).then(setStats).catch(() => {});
    fetch(`${API}/proxima-proposta`)
      .then(r => r.json()).then(d => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
    // Keep-alive a cada 9 min
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
        setImagens(prev => [...prev, ...imgs].slice(0, 6));
        setArquivo(null);
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [usuario]);

  function handleGoogleResponse(response) {
    const credential = response.credential;
    const payload = JSON.parse(atob(credential.split('.')[1]));
    setToken(credential);
    setUsuario({ nome: payload.name, email: payload.email, foto: payload.picture });
    // Renovar token 5 min antes de expirar
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
  }

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      const imgs = files.filter(f => f.type.startsWith("image/"));
      const msgs = files.filter(f => f.name.toLowerCase().endsWith(".msg") || f.name.toLowerCase().endsWith(".eml"));
      if (imgs.length > 0) { setImagens(prev => [...prev, ...imgs].slice(0, 6)); return; }
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
      imagens.forEach(img => form.append("imagens", img));

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
    setResultado(prev => ({ ...prev, itens: prev.itens.map((item, i) => i === index ? { ...item, [campo]: valor } : item) }));
  }

  async function baixarCSV() {
    setLoading(true); setSalvandoBanco(true); setBancoInfo(null);
    try {
      const itensCom = resultado.itens.filter(i => i.preco_un > 0);
      if (itensCom.length > 0) {
        try {
          const resBanco = await fetch(`${API}/upsert-precos`, {
            method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(resultado),
          });
          if (resBanco.ok) setBancoInfo(await resBanco.json());
        } catch (e) { console.warn("Aviso banco:", e); }
      }
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
    fetch(`${API}/proxima-proposta`).then(r => r.json())
      .then(d => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
  }

  // ── TELA DE LOGIN ─────────────────────────────────────────────────────────
  if (!usuario) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans">
        <div className="bg-white rounded-2xl border border-slate-200 p-10 w-full max-w-sm text-center shadow-sm">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <span className="text-white font-bold text-2xl">K</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-1">Kist Propostas</h1>
          <p className="text-sm text-slate-500 mb-8">Faça login com sua conta Google para acessar</p>
          <div ref={el => { if (el) { if (window.google) renderBotaoGoogle(el); else { const t = setInterval(() => { if (window.google) { clearInterval(t); renderBotaoGoogle(el); } }, 100); setTimeout(() => clearInterval(t), 5000); } } }}
            className="flex justify-center min-h-[44px] items-center mb-3"></div>
          <p className="text-xs text-slate-400">Acesso restrito à equipe Kist</p>
        </div>
      </div>
    );
  }

  // ── APP PRINCIPAL ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">K</span>
            </div>
            <div>
              <div className="font-semibold text-slate-800 text-sm">Kist Soluções</div>
              <div className="text-xs text-slate-400">Gerador de Propostas</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {stats && (
              <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500">
                <span>{stats.total_produtos?.toLocaleString()} produtos no banco</span>
                {stats.desatualizados_90d > 0 && <span className="text-amber-500">⚠ {stats.desatualizados_90d} desatualizados</span>}
              </div>
            )}
            <div className="flex items-center gap-2">
              {usuario.foto && <img src={usuario.foto} alt="" className="w-7 h-7 rounded-full" />}
              <span className="text-xs text-slate-600 hidden sm:block">{usuario.nome}</span>
              <button onClick={logout} className="text-xs text-slate-400 hover:text-red-400 ml-1">Sair</button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* INPUT */}
        {step === "input" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-800 mb-1">Nova proposta</h1>
              <p className="text-slate-500 text-sm">Arraste o e-mail, cole prints (Ctrl+V) ou envie arquivo .msg</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Número da proposta <span className="text-red-400">*</span></label>
                <input className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ex: 1050370" value={numeroProposta} onChange={e => setNumeroProposta(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">E-mail ou prints de cotação</label>
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => !arquivo && !texto && imagens.length === 0 && fileRef.current.click()}
                  className={`border-2 border-dashed rounded-xl transition-all cursor-pointer ${isDragging ? "border-blue-400 bg-blue-50 scale-[1.01]" : imagens.length > 0 ? "border-violet-300 bg-violet-50" : arquivo ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}>
                  {imagens.length > 0 ? (
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-violet-700">{imagens.length} print(s) — cole mais com Ctrl+V</span>
                        <button onClick={e => { e.stopPropagation(); setImagens([]); }} className="text-xs text-slate-400 hover:text-red-400">limpar tudo</button>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {imagens.map((img, i) => (
                          <div key={i} className="relative group">
                            <img src={URL.createObjectURL(img)} alt="" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                            <button onClick={e => { e.stopPropagation(); setImagens(prev => prev.filter((_, j) => j !== i)); }}
                              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center">✕</button>
                          </div>
                        ))}
                        {imagens.length < 6 && (
                          <div className="w-16 h-16 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-xs text-center">
                            +Ctrl+V
                          </div>
                        )}
                      </div>
                    </div>
                  ) : arquivo ? (
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 text-lg">📧</div>
                        <div><div className="text-sm font-medium text-slate-700">{arquivo.name}</div><div className="text-xs text-slate-400">{(arquivo.size/1024).toFixed(0)} KB</div></div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setArquivo(null); }} className="text-slate-400 hover:text-red-400 text-lg px-2">✕</button>
                    </div>
                  ) : texto ? (
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500">Texto colado</span>
                        <button onClick={() => setTexto("")} className="text-slate-400 hover:text-red-400 text-xs">limpar</button>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-3 font-mono">{texto.slice(0,200)}...</p>
                    </div>
                  ) : (
                    <div className="p-8 text-center">
                      <div className="text-4xl mb-3">📨</div>
                      <p className="text-sm font-medium text-slate-600 mb-1">{isDragging ? "Solte aqui!" : "Arraste o e-mail ou prints"}</p>
                      <p className="text-xs text-slate-400 mb-1">Cole prints com <kbd className="bg-slate-100 px-1 rounded">Ctrl+V</kbd></p>
                      <p className="text-xs text-slate-400 mb-3">Aceita .msg, imagens PNG/JPG (até 6)</p>
                      <button onClick={e => { e.stopPropagation(); fileRef.current.click(); }}
                        className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg">Procurar arquivo</button>
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".msg,.eml" className="hidden" onChange={handleArquivo} />
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">ou cole o texto do e-mail</span></div>
              </div>
              <textarea rows={6}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
                placeholder="Cole aqui o conteúdo do e-mail..." value={texto}
                onChange={e => { setTexto(e.target.value); setArquivo(null); }} />
              {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{erro}</div>}
              <button onClick={processar} disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
                {loading ? <><span className="animate-spin inline-block">⟳</span> Processando (matching IA)...</> : "Processar e-mail"}
              </button>
            </div>
          </div>
        )}

        {/* RESULTADO */}
        {step === "resultado" && resultado && (
          <div>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-xl font-bold text-slate-800">Proposta {resultado.proposta}</h1>
                  <Badge count={resultado.total_itens} tipo="total" />
                  <Badge count={resultado.com_preco} tipo="preco" />
                  {resultado.sem_preco > 0 && <Badge count={resultado.sem_preco} tipo="sem" />}
                </div>
                <div className="text-sm text-slate-500">
                  <span className="font-medium text-slate-700">{resultado.cliente}</span>
                  {resultado.cnpj && <span className="ml-2 text-slate-400">{resultado.cnpj}</span>}
                  {resultado.rc_neg && <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">{resultado.rc_neg}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={reiniciar} className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600">Nova proposta</button>
                <button onClick={baixarCSV} disabled={loading || salvandoBanco}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg font-medium flex items-center gap-1.5">
                  {salvandoBanco ? <><span className="animate-spin inline-block">⟳</span> Salvando...</> : loading ? "Gerando..." : "⬇ Confirmar e baixar CSV"}
                </button>
              </div>
            </div>

            {resultado.sem_preco > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-3 text-sm text-amber-700">
                <strong>{resultado.sem_preco} {resultado.sem_preco === 1 ? "item" : "itens"} sem preço</strong> — preencha manualmente ou deixe zerado para cotar depois.
              </div>
            )}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3 text-sm text-blue-700">
              💾 Ao confirmar, os preços serão salvos automaticamente no banco.
            </div>
            {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3 text-sm text-red-600">{erro}</div>}

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-400 w-8">#</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500">Descrição</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-slate-500 w-16">Qtd</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-slate-500 w-14">Un</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 w-28">Preço unit.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resultado.itens.map((item, i) => (
                    <ItemRow key={i} item={item} index={i} onChange={atualizarItem} token={token} apiUrl={API} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
              <span><span className={`inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1`}></span>✓ exato</span>
              <span><span className={`inline-block w-2 h-2 rounded-full bg-blue-400 mr-1`}></span>~ similar</span>
              <span><span className={`inline-block w-2 h-2 rounded-full bg-amber-400 mr-1`}></span>⚠ incerto</span>
              <span><span className={`inline-block w-2 h-2 rounded-full bg-red-300 mr-1`}></span>sem match</span>
              <span className="ml-auto">Clique em qualquer campo para editar</span>
            </div>
          </div>
        )}

        {/* DOWNLOAD */}
        {step === "download" && (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">✓</span></div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">CSV baixado!</h2>
            <p className="text-slate-500 text-sm mb-4">Arquivo <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">proposta_{resultado?.proposta}.csv</code> pronto para importar no Tiny.</p>
            {bancoInfo && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-6 text-sm text-emerald-700">
                💾 Banco atualizado — <strong>{bancoInfo.atualizados}</strong> preços atualizados, <strong>{bancoInfo.inseridos}</strong> novos inseridos
              </div>
            )}
            <button onClick={reiniciar} className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-lg text-sm">
              Processar outra proposta
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
