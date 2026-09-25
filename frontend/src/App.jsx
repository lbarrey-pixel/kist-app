import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Docs from "./Docs.jsx";
import Propostas from "./Propostas.jsx";
import OrdensCompra from "./OrdensCompra.jsx";
import Analista from "./Analista.jsx";
import ChamadosAdmin from "./ChamadosAdmin.jsx";
import Agentes from "./Agentes.jsx";
import Suporte from "./Suporte.jsx";
import VersaoBadge from "./Versao.jsx";
import Catalogo, { ConhecimentoSelo, ExtratoModal, ExtratosPropostaModal } from "./Catalogo.jsx";
import { DatasheetBotao, DatasheetLote, DatasheetBaixarTodos } from "./Datasheet.jsx";
import {
  CONF, brl, btnPrimary, btnGhost, btnTool, btnToolKist, Eyebrow, StateLabel, PageHeader,
  CertaintyStrip, Sidebar,
  IconUpload, IconBolt, IconArrow, IconDownload, IconCheck, IconLink, IconX,
  IconGoogle, IconBell, IconSearch, lerContato } from "./kist-ui.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Extração assíncrona (v3.68) ─────────────────────────────────────────────
// HISTÓRICO (17/09): cotação de 41 itens levava 160-215s na extração + matching,
// e QUALQUER teto fixo de espera (120s, depois 240s) ia estourar de novo na
// próxima cotação maior. Agora POST /extrair volta na hora com um job_id, e a
// tela consulta GET /extrair-status/{job_id} de poucos em poucos segundos até
// sair de "processando" — sem prazo fixo, porque cada consulta é rápida e
// barata (leitura de banco, sem IA), não importa quanto o trabalho leve.
async function _extrairAssincrono(form, authHeaders, onProgresso) {
  const rIni = await fetch(`${API}/extrair`, { method: "POST", headers: authHeaders(), body: form });
  if (!rIni.ok) {
    const err = await rIni.json().catch(() => ({ detail: `Erro HTTP ${rIni.status}` }));
    throw new Error(err.detail || "Erro ao iniciar a extração");
  }
  const { job_id } = await rIni.json();
  if (!job_id) throw new Error("O servidor não devolveu o job da extração.");

  const ESPERA_MS = 3000;
  const TETO_MS = 15 * 60 * 1000;   // 15 min: não é prazo de sucesso, é rede de
  // segurança contra job que travou de vez (backend caiu, thread morreu) — não
  // trava a tela para sempre nesse caso raro.
  const t0 = Date.now();
  let tentativa = 0;
  while (true) {
    if (Date.now() - t0 > TETO_MS) {
      throw new Error("A extração está demorando demais (mais de 15 min) — pode ter travado no servidor. Me avise.");
    }
    await new Promise((res) => setTimeout(res, ESPERA_MS));
    tentativa += 1;
    let rSt;
    try {
      rSt = await fetch(`${API}/extrair-status/${encodeURIComponent(job_id)}`, { headers: authHeaders() });
    } catch {
      continue;   // rede oscilou por um instante — tenta de novo na próxima volta
    }
    if (rSt.status === 404) throw new Error("O job da extração sumiu do servidor. Tente de novo.");
    if (!rSt.ok) {
      const err = await rSt.json().catch(() => ({ detail: `Erro HTTP ${rSt.status}` }));
      throw new Error(err.detail || "Erro ao consultar a extração");
    }
    const d = await rSt.json();
    if (d.status === "concluido") return d;
    if (onProgresso) onProgresso(tentativa, ESPERA_MS);
    // "processando": continua o laço
  }
}

// Identidade estável do item (v3.61). O save apaga e recria as linhas da proposta,
// então o `id` muda a cada auto-save. O `item_uid` nasce aqui, viaja com o item e é
// por ele que o resultado da pesquisa do Dwight volta para a linha certa.
// Dica de preenchimento de um campo do Tiny (v3.75). As regras vêm do backend
// (GET /api/guia/exportacao-tiny?formato=json) — a MESMA fonte que a prévia e o
// guia dos bots usam. Sem guia carregado, não mostra nada (nunca texto velho).
export function textoDicaTiny(guia, campo) {
  const r = guia && guia[campo];
  if (!r) return "";
  const ex = (r.exemplos || []).slice(0, 4).join(" · ");
  return ex ? `${r.formato} Ex.: ${ex}` : r.formato;
}

function DicaTiny({ guia, campo }) {
  const t = textoDicaTiny(guia, campo);
  if (!t) return null;
  return <div className="mt-1 text-[10.5px] leading-snug text-faint">{t}</div>;
}

// A conexão OAuth com o Tiny caiu? (a renovação do token foi recusada)
export function precisaReconectarTiny(msg) {
  const m = String(msg || "").toLowerCase();
  return m.includes("autoriza") && (m.includes("expirou") || m.includes("tiny/autorizar") || m.includes("reconect"));
}

// Números com vírgula ou ponto -> float (v3.80, mesma regra do painel).
export function numBR(v) {
  let s = String(v ?? "").trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

// Lucro por unidade: venda − custo − frete de vinda rateado (o frete é por item, não ×qtd).
export function lucroUnitario(item) {
  const q = parseFloat(item?.quantidade) || 1;
  return (Number(item?.preco_un) || 0) - (Number(item?.preco_custo) || 0) - numBR(item?.frete_vinda) / q;
}

// Custo & lucro da proposta (v3.80) — puro, testável. Frete de vinda por item
// (sem ×qtd) + frete de ida por proposta entram no custo; o frete COBRADO
// (campo do Tiny) entra na receita.
export function calcularCustoLucro(prop, aliquotaNF = 0.12) {
  const itens = (prop && prop.itens) || [];
  const prodVenda = itens.reduce((s, i) => s + (Number(i.preco_un) || 0) * (parseFloat(i.quantidade) || 0), 0);
  const prodCusto = itens.reduce((s, i) => s + (Number(i.preco_custo) || 0) * (parseFloat(i.quantidade) || 0), 0);
  const freteVinda = itens.reduce((s, i) => s + numBR(i.frete_vinda), 0);
  const freteIda = numBR(prop && prop.frete_ida);
  const freteCobrado = numBR(prop && prop.frete);
  const receita = prodVenda + freteCobrado;
  const nf = receita * aliquotaNF;
  const custoTotal = prodCusto + freteVinda + freteIda;
  const lucro = receita - nf - custoTotal;
  return { prodVenda, prodCusto, freteVinda, freteIda, freteCobrado, receita, nf, custoTotal, lucro,
           margem: receita > 0 ? (lucro / receita) * 100 : 0 };
}

// Texto da confirmação antes de exportar ao Tiny (v3.72) — puro, testável.
export function mensagemPreviaTiny(pv) {
  const c = (pv && pv.cliente) || {};
  const linhaCliente = c.acao === "criar"
    ? `Cliente NÃO existe no Tiny — vou CADASTRAR: ${c.nome} (${c.cnpj}), dados da ${c.fonte_dados}.`
    : `Cliente: ${c.nome} (${c.cnpj}) — id ${c.id} no Tiny.`;
  const avisos = (pv && pv.avisos) || [];
  return [
    `Exportar proposta ${(pv && pv.numero) || ""} para o Tiny?`,
    "",
    linhaCliente,
    `Operação: ${pv && pv.operacao}.`,
    ...(pv && pv.condicao_pagamento && pv.condicao_pagamento.tipo !== "vazio"
      ? [`Condição de pagamento: "${pv.condicao_pagamento.original}" → ${pv.condicao_pagamento.explicacao}.`]
      : []),
    `${((pv && pv.itens) || []).length} itens · total ${brl((pv && pv.total) || 0)}.`,
    ...(avisos.length ? ["", "Avisos:", ...avisos.map((a) => "• " + a)] : []),
  ].join("\n");
}

export function dataCurtaBR(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                                       timeZone: "America/Sao_Paulo" });
  } catch { return "—"; }
}

// Resumo do disparo (v3.73): cache x fila. Puro, testável.
export function resumoDisparoDwight(d) {
  d = d || {};
  const cache = Number(d.cache || 0), fila = Number(d.na_fila ?? d.enviados ?? 0);
  const rep = (d.repetidos || []).length;
  if (!cache && !fila) return d.motivo || (rep ? `${rep} item(ns) já estão em pesquisa.` : "Nenhum item para pesquisar.");
  const partes = [];
  if (cache) partes.push(`${cache} ${cache === 1 ? "item veio" : "itens vieram"} do cache (pesquisa recente)`);
  if (fila) partes.push(`${fila} ${fila === 1 ? "item foi" : "itens foram"} para a fila do Dwight`);
  if (rep) partes.push(`${rep} já estava${rep === 1 ? "" : "m"} em pesquisa`);
  return partes.join(" · ") + ". O resultado aparece em cada item.";
}

function novoUid() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* segue */ }
  const h = "0123456789abcdef";
  let u = "";
  for (let i = 0; i < 36; i++) {
    if ([8, 13, 18, 23].includes(i)) u += "-";
    else if (i === 14) u += "4";
    else if (i === 19) u += h[(Math.random() * 4 | 0) + 8];
    else u += h[Math.random() * 16 | 0];
  }
  return u;
}
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

// ─────────────────────────────────────────────────────────────────────────────
// TERMO DE BUSCA — monta a query que os atalhos de marketplace disparam.
//
// O chip mandava `descricao_final` inteira. Descrição de proposta é texto
// COMERCIAL: carrega atributos que servem pra CONFERIR o item, não pra ACHAR.
// "REGUA TOMADA PRETA 127/220V CA 10A 3 TOMADAS 2 POLOS + TERRA 1,2M 26024 FC"
// não acha nada; "regua 3 tomadas 26024" acha.
//
// PRINCÍPIO: só reordena e poda o que o cliente deu. NUNCA inventa identificador
// — foi o chute de MPN que produziu o GSA-M278 do blueprint.
// ─────────────────────────────────────────────────────────────────────────────

// Marcas mineradas do histórico (produtos + specs rotuladas pelo operador).
// Serve pra decidir se um código tem lastro: código sozinho é ambíguo, código
// COM fabricante é identificação.
const MARCAS = new Set(`
INTELBRAS CLAMPER ICLAMPER PIAL LEGRAND BTICINO WETZEL PIX WOMER SCHNEIDER AVANT ELG
SPECTRUS FIBERWAN NEUTRIK SANDISK DATATON EDWARDS VONDER WEG FURUKAWA INTRAL SMS SIL
TRAMONTINA NEXANS BOSCH OSRAM CEMAR FABRIMAR STECK DAISA DEWALT VENTISOL IMPLASTEC
TASCO OUROLUX FIBERSUL BELZER APC TP-LINK GRACO FAME NORTON GEDORE TIGRE INTELLI
MINIPA INPOL MAKITA LOGITECH PHILIPS STARRETT STANLEY IRWIN SEGURIMAX FOXLUX SOPRANO
NOTIFIER KIDDE VIGILANT FORTINET ZYXEL GRANDSTREAM EIZO AXIS HIKVISION DAHUA UBIQUITI
MIKROTIK FLUKE SIEMENS ABB LUTRON PRYSMIAN HP DELL EPSON SAMSUNG LG SONY CANON BROTHER
UGREEN KODAK MOKA SIMINICS MICROSEMI D2W ITCOMTECH ELITECH MASTERCOOL ADATA ICOM MINOX
MOES DECA DJI CANARE SECCON SCANIA MWM OWA HARDEN ROSSI NESFER MTM STARTEC ORANGE
SEAGATE TOSHIBA ACER ASUS INTEL AMD NIKE JORDAN LAIRD JEVIN MXT VBOX PIER
SCOTCH 3M ALULEV HIKARI MARFINITE TASCHIBRA QSC BLACKMAGIC SOLARTRON BUFFALO GE
ENERBRAS ORION CONDOR ATLAS LUKSCOLOR SUVINIL KARCHER EATON APPLE HELLERMANN HDL
SENSOTRON LEDVANCE NITROLUX MIGRARE ROMAZI JAGUAR NOVATEC TRANE BAUDOUIN FREEDOM
ELECTROLUX TEKBOND RAPIFIX NADIR SUMAY STARTEC SEGURIMAX FOXLUX SOPRANO PACRI
WALTER STANLEY IRWIN CORNETA GEDORE EZPHASE PIRELLI CLAMPER STECK WOMER FIBERSUL
FIBERWAN CANARE NEUTRICK LOGITECH SANDISK KODAK META DGM LUXCEO SAMSUNG QSC ELG
`.trim().split(/\s+/));

// Ruído de descrição de licitação/ERP. São atributos de CONFERÊNCIA, não de BUSCA.
const RUIDO = new Set(`
TIPO APLICACAO APLICAÇÃO CARACTERISTICA CARACTERÍSTICA REFERENCIA REFERÊNCIA
CAPACIDADE NATIVA TENSAO TENSÃO COMUTACAO COMUTAÇÃO NUMERO NÚMERO QUANTIDADE
MATERIAL COMPRIMENTO LARGURA ALTURA DIAMETRO DIÂMETRO ESPESSURA MEDIDA DIMENSAO DIMENSÃO
FABRICACAO FABRICAÇÃO ACABAMENTO FORNECIDA FORNECIDO CONFORME PADRAO PADRÃO
UNIDADE UNIDADES UNID UN PECAS PEÇAS PECA PEÇA CAIXA CX PCT KIT
COR SEM COM DE DA DO DAS DOS EM PARA POR NA NO E OU A O AS OS
ORIGINAL NOVO NOVA MODELO MARCA FAB FABRICANTE OBS OBSERVACAO OBSERVAÇÃO
GRAU PROTECAO PROTEÇÃO OPERACAO OPERAÇÃO FAIXA CLASSE SERIE SÉRIE
`.trim().split(/\s+/));

// Rótulos cujo VALOR nunca é identificador de fabricante.
const ROTULO_BANIDO = /^(pn\s*interno|c[oó]digo\s*interno|c[oó]d|c[oó]d\.?\s*produto|ncm|unspsc|rc|requisi[cç][aã]o|entrega|endere[cç]o|cep|prazo|local|obs|observa[cç][aã]o|valor|total|pre[cç]o|item)$/i;
const ROTULO_MARCA  = /^(marca|fabricante|fab)$/i;
const ROTULO_MODELO = /^(modelo|mod)$/i;
const ROTULO_PN     = /^(pn|p\/n|part\s*number|ref|ref\.|refer[eê]ncia)$/i;

