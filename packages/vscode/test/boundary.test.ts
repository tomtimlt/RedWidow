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

describe("frontière vscode (ADR 0004)", () => {
  it("aucun import de `vscode` hors de src/extension", () => {
    const importVscode = /(?:from|import|require\()\s*["']vscode["']/;
    const fautifs = files(src)
      .filter((f) => !relative(src, f).replaceAll("\\", "/").startsWith("extension/"))
      .filter((f) => importVscode.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f));
    expect(fautifs).toEqual([]);
  });

  it("l'extension, elle, importe bien vscode (le détecteur n'est pas aveugle)", () => {
    const importVscode = /(?:from|import|require\()\s*["']vscode["']/;
    expect(importVscode.test(readFileSync(join(src, "extension", "extension.ts"), "utf8"))).toBe(
      true,
    );
  });
});
