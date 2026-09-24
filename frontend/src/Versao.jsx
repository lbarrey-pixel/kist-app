import { useVersaoCheck, APP_VERSION } from "./versao.js";

// Marcador fixo no canto: o operador sempre vê qual versão está rodando.
// Some do fluxo normal (pointer-events-none, texto discreto) e só chama
// atenção quando está forçando a atualização.
export default function VersaoBadge() {
  const atualizando = useVersaoCheck();
  return (
    <div
      title={atualizando ? "Nova versão publicada — atualizando…" : `Kist Cabine · build ${APP_VERSION}`}
      className="pointer-events-none fixed bottom-1.5 right-2 z-50 select-none font-mono text-[10px] text-faint"
    >
      {atualizando ? "atualizando…" : `v${APP_VERSION}`}
    </div>
  );
}
