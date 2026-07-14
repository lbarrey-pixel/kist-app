// ──────────────────────────────────────────────────────────────────────────
// kist-ui.jsx — Sistema de design "Cabine" da Kist
// Primitivas compartilhadas: ícones, tokens de confiança, PO, sidebar, etc.
// Importado por App.jsx, Propostas.jsx, OrdensCompra.jsx e Docs.jsx.
// ──────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect } from "react";

// ── Léxico de confiança (alma da revisão) ─────────────────────────────────
export const CONF = {
  alta:    { rail: "#4FA62E", bg: "#EAF5E5", fg: "#357A1E", label: "EXATO" },
  media:   { rail: "#1F6FEB", bg: "#E8F0FE", fg: "#175FD3", label: "SIMILAR" },
  baixa:   { rail: "#B7791F", bg: "#FBF1DD", fg: "#8A5A12", label: "INCERTO" },
  nenhuma: { rail: "#D14343", bg: "#FBE9E9", fg: "#A82F2F", label: "SEM MATCH" },
};

export const brl = (n) =>
  (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-kist px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-kist600 disabled:opacity-40";
export const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-line2 bg-surface px-3.5 py-2 text-[13px] font-medium text-sub transition-colors hover:border-faint hover:text-ink";

// ── Ícones (stroke 1.6) ───────────────────────────────────────────────────
const Ic = ({ d, size = 18, fill, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"}
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d}
  </svg>
);
export const IconNova     = (p) => <Ic {...p} d={<><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M9 13h6M12 10v6" /></>} />;
export const IconList     = (p) => <Ic {...p} d={<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>} />;
export const IconBoard    = (p) => <Ic {...p} d={<><rect x="3" y="3" width="6" height="18" rx="1.5" /><rect x="10.5" y="3" width="6" height="12" rx="1.5" /><rect x="18" y="3" width="3" height="9" rx="1.5" /></>} />;
export const IconBook     = (p) => <Ic {...p} d={<><path d="M5 4h9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H5Z" /><path d="M5 4v13.5" /></>} />;
export const IconSearch   = (p) => <Ic {...p} d={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>} />;
export const IconUpload   = (p) => <Ic {...p} d={<><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>} />;
export const IconCheck    = (p) => <Ic {...p} d={<path d="m4 12 5 5L20 6" />} />;
export const IconBolt     = (p) => <Ic {...p} d={<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />} />;
export const IconArrow    = (p) => <Ic {...p} d={<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>} />;
export const IconX        = (p) => <Ic {...p} d={<path d="M6 6l12 12M18 6 6 18" />} />;
export const IconDownload = (p) => <Ic {...p} d={<><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>} />;
export const IconLink     = (p) => <Ic {...p} d={<><path d="M9 15 15 9" /><path d="M10.5 6.5 13 4a4 4 0 0 1 6 6l-2.5 2.5" /><path d="M13.5 17.5 11 20a4 4 0 0 1-6-6l2.5-2.5" /></>} />;
export const IconCopy     = (p) => <Ic {...p} d={<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>} />;
export const IconTrash    = (p) => <Ic {...p} d={<><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" /></>} />;
export const IconLogout   = (p) => <Ic {...p} d={<><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" /><path d="M9 12h11" /><path d="m17 8 4 4-4 4" /></>} />;
export const IconBell     = (p) => <Ic {...p} d={<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>} />;
export const IconChat     = (p) => <Ic {...p} d={<><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l.8-5.5A8 8 0 1 1 21 12Z" /><path d="M8.5 11h7M8.5 14h4" /></>} />;
export const IconInbox    = (p) => <Ic {...p} d={<><path d="M4 13h4l1.5 2.5h5L16 13h4" /><path d="M4 13 6 5h12l2 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /></>} />;
// Google "G" colorido — não usa o sistema Ic (tem fill próprio)
export const IconGoogle = ({ size = 16, className = "", ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...p}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// ── Texto/labels ──────────────────────────────────────────────────────────
export const Eyebrow = ({ children }) => (
  <div className="eyebrow text-[11px] font-semibold uppercase text-faint">{children}</div>
);

export function StateLabel({ conf }) {
  const c = CONF[conf] || CONF.nenhuma;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold eyebrow"
      style={{ background: c.bg, color: c.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.rail }} />
      {c.label}
    </span>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
        {sub && <div className="mt-1 text-[13.5px] text-sub">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 pt-1">{actions}</div>}
    </div>
  );
}

// ── PO do cliente — identificador externo de primeira classe ───────────────
export function PoChip({ po, size = "sm" }) {
  const pad = size === "lg" ? "px-2.5 py-1 text-[13px]" : "px-1.5 py-0.5 text-[11px]";
  if (!po) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-md bg-amberbg ${pad} font-medium text-amber`}>
        <span className="h-1.5 w-1.5 rounded-full bg-amber" /> PO pendente
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md bg-ink/[0.05] ${pad}`}>
      <span className="eyebrow text-[9px] font-bold uppercase text-faint">PO</span>
      <span className="font-mono font-medium text-ink">{po}</span>
    </span>
  );
}

export function CopyPo({ po }) {
  const [done, setDone] = useState(false);
  function copy() {
    try { navigator.clipboard?.writeText(po); } catch (e) {}
    setDone(true); setTimeout(() => setDone(false), 1400);
  }
  return (
    <button onClick={copy}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-faint transition-colors hover:bg-paper hover:text-kist">
      {done ? <IconCheck size={13} className="text-signal" /> : <IconCopy size={13} />}
      <span className="text-[10.5px] font-medium">{done ? "copiado" : "copiar"}</span>
    </button>
  );
}

// ── Barra-resumo de triagem (assinatura da revisão) ────────────────────────
// itens no formato real: { confianca_match, preco_un, tem_preco }
export function CertaintyStrip({ itens }) {
  const { counts, total, semPreco } = useMemo(() => {
    const c = { alta: 0, media: 0, baixa: 0, nenhuma: 0 };
    let sem = 0;
    (itens || []).forEach((i) => {
      const conf = i.confianca_match || "nenhuma";
      c[conf] = (c[conf] || 0) + 1;
      if (!(i.preco_un > 0)) sem++;
    });
    return { counts: c, total: (itens || []).length, semPreco: sem };
  }, [itens]);

  if (!total) return null;
  const ordem = ["alta", "media", "baixa", "nenhuma"];
  const textos = {
    alta: `${counts.alta} exatos`, media: `${counts.media} similares`,
    baixa: `${counts.baixa} incertos`, nenhuma: `${counts.nenhuma} sem match`,
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Triagem de confiança</Eyebrow>
        <span className="font-mono text-xs text-sub">{total} itens</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
        {ordem.map((k) => counts[k] > 0 && (
          <div key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: CONF[k].rail }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {ordem.map((k) => counts[k] > 0 && (
          <span key={k} className="flex items-center gap-1.5 text-xs text-sub">
            <span className="h-2 w-2 rounded-full" style={{ background: CONF[k].rail }} />
            {textos[k]}
          </span>
        ))}
        {semPreco > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-amber">
            <IconBolt size={13} /> {semPreco} {semPreco === 1 ? "item exige cotação manual" : "itens exigem cotação manual"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sidebar navy (substitui a navegação horizontal) ────────────────────────
export function Sidebar({ active, onNavigate, usuario, stats, onLogout, isAdmin, alertas = 0 }) {
  const nav = [
    { k: "nova",        label: "Nova proposta",     Icon: IconNova },
    { k: "propostas",   label: "Propostas",         Icon: IconList },
    { k: "ordens",      label: "Ordens de compra",  Icon: IconBoard },
    { k: "requisicoes", label: "Requisições",       Icon: IconChat },
    ...(isAdmin ? [{ k: "chamados", label: "Admin chamados", Icon: IconInbox }] : []),
    { k: "docs",        label: "Docs",              Icon: IconBook },
  ];
  const inicial = (usuario?.nome || "?").trim().charAt(0).toUpperCase();
  return (
    <aside className="flex w-[236px] flex-shrink-0 flex-col bg-ink text-white">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-kist">
          <span className="font-mono text-base font-semibold tracking-tight">K</span>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Kist</div>
          <div className="eyebrow text-[10px] font-medium uppercase text-inkmut">Cabine de compras</div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pt-2">
        {nav.map(({ k, label, Icon }) => {
          const on = active === k;
          return (
            <button key={k} onClick={() => onNavigate(k)}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors
                ${on ? "bg-white/10 text-white" : "text-inkmut hover:bg-white/[0.06] hover:text-white"}`}>
              {on && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-kist" />}
              <Icon size={17} className={on ? "text-white" : "text-inkmut group-hover:text-white"} />
              {label}
              {k === "requisicoes" && alertas > 0 && (
                <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose px-1.5 text-[10.5px] font-semibold text-white">
                  {alertas > 9 ? "9+" : alertas}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto px-3 pb-3">
        {stats && (
          <div className="mb-2 rounded-lg bg-white/[0.05] px-3 py-2.5">
            <div className="eyebrow text-[10px] uppercase text-inkmut">Banco de preços</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-[15px] font-semibold">
                {(stats.total_produtos || 0).toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-inkmut">produtos</span>
            </div>
            {stats.desatualizados_90d > 0 && (
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-amber">
                <span className="h-1.5 w-1.5 rounded-full bg-amber" /> {stats.desatualizados_90d} desatualizados
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          {usuario?.foto
            ? <img src={usuario.foto} alt="" className="h-7 w-7 rounded-full" />
            : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-kist text-[12px] font-semibold">{inicial}</div>}
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12.5px] font-medium">{usuario?.nome}</div>
            <div className="truncate text-[10.5px] text-inkmut">{usuario?.email}</div>
          </div>
          <button onClick={onLogout} title="Sair"
            className="ml-auto rounded-md p-1 text-inkmut transition-colors hover:bg-white/10 hover:text-white">
            <IconLogout size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
