import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mesmo esquema do kist-frontend (v3.95): hash curto do commit do MONOREPO
// inteiro (backend, frontend e este dashboard vêm do mesmo push), gravado em
// build time. Os três serviços deployados do mesmo push sempre mostram o
// mesmo hash.
function commitHash() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: __dirname }).toString().trim();
  } catch {
    return "dev";
  }
}

const APP_VERSION = commitHash();

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
