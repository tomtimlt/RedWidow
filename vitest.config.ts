import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@john-studio/core": src("core"),
      "@john-studio/export-html": src("export-html"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts"] },
});
