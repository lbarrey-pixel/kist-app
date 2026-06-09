import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function Badge({ count, tipo }) {
  const cores = {
    total: "bg-slate-100 text-slate-700",
    preco: "bg-emerald-100 text-emerald-700",
    sem: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cores[tipo]}`}>
      {count}
    </span>
  );
}

function ItemRow({ item, index, onChange }) {
  return (
    <tr className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
      <td className="px-4 py-2 text-sm text-slate-500 w-8">{index + 1}</td>
      <td className="px-4 py-2">
        <input
          className="w-full text-sm border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5"
          value={item.descricao_final}
          onChange={e => onChange(index, "descricao_final", e.target.value)}
        />
      </td>
      <td className="px-4 py-2 w-20">
        <input
          type="number"
          className="w-full text-sm text-center border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5"
          value={item.quantidade}
          onChange={e => onChange(index, "quantidade", parseFloat(e.target.value))}
        />
      </td>
      <td className="px-4 py-2 w-16">
        <input
          className="w-full text-sm text-center border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5"
          value={item.unidade}
          onChange={e => onChange(index, "unidade", e.target.value)}
        />
      </td>
      <td className="px-4 py-2 w-32">
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">R$</span>
          <input
            type="number"
            step="0.001"
            className={`w-full text-sm text-right border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5 ${
              item.preco_un > 0 ? "text-slate-800" : "text-amber-600 font-medium"
            }`}
            value={item.preco_un}
            onChange={e => onChange(index, "preco_un", parseFloat(e.target.value) || 0)}
          />
        </div>
      </td>
      <td className="px-4 py-2 w-8">
        <div className={`w-2 h-2 rounded-full mx-auto ${item.preco_un > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
      </td>
    </tr>
  );
}

export default function App() {
  const [step, setStep] = useState("input"); // input | resultado | download
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [numeroProposta, setNumeroProposta] = useState("");
  const [resultado, setResultado] = useState(null);
  const [stats, setStats] = useState(null);
  const fileRef = useRef();

  // Stats do banco ao carregar
  useState(() => {
    fetch(`${API}/banco/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  function handleArquivo(e) {
    const f = e.target.files[0];
    if (f) { setArquivo(f); setTexto(""); }
  }

  async function processar() {
    if (!numeroProposta.trim()) { setErro("Informe o número da proposta."); return; }
    if (!texto.trim() && !arquivo) { setErro("Cole o texto do e-mail ou envie um arquivo .msg"); return; }
    setErro(""); setLoading(true);

    try {
      const form = new FormData();
      form.append("numero_proposta", numeroProposta);
      if (arquivo) form.append("arquivo", arquivo);
      else form.append("texto", texto);

      const res = await fetch(`${API}/extrair`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Erro no servidor");
      }
      const data = await res.json();
      setResultado(data);
      setStep("resultado");
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  function atualizarItem(index, campo, valor) {
    setResultado(prev => ({
      ...prev,
      itens: prev.itens.map((item, i) =>
        i === index ? { ...item, [campo]: valor } : item
      ),
    }));
  }

  async function baixarCSV() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/gerar-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resultado),
      });
      if (!res.ok) throw new Error("Erro ao gerar CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proposta_${resultado.proposta}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setStep("download");
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  function reiniciar() {
    setStep("input"); setResultado(null);
    setTexto(""); setArquivo(null);
    setNumeroProposta(""); setErro("");
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
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
          {stats && (
            <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500">
              <span>{stats.total_produtos?.toLocaleString()} produtos no banco</span>
              {stats.desatualizados_90d > 0 && (
                <span className="text-amber-500">⚠ {stats.desatualizados_90d} preços desatualizados</span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* STEP: INPUT */}
        {step === "input" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-800 mb-1">Nova proposta</h1>
              <p className="text-slate-500 text-sm">Cole o e-mail de cotação ou envie o arquivo .msg</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
              {/* Número da proposta */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Número da proposta <span className="text-red-400">*</span>
                </label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="ex: 1050370"
                  value={numeroProposta}
                  onChange={e => setNumeroProposta(e.target.value)}
                />
              </div>

              {/* Upload .msg */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Arquivo .msg</label>
                <div
                  onClick={() => fileRef.current.click()}
                  className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    arquivo ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {arquivo ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
                      <span>📎</span>
                      <span className="font-medium">{arquivo.name}</span>
                      <button onClick={e => { e.stopPropagation(); setArquivo(null); }} className="text-slate-400 hover:text-red-400 ml-2">✕</button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">Clique para selecionar o arquivo .msg</p>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".msg" className="hidden" onChange={handleArquivo} />
              </div>

              {/* Divisor */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">ou cole o texto</span></div>
              </div>

              {/* Texto */}
              <div>
                <textarea
                  rows={8}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono"
                  placeholder="Cole aqui o conteúdo do e-mail de cotação..."
                  value={texto}
                  onChange={e => { setTexto(e.target.value); setArquivo(null); }}
                />
              </div>

              {erro && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{erro}</div>
              )}

              <button
                onClick={processar}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><span className="animate-spin">⟳</span> Processando...</>
                ) : (
                  "Processar e-mail"
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP: RESULTADO */}
        {step === "resultado" && resultado && (
          <div>
            {/* Cabeçalho da proposta */}
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
                <button onClick={reiniciar} className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600">
                  Nova proposta
                </button>
                <button
                  onClick={baixarCSV}
                  disabled={loading}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg font-medium transition-colors flex items-center gap-1.5"
                >
                  {loading ? "Gerando..." : "⬇ Baixar CSV Tiny"}
                </button>
              </div>
            </div>

            {resultado.sem_preco > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-700">
                <strong>{resultado.sem_preco} {resultado.sem_preco === 1 ? "item" : "itens"} sem preço</strong> — revise ou preencha manualmente antes de baixar.
              </div>
            )}

            {erro && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-600">{erro}</div>
            )}

            {/* Tabela de itens */}
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
                  {resultado.itens.map((item, i) => (
                    <ItemRow key={i} item={item} index={i} onChange={atualizarItem} />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400 mt-3 text-center">
              Clique em qualquer campo para editar antes de baixar.
            </p>
          </div>
        )}

        {/* STEP: DOWNLOAD */}
        {step === "download" && (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">CSV baixado!</h2>
            <p className="text-slate-500 text-sm mb-8">
              Arquivo <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">proposta_{resultado?.proposta}.csv</code> pronto para importar no Tiny.
            </p>
            <button
              onClick={reiniciar}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-lg text-sm"
            >
              Processar outra proposta
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
