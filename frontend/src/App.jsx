import { useState, useRef, useCallback, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

function Badge({ count, tipo }) {
  const cores = { total:"bg-slate-100 text-slate-700", preco:"bg-emerald-100 text-emerald-700", sem:"bg-amber-100 text-amber-700" };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cores[tipo]}`}>{count}</span>;
}

function ItemRow({ item, index, onChange, token, apiUrl }) {
  const [loadingPn, setLoadingPn] = useState(false);
  const [sugestoes, setSugestoes] = useState(null);
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);

  async function buscarSugestoes() {
    setLoadingPn(true);
    setSugestoes(null);
    setMostrarSugestoes(true);
    try {
      const res = await fetch(`${apiUrl}/sugerir-pn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ descricao: item.descricao_final }),
      });
      const data = await res.json();
      setSugestoes(data.sugestoes || []);
    } catch (e) {
      setSugestoes([]);
    } finally {
      setLoadingPn(false);
    }
  }

  function aplicarSugestao(s) {
    onChange(index, "descricao_final", `${s.fabricante} ${s.modelo} ${s.specs}`);
    if (s.preco_estimado > 0) onChange(index, "preco_un", s.preco_estimado);
    setMostrarSugestoes(false);
    setSugestoes(null);
  }

  return (
    <>
      <tr className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
        <td className="px-4 py-2 text-sm text-slate-400 w-8">{index + 1}</td>
        <td className="px-4 py-2">
          <input className="w-full text-sm border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5" value={item.descricao_final} onChange={e => onChange(index, "descricao_final", e.target.value)} />
          {item.sugerir_pn && (
            <button
              onClick={buscarSugestoes}
              disabled={loadingPn}
              className="mt-1 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50"
            >
              {loadingPn ? <><span className="animate-spin inline-block">⟳</span> Buscando PN...</> : "✦ Sugerir PN / modelo"}
            </button>
          )}
        </td>
        <td className="px-4 py-2 w-20">
          <input type="number" className="w-full text-sm text-center border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5" value={item.quantidade} onChange={e => onChange(index, "quantidade", parseFloat(e.target.value))} />
        </td>
        <td className="px-4 py-2 w-16">
          <input className="w-full text-sm text-center border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5" value={item.unidade} onChange={e => onChange(index, "unidade", e.target.value)} />
        </td>
        <td className="px-4 py-2 w-32">
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400">R$</span>
            <input type="number" step="0.001" className={`w-full text-sm text-right border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5 ${item.preco_un > 0 ? "text-slate-800" : "text-amber-600 font-medium"}`} value={item.preco_un} onChange={e => onChange(index, "preco_un", parseFloat(e.target.value) || 0)} />
          </div>
        </td>
        <td className="px-4 py-2 w-8">
          <div className={`w-2 h-2 rounded-full mx-auto ${item.preco_un > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
        </td>
      </tr>
      {mostrarSugestoes && (
        <tr className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
          <td></td>
          <td colSpan={5} className="px-4 pb-3">
            <div className="border border-blue-200 rounded-lg bg-blue-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-blue-700">Sugestões de PN / modelo</span>
                <button onClick={() => setMostrarSugestoes(false)} className="text-xs text-slate-400 hover:text-red-400">✕ fechar</button>
              </div>
              {loadingPn ? (
                <div className="text-xs text-slate-500 py-2">Consultando banco e gerando sugestões...</div>
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
                      <button
                        onClick={() => aplicarSugestao(s)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors"
                      >
                        Usar
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-2">Nenhuma sugestão encontrada. Verifique a descrição.</div>
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
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    return () => document.head.removeChild(script);
  }, []);

  // Stats e próximo número (só após login)
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/banco/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setStats).catch(() => {});
    fetch(`${API}/proxima-proposta`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
  }, [token]);

  function handleGoogleResponse(response) {
    const credential = response.credential;
    // Decodificar JWT para pegar nome/email (sem verificar — só display)
    const payload = JSON.parse(atob(credential.split('.')[1]));
    setToken(credential);
    setUsuario({ nome: payload.name, email: payload.email, foto: payload.picture });
  }

  function renderBotaoGoogle(el) {
    if (!el || !window.google || !GOOGLE_CLIENT_ID) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
      ux_mode: "popup",
    });
    window.google.accounts.id.renderButton(el, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      locale: "pt-BR",
      width: 280,
    });
  }

  function logout() {
    setUsuario(null); setToken(null);
    setStep("input"); setResultado(null);
    setTexto(""); setArquivo(null);
    setNumeroProposta(""); setErro("");
  }

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) { setArquivo(files[0]); setTexto(""); return; }
    const plain = e.dataTransfer.getData("text/plain");
    const html = e.dataTransfer.getData("text/html");
    if (plain?.trim()) { setTexto(plain.trim()); setArquivo(null); }
    else if (html) {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
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
    if (!texto.trim() && !arquivo) { setErro("Cole o texto, arraste ou envie um arquivo .msg"); return; }
    setErro(""); setLoading(true);
    try {
      const form = new FormData();
      form.append("numero_proposta", numeroProposta);
      if (arquivo) form.append("arquivo", arquivo);
      else form.append("texto", texto);
      const res = await fetch(`${API}/extrair`, { method: "POST", headers: authHeaders(), body: form });
      if (!res.ok) {
        const err = await res.json();
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
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(resultado),
          });
          if (resBanco.ok) setBancoInfo(await resBanco.json());
        } catch (e) { console.warn("Aviso banco:", e); }
      }
      setSalvandoBanco(false);
      const res = await fetch(`${API}/gerar-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(resultado),
      });
      if (!res.ok) throw new Error("Erro ao gerar CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `proposta_${resultado.proposta}.csv`; a.click();
      URL.revokeObjectURL(url);
      setStep("download");
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); setSalvandoBanco(false); }
  }

  function reiniciar() {
    setStep("input"); setResultado(null); setBancoInfo(null);
    setTexto(""); setArquivo(null); setNumeroProposta(""); setErro("");
    fetch(`${API}/proxima-proposta`, { headers: authHeaders() })
      .then(r => r.json()).then(d => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
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
          <div
            ref={el => { if (el) { if (window.google) { renderBotaoGoogle(el); } else { const t = setInterval(() => { if (window.google) { clearInterval(t); renderBotaoGoogle(el); } }, 100); setTimeout(() => clearInterval(t), 5000); } } }}
            className="flex justify-center min-h-[44px] items-center"
          ></div>
          <p className="text-xs text-slate-400 mt-4">Acesso restrito à equipe Kist</p>
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
              <button onClick={logout} className="text-xs text-slate-400 hover:text-red-400 ml-1 transition-colors">Sair</button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {step === "input" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-800 mb-1">Nova proposta</h1>
              <p className="text-slate-500 text-sm">Arraste o e-mail do Outlook, faça upload do .msg ou cole o texto</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Número da proposta <span className="text-red-400">*</span></label>
                <input className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="ex: 1050370" value={numeroProposta} onChange={e => setNumeroProposta(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">E-mail de cotação</label>
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={() => !arquivo && !texto && fileRef.current.click()}
                  className={`border-2 border-dashed rounded-xl transition-all cursor-pointer ${isDragging ? "border-blue-400 bg-blue-50 scale-[1.01]" : arquivo ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}>
                  {arquivo ? (
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
                      <p className="text-sm font-medium text-slate-600 mb-1">{isDragging ? "Solte aqui!" : "Arraste o e-mail do Outlook"}</p>
                      <p className="text-xs text-slate-400 mb-3">ou clique para selecionar um arquivo .msg</p>
                      <button onClick={e => { e.stopPropagation(); fileRef.current.click(); }} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg transition-colors">Procurar arquivo</button>
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".msg,.eml" className="hidden" onChange={handleArquivo} />
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">ou cole o texto do e-mail</span></div>
              </div>
              <textarea rows={6} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono" placeholder="Cole aqui o conteúdo do e-mail..." value={texto} onChange={e => { setTexto(e.target.value); setArquivo(null); }} />
              {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{erro}</div>}
              <button onClick={processar} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
                {loading ? <><span className="animate-spin inline-block">⟳</span> Processando...</> : "Processar e-mail"}
              </button>
            </div>
          </div>
        )}

        {step === "resultado" && resultado && (
          <div>
            <div className="flex items-start justify-between mb-6">
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
                <button onClick={baixarCSV} disabled={loading || salvandoBanco} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg font-medium transition-colors flex items-center gap-1.5">
                  {salvandoBanco ? <><span className="animate-spin inline-block">⟳</span> Salvando banco...</> : loading ? "Gerando..." : "⬇ Confirmar e baixar CSV"}
                </button>
              </div>
            </div>
            {resultado.sem_preco > 0 && <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-700"><strong>{resultado.sem_preco} {resultado.sem_preco === 1 ? "item" : "itens"} sem preço</strong> — preencha manualmente antes de baixar.</div>}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 text-sm text-blue-700">💾 Ao confirmar, os preços serão salvos automaticamente no banco de preços.</div>
            {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-600">{erro}</div>}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 w-8">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Descrição</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 w-20">Qtd</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 w-16">Un</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 w-32">Preço unit.</th>
                    <th className="px-4 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resultado.itens.map((item, i) => <ItemRow key={i} item={item} index={i} onChange={atualizarItem} token={token} apiUrl={API} />)}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-3 text-center">Clique em qualquer campo para editar antes de baixar.</p>
          </div>
        )}

        {step === "download" && (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">✓</span></div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">CSV baixado!</h2>
            <p className="text-slate-500 text-sm mb-4">Arquivo <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">proposta_{resultado?.proposta}.csv</code> pronto para importar no Tiny.</p>
            {bancoInfo && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-6 text-sm text-emerald-700">💾 Banco atualizado — <strong>{bancoInfo.atualizados}</strong> preços atualizados, <strong>{bancoInfo.inseridos}</strong> novos inseridos</div>}
            <button onClick={reiniciar} className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-lg text-sm">Processar outra proposta</button>
          </div>
        )}
      </main>
    </div>
  );
}
