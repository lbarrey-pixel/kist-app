// main.jsx — ponto de entrada do Vite.
//
// O index.html aponta para /src/main.jsx. Sem este arquivo o build falha na
// resolução do módulo, que foi o que derrubou o deploy de 14/09/2026 — o
// frontend não era publicado havia 17 dias, então a falta só apareceu no
// primeiro build seguinte.
//
// A única responsabilidade daqui é montar o App no #root e carregar o CSS.
// Nada de lógica: o que for regra de negócio vive no App e nos componentes.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

const raiz = document.getElementById("root");
if (!raiz) {
  // Falha silenciosa aqui vira tela branca sem explicação. Melhor gritar.
  throw new Error("Elemento #root não encontrado no index.html");
}

createRoot(raiz).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
