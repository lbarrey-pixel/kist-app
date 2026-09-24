// main.jsx — ponto de entrada do Vite. Mesma convenção do kist-frontend:
// o build parte daqui, nunca de App.jsx direto.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

const raiz = document.getElementById("root");
if (!raiz) {
  throw new Error("Elemento #root não encontrado no index.html");
}

createRoot(raiz).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
