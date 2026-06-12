import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { brl, btnPrimary, btnGhost, Eyebrow, IconX, IconCheck, IconSearch } from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ReceberPO({ token, usuario, onCriarOC, onClose }) {
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [res, setRes] = useState(null);
  const [texto, setTexto] = useState("");
  const inputRef = useRef(null);

  async function enviar(arquivo) {
    setErro(""); setRes(null); setLoading(true);
    try {
      const fd = new FormData();
      if (arquivo) fd.append("arquivo", arquivo);
      else if (texto.trim()) fd.append("texto", texto.trim());
      else { setLoading(false); setErro("Arraste a PO ou cole o texto."); return; }
      const r = await fetch(`${API}/casar-po`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await r.json();
      if (data.erro) setErro(data.erro);
      else setRes(data);
    } catch (e) {
      setErro("Falha ao ler a PO. Tente o PDF da PO ou cole o texto.");
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) enviar(f);
  }

  // monta a OC a partir de uma proposta casada
  function gerarDaProposta(c) {
    onCriarOC(c.proposta, c.itens, res.po_numero || "");
    onClose();
  }

  // OC-esqueleto: itens da PO, sem dados de compra (operador preenche)
  function gerarEsqueleto() {
    const proposta = {
      cliente: (res.cnpjs && res.cnpjs[0]) ? `Cliente ${res.cnpjs[0]}` : "Cliente (PO)",
      numero_proposta: "",
    };
    const itens = (res.itens_po || []).map((i, idx) => ({
      id: null,
      descricao_final: i.descricao,
      quantidade: Number(i.quantidade) || 1,
      unidade: "UN",
      preco_venda: Number(i.preco_unitario) || 0,
      preco_custo: 0, frete_vinda: 0,
      fornecedor: null, link_fornecedor: null, sku_fornecedor: null,
    }));
    onCriarOC(proposta, itens, res.po_numero || "");
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-10 w-full max-w-2xl rounded-2xl border border-line bg-paper shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <Eyebrow>Receber PO</Eyebrow>
            <h2 className="mt-0.5 text-[17px] font-semibold text-ink">Arraste a ordem de compra do cliente</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-faint hover:bg-surface hover:text-ink"><IconX size={18} /></button>
        </div>

        <div className="px-5 py-4">
          {/* Dropzone principal */}
          {!res && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${drag ? "border-kist bg-kist/5" : "border-line2 bg-surface hover:border-kist/50"}`}>
                <IconSearch size={26} className="text-faint" />
                <div className="mt-3 text-[14px] font-medium text-ink">Solte a PO aqui</div>
                <div className="mt-1 text-[12px] text-faint">e-mail <span className="font-mono">.msg</span> ou <span className="font-mono">.pdf</span> · ou clique pra escolher</div>
                <input ref={inputRef} type="file" accept=".msg,.pdf" className="hidden"
                  onChange={(e) => e.target.files?.[0] && enviar(e.target.files[0])} />
              </div>
              <div className="mt-3">
                <div className="text-[11px] uppercase eyebrow text-faint">ou cole o texto da PO</div>
                <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3}
                  placeholder="Cole aqui o conteúdo da ordem de compra…"
                  className="mt-1 w-full rounded-lg border border-line2 bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-kist" />
                <button onClick={() => enviar(null)} disabled={loading || !texto.trim()}
                  className={`${btnGhost} mt-2 ${(loading || !texto.trim()) ? "opacity-50" : ""}`}>Buscar pelo texto</button>
              </div>
            </>
          )}

          {loading && <div className="py-8 text-center text-[13px] text-faint">Lendo a PO e procurando a proposta…</div>}
          {erro && <div className="mt-3 rounded-lg border border-rose/30 bg-rosebg px-3 py-2 text-[13px] text-rose">{erro}</div>}

          {/* Resultado */}
          {res && (
            <div className="space-y-4">
              {/* Resumo da PO lida */}
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
                  <span className="text-faint">PO <span className="font-mono text-ink">{res.po_numero || "—"}</span></span>
                  <span className="text-faint">CNPJ <span className="font-mono text-ink">{(res.cnpjs && res.cnpjs.join(", ")) || "—"}</span></span>
                  {res.destino && <span className="text-faint">Destino <span className="text-ink">{res.destino}</span></span>}
                  <span className="text-faint">{(res.itens_po || []).length} itens lidos</span>
                </div>
              </div>

              {/* Candidatas */}
              {(res.candidatas || []).length > 0 ? (
                <div>
                  <div className="mb-2 text-[11px] uppercase eyebrow text-faint">Propostas que casam ({res.candidatas.length})</div>
                  <div className="space-y-2">
                    {res.candidatas.map((c, i) => (
                      <div key={c.proposta.id} className={`rounded-xl border bg-surface p-3.5 ${i === 0 ? "border-kist/40" : "border-line"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13.5px] font-medium text-ink">{c.proposta.cliente}</div>
                            <div className="mt-0.5 text-[11.5px] text-faint">
                              proposta <span className="font-mono">{c.proposta.numero_proposta || "—"}</span> · {(c.itens || []).length} itens
                              {i === 0 && <span className="ml-2 font-semibold text-signal">melhor casamento</span>}
                            </div>
                          </div>
                          <button onClick={() => gerarDaProposta(c)} className={`${btnPrimary} flex-shrink-0`}>
                            <IconCheck size={14} /> Gerar OC
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber/30 bg-amber/5 p-4">
                  <div className="text-[13px] font-medium text-ink">Nenhuma proposta encontrada para esse CNPJ.</div>
                  <p className="mt-1 text-[12px] text-sub">Pode ser uma proposta antiga (anterior ao sistema) ou feita fora dele. Você pode gerar uma OC já com os itens lidos da PO e preencher os dados de compra na mão.</p>
                  <button onClick={gerarEsqueleto} disabled={!(res.itens_po || []).length}
                    className={`${btnGhost} mt-3 ${!(res.itens_po || []).length ? "opacity-50" : ""}`}>
                    Gerar OC com os itens da PO
                  </button>
                </div>
              )}

              <button onClick={() => { setRes(null); setTexto(""); }} className="text-[12px] text-faint hover:text-ink">← ler outra PO</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
