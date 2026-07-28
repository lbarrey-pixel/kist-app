// ─────────────────────────────────────────────────────────────────────────
// DATASHEET (chamado #6 — Fábio)
//
// O cliente pede a ficha técnica dos itens ofertados. Antes disso o operador
// copiava link por link no ChatGPT, esperava e baixava cada PDF na mão.
//
// Vive em arquivo próprio de propósito: o App.jsx tem 2.450 linhas, e feature
// nova enfiada lá dentro é retrabalho caro na próxima. Aqui o App só monta
// <DatasheetBotao/> e <DatasheetLote/>.
//
// FLUXO (decidido com o Leonardo):
//   selo → gerar → [identificação, se ambígua] → revisão → aprovar
//   Aprovado = dado do produto. Não regera, não repede aprovação.
//   Reprovar SEMPRE pede um texto: sem a crítica escrita, a regeração é
//   sorteio novo em vez de correção.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect, useCallback } from "react";
import { btnPrimary, btnGhost, IconX, IconCheck, IconDownload, IconBolt } from "./kist-ui.jsx";

// ── Selo do item ─────────────────────────────────────────────────────────
export function DatasheetBotao({ item, index, onChange, token, apiUrl, fonteTexto }) {
  const [aberto, setAberto] = useState(false);

  // Três estados visuais, e eles vêm de campos DIFERENTES de propósito:
  //  • datasheet_id            → vinculado (persistido; sobrevive ao reload)
  //  • datasheet_disponivel    → o produto do banco tem um, mas o veredito não
  //                              foi "mesmo", então o operador decide
  //  • nada                    → oferece gerar
  const vinculado = item.datasheet_id || null;
  const disponivel = item.datasheet_disponivel || item.banco?.datasheet_id || null;

  const rotulo = vinculado ? "✓ datasheet"
    : disponivel ? "datasheet do banco"
    : "+ datasheet";
  const cor = vinculado ? "text-kist" : disponivel ? "text-amber" : "text-faint";

  return (
    <>
      <button onClick={() => setAberto(true)}
        title={vinculado ? "Ver / baixar o datasheet deste item"
          : disponivel ? "O produto do banco tem datasheet — conferir se serve para este item"
          : "Gerar datasheet técnico deste item"}
        className={`text-[11px] hover:text-sub ${cor}`}>
        {rotulo}
      </button>
      {aberto && (
        <DatasheetPainel item={item} index={index} onChange={onChange}
          token={token} apiUrl={apiUrl} fonteTexto={fonteTexto}
          onFechar={() => setAberto(false)} />
      )}
    </>
  );
}

