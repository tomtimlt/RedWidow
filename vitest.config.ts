import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Sous-chemins du paquet vscode : `@warband/vscode/logic/x.js` → `packages/vscode/src/logic/x.ts`.
      {
        find: /^@warband\/vscode\/(.+)\.js$/,
        replacement: fileURLToPath(new URL("./packages/vscode/src/$1.ts", import.meta.url)),
      },
      { find: "@warband/agent-opencode", replacement: src("agent-opencode") },
      { find: "@warband/agent-sdk", replacement: src("agent-sdk") },
      {
        find: "@warband/cli",
        replacement: fileURLToPath(new URL("./packages/cli/src/main.ts", import.meta.url)),
      },
      { find: "@warband/core", replacement: src("core") },
      { find: "@warband/export-html", replacement: src("export-html") },
      { find: "@warband/messages", replacement: src("messages") },
      { find: "@warband/server", replacement: src("server") },
      // Après l'alias regex ci-dessus (le premier qui correspond l'emporte).
      {
        find: "@warband/vscode",
        replacement: fileURLToPath(
          new URL("./packages/vscode/src/logic/integrity.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    // Les runners Windows sont lents sur les tests à nombreuses écritures disque.
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
  },
});
