import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@john-studio/agent-opencode": src("agent-opencode"),
      "@john-studio/agent-sdk": src("agent-sdk"),
      "@john-studio/cli": fileURLToPath(new URL("./packages/cli/src/main.ts", import.meta.url)),
      "@john-studio/core": src("core"),
      "@john-studio/export-html": src("export-html"),
      "@john-studio/messages": src("messages"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"] },
});
