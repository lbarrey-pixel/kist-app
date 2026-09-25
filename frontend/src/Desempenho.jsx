import { useCallback, useEffect, useState } from "react";
import { brl, btnGhost, PageHeader } from "./kist-ui.jsx";

// ── Desempenho dos bots de pesquisa (v3.105) ─────────────────────────────────
// Das buscas que viraram proposta exportada pro Tiny: quantas saíram como o bot
// trouxe, quantas o operador corrigiu e quantas o bot nem achou. Fonte única:
// GET /pesquisa/desempenho — a mesma rota que o próprio KistBot consulta.
// Anda sozinho: o veredito nasce na exportação, e a tela relê a cada minuto.

const OPERADORES = [
  { v: "", r: "Todos os operadores" },
  { v: "leonardobarrey", r: "Leonardo" },
  { v: "thiagokist", r: "Thiago" },
  { v: "fabiokist", r: "Fábio" },
];
const PRESETS = [
  { k: "hoje", r: "Hoje" },
  { k: "7", r: "7 dias" },
  { k: "30", r: "30 dias" },
  { k: "tudo", r: "Compilado" },
];
const CATEGORIAS = {
  usada: { r: "Usada", cls: "bg-signalbg text-signal" },
  corrigida: { r: "Corrigida", cls: "bg-amberbg text-amber" },
  sem_oferta: { r: "Bot não achou", cls: "bg-rosebg text-rose" },
};
const VEREDITO_TXT = {
  acertou: "saiu como o bot trouxe",
  escolheu_outra: "usou outra oferta do bot",
  nao_achou: "trocou de loja",
  custo_divergente: "mesma loja, preço corrigido",
  sem_oferta: "bot não trouxe oferta",
};

