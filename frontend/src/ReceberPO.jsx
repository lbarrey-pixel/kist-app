import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { brl, btnPrimary, btnGhost, Eyebrow, IconX, IconCheck, IconSearch } from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ReceberPO({ token, usuario, onCriarOC, onClose }) {
  const [poFile, setPoFile] = useState(null);
  const [tinyFile, setTinyFile] = useState(null);
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [res, setRes] = useState(null);
  const poRef = useRef(null);
  const tinyRef = useRef(null);

  async function buscar() {
    setErro(""); setRes(null);
    if (!poFile && !texto.trim()) { setErro("Anexe a PO do cliente (obrigatória) ou cole o texto."); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      if (poFile) fd.append("arquivo", poFile);
      else if (texto.trim()) fd.append("texto", texto.trim());
      if (tinyFile) fd.append("proposta_tiny", tinyFile);
      const r = await fetch(`${API}/casar-po`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await r.json();
      if (data.erro) setErro(data.erro);
      else setRes(data);
    } catch (e) {
      setErro("Falha ao ler. Tente o PDF da PO ou cole o texto.");
    } finally { setLoading(false); }
  }

  const ocItensDe = (lista) => (lista || []).map((i) => ({
    id: i.item_proposta_id ?? null,
    descricao_final: i.descricao,
    quantidade: Number(i.quantidade) || 1,
    unidade: i.unidade || "UN",
    preco_venda: Number(i.preco_venda) || 0,   // preço da PO, preservado
    preco_custo: Number(i.preco_custo) || 0,
    frete_vinda: Number(i.frete_vinda) || 0,
    fornecedor: i.fornecedor || null,
    link_fornecedor: i.link_fornecedor || null,
    sku_fornecedor: i.sku_fornecedor || null,
  }));

  // UF de destino = última sigla de estado que aparecer no texto do destino
  function ufFromDestino(d) {
    const m = (d || "").toUpperCase().match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/g);
    return m ? m[m.length - 1] : "";
  }

  function gerarDaProposta(c) {
    // OC = itens da PO + dados de compra emprestados desta proposta
    const prop = { ...c.proposta, cnpj: c.proposta?.cnpj || res.cnpj_cliente || "", uf: ufFromDestino(res.destino) };
    onCriarOC(prop, ocItensDe(c.itens_oc), res.po_numero || "");
    onClose();
  }

  function gerarDaPO() {
    const cnpjCli = res.cnpj_cliente || "";
    const proposta = { cliente: cnpjCli ? `Cliente ${cnpjCli}` : "Cliente (PO)", numero_proposta: "",
                       cnpj: cnpjCli, uf: ufFromDestino(res.destino) };
    onCriarOC(proposta, ocItensDe(res.itens_po), res.po_numero || "");
    onClose();
  }

  const Slot = ({ titulo, sub, file, setFile, inputRef, accept, obrig }) => (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${file ? "border-signal/50 bg-signal/5" : "border-line2 bg-surface hover:border-kist/50"}`}>
      {file ? <IconCheck size={20} className="text-signal" /> : <IconSearch size={20} className="text-faint" />}
      <div className="mt-2 text-[12.5px] font-medium text-ink">{titulo} {obrig && <span className="text-rose">*</span>}</div>
      <div className="mt-0.5 truncate text-[11px] text-faint" style={{ maxWidth: "100%" }}>{file ? file.name : sub}</div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-10 w-full max-w-2xl rounded-2xl border border-line bg-paper shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <Eyebrow>Receber PO</Eyebrow>
            <h2 className="mt-0.5 text-[17px] font-semibold text-ink">Localizar a proposta na base a partir da PO</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-faint hover:bg-surface hover:text-ink"><IconX size={18} /></button>
        </div>

        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Slot titulo="PO do cliente" sub="e-mail .msg ou .pdf" file={poFile} setFile={setPoFile} inputRef={poRef} accept=".msg,.pdf" obrig />
            <Slot titulo="Proposta do Tiny" sub="opcional · ajuda a localizar" file={tinyFile} setFile={setTinyFile} inputRef={tinyRef} accept=".msg,.pdf" />
          </div>
          {!poFile && (
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
              placeholder="ou cole aqui o texto da PO…"
              className="mt-3 w-full rounded-lg border border-line2 bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-kist" />
          )}
          <div className="mt-3 flex items-center gap-2">
            <button onClick={buscar} disabled={loading} className={`${btnPrimary} ${loading ? "opacity-60" : ""}`}>
              <IconSearch size={15} /> {loading ? "Procurando…" : "Localizar proposta"}
            </button>
            {(poFile || tinyFile) && <button onClick={() => { setPoFile(null); setTinyFile(null); setTexto(""); setRes(null); }} className="text-[12px] text-faint hover:text-ink">limpar</button>}
          </div>

          {erro && <div className="mt-3 rounded-lg border border-rose/30 bg-rosebg px-3 py-2 text-[13px] text-rose">{erro}</div>}

          {res && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
                  <span className="text-faint">PO <span className="font-mono text-ink">{res.po_numero || "—"}</span></span>
                  <span className="text-faint">CNPJ <span className="font-mono text-ink">{(res.cnpjs && res.cnpjs.join(", ")) || "—"}</span></span>
                  {res.destino && <span className="text-faint">Destino <span className="text-ink">{res.destino}</span></span>}
                  <span className="text-faint">{(res.itens_po || []).length} itens na PO</span>
                </div>
                {(res.itens_po || []).length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-line pt-2">
                    <div className="mb-1 text-[10px] uppercase eyebrow text-faint">Itens da PO (vão pra OC exatamente assim)</div>
                    {res.itens_po.map((it, k) => (
                      <div key={k} className="flex items-center gap-2 text-[12px]">
                        <span className="min-w-0 flex-1 truncate text-sub">{it.descricao}</span>
                        <span className="font-mono text-faint">{it.quantidade}x</span>
                        <span className="font-mono text-ink">R$ {brl(it.preco_unitario)}</span>
                        {it.match_banco && <span className="text-[10px] font-semibold text-signal" title="mesmo item confirmado (preço/descrição batem) — custo e origem preenchidos">✓ mesmo item</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(res.candidatas || []).length > 0 ? (
                <div>
                  <div className="mb-2 text-[11px] uppercase eyebrow text-faint">Propostas do cliente na base ({res.candidatas.length}) — melhor casamento primeiro</div>
                  <div className="space-y-2">
                    {res.candidatas.map((c, i) => (
                      <div key={c.proposta.id} className={`rounded-xl border bg-surface p-3.5 ${i === 0 ? "border-kist/40" : "border-line"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13.5px] font-medium text-ink">{c.proposta.cliente}</div>
                            <div className="mt-0.5 text-[11.5px] text-faint">
                              proposta <span className="font-mono">{c.proposta.numero_proposta || "—"}</span>
                              {" · "}{(c.itens_oc || []).filter((x) => x.match_proposta).length}/{(res.itens_po || []).length} itens com dados de compra
                              {i === 0 && c.score > 0 && <span className="ml-2 font-semibold text-signal">melhor casamento</span>}
                            </div>
                          </div>
                          <button onClick={() => gerarDaProposta(c)} className={`${btnPrimary} flex-shrink-0`}><IconCheck size={14} /> Gerar OC</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber/30 bg-amber/5 p-4">
                  <div className="text-[13px] font-medium text-ink">Nenhuma proposta na base para esse cliente.</div>
                  <p className="mt-1 text-[12px] text-sub">
                    {tinyFile ? "Mesmo com a proposta do Tiny, não achei nada conclusivo. " : "Não achei proposta com esse CNPJ. "}
                    {!tinyFile && "Anexe a proposta do Tiny acima e tente de novo, ou "}gere a OC com os dados da PO — os itens que reconheci no histórico já vêm preenchidos.
                  </p>
                  <div className="mt-2 text-[11px] text-faint">
                    {(res.itens_po || []).filter((i) => i.match_banco).length} de {(res.itens_po || []).length} itens reconhecidos no banco (custo/link/fornecedor preenchidos).
                  </div>
                  <button onClick={gerarDaPO} disabled={!(res.itens_po || []).length}
                    className={`${btnPrimary} mt-3 ${!(res.itens_po || []).length ? "opacity-50" : ""}`}>
                    <IconCheck size={14} /> Gerar OC com os dados da PO
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
