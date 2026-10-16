import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

// Statique, dynamique (`import("vscode")`, `import( 'vscode' )`) et `require("vscode")`.
const importVscode = /(?:from|import|require)\s*\(?\s*["'`]vscode["'`]/;

describe("frontière vscode (ADR 0004)", () => {
  it("le détecteur reconnaît les imports dynamiques et statiques", () => {
    for (const code of [
      'import("vscode")',
      "import( 'vscode' )",
      "await import(`vscode`)",
      'require("vscode")',
      'import * as v from "vscode"',
      'import "vscode"',
    ]) {
      expect(importVscode.test(code), code).toBe(true);
    }
    expect(importVscode.test('import "vscode-uri"')).toBe(false);
  });

  it("aucun import de `vscode` hors de src/extension", () => {
    const fautifs = files(src)
      .filter((f) => !relative(src, f).replaceAll("\\", "/").startsWith("extension/"))
      .filter((f) => importVscode.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f));
    expect(fautifs).toEqual([]);
  });

  it("l'extension, elle, importe bien vscode (le détecteur n'est pas aveugle)", () => {
    expect(importVscode.test(readFileSync(join(src, "extension", "extension.ts"), "utf8"))).toBe(
      true,
    );
  });
});