const hojeBRT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const diaBR = (iso) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "—");
const pct = (v) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);
const reais = (v) => (v ? `R$ ${brl(v)}` : "—");
const usd = (v) => (v == null ? "—" : `US$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);

function Loja({ nome, link }) {
  if (!nome && !link) return <div className="text-ink">—</div>;
  // Link vem de dado gravado por bot: só http(s) vira clicável (nada de javascript:).
  if (!link || !/^https?:\/\//i.test(String(link).trim())) return <div className="text-ink">{nome || "—"}</div>;
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" title={link}
      className="text-kist underline decoration-kist/30 underline-offset-2 hover:decoration-kist">
      {nome || "link"}
    </a>
  );
}

function Tile({ rotulo, valor, detalhe, tom = "text-ink" }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="eyebrow text-[10px] font-semibold uppercase text-faint">{rotulo}</div>
      <div className={`mt-1 font-mono text-[22px] font-semibold tabular-nums ${tom}`}>{valor}</div>
      {detalhe && <div className="mt-0.5 text-[11.5px] text-sub">{detalhe}</div>}
    </div>
  );
}

function Barra({ r }) {
  if (!r || !r.total) return null;
  const partes = [
    { n: r.usadas, cls: "bg-signal", t: "usadas" },
    { n: r.corrigidas, cls: "bg-amber", t: "corrigidas" },
    { n: r.sem_oferta, cls: "bg-rose", t: "bot não achou" },
  ];
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
      {partes.map((p) => p.n > 0 && (
        <div key={p.t} className={p.cls} style={{ width: `${(100 * p.n) / r.total}%` }}
          title={`${p.n} ${p.t}`} />
      ))}
    </div>
  );
}

function TabelaGrupo({ titulo, linhas, chave, rotulo }) {
  if (!linhas || linhas.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-paper/70 text-left">
            <th className="px-4 py-2 text-[10.5px] font-semibold uppercase eyebrow text-faint">{titulo}</th>
            {["Itens", "Usadas", "Corrigidas", "Bot não achou", "Uso", "Uso c/ oferta"].map((h) => (
              <th key={h} className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase eyebrow text-faint">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l[chave]} className="border-b border-line/70 last:border-0">
              <td className="px-4 py-2 font-medium text-ink">{rotulo(l[chave])}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{l.total}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-signal">{l.usadas}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-amber">{l.corrigidas}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-rose">{l.sem_oferta}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{pct(l.taxa_uso)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{pct(l.taxa_uso_com_oferta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Desempenho({ token, apiUrl }) {
  const [preset, setPreset] = useState("hoje");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [operador, setOperador] = useState("");
  const [motor, setMotor] = useState("kistbot");
  const [categoria, setCategoria] = useState("");
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState(null);

  const carregar = useCallback(async () => {
    const p = new URLSearchParams({ motor });
    if (preset === "hoje") { const h = hojeBRT(); p.set("de", h); p.set("ate", h); }
    else if (preset === "7" || preset === "30") p.set("dias", preset);
    else if (preset === "custom") { if (de) p.set("de", de); if (ate) p.set("ate", ate); }
    if (operador) p.set("operador", operador);
    setCarregando(true);
    try {
      const r = await fetch(`${apiUrl}/pesquisa/desempenho?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || `erro ${r.status}`);
      setDados(d); setErro("");
      setAtualizadoEm(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setErro(`Não consegui carregar o desempenho (${e.message}).`);
    } finally { setCarregando(false); }
  }, [apiUrl, token, preset, de, ate, operador, motor]);

  useEffect(() => { carregar(); }, [carregar]);

  // Relê a cada minuto com a aba visível e ao voltar pra aba: exportou uma
  // proposta, o número aparece aqui sem ninguém apertar nada.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(); }, 60000);
    const onVis = () => { if (document.visibilityState === "visible") carregar(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [carregar]);

  const r = dados?.resumo;
  const itens = (dados?.itens || []).filter((x) => !categoria || x.categoria === categoria);
  const nomeMotor = motor === "kistbot" ? "KistBot Dwight" : motor === "dwight" ? "Dwight" : "todos os bots";
  const periodoTxt = !dados ? "" : dados.periodo.compilado ? "compilado completo"
    : dados.periodo.de === dados.periodo.ate ? diaBR(dados.periodo.de)
    : `${diaBR(dados.periodo.de)} a ${diaBR(dados.periodo.ate)}`;

  return (
    <div className="mx-auto max-w-6xl px-8 py-9 rise">
      <PageHeader eyebrow="Pesquisa de preço" title="Desempenho"
        sub={`Das buscas do ${nomeMotor} que viraram proposta exportada pro Tiny: quantas saíram como vieram e quantas foram corrigidas. Todos os operadores.`}
        actions={
          <div className="flex items-center gap-2 text-[11.5px] text-faint">
            {atualizadoEm && <span>atualizado {atualizadoEm}</span>}
            <button onClick={carregar} disabled={carregando} className={btnGhost}>
              {carregando ? "Carregando…" : "Atualizar"}
            </button>
          </div>
        } />

      {/* Filtros */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line2 bg-surface">
          {PRESETS.map((p) => (
            <button key={p.k} onClick={() => setPreset(p.k)}
              className={`px-3 py-2 text-[12.5px] font-medium transition-colors ${preset === p.k ? "bg-kist text-white" : "text-sub hover:bg-paper"}`}>
              {p.r}
            </button>
          ))}
        </div>
        <input type="date" value={de} aria-label="De"
          onChange={(e) => { setDe(e.target.value); setPreset("custom"); }}
          className="rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub outline-none" />
        <span className="text-faint">→</span>
        <input type="date" value={ate} aria-label="Até"
          onChange={(e) => { setAte(e.target.value); setPreset("custom"); }}
          className="rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub outline-none" />
        <select value={operador} onChange={(e) => setOperador(e.target.value)} aria-label="Operador"
          className="rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub outline-none">
          {OPERADORES.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
        </select>
        <select value={motor} onChange={(e) => setMotor(e.target.value)} aria-label="Bot"
          className="rounded-lg border border-line2 bg-surface px-3 py-2 text-[12.5px] text-sub outline-none">
          <option value="kistbot">KistBot Dwight</option>
          <option value="dwight">Dwight (desativado)</option>
          <option value="todos">Todos os bots</option>
        </select>
      </div>

      {erro && <div className="mt-4 rounded-lg border border-rose/30 bg-rosebg px-4 py-3 text-[13px] text-rose">{erro}</div>}

      {dados && (
        <>
          <div className="mt-6 text-[12px] text-sub">
            {periodoTxt} · {r.total} {r.total === 1 ? "item" : "itens"} em {r.propostas} {r.propostas === 1 ? "proposta" : "propostas"}
          </div>

          {r.total === 0 ? (
            <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-8 text-center text-[13px] text-faint">
              Nenhuma busca do bot virou proposta exportada nesse período. O número aparece aqui assim que alguém exporta pro Tiny.
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile rotulo="Usadas como vieram" valor={r.usadas} tom="text-signal"
                  detalhe={`${pct(r.taxa_uso)} dos itens`} />
                <Tile rotulo="Corrigidas" valor={r.corrigidas} tom="text-amber"
                  detalhe={`${pct(r.taxa_correcao)} · ${r.corrigidas_troca} troca de loja · ${r.corrigidas_preco} preço`} />
                <Tile rotulo="Bot não achou" valor={r.sem_oferta} tom="text-rose"
                  detalhe={`${pct(r.taxa_sem_oferta)} · você achou sozinho`} />
                <Tile rotulo="Uso quando trouxe oferta" valor={pct(r.taxa_uso_com_oferta)}
                  detalhe={`${r.total - r.sem_oferta} itens com oferta`} />
                {/* v3.110 — só aparece quando o bot informa custo na telemetria. */}
                {r.custo_usd_total != null ? (
                  <Tile rotulo="Custo por busca usada" valor={usd(r.custo_por_usada_usd)}
                    detalhe={`${usd(r.custo_usd_total)} em ${r.itens_com_custo} itens · ${usd(r.custo_por_item_usd)} por item${r.tempo_medio_s != null ? ` · ${String(r.tempo_medio_s).replace(".", ",")} s` : ""}`} />
                ) : (
                  <Tile rotulo="Custo por busca usada" valor="—" tom="text-faint"
                    detalhe={`sem custo informado pelo bot${r.tempo_medio_s != null ? ` · tempo médio ${String(r.tempo_medio_s).replace(".", ",")} s` : ""}`} />
                )}
              </div>
              <div className="mt-3"><Barra r={r} /></div>

              <div className="mt-6 space-y-4">
                {dados.por_dia.length > 1 && (
                  <TabelaGrupo titulo="Dia" linhas={dados.por_dia} chave="data" rotulo={diaBR} />
                )}
                <TabelaGrupo titulo="Operador" linhas={dados.por_operador} chave="operador"
                  rotulo={(v) => (OPERADORES.find((o) => o.v === v)?.r || v)} />
              </div>

              {/* Itens */}
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className="eyebrow mr-1 text-[10px] font-semibold uppercase text-faint">Itens</span>
                {[["", "Todos"], ["usada", "Usadas"], ["corrigida", "Corrigidas"], ["sem_oferta", "Bot não achou"]].map(([k, t]) => (
                  <button key={k || "todos"} onClick={() => setCategoria(k)}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${categoria === k ? "border-kist bg-kist/10 text-kist" : "border-line2 text-sub hover:bg-paper"}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-paper/70 text-left">
                      {["Data", "Proposta", "Item", "Bot sugeriu", "Saiu com", "Resultado"].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase eyebrow text-faint">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((x) => {
                      const c = CATEGORIAS[x.categoria] || { r: x.categoria, cls: "bg-paper text-sub" };
                      return (
                        <tr key={`${x.proposta_id}-${x.item_uid}-${x.motor}`} className="border-b border-line/70 align-top last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-sub">{diaBR(x.data)}</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <div className="font-mono text-kist">{x.proposta}</div>
                            <div className="max-w-[160px] truncate text-[11px] text-faint" title={x.cliente}>{x.cliente}</div>
                            <div className="text-[10.5px] text-faint">{OPERADORES.find((o) => o.v === x.operador)?.r || x.operador}{x.origem_proposta === "email" ? " · e-mail" : ""}</div>
                          </td>
                          <td className="min-w-[200px] max-w-[280px] px-3 py-2 text-ink">
                            {x.item}
                            {(x.tempo_s != null || x.custo_usd != null) && (
                              <div className="mt-0.5 font-mono text-[10.5px] text-faint">
                                {x.tempo_s != null ? `${String(x.tempo_s).replace(".", ",")} s` : ""}
                                {x.custo_usd != null ? ` · ${usd(x.custo_usd)}` : ""}
                                {x.tokens ? ` · ${x.tokens.toLocaleString("pt-BR")} tk` : ""}
                                {x.do_cache ? " · cache" : ""}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Loja nome={x.loja_bot} link={x.link_bot} />
                            <div className="font-mono text-[11px] text-sub">{reais(x.preco_bot)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Loja nome={x.usada} link={x.link_final} />
                            <div className="font-mono text-[11px] text-sub">
                              {reais(x.custo_final)}
                              {x.diferenca_pct != null && x.veredito !== "acertou" && (
                                <span className="ml-1 text-faint">({x.diferenca_pct > 0 ? "+" : ""}{String(x.diferenca_pct).replace(".", ",")}%)</span>
                              )}
                            </div>
                          </td>
                          <td className="max-w-[240px] px-3 py-2">
                            <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${c.cls}`}>{c.r}</span>
                            <div className="mt-0.5 text-[10.5px] text-faint">{x.mudanca || VEREDITO_TXT[x.veredito] || x.veredito}</div>
                          </td>
                        </tr>
                      );
                    })}
                    {itens.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-[12.5px] text-faint">Nenhum item nessa categoria.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="mt-6 space-y-1 text-[11.5px] leading-relaxed text-faint">
            <p><b className="text-sub">Como conta:</b> o veredito nasce quando a proposta é exportada pro Tiny, comparando o que o bot recomendou com o que saiu. Reexportar substitui o veredito anterior. Preços unitários, de custo.</p>
            <p><b className="text-sub">Corrigida</b> = trocou de loja, ou manteve a loja com custo mais de 15% longe do preço do bot. <b className="text-sub">Bot não achou</b> = o bot não trouxe oferta e o item saiu com origem mesmo assim.</p>
            <p><b className="text-sub">Custo:</b> só entra se o bot mandar tokens e <span className="font-mono">custo_usd</span> na telemetria de cada item; item vindo do cache dele não conta. "Por busca usada" é o custo total dividido pelas buscas que saíram como vieram.</p>
            <p><b className="text-sub">Pros bots:</b> <span className="font-mono">GET /pesquisa/desempenho?de=AAAA-MM-DD&ate=AAAA-MM-DD</span> (ou <span className="font-mono">dias=7</span>, ou nada = compilado). <span className="font-mono">formato=texto</span> devolve texto curto.</p>
          </div>
        </>
      )}
    </div>
  );
}
