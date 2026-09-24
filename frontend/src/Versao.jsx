import { useVersaoCheck, APP_VERSION } from "./versao.js";

// Marcador de versão + checagem de atualização (ver src/versao.js). Dois
// formatos: `VersaoBadge` é um chip fixo no canto (usado só na tela de login,
// que não tem sidebar) e `VersaoInline` é texto no fluxo normal da página
// (usado dentro da Sidebar no app principal — um badge `fixed` sozinho no
// canto passava despercebido: baixo contraste, perto do balão de suporte e
// vulnerável a barra de navegador mobile cobrindo a borda da tela).
export default function VersaoBadge() {
  const atualizando = useVersaoCheck();
  return (
    <div
      title={atualizando ? "Nova versão publicada — atualizando…" : `Kist Cabine · build ${APP_VERSION}`}
      className="pointer-events-none fixed bottom-3 right-3 z-50 select-none rounded-md border border-line2 bg-surface px-2 py-1 font-mono text-[11px] text-sub shadow-sm"
    >
      {atualizando ? "atualizando…" : `v${APP_VERSION}`}
    </div>
  );
}

export function VersaoInline({ className = "" }) {
  const atualizando = useVersaoCheck();
  return (
    <div
      title={atualizando ? "Nova versão publicada — atualizando…" : `build ${APP_VERSION}`}
      className={`truncate font-mono text-[10.5px] text-inkmut ${className}`}
    >
      {atualizando ? "atualizando…" : `Cabine v${APP_VERSION}`}
    </div>
  );
}
