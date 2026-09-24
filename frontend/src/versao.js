// Versão do bundle atual (hash curto do commit, gravado em build time — ver
// vite.config.js) e a checagem que mantém o operador sempre na versão publicada.
import { useEffect, useState } from "react";

export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

// Derruba os cookies deste domínio e força um reload ignorando cache. Não mexe
// em localStorage (é lá que o login mora — v3.85), então o operador não perde
// a sessão, só o bundle antigo.
function forcarAtualizacao() {
  try {
    document.cookie.split(";").forEach((c) => {
      const nome = c.split("=")[0].trim();
      if (!nome) return;
      document.cookie = `${nome}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  } catch {}
  try {
    if (window.caches) caches.keys().then((ns) => ns.forEach((n) => caches.delete(n)));
  } catch {}
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  window.location.replace(url.toString());
}

async function versaoPublicada() {
  try {
    const r = await fetch(`/version.json?_=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return d.version || null;
  } catch {
    return null;
  }
}

// Confere a versão publicada ao carregar, a cada 5 min e sempre que a aba volta
// a ficar visível (a Cabine costuma passar o dia inteiro aberta numa aba). Achou
// diferença do que está rodando no navegador → atualiza sozinho, sem depender do
// operador notar ou apertar F5.
export function useVersaoCheck() {
  const [atualizando, setAtualizando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    const checar = async () => {
      const v = await versaoPublicada();
      if (!v || cancelado || v === APP_VERSION) return;
      setAtualizando(true);
      forcarAtualizacao();
    };
    checar();
    const t = setInterval(checar, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") checar(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelado = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return atualizando;
}
