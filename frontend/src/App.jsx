import { useState, useRef, useCallback, useEffect } from "react";
import Docs from "./Docs.jsx";
import Propostas from "./Propostas.jsx";
import OrdensCompra from "./OrdensCompra.jsx";
import Analista from "./Analista.jsx";
import ChamadosAdmin from "./ChamadosAdmin.jsx";
import {
  CONF, brl, btnPrimary, btnGhost, Eyebrow, StateLabel, PageHeader,
  CertaintyStrip, Sidebar,
  IconUpload, IconBolt, IconArrow, IconDownload, IconCheck, IconLink, IconX,
  IconGoogle, IconBell, lerContato } from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

// E-mails autorizados — mesma lista/default do backend (USUARIOS_PERMITIDOS).
// Esta é a trava de UX no front; a barreira REAL é o backend (403 em rota protegida).
const USUARIOS_PERMITIDOS = new Set(
  (import.meta.env.VITE_USUARIOS_PERMITIDOS ||
    "leonardobarrey@gmail.com,thiagokist@gmail.com,fabiokist@gmail.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);
const emailAutorizado = (e) => USUARIOS_PERMITIDOS.has((e || "").trim().toLowerCase());

// ── Preço no padrão brasileiro ────────────────────────────────────────────────
// PONTO = separador de milhar, VÍRGULA = centavos. "19213,90" e "19.213,90" -> 19213.90.
// Regra à prova de erro: o separador decimal é o ÚLTIMO ponto/vírgula seguido de 1-2
// dígitos; tudo antes disso é milhar e some. Assim "19213.90" (ponto por hábito) também
// cai em 19213,90 em vez de virar 1.921.390 — não dá pra errar 100x.
function parsePrecoBR(str) {
  let s = String(str ?? "").trim().replace(/[^\d.,]/g, "");
  if (!s) return 0;
  const m = s.match(/[.,](\d{1,2})$/);
  if (m) {
    const dec = m[1];
    const intPart = s.slice(0, s.length - dec.length - 1).replace(/[.,]/g, "");
    return parseFloat((intPart || "0") + "." + dec) || 0;
  }
  return parseFloat(s.replace(/[.,]/g, "")) || 0;
}

// Mostra o número com vírgula; 0/vazio -> "" (campo fica em branco, sem "0" remanescente).
function precoDisplay(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  if (!n) return "";
  return String(n).replace(".", ",");
}

// Campo de preço BR: aceita vírgula/ponto, seleciona tudo no foco (digitar SOBRESCREVE
// o zero, sem sobra) e empurra o número já parseado pro pai. Mantém o texto cru enquanto
// o operador digita (não fica "pulando" a vírgula), reformata no blur.
function PrecoInput({ value, onCommit, className, placeholder = "0,00", ...rest }) {
  const [raw, setRaw] = useState(null);
  const display = raw !== null ? raw : precoDisplay(value);
  return (
    <input
      {...rest}
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={display}
      onFocus={(e) => e.target.select()}
      onChange={(e) => { setRaw(e.target.value); onCommit(parsePrecoBR(e.target.value)); }}
      onBlur={() => setRaw(null)}
    />
  );
}

// Decodifica o payload de um JWT tratando UTF-8 corretamente.
// atob() puro devolve bytes crus e corrompe acentos (ex.: "Fábio" -> "FÃ¡bio").
function decodeJwtPayload(jwt) {
  const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

const isLink = (s) => typeof s === "string" && /^https?:\/\//i.test(s.trim());

// O placeholder ensina o formato do canal escolhido — sem isso o operador
// improvisa e o dado nasce torto ("WHATSAPP 19/06/2026 C/ ANDRIELI").
const CANAL_LBL = { link: "link", whatsapp: "WhatsApp", email: "e-mail",
                    telefone: "telefone", loja: "loja", outro: "" };

// ── Contato acionável ───────────────────────────────────────────────────────
// O contato só vale se levar a algum lugar. Nome + número numa tela é lembrete;
// link que abre a conversa com o pedido escrito é recotação em um clique.

/** Texto do pedido de cotação. NÃO leva nome nem CNPJ do cliente — o fornecedor
 *  não precisa saber pra quem a Kist está vendendo. */
function textoCotacao(item) {
  const l = ["Olá! Preciso de cotação para:", ""];
  l.push(item.descricao_final || item.descricao_original || "");
  const sp = (item.specs_complementares || "").trim();
  if (sp) l.push(sp);
  const qtd = Number(item.quantidade) || 0;
  if (qtd > 0) l.push(`Quantidade: ${qtd} ${item.unidade || "UN"}`);
  const sku = (item.sku_fornecedor || "").trim();
  if (sku) l.push(`Referência: ${sku}`);
  l.push("", "Obrigado!");
  return l.join("\n");
}

/** wa.me exige só dígitos e código do país. "48 99999-0000" -> 5548999990000.
 *  Até 11 dígitos = número BR sem o 55 (11 = celular c/ DDD, 10 = fixo c/ DDD). */
function linkWhatsapp(contato, texto) {
  let d = String(contato || "").replace(/\D/g, "");
  if (d.length < 8) return "";
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

/** mailto abre o cliente padrão da máquina — no caso, o Outlook. */
function linkEmail(contato, item) {
  const e = String(contato || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  const assunto = `Cotação — ${(item.descricao_final || item.descricao_original || "").slice(0, 60)}`;
  return `mailto:${e}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(textoCotacao(item))}`;
}

function linkTelefone(contato) {
  const d = String(contato || "").replace(/\D/g, "");
  return d.length >= 8 ? `tel:+${d.length <= 11 ? "55" + d : d}` : "";
}

/** Devolve {href, rotulo} do contato — ou href vazio quando não dá pra acionar. */
function contatoAcionavel(canal, contato, item) {
  const c = String(contato || "").trim();
  if (!c) return { href: "", rotulo: "" };
  if (isLink(c)) return { href: c, rotulo: c };
  if (canal === "whatsapp") return { href: linkWhatsapp(c, textoCotacao(item)), rotulo: c };
  if (canal === "email")    return { href: linkEmail(c, item), rotulo: c };
  if (canal === "telefone") return { href: linkTelefone(c), rotulo: c };
  return { href: "", rotulo: c };
}

const CONTATO_PH = {
  link:     "https://…",
  whatsapp: "48 99999-0000",
  email:    "vendas@fornecedor.com.br",
  telefone: "48 3333-0000",
  loja:     "endereço ou nome da loja",
  outro:    "como se chega nele",
};

// Marketplaces para pesquisa rápida por item (chip na cor da marca).
// Cada url() recebe a descrição do item e monta a busca já preenchida.
const MARKETPLACES = [
  { nome: "Mercado Livre", label: "ML",  bg: "#FFE600", fg: "#2D3277", url: (q) => `https://lista.mercadolivre.com.br/${encodeURIComponent(q)}` },
  { nome: "Amazon",        label: "a",   bg: "#232F3E", fg: "#FF9900", url: (q) => `https://www.amazon.com.br/s?k=${encodeURIComponent(q)}` },
  { nome: "AliExpress",    label: "Ali", bg: "#E62E04", fg: "#FFFFFF", url: (q) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}` },
  { nome: "Shopee",        label: "S",   bg: "#EE4D2D", fg: "#FFFFFF", url: (q) => `https://shopee.com.br/search?keyword=${encodeURIComponent(q)}` },
  { nome: "eBay",          label: "eb",  bg: "#E53238", fg: "#FFFFFF", url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
];

// ── Linha de item da revisão ───────────────────────────────────────────────
function ItemRow({ item, index, onChange, onRemove, token, apiUrl, fonteTexto, cnpj }) {
  // ── Alerta ────────────────────────────────────────────────────────────
  const [mostrarAlerta, setMostrarAlerta] = useState(false);
  const [alertaTexto, setAlertaTexto] = useState(() => item.alerta_produto?.texto || "");
  const [alertaLinks, setAlertaLinks] = useState(() => (item.alerta_produto?.links || []).join("\n"));
  const [alertaThumb, setAlertaThumb] = useState(() => item.alerta_produto?.thumb_b64 || null);
  const [alertaImagem, setAlertaImagem] = useState(null);          // full — carregada sob demanda
  const [loadingImagem, setLoadingImagem] = useState(false);
  const [salvandoAlerta, setSalvandoAlerta] = useState(false);
  const [imgFullUrl, setImgFullUrl] = useState(null);              // preview overlay

  const temAlerta = !!(item.alerta_produto?.texto || item.alerta_produto?.thumb_b64 ||
                       (item.alerta_produto?.links || []).length > 0);

  // Gerar thumbnail em canvas (150px wide, JPEG q0.6)
  async function gerarThumb(file) {
    return new Promise((res) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const W = 150, ratio = Math.min(W / img.width, 1);
        const cv = document.createElement("canvas");
        cv.width = img.width * ratio; cv.height = img.height * ratio;
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        res(cv.toDataURL("image/jpeg", 0.6));
      };
      img.src = url;
    });
  }

  // Converter imagem full para base64
  async function fileToB64(file) {
    return new Promise((res) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file);
    });
  }

  async function handleImagemUpload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const [thumb, full] = await Promise.all([gerarThumb(file), fileToB64(file)]);
    setAlertaThumb(thumb);
    setAlertaImagem(full);
  }

  async function salvarAlerta() {
    setSalvandoAlerta(true);
    const links = alertaLinks.split("\n").map(l => l.trim()).filter(l => /^https?:\/\//i.test(l));
    const alertaObj = { texto: alertaTexto.trim(), links, thumb_b64: alertaThumb || null };
    const payload = {
      descricao: item.descricao_final,
      alerta: alertaObj,
      ...(alertaImagem ? { alerta_imagem: alertaImagem } : {}),
    };
    try {
      await fetch(`${apiUrl}/produto-alerta`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      // Atualizar item no estado local
      onChange(index, "alerta_produto", alertaObj);
    } catch (e) { console.warn("Alerta não salvo:", e); }
    finally { setSalvandoAlerta(false); }
  }

  async function buscarImagemFull() {
    if (imgFullUrl) { setImgFullUrl(null); return; }          // toggle
    if (alertaImagem) { setImgFullUrl(alertaImagem); return; } // já carregada
    const thumb = item.alerta_produto?.thumb_b64;
    if (!thumb) return;
    // Buscar do banco
    setLoadingImagem(true);
    try {
      const r = await fetch(
        `${apiUrl}/produto-alerta-imagem?descricao=${encodeURIComponent(item.descricao_final)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const d = await r.json();
      if (d.alerta_imagem) { setAlertaImagem(d.alerta_imagem); setImgFullUrl(d.alerta_imagem); }
    } catch (e) {}
    finally { setLoadingImagem(false); }
  }
  // Consulta técnica do item: o operador pergunta, a IA responde (com busca web).
  // É o que ele já fazia numa aba de chat, colando os textos na mão — só que aqui
  // o item já vem carregado e a resposta volta clicável.
  const [conferirAberto, setConferirAberto] = useState(false);
  const [conversa, setConversa] = useState([]);
  const [perguntando, setPerguntando] = useState(false);
  const [rascunhoPergunta, setRascunhoPergunta] = useState("");
  const [mostrarSpecs, setMostrarSpecs] = useState(false);
  // Ficha do banco: SEMPRE recolhida. A lista fica limpa e o operador abre o que
  // quiser — e ele não fica cego, porque o rótulo do toggle já carrega o veredito
  // ("⚠ não é o mesmo item" em vermelho, "⚠ falta informação" em âmbar, "⚠ preço
  // sem lastro"). O sinal está fora; dentro fica o detalhe.
  // Gaveta única "motor de preços": banco + internet + conferir em cascata.
  // "Sem match útil" = sem banco, banco diferente, inconclusivo, ou confiança fraca.
  // Nesse caso a internet cobre a lacuna: a gaveta abre sozinha E a internet busca
  // sozinha. Em match bom (mesmo/EXATO/SIMILAR), a gaveta fica fechada; ao abrir,
  // mostra o banco e a internet é OPCIONAL (botão "buscar na internet").
  // "Sem match útil" decide se a busca dispara. A CONFIANÇA é a fonte de verdade
  // porque é persistida — a ficha do banco (item.banco) NÃO sobrevive ao reload da
  // proposta, então usar !item.banco fazia TODO item recarregado parecer "sem
  // match" e disparar busca em massa (afogava o backend). Match alta/media não busca.
  const _conf = item.confianca_match || "nenhuma";
  // Busca na internet SÓ em match INCERTO ou SEM match (regra do Leonardo). Match
  // confiável = 'alta' + IDÊNTICO + com lastro — é o único caso em que o banco
  // preenche valor (trava do backend). 'media'/'baixa'/'nenhuma', veredito
  // diferente/inconclusivo e 'alta' apenas SEMÂNTICO não preenchem nada => buscam.
  // O operador sempre pode disparar a busca na mão pelo botão da gaveta.
  //
  // ANCORAGEM (lição do congelamento de 20/07): só campos PERSISTIDOS entram na
  // condição. `identico` e `banco` só existem na GERAÇÃO; ao reabrir uma proposta
  // salva voltam undefined. Por isso `identico !== false` — undefined conta como
  // confiável DE PROPÓSITO, senão o reload dispararia busca em massa e afogaria o
  // backend. E item que já tem preço nunca busca.
  const _temPreco = Number(item.preco_un) > 0;
  const _matchConfiavel = _conf === "alta"
    && item.identico !== false
    && !item.banco?.sem_lastro
    && item.banco?.veredito !== "diferente"
    && item.banco?.veredito !== "inconclusivo";
  const semMatchUtil = !_temPreco && !_matchConfiavel;
  const [motorAberto, setMotorAberto] = useState(() => semMatchUtil);
  const [mostrarOrigem, setMostrarOrigem] = useState(true);

  // ── Ficha da internet (Frente A) ──────────────────────────────────────────
  // Busca REFERÊNCIA de mercado quando o item não tem match no banco. A internet
  // apresenta; o preço de venda continua decisão do operador. "Usar" sobe a origem
  // (e a descrição, se ele escolher) e marca origem_escolha='internet' — é isso que
  // ensina o nó no /upsert-precos.
  const [net, setNet] = useState(null);          // ficha devolvida pelo /ficha-internet
  const [netLoad, setNetLoad] = useState(false);
  const [netErr, setNetErr] = useState("");
  const [reTermo, setReTermo] = useState("");
  const [descFonte, setDescFonte] = useState("cliente");  // 'cliente' | 'internet'
  const netBuscadoRef = useRef(false);           // evita busca repetida

  async function buscarInternet(termoRebusca) {
    setNetLoad(true); setNetErr("");
    try {
      const r = await fetch(`${apiUrl}/ficha-internet`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          item: {
            descricao: item.descricao_original || item.descricao_final,
            descricao_original: item.descricao_original,
            specs_complementares: item.specs_complementares || "",
            quantidade: item.quantidade, unidade: item.unidade,
          },
          cnpj: cnpj || null,
          termo_rebusca: (termoRebusca || "").trim() || null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ficha = await r.json();
      setNet(ficha);
      if (!(ficha.apresentacoes || []).length) setNetErr("Não achei o mesmo item na internet.");
    } catch (e) {
      setNetErr("Não consegui buscar agora. Tente de novo.");
    } finally {
      setNetLoad(false);
    }
  }

  // Dispara a busca automaticamente SÓ para item sem match ou incerto (é o que
  // cobre a lacuna). Match bom não busca. A condição semMatchUtil se apoia na
  // CONFIANÇA (persistida), não na ficha do banco (que não sobrevive ao reload).
  useEffect(() => {
    if (motorAberto && semMatchUtil && !netBuscadoRef.current && (item.descricao_original || item.descricao_final)) {
      netBuscadoRef.current = true;
      buscarInternet();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motorAberto]);

  // "Usar esta ficha": sobe origem + (descrição, se escolheu a da internet) e marca
  // a escolha p/ o backend aprender o nó. Não sobrescreve o preço de venda — a
  // internet é referência; o operador decide o preço dele.
  function usarFichaInternet(ap) {
    // REGRA (Leonardo, jul/2026): "usar esta" atualiza o card central INTEIRO,
    // MENOS A DESCRIÇÃO — a descrição do cliente é preservada sempre.
    // Da internet vem UM preço só: ele é o CUSTO (é o que se paga pra comprar).
    // A VENDA fica EM BRANCO — quem define é o operador.
    if (ap.preco_brl !== null && ap.preco_brl !== undefined) {
      onChange(index, "preco_custo", Number(ap.preco_brl) || 0);
    }
    onChange(index, "preco_un", 0);          // venda em branco
    // Origem do preço: é isso que carrega o banco (link + loja) e evita re-buscar.
    if (ap.url) {
      onChange(index, "link_fornecedor", ap.url);
      onChange(index, "fornecedor_canal", "link");
      onChange(index, "fornecedor_contato", ap.url);
    }
    if (ap.fonte) onChange(index, "fornecedor", ap.fonte);
    if (ap.sku) onChange(index, "sku_fornecedor", ap.sku);
    onChange(index, "origem_escolha", "internet");
    onChange(index, "origem_internet", {
      fonte_url: ap.url || "", fonte_nome: ap.fonte || "", apresentacao: ap.apresentacao || "",
    });
    if (net?.perfil) onChange(index, "interpretacao", net.perfil);
  }

  // "usar esta" do card do BANCO: traz o pacote completo (venda + custo + origem),
  // sem tocar na descrição do cliente.
  function usarFichaBanco() {
    const b = item.banco || {};
    if (b.preco_un > 0)    onChange(index, "preco_un", Number(b.preco_un));
    if (b.preco_custo > 0) onChange(index, "preco_custo", Number(b.preco_custo));
    if (b.link_fornecedor) {
      onChange(index, "link_fornecedor", b.link_fornecedor);
      onChange(index, "fornecedor_canal", "link");
      onChange(index, "fornecedor_contato", b.link_fornecedor);
    }
    if (b.fornecedor) onChange(index, "fornecedor", b.fornecedor);
    onChange(index, "origem_escolha", "banco");
  }

  async function perguntar(texto) {
    const q = (texto || rascunhoPergunta).trim();
    if (!q || perguntando) return;
    setConferirAberto(true);
    setRascunhoPergunta("");
    const historico = conversa.map((m) => ({ role: m.role, content: m.content }));
    setConversa((c) => [...c, { role: "user", content: q }]);
    setPerguntando(true);
    try {
      const res = await fetch(`${apiUrl}/conferir`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pergunta: q, item, fonte_texto: fonteTexto || "", historico }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "falhou");
      const d = await res.json();
      setConversa((c) => [...c, { role: "assistant", content: d.resposta, buscas: d.buscas || [] }]);
    } catch (e) {
      setConversa((c) => [...c, { role: "assistant", content: `Não consegui responder agora (${e.message}). Tenta de novo.`, erro: true }]);
    } finally { setPerguntando(false); }
  }

  // Escritos a partir das perguntas que o Leonardo já faz fora do sistema.
  const ATALHOS = [
    { rotulo: "É o mesmo item?", q: "O que eu preenchi é o mesmo item que o cliente pediu? Se não for, me diga exatamente o que difere." },
    { rotulo: "Que item é esse?", q: "Que item é esse que o cliente pediu? Identifique fabricante e modelo pelo código/descrição." },
    { rotulo: "PN e fabricante?", q: "Qual o PN e o fabricante do item que o cliente pediu?" },
    { rotulo: "Descrição comercial?", q: "Qual a descrição comercial correta desse item?" },
    { rotulo: "Sugerir PN", q: "Sugira PNs específicos de fabricantes que atendam essa especificação, do mais em conta ao mais caro." },
  ];

  const confianca = item.confianca_match || "nenhuma";
  const c = CONF[confianca];
  const semPreco = !(item.preco_un > 0);
  // Lê o que ele colou e preenche o que está vazio. NUNCA sobrescreve o que o
  // operador digitou — ele é a hierarquia superior, inclusive contra o parser.
  function aplicarLeitura(idx, txt, it) {
    const r = lerContato(txt);
    if (!r) return;
    if (r.contato && r.contato !== txt.trim()) onChange(idx, "fornecedor_contato", r.contato);
    if (r.canal && !it.fornecedor_canal) onChange(idx, "fornecedor_canal", r.canal);
    if (r.quem && !(it.fornecedor || "").trim()) onChange(idx, "fornecedor", r.quem);
    // Link do produto: se colou uma URL, ela também é o link de compra.
    if (r.canal === "link" && !(it.link_fornecedor || "").trim())
      onChange(idx, "link_fornecedor", r.contato);
  }

  const temOrigem = !!(item.link_fornecedor || item.fornecedor || item.fornecedor_contato
                       || item.sku_fornecedor || (item.preco_custo > 0));

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
          <div className="flex items-center gap-1">
            <input
              className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[13px] text-ink cell-input"
              value={item.descricao_final}
              onChange={(e) => onChange(index, "descricao_final", e.target.value)}
            />
            {/* Buscar no Google */}
            <a href={`https://www.google.com/search?q=${encodeURIComponent(item.descricao_final)}`}
              target="_blank" rel="noopener noreferrer"
              title="Buscar no Google"
              className="flex-shrink-0 rounded-md p-1 text-faint/60 transition-colors hover:bg-paper hover:text-ink"
              onClick={(e) => e.stopPropagation()}>
              <IconGoogle size={15} />
            </a>
            {/* Pesquisa rápida por marketplace */}
            {MARKETPLACES.map((mp) => (
              <a key={mp.nome}
                href={mp.url(item.descricao_final)}
                target="_blank" rel="noopener noreferrer"
                title={`Buscar em ${mp.nome}`}
                className="flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] px-[3px] text-[9px] font-bold leading-none transition-opacity hover:opacity-80"
                style={{ background: mp.bg, color: mp.fg }}
                onClick={(e) => e.stopPropagation()}>
                {mp.label}
              </a>
            ))}
            {/* Alerta do produto */}
            <button
              onClick={() => setMostrarAlerta((v) => !v)}
              title={temAlerta ? "Ver / editar alerta" : "Adicionar alerta"}
              className={`relative flex-shrink-0 rounded-md p-1 transition-colors hover:bg-paper
                ${temAlerta ? "text-amber" : "text-faint/60 hover:text-ink"}`}>
              <IconBell size={15} />
              {temAlerta && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-amber text-[8px] font-bold text-white">!</span>
              )}
            </button>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 pl-1.5">
            <StateLabel conf={confianca} />
            {/* Motor de preços: banco + internet + conferir numa gaveta só.
                O rótulo carrega o veredito, como antes carregava no toggle do banco. */}
            <button onClick={() => setMotorAberto((v) => !v)}
              className={`inline-flex items-center gap-1 text-[11px] font-medium hover:opacity-80
                ${item.banco?.veredito === "diferente" ? "text-rose"
                  : (item.banco?.veredito === "inconclusivo" || item.banco?.sem_lastro) ? "text-amber"
                  : "text-kist"}`}>
              <IconBolt size={11} />
              {motorAberto ? "fechar motor de preços"
                : item.banco?.veredito === "diferente" ? "motor de preços · ⚠ não é o mesmo"
                : item.banco?.veredito === "inconclusivo" ? "motor de preços · ⚠ falta info"
                : item.banco?.sem_lastro ? "motor de preços · ⚠ sem lastro"
                : (!item.banco || confianca === "nenhuma") ? "motor de preços · sem banco"
                : "motor de preços"}
            </button>
            <button onClick={() => setMostrarSpecs((v) => !v)} className="text-[11px] text-faint hover:text-sub">
              {mostrarSpecs ? "− descrição complementar" : "+ descrição complementar"}
            </button>
            <button onClick={() => setMostrarOrigem((v) => !v)}
              className={`text-[11px] hover:text-sub ${temOrigem ? "text-kist" : "text-faint"}`}>
              {mostrarOrigem ? "− origem do preço" : temOrigem ? "✓ origem do preço" : "+ origem do preço"}
            </button>
            {onRemove && (
              <button
                onClick={() => { if (window.confirm(`Excluir "${(item.descricao_final || "este item").slice(0, 50)}" da proposta?`)) onRemove(index); }}
                title="Excluir item da proposta"
                className="ml-auto text-[11px] text-faint/70 hover:text-rose">
                ✕ excluir
              </button>
            )}
          </div>
          {mostrarSpecs && (
            <textarea
              value={item.specs_complementares || ""}
              onChange={(e) => onChange(index, "specs_complementares", e.target.value)}
              rows={2}
              placeholder="PN, código, specs técnicas… (vai para 'Descrição complementar' no Tiny)"
              className="mt-1.5 w-full resize-none rounded-md border border-line bg-paper p-2 font-mono text-[11px] text-ink outline-none placeholder:text-faint" />
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
            <PrecoInput
              className={`w-24 rounded-md bg-transparent px-1 py-1 text-right font-mono text-[12.5px] cell-input
                ${semPreco ? "text-amber placeholder:text-amber/70" : "text-ink"}`}
              placeholder="—"
              value={item.preco_un}
              onCommit={(v) => onChange(index, "preco_un", v)}
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
              {/* QUEM · POR ONDE · O CONTATO — três coisas, três campos.
                  Antes disputavam dois, e o operador improvisava: "volt - wpp",
                  "WPP DATALINK 115848", "DIGITALSAT" no campo de link. */}
              <div className="flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                <span className="eyebrow text-[9px] font-bold uppercase text-faint">Quem</span>
                <input
                  className="w-32 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
                  placeholder="DigitalSAT"
                  value={item.fornecedor || ""}
                  onChange={(e) => onChange(index, "fornecedor", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2 py-1.5">
                <select
                  className="cursor-pointer bg-transparent text-[12px] text-ink outline-none"
                  value={item.fornecedor_canal || ""}
                  onChange={(e) => onChange(index, "fornecedor_canal", e.target.value)}>
                  <option value="">por onde…</option>
                  <option value="link">link</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">e-mail</option>
                  <option value="telefone">telefone</option>
                  <option value="loja">loja</option>
                  <option value="outro">outro</option>
                </select>
              </div>
              <div className="flex min-w-[240px] flex-1 items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                <span className="eyebrow flex-shrink-0 text-[9px] font-bold uppercase text-faint">Contato</span>
                <input
                  className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
                  placeholder={CONTATO_PH[item.fornecedor_canal] || "cole o link, o WhatsApp ou o e-mail"}
                  value={item.fornecedor_contato || ""}
                  onChange={(e) => onChange(index, "fornecedor_contato", e.target.value)}
                  onBlur={(e) => aplicarLeitura(index, e.target.value, item)}
                  onPaste={(e) => {
                    // Colar é o gesto mais comum aqui — resolve na hora, sem esperar o blur.
                    const txt = e.clipboardData.getData("text");
                    setTimeout(() => aplicarLeitura(index, txt, item), 0);
                  }}
                />
                {/* Abre o que ele acabou de digitar: confere o dado e já cota. */}
                {(() => {
                  const { href } = contatoAcionavel(item.fornecedor_canal, item.fornecedor_contato, item);
                  if (!href) return null;
                  return (
                    <a href={href} target="_blank" rel="noreferrer"
                      title={item.fornecedor_canal === "whatsapp" ? "Abrir conversa com o pedido pronto"
                           : item.fornecedor_canal === "email" ? "Abrir e-mail com o pedido pronto" : "Abrir"}
                      className="flex-shrink-0 rounded-md p-1 text-kist transition-colors hover:bg-paper">
                      <IconLink size={13} />
                    </a>
                  );
                })()}
              </div>
              {isLink(item.link_fornecedor) && (
                <a href={item.link_fornecedor} target="_blank" rel="noreferrer"
                  title="Abrir a página do produto no fornecedor"
                  className="flex items-center gap-1 rounded-lg border border-line2 bg-surface px-2.5 py-1.5 text-[12px] font-medium text-kist hover:border-kist">
                  <IconLink size={12} /> produto
                </a>
              )}
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
                <PrecoInput
                  className="w-24 bg-transparent text-right font-mono text-[12px] text-ink outline-none"
                  value={item.preco_custo}
                  onCommit={(v) => onChange(index, "preco_custo", v)}
                />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 py-1.5">
                <span className="text-[11px] text-faint">Frete (item)</span>
                <span className="text-[11px] text-faint">R$</span>
                <PrecoInput
                  className="w-24 bg-transparent text-right font-mono text-[12px] text-ink outline-none"
                  value={item.frete_vinda}
                  onCommit={(v) => onChange(index, "frete_vinda", v)}
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

      {/* ── FICHA DE PROCEDÊNCIA — linha própria, largura inteira ────────────
          Os dois lados LADO A LADO, que é como o olho compara. Antes isto vivia
          espremido dentro do <td> da descrição, junto com o input, o Google, os
          marketplaces, o sino e quatro toggles — onze coisas numa célula.
          Comparar spec exige ler em paralelo, não rolar pra cima e pra baixo. */}
      {/* ── MOTOR DE PREÇOS: banco (esq) + internet (dir) lado a lado ──────────
          A descrição do cliente já está no card do item, no topo — aqui só as
          duas propostas, como no desenho. Em match bom a internet é opcional. */}
      {motorAberto && (
        <tr className="border-b border-line/70 bg-paper/60">
          <td /><td />
          <td colSpan={4} className="px-3 pb-3 pt-2">

            {item.banco?.veredito === "diferente" && (
              <div className="mb-2.5 rounded-lg border border-rose/30 bg-rosebg px-3 py-2">
                <div className="text-[12px] font-semibold text-rose">Não é o mesmo item</div>
                {item.banco.diferencas?.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {item.banco.diferencas.map((d, k) => (
                      <li key={k} className="text-[12px] leading-relaxed text-sub">• {d}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-0.5 text-[12px] text-sub">{item.banco.defesa}</div>
                )}
              </div>
            )}
            {item.banco?.veredito === "inconclusivo" && (
              <div className="mb-2.5 rounded-lg border border-amber/30 bg-amberbg px-3 py-2">
                <div className="text-[12px] font-semibold text-amber">Não dá pra decidir</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-sub">
                  {item.banco.falta || item.banco.defesa}
                </div>
              </div>
            )}

            {net?.perfil?.consulta && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-faint">Entendi:</span>
                <span className="font-medium text-ink">{net.perfil.consulta}</span>
                {net.perfil.conferiu_web && (
                  <span className="rounded-md border border-line2 bg-paper px-1.5 py-0.5 text-[10px] font-medium text-kist">conferido na web</span>
                )}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">

              {/* ── BANCO (esquerda) ── */}
              {item.banco ? (
                <div className="rounded-lg border border-line2 bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="eyebrow text-[9px] font-semibold uppercase text-faint">O banco propõe</div>
                    <button
                      onClick={usarFichaBanco}
                      title="Usar este preço: traz venda, custo e origem (a descrição do cliente é preservada)"
                      className="-mt-0.5 flex-shrink-0 rounded-md border border-line2 px-2 py-0.5 text-[11px] font-medium text-sub hover:border-kist hover:text-kist">
                      usar esta
                    </button>
                  </div>
                  <div className="mt-1 text-[13px] font-medium leading-snug text-ink">{item.banco.descricao}</div>

                  <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-2 text-[12px]">
                    <span><span className="text-faint">Venda </span><span className="font-mono text-ink">{brl(item.banco.preco_un)}</span></span>
                    <span><span className="text-faint">Custo </span>
                      <span className={`font-mono ${item.banco.preco_custo > 0 ? "text-ink" : "text-faint"}`}>
                        {item.banco.preco_custo > 0 ? brl(item.banco.preco_custo) : "—"}
                      </span></span>
                    {item.banco.preco_custo > 0 && item.banco.preco_un > 0 && (
                      <span className="font-mono text-signal">
                        +{Math.round((item.banco.preco_un / item.banco.preco_custo - 1) * 100)}%
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 space-y-1 text-[11.5px]">
                    <div>
                      <span className="text-faint">Vendido para </span>
                      <span className="text-ink">{item.banco.cliente || "—"}</span>
                      {item.banco.cnpj && <span className="ml-1.5 font-mono text-faint">{item.banco.cnpj}</span>}
                    </div>
                    <div>
                      <span className="text-faint">Origem </span>
                      {(() => {
                        const quem  = item.banco.fornecedor || "";
                        const canal = item.banco.fornecedor_canal || "";
                        const cont  = item.banco.fornecedor_contato || "";
                        const linkProd = isLink(item.banco.link_fornecedor) ? item.banco.link_fornecedor : "";
                        const { href, rotulo } = contatoAcionavel(canal, cont, item);
                        const alvo = href || linkProd;
                        if (!quem && !cont && !linkProd) return <span className="text-amber">sem lastro</span>;
                        return (
                          <span>
                            {alvo ? (
                              <a href={alvo} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-kist hover:text-kist600">
                                <IconLink size={10} />{quem || rotulo || "abrir"}
                              </a>
                            ) : (
                              <span className="text-ink">{quem || rotulo || item.banco.link_fornecedor}</span>
                            )}
                            {canal && canal !== "outro" && canal !== "link" && (
                              <span className="text-faint"> · {CANAL_LBL[canal] || canal}</span>
                            )}
                            {cont && !isLink(cont) && <span className="ml-1 font-mono text-sub">{cont}</span>}
                          </span>
                        );
                      })()}
                      {item.banco.sku_fornecedor && <span className="ml-1.5 font-mono text-faint">{item.banco.sku_fornecedor}</span>}
                    </div>
                    <div className="text-faint">
                      {item.banco.criado_em && <>Criado {new Date(item.banco.criado_em).toLocaleDateString("pt-BR")} · </>}
                      Atualizado {item.banco.data_ref ? item.banco.data_ref.split("-").reverse().join("/") : "—"}
                      {item.banco.usuario_nome ? ` por ${item.banco.usuario_nome}` : ""}
                      {item.banco.proposta_tiny ? ` · proposta ${item.banco.proposta_tiny}` : ""}
                    </div>
                  </div>

                  {item.banco.veredito === "mesmo" && item.banco.defesa && (
                    <div className="mt-2 border-l-2 border-signal/40 pl-2 text-[11.5px] leading-relaxed text-sub">
                      {item.banco.defesa}
                    </div>
                  )}
                  {item.banco.sem_lastro && (
                    <div className="mt-2.5 rounded-lg border border-amber/30 bg-amberbg px-3 py-2">
                      <div className="text-[12px] font-semibold text-amber">Preço não importado</div>
                      <div className="mt-0.5 text-[12px] leading-relaxed text-sub">
                        Este produto está sem {item.banco.falta_lastro} no banco. Recote e preencha.
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-line2 bg-surface p-3 text-center text-[12px] text-faint">
                  Sem item correspondente no banco
                </div>
              )}

              {/* ── INTERNET (direita) ── */}
              <div>
                {netLoad && (
                  <div className="flex h-full items-center rounded-lg border border-line2 bg-surface px-3 py-2.5 text-[12px] text-sub">
                    Buscando preço na internet…
                  </div>
                )}

                {!netLoad && netErr && (
                  <div className="rounded-lg border border-amber/30 bg-amberbg px-3 py-2 text-[12px] text-amber">
                    {netErr}
                    <button onClick={() => { netBuscadoRef.current = true; buscarInternet(); }}
                      className="ml-2 rounded-md border border-line2 px-2 py-0.5 text-[11px] font-medium text-sub hover:border-kist hover:text-kist">
                      tentar de novo
                    </button>
                  </div>
                )}

                {!netLoad && !net && !netErr && !netBuscadoRef.current && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line2 bg-surface p-3 text-center">
                    <div className="text-[12px] text-faint">Referência de mercado na internet</div>
                    <button onClick={() => { netBuscadoRef.current = true; buscarInternet(); }}
                      className="rounded-md border border-line2 px-2.5 py-1 text-[11px] font-medium text-kist hover:border-kist">
                      🌐 buscar na internet
                    </button>
                  </div>
                )}

                {!netLoad && net && (net.apresentacoes || []).length > 0 && (
                  <div className="rounded-lg border border-kist/40 bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="eyebrow text-[9px] font-semibold uppercase text-faint">A internet propõe</div>
                      <span className="rounded-md bg-signalbg px-1.5 py-0.5 text-[10px] font-medium text-signal">mesmo item</span>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      {net.apresentacoes.map((ap, k) => {
                        const imp = !!(ap.fator_importacao && ap.fator_importacao > 1);
                        return (
                          <div key={k} className="border-t border-line pt-1.5 first:border-t-0 first:pt-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-[12px] text-sub">{ap.apresentacao || "unidade"}</span>
                              <div className="flex items-center gap-2">
                                {ap.preco_brl != null ? (
                                  <span className="font-mono text-[14px] font-medium text-ink">{brl(ap.preco_brl)}</span>
                                ) : (
                                  <span className="text-[11px] font-medium text-amber">sob consulta</span>
                                )}
                                <button
                                  onClick={() => usarFichaInternet(ap)}
                                  title="Usar esta ficha e preencher a origem do preço"
                                  className="rounded-md border border-line2 px-2 py-0.5 text-[11px] font-medium text-sub hover:border-kist hover:text-kist">
                                  usar esta
                                </button>
                              </div>
                            </div>
                            {imp && (
                              <div className="mt-0.5 font-mono text-[10.5px] text-faint">
                                {ap.moeda_original} {ap.preco_original} × {ap.cotacao_usada} (câmbio) × {ap.fator_importacao} = {brl(ap.preco_estimado_brl)} posto
                              </div>
                            )}
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
                              <span>{ap.fonte || "—"}</span><span>·</span>
                              <span>{ap.tipo_preco === "atacado" ? "atacado" : (imp ? "importado" : "varejo")}</span>
                              {ap.url && (<><span>·</span><a href={ap.url} target="_blank" rel="noreferrer" className="text-kist hover:underline">ver anúncio</a></>)}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2.5 border-t border-line pt-2">
                      <div className="eyebrow text-[9px] font-semibold uppercase text-faint">Descrição na proposta</div>
                      <div className="mt-1 flex flex-col gap-1 text-[12px] text-ink">
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`desc-${index}`} checked={descFonte === "cliente"} onChange={() => setDescFonte("cliente")} />
                          manter a do cliente
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`desc-${index}`} checked={descFonte === "internet"} onChange={() => setDescFonte("internet")} />
                          usar a da internet
                        </label>
                      </div>
                    </div>

                    {!cnpj && (
                      <div className="mt-2 rounded-md border border-rose/30 bg-rosebg px-2 py-1.5 text-[11px] text-rose">
                        Sem CNPJ na proposta — o sistema não vai aprender a buscar sozinho para este cliente.
                      </div>
                    )}
                  </div>
                )}

                {!netLoad && net && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="whitespace-nowrap text-[11px] text-faint">não é isso?</span>
                    <input
                      value={reTermo}
                      onChange={(e) => setReTermo(e.target.value)}
                      placeholder="re-buscar com outro termo"
                      className="flex-1 rounded-md border border-line2 bg-surface px-2 py-1 text-[12px]" />
                    <button
                      onClick={() => buscarInternet(reTermo)}
                      className="rounded-md border border-line2 px-2 py-1 text-[11px] font-medium text-sub hover:border-kist hover:text-kist">
                      buscar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── 3ª CASCATA: conferir com a IA ────────────────────────────────────
          Quando banco e internet não bastam, o operador pergunta à IA sobre o
          item (o chat abre logo abaixo, controlado por conferirAberto). */}
      {motorAberto && (
        <tr className="border-b border-line/70 bg-paper/60">
          <td /><td />
          <td colSpan={4} className="px-3 pb-2.5">
            <button onClick={() => setConferirAberto((v) => !v)}
              className={`inline-flex items-center gap-1 text-[11px] font-medium hover:opacity-80
                ${item.pede_atencao && !conferirAberto ? "text-kist" : "text-sub"}`}>
              <IconBolt size={11} />
              {conferirAberto ? "fechar conversa com a IA" : "conferir com a IA — perguntar sobre o item"}
            </button>
          </td>
        </tr>
      )}


      {/* ── Painel de Alerta ─────────────────────────────────────────────── */}
      {mostrarAlerta && (
        <tr className="border-b border-line/70 bg-amberbg/30">
          <td /><td />
          <td colSpan={4} className="px-3 pb-3 pt-2">
            <div className="rounded-xl border border-amber/30 bg-amber/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconBell size={13} className="text-amber" />
                  <span className="text-[12px] font-semibold text-amber">Alerta do produto</span>
                  <span className="text-[10.5px] text-faint">— salvo no banco, não vai pro Tiny</span>
                </div>
                <button onClick={() => setMostrarAlerta(false)} className="text-faint hover:text-rose"><IconX size={13} /></button>
              </div>

              {/* Texto */}
              <textarea rows={3} value={alertaTexto}
                onChange={(e) => setAlertaTexto(e.target.value)}
                placeholder="Ex: prazo fabricação 45 dias · registrar oportunidade no CRM · produto descontinuado…"
                className="w-full resize-none rounded-lg border border-amber/30 bg-paper px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint/60 focus:ring-1 focus:ring-amber/50" />

              {/* Links */}
              <div className="mt-2">
                <div className="mb-1 text-[10.5px] text-faint">Links (um por linha)</div>
                <textarea rows={2} value={alertaLinks}
                  onChange={(e) => setAlertaLinks(e.target.value)}
                  placeholder="https://fornecedor.com/produto&#10;https://..."
                  className="w-full resize-none rounded-lg border border-line2 bg-paper px-3 py-1.5 font-mono text-[11.5px] text-ink outline-none placeholder:text-faint/60 focus:ring-1 focus:ring-kist" />
              </div>

              {/* Imagem */}
              <div className="mt-2 flex items-start gap-3">
                <div className="flex-1">
                  <div className="mb-1 text-[10.5px] text-faint">Print / imagem (thumb exibida, full sob demanda)</div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line2 bg-paper px-3 py-1.5 text-[12px] text-sub hover:border-kist/40 hover:text-kist">
                    <IconUpload size={13} />
                    {alertaThumb ? "Trocar imagem" : "Adicionar print"}
                    <input type="file" accept="image/*" className="hidden" onChange={handleImagemUpload} />
                  </label>
                </div>
                {alertaThumb && (
                  <div className="relative flex-shrink-0">
                    <img src={alertaThumb} alt="thumb"
                      className="h-16 w-24 cursor-pointer rounded-lg border border-amber/30 object-cover hover:border-amber"
                      onClick={buscarImagemFull}
                      title={loadingImagem ? "Carregando…" : "Clique para ver a imagem completa"} />
                    {loadingImagem && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
                        <span className="animate-spin text-amber"><IconBolt size={14} /></span>
                      </div>
                    )}
                    <button onClick={() => { setAlertaThumb(null); setAlertaImagem(null); }}
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose text-[9px] text-white">✕</button>
                  </div>
                )}
              </div>

              {/* Overlay imagem full */}
              {imgFullUrl && (
                <div className="mt-2 rounded-xl border border-line bg-paper p-2 text-center">
                  <img src={imgFullUrl} alt="alerta full" className="mx-auto max-h-96 rounded-lg object-contain" />
                  <button onClick={() => setImgFullUrl(null)} className="mt-1.5 text-[11px] text-faint hover:text-rose">fechar</button>
                </div>
              )}

              {/* Links renderizados */}
              {alertaLinks.trim() && (
                <div className="mt-2 space-y-0.5">
                  {alertaLinks.split("\n").map(l => l.trim()).filter(l => /^https?:\/\//i.test(l)).map((l, i) => (
                    <a key={i} href={l} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[12px] text-kist hover:underline">
                      <IconLink size={11} /> {l.length > 60 ? l.slice(0, 60) + "…" : l}
                    </a>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button onClick={salvarAlerta} disabled={salvandoAlerta}
                  className={`${btnPrimary} py-1.5 text-[12px] ${salvandoAlerta ? "opacity-60" : ""}`}>
                  {salvandoAlerta ? "Salvando…" : <><IconCheck size={13} /> Salvar alerta</>}
                </button>
                <span className="text-[10.5px] text-faint">salvo no banco · aparece em cotações futuras</span>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── CONFERIR — consulta técnica do item ─────────────────────────────
          O operador já faz isto hoje numa aba de chat, colando descrição e specs
          na mão. Aqui o item já vem carregado (inclusive o e-mail original do
          cliente), a IA busca na web quando o código é específico, e a resposta
          volta clicável. Fica fora do caminho crítico de propósito: o matching
          precisa ser determinístico e rápido; isto é sob demanda. */}
      {conferirAberto && (
        <tr className="border-b border-line/70 bg-paper/60">
          <td /><td />
          <td colSpan={4} className="px-3 pb-3 pt-2">
            <div className="rounded-lg border border-line2 bg-surface">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <div className="eyebrow text-[9px] font-semibold uppercase text-faint">
                  Conferir item {String(index + 1).padStart(2, "0")}
                </div>
                <button onClick={() => setConferirAberto(false)} className="rounded p-0.5 text-faint hover:text-ink">
                  <IconX size={14} />
                </button>
              </div>

              {conversa.length === 0 && (
                <div className="px-3 pt-2.5 text-[11.5px] leading-relaxed text-sub">
                  Pergunte o que quiser sobre este item. O que o cliente pediu, o e-mail
                  original e o que você preencheu já estão carregados.
                </div>
              )}

              <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                {ATALHOS.map((a) => (
                  <button key={a.rotulo} onClick={() => perguntar(a.q)} disabled={perguntando}
                    className="rounded-full border border-line2 px-2.5 py-1 text-[11px] text-sub transition-colors hover:border-kist hover:text-kist disabled:opacity-40">
                    {a.rotulo}
                  </button>
                ))}
              </div>

              {conversa.length > 0 && (
                <div className="max-h-[380px] space-y-2.5 overflow-auto border-t border-line px-3 py-2.5">
                  {conversa.map((m, k) => m.role === "user" ? (
                    <div key={k} className="text-[11.5px] leading-relaxed text-faint">
                      <span className="eyebrow mr-1.5 text-[9px] font-semibold uppercase">Você</span>
                      {m.content}
                    </div>
                  ) : (
                    <div key={k} className={`rounded-md border px-2.5 py-2 ${m.erro ? "border-rose/30 bg-rosebg" : "border-line2 bg-paper"}`}>
                      <div className={`whitespace-pre-wrap text-[12px] leading-relaxed ${m.erro ? "text-rose" : "text-ink"}`}>
                        {m.content}
                      </div>
                      {m.buscas?.length > 0 && (
                        <div className="mt-1.5 text-[10px] text-faint">buscou: {m.buscas.join(" · ")}</div>
                      )}
                      {!m.erro && (
                        <div className="mt-2 flex gap-1.5 border-t border-line pt-1.5">
                          <button onClick={() => onChange(index, "descricao_final", m.content.split("\n")[0].trim())}
                            title="Usar a primeira linha como descrição do item"
                            className="rounded border border-line2 px-1.5 py-0.5 text-[10px] text-sub hover:border-kist hover:text-kist">
                            usar como descrição
                          </button>
                          <button onClick={() => onChange(index, "specs_complementares",
                            ((item.specs_complementares || "") + "\n" + m.content).trim())}
                            className="rounded border border-line2 px-1.5 py-0.5 text-[10px] text-sub hover:border-kist hover:text-kist">
                            somar às specs
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {perguntando && <div className="text-[11.5px] text-faint">consultando…</div>}
                </div>
              )}

              <div className="flex items-center gap-2 border-t border-line px-3 py-2">
                <input
                  value={rascunhoPergunta}
                  onChange={(e) => setRascunhoPergunta(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(); } }}
                  placeholder="ex: SHURE SB900A e SB900B é a mesma coisa?"
                  className="flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint" />
                <button onClick={() => perguntar()} disabled={perguntando || !rascunhoPergunta.trim()}
                  className="rounded-md border border-line2 px-2 py-1 text-[11px] font-medium text-sub hover:border-kist hover:text-kist disabled:opacity-40">
                  perguntar
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function App() {
  // Sessão persistida em sessionStorage: sobrevive a refresh/deploy,
  // limpa ao fechar a aba. auto_select no Google reconecta silenciosamente
  // na maioria dos casos sem interação do usuário.
  const [propostaId, setPropostaId]     = useState(null);   // DB id após primeiro save
  const [salvando,   setSalvando]       = useState(false);  // indicator de auto-save
  const [ultimoSalvo, setUltimoSalvo]   = useState(null);   // timestamp do último save
  const autoSaveRef   = useRef(null);                        // timer debounce
  const modificadoRef = useRef(false);                       // flag: usuário editou algo

  const [token, setToken] = useState(() => {
    try {
      const cred = sessionStorage.getItem("kist_token");
      if (!cred) return null;
      const p = decodeJwtPayload(cred);
      if (p.exp * 1000 < Date.now()) { sessionStorage.removeItem("kist_token"); return null; }
      // Defesa em profundidade: token de e-mail não autorizado não restaura sessão.
      if (!emailAutorizado(p.email)) {
        sessionStorage.removeItem("kist_token"); sessionStorage.removeItem("kist_user"); return null;
      }
      return cred;
    } catch { return null; }
  });
  const [usuario, setUsuario] = useState(() => {
    try {
      const u = sessionStorage.getItem("kist_user");
      if (!u) return null;
      const parsed = JSON.parse(u);
      if (!emailAutorizado(parsed?.email)) { sessionStorage.removeItem("kist_user"); return null; }
      return parsed;
    } catch { return null; }
  });
  const [authErro, setAuthErro] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const [pagina, setPagina] = useState("nova"); // nova | propostas | ordens
  const [alertasChamados, setAlertasChamados] = useState(0);
  const [bannerDispensado, setBannerDispensado] = useState(false);
  const [novaOCPayload, setNovaOCPayload] = useState(null);
  const [step, setStep] = useState("input");
  const [loading, setLoading] = useState(false);
  const [salvandoBanco, setSalvandoBanco] = useState(false);
  const [erro, setErro] = useState("");
  // Avisos do backend quando a BUSCA FALHOU (≠ produto ausente no banco).
  // Cada um traz o número do chamado que o sistema abriu sozinho.
  const [avisosSistema, setAvisosSistema] = useState([]);
  // "Não importar preços sem rastreabilidade": ON pro Fábio por padrão, OFF pros demais.
  // Ele pode desmarcar. Diferente do antigo checkbox de preservar descrição (que criava
  // duas verdades no mesmo dado), este não muda o que o sistema SABE — só o que ele
  // preenche sozinho. A ficha continua mostrando o match pros dois.
  const [soRastreavel, setSoRastreavel] = useState(false);
  const soRastreavelInitRef = useRef(false);
  // Itens que vão pro banco sem lastro. Não bloqueia — mostra quais são e deixa
  // resolver ali. Aviso genérico vira reflexo de clicar em "ignorar" numa semana;
  // lista específica com o item na frente é preenchida, porque preencher fica mais
  // barato que dispensar.
  const [semLastro, setSemLastro] = useState(null);
  const [texto, setTexto] = useState("");
  const [arquivos, setArquivos] = useState([]);   // múltiplos arquivos (email + Excel + PDF)
  const [imagens, setImagens] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [numeroProposta, setNumeroProposta] = useState("");
  const [propostas, setPropostas] = useState([]);   // array de propostas extraídas
  const [propostaIdx, setPropostaIdx] = useState(0);
  const [downloadados, setDownloadados] = useState(new Set());
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
    fetch(`${API}/proxima-proposta`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then((d) => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
    const ka = setInterval(() => fetch(`${API}/ping`).catch(() => {}), 9 * 60 * 1000);
    return () => clearInterval(ka);
  }, [token]);

  // Alertas de chamados resolvidos (badge + banner): conta os PRÓPRIOS com avisar_operador.
  const carregarAlertas = useCallback(() => {
    if (!token || !usuario?.email) return;
    const email = usuario.email.toLowerCase();
    fetch(`${API}/chamados`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const n = (d.chamados || []).filter(
          (c) => c.avisar_operador && (c.operador_email || "").toLowerCase() === email
        ).length;
        setAlertasChamados(n);
      })
      .catch(() => {});
  }, [token, usuario]);

  useEffect(() => {
    carregarAlertas();
    // Recarrega quando o operador volta pra aba (pega chamados resolvidos enquanto estava fora).
    const onVisible = () => { if (document.visibilityState === "visible") carregarAlertas(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [carregarAlertas]);

  useEffect(() => {
    if (usuario?.email && !soRastreavelInitRef.current) {
      soRastreavelInitRef.current = true;
      setSoRastreavel(usuario.email.toLowerCase() === "fabiokist@gmail.com");
    }
  }, [usuario]);

  // O default por operador do "preservar 100% descrição do cliente" saiu na v3.17
  // junto com o checkbox: a descrição do cliente agora é SEMPRE preservada, e o que
  // o banco propõe aparece na ficha ao lado, pro operador comparar e decidir.
  // Duas verdades diferentes por operador era o próprio problema.

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
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [usuario]);

  function handleGoogleResponse(response) {
    const credential = response.credential;
    const payload = decodeJwtPayload(credential);
    // ── Trava de acesso: só e-mails autorizados entram ──────────────────────
    if (!emailAutorizado(payload.email)) {
      try { if (window.google) window.google.accounts.id.disableAutoSelect(); } catch (e) {}
      try { sessionStorage.removeItem("kist_token"); sessionStorage.removeItem("kist_user"); } catch (e) {}
      setToken(null); setUsuario(null);
      setAuthErro(`Acesso negado para ${payload.email || "esta conta"}. Este sistema é restrito à equipe Kist.`);
      return;
    }
    setAuthErro("");
    const user = { nome: payload.name, email: payload.email, foto: payload.picture };
    setToken(credential);
    setUsuario(user);
    // Persistir na aba atual — sobrevive a refresh/deploy do Render
    try {
      sessionStorage.setItem("kist_token", credential);
      sessionStorage.setItem("kist_user", JSON.stringify(user));
    } catch (e) {}
    // Renovar token ~5min antes de expirar (sem interação do usuário)
    const renovarEm = payload.exp * 1000 - Date.now() - 5 * 60 * 1000;
    if (renovarEm > 0) {
      setTimeout(() => {
        if (window.google) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID, callback: handleGoogleResponse,
            ux_mode: "popup", auto_select: true,
          });
          window.google.accounts.id.prompt(() => {});
        }
      }, renovarEm);
    }
  }

  function renderBotaoGoogle(el) {
    if (!el || !window.google || !GOOGLE_CLIENT_ID) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID, callback: handleGoogleResponse,
      ux_mode: "popup", auto_select: true,
    });
    // Tentativa de reconexão silenciosa (funciona se o usuário ainda está logado no Google)
    window.google.accounts.id.prompt(() => {});
    window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with", locale: "pt-BR", width: 280 });
  }

  function logout() {
    try { sessionStorage.removeItem("kist_token"); sessionStorage.removeItem("kist_user"); } catch (e) {}
    // Cancelar auto_select para não logar de volta imediatamente após logout explícito
    try { if (window.google) window.google.accounts.id.disableAutoSelect(); } catch (e) {}
    setUsuario(null); setToken(null); setStep("input"); setResultado(null);
    setTexto(""); setArquivos([]); setImagens([]); setNumeroProposta(""); setErro("");
    setPropostas([]); setPropostaIdx(0); setDownloadados(new Set());
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
      const outros = files.filter((f) => !f.type.startsWith("image/"));
      if (imgs.length > 0) setImagens((prev) => [...prev, ...imgs].slice(0, 6));
      if (outros.length > 0) setArquivos((prev) => {
        const nomes = new Set(prev.map((x) => x.name));
        return [...prev, ...outros.filter((f) => !nomes.has(f.name))];
      });
      if (imgs.length > 0 || outros.length > 0) return;
    }
    const plain = e.dataTransfer.getData("text/plain");
    const html = e.dataTransfer.getData("text/html");
    if (plain?.trim()) setTexto(plain.trim());
    else if (html) {
      const tmp = document.createElement("div"); tmp.innerHTML = html;
      const txt = tmp.innerText || tmp.textContent || "";
      if (txt.trim()) setTexto(txt.trim());
    }
  }, []);

  function handleArquivos(e) {
    const files = Array.from(e.target.files || []);
    setArquivos((prev) => {
      const nomes = new Set(prev.map((x) => x.name));
      return [...prev, ...files.filter((f) => !nomes.has(f.name))];
    });
  }

  async function processar() {
    if (!numeroProposta.trim()) { setErro("Informe o número da proposta."); return; }
    if (!texto.trim() && arquivos.length === 0 && imagens.length === 0) {
      setErro("Arraste arquivos, cole o texto ou adicione prints."); return;
    }
    setErro(""); setLoading(true);
    try {
      const form = new FormData();
      form.append("numero_proposta", numeroProposta);
      form.append("so_rastreavel", soRastreavel ? "1" : "0");
      arquivos.forEach((f) => form.append("arquivos", f));
      if (texto) form.append("texto", texto);
      imagens.forEach((img) => form.append("imagens", img));

      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 120000);
      let res;
      try {
        res = await fetch(`${API}/extrair`, { method: "POST", headers: authHeaders(), body: form, signal: controller.signal });
      } catch (fe) {
        clearTimeout(tid);
        if (fe.name === "AbortError") throw new Error("Tempo limite (120s). Tente com menos arquivos.");
        throw fe;
      }
      clearTimeout(tid);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `Erro HTTP ${res.status}` }));
        if (res.status === 401 || res.status === 403) { setErro("Sessão expirada. Faça login novamente."); logout(); return; }
        throw new Error(err.detail || "Erro no servidor");
      }
      const data = await res.json();
      // Falha do sistema != produto ausente no banco. Sem isto, o operador
      // precifica 20 itens na mão achando que o banco está pobre.
      setAvisosSistema(Array.isArray(data.avisos) ? data.avisos : []);
      // Normalizar: backend sempre retorna {propostas:[...]}, mas suportar legado {itens:[...]}
      const props = data.propostas || [data];
      setPropostas(props); setPropostaIdx(0); setDownloadados(new Set());
      modificadoRef.current = true;   // marca como modificado para o save funcionar
      setStep("resultado");
      // Reservar o número no banco imediatamente — impede outro operador de receber o mesmo número
      setTimeout(() => salvarRascunho(true), 100);
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); }
  }

  function atualizarItem(index, campo, valor) {
    setPropostas((prev) => prev.map((p, pi) =>
      pi !== propostaIdx ? p : { ...p, itens: p.itens.map((item, i) => i === index ? { ...item, [campo]: valor, _alterado: true } : item) }
    ));
    _dispararAutoSave();
  }

  // Excluir item da proposta (ex.: itens que a Kist não vende — postes). Remove a
  // linha e reindexa; o CSV/total recalculam sozinhos. Salva no rascunho.
  function removerItem(index) {
    setPropostas((prev) => prev.map((p, pi) =>
      pi !== propostaIdx ? p : { ...p, itens: (p.itens || []).filter((_, i) => i !== index) }
    ));
    _dispararAutoSave();
  }

  function _dispararAutoSave() {
    modificadoRef.current = true;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => salvarRascunho(true), 1500);
  }

  async function salvarRascunho(silent = false) {
    if (!modificadoRef.current) return;
    const prop = propostas[propostaIdx];
    if (!prop || !numeroProposta) return;
    if (!silent) setSalvando(true);
    else setSalvando(true);
    try {
      const payload = {
        ...prop,
        proposta: prop.proposta || numeroProposta,
        status: "rascunho",
        usuario_nome: usuario?.nome || "",
      };
      // REGRA: rascunho NÃO alimenta o banco de preços.
      // O banco só recebe preço de proposta que virou CSV (baixarCSV) — aí o preço
      // é real, foi pro cliente, e vale como referência. Preço em rascunho é palpite
      // em andamento.
      // Isto aqui chamava /upsert-precos a cada tick do auto-save (1,5s por edição):
      // 15 a 21 linhas gravadas por proposta, 1.493 linhas-lixo em 3 dias.
      // Upsert proposta (rascunho) — este sim, a cada auto-save, sobrescrevendo
      const r = await fetch(`${API}/salvar-proposta`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (d.proposta_id && !propostaId) setPropostaId(d.proposta_id);
      setUltimoSalvo(new Date());
      modificadoRef.current = false;
    } catch (e) { /* auto-save silencioso */ }
    finally { setSalvando(false); }
  }

  async function abrirPropostaExistente(id) {
    setLoading(true); setErro("");
    try {
      const r = await fetch(`${API}/propostas/${id}/detalhe`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Não encontrado");
      const data = await r.json();
      const prop = data.proposta;
      const itens = (data.itens || []).map(it => ({
        descricao_original:   it.descricao_original || "",
        descricao_final:      it.descricao_final || "",
        specs_complementares: it.specs_complementares || "",
        quantidade:           Number(it.quantidade) || 1,
        unidade:              it.unidade || "UN",
        preco_un:             Number(it.preco_venda) || 0,
        preco_custo:          Number(it.preco_custo) || 0,
        frete_vinda:          Number(it.frete_vinda) || 0,
        confianca_match:      it.confianca_match || "nenhuma",
        obs:                  it.obs_interna || "",
        fornecedor:           it.fornecedor || null,
        fornecedor_canal:     it.fornecedor_canal || "",
        fornecedor_contato:   it.fornecedor_contato || "",
        link_fornecedor:      it.link_fornecedor || null,
        sku_fornecedor:       it.sku_fornecedor || null,
        tem_preco:            Number(it.preco_venda) > 0,
        sugerir_pn:           false,
        alerta_produto:       null,
      }));
      setNumeroProposta(prop.numero_proposta || "");
      setPropostas([{
        titulo:        prop.numero_proposta || "",
        cliente:       prop.cliente || "",
        cnpj:          prop.cnpj || null,
        rc_neg:        prop.rc_neg || null,
        proposta:      prop.numero_proposta || "",
        frete:         prop.frete_recebimento || 0,
        prazo_entrega: prop.prazo_entrega || "",
        status:        prop.status || "rascunho",
        itens,
      }]);
      setPropostaId(id);
      setPropostaIdx(0);
      setDownloadados(new Set());
      modificadoRef.current = false;
      setStep("resultado");
      setPagina("nova");
    } catch (e) {
      setErro("Erro ao carregar proposta: " + e.message);
    } finally { setLoading(false); }
  }

  // Um item vai pro banco quando tem preço. Se for sem custo e sem origem, ele vira
  // uma linha que daqui a meses aparece num match que ninguém consegue conferir.
  function itensSemLastro(prop) {
    // Mesmo critério do backend (_rastreavel): rastrear é saber QUEM e COMO.
    // Nome sem contato não é rastro — é lembrança.
    return (prop.itens || [])
      .map((it, i) => ({ ...it, _i: i }))
      .filter((it) => {
        if (!(it.preco_un > 0)) return false;
        const link = (it.link_fornecedor || "").trim();
        const nome = (it.fornecedor || "").trim();
        const cont = (it.fornecedor_contato || "").trim();
        const temOrigem = !!(link || (nome && cont));
        return !(temOrigem && it.preco_custo > 0);
      });
  }

  async function baixarCSV(idx = propostaIdx, ignorarLastro = false) {
    const prop = propostas[idx];
    if (!prop) return;
    if (!ignorarLastro) {
      const faltando = itensSemLastro(prop);
      if (faltando.length > 0) { setSemLastro({ idx, itens: faltando }); return; }
    }
    setSemLastro(null);
    setLoading(true); setSalvandoBanco(true); setBancoInfo(null);
    try {
      const payload = { ...prop, usuario_nome: usuario.nome };
      const itensCom = (prop.itens || []).filter((i) => i.preco_un > 0);
      if (itensCom.length > 0) {
        try {
          const resBanco = await fetch(`${API}/upsert-precos`, {
            method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(prop),
          });
          if (resBanco.ok) setBancoInfo(await resBanco.json());
        } catch (e) { console.warn("Aviso banco:", e); }
      }
      try {
        await fetch(`${API}/salvar-proposta`, {
          method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ ...payload, status: "confirmada" }),
        });
        modificadoRef.current = false;
        setUltimoSalvo(new Date());
      } catch (e) { console.warn("Aviso salvar proposta:", e); }
      setSalvandoBanco(false);
      const res = await fetch(`${API}/gerar-csv`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(prop),
      });
      if (!res.ok) throw new Error("Erro ao gerar CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `proposta_${prop.proposta}.csv`; a.click();
      URL.revokeObjectURL(url);
      // Marcar proposta como baixada; só avança para download quando todas forem baixadas
      setDownloadados((prev) => {
        const next = new Set(prev); next.add(idx);
        if (next.size >= propostas.length) setStep("download");
        return next;
      });
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); setSalvandoBanco(false); }
  }

  function reiniciar() {
    setAvisosSistema([]);
    setStep("input"); setPropostas([]); setPropostaIdx(0); setDownloadados(new Set()); setBancoInfo(null);
    setTexto(""); setArquivos([]); setImagens([]); setNumeroProposta(""); setErro("");
    setPropostaId(null); setSalvando(false); setUltimoSalvo(null);
    modificadoRef.current = false;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    fetch(`${API}/proxima-proposta`, { headers: authHeaders() }).then((r) => r.json())
      .then((d) => { if (d.proximo) setNumeroProposta(d.proximo); }).catch(() => {});
  }

  function navegar(k) {
    if (k === "docs") { setShowDocs(true); return; }
    setShowDocs(false); setPagina(k);
  }
  const activeNav = showDocs ? "docs" : pagina;
  // Admin dos chamados = só o Leonardo (mesmo default do backend ADMIN_EMAILS).
  const isAdmin = (usuario?.email || "").toLowerCase() === "leonardobarrey@gmail.com";

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
          {authErro && (
            <div className="mb-4 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-left text-[12.5px] leading-snug text-rose">
              {authErro}
            </div>
          )}
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
      <Sidebar active={activeNav} onNavigate={navegar} usuario={usuario} stats={stats} onLogout={logout} isAdmin={isAdmin} alertas={alertasChamados} />

      <main className="flex-1 overflow-auto">
        {alertasChamados > 0 && !bannerDispensado && pagina !== "requisicoes" && !showDocs && (
          <div className="flex items-center gap-3 border-b border-signal/20 bg-signalbg px-8 py-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-signal text-white">
              <IconCheck size={13} />
            </span>
            <span className="text-[13px] text-ink">
              {alertasChamados === 1
                ? "1 chamado seu foi resolvido e está no ar."
                : `${alertasChamados} chamados seus foram resolvidos e estão no ar.`}
            </span>
            <button onClick={() => navegar("requisicoes")}
              className="rounded-md bg-signal/10 px-2.5 py-1 text-[12.5px] font-medium text-signal transition-colors hover:bg-signal/20">
              Ver
            </button>
            <button onClick={() => setBannerDispensado(true)} title="Dispensar"
              className="ml-auto rounded-md p-1 text-faint transition-colors hover:bg-white/60 hover:text-ink">
              <IconX size={15} />
            </button>
          </div>
        )}
        {showDocs ? (
          <div className="mx-auto max-w-5xl px-8 py-9"><Docs /></div>
        ) : pagina === "propostas" ? (
          <Propostas token={token} usuario={usuario} onAbrirProposta={abrirPropostaExistente}
            onCriarOC={(proposta, itens, po) => { setNovaOCPayload({ proposta, itens, po }); setPagina("ordens"); }} />
        ) : pagina === "ordens" ? (
          <OrdensCompra token={token} usuario={usuario}
            novaOC={novaOCPayload}
            onNovaOCProcessada={() => setNovaOCPayload(null)} />
        ) : pagina === "requisicoes" ? (
          <Analista token={token} usuario={usuario} onAlertasChange={carregarAlertas} />
        ) : pagina === "chamados" && isAdmin ? (
          <ChamadosAdmin token={token} usuario={usuario} />
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
                    <label className="mb-1.5 block text-[12.5px] font-medium text-ink">
                      Arquivos e prints da cotação
                      <span className="ml-2 text-[11px] font-normal text-faint">e-mail · Excel · PDF · imagens — pode combinar</span>
                    </label>
                    {/* Zona de drop — aceita múltiplos arquivos de qualquer tipo */}
                    <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                      onClick={() => arquivos.length === 0 && imagens.length === 0 && fileRef.current.click()}
                      className={`cursor-pointer rounded-xl border-2 border-dashed transition-all
                        ${isDragging ? "border-kist bg-kist/[0.04]"
                          : (arquivos.length > 0 || imagens.length > 0) ? "border-kist/40 bg-kist/[0.03]"
                          : "border-line2 bg-paper hover:border-faint"}`}>
                      {(arquivos.length > 0 || imagens.length > 0) ? (
                        <div className="p-3 space-y-1.5">
                          {/* Arquivos (email, excel, pdf) */}
                          {arquivos.map((f, i) => (
                            <div key={i} className="flex items-center gap-2.5 rounded-lg bg-paper px-3 py-2">
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-kist/10 text-kist"><IconUpload size={14} /></div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12.5px] font-medium text-ink">{f.name}</div>
                                <div className="font-mono text-[10.5px] text-faint">{(f.size / 1024).toFixed(0)} KB</div>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); setArquivos((prev) => prev.filter((_, j) => j !== i)); }}
                                className="flex-shrink-0 text-faint hover:text-rose"><IconX size={14} /></button>
                            </div>
                          ))}
                          {/* Imagens (prints) */}
                          {imagens.length > 0 && (
                            <div className="flex flex-wrap gap-2 px-1 pt-1">
                              {imagens.map((img, i) => (
                                <div key={i} className="group/img relative">
                                  <img src={URL.createObjectURL(img)} alt="" className="h-14 w-14 rounded-lg border border-line object-cover" />
                                  <button onClick={(e) => { e.stopPropagation(); setImagens((prev) => prev.filter((_, j) => j !== i)); }}
                                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-rose text-[10px] text-white group-hover/img:flex">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Ações */}
                          <div className="flex items-center gap-3 px-1 pb-1">
                            <button onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }}
                              className="text-[11.5px] text-kist hover:underline">+ Adicionar mais</button>
                            <button onClick={(e) => { e.stopPropagation(); setArquivos([]); setImagens([]); }}
                              className="text-[11px] text-faint hover:text-rose">limpar tudo</button>
                          </div>
                        </div>
                      ) : (
                        <div className="px-6 py-10 text-center">
                          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-kist/10 text-kist"><IconUpload size={20} /></div>
                          <div className="text-[13.5px] font-medium text-ink">{isDragging ? "Solte aqui" : "Arraste os arquivos"}</div>
                          <div className="mt-1 text-[12px] text-sub">
                            Pode combinar: .msg + Excel + PDF + prints
                          </div>
                          <div className="mt-1 text-[11.5px] text-faint">
                            Cole prints com <kbd className="rounded border border-line2 bg-surface px-1 py-0.5 font-mono text-[10px]">Ctrl+V</kbd>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }} className={`${btnGhost} mt-3`}>Procurar arquivos</button>
                        </div>
                      )}
                    </div>
                    <input ref={fileRef} type="file" multiple accept=".msg,.eml,.xlsx,.xls,.xlsm,.pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleArquivos} />
                  </div>

                  <div className="relative py-1 text-center">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
                    <span className="relative bg-surface px-3 text-[11px] eyebrow uppercase text-faint">ou cole o texto</span>
                  </div>

                  <textarea rows={5}
                    className="w-full resize-none rounded-lg border border-line2 bg-paper px-3 py-2.5 font-mono text-[12.5px] text-ink cell-input"
                    placeholder="Cole aqui o conteúdo do e-mail de cotação…" value={texto}
                    onChange={(e) => setTexto(e.target.value)} />

                  {erro && <div className="rounded-lg border border-rose/30 bg-rosebg px-4 py-3 text-[13px] text-rose">{erro}</div>}

                  <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-sub">
                    <input type="checkbox" checked={soRastreavel}
                      onChange={(e) => setSoRastreavel(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-line2 text-kist focus:ring-kist" />
                    <span>
                      Não importar preços sem rastreabilidade
                      <span className="ml-1 text-[11px] text-faint">
                        — o match aparece, mas o preço só entra se o produto tiver origem, custo e venda
                      </span>
                    </span>
                  </label>

                  <button onClick={processar} disabled={loading} className={`${btnPrimary} w-full justify-center py-2.5`}>
                    {loading
                      ? <><span className="inline-block animate-spin"><IconBolt size={15} /></span> Extraindo e cruzando com o banco…</>
                      : <>Processar e-mail <IconArrow size={15} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* RESULTADO */}
            {step === "resultado" && propostas.length > 0 && (() => {
              const prop = propostas[propostaIdx] || {};
              const jaBaixado = downloadados.has(propostaIdx);
              return (
              <div className="rise">
                <PageHeader eyebrow={`Etapa 2 de 3 · Revisão${propostas.length > 1 ? ` — ${propostas.length} propostas` : ""}`}
                  title={propostas.length > 1 ? "Propostas geradas" : `Proposta ${prop.proposta}`}
                  sub={propostas.length === 1 ? <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{prop.cliente}</span>
                    {prop.cnpj && <span className="font-mono text-[12px] text-faint">{prop.cnpj}</span>}
                    {prop.rc_neg && <span className="rounded-md bg-paper px-2 py-0.5 font-mono text-[11px] text-sub">{prop.rc_neg}</span>}
                  </span> : null}
                  actions={<>
                    <button onClick={reiniciar} className={btnGhost}>Recomeçar</button>
                    {/* Indicador de auto-save */}
                    {salvando && <span className="text-[11.5px] text-faint animate-pulse">Salvando…</span>}
                    {!salvando && ultimoSalvo && <span className="text-[11.5px] text-faint">✓ Salvo {ultimoSalvo.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>}
                    <button onClick={() => salvarRascunho(false)} disabled={salvando}
                      className={`${btnGhost} ${salvando ? "opacity-50" : ""}`}
                      title="Salvar como rascunho para continuar depois">
                      Salvar rascunho
                    </button>
                    <button onClick={() => baixarCSV(propostaIdx)} disabled={loading || salvandoBanco || jaBaixado} className={btnPrimary}>
                      {salvandoBanco
                        ? <><span className="inline-block animate-spin"><IconBolt size={15} /></span> Salvando…</>
                        : jaBaixado ? <><IconCheck size={15} /> CSV baixado</>
                        : loading ? "Gerando…"
                        : <><IconDownload size={15} /> Confirmar e baixar CSV{propostas.length > 1 ? ` — Proposta ${propostaIdx + 1}` : ""}</>}
                    </button>
                  </>} />

                {/* ── RASTREABILIDADE ANTES DO TINY ───────────────────────────────────
          Estes itens vão virar linha no banco de preços. Sem custo e sem origem,
          daqui a meses eles reaparecem num match que ninguém consegue conferir —
          e aí o operador recota às cegas ou o item volta em RMA.
          Não bloqueia: lista, deixa preencher ali, e segue se ele quiser. */}
      {semLastro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
          onClick={() => setSemLastro(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line2 bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold text-ink">
                  {semLastro.itens.length} {semLastro.itens.length === 1 ? "item vai" : "itens vão"} pro banco sem lastro
                </div>
                <div className="mt-1 text-[12.5px] leading-relaxed text-sub">
                  Sem custo e sem origem, esse preço reaparece daqui a meses num match que
                  ninguém consegue conferir. Preencher agora custa menos que recotar depois.
                </div>
              </div>
              <button onClick={() => setSemLastro(null)} className="rounded p-1 text-faint hover:text-ink">
                <IconX size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {semLastro.itens.map((it) => (
                <div key={it._i} className="rounded-lg border border-line2 bg-paper p-2.5">
                  <div className="text-[12.5px] leading-snug text-ink">{it.descricao_final}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-md border border-line2 bg-surface px-2 py-1">
                      <span className="text-[11px] text-faint">Custo R$</span>
                      <PrecoInput
                        className="w-24 bg-transparent text-right font-mono text-[12px] text-ink outline-none"
                        placeholder="—"
                        value={propostas[semLastro.idx]?.itens?.[it._i]?.preco_custo}
                        onCommit={(v) => atualizarItem(it._i, "preco_custo", v)} />
                    </div>
                    <div className="flex items-center gap-1.5 rounded-md border border-line2 bg-surface px-2 py-1">
                      <span className="eyebrow text-[9px] font-bold uppercase text-faint">Quem</span>
                      <input placeholder="DigitalSAT"
                        className="w-28 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
                        value={propostas[semLastro.idx]?.itens?.[it._i]?.fornecedor || ""}
                        onChange={(e) => atualizarItem(it._i, "fornecedor", e.target.value)} />
                    </div>
                    <select
                      className="cursor-pointer rounded-md border border-line2 bg-surface px-2 py-1 text-[12px] text-ink outline-none"
                      value={propostas[semLastro.idx]?.itens?.[it._i]?.fornecedor_canal || ""}
                      onChange={(e) => atualizarItem(it._i, "fornecedor_canal", e.target.value)}>
                      <option value="">por onde…</option>
                      <option value="link">link</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">e-mail</option>
                      <option value="telefone">telefone</option>
                      <option value="loja">loja</option>
                      <option value="outro">outro</option>
                    </select>
                    <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-md border border-line2 bg-surface px-2 py-1">
                      <span className="eyebrow text-[9px] font-bold uppercase text-faint">Contato</span>
                      <input
                        placeholder={CONTATO_PH[propostas[semLastro.idx]?.itens?.[it._i]?.fornecedor_canal] || "como se chega nele"}
                        className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
                        value={propostas[semLastro.idx]?.itens?.[it._i]?.fornecedor_contato || ""}
                        onChange={(e) => atualizarItem(it._i, "fornecedor_contato", e.target.value)}
                        onBlur={(e) => {
                          const cur = propostas[semLastro.idx]?.itens?.[it._i] || {};
                          const r = lerContato(e.target.value);
                          if (!r) return;
                          if (r.contato && r.contato !== e.target.value.trim())
                            atualizarItem(it._i, "fornecedor_contato", r.contato);
                          if (r.canal && !cur.fornecedor_canal) atualizarItem(it._i, "fornecedor_canal", r.canal);
                          if (r.quem && !(cur.fornecedor || "").trim()) atualizarItem(it._i, "fornecedor", r.quem);
                          if (r.canal === "link" && !(cur.link_fornecedor || "").trim())
                            atualizarItem(it._i, "link_fornecedor", r.contato);
                        }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
              <button onClick={() => baixarCSV(semLastro.idx, true)} className={btnGhost}>
                Gerar assim mesmo
              </button>
              <button
                onClick={() => {
                  const restam = itensSemLastro(propostas[semLastro.idx]);
                  if (restam.length === 0) baixarCSV(semLastro.idx, true);
                  else setSemLastro({ idx: semLastro.idx, itens: restam });
                }}
                className={btnPrimary}>
                Pronto, gerar CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Falha do sistema != produto ausente no banco.
                    Sem este aviso, os dois casos chegam idênticos na tela: itens
                    sem preço. O operador precificaria na mão itens que o banco
                    já tinha, sem nunca saber que o backend falhou. */}
                {avisosSistema.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {avisosSistema.map((av, i) => (
                      <div key={i} className="rounded-xl border border-rose/40 bg-rosebg px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-rose text-[10px] font-bold text-white">!</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold text-rose">Falha do sistema — não é ausência no banco</div>
                            <div className="mt-0.5 text-[12.5px] leading-relaxed text-sub">{av.mensagem}</div>
                            {av.chamado ? (
                              <div className="mt-1.5 text-[12px] text-sub">
                                Registrei o chamado{" "}
                                <span className="font-mono font-semibold text-ink">#{String(av.chamado).padStart(4, "0")}</span>
                                {" "}e o Leonardo foi avisado. Você acompanha em <span className="font-medium">Requisições → Meus chamados</span>.
                              </div>
                            ) : (
                              <div className="mt-1.5 text-[12px] text-sub">Não consegui nem registrar o chamado — avise o Leonardo direto.</div>
                            )}
                            {av.detalhe && (
                              <details className="mt-1.5">
                                <summary className="cursor-pointer text-[11px] text-faint hover:text-sub">detalhe técnico</summary>
                                <div className="mt-1 whitespace-pre-wrap break-words rounded bg-surface/60 px-2 py-1 font-mono text-[10.5px] text-faint">{av.detalhe}</div>
                              </details>
                            )}
                          </div>
                          <button onClick={() => setAvisosSistema((p) => p.filter((_, j) => j !== i))}
                            title="Dispensar" className="rounded p-0.5 text-rose/60 hover:bg-white/40 hover:text-rose">
                            <IconX size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tabs de proposta — visíveis só quando há múltiplas */}
                {propostas.length > 1 && (
                  <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
                    {propostas.map((p, i) => (
                      <button key={i} onClick={() => setPropostaIdx(i)}
                        className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors
                          ${i === propostaIdx ? "bg-kist text-white" : "text-sub hover:bg-paper"}`}>
                        <span className="truncate">{p.titulo || `Proposta ${i + 1}`}</span>
                        <span className="flex-shrink-0 text-[10px] opacity-70">{(p.itens || []).length} itens</span>
                        {downloadados.has(i) && <span className="flex-shrink-0 text-[10px]">✓</span>}
                      </button>
                    ))}
                  </div>
                )}

                {/* Cabeçalho da proposta ativa quando há múltiplas */}
                {propostas.length > 1 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-semibold text-ink">Proposta {prop.proposta}</span>
                    {prop.cliente && <span className="text-sub">{prop.cliente}</span>}
                    {prop.cnpj && <span className="font-mono text-faint">{prop.cnpj}</span>}
                    {prop.rc_neg && <span className="rounded bg-paper px-2 py-0.5 font-mono text-[11px] text-sub">{prop.rc_neg}</span>}
                  </div>
                )}

                <div className="mt-4"><CertaintyStrip itens={prop.itens || []} /></div>

                {/* Dados da proposta para o Tiny — preenchidos aqui, exportados no CSV */}
                <div className="mt-4 rounded-xl border border-line bg-surface p-4">
                  <div className="eyebrow text-[10px] font-bold uppercase text-faint">Dados da proposta (Tiny)</div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="block col-span-2">
                      <div className="text-[11.5px] text-sub">
                        CNPJ do cliente
                        {!(prop.cnpj || "").trim() && (
                          <span className="ml-1.5 text-amber">— não identificado, preencha</span>
                        )}
                      </div>
                      <input value={prop.cnpj || ""}
                        onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, cnpj: e.target.value } : p)); _dispararAutoSave(); }}
                        placeholder="00.000.000/0000-00"
                        className={`mt-1 w-full rounded-lg border bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist
                          ${!(prop.cnpj || "").trim() ? "border-amber/50" : "border-line2"}`} />
                    </label>
                    <label className="block">
                      <div className="text-[11.5px] text-sub">Prazo de entrega</div>
                      <input value={prop.prazo_entrega || ""}
                        onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, prazo_entrega: e.target.value } : p)); _dispararAutoSave(); }}
                        placeholder="ex: 15 dias úteis"
                        className="mt-1 w-full rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />
                    </label>
                    <label className="block">
                      <div className="text-[11.5px] text-sub">Frete (R$)</div>
                      <input inputMode="decimal" value={prop.frete ?? ""}
                        onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, frete: e.target.value } : p)); _dispararAutoSave(); }}
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
                      {(prop.itens || []).map((item, i) => (
                        <ItemRow key={i} item={item} index={i} onChange={atualizarItem} onRemove={removerItem} token={token} apiUrl={API} fonteTexto={prop.fonte_texto} cnpj={prop.cnpj} />
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-line bg-paper/50 px-4 py-3">
                    <span className="text-[12px] text-faint">Clique em qualquer campo para editar · preços salvos no banco ao confirmar</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] uppercase eyebrow text-faint">Total estimado</span>
                      <span className="font-mono text-[16px] font-semibold text-ink">
                        R$ {brl((prop.itens || []).reduce((s, i) => s + (i.preco_un || 0) * (parseFloat(i.quantidade) || 0), 0))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Custo & lucro — uso INTERNO, não vai para o CSV do Tiny */}
                {(() => {
                  const num = (v) => { let s = String(v ?? "").trim(); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); return parseFloat(s) || 0; };
                  const prodVenda = (prop.itens || []).reduce((s, i) => s + (i.preco_un || 0) * (parseFloat(i.quantidade) || 0), 0);
                  const prodCusto = (prop.itens || []).reduce((s, i) => s + (i.preco_custo || 0) * (parseFloat(i.quantidade) || 0), 0);
                  const custoFreteItens = (prop.itens || []).reduce((s, i) => s + num(i.frete_vinda), 0); // frete único por item, SEM ×qtd
                  const freteCobr = num(prop.frete);
                  const receitaBruta = prodVenda + freteCobr;
                  const nf12 = receitaBruta * 0.12;
                  const lucro = receitaBruta - nf12 - prodCusto - custoFreteItens;
                  const margem = receitaBruta > 0 ? (lucro / receitaBruta) * 100 : 0;
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
                        <div className="flex justify-between" style={{color:"#A82F2F"}}><span>− NF 12%</span><span className="font-mono">R$ {brl(nf12)}</span></div>
                        <div className="flex justify-between text-sub"><span>− Custo (produtos)</span><span className="font-mono">R$ {brl(prodCusto)}</span></div>
                        {custoFreteItens > 0 && <div className="flex justify-between text-sub"><span>− Frete (custo)</span><span className="font-mono">R$ {brl(custoFreteItens)}</span></div>}
                        <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
                          <span className="font-medium text-ink">Lucro líquido (s/ NF)</span>
                          <span className={`font-mono text-[16px] font-semibold ${lucro >= 0 ? "text-signal" : "text-rose"}`}>R$ {brl(lucro)}</span>
                        </div>
                        <div className="text-right text-[10.5px] text-faint">{temCusto ? `${margem.toFixed(0)}% margem` : "informe os custos dos itens"} (margem líquida s/ NF)</div>
                      </div>
                      <div className="mt-2 text-[10.5px] text-faint">O frete de custo de cada item entra no campo “Frete (item)”, junto da origem do preço.</div>
                    </div>
                  );
                })()}
              </div>
              );
            })()}
            {step === "download" && (
              <div className="mx-auto max-w-md py-16 text-center rise">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-signalbg text-signal"><IconCheck size={26} /></div>
                <h2 className="text-[22px] font-semibold tracking-tight text-ink">CSV pronto</h2>
                <p className="mx-auto mt-2 max-w-xs text-[13.5px] text-sub">
                  {propostas.length > 1 ? `${propostas.length} CSVs baixados e prontos para importar no Tiny.` : <>O arquivo <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px] text-ink">proposta_{propostas[0]?.proposta}.csv</code> foi baixado e está pronto para importar no Tiny.</>}
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
