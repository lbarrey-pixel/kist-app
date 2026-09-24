// App.jsx — CRM de leads frios da Kist.
//
// App separado do kist-frontend de propósito (decisão de 24/09): mesmo login
// Google restrito (USUARIOS_PERMITIDOS), mas deploy e ciclo de vida próprios.
// "Tempo real" aqui é SSE lido via fetch manual (não EventSource nativo,
// porque o EventSource do navegador não manda header Authorization — e a
// rota /crm/leads/stream usa o MESMO Bearer token de todas as outras rotas
// do backend, sem mecanismo de auth novo).
import React, { useCallback, useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const USUARIOS_PERMITIDOS = new Set(
  (import.meta.env.VITE_USUARIOS_PERMITIDOS ||
    "leonardobarrey@gmail.com,thiagokist@gmail.com,fabiokist@gmail.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);
const emailAutorizado = (e) => USUARIOS_PERMITIDOS.has((e || "").trim().toLowerCase());

function decodeJwtPayload(jwt) {
  const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

const ESTAGIOS = [
  { chave: "frio", label: "Frio", cor: "#64748b" },
  { chave: "aquecendo", label: "Aquecendo", cor: "#d97706" },
  { chave: "respondeu", label: "Respondeu", cor: "#2563eb" },
  { chave: "qualificado", label: "Qualificado", cor: "#7c3aed" },
  { chave: "proposta_enviada", label: "Proposta enviada", cor: "#0891b2" },
  { chave: "convertido", label: "Convertido", cor: "#059669" },
  { chave: "descartado", label: "Descartado", cor: "#b91c1c" },
];
const ESTAGIO_LABEL = Object.fromEntries(ESTAGIOS.map((e) => [e.chave, e.label]));
const ESTAGIO_COR = Object.fromEntries(ESTAGIOS.map((e) => [e.chave, e.cor]));

function fmtData(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function api(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

// Consome o SSE manualmente (fetch + ReadableStream) para poder mandar o
// Authorization header. Reconecta sozinho se a conexão cair.
function useLeadsStream(token, onLeads) {
  const abortRef = useRef(null);
  useEffect(() => {
    if (!token) return;
    let parar = false;

    async function conectar() {
      while (!parar) {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
          const res = await fetch(`${API}/crm/leads/stream`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (!parar) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const partes = buf.split("\n\n");
            buf = partes.pop();
            for (const bloco of partes) {
              let evento = "message", dados = "";
              for (const linha of bloco.split("\n")) {
                if (linha.startsWith("event:")) evento = linha.slice(6).trim();
                else if (linha.startsWith("data:")) dados += linha.slice(5).trim();
              }
              if (evento === "leads" && dados) {
                try { onLeads(JSON.parse(dados)); } catch {}
              }
            }
          }
        } catch (e) {
          if (parar) return;
        }
        if (!parar) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    conectar();
    return () => { parar = true; abortRef.current?.abort(); };
  }, [token, onLeads]);
}

function Login({ onLogin, erro }) {
  const btnRef = useRef(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true; script.defer = true;
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, []);

  function tentar() {
    const el = btnRef.current;
    if (!el || !window.google || !GOOGLE_CLIENT_ID) return;
    window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onLogin, ux_mode: "popup", auto_select: true });
    window.google.accounts.id.prompt(() => {});
    window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with", locale: "pt-BR", width: 280 });
  }

  useEffect(() => {
    const t = setInterval(() => { if (window.google) { clearInterval(t); tentar(); } }, 150);
    const to = setTimeout(() => clearInterval(t), 8000);
    return () => { clearInterval(t); clearTimeout(to); };
  }, []);

  return (
    <div className="login-tela">
      <div className="login-card">
        <div className="login-logo">C</div>
        <h1>CRM de Leads — Kist</h1>
        <p>Base de prospecção fria. Acesso restrito à equipe.</p>
        <div ref={btnRef} />
        {erro && <div className="erro">{erro}</div>}
      </div>
    </div>
  );
}

function CartaoLead({ lead, onClick }) {
  return (
    <button className="cartao-lead" onClick={onClick}>
      <div className="cartao-dominio">{lead.dominio}</div>
      <div className="cartao-meta">
        {lead.teve_resposta && <span className="badge badge-resposta">respondeu</span>}
        <span className="cartao-data">último envio: {fmtData(lead.ultimo_envio)}</span>
      </div>
      {lead.proximo_followup_em && (
        <div className="cartao-followup">📅 follow-up: {fmtData(lead.proximo_followup_em)}</div>
      )}
    </button>
  );
}

function PainelDetalhe({ dominio, token, onFechar, onAtualizado }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [novoEstagio, setNovoEstagio] = useState("");
  const [followup, setFollowup] = useState("");
  const [observacao, setObservacao] = useState("");
  const [msgContato, setMsgContato] = useState({ canal: "email", direcao: "enviado", trecho: "" });

  const carregar = useCallback(() => {
    api(`/crm/leads/${dominio}`, token).then((d) => {
      setDados(d);
      setNovoEstagio(d.lead.estagio_funil);
      setObservacao(d.lead.observacao || "");
      setFollowup(d.lead.proximo_followup_em ? d.lead.proximo_followup_em.slice(0, 16) : "");
    }).catch((e) => setErro(String(e.message || e)));
  }, [dominio, token]);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvarEstagio() {
    setSalvando(true); setErro("");
    try {
      await api(`/crm/leads/${dominio}/estagio`, token, {
        method: "POST",
        body: JSON.stringify({
          estagio_funil: novoEstagio,
          proximo_followup_em: followup ? new Date(followup).toISOString() : null,
          observacao,
        }),
      });
      carregar();
      onAtualizado();
    } catch (e) { setErro(String(e.message || e)); }
    setSalvando(false);
  }

  async function registrarContato() {
    if (!msgContato.trecho.trim()) return;
    setSalvando(true); setErro("");
    try {
      await api(`/crm/leads/${dominio}/contato`, token, {
        method: "POST",
        body: JSON.stringify(msgContato),
      });
      setMsgContato({ canal: "email", direcao: "enviado", trecho: "" });
      carregar();
      onAtualizado();
    } catch (e) { setErro(String(e.message || e)); }
    setSalvando(false);
  }

  if (!dados) return (
    <div className="painel-overlay" onClick={onFechar}>
      <div className="painel" onClick={(e) => e.stopPropagation()}>Carregando…</div>
    </div>
  );

  const { lead, contatos, interacoes } = dados;

  return (
    <div className="painel-overlay" onClick={onFechar}>
      <div className="painel" onClick={(e) => e.stopPropagation()}>
        <div className="painel-cabecalho">
          <h2>{lead.dominio}</h2>
          <button className="fechar" onClick={onFechar}>✕</button>
        </div>
        {erro && <div className="erro">{erro}</div>}

        <section>
          <h3>Estágio do funil</h3>
          <div className="linha-form">
            <select value={novoEstagio} onChange={(e) => setNovoEstagio(e.target.value)}>
              {ESTAGIOS.map((e) => <option key={e.chave} value={e.chave}>{e.label}</option>)}
            </select>
            <input type="datetime-local" value={followup} onChange={(e) => setFollowup(e.target.value)} title="Próximo follow-up" />
          </div>
          <textarea placeholder="Observação" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
          <button disabled={salvando} onClick={salvarEstagio}>Salvar</button>
        </section>

        <section>
          <h3>Contatos prospectados ({contatos.length})</h3>
          <ul className="lista-contatos">
            {contatos.map((c) => (
              <li key={c.id}>{c.nome || c.email} — <span className="muted">{c.email}</span></li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Registrar contato</h3>
          <div className="linha-form">
            <select value={msgContato.direcao} onChange={(e) => setMsgContato((m) => ({ ...m, direcao: e.target.value }))}>
              <option value="enviado">Enviado</option>
              <option value="recebido">Recebido</option>
            </select>
            <select value={msgContato.canal} onChange={(e) => setMsgContato((m) => ({ ...m, canal: e.target.value }))}>
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="linkedin">LinkedIn</option>
              <option value="telefone">Telefone</option>
            </select>
          </div>
          <textarea placeholder="O que foi dito / resumo" value={msgContato.trecho}
            onChange={(e) => setMsgContato((m) => ({ ...m, trecho: e.target.value }))} rows={2} />
          <button disabled={salvando} onClick={registrarContato}>Registrar</button>
        </section>

        <section>
          <h3>Histórico de interações ({interacoes.length})</h3>
          <ul className="timeline">
            {interacoes.map((i) => (
              <li key={i.id}>
                <div className="timeline-topo">
                  <strong>{i.nome || i.email || "—"}</strong>
                  <span className={`badge badge-${i.direcao}`}>{i.direcao}</span>
                  <span className="muted">{i.canal}</span>
                  <span className="muted">{fmtData(i.data_interacao)}</span>
                </div>
                {i.assunto && <div className="timeline-assunto">{i.assunto}</div>}
                {i.trecho && <div className="timeline-trecho">{i.trecho.slice(0, 400)}</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => { try { return localStorage.getItem("kist_crm_token"); } catch { return null; } });
  const [usuario, setUsuario] = useState(() => { try { return JSON.parse(localStorage.getItem("kist_crm_user") || "null"); } catch { return null; } });
  const [authErro, setAuthErro] = useState("");
  const [leads, setLeads] = useState({});
  const [painel, setPainel] = useState(null);
  const [busca, setBusca] = useState("");
  const [soComResposta, setSoComResposta] = useState(false);
  const [selecionado, setSelecionado] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  function handleGoogleResponse(response) {
    const credential = response.credential;
    const payload = decodeJwtPayload(credential);
    if (!emailAutorizado(payload.email)) {
      try { window.google?.accounts.id.disableAutoSelect(); } catch {}
      try { localStorage.removeItem("kist_crm_token"); localStorage.removeItem("kist_crm_user"); } catch {}
      setToken(null); setUsuario(null);
      setAuthErro(`Acesso negado para ${payload.email || "esta conta"}.`);
      return;
    }
    setAuthErro("");
    const user = { nome: payload.name, email: payload.email, foto: payload.picture };
    setToken(credential);
    setUsuario(user);
    try {
      localStorage.setItem("kist_crm_token", credential);
      localStorage.setItem("kist_crm_user", JSON.stringify(user));
    } catch {}
  }

  function logout() {
    try { localStorage.removeItem("kist_crm_token"); localStorage.removeItem("kist_crm_user"); } catch {}
    try { window.google?.accounts.id.disableAutoSelect(); } catch {}
    setToken(null); setUsuario(null); setLeads({}); setPainel(null);
  }

  // Renovação silenciosa do token — mesmo padrão do kist-frontend (v3.87/v3.89).
  useEffect(() => {
    if (!token) return;
    let exp = 0;
    try { exp = decodeJwtPayload(token).exp * 1000; } catch { return; }
    const renovarEm = Math.max(exp - Date.now() - 5 * 60 * 1000, 5000);
    const t = setTimeout(() => {
      if (window.google && GOOGLE_CLIENT_ID) {
        window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleResponse, ux_mode: "popup", auto_select: true });
        window.google.accounts.id.prompt(() => {});
      }
    }, renovarEm);
    return () => clearTimeout(t);
  }, [token]);

  const carregarLeads = useCallback(async () => {
    if (!token) return;
    setCarregando(true); setErro("");
    try {
      let todos = [];
      let offset = 0;
      const PASSO = 500;
      while (true) {
        const pagina = await api(`/crm/leads?limite=${PASSO}&offset=${offset}`, token);
        todos = todos.concat(pagina.leads || []);
        offset += PASSO;
        if (todos.length >= (pagina.total || 0) || (pagina.leads || []).length < PASSO) break;
      }
      const mapa = {};
      for (const l of todos) mapa[l.id] = l;
      setLeads(mapa);
      const p = await api("/crm/painel", token);
      setPainel(p);
    } catch (e) {
      if (String(e.message || "").includes("401") || String(e.message || "").includes("Token")) {
        logout();
      } else {
        setErro(String(e.message || e));
      }
    }
    setCarregando(false);
  }, [token]);

  useEffect(() => { carregarLeads(); }, [carregarLeads]);

  const onLeadsStream = useCallback((novos) => {
    setLeads((prev) => {
      const copia = { ...prev };
      for (const l of novos) copia[l.id] = l;
      return copia;
    });
  }, []);
  useLeadsStream(token, onLeadsStream);

  if (!token || !usuario) {
    return <Login onLogin={handleGoogleResponse} erro={authErro} />;
  }

  const lista = Object.values(leads).filter((l) => {
    if (soComResposta && !l.teve_resposta) return false;
    if (busca && !l.dominio.includes(busca.trim().toLowerCase())) return false;
    return true;
  });
  const porEstagio = {};
  for (const e of ESTAGIOS) porEstagio[e.chave] = [];
  for (const l of lista) (porEstagio[l.estagio_funil] || porEstagio.frio).push(l);
  for (const k of Object.keys(porEstagio)) {
    porEstagio[k].sort((a, b) => (b.ultimo_envio || "").localeCompare(a.ultimo_envio || ""));
  }

  return (
    <div className="app">
      <header className="topo">
        <div className="topo-titulo">
          <span className="topo-logo">C</span>
          <div>
            <h1>CRM de Leads</h1>
            <span className="muted">{painel ? `${painel.total} leads na base` : "—"}</span>
          </div>
        </div>
        <div className="topo-filtros">
          <input placeholder="buscar domínio…" value={busca} onChange={(e) => setBusca(e.target.value.toLowerCase())} />
          <label className="check"><input type="checkbox" checked={soComResposta} onChange={(e) => setSoComResposta(e.target.checked)} /> só com resposta</label>
          {carregando && <span className="muted">atualizando…</span>}
        </div>
        <div className="topo-usuario">
          {usuario.foto && <img src={usuario.foto} alt="" />}
          <span>{usuario.nome}</span>
          <button onClick={logout}>Sair</button>
        </div>
      </header>

      {erro && <div className="erro barra-erro">{erro}</div>}

      <main className="kanban">
        {ESTAGIOS.map((e) => (
          <div className="coluna" key={e.chave}>
            <div className="coluna-cabecalho" style={{ borderColor: e.cor }}>
              <span>{e.label}</span>
              <span className="contagem">{porEstagio[e.chave].length}</span>
            </div>
            <div className="coluna-corpo">
              {porEstagio[e.chave].map((l) => (
                <CartaoLead key={l.id} lead={l} onClick={() => setSelecionado(l.dominio)} />
              ))}
              {porEstagio[e.chave].length === 0 && <div className="vazio">—</div>}
            </div>
          </div>
        ))}
      </main>

      {selecionado && (
        <PainelDetalhe dominio={selecionado} token={token}
          onFechar={() => setSelecionado(null)}
          onAtualizado={carregarLeads} />
      )}
    </div>
  );
}