// ── Painel ───────────────────────────────────────────────────────────────
function DatasheetPainel({ item, index, onChange, token, apiUrl, fonteTexto, onFechar }) {
  const [fase, setFase] = useState("carregando");  // carregando|gerando|identificacao|revisao|erro
  const [ds, setDs] = useState(null);
  const [ident, setIdent] = useState(null);
  const [pistas, setPistas] = useState("");
  const [critica, setCritica] = useState("");
  const [mostrarCritica, setMostrarCritica] = useState(false);
  const [mostrarFoto, setMostrarFoto] = useState(false);
  const [urlFoto, setUrlFoto] = useState("");
  const [erro, setErro] = useState("");
  const [cache, setCache] = useState(null);
  const arquivoRef = useRef(null);
  const vivo = useRef(true);

  useEffect(() => () => { vivo.current = false; }, []);

  const cabecalhos = useCallback(() => ({
    "Content-Type": "application/json", Authorization: `Bearer ${token}`,
  }), [token]);

  const produtoId = item.banco?.produto_id || null;

  // ── Chamadas ───────────────────────────────────────────────────────────
  const gerar = useCallback(async (extra = {}) => {
    setFase("gerando"); setErro("");
    try {
      const res = await fetch(`${apiUrl}/datasheets/gerar`, {
        method: "POST", headers: cabecalhos(),
        body: JSON.stringify({
          item, produto_id: produtoId, item_id: item.id || null,
          fonte_texto: fonteTexto || "", pistas, ...extra,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || "falhou ao gerar");
      if (!vivo.current) return;
      if (d.precisa_operador) {
        setIdent(d.identificacao || {});
        setFase("identificacao");
        return;
      }
      setDs(d); setCritica(""); setMostrarCritica(false); setFase("revisao");
    } catch (e) {
      if (!vivo.current) return;
      setErro(String(e.message || e)); setFase("erro");
    }
  }, [apiUrl, cabecalhos, item, produtoId, fonteTexto, pistas]);

  // Abertura: vinculado → carrega; senão procura no cache antes de gastar geração.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const id = item.datasheet_id || item.datasheet_disponivel || item.banco?.datasheet_id;
      try {
        if (id) {
          const r = await fetch(`${apiUrl}/datasheets/${id}`, { headers: cabecalhos() });
          if (r.ok) {
            const d = await r.json();
            if (cancelado) return;
            setDs(d); setFase("revisao"); return;
          }
        }
        const p = new URLSearchParams();
        if (produtoId) p.set("produto_id", produtoId);
        if (item.link_fornecedor) p.set("link", item.link_fornecedor);
        if (item.descricao_final) p.set("descricao", item.descricao_final);
        const r2 = await fetch(`${apiUrl}/datasheets?${p.toString()}`, { headers: cabecalhos() });
        const d2 = r2.ok ? await r2.json() : { achou: false };
        if (cancelado) return;
        if (d2.achou) { setCache(d2); setDs(d2.datasheet); setFase("revisao"); return; }
        setFase("vazio");
      } catch {
        if (!cancelado) setFase("vazio");
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function aprovar() {
    try {
      const res = await fetch(`${apiUrl}/datasheets/${ds.id}/aprovar`, {
        method: "POST", headers: cabecalhos(),
        body: JSON.stringify({ produto_id: produtoId, item_id: item.id || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || "falhou ao aprovar");
      setDs(d);
      onChange(index, "datasheet_id", ds.id);   // persiste no item
      onFechar();
    } catch (e) { setErro(String(e.message || e)); }
  }

  async function reprovarERegerar() {
    const txt = critica.trim();
    if (!txt) { setErro("Escreva o que precisa ser ajustado."); return; }
    try {
      await fetch(`${apiUrl}/datasheets/${ds.id}/reprovar`, {
        method: "POST", headers: cabecalhos(), body: JSON.stringify({ critica: txt }),
      });
    } catch { /* a reprovação é registro; a regeração é o que importa */ }
    await gerar({ datasheet_id: ds.id, critica: txt });
  }

  async function subirFoto(arquivo) {
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error("não consegui ler o arquivo"));
      fr.readAsDataURL(arquivo);
    });
    setMostrarFoto(false);
    await gerar({ datasheet_id: ds?.id || null, imagem_b64: b64 });
  }

  const conteudo = ds?.conteudo || {};
  const avisos = ds?.avisos || [];
  const semFoto = ds && !ds.tem_foto;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="eyebrow text-[9px] font-semibold uppercase text-faint">Datasheet técnico</div>
            <div className="truncate text-[14px] font-semibold text-ink">
              {conteudo.nome_produto || item.descricao_final || item.descricao_original}
            </div>
          </div>
          <button onClick={onFechar} className="rounded-md p-1 text-faint hover:bg-paper hover:text-ink">
            <IconX size={16} />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex min-h-0 flex-1">
          {/* Preview */}
          <div className="min-w-0 flex-1 bg-paper/60">
            {fase === "gerando" && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sub">
                <span className="inline-block animate-spin"><IconBolt size={20} /></span>
                <div className="text-[13px]">Identificando o item, levantando a ficha e procurando a foto…</div>
                <div className="text-[11.5px] text-faint">costuma levar de 20 a 60 segundos</div>
              </div>
            )}
            {fase === "carregando" && (
              <div className="flex h-full items-center justify-center text-[13px] text-faint">carregando…</div>
            )}
            {fase === "vazio" && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <div className="text-[13px] text-sub">Este item ainda não tem datasheet.</div>
                <div className="text-[11.5px] text-faint">
                  O sistema vai identificar o produto, buscar a ficha técnica e a foto real.
                  Nada de preço, fornecedor ou link entra no documento.
                </div>
                <button onClick={() => gerar()} className={btnPrimary}>
                  <IconBolt size={15} /> Gerar datasheet
                </button>
              </div>
            )}
            {fase === "identificacao" && (
              <div className="flex h-full flex-col justify-center gap-3 px-8">
                <div className="text-[13px] font-semibold text-amber">
                  Não consegui cravar qual item é — e não vou chutar.
                </div>
                {(ident?.ambiguidade || []).length > 0 && (
                  <div className="text-[12px] text-sub">
                    Pode ser: {(ident.ambiguidade || []).join(" · ")}
                  </div>
                )}
                <ul className="list-disc pl-5 text-[12.5px] text-ink">
                  {(ident?.perguntas || []).map((q, i) => <li key={i}>{q}</li>)}
                </ul>
                <textarea value={pistas} onChange={(e) => setPistas(e.target.value)}
                  rows={3} placeholder="ex: é o HDMI 2.0, marca Multilaser, 2 metros"
                  className="rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-ink outline-none focus:border-kist" />
                <div>
                  <button onClick={() => gerar()} disabled={!pistas.trim()}
                    className={`${btnPrimary} disabled:opacity-40`}>
                    Gerar com essa informação
                  </button>
                </div>
              </div>
            )}
            {fase === "erro" && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <div className="text-[13px] text-rose">{erro}</div>
                <button onClick={() => gerar()} className={btnGhost}>Tentar de novo</button>
              </div>
            )}
            {fase === "revisao" && ds?.pdf_url && (
              <iframe title="datasheet" src={ds.pdf_url} className="h-full w-full border-0" />
            )}
          </div>

          {/* Lateral */}
          {fase === "revisao" && ds && (
            <div className="w-[300px] flex-shrink-0 overflow-y-auto border-l border-line px-4 py-3">
              {cache && (
                <div className="mb-3 rounded-lg border border-kist/30 bg-kist/5 px-3 py-2 text-[11.5px] text-sub">
                  Já existia um datasheet aprovado para este produto
                  {cache.por === "link" ? " (mesmo link de origem)"
                    : cache.por === "descricao" ? " (mesma descrição)" : ""}. Não gerei de novo.
                </div>
              )}

              <div className="eyebrow text-[9px] font-semibold uppercase text-faint">Situação</div>
              <div className="mt-1 flex items-center gap-2 text-[12.5px]">
                <span className={ds.status === "aprovado" ? "text-signal" : "text-amber"}>
                  {ds.status === "aprovado" ? "✓ aprovado" : "rascunho — aguardando sua revisão"}
                </span>
                <span className="font-mono text-[10.5px] text-faint">v{ds.versao}</span>
              </div>

              <div className="mt-3 eyebrow text-[9px] font-semibold uppercase text-faint">Foto</div>
              <div className={`mt-1 text-[12.5px] ${semFoto ? "text-amber" : "text-ink"}`}>
                {semFoto ? "sem foto confirmada"
                  : ds.imagem_origem === "fabricante" ? "do site do fabricante"
                  : ds.imagem_origem === "operador" ? "enviada por você"
                  : "da página do produto"}
              </div>
              <button onClick={() => setMostrarFoto((v) => !v)}
                className="mt-1 text-[11px] text-kist hover:opacity-80">
                {mostrarFoto ? "− fechar" : semFoto ? "informar a foto" : "trocar a foto"}
              </button>
              {mostrarFoto && (
                <div className="mt-2 space-y-2">
                  <input value={urlFoto} onChange={(e) => setUrlFoto(e.target.value)}
                    placeholder="cole o link da imagem"
                    className="w-full rounded-md border border-line2 bg-surface px-2 py-1 text-[11.5px] text-ink outline-none focus:border-kist" />
                  <div className="flex gap-2">
                    <button disabled={!urlFoto.trim()}
                      onClick={() => gerar({ datasheet_id: ds.id, imagem_url: urlFoto.trim() })}
                      className={`${btnGhost} text-[11px] disabled:opacity-40`}>usar este link</button>
                    <button onClick={() => arquivoRef.current?.click()}
                      className={`${btnGhost} text-[11px]`}>subir arquivo</button>
                  </div>
                  <input ref={arquivoRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) subirFoto(f); }} />
                </div>
              )}

              {avisos.length > 0 && (
                <>
                  <div className="mt-4 eyebrow text-[9px] font-semibold uppercase text-faint">O que eu preciso te contar</div>
                  <ul className="mt-1 space-y-1">
                    {avisos.map((a, i) => (
                      <li key={i} className="text-[11.5px] leading-snug text-amber">· {a}</li>
                    ))}
                  </ul>
                </>
              )}

              {(conteudo.fontes || []).length > 0 && (
                <>
                  <div className="mt-4 eyebrow text-[9px] font-semibold uppercase text-faint">Fontes consultadas</div>
                  <div className="mt-1 text-[11px] leading-snug text-faint">
                    {(conteudo.fontes || []).join(" · ")}
                  </div>
                </>
              )}

              <div className="mt-5 space-y-2 border-t border-line pt-3">
                {ds.pdf_url && (
                  <a href={ds.pdf_url} download={ds.nome_arquivo || "datasheet.pdf"}
                    className={`${btnGhost} w-full justify-center`}>
                    <IconDownload size={14} /> Baixar PDF
                  </a>
                )}
                {ds.status !== "aprovado" && (
                  <button onClick={aprovar} className={`${btnPrimary} w-full justify-center`}>
                    <IconCheck size={15} /> Aprovar e vincular
                  </button>
                )}
                <button onClick={() => setMostrarCritica((v) => !v)}
                  className={`${btnGhost} w-full justify-center text-[11.5px]`}>
                  {mostrarCritica ? "cancelar" : "está errado — corrigir"}
                </button>
                {mostrarCritica && (
                  <div className="space-y-2">
                    <textarea value={critica} onChange={(e) => setCritica(e.target.value)}
                      rows={4} placeholder="o que está errado ou faltando? ex: a resolução é 4K a 30 Hz, não 60 Hz"
                      className="w-full rounded-lg border border-line2 bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-kist" />
                    <button onClick={reprovarERegerar} disabled={!critica.trim()}
                      className={`${btnPrimary} w-full justify-center disabled:opacity-40`}>
                      Regerar com essa correção
                    </button>
                    <div className="text-[10.5px] leading-snug text-faint">
                      Ele recebe a versão atual junto da sua correção — corrige o que
                      você apontou e preserva o resto.
                    </div>
                  </div>
                )}
                {erro && <div className="text-[11.5px] text-rose">{erro}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lote ─────────────────────────────────────────────────────────────────
export function DatasheetLote({ itens, token, apiUrl, fonteTexto, onChange }) {
  const [rodando, setRodando] = useState(false);
  const [fila, setFila] = useState([]);
  const [aberto, setAberto] = useState(false);
  const parar = useRef(false);

  const pendentes = (itens || [])
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !it.datasheet_id &&
      ((it.descricao_final || "").trim() || (it.descricao_original || "").trim()));

  async function rodar() {
    setRodando(true); setAberto(true); parar.current = false;
    const resultado = pendentes.map(({ it, i }) => ({
      i, nome: it.descricao_final || it.descricao_original, estado: "na fila", ds: null,
    }));
    setFila([...resultado]);

    // UM POR VEZ, de propósito. O Render roda com worker único: 20 gerações em
    // paralelo (cada uma com busca web e visão) afogam o backend e travam a
    // tela inteira — foi exatamente o incidente de 20/07.
    for (let k = 0; k < pendentes.length; k++) {
      if (parar.current) { resultado[k].estado = "cancelado"; setFila([...resultado]); break; }
      const { it, i } = pendentes[k];
      resultado[k].estado = "gerando"; setFila([...resultado]);
      try {
        const res = await fetch(`${apiUrl}/datasheets/gerar`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            item: it, produto_id: it.banco?.produto_id || null,
            item_id: it.id || null, fonte_texto: fonteTexto || "",
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { resultado[k].estado = "erro"; resultado[k].nota = d.detail || "falhou"; }
        else if (d.precisa_operador) {
          resultado[k].estado = "precisa de você";
          resultado[k].nota = (d.identificacao?.perguntas || [])[0] || "item ambíguo";
        } else {
          resultado[k].estado = "gerado"; resultado[k].ds = d;
          if (!d.tem_foto) resultado[k].nota = "saiu sem foto";
        }
      } catch (e) {
        resultado[k].estado = "erro"; resultado[k].nota = String(e.message || e);
      }
      setFila([...resultado]);
    }
    setRodando(false);
  }

  if (pendentes.length === 0) return null;

  return (
    <>
      <button onClick={rodando ? () => { parar.current = true; } : rodar}
        className={`${btnGhost} text-[12px]`}
        title="Gera o datasheet de cada item que ainda não tem, um por vez">
        {rodando ? "parar geração" : `Gerar datasheets (${pendentes.length})`}
      </button>

      {aberto && fila.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 w-[340px] rounded-xl border border-line bg-surface p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="eyebrow text-[9px] font-semibold uppercase text-faint">
              Datasheets — {fila.filter((f) => f.estado === "gerado").length}/{fila.length}
            </div>
            <button onClick={() => setAberto(false)} className="text-faint hover:text-ink">
              <IconX size={13} />
            </button>
          </div>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {fila.map((f) => (
              <div key={f.i} className="text-[11.5px] leading-snug">
                <span className={
                  f.estado === "gerado" ? "text-signal"
                    : f.estado === "gerando" ? "text-kist"
                    : f.estado === "erro" ? "text-rose"
                    : f.estado === "precisa de você" ? "text-amber" : "text-faint"}>
                  {f.estado === "gerado" ? "✓" : f.estado === "gerando" ? "…" : "·"}
                </span>{" "}
                <span className="text-ink">{(f.nome || "").slice(0, 38)}</span>{" "}
                <span className="text-faint">— {f.estado}{f.nota ? `: ${f.nota}` : ""}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-line pt-2 text-[10.5px] leading-snug text-faint">
            Todos entram como rascunho. Abra item a item pelo selo “datasheet”
            para conferir e aprovar — nada vai pro cliente sem você olhar.
          </div>
        </div>
      )}
    </>
  );
}
