import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@warband/agent-opencode": src("agent-opencode"),
      "@warband/agent-sdk": src("agent-sdk"),
      "@warband/cli": fileURLToPath(new URL("./packages/cli/src/main.ts", import.meta.url)),
      "@warband/core": src("core"),
      "@warband/export-html": src("export-html"),
      "@warband/messages": src("messages"),
      "@warband/vscode": fileURLToPath(
        new URL("./packages/vscode/src/logic/integrity.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    // Les runners Windows sont lents sur les tests à nombreuses écritures disque.
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
  },
});