const UNIDADE_SEGUINTE = /^(BTU|BTUS|BTU'S|MM|CM|M|MT|MTS|METROS?|V|VAC|VDC|A|AMP|AMPERES?|W|KW|KVA|HZ|MHZ|GHZ|KG|G|TB|GB|MB|RPM|LUMENS?|LM|OHMS?|POL|POLEGADAS?|UN|PCS|PAGINAS?|LITROS?|L|AH|CV|UF|GRAUS?)$/i;

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Código de registro interno do cliente — NUNCA vai pra busca.
 *  Formas medidas no banco: UC.109710, ES.118176, AUXELE.MATELE.MPS-65/2MTM,
 *  27.063.625 (mesmo prefixo em produtos diferentes), 0001..0011 (nº de linha). */
function codigoInterno(tok, codigoCliente = "") {
  const t = String(tok || "").trim().toUpperCase();
  if (!t) return true;
  const cc = String(codigoCliente || "").trim().toUpperCase();
  if (cc && t === cc) return true;                    // é o código do ERP do cliente
  if (/^[A-Z]{2,}\.[A-Z0-9.\-\/]+$/.test(t)) return true;   // UC.105058, AUXELE.MATELE...
  if (/^\d{2}\.\d{3}\.\d{3}$/.test(t)) return true;         // 27.063.625
  if (/^0\d{2,3}$/.test(t)) return true;                    // 0001..0011 (linha)
  if (/^0\d{7,}$/.test(t)) return true;                     // 0121000061, 0130000713
  if (/^(MEST|MPAT|REQ|SC|RC)[0-9]/.test(t)) return true;   // MEST205012
  if (/^(NCM|UNSPSC)$/.test(t)) return true;
  return false;
}

/** Parte as specs em pares rótulo→valor. Separadores reais: | ; , — e quebra. */
const COMPAT = /\bcompat[íi]ve(l|is)\b|\bequivalente\b|\bsimilar\b|\bou\s+superior\b/i;

function pares(sp) {
  const out = [];
  String(sp || "").split(/[|;\n]|\s+—\s+/).forEach((p) => {
    const m = p.match(/^\s*([^:]{1,28}?)\s*:\s*(.+)$/);
    if (m) out.push({ rot: m[1].trim(), val: m[2].trim() });
  });
  return out;
}

/** Token com cara de identificador de fabricante: mistura letra e dígito, ou
 *  código numérico longo. Precisa ter 4+ chars pra não pegar "10A"/"2P". */
function limpaTok(t) {
  let u = String(t || "");
  if (u.includes("(") && !u.includes(")")) u = u.split("(")[0];
  if (u.includes("=")) u = u.split("=").pop();   // "L=200X100MM" -> "200X100MM"
  return u.replace(/^[^\wÀ-ú]+|[^\wÀ-ú%"'\)\]]+$/g, "");
}

function pareceMPN(t, { numericoOk = true } = {}) {
  const u = limpaTok(t).toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9\-\/\.]+$/g, "");
  if (u.length < 4 || u.length > 24) return false;
  // Atributo técnico disfarçado de código. Medido: "36000 BTU", "3000K",
  // "220/380VAC", "200X100MM", "2,5MM" viravam PN e destruíam a busca.
  if (/^\d+([.,]\d+)?\s*(MM|CM|M|V|A|W|KW|KVA|TB|GB|MB|KG|HZ|VAC|VDC|VCC|KA|KV|K|U|P|POL|BTU|RPM|LM|NM|OHM|MHZ|GHZ|KHZ|MT|MTS|METRO|METROS|AH|MAH|CV|UF)$/.test(u)) return false;
  if (/^\d+[XÃ]\d+/.test(u)) return false;                 // 200X100MM
  if (/^\d+([.,]\d+)?\/\d+/.test(u)) return false;        // 220/380VAC, 127/220V
  if (/^(NBR|IP|CAT|ABNT|IEC|USB|HDMI|SATA|RGB|LED|PVC|EPR|CFOA|SM|MM|OM|UTP|FTP)\d*[A-Z]?$/.test(u)) return false;
  const temL = /[A-Z]/.test(u), temD = /[0-9]/.test(u);
  if (temL && temD) return true;              // C7976A, FG-40F, SDJS800, KTS34-5M-S
  if (numericoOk && /^\d{5,12}$/.test(u)) return true;       // 44051108, 4820160, 26024
  return false;
}

/** PN rotulado pode ser puramente alfabético com hífen: SIGA-CR, MPS-65/2.
 *  Só recusa palavra comum solta. */
function pnRotuladoValido(v) {
  const u = semAcento(v).toUpperCase();
  if (pareceMPN(v)) return true;
  return /^[A-Z]{2,}[\-\/][A-Z0-9\-\/]+$/.test(u);
}

/** Poda: tira ruído de licitação, código interno e excesso. Mantém a ordem. */
function podar(txt, codigoCliente, teto = 8) {
  const brutos = norm(txt).split(/\s+/);
  const vistos = new Set();
  const keep = [];
  for (const b of brutos) {
    const limpo = b.replace(/^[^\wÀ-ú%"']+|[^\wÀ-ú%"']+$/g, "");
    if (!limpo) continue;
    const up = semAcento(limpo).toUpperCase();
    if (RUIDO.has(up)) continue;
    if (codigoInterno(limpo, codigoCliente)) continue;
    if (up.length === 1 && !/\d/.test(up)) continue;
    if (vistos.has(up)) continue;                 // "TIPO X ... TIPO L" duplicado
    vistos.add(up);
    keep.push(limpo);
    if (keep.length >= teto) break;
  }
  return keep.join(" ");
}

/**
 * Monta o termo de busca do item.
 * @returns {{termo:string, motivo:string}} motivo = como chegou nele (pro operador entender)
 */
function termoBusca(item) {
  const d  = norm(item.descricao_final || item.d || "");
  const o  = norm(item.descricao_original || item.o || "");
  const sp = norm(item.specs_complementares || item.sp || "");
  const cc = norm(item.codigo_cliente || item.cc || "");

  let marca = "", modelo = "", pn = "";

  // 1) Rótulos das specs — mas só os que passam no teste de validade.
  for (const { rot, val } of pares(sp)) {
    if (ROTULO_BANIDO.test(rot)) continue;
    if (COMPAT.test(rot) || COMPAT.test(val)) continue;   // "Compatível com motor MWM 6.12TCA"
    const v = val.split(/[,/]/)[0].trim();          // "T11A120 / T11A120AL" -> primeiro
    if (!v || v.split(/\s+/).length > 4) continue;  // "8mm, 25 unidades, plástica" não é PN
    if (ROTULO_MARCA.test(rot)  && !marca)  marca  = v;
    else if (ROTULO_MODELO.test(rot) && !modelo && !codigoInterno(v, cc)) modelo = v;
    else if (ROTULO_PN.test(rot) && !pn && !codigoInterno(v, cc) && pnRotuladoValido(v)) {
      // Numérico puro vindo SÓ das specs é quase sempre código do ERP do cliente
      // (medido: "PN: 1017265" num item cujo código real, na descrição, era 615040).
      // Se o número não aparece no texto que o cliente escreveu, não é do fabricante.
      const soNumero = /^\d+$/.test(v);
      if (!soNumero || `${d} ${o}`.includes(v)) pn = v;
    }
  }

  // 2) Marca reconhecida no texto. Se a descrição final já traz uma marca, ela
  //    manda — anexar a da spec produzia "UNIDUTE ... DAISA Wetzel", duas marcas
  //    contraditórias no mesmo termo.
  const marcaNaDesc = norm(d).split(/\s+/)
    .map((t) => semAcento(limpaTok(t)).toUpperCase()).find((t) => MARCAS.has(t));
  if (marcaNaDesc) marca = marcaNaDesc;
  if (!marca) {
    for (const fonte of [d, o]) {
      // Só token separado por ESPAÇO. "LC/APC/SM" é polimento de fibra, não a
      // marca APC — quebrar por barra criava esse falso positivo.
      const hit = norm(fonte).split(/\s+/)
        .map((t) => semAcento(limpaTok(t)).toUpperCase())
        .find((t) => MARCAS.has(t));
      if (hit) { marca = hit; break; }
    }
  }

  // 3) Código com cara de MPN no texto. A descrição final tem PRIORIDADE sobre o
  //    rótulo: quando o operador corrige o item, ele corrige a descrição e a spec
  //    fica velha (medido: spec "WD241PURP" contra descrição "WD260PURP" 26TB).
  const noTextoFinal = (() => {
    const mm = COMPAT.exec(d);
    const tk = norm(mm ? d.slice(0, mm.index) : d).split(/\s+/);
    const c = tk.map(limpaTok).filter((t, i) => {
      if (!t || codigoInterno(t, cc)) return false;
      if (MARCAS.has(semAcento(t).toUpperCase())) return false;
      const prox = limpaTok(tk[i + 1] || "");
      if (/^\d+$/.test(t) && UNIDADE_SEGUINTE.test(prox)) return false;
      return pareceMPN(t);
    });
    return c.length ? c[c.length - 1] : "";
  })();
  if (noTextoFinal) pn = noTextoFinal;

  if (!pn) {
    for (const fonte of [d, o]) {
      // Corta o texto no "compatível com": o que vem depois identifica o
      // equipamento em que o item se aplica, não o item.
      const m = COMPAT.exec(fonte);
      const toks = norm(m ? fonte.slice(0, m.index) : fonte).split(/\s+/);
      const cand = toks.map(limpaTok).filter((t, i) => {
        if (!t || codigoInterno(t, cc)) return false;
        if (MARCAS.has(semAcento(t).toUpperCase())) return false;
        // Número seguido de unidade é grandeza, não código: "36000 BTU'S",
        // "5000 PAGINAS", "100 METROS". Sem olhar o vizinho, viravam PN.
        const prox = limpaTok(toks[i + 1] || "");
        if (/^\d+$/.test(t) && UNIDADE_SEGUINTE.test(prox)) return false;
        return pareceMPN(t);
      });
      if (cand.length) { pn = cand[cand.length - 1]; break; }   // o do fim é o do fabricante
    }
  }

  const ident = pn || modelo;

  // Já contém este texto? (compara sem acento, por token)
  const contem = (base, alvo) => {
    const A = semAcento(base).toUpperCase();
    return semAcento(alvo).toUpperCase().split(/\s+/).every((t) => A.includes(t));
  };
  const juntar = (base, extra) => (contem(base, extra) ? base : norm(`${base} ${extra}`));

  // 4) Decisão. Marca + identificador é o par que acha. Código órfão é ambíguo,
  //    marca sozinha é genérica demais — nenhum dos dois basta isolado.
  if (marca && ident) {
    // Código numérico puro (4820160, 58014021) é frágil sozinho: sem a categoria,
    // um dígito trocado vira outro produto. Alfanumérico (SDJS800) se sustenta.
    const fraco = /^\d+$/.test(limpaTok(ident));
    let cat = fraco ? podar(d || o, cc, 1) : "";
    // "DJI DJI 4640022" / "62329 SMS 62329": a categoria pode ser a própria marca
    // ou o próprio código quando a descrição já começa por eles.
    if (cat && (contem(marca, cat) || contem(ident, cat))) cat = "";
    return { termo: norm(`${cat} ${marca} ${ident}`), motivo: "fabricante + código" };
  }

  if (ident) {
    const cat = podar(d || o, cc, 3);
    return { termo: juntar(cat, ident), motivo: "código + categoria" };
  }

  if (marca) {
    const base = podar(d || o, cc, 6);
    return { termo: juntar(base, marca.split(/\s+/)[0]), motivo: "descrição + fabricante" };
  }

  return { termo: podar(d || o, cc, 8), motivo: "descrição podada" };
}

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
function ItemRow({ item, index, onChange, onRemove, token, apiUrl, fonteTexto, cnpj, propostaId, onSalvar, dwight, onPesquisarItem,
                   conhecimento, onAbrirFicha }) {
  const [extratoAberto, setExtratoAberto] = useState(null);   // v3.82
  // ── Alerta ────────────────────────────────────────────────────────────
  // ── Termo de busca ────────────────────────────────────────────────────
  // O que os atalhos disparam. Fica VISÍVEL e editável na própria linha: se
  // ficar escondido em gaveta ninguém confere, e o termo erra em silêncio —
  // que é o problema que essa feature existe pra resolver.
  const [termoTocado, setTermoTocado] = useState(false);
  const [termo, setTermo] = useState(() => termoBusca(item).termo);
  // useMemo: a linha re-renderiza a cada tecla (preço, quantidade, descrição) e
  // o parser não precisa rodar de novo quando nada que ele lê mudou.
  const termoAuto = useMemo(() => termoBusca(item),
    [item.descricao_final, item.descricao_original, item.specs_complementares, item.codigo_cliente]);
  useEffect(() => {
    // Enquanto o operador não editar, o termo acompanha a descrição/specs.
    // Depois que ele edita, a escolha dele manda — ele é a hierarquia superior.
    if (!termoTocado) setTermo(termoAuto.termo);
  }, [termoAuto.termo, termoTocado]);

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
  // ── Busca MANUAL no banco de preços ───────────────────────────────────────
  // O matching automático acerta muito, mas quando erra o operador não tinha
  // saída: aceitava o candidato da IA ou ficava sem. Medido em jul/ago: de 671
  // itens que saíram sem match e foram precificados na mão, 134 tinham no banco
  // um produto igual ou parecido, cadastrado dias antes.
  //
  // Custo zero de IA (trigrama no Postgres, ~7ms). É a consulta que deve ser
  // tentada ANTES de gastar uma busca na internet.
  const [bqAberto, setBqAberto] = useState(false);
  // Pré-carrega as 3 PRIMEIRAS PALAVRAS, não a descrição inteira: a busca é um
  // E de todos os termos, e 12 palavras do cliente dariam zero. Três palavras dão
  // a busca ampla; ele afunila digitando.
  const [bqTermo, setBqTermo] = useState(() =>
    (item.descricao_original || item.descricao_final || "").split(/\s+/).slice(0, 3).join(" "));
  const [bqLinhas, setBqLinhas] = useState(null);
  const [bqLoad, setBqLoad] = useState(false);
  const [bqErr, setBqErr] = useState("");
  const [bqMin, setBqMin] = useState("");
  const [bqMax, setBqMax] = useState("");
  const [bqForn, setBqForn] = useState("");
  // Produto escolhido cuja ORIGEM aguarda confirmação. Regra do Leonardo: herda,
  // mas mostra de onde veio pra ele confirmar. Enquanto não confirmar, custo e
  // fornecedor NÃO entram no item — em branco é melhor que dado do item errado.
  const [bqPendente, setBqPendente] = useState(null);

  async function buscarBanco() {
    const termo = (bqTermo || "").trim();
    if (!termo && !bqForn.trim() && !bqMin && !bqMax) return;
    setBqLoad(true); setBqErr("");
    try {
      const p = new URLSearchParams({ q: termo, limite: "40" });
      if (bqForn.trim()) p.set("fornecedor", bqForn.trim());
      if (bqMin !== "") p.set("preco_min", String(Number(bqMin)));
      if (bqMax !== "") p.set("preco_max", String(Number(bqMax)));
      const r = await fetch(`${apiUrl}/banco/buscar?${p.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "falhou");
      const d = await r.json();
      setBqLinhas(d.linhas || []);
    } catch (e) {
      setBqErr(`Não consegui consultar o banco (${e.message}).`);
      setBqLinhas(null);
    } finally { setBqLoad(false); }
  }

  // Escolha manual: o preço de VENDA entra na hora (é a decisão dele), e a origem
  // fica pendente de confirmação.
  //
  // `banco_id` é a peça que amarra tudo: o /upsert-precos já sabe atualizar A LINHA
  // apontada em vez de procurar por texto. Sem isso, a proposta criaria um gêmeo
  // com a descrição do cliente — e a memória aprenderia o par apontando pro gêmeo,
  // não pro produto que ele escolheu. (Foi duplicata assim que derrubou o W50.)
  function escolherProdutoBanco(p) {
    if (!p) return;
    if (Number(p.preco_un) > 0) onChange(index, "preco_un", Number(p.preco_un));
    onChange(index, "banco_id", p.id);
    onChange(index, "origem_escolha", "banco");
    const temOrigem = Number(p.preco_custo) > 0 || p.fornecedor || p.link_fornecedor;
    setBqPendente(temOrigem ? p : null);
    setBqAberto(false);
  }

  function confirmarOrigemBanco() {
    const p = bqPendente; if (!p) return;
    if (Number(p.preco_custo) > 0) onChange(index, "preco_custo", Number(p.preco_custo));
    if (p.fornecedor)      onChange(index, "fornecedor", p.fornecedor);
    if (p.link_fornecedor) onChange(index, "link_fornecedor", p.link_fornecedor);
    if (p.sku_fornecedor)  onChange(index, "sku_fornecedor", p.sku_fornecedor);
    const canal   = p.fornecedor_canal   || (p.link_fornecedor ? "link" : "");
    const contato = p.fornecedor_contato || (p.link_fornecedor || "");
    if (canal)   onChange(index, "fornecedor_canal", canal);
    if (contato) onChange(index, "fornecedor_contato", contato);
    setBqPendente(null);
  }

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

  // DISPARO AUTOMÁTICO SUSPENSO (decisão do Leonardo, ago/2026).
  //
  // Até aqui, abrir a gaveta de um item sem match disparava a busca sozinha.
  // Uma proposta de 20 itens sem match abria 20 buscas que ninguém pediu — e a
  // medição de jul/ago mostrou que cada busca custa ~5 chamadas de IA. O
  // operador olhava o resultado de talvez três delas.
  //
  // A busca continua exatamente igual; o que muda é QUEM dispara. A gaveta
  // segue abrindo sozinha no item sem match (isso é sinal visual, é de graça),
  // mostrando o botão "🌐 buscar na internet". Nada de IA roda antes do clique.
  //
  // Não remover o `netBuscadoRef`: ele ainda protege contra clique repetido e é
  // o que decide se o estado vazio (com o botão) aparece.

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

  // "usar esta" da oferta do Dwight: mesmo caminho da ficha da internet — custo e
  // origem entram, venda fica em branco, descrição do cliente não é tocada.
  // Custo = custoDaOferta: Pix quando houver, senão o cheio. Oferta com preço
  // divergente (precoDivergente) só entra pelos botões "usar Pix" / "usar cheio",
  // que marcam o item como confirmado pelo operador.
  // O frete estimado NÃO entra sozinho: é estimativa, o operador decide.
  function usarOfertaDwight(of, precoEscolhido = null) {
    const preco = precoEscolhido != null ? precoEscolhido : custoDaOferta(of);
    usarFichaInternet({
      preco_brl: preco, url: of.link || "", fonte: of.loja || "",
      sku: of.sku || "", apresentacao: of.pn || "",
    });
    if (precoEscolhido != null) onChange(index, "_preco_confirmado", true);
  }

  // "usar esta" do card do BANCO: carrega TUDO que veio do banco — preço de VENDA,
  // custo e a origem inteira (quem, por onde, contato, SKU e link). A única coisa
  // que NUNCA é tocada é a descrição do cliente.
  // Obs.: a ficha do banco sempre traz esses campos, mesmo quando o match não é
  // idêntico e o preenchimento automático não acontece — a trava do backend decide
  // o que entra SOZINHO; aqui é o operador mandando, e ele é a hierarquia superior.
  function usarFichaBanco() {
    const b = item.banco || {};
    if (b.preco_un > 0)    onChange(index, "preco_un", Number(b.preco_un));
    if (b.preco_custo > 0) onChange(index, "preco_custo", Number(b.preco_custo));
    if (b.fornecedor)        onChange(index, "fornecedor", b.fornecedor);
    if (b.link_fornecedor)   onChange(index, "link_fornecedor", b.link_fornecedor);
    if (b.sku_fornecedor)    onChange(index, "sku_fornecedor", b.sku_fornecedor);
    // canal/contato: usa o que o banco tem (pode ser whatsapp/e-mail, não só link).
    // Só cai no "link" quando o banco tem URL e não registrou canal.
    const canal   = b.fornecedor_canal   || (b.link_fornecedor ? "link" : "");
    const contato = b.fornecedor_contato || (b.link_fornecedor || "");
    if (canal)   onChange(index, "fornecedor_canal", canal);
    if (contato) onChange(index, "fornecedor_contato", contato);
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
            <a href={`https://www.google.com/search?q=${encodeURIComponent(termo || item.descricao_final)}`}
              target="_blank" rel="noopener noreferrer"
              title="Buscar no Google"
              className="flex-shrink-0 rounded-md p-1 text-faint/60 transition-colors hover:bg-paper hover:text-ink"
              onClick={(e) => e.stopPropagation()}>
              <IconGoogle size={15} />
            </a>
            {/* Pesquisa rápida por marketplace */}
            {MARKETPLACES.map((mp) => (
              <a key={mp.nome}
                href={mp.url(termo || item.descricao_final)}
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
          {/* v3.85 — linha 2 = ESTADO do item (selo, o que se sabe, motor de preços,
              termo de busca); linha 3 = AÇÕES (complementos, origem, documentos,
              excluir). Antes era tudo numa linha só, que quebrava sem ordem. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-1.5">
            <StateLabel conf={confianca} />
            {/* Código do item no ERP do cliente. É a chave que liga o mesmo produto
                entre as abas do pedido — mostrar dá ao operador como conferir a
                herança de preço sem abrir o e-mail de novo. */}
            {(item.codigo_cliente || "").trim() && (
              <span className="rounded bg-paper px-1.5 py-0.5 font-mono text-[10.5px] text-faint"
                title="Código do item no sistema do cliente">
                {item.codigo_cliente}
              </span>
            )}
            {/* Preço que veio de outra aba do MESMO pedido, não do banco nem da
                internet. O operador tem que saber o que ele preencheu e o que veio
                de carona antes de bater o martelo no CSV desta aba. */}
            {item._herdado && (
              <span className="rounded bg-signal/15 px-1.5 py-0.5 font-mono text-[10.5px] text-signal"
                title="Preço e origem copiados de outra aba deste mesmo pedido">
                herdado
              </span>
            )}
            {/* v3.82: o que a Kist já sabe deste item (qualquer cliente, qualquer bot). */}
            <ConhecimentoSelo conhecimento={conhecimento}
              onAbrir={() => onAbrirFicha && conhecimento && onAbrirFicha(conhecimento.ficha_id)} />
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
            {/* Termo que vai para os atalhos de busca. Não é a descrição da
                proposta — é a query. Editável; o que ele digitar é o que busca. */}
            <span className="ml-auto flex min-w-[9rem] max-w-[16rem] flex-1 items-center gap-1"
              title={`O que os atalhos vão buscar (${termoAuto.motivo}). Pode editar.`}>
              <IconSearch size={11} className="flex-shrink-0 text-faint/50" />
              <input
                value={termo}
                onChange={(e) => { setTermoTocado(true); setTermo(e.target.value); }}
                placeholder="termo de busca"
                spellCheck={false}
                className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-mono text-[10.5px]
                           text-faint outline-none transition-colors placeholder:text-faint/50
                           hover:bg-paper focus:bg-paper focus:text-ink" />
              {termoTocado && (
                <button
                  onClick={() => { setTermoTocado(false); setTermo(termoAuto.termo); }}
                  title="Voltar ao termo sugerido pelo sistema"
                  className="flex-shrink-0 text-[10px] text-faint/60 hover:text-ink">
                  ↺
                </button>
              )}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1.5">
            <button onClick={() => setMostrarSpecs((v) => !v)} className="text-[11px] text-faint hover:text-sub">
              {mostrarSpecs ? "− descrição complementar" : "+ descrição complementar"}
            </button>
            <button onClick={() => setMostrarOrigem((v) => !v)}
              className={`text-[11px] hover:text-sub ${temOrigem ? "text-kist" : "text-faint"}`}>
              {mostrarOrigem ? "− origem do preço" : temOrigem ? "✓ origem do preço" : "+ origem do preço"}
            </button>
            {/* Os dois documentos do item, irmãos e independentes. Mesma natureza
                da origem — são DADO do produto, viajam com ele para o banco
                quando aprovados, e os selos acendem vindo de lá. */}
            <DatasheetBotao item={item} index={index} onChange={onChange}
              token={token} apiUrl={apiUrl} fonteTexto={fonteTexto}
              propostaId={propostaId} onSalvar={onSalvar} modo="tecnico" />
            <DatasheetBotao item={item} index={index} onChange={onChange}
              token={token} apiUrl={apiUrl} fonteTexto={fonteTexto}
              propostaId={propostaId} onSalvar={onSalvar} modo="comercial" />
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
              {item.preco_custo > 0 && (() => {
                // v3.80: o frete de vinda é UM valor por item (não ×qtd), então no
                // lucro por unidade ele entra rateado pela quantidade.
                const lu = lucroUnitario(item);
                return (
                  <span className="text-[11px] text-faint" title="venda − custo − (frete de vinda ÷ quantidade)">
                    lucro un.{" "}
                    <span className={`font-mono ${lu >= 0 ? "text-signal" : "text-rose"}`}>R$ {brl(lu)}</span>
                  </span>
                );
              })()}
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

            {/* v3.85 — items-start: cada card do banco fica do tamanho do conteúdo.
                A coluna da internet é presa na coluna 2, desde a linha 1, ocupando as
                duas linhas (o "procurar outro no banco" é forçado na coluna 1 e abria
                uma 2ª linha: a internet caía nela, desalinhada do card do banco). */}
            <div className="grid gap-3 md:grid-cols-2 md:items-start">

              {/* ── BANCO (esquerda) ── */}
              {item.banco ? (
                <div className="rounded-lg border border-line2 bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="eyebrow text-[9px] font-semibold uppercase text-faint">O banco propõe</div>
                      {/* Ficha de proposta ANTIGA, anterior ao snapshot: reconstruída
                          a partir do nó de memória validado (a mesma memória que o
                          matching usa), com o dado do produto de HOJE. Não é a foto
                          do dia — e o operador precisa saber disso antes de decidir. */}
                      {item.banco.reconstruida && (
                        <span title="Proposta anterior ao registro da ficha. Reconstruída pelo nó de memória validado deste cliente; os valores são os do banco hoje, não os do dia da proposta."
                          className="rounded-md border border-line2 bg-paper px-1.5 py-0.5 text-[10px] font-medium text-amber">
                          reconstruída da memória
                        </span>
                      )}
                    </div>
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

              {/* ── BUSCA MANUAL NO BANCO ──────────────────────────────────
                  Fica na coluna do BANCO e aparece SEMPRE — inclusive quando a
                  IA achou algo, porque o caso que importa é justamente "trouxe,
                  mas não é o certo". Espelha o "não é isso?" que o lado internet
                  já tinha; até aqui só a internet podia ser contestada. */}
              <div className="md:col-start-1">
                {bqPendente && (
                  <div className="mb-2 rounded-lg border border-kist/40 bg-paper px-3 py-2">
                    <div className="text-[11px] font-semibold text-kist">Confirma a origem?</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-sub">
                      {Number(bqPendente.preco_custo) > 0 && (
                        <>custo <span className="font-mono text-ink">{brl(bqPendente.preco_custo)}</span></>
                      )}
                      {bqPendente.fornecedor && <> · {bqPendente.fornecedor}</>}
                      {bqPendente.fornecedor_contato && (
                        <> · <span className="font-mono">{bqPendente.fornecedor_contato}</span></>
                      )}
                      {bqPendente.proposta_tiny && <> · proposta {bqPendente.proposta_tiny}</>}
                      {bqPendente.data_ref && <> de {bqPendente.data_ref.split("-").reverse().join("/")}</>}
                    </div>
                    <div className="mt-1.5 flex gap-2">
                      <button onClick={confirmarOrigemBanco}
                        className="rounded-md border border-kist bg-kist px-2 py-0.5 text-[11px] font-medium text-white hover:bg-kist600">
                        confirmar origem
                      </button>
                      <button onClick={() => setBqPendente(null)}
                        className="rounded-md border border-line2 px-2 py-0.5 text-[11px] font-medium text-sub hover:border-kist hover:text-kist">
                        só o preço de venda
                      </button>
                    </div>
                  </div>
                )}

                {!bqAberto ? (
                  <button onClick={() => setBqAberto(true)}
                    className="w-full rounded-lg border border-dashed border-line2 px-3 py-1.5 text-[11.5px] font-medium text-sub hover:border-kist hover:text-kist">
                    procurar outro no banco
                  </button>
                ) : (
                  <div className="rounded-lg border border-line2 bg-surface p-2.5">
                    <div className="flex gap-1.5">
                      <input value={bqTermo} onChange={(e) => setBqTermo(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") buscarBanco(); }}
                        placeholder="palavra-chave, modelo, fabricante, nº da proposta…"
                        className="min-w-0 flex-1 rounded-md border border-line2 bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-kist" />
                      <button onClick={buscarBanco} disabled={bqLoad}
                        className="flex-shrink-0 rounded-md border border-line2 px-2 py-1 text-[11px] font-medium text-sub hover:border-kist hover:text-kist disabled:opacity-50">
                        {bqLoad ? "…" : "buscar"}
                      </button>
                      <button onClick={() => setBqAberto(false)}
                        className="flex-shrink-0 rounded-md px-1.5 text-[11px] text-faint hover:text-ink">✕</button>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <input value={bqForn} onChange={(e) => setBqForn(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") buscarBanco(); }}
                        placeholder="fornecedor"
                        className="w-28 rounded-md border border-line2 bg-paper px-1.5 py-0.5 text-[11px] outline-none focus:border-kist" />
                      <input value={bqMin} onChange={(e) => setBqMin(e.target.value)} type="number"
                        placeholder="R$ de" className="w-20 rounded-md border border-line2 bg-paper px-1.5 py-0.5 text-[11px] outline-none focus:border-kist" />
                      <input value={bqMax} onChange={(e) => setBqMax(e.target.value)} type="number"
                        placeholder="R$ até" className="w-20 rounded-md border border-line2 bg-paper px-1.5 py-0.5 text-[11px] outline-none focus:border-kist" />
                      {bqLinhas && (
                        <span className="text-faint">
                          {bqLinhas.length === 0 ? "nada encontrado — tire uma palavra"
                            : `${bqLinhas.length}${bqLinhas.length >= 40 ? "+" : ""} resultado${bqLinhas.length > 1 ? "s" : ""}${bqLinhas.length > 8 ? " — acrescente uma palavra pra refinar" : ""}`}
                        </span>
                      )}
                    </div>

                    {bqErr && <div className="mt-1.5 text-[11.5px] text-amber">{bqErr}</div>}

                    {bqLinhas?.length > 0 && (
                      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-0.5">
                        {bqLinhas.map((p) => (
                          <button key={p.id} onClick={() => escolherProdutoBanco(p)}
                            className="block w-full rounded-md border border-line2 bg-paper px-2 py-1.5 text-left hover:border-kist">
                            <div className="text-[12px] leading-snug text-ink">{p.descricao}</div>
                            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
                              <span className="font-mono text-ink">{brl(p.preco_un)}</span>
                              {Number(p.preco_custo) > 0 && (
                                <span className="text-faint">custo <span className="font-mono">{brl(p.preco_custo)}</span></span>
                              )}
                              {p.fornecedor && <span className="text-sub">{p.fornecedor}</span>}
                              {p.rastreavel && <span className="text-signal">rastreável</span>}
                              {p.data_ref && <span className="text-faint">{p.data_ref.split("-").reverse().join("/")}</span>}
                              {p.onde === "outro campo" && <span className="text-faint">(casou fora da descrição)</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── INTERNET (direita) ── */}
              {/* v3.85 — coluna em flex: o card do Dwight fica em cima e a caixa da
                  internet ocupa SÓ o que sobra (flex-1). Antes a caixa tinha h-full
                  (100% da coluna) embaixo do card e vazava por cima do item seguinte. */}
              <div className="flex min-w-0 flex-col gap-2 md:col-start-2 md:row-span-2 md:row-start-1 md:self-stretch">
                {(dwight || onPesquisarItem) && (
                  <div className="rounded-lg border border-line2 bg-surface px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="eyebrow text-[9px] font-semibold uppercase text-faint">{dwight?.motor === "kistbot" ? "KistBot Dwight" : "Dwight"}</div>
                      <div className="flex items-center gap-2">
                        {dwight?.telemetria?.tempo_ms != null && (
                          <span className="font-mono text-[10px] text-faint">
                            {Math.round(dwight.telemetria.tempo_ms / 1000)}s
                            {dwight.telemetria.buscas != null && `·${dwight.telemetria.buscas}b`}
                            {dwight.telemetria.paginas != null && `·${dwight.telemetria.paginas}p`}
                          </span>
                        )}
                        {onPesquisarItem && dwight?.status !== "aguardando" && dwight?.status !== "na_fila" && (
                          <button onClick={onPesquisarItem}
                            title="Pesquisar só este item no Dwight"
                            className="rounded-md border border-line2 px-2 py-0.5 text-[10.5px] font-medium text-sub hover:border-kist hover:text-kist">
                            {dwight ? "pesquisar de novo" : "🔎 pesquisar este item"}
                          </button>
                        )}
                      </div>
                    </div>

                    {dwight?.status === "na_fila" && (
                      <div className="mt-1 text-[12px] text-sub">Na fila do Dwight…</div>
                    )}
                    {dwight?.status === "aguardando" && (
                      <div className="mt-1 text-[12px] text-sub">Pesquisando…</div>
                    )}
                    {dwight?.status === "concluido" && (dwight?.julgamento || dwight?.extrato_id) && (
                      <div className="mt-1 space-y-0.5 text-[11.5px]">
                        {dwight.julgamento?.motivo && <div className="text-sub">por quê: {dwight.julgamento.motivo}</div>}
                        {(dwight.julgamento?.riscos || []).map((r, k) => <div key={k} className="text-rose">⚠ {r}</div>)}
                        {(dwight.julgamento?.validar_com_cliente || []).map((r, k) => <div key={k} className="text-amber">? validar: {r}</div>)}
                        {dwight.resultado?.resumo_mercado && <div className="text-faint">mercado: {dwight.resultado.resumo_mercado}</div>}
                        {dwight.extrato_id && (
                          <button onClick={() => setExtratoAberto(dwight.extrato_id)} className="text-[11px] text-kist hover:underline">
                            ver extrato da pesquisa
                          </button>
                        )}
                      </div>
                    )}
                    {extratoAberto && (
                      <ExtratoModal token={token} apiUrl={apiUrl} extratoId={extratoAberto}
                        itemUid={item.item_uid} onClose={() => setExtratoAberto(null)} />
                    )}
                    {dwight?.status === "concluido" && dwight?.origem === "cache" && (
                      <div className="mt-0.5 text-[10.5px] text-faint">
                        do cache · pesquisado em {dataCurtaBR(dwight.telemetria?.cache_de)}
                      </div>
                    )}
                    {dwight?.status === "expirado" && (
                      <div className="mt-1 text-[12px] text-amber">Sem retorno há mais de 3 h.</div>
                    )}
                    {dwight?.status === "erro_envio" && (
                      <div className="mt-1 text-[12px] text-rose">Não consegui enviar ao Dwight.</div>
                    )}
                    {dwight?.status === "erro" && (
                      <div className="mt-1 text-[12px] text-rose">Erro na pesquisa.{dwight.resultado?.obs ? ` ${dwight.resultado.obs}` : ""}</div>
                    )}
                    {dwight?.status === "nao_encontrado" && (
                      <div className="mt-1 text-[12px] text-amber">Não encontrou este item.{dwight.resultado?.obs ? ` ${dwight.resultado.obs}` : ""}</div>
                    )}

                    {dwight?.status === "concluido" && (() => {
                      const ofertas = dwight.resultado?.ofertas || [];
                      const k0 = dwight.resultado?.escolha || 0;
                      const rec = ofertas[k0];
                      if (!rec) return null;
                      const outras = ofertas.filter((_, k) => k !== k0);
                      const linha = (of, k) => (
                        <div key={k} className="flex items-baseline justify-between gap-2 py-0.5">
                          <div className="min-w-0 flex-1 truncate text-[11.5px] text-sub">
                            {of.link
                              ? <a href={of.link} target="_blank" rel="noreferrer" className="text-kist hover:underline">{of.loja || "loja"}</a>
                              : (of.loja || "—")}
                            {of.pn && <span className="ml-1.5 font-mono text-[10.5px] text-faint">{of.pn}</span>}
                          </div>
                          {precoDivergente(of) ? (
                            <div className="flex flex-shrink-0 items-center gap-1.5"
                              title="Pix e cheio divergentes (ou OCR/outlier): um dos dois está errado. Abra o anúncio e escolha.">
                              <span className="text-[10.5px] text-amber">confirme:</span>
                              {pixDaOferta(of) != null && (
                                <button onClick={() => usarOfertaDwight(of, pixDaOferta(of))}
                                  className="rounded-md border border-amber/60 px-1.5 py-0.5 font-mono text-[10.5px] text-ink hover:border-kist">
                                  Pix {brl(pixDaOferta(of))}
                                </button>)}
                              {Number(of.preco_cheio) > 0 && (
                                <button onClick={() => usarOfertaDwight(of, Number(of.preco_cheio))}
                                  className="rounded-md border border-amber/60 px-1.5 py-0.5 font-mono text-[10.5px] text-ink hover:border-kist">
                                  cheio {brl(Number(of.preco_cheio))}
                                </button>)}
                            </div>
                          ) : (
                          <div className="flex flex-shrink-0 items-center gap-2">
                            {custoDaOferta(of) != null
                              ? <span className="font-mono text-[12.5px] text-ink">{brl(custoDaOferta(of))}</span>
                              : <span className="text-[11px] text-amber">sem preço</span>}
                            <button onClick={() => usarOfertaDwight(of)}
                              className="rounded-md border border-line2 px-1.5 py-0.5 text-[10.5px] font-medium text-sub hover:border-kist hover:text-kist">
                              usar
                            </button>
                          </div>)}
                        </div>
                      );
                      const jaUsada = (item.link_fornecedor || "") === (rec.link || "\u0000");
                      return (
                        <div className="mt-1">
                          {linha(rec, k0)}
                          <div className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-faint">
                            {rec.estoque && <span>{rec.estoque}</span>}
                            {rec.preco_cheio != null && rec.preco_pix != null && !precoDivergente(rec) && <span>· cheio {brl(rec.preco_cheio)}</span>}
                            {precoDivergente(rec) && <span className="text-amber">· Pix e cheio divergentes — nada foi carregado sozinho</span>}
                            {custoAConfirmar(item, rec) && <span className="text-rose">· o custo do item veio desta oferta e não foi confirmado</span>}
                            {rec.frete != null && <span>· frete est. {brl(rec.frete)}</span>}
                            {rec.prazo && <span>· {rec.prazo}</span>}
                            {jaUsada && <span className="text-signal">· carregada no item</span>}
                          </div>
                          {outras.length > 0 && (
                            <details className="mt-0.5">
                              <summary className="cursor-pointer text-[10.5px] text-faint hover:text-sub">
                                +{outras.length} {outras.length === 1 ? "oferta" : "ofertas"}
                              </summary>
                              <div className="mt-0.5 border-t border-line pt-0.5">
                                {ofertas.map((of, k) => k === k0 ? null : linha(of, k))}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {netLoad && (
                  <div className="flex flex-1 items-center rounded-lg border border-line2 bg-surface px-3 py-2.5 text-[12px] text-sub">
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
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line2 bg-surface p-3 text-center">
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

// ─────────────────────────────────────────────────────────────────────────
// PROPAGAÇÃO DE LASTRO ENTRE ABAS
//
// Cliente que quebra o pedido por destino manda o MESMO item várias vezes, uma
// vez por local de entrega. O operador cotava o mesmo produto 4 vezes. Gerar o
// CSV de uma aba agora copia preço e origem para as irmãs.
//
// O que copia: ORIGEM/LASTRO — venda, custo, frete de vinda (que é do fornecedor
// até a Kist, igual para todos os destinos) e o rastro inteiro do fornecedor.
// O que NUNCA copia: o cadastro do item — descrição, specs, quantidade, unidade.
// O que muda entre destinos é quanto e para onde, não o que o produto é.
// ─────────────────────────────────────────────────────────────────────────
// Oferta recomendada de um item, dado o mapa de resultados do Dwight.
export function ofertaDwight(it, mapa) {
  const r = it?.item_uid ? (mapa || {})[String(it.item_uid).toLowerCase()] : null;
  if (!r || r.status !== "concluido") return null;
  const ofertas = r.resultado?.ofertas || [];
  return ofertas[r.resultado?.escolha || 0] || null;
}

// PREÇO DIVERGENTE (regra do Leonardo, 23/09 — revista no mesmo dia, v3.84):
// Pix mais de 35% abaixo do cheio, OU oferta que avisa OCR/outlier, quer dizer que
// UM dos dois preços está errado — não diz qual. Casos reais: Duracell Pix 19,69 ×
// cheio 198,90 (o Pix era o erro); trena de bolso Pix 19,27 × cheio 716,90 (o
// cheio era o erro). Por isso a Cabine NÃO escolhe: oferta divergente não carrega
// custo nem venda sozinha. O card mostra os dois com "usar Pix" / "usar cheio".
// Espelho de `_preco_divergente` no backend — mudou um, mude o outro.
export const PIX_DIVERGENCIA_MAX = 0.35;
export function pixDaOferta(of) {
  // v3.83 (só naquela versão) anulava o Pix e guardava em preco_pix_descartado.
  const v = of?.preco_pix != null ? Number(of.preco_pix) : Number(of?.preco_pix_descartado);
  return v > 0 ? v : null;
}
export function precoDivergente(of) {
  if (!of) return false;
  if (of.preco_divergente || of.preco_pix_descartado != null) return true;
  const pix = pixDaOferta(of), cheio = Number(of.preco_cheio);
  if (!(pix > 0) || !(cheio > 0)) return false;
  if (pix < cheio * (1 - PIX_DIVERGENCIA_MAX)) return true;
  return /ocr|outlier/i.test(String(of.obs || ""));
}

// Custo da oferta: Pix quando houver, senão o cheio. Oferta divergente não tem
// custo automático (null) — quem escolhe é o operador.
export function custoDaOferta(of) {
  if (precoDivergente(of)) return null;
  const v = of?.preco_pix != null ? of.preco_pix : of?.preco_cheio;
  return v == null ? null : Number(v);
}

// O custo do item veio de uma oferta divergente e o operador ainda não confirmou?
// (custo igual ao Pix ou ao cheio dela, mesma loja/link). Aí nada automático toca
// nesse item — nem venda —, porque o número pode ser o errado.
export function custoAConfirmar(it, of) {
  if (!precoDivergente(of) || it?._preco_confirmado) return false;
  const c = Number(it?.preco_custo);
  if (!(c > 0)) return false;
  const link = (it?.link_fornecedor || "").trim();
  if (link && of?.link && link !== of.link) return false;
  return [pixDaOferta(of), Number(of?.preco_cheio)].some((v) => v > 0 && Math.abs(c - v) < 0.005);
}

// QUANDO o Dwight escreve no item (regra do Leonardo, 17/09):
//   · item sem origem  → escreve;
//   · item com origem MAIS CARA que a dele → escreve (troca por mais barato);
//   · item com origem e SEM custo para comparar → não escreve (aparece no card
//     como alternativa; sem número dos dois lados não existe "mais barato").
//   · oferta com preço divergente → nunca escreve sozinho (v3.84).
// Devolve 'vazio' | 'mais_barato' | 'nao' + a economia, para a tela explicar.
export function decidirEscrita(it, of) {
  const novo = custoDaOferta(of);
  if (novo == null || !(novo > 0)) return { escreve: false, motivo: precoDivergente(of) ? "divergente" : "nao" };
  const temOrigem = !!((it?.link_fornecedor || "").trim() || (it?.fornecedor || "").trim())
                    || Number(it?.preco_custo) > 0;
  if (!temOrigem) return { escreve: true, motivo: "vazio" };
  const atual = Number(it?.preco_custo);
  if (!(atual > 0)) return { escreve: false, motivo: "nao" };
  if (novo < atual) return { escreve: true, motivo: "mais_barato", economia: atual - novo };
  return { escreve: false, motivo: "nao" };
}

// Venda = custo × fator do markup mediano. Arredonda em centavos.
export function vendaPelaMediana(custo, fator) {
  const c = Number(custo), f = Number(fator);
  if (!(c > 0) || !(f > 0)) return null;
  return Math.round(c * f * 100) / 100;
}

// Item que ainda tem o que receber do Dwight: custo/origem (regra de escrita)
// OU venda em branco sobre um custo que já está lá (v3.83).
export function precisaCarregarDwight(it, of) {
  if (!of) return false;
  if (decidirEscrita(it, of).escreve) return true;
  if (custoAConfirmar(it, of)) return false;
  return !(Number(it?.preco_un) > 0) && Number(it?.preco_custo) > 0;
}

// Monta o plano de "carregar itens do Dwight" — SEM tocar em estado do React,
// para dar pra testar de verdade (não só compilar). Bug real corrigido aqui
// (18/09, Convergint): item que já tinha o MESMO custo do Dwight (aplicado
// antes por "usar esta") não entrava em `escrever`, e a venda ficava sem
// calcular junto mesmo havendo mediana pronta. `elegiveisVenda` é uma lista
// PRÓPRIA — venda entra sempre que estiver em branco e existir custo para
// multiplicar, de agora (oferta nova) ou de antes (custo que já estava lá).
export function planoCarregamentoDwight(itens, mapaPesquisa, markups, uidsFiltro) {
  const escrever = [], trocados = [], recusados = [], elegiveisVenda = [], divergentes = [];
  (itens || []).forEach((it, i) => {
    if (uidsFiltro && !uidsFiltro.includes(String(it.item_uid || "").toLowerCase())) return;
    const of = ofertaDwight(it, mapaPesquisa);
    let seraEscrito = false;
    if (of) {
      const d = decidirEscrita(it, of);
      if (d.escreve) {
        escrever.push([i, of]);
        seraEscrito = true;
        if (d.motivo === "mais_barato") trocados.push({ i, economia: d.economia });
      } else {
        recusados.push(i);
        if (d.motivo === "divergente") divergentes.push(i);
      }
    }
    // Custo que vai valer DEPOIS desta operação: o novo, se for escrito agora;
    // senão o que já está no item. Cobre os DOIS casos que já causaram bug:
    // item novo (custo chega agora, pela oferta) e item que já tinha o mesmo
    // custo de antes (não é reescrito, mas a venda ainda pode ser calculada).
    // Custo que veio de oferta divergente e não foi confirmado: sem venda automática.
    if (markups && !(Number(it.preco_un) > 0) && !(of && !seraEscrito && custoAConfirmar(it, of))) {
      const custoFinal = seraEscrito ? custoDaOferta(of) : Number(it.preco_custo);
      if (custoFinal > 0) elegiveisVenda.push(i);
    }
  });

  const vendas = new Map();
  const fontes = new Set();
  if (markups) {
    const mapaOfertas = new Map(escrever);
    elegiveisVenda.forEach((i) => {
      const it = itens[i];
      const mk = markups[String(it.item_uid || "").toLowerCase()];
      if (!mk?.fator) return;
      const of = mapaOfertas.get(i);
      const custoBase = of ? custoDaOferta(of) : Number(it.preco_custo);
      const v = vendaPelaMediana(custoBase, mk.fator);
      if (v != null) { vendas.set(i, v); if (mk.fonte) fontes.add(mk.fonte); }
    });
  }
  return { escrever, trocados, recusados, vendas, fontes, divergentes };
}

// Aplica a oferta: custo e origem. A VENDA não é tocada — a internet é custo,
// o preço de venda é decisão do operador.
export function aplicarOfertaDwight(it, of) {
  const preco = custoDaOferta(of);
  return {
    ...it,
    ...(preco != null ? { preco_custo: Number(preco) || 0 } : {}),
    ...(of?.link ? { link_fornecedor: of.link, fornecedor_canal: "link", fornecedor_contato: of.link } : {}),
    ...(of?.loja ? { fornecedor: of.loja } : {}),
    ...(of?.sku ? { sku_fornecedor: of.sku } : {}),
    origem_escolha: "internet",
    origem_internet: { fonte_url: of?.link || "", fonte_nome: of?.loja || "", apresentacao: of?.pn || "" },
    _alterado: true, _herdado: false,
  };
}

const CAMPOS_LASTRO = [
  "preco_un", "preco_custo", "frete_vinda",
  "fornecedor", "fornecedor_canal", "fornecedor_contato",
  "link_fornecedor", "sku_fornecedor",
];

// Espelho do _norm_entrada (backend) e do norm_entrada() (Postgres). Se mudar
// em um, mude nos três — senão a mesma descrição gera chaves diferentes.
function normEntrada(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function descNorm(it) {
  return normEntrada(it?.descricao_original || it?.descricao_final || "");
}

// Chave de identidade entre propostas. Preferência absoluta pelo código do
// cliente: é um identificador que ELE deu, não um que a gente inferiu. Sem
// código, cai para descrição idêntica — que ainda é igualdade, não semelhança.
function chaveItem(it) {
  const cod = (it?.codigo_cliente || "").trim().toUpperCase();
  if (cod) return "C:" + cod;
  const d = descNorm(it);
  return d ? "D:" + d : "";
}

function vazio(v) {
  if (typeof v === "number") return !(v > 0);
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return !v.trim();
  return !v;
}

function temAlgumLastro(it) {
  return CAMPOS_LASTRO.some((c) => !vazio(it[c]));
}

function propagarLastro(lista, idxOrigem) {
  const origem = lista[idxOrigem];
  if (!origem) return { lista, itens: 0, abas: 0, conflitos: [] };

  // Doadores: itens da aba que acabou de virar CSV. Chave repetida dentro da
  // MESMA aba com lastro divergente = ambígua. Não escolhemos por ela — copiar
  // o preço errado é pior que não copiar, e o operador não teria como perceber.
  const doadores = new Map();
  for (const it of (origem.itens || [])) {
    const k = chaveItem(it);
    if (!k || !temAlgumLastro(it)) continue;
    const ja = doadores.get(k);
    if (ja === undefined) { doadores.set(k, it); continue; }
    if (ja === "ambiguo") continue;
    const divergem = CAMPOS_LASTRO.some((c) => String(ja[c] ?? "") !== String(it[c] ?? ""));
    if (divergem) doadores.set(k, "ambiguo");
  }
  if (doadores.size === 0) return { lista, itens: 0, abas: 0, conflitos: [] };

  let nItens = 0;
  const abas = new Set();
  const conflitos = [];

  const nova = lista.map((p, pi) => {
    if (pi === idxOrigem) return p;
    let mudou = false;
    const itens = (p.itens || []).map((it) => {
      const k = chaveItem(it);
      if (!k) return it;
      const d = doadores.get(k);
      if (!d) return it;
      if (d === "ambiguo") {
        conflitos.push({ aba: pi, motivo: "ambiguo", chave: k,
          descricao: it.descricao_original || it.descricao_final || "" });
        return it;
      }
      // Código igual com descrição diferente não é o mesmo item — é sinal de
      // que alguma coisa está errada no pedido. Mostra, não preenche.
      if (descNorm(it) !== descNorm(d)) {
        conflitos.push({ aba: pi, motivo: "descricao", chave: k,
          descricao: it.descricao_original || it.descricao_final || "" });
        return it;
      }
      // Só preenche o que está VAZIO. O que o operador digitou é dele — o
      // sistema aprende com ele, nunca sobrescreve.
      const patch = {};
      for (const c of CAMPOS_LASTRO) {
        if (vazio(it[c]) && !vazio(d[c])) patch[c] = d[c];
      }
      if (Object.keys(patch).length === 0) return it;
      mudou = true; nItens += 1; abas.add(pi);
      return { ...it, ...patch, tem_preco: (patch.preco_un ?? it.preco_un) > 0,
               _alterado: true, _herdado: true };
    });
    return mudou ? { ...p, itens } : p;
  });

  return { lista: nova, itens: nItens, abas: abas.size, conflitos };
}


export default function App() {
  // Sessão persistida em localStorage (v3.85): vale em todas as abas e sobrevive
  // a refresh/deploy; token vencido é descartado. auto_select no Google reconecta silenciosamente
  // na maioria dos casos sem interação do usuário.
  const [propostaId, setPropostaId]     = useState(null);   // DB id após primeiro save
  const [salvando,   setSalvando]       = useState(false);  // indicator de auto-save
  const [ultimoSalvo, setUltimoSalvo]   = useState(null);   // timestamp do último save
  const autoSaveRef   = useRef(null);                        // timer debounce
  const modificadoRef = useRef(false);                       // flag: usuário editou algo

  const [token, setToken] = useState(() => {
    try {
      const cred = localStorage.getItem("kist_token");
      if (!cred) return null;
      const p = decodeJwtPayload(cred);
      if (p.exp * 1000 < Date.now()) { localStorage.removeItem("kist_token"); return null; }
      // Defesa em profundidade: token de e-mail não autorizado não restaura sessão.
      if (!emailAutorizado(p.email)) {
        localStorage.removeItem("kist_token"); localStorage.removeItem("kist_user"); return null;
      }
      return cred;
    } catch { return null; }
  });
  const [usuario, setUsuario] = useState(() => {
    try {
      const u = localStorage.getItem("kist_user");
      if (!u) return null;
      const parsed = JSON.parse(u);
      if (!emailAutorizado(parsed?.email)) { localStorage.removeItem("kist_user"); return null; }
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
  const [processandoMsg, setProcessandoMsg] = useState("");   // v3.68: andamento do job de extração
  const [salvandoBanco, setSalvandoBanco] = useState(false);
  const [erro, setErro] = useState("");
  // Avisos do backend quando a BUSCA FALHOU (≠ produto ausente no banco).
  // Cada um traz o número do chamado que o sistema abriu sozinho.
  const [avisosSistema, setAvisosSistema] = useState([]);
  // Notas do backend: decisão que o operador precisa saber, mas que NÃO é falha
  // (ex.: anexo descartado por repetir o corpo). Canal separado dos avisos de
  // propósito — nota informativa dentro de banner vermelho de erro faz o operador
  // parar de ler os dois.
  const [notasSistema, setNotasSistema] = useState([]);
  // Resumo da última propagação de lastro entre abas (gerou CSV de uma, as outras
  // herdaram). Some ao reiniciar.
  const [propagacao, setPropagacao] = useState(null);
  // Resultado do último envio ao Tiny. Leva `refs` (números da proposta enviada,
  // antes e depois de virar número do Tiny) e só aparece quando bate com a
  // proposta aberta — ver `tinyEnvio` derivado mais abaixo.
  const [tinyEnvioBruto, setTinyEnvio] = useState(null);
  const [guiaTiny, setGuiaTiny] = useState(null);   // regras de campo do Tiny (v3.75)
  const [motores, setMotores] = useState({});       // motores de pesquisa prontos (v3.79)
  const [conhecimentoItens, setConhecimentoItens] = useState({});   // v3.82: o que a Kist já sabe de cada item
  const [catalogoFicha, setCatalogoFicha] = useState(null);
  const [extratosAbertos, setExtratosAbertos] = useState(false);
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
  // v3.84: o auto-save lê o estado MAIS RECENTE por ref. O timer era criado no
  // mesmo clique que agenda a mudança (antes de o React aplicá-la), então gravava
  // o estado anterior à última edição — e ainda limpava o "modificado". Resultado
  // real (R-1375, 23/09): digitado 331,37, gravado 331,30, e o "Salvar rascunho"
  // não regravava. Todo último ajuste antes de uma pausa podia se perder.
  const propostasRef = useRef(propostas);
  propostasRef.current = propostas;
  const propostaIdxRef = useRef(propostaIdx);
  propostaIdxRef.current = propostaIdx;
  const modSeqRef = useRef(0);                               // conta edições
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
      try { localStorage.removeItem("kist_token"); localStorage.removeItem("kist_user"); } catch (e) {}
      setToken(null); setUsuario(null);
      setAuthErro(`Acesso negado para ${payload.email || "esta conta"}. Este sistema é restrito à equipe Kist.`);
      return;
    }
    setAuthErro("");
    const user = { nome: payload.name, email: payload.email, foto: payload.picture };
    setToken(credential);
    setUsuario(user);
    // Persistir para todas as abas (v3.85) — sobrevive a refresh/deploy do Render
    try {
      localStorage.setItem("kist_token", credential);
      localStorage.setItem("kist_user", JSON.stringify(user));
    } catch (e) {}
  }

  // Renovar o token ~5 min antes de vencer, sem interação do usuário.
  // v3.87 — agendado a partir de QUALQUER token ativo (efeito em [token]). Antes só
  // o login por clique agendava; quem voltava com o token guardado (refresh, aba
  // nova — mais comum desde a v3.85) passava da 1 h com a tela "logada" e toda
  // chamada dando 401.
  useEffect(() => {
    if (!token) return;
    let exp = 0;
    try { exp = decodeJwtPayload(token).exp * 1000; } catch { return; }
    const renovarEm = Math.max(exp - Date.now() - 5 * 60 * 1000, 5000);
    const t = setTimeout(() => {
      if (window.google && GOOGLE_CLIENT_ID) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID, callback: handleGoogleResponse,
          ux_mode: "popup", auto_select: true,
        });
        window.google.accounts.id.prompt(() => {});
      }
    }, renovarEm);
    return () => clearTimeout(t);
  }, [token]);

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
    try { localStorage.removeItem("kist_token"); localStorage.removeItem("kist_user"); } catch (e) {}
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

  // `relerDoZero`: escape do cache de leitura. A leitura do e-mail é reaproveitada
  // por 8h quando o conteúdo é idêntico (retentativa depois de erro, reload,
  // "deixa eu tentar de novo" — tudo isso deixa de ser pago). O único caso em que
  // reler o MESMO conteúdo faz sentido é leitura correta porém INCOMPLETA: o
  // modelo pulou um item. Aí o operador força.
  async function processar(relerDoZero = false) {
    if (!texto.trim() && arquivos.length === 0 && imagens.length === 0) {
      setErro("Arraste arquivos, cole o texto ou adicione prints."); return;
    }
    setErro(""); setLoading(true);
    try {
      const form = new FormData();
      form.append("numero_proposta", numeroProposta);
      form.append("so_rastreavel", soRastreavel ? "1" : "0");
      if (relerDoZero) form.append("ignorar_cache", "1");
      arquivos.forEach((f) => form.append("arquivos", f));
      if (texto) form.append("texto", texto);
      imagens.forEach((img) => form.append("imagens", img));

      let data;
      try {
        data = await _extrairAssincrono(form, authHeaders, (tentativa) => {
          setProcessandoMsg(tentativa <= 2 ? "Lendo o material…"
            : "Cruzando com o banco de preços… cotações grandes podem levar alguns minutos.");
        });
      } catch (fe) {
        if (String(fe.message || "").includes("Sessão expirada")) { setErro("Sessão expirada. Faça login novamente."); logout(); return; }
        throw fe;
      } finally { setProcessandoMsg(""); }
      // Falha do sistema != produto ausente no banco. Sem isto, o operador
      // precifica 20 itens na mão achando que o banco está pobre.
      setAvisosSistema(Array.isArray(data.avisos) ? data.avisos : []);
      // Notas: decisão do sistema que não é falha (anexo descartado por repetir o
      // corpo, e quais códigos ficaram de fora). Canal e visual separados do erro.
      setNotasSistema(Array.isArray(data.notas) ? data.notas : []);
      setPropagacao(null);
      // Normalizar: backend sempre retorna {propostas:[...]}, mas suportar legado {itens:[...]}
      const props = data.propostas || [data];
      setPropostas(props); setPropostaIdx(0); setDownloadados(new Set());
      if (props[0]?.proposta) setNumeroProposta(String(props[0].proposta));
      // v3.77: grava TODAS as abas agora. Antes só a aba aberta era salva, e uma
      // aba que o operador não abria se perdia (caso 1050917, 21/09).
      salvarTodas(props);
      modificadoRef.current = true;   // marca como modificado para o save funcionar
      setStep("resultado");
      // Reservar o número no banco imediatamente — impede outro operador de receber o mesmo número
      setTimeout(() => salvarRascunho(true), 100);
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); }
  }

  // ── Adicionar itens a uma proposta ABERTA ────────────────────────────────
  // Cliente pede pra incluir produtos num orçamento já montado. Reusa o MESMO
  // /extrair da tela de nova proposta (mesma leitura de e-mail/anexo/texto e o
  // mesmo matching com o banco) e ANEXA os itens no fim da lista — os itens que
  // já estavam, com preço e origem preenchidos, não são tocados.
  const [addAberto, setAddAberto] = useState(false);
  const [addTexto, setAddTexto] = useState("");
  const [addArquivos, setAddArquivos] = useState([]);
  const [addLoading, setAddLoading] = useState(false);
  const [addProgressoMsg, setAddProgressoMsg] = useState("");   // v3.68
  const [addErro, setAddErro] = useState("");
  const [addDrag, setAddDrag] = useState(false);

  async function adicionarItens() {
    if (!addTexto.trim() && addArquivos.length === 0) {
      setAddErro("Arraste o e-mail/anexo ou cole a lista de itens."); return;
    }
    setAddErro(""); setAddLoading(true);
    try {
      const form = new FormData();
      form.append("numero_proposta", numeroProposta || "");
      form.append("criar_rascunhos", "0");   // os itens entram NESTA proposta
      form.append("so_rastreavel", soRastreavel ? "1" : "0");
      addArquivos.forEach((f) => form.append("arquivos", f));
      if (addTexto) form.append("texto", addTexto);

      let data;
      try {
        data = await _extrairAssincrono(form, authHeaders, (tentativa) => {
          setAddProgressoMsg(tentativa <= 2 ? "Lendo o material…" : "Cruzando com o banco de preços…");
        });
      } catch (fe) {
        if (String(fe.message || "").includes("Sessão expirada")) { setAddErro("Sessão expirada. Faça login novamente."); return; }
        throw fe;
      } finally { setAddProgressoMsg(""); }
      // O /extrair pode separar em mais de uma proposta (por cliente). Aqui o
      // operador escolheu ADICIONAR a ESTA proposta: junta os itens de todas.
      const novos = (data.propostas || [data]).flatMap((p) => p.itens || []);
      if (novos.length === 0) { setAddErro("Nenhum item reconhecido no que você mandou."); return; }
      setPropostas((prev) => prev.map((p, pi) =>
        pi !== propostaIdx ? p : { ...p, itens: [...(p.itens || []), ...novos] }
      ));
      if (Array.isArray(data.avisos) && data.avisos.length) setAvisosSistema(data.avisos);
      if (Array.isArray(data.notas) && data.notas.length) setNotasSistema(data.notas);
      setAddTexto(""); setAddArquivos([]); setAddAberto(false);
      _dispararAutoSave();
    } catch (e) { setAddErro(e.message); }
    finally { setAddLoading(false); }
  }

  function atualizarItem(index, campo, valor) {
    // Mexeu num campo de lastro? Então o valor passou a ser dele, não mais herdado
    // da aba irmã — o selo sai. Selo que sobrevive à edição mente sobre a origem
    // do dado, e é justamente a origem que ele existe para informar.
    const saiHerdado = CAMPOS_LASTRO.includes(campo);
    setPropostas((prev) => prev.map((p, pi) =>
      pi !== propostaIdx ? p : { ...p, itens: p.itens.map((item, i) => i === index
        ? { ...item, [campo]: valor, _alterado: true, ...(saiHerdado ? { _herdado: false } : {}) }
        : item) }
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
    modSeqRef.current += 1;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => salvarRascunho(true), 1500);
  }

  async function salvarTodas(lista) {
    for (const p of (lista || [])) {
      if (!p?.proposta) continue;
      try {
        await fetch(`${API}/salvar-proposta`, {
          method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ ...p, status: "rascunho", usuario_nome: usuario?.nome || "" }),
        });
      } catch { /* o auto-save da aba aberta cobre; as outras ficam com o cabeçalho */ }
    }
  }

  async function salvarRascunho(silent = false) {
    if (!modificadoRef.current) return;
    const prop = propostasRef.current[propostaIdxRef.current];
    const seq = modSeqRef.current;           // edição que este save está levando
    if (!prop || !(prop.proposta || numeroProposta)) return;
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
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setUltimoSalvo(new Date());
      // Só limpa se ninguém editou enquanto o save ia e voltava; senão agenda outro.
      if (modSeqRef.current === seq) modificadoRef.current = false;
      else { if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
             autoSaveRef.current = setTimeout(() => salvarRascunho(true), 1500); }
    } catch (e) { /* auto-save silencioso; continua "modificado" para a próxima tentativa */ }
    finally { setSalvando(false); }
  }

  // ── Pesquisa pelo Dwight (v3.61) ──────────────────────────────────────────
  // Todo item ganha `item_uid` assim que entra na tela (extração, reabertura,
  // item novo). O resultado da pesquisa volta por ele.
  useEffect(() => {
    const falta = propostas.some((p) => (p?.itens || []).some((it) => it && typeof it === "object" && !it.item_uid));
    if (!falta) return;
    setPropostas((prev) => prev.map((p) => ({
      ...p,
      itens: (p?.itens || []).map((it) => (it && typeof it === "object" && !it.item_uid) ? { ...it, item_uid: novoUid() } : it),
    })));
  }, [propostas]);

  const [pesq, setPesq] = useState({ itens: {}, aguardando: 0 });
  const [pesqEnviando, setPesqEnviando] = useState(false);
  const [pesqMsg, setPesqMsg] = useState("");
  const [desfazer, setDesfazer] = useState(null);     // foto dos itens antes do carregamento
  // Preencher sozinho quando o resultado chega. Fica ligado por padrão e a
  // escolha é do operador, guardada no navegador dele.
  const [pesqAuto, setPesqAuto] = useState(() => {
    try { return localStorage.getItem("kist_dwight_auto") !== "0"; } catch { return true; }
  });
  function alternarAuto(v) {
    setPesqAuto(v);
    try { localStorage.setItem("kist_dwight_auto", v ? "1" : "0"); } catch { /* sem storage, vale a sessão */ }
  }
  const autoAplicadosRef = useRef(new Set());         // uid já aplicado automaticamente
  const numeroAtual = String(propostas[propostaIdx]?.proposta || numeroProposta || "").trim();
  // 25/09 (complemento da v3.103) — o resultado do Tiny só vale para a proposta que foi enviada. Antes
  // ficava na tela ao abrir OUTRA proposta pela lista (25/09: a R-1437 mostrou
  // "No Tiny: 1051042", que era da R-1434). Sem `refs` (reconexão do Tiny),
  // continua aparecendo como antes.
  const tinyEnvio = tinyEnvioBruto && (!tinyEnvioBruto.refs || tinyEnvioBruto.refs.includes(numeroAtual))
    ? tinyEnvioBruto : null;

  // v3.82: consulta o catálogo para os itens da proposta aberta (uma chamada só).
  const _chaveItensCtx = ((propostas[propostaIdx]?.itens) || [])
    .map((it, i) => `${it.item_uid || i}|${(it.descricao_original || it.descricao_final || "").slice(0, 80)}`).join("~");
  useEffect(() => {
    if (!token) return;
    const itens = ((propostas[propostaIdx]?.itens) || []).map((it, i) => ({
      k: String(it.item_uid || i), descricao: it.descricao_original || it.descricao_final || "" }));
    if (!itens.length) { setConhecimentoItens({}); return; }
    fetch(`${API}/catalogo/contexto`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ itens }) })
      .then((r) => (r.ok ? r.json() : {})).then((d) => setConhecimentoItens(d || {})).catch(() => {});
  }, [token, _chaveItensCtx]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/pesquisa/motores`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const m = {};
        ((d && d.motores) || []).forEach((x) => { m[x.motor] = x.configurado; });
        setMotores(m);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token || guiaTiny) return;
    fetch(`${API}/api/guia/exportacao-tiny?formato=json`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.campos)) return;
        const mapa = {};
        d.campos.forEach((c) => { mapa[c.campo] = c; });
        setGuiaTiny(mapa);
      })
      .catch(() => {});
  }, [token]);

  async function carregarPesquisa(numero) {
    if (!numero || !token) return;
    try {
      const r = await fetch(`${API}/propostas/${encodeURIComponent(numero)}/pesquisa-resultado`, { headers: authHeaders() });
      if (!r.ok) { setPesq({ itens: {}, aguardando: 0 }); return; }
      const d = await r.json();
      setPesq({ itens: d.itens || {}, aguardando: d.aguardando || 0, na_fila: d.na_fila || 0 });
    } catch { /* leitura silenciosa: a tela segue sem o card */ }
  }

  // Carrega ao trocar de proposta; enquanto houver item aguardando, consulta a
  // cada 20 s (leitura barata, sem IA). Para sozinho quando nada estiver pendente.
  useEffect(() => {
    setPesq({ itens: {}, aguardando: 0 });
    setPesqMsg("");
    if (step === "resultado" && numeroAtual) carregarPesquisa(numeroAtual);
  }, [numeroAtual, step]);

  useEffect(() => {
    if (!(pesq.aguardando > 0) || !numeroAtual) return;
    const t = setInterval(() => carregarPesquisa(numeroAtual), 20000);
    return () => clearInterval(t);
  }, [pesq.aguardando, numeroAtual]);

  const ofertaRecomendada = (it) => ofertaDwight(it, pesq.itens);

  // Carrega no item o que o Dwight achou, pela regra: item em branco, ou oferta
  // mais barata que o custo que está lá. Guarda o valor anterior para desfazer.
  function carregarDwight(uidsFiltro = null, markups = null) {
    const lista = (propostas[propostaIdx]?.itens) || [];
    const plano = planoCarregamentoDwight(lista, pesq.itens, markups, uidsFiltro);
    if (!plano.escrever.length && !plano.vendas.size) {
      setPesqMsg(plano.recusados.length
        ? "Nada a carregar: os itens pesquisados já têm origem igual ou mais barata."
        : "Nenhuma oferta do Dwight para carregar.");
      return 0;
    }
    // Desfazer guarda TODO item tocado: o que teve custo reescrito e o que só
    // ganhou venda (antes ficava de fora e o "desfazer" não voltava a venda).
    const tocados = new Set([...plano.escrever.map(([i]) => i), ...plano.vendas.keys()]);
    const antes = [...tocados].map((i) => ({ i, item: lista[i] }));
    const mapa = new Map(plano.escrever);
    setPropostas((prev) => prev.map((p, pi) => pi !== propostaIdx ? p : {
      ...p,
      itens: (p.itens || []).map((it, i) => {
        const of = mapa.get(i);
        if (!of && !plano.vendas.has(i)) return it;
        const novo = of ? aplicarOfertaDwight(it, of) : { ...it };
        if (plano.vendas.has(i)) novo.preco_un = plano.vendas.get(i);
        return novo;
      }),
    }));
    setDesfazer({ idx: propostaIdx, antes });
    _dispararAutoSave();
    const econ = plano.trocados.reduce((a, t) => a + (t.economia || 0), 0);
    const comVenda = plano.vendas.size;
    setPesqMsg(`Carregado em ${plano.escrever.length} ${plano.escrever.length === 1 ? "item" : "itens"}`
      + (plano.divergentes.length ? ` · ${plano.divergentes.length} com Pix e cheio divergentes — escolha no card` : "")
      + (plano.trocados.length ? ` · ${plano.trocados.length} ${plano.trocados.length === 1 ? "estava" : "estavam"} mais caro${plano.trocados.length === 1 ? "" : "s"} (economia ${brl(econ)})` : "")
      + (plano.recusados.length ? ` · ${plano.recusados.length} mantido${plano.recusados.length === 1 ? "" : "s"} como ${plano.recusados.length === 1 ? "estava" : "estavam"}` : "")
      + (markups
          ? ` · venda pela mediana em ${comVenda} ${comVenda === 1 ? "item" : "itens"}${plano.fontes.size ? ` (${[...plano.fontes].join(", ")})` : ""}`
          : ". Venda em branco."));
    return plano.escrever.length + comVenda;
  }

  // Markup mediano por item (este item com este cliente > este item > este
  // cliente > geral). Devolve o mapa por item_uid, ou lança erro.
  async function buscarMarkups(alvos) {
    const r = await fetch(`${API}/markup-itens`, {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        cnpj: propostas[propostaIdx]?.cnpj || "",
        itens: alvos.map((it) => ({
          k: String(it.item_uid || "").toLowerCase(),
          banco_id: it.banco_id || null,
          entrada: it.descricao_original || it.descricao_final || "",
        })),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    return d.itens || {};
  }

  // "carregar com venda": custo e origem do Dwight + venda pela mediana de lucro
  // praticada. Também serve para item que JÁ recebeu o custo do Dwight e ficou
  // com a venda em branco (antes da v3.83 o "preencher sozinho" não fazia venda).
  async function carregarDwightComVenda(uidsFiltro = null, silencioso = false) {
    const lista = (propostas[propostaIdx]?.itens) || [];
    const alvos = lista.filter((it) => {
      if (uidsFiltro && !uidsFiltro.includes(String(it.item_uid || "").toLowerCase())) return false;
      return precisaCarregarDwight(it, ofertaRecomendada(it));
    });
    if (!alvos.length) { if (!silencioso) setPesqMsg("Nenhuma oferta do Dwight para carregar."); return; }
    setPesqEnviando(true);
    try {
      const markups = await buscarMarkups(alvos);
      carregarDwight(uidsFiltro, markups);
    } catch (e) {
      // Automático: sem markup, o custo e a origem entram mesmo assim (venda em branco).
      if (silencioso) carregarDwight(uidsFiltro, null);
      else setPesqMsg(`Carreguei nada: não consegui o markup (${e.message}).`);
    } finally { setPesqEnviando(false); }
  }

  function desfazerDwight() {
    if (!desfazer) return;
    const { idx, antes } = desfazer;
    const mapa = new Map(antes.map(({ i, item }) => [i, item]));
    setPropostas((prev) => prev.map((p, pi) => pi !== idx ? p : {
      ...p, itens: (p.itens || []).map((it, i) => mapa.has(i) ? mapa.get(i) : it),
    }));
    setDesfazer(null);
    _dispararAutoSave();
    setPesqMsg("Desfeito — os itens voltaram ao que estavam.");
  }

  // Chegou resultado novo e o automático está ligado? Carrega. Cada item é
  // aplicado UMA vez: se o operador desfizer ou mexer, não volta a ser escrito.
  useEffect(() => {
    if (!pesqAuto) return;
    const lista = (propostas[propostaIdx]?.itens) || [];
    const novos = lista
      .filter((it) => {
        const uid = String(it.item_uid || "").toLowerCase();
        if (!uid || autoAplicadosRef.current.has(uid)) return false;
        return precisaCarregarDwight(it, ofertaDwight(it, pesq.itens));
      })
      .map((it) => String(it.item_uid).toLowerCase());
    if (!novos.length) return;
    novos.forEach((u) => autoAplicadosRef.current.add(u));
    // v3.83: o automático também preenche a VENDA (custo × mediana), igual ao
    // "carregar com venda". Falhou o markup? custo e origem entram, venda em branco.
    carregarDwightComVenda(novos, true);
  }, [pesq.itens, pesqAuto, propostaIdx]);

  // Padrão "kistbot": o motor Dwight normal está desativado (25/09) — quem
  // não escolher motor explicitamente cai no que está ativo.
  async function pesquisarComDwight(forcar = false, itemUids = null, motor = "kistbot") {
    if (!numeroAtual || pesqEnviando) return;
    setPesqEnviando(true); setPesqMsg("");
    try {
      // Grava antes: o backend lê os itens do banco, e é lá que está o item_uid.
      modificadoRef.current = true;
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
      await salvarRascunho(true);
      const rota = motor === "kistbot" ? "pesquisa-kistbot-dwight" : "pesquisa-dwight";
      const r = await fetch(`${API}/propostas/${encodeURIComponent(numeroAtual)}/${rota}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...(forcar ? { forcar: true } : {}),
                               ...(itemUids ? { item_uids: itemUids } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setPesqMsg(resumoDisparoDwight(d));
      await carregarPesquisa(numeroAtual);
    } catch (e) {
      setPesqMsg(`Não consegui enviar (${e.message}).`);
    } finally { setPesqEnviando(false); }
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
        codigo_cliente:       it.codigo_cliente || "",
        specs_complementares: it.specs_complementares || "",
        quantidade:           Number(it.quantidade) || 1,
        unidade:              it.unidade || "UN",
        preco_un:             Number(it.preco_venda) || 0,
        preco_custo:          Number(it.preco_custo) || 0,
        frete_vinda:          Number(it.frete_vinda) || 0,
        confianca_match:      it.confianca_match || "nenhuma",
        // ── SNAPSHOT DO MATCH ────────────────────────────────────────────────
        // A ficha do banco, o vínculo com a linha (banco_id) e o `identico` são
        // FOTO da geração, gravados no save. Aqui a gente só lê de volta: o match
        // NÃO roda de novo ao reabrir um rascunho. Sem isto, o operador via o selo
        // EXATO na linha e "Sem item correspondente no banco" na gaveta — e o
        // banco_id perdido fazia o CSV do rascunho reaberto criar linha gêmea
        // em `produtos` (o mecanismo da duplicata do W50).
        banco:                it.banco_ficha || null,
        banco_id:             it.banco_id || null,
        identico:             typeof it.identico === "boolean" ? it.identico : undefined,
        // id da linha e datasheet vinculado: SAO persistidos, e sem trazer de
        // volta o selo morre no reload e o operador regera o mesmo documento.
        id:                   it.id || null,
        item_uid:             it.item_uid || null,
        // Os dois documentos irmãos. São persistidos; sem trazer de volta,
        // os selos morrem no reload e o operador regera o que já aprovou.
        datasheet_id:         it.datasheet_id || null,
        apresentacao_id:      it.apresentacao_id || null,
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
        frete_ida:     Number(prop.frete_ida) || 0,
        prazo_entrega: prop.prazo_entrega || "",
        condicao_pagamento: prop.condicao_pagamento || "",
        outros_itens: prop.outros_itens || "",
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
      // Gerar CSV é o mantra: alimenta o banco, salva a proposta e AGORA também
      // propaga preço e lastro para as abas irmãs do mesmo pedido. Roda depois do
      // arquivo sair — se o CSV falhar, nada se espalha.
      if (propostas.length > 1) {
        const r = propagarLastro(propostas, idx);
        if (r.itens > 0) setPropostas(r.lista);
        if (r.itens > 0 || r.conflitos.length > 0) {
          setPropagacao({ itens: r.itens, abas: r.abas, conflitos: r.conflitos });
        }
      }
      // Marcar proposta como baixada; só avança para download quando todas forem baixadas
      setDownloadados((prev) => {
        const next = new Set(prev); next.add(idx);
        if (next.size >= propostas.length) setStep("download");
        return next;
      });
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); setSalvandoBanco(false); }
  }

  // ── Exportar direto para o Tiny (v3.45) ─────────────────────────────────
  // Vai como ORÇAMENTO (proposta comercial), não como pedido: a venda só existe
  // quando o cliente aprova e devolve a PO — e o Tiny converte orçamento em
  // pedido nesse momento. O CSV continua existindo como caminho alternativo.
  // v3.72: PRIMEIRO a prévia (modelada pelo contrato oficial do Tiny, sem
  // escrever nada lá), DEPOIS a confirmação, e só então o envio. O que a
  // prévia mostra é exatamente o que sai — as duas rotas usam a mesma modelagem.
  async function exportarTiny(idx) {
    const prop = propostas[idx];
    if (!prop) return;
    const corpo = JSON.stringify({ ...prop, usuario_nome: usuario.nome });
    const cab = { "Content-Type": "application/json", ...authHeaders() };
    const refs = [String(prop.proposta || "").trim()];
    setTinyEnvio({ estado: "enviando", refs });
    try {
      const rp = await fetch(`${API}/propostas/exportar-tiny/previa`, { method: "POST", headers: cab, body: corpo });
      const pv = await rp.json().catch(() => ({}));
      if (!rp.ok) throw new Error(pv.detail || `erro ${rp.status} na prévia`);
      if (!pv.pronto) {
        setTinyEnvio({ estado: "erro", refs, msg: "Não enviei ao Tiny: " + (pv.erros || []).join(" · ") });
        return;
      }
      if (!window.confirm(mensagemPreviaTiny(pv))) { setTinyEnvio(null); return; }

      const res = await fetch(`${API}/propostas/exportar-tiny`, { method: "POST", headers: cab, body: corpo });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || `erro ${res.status}`);
      // v3.77: a proposta passa a se chamar pelo número do Tiny.
      if (d.numero_final && d.numero_final !== prop.proposta) {
        setPropostas((prev) => prev.map((p, pi) => pi === idx ? { ...p, proposta: d.numero_final } : p));
        if (idx === propostaIdx) setNumeroProposta(String(d.numero_final));
      }
      setTinyEnvio({ estado: "ok", ...d, refs: [...refs, String(d.numero_final || "").trim()].filter(Boolean) });
    } catch (e) {
      setTinyEnvio({ estado: "erro", refs, msg: String(e.message || e) });
    }
  }

  // Reconectar o Tiny (v3.73): /tiny/autorizar exige o login da Cabine, então
  // abrir o endereço direto no navegador não funciona. A tela pede o link com o
  // token do operador e abre o Tiny numa aba nova; aprovado lá, o Tiny volta
  // sozinho para /tiny/callback e a conexão volta a se renovar sozinha.
  async function reconectarTiny() {
    const aba = window.open("", "_blank");
    try {
      const r = await fetch(`${API}/tiny/autorizar`, { headers: authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.detail || `erro ${r.status}`);
      if (aba) aba.location.href = d.url; else window.location.href = d.url;
      setTinyEnvio({ estado: "erro", msg: "Aprove a Kist na aba do Tiny que abriu (vale 15 minutos) e depois exporte de novo." });
    } catch (e) {
      if (aba) aba.close();
      setTinyEnvio({ estado: "erro", msg: `Não consegui gerar o link do Tiny (${e.message}).` });
    }
  }

  function reiniciar() {
    setTinyEnvio(null);
    setAvisosSistema([]);
    setNotasSistema([]);
    setPropagacao(null);
    setStep("input"); setPropostas([]); setPropostaIdx(0); setDownloadados(new Set()); setBancoInfo(null);
    setTexto(""); setArquivos([]); setImagens([]); setNumeroProposta(""); setErro("");
    setPropostaId(null); setSalvando(false); setUltimoSalvo(null);
    modificadoRef.current = false;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
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
      <>
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
        <VersaoBadge />
      </>
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
        ) : pagina === "catalogo" ? (
          <Catalogo token={token} apiUrl={API} fichaInicial={catalogoFicha} />
        ) : pagina === "requisicoes" ? (
          <Analista token={token} usuario={usuario} onAlertasChange={carregarAlertas} />
        ) : pagina === "agentes" ? (
          <Agentes token={token} usuario={usuario} isAdmin={isAdmin} />
        ) : pagina === "chamados" && isAdmin ? (
          <ChamadosAdmin token={token} usuario={usuario} />
        ) : (
          <div className="mx-auto max-w-6xl px-8 py-9">

            {/* INPUT */}
            {step === "input" && (
              <div className="mx-auto max-w-2xl rise">
                <PageHeader eyebrow="Etapa 1 de 3 · Entrada" title="Nova proposta"
                  sub="Arraste o .msg do Outlook, cole prints com Ctrl+V ou cole o texto do e-mail." />

                <div className="mt-7 space-y-5 rounded-2xl border border-line bg-surface p-6">
                  {/* v3.77: não se digita mais número. Cada proposta gerada vira um
                      rascunho com número próprio (R-xxxx) e, ao exportar, passa a
                      usar o número que o Tiny devolver — o mesmo nos dois sistemas. */}
                  <div className="rounded-lg border border-line bg-paper px-3 py-2 text-[12px] text-sub">
                    O número é automático: cada proposta nasce como rascunho <span className="font-mono">R-xxxx</span> e,
                    ao exportar para o Tiny, passa a usar o número do Tiny.
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
                      ? <><span className="inline-block animate-spin"><IconBolt size={15} /></span> {processandoMsg || "Extraindo e cruzando com o banco…"}</>
                      : <>Processar e-mail <IconArrow size={15} /></>}
                  </button>
                  {loading && (
                    <div className="text-center text-[11px] text-faint">
                      Cotações grandes podem levar alguns minutos — pode deixar a aba aberta e esperar.
                    </div>
                  )}
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
                    {/* v3.85 — o topo leva só as ações DA PROPOSTA; pesquisa e documentos
                        foram para a barra de ferramentas abaixo da triagem. */}
                    <button onClick={reiniciar} className="px-1.5 text-[12.5px] text-faint hover:text-ink"
                      title="Descarta a tela atual e volta para a entrada (o rascunho salvo continua em Propostas)">
                      Recomeçar
                    </button>
                    {/* Indicador de auto-save */}
                    {salvando && <span className="text-[11.5px] text-faint animate-pulse">Salvando…</span>}
                    {!salvando && ultimoSalvo && <span className="text-[11.5px] text-faint">✓ Salvo {ultimoSalvo.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>}
                    <button onClick={() => salvarRascunho(false)} disabled={salvando}
                      className={`${btnGhost} ${salvando ? "opacity-50" : ""}`}
                      title="Salvar como rascunho para continuar depois">
                      Salvar rascunho
                    </button>
                    <button
                      onClick={() => exportarTiny(propostaIdx)}
                      disabled={loading || salvandoBanco || tinyEnvio?.estado === "enviando"}
                      className={btnGhost}
                      title="Cria a proposta comercial direto no Tiny, sem passar por arquivo">
                      {tinyEnvio?.estado === "enviando"
                        ? <><span className="inline-block animate-spin"><IconBolt size={15} /></span> Enviando…</>
                        : tinyEnvio?.estado === "ok"
                        ? <><IconCheck size={15} /> No Tiny: {tinyEnvio.tiny_numero || tinyEnvio.tiny_id}</>
                        : <><IconLink size={15} /> Exportar para o Tiny</>}
                    </button>
                    <button onClick={() => baixarCSV(propostaIdx)} disabled={loading || salvandoBanco || jaBaixado} className={btnPrimary}>
                      {salvandoBanco
                        ? <><span className="inline-block animate-spin"><IconBolt size={15} /></span> Salvando…</>
                        : jaBaixado ? <><IconCheck size={15} /> CSV baixado</>
                        : loading ? "Gerando…"
                        : <><IconDownload size={15} /> Confirmar e baixar CSV{propostas.length > 1 ? ` — Proposta ${propostaIdx + 1}` : ""}</>}
                    </button>
                  </>} />

                {tinyEnvio?.estado === "ok" && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-[12.5px] text-ink">
                    <span>
                      Proposta comercial {tinyEnvio.acao === "atualizado" ? "atualizada" : "criada"} no Tiny para{" "}
                      {tinyEnvio.cliente_tiny || "o cliente"} — número{" "}
                      <span className="font-mono">{tinyEnvio.tiny_numero || tinyEnvio.tiny_id}</span>,{" "}
                      {tinyEnvio.itens} {tinyEnvio.itens === 1 ? "item" : "itens"}.
                      {tinyEnvio.banco && !tinyEnvio.banco.erro && (
                        <> Banco de preços: {tinyEnvio.banco.atualizados || 0} atualizados,{" "}
                        {tinyEnvio.banco.inseridos || 0} novos.</>
                      )}
                      {tinyEnvio.contato_criado && (
                        <> Cliente <b>cadastrado agora</b> no Tiny: {tinyEnvio.contato_criado.nome}.</>
                      )}
                      {(tinyEnvio.produtos || []).some((p) => p.acao === "cadastrado") && (
                        <> {(tinyEnvio.produtos || []).filter((p) => p.acao === "cadastrado").length} produto(s) novo(s) no catálogo.</>
                      )}
                      {" "}Revise antes de enviar ao cliente.
                      {(tinyEnvio.avisos || []).length > 0 && (
                        <span className="mt-1 block text-[11.5px] text-sub">
                          {tinyEnvio.avisos.map((a, k) => <span key={k} className="block">• {a}</span>)}
                        </span>
                      )}
                    </span>
                    {tinyEnvio.tiny_id && (
                      /* O PDF é gerado PELO Tiny: documento comercial da Kist sai
                         do ERP, com numeração e layout oficiais. A API v3 não expõe
                         rota de impressão para orçamento, então abrimos o registro
                         — de lá, imprimir ou compartilhar é um clique. */
                      <a href={`https://erp.olist.com/orcamentos#edit/${tinyEnvio.tiny_id}`}
                         target="_blank" rel="noopener noreferrer"
                         className={`${btnGhost} flex-shrink-0 whitespace-nowrap`}>
                        <IconLink size={14} /> Abrir no Tiny (imprimir / PDF)
                      </a>
                    )}
                  </div>
                )}
                {tinyEnvio?.estado === "erro" && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-[12.5px] text-rose">
                    <span>{tinyEnvio.msg}</span>
                    {precisaReconectarTiny(tinyEnvio.msg) && (
                      <button onClick={reconectarTiny} className={`${btnGhost} flex-shrink-0 whitespace-nowrap`}>
                        <IconLink size={14} /> Reconectar o Tiny
                      </button>
                    )}
                  </div>
                )}

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

                {/* NOTAS — decisão do sistema que não é falha. Visual âmbar, distinto
                    do vermelho de erro: o operador precisa conseguir diferenciar num
                    relance "o sistema quebrou" de "o sistema decidiu, confere aí". */}
                {notasSistema.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {notasSistema.map((nt, i) => (
                      <div key={i} className="rounded-xl border border-amber/40 bg-amberbg px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-amber text-[10px] font-bold text-white">i</span>
                          <div className="min-w-0 flex-1">
                            {/* O título era FIXO em "Anexo repetido" — nota de imagem
                                cortada ou de leitura reaproveitada saía com rótulo de
                                outra coisa. Agora cada tipo diz o que é. */}
                            <div className="text-[13px] font-semibold text-amber">
                              {nt.tipo === "leitura_reaproveitada" ? "Leitura reaproveitada — não paguei de novo"
                                : nt.tipo === "imagens_cortadas"   ? "Nem todas as imagens couberam"
                                : nt.tipo === "itens_somados"      ? "Linhas repetidas — somei as quantidades"
                                : nt.tipo === "imagem_recuperada"  ? "Imagem corrompida no e-mail — li o que abriu"
                                : nt.tipo === "imagem_ilegivel"    ? "Imagem que não abriu ficou de fora"
                                : nt.tipo === "anexo_redundante"   ? "Anexo repetido — usei o corpo do e-mail"
                                : nt.tipo === "pdf_visual"         ? "PDF digitalizado — lido pela imagem, confira"
                                : nt.tipo === "pdf_visual_cortado" ? "PDF digitalizado ficou de fora"
                                : nt.tipo === "uma_por_arquivo"    ? "Regra do cliente — uma proposta por arquivo"
                                : "Aviso da leitura"}
                            </div>
                            <div className="mt-0.5 text-[12.5px] leading-relaxed text-sub">{nt.mensagem}</div>
                            {nt.tipo === "leitura_reaproveitada" && (
                              <button onClick={() => { setNotasSistema([]); processar(true); }}
                                className="mt-1.5 rounded-md border border-amber/60 px-2 py-0.5 text-[11px] font-medium text-amber hover:bg-white/50">
                                ler o e-mail de novo, do zero
                              </button>
                            )}
                          </div>
                          <button onClick={() => setNotasSistema((p) => p.filter((_, j) => j !== i))}
                            title="Dispensar" className="rounded p-0.5 text-amber/60 hover:bg-white/40 hover:text-amber">
                            <IconX size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* PROPAGAÇÃO — o que a geração do CSV copiou para as abas irmãs.
                    Precisa aparecer: o operador acabou de ver 3 abas se preencherem
                    sozinhas e tem que saber o que foi, para conferir antes do CSV delas. */}
                {propagacao && (
                  <div className="mt-4 rounded-xl border border-signal/40 bg-signalbg px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-signal text-white">
                        <IconCheck size={11} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {propagacao.itens > 0 ? (
                          <>
                            <div className="text-[13px] font-semibold text-signal">
                              Preço e origem copiados para {propagacao.itens} {propagacao.itens === 1 ? "item" : "itens"}
                              {propagacao.abas > 0 && ` em ${propagacao.abas} ${propagacao.abas === 1 ? "outra aba" : "outras abas"}`}
                            </div>
                            <div className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
                              São os mesmos itens deste pedido, em outro destino. Vieram marcados como
                              <span className="mx-1 rounded bg-signal/15 px-1 py-0.5 font-mono text-[10.5px] text-signal">herdado</span>
                              nas abas — confira antes de gerar o CSV de cada uma.
                            </div>
                          </>
                        ) : (
                          <div className="text-[13px] font-semibold text-signal">Nada foi copiado para as outras abas</div>
                        )}
                        {propagacao.conflitos?.length > 0 && (
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-[12px] text-sub hover:text-ink">
                              {propagacao.conflitos.length} {propagacao.conflitos.length === 1 ? "item ficou" : "itens ficaram"} de fora — ver por quê
                            </summary>
                            <div className="mt-1.5 space-y-1">
                              {propagacao.conflitos.slice(0, 12).map((c, i) => (
                                <div key={i} className="rounded bg-surface/70 px-2 py-1 text-[11.5px] text-sub">
                                  <span className="font-mono text-faint">Proposta {c.aba + 1}</span>{" · "}
                                  {c.motivo === "descricao"
                                    ? "mesmo código do cliente, mas descrição diferente — não preenchi"
                                    : "o código aparece mais de uma vez com origens diferentes — não dava pra escolher"}
                                  <div className="mt-0.5 truncate text-[11px] text-faint">{c.descricao}</div>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                      <button onClick={() => setPropagacao(null)}
                        title="Dispensar" className="rounded p-0.5 text-signal/60 hover:bg-white/40 hover:text-signal">
                        <IconX size={14} />
                      </button>
                    </div>
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

                {/* v3.85 — BARRA DE FERRAMENTAS: dois grupos com rótulo. Pesquisa de preço
                    (Dwight: só itens sem match ou com match incerto) e Documentos (antes no
                    topo, onde empilhavam 8 botões). Andamento e mensagens em linha própria. */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="eyebrow mr-1 text-[9.5px] font-semibold uppercase text-faint">Pesquisa de preço</span>
                    {/* Motor "Dwight" normal desativado por decisão do Leonardo, 25/09 — só
                        o KistBot Dwight fica ativo na Cabine. Não removido: some sozinho
                        quando DWIGHT_MOTOR_ATIVO=1 voltar a configurar url/key no Render
                        (mesmo padrão do botão do KistBot logo abaixo). */}
                    <button onClick={() => pesquisarComDwight(false)}
                      disabled={pesqEnviando || !numeroAtual || motores.dwight === false}
                      title={motores.dwight === false
                        ? "Motor Dwight desativado por enquanto — use o KistBot Dwight"
                        : "Pesquisar com o Dwight"}
                      className={btnToolKist}>
                      {pesqEnviando ? "Enviando…" : "🔎 Dwight"}{motores.dwight === false ? " (desativado)" : ""}
                    </button>
                    {/* v3.78: segundo motor, mesmas regras (fila, cache, retorno na gaveta). */}
                    <button onClick={() => pesquisarComDwight(false, null, "kistbot")}
                      disabled={pesqEnviando || !numeroAtual || motores.kistbot === false}
                      title={motores.kistbot === false
                        ? "KistBot Dwight aguardando o túnel público (URL vazia no Render)"
                        : "Pesquisar com o KistBot Dwight — fila própria, mesmas regras do Dwight"}
                      className={btnToolKist}>
                      🔎 KistBot Dwight{motores.kistbot === false ? " (aguardando túnel)" : ""}
                    </button>
                    {/* v3.82: o relatório da pesquisa — processo, julgamentos e pontos a validar. */}
                    <button onClick={() => setExtratosAbertos(true)} disabled={!numeroAtual}
                      className={btnTool}>
                      📋 extrato
                    </button>
                    {extratosAbertos && numeroAtual && (
                      <ExtratosPropostaModal token={token} apiUrl={API} numero={numeroAtual} onClose={() => setExtratosAbertos(false)} />
                    )}
                    {(() => {
                      const n = (prop.itens || []).filter((it) => {
                        const of = ofertaRecomendada(it);
                        return of && decidirEscrita(it, of).escreve;
                      }).length;
                      if (!n) return null;
                      return (
                        <button onClick={() => carregarDwight()}
                          className={btnTool}
                          title="Carrega custo e origem: item em branco, ou oferta mais barata que a que está lá">
                          carregar itens do Dwight ({n})
                        </button>
                      );
                    })()}
                    {(() => {
                      const n = (prop.itens || []).filter((it) =>
                        precisaCarregarDwight(it, ofertaRecomendada(it))).length;
                      if (!n) return null;
                      return (
                        <button onClick={() => carregarDwightComVenda()} disabled={pesqEnviando}
                          className={btnTool}
                          title="Carrega custo e origem e preenche a venda com a mediana de lucro praticada (este item com este cliente, depois este item, depois este cliente)">
                          carregar com venda ({n})
                        </button>
                      );
                    })()}
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-faint" title="Carrega sozinho quando o resultado chega">
                      <input type="checkbox" checked={pesqAuto} onChange={(e) => alternarAuto(e.target.checked)} />
                      preencher sozinho
                    </label>
                    {desfazer && (
                      <button onClick={desfazerDwight} className="text-[11.5px] text-kist hover:underline">desfazer</button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="eyebrow mr-1 text-[9.5px] font-semibold uppercase text-faint">Documentos</span>
                    <DatasheetLote itens={prop.itens || []} token={token} apiUrl={API}
                      fonteTexto={prop.fonte_texto} onChange={atualizarItem}
                      propostaId={propostaId} onSalvar={salvarRascunho} modo="tecnico" />
                    <DatasheetLote itens={prop.itens || []} token={token} apiUrl={API}
                      fonteTexto={prop.fonte_texto} onChange={atualizarItem}
                      propostaId={propostaId} onSalvar={salvarRascunho} modo="comercial" />
                    <DatasheetBaixarTodos itens={prop.itens || []} token={token} apiUrl={API}
                      modo="tecnico" nomeProposta={prop.proposta || numeroProposta} />
                    <DatasheetBaixarTodos itens={prop.itens || []} token={token} apiUrl={API}
                      modo="comercial" nomeProposta={prop.proposta || numeroProposta} />
                  </div>
                </div>
                {(pesq.aguardando > 0 || pesqMsg) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 px-1 text-[11.5px]">
                    {pesq.aguardando > 0 && (
                      <span className="text-sub">
                        {pesq.aguardando} {pesq.aguardando === 1 ? "item aguardando" : "itens aguardando"} pesquisa
                        {pesq.na_fila > 0 && ` (${pesq.na_fila} na fila)`}
                      </span>
                    )}
                    {pesqMsg && <span className="text-faint">{pesqMsg}</span>}
                  </div>
                )}

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
                      <DicaTiny guia={guiaTiny} campo="cnpj" />
                    </label>
                    <label className="block">
                      <div className="text-[11.5px] text-sub">Prazo de entrega</div>
                      <input value={prop.prazo_entrega || ""}
                        onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, prazo_entrega: e.target.value } : p)); _dispararAutoSave(); }}
                        placeholder="ex: 15 dias úteis"
                        className="mt-1 w-full rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />
                      <DicaTiny guia={guiaTiny} campo="prazo_entrega" />
                    </label>
                    <label className="block sm:col-span-2">
                      {/* "Outros itens ou serviços" do orçamento: vai em
                          extras.descricao no Tiny, que guarda como HTML.
                          Serve para o que não é item de linha — condição de
                          frete, escopo de serviço, observação técnica. */}
                      <div className="text-[11.5px] text-sub">Outros itens ou serviços</div>
                      <textarea value={prop.outros_itens || ""} rows={2}
                        onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, outros_itens: e.target.value } : p)); _dispararAutoSave(); }}
                        placeholder="ex: Frete CIF · Instalação não inclusa · Garantia 12 meses"
                        className="mt-1 w-full resize-y rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />
                      <DicaTiny guia={guiaTiny} campo="outros_itens" />
                    </label>
                    <label className="block">
                      {/* Condição de pagamento: vai para o campo `condicoesComerciais`
                          do Tiny, que deriva as parcelas sozinho a partir deste texto. */}
                      <div className="text-[11.5px] text-sub">Condição de pagamento</div>
                      <input value={prop.condicao_pagamento || ""}
                        onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, condicao_pagamento: e.target.value } : p)); _dispararAutoSave(); }}
                        placeholder="ex: 30  ·  30 dias  ·  30/60/90  ·  3x"
                        title="30 ou 30 dias = 1 parcela em 30 dias | 30/60/90 = 3 vencimentos | 3x = 3 parcelas | 30+2x = entrada em 30 dias + 2 parcelas | qualquer outro texto vai como texto livre"
                        className="mt-1 w-full rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />
                      <DicaTiny guia={guiaTiny} campo="condicao_pagamento" />
                    </label>
                    <label className="block">
                      <div className="text-[11.5px] text-sub">Frete (R$)</div>
                      <input inputMode="decimal" value={prop.frete ?? ""}
                        onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, frete: e.target.value } : p)); _dispararAutoSave(); }}
                        placeholder="0,00"
                        className="mt-1 w-full rounded-lg border border-line2 bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />
                      <DicaTiny guia={guiaTiny} campo="frete" />
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
                        <ItemRow key={i} item={item} index={i} onChange={atualizarItem} onRemove={removerItem} token={token} apiUrl={API} fonteTexto={prop.fonte_texto} cnpj={prop.cnpj} propostaId={propostaId} onSalvar={salvarRascunho}
                          dwight={item?.item_uid ? pesq.itens[String(item.item_uid).toLowerCase()] : null}
                          onPesquisarItem={item?.item_uid
                            // Motor Dwight normal desativado (25/09) — pesquisa por item
                            // individual usa o KistBot Dwight, igual ao botão da barra.
                            ? () => pesquisarComDwight(true, [String(item.item_uid).toLowerCase()], "kistbot")
                            : null}
                          conhecimento={conhecimentoItens[String(item?.item_uid || i)]}
                          onAbrirFicha={(fid) => { setCatalogoFicha(fid); setPagina("catalogo"); }} />
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

                {/* ── Adicionar itens à proposta ABERTA ─────────────────────────
                    O cliente pede pra incluir produtos num orçamento já montado.
                    Mesma entrada da tela de nova proposta (e-mail/anexo ou lista
                    colada); os itens entram no fim, sem tocar nos já preenchidos. */}
                <div className="mt-3 rounded-xl border border-line bg-white">
                  {!addAberto ? (
                    <button onClick={() => { setAddAberto(true); setAddErro(""); }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-kist hover:bg-paper/60">
                      + adicionar itens a esta proposta
                      <span className="text-[11.5px] font-normal text-faint">— arraste o e-mail do cliente ou cole a lista</span>
                    </button>
                  ) : (
                    <div className="p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="eyebrow text-[10px] font-bold uppercase text-faint">Adicionar itens</div>
                        <button onClick={() => { setAddAberto(false); setAddErro(""); }}
                          className="text-[11px] text-faint hover:text-sub">fechar</button>
                      </div>

                      <div
                        onDragOver={(e) => { e.preventDefault(); setAddDrag(true); }}
                        onDragLeave={() => setAddDrag(false)}
                        onDrop={(e) => {
                          e.preventDefault(); setAddDrag(false);
                          const fs = Array.from(e.dataTransfer.files || []);
                          if (fs.length) setAddArquivos((prev) => {
                            const nomes = new Set(prev.map((x) => x.name));
                            return [...prev, ...fs.filter((f) => !nomes.has(f.name))];
                          });
                        }}
                        className={`rounded-lg border-2 border-dashed px-3 py-4 text-center text-[12px] transition
                          ${addDrag ? "border-kist bg-kist/5 text-kist" : "border-line2 text-faint"}`}>
                        Arraste aqui o e-mail (.msg), PDF, planilha ou imagem
                        <label className="ml-1 cursor-pointer text-kist underline">
                          ou escolha um arquivo
                          <input type="file" multiple className="hidden"
                            onChange={(e) => {
                              const fs = Array.from(e.target.files || []);
                              setAddArquivos((prev) => {
                                const nomes = new Set(prev.map((x) => x.name));
                                return [...prev, ...fs.filter((f) => !nomes.has(f.name))];
                              });
                              e.target.value = "";
                            }} />
                        </label>
                      </div>

                      {addArquivos.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {addArquivos.map((f, i) => (
                            <span key={i} className="flex items-center gap-1 rounded-md bg-paper px-2 py-1 text-[11.5px] text-sub">
                              {f.name}
                              <button onClick={() => setAddArquivos((prev) => prev.filter((_, j) => j !== i))}
                                className="text-faint hover:text-rose">✕</button>
                            </span>
                          ))}
                        </div>
                      )}

                      <textarea
                        value={addTexto}
                        onChange={(e) => setAddTexto(e.target.value)}
                        rows={4}
                        placeholder={"Ou cole a lista de itens e quantidades. Ex.:\n2 - CABO FLEXIVEL 2,5MM AZUL\n10 - DISJUNTOR 20A CURVA C"}
                        className="mt-2 w-full rounded-lg border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-kist" />

                      {addErro && <div className="mt-2 text-[12px] text-rose">{addErro}</div>}

                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={adicionarItens} disabled={addLoading} className={btnPrimary}>
                          {addLoading ? (addProgressoMsg || "lendo e casando com o banco…") : "adicionar à proposta"}
                        </button>
                        <span className="text-[11.5px] text-faint">
                          Os itens entram no fim da lista. Os que já estão preenchidos não são alterados.
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Custo & lucro — uso INTERNO, não vai para o CSV do Tiny */}
                {(() => {
                  const cl = calcularCustoLucro(prop);
                  const prodVenda = cl.prodVenda, prodCusto = cl.prodCusto, custoFreteItens = cl.freteVinda;
                  const freteCobr = cl.freteCobrado, nf12 = cl.nf, lucro = cl.lucro, margem = cl.margem;
                  const temCusto = prodCusto > 0 || custoFreteItens > 0 || cl.freteIda > 0;
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
                        {custoFreteItens > 0 && <div className="flex justify-between text-sub"><span>− Frete de vinda (itens)</span><span className="font-mono">R$ {brl(custoFreteItens)}</span></div>}
                        {cl.freteIda > 0 && <div className="flex justify-between text-sub"><span>− Frete de ida</span><span className="font-mono">R$ {brl(cl.freteIda)}</span></div>}
                        <div className="flex justify-between font-medium text-ink"><span>= Custo total</span><span className="font-mono">R$ {brl(cl.custoTotal)}</span></div>
                        <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
                          <span className="font-medium text-ink">Lucro líquido (s/ NF)</span>
                          <span className={`font-mono text-[16px] font-semibold ${lucro >= 0 ? "text-signal" : "text-rose"}`}>R$ {brl(lucro)}</span>
                        </div>
                        <div className="text-right text-[10.5px] text-faint">{temCusto ? `${margem.toFixed(0)}% margem` : "informe os custos dos itens"} (margem líquida s/ NF)</div>
                      </div>
                      {/* Frete de IDA (v3.80): envio ao cliente, custo da proposta inteira. */}
                      <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line2 bg-surface px-3 py-2">
                        <span className="text-[12px] text-ink">
                          Frete de ida <span className="text-faint">(envio ao cliente · custo da proposta)</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[11px] text-faint">R$</span>
                          <input inputMode="decimal" value={prop.frete_ida ?? ""}
                            onChange={(e) => { setPropostas((prev) => prev.map((p, pi) => pi === propostaIdx ? { ...p, frete_ida: e.target.value } : p)); _dispararAutoSave(); }}
                            placeholder="0,00"
                            className="w-28 rounded-md border border-line2 bg-paper px-2 py-1 text-right font-mono text-[12.5px] text-ink outline-none focus:bg-white focus:ring-1 focus:ring-kist" />
                        </span>
                      </label>
                      <div className="mt-2 text-[10.5px] text-faint">
                        Frete de vinda: por item, no campo “Frete (item)” junto da origem do preço. Frete de ida: aqui, uma vez por proposta.
                        Os dois entram no custo e no lucro; nenhum vai para o Tiny. O frete cobrado do cliente é o campo “Frete (R$)” acima.
                      </div>
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

      {/* Balão de dúvida: vale em qualquer tela, por isso vive aqui e não dentro
          de uma página. Usa o conhecimento do Analista para responder "onde fica"
          e "como faço" sem obrigar o operador a abrir chamado. */}
      <Suporte token={token} usuario={usuario}
        onAbrirRequisicoes={() => { setPagina("requisicoes"); setShowDocs(false); }} />
    </div>
  );
}
