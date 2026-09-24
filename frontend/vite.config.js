import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function commitHash() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: __dirname }).toString().trim();
  } catch {
    return "dev";
  }
}

const APP_VERSION = commitHash();

// Grava dist/version.json depois do build — é o que o app em produção consulta
// periodicamente (src/versao.js) pra saber se saiu um deploy mais novo enquanto
// a aba estava aberta, e se atualizar sozinho.
function versionFilePlugin() {
  return {
    name: "kist-version-file",
    writeBundle() {
      fs.writeFileSync(
        path.resolve(__dirname, "dist/version.json"),
        JSON.stringify({ version: APP_VERSION, build: Date.now() })
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
});
