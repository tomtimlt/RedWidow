/**
 * Test de contrat avec le VRAI binaire OpenCode ET un vrai modèle (par exemple
 * un modèle gratuit d'OpenCode). Désactivé par défaut ; lancer avec :
 *
 *   OPENCODE_BIN=$(which opencode) OPENCODE_MODEL=fournisseur/modèle \
 *     pnpm vitest run packages/agent-opencode/test/contract-real-model
 *
 * `opencode models` liste les identifiants disponibles. Attention : un modèle
 * gratuit est hébergé chez un tiers qui peut conserver les échanges ; ce test
 * n'envoie que des fichiers temporaires sans valeur.
 *
 * Il vérifie le comportement réel (pas un faux fournisseur) : un modèle qui
 * choisit lui-même ses outils est bien soumis à la gate, une lecture permise
 * passe, une lecture interdite est refusée sans fuite de contenu.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOpencodeRunner } from "../src/index.js";
import { harness } from "./helpers.js";

const BIN = process.env.OPENCODE_BIN;
const MODEL = process.env.OPENCODE_MODEL;
const TIMEOUT = 240_000;

async function realRun(prompt: string, files: Record<string, string>) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "john-oc-real-")));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(cwd, name, ".."), { recursive: true });
    writeFileSync(join(cwd, name), content);
  }
  const h = harness({ workspace: cwd });
  const runner = createOpencodeRunner({
    binary: BIN as string,
    builtinTools: ["read", "glob", "grep"],
  });
  const summary = await h.run(runner, { cwd, model: MODEL as string, prompt, maxTurns: 6 });
  const kinds = h.events.map((e) => e.kind);
  console.info(
    `[contrat OpenCode réel] ${prompt.slice(0, 50)}… → ${summary.status} · événements : ${[...new Set(kinds)].join(", ")}`,
  );
  return { h, summary };
}

describe.skipIf(!BIN || !MODEL)("contrat OpenCode : vrai modèle", () => {
  it(
    "une lecture permise passe par la gate et le contenu revient au modèle",
    async () => {
      const marker = "CONTENU-DE-TEST-7f3a";
      const { h } = await realRun(
        "Lis le fichier notes.txt avec l'outil read et cite son contenu.",
        {
          "notes.txt": marker,
        },
      );
      const read = h.events.find((e) => e.kind === "tool.requested" && e.tool === "Read");
      expect(read, "le modèle doit avoir appelé l'outil de lecture").toBeDefined();
      const decided = h.events.filter((e) => e.kind === "approval.decided");
      expect(decided.length).toBeGreaterThan(0);
      expect(decided.every((d) => d.decision === "allow")).toBe(true);
      expect(h.events.filter((e) => e.kind === "error")).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "une lecture hors de l'espace de travail est refusée sans fuite du contenu",
    async () => {
      const outside = realpathSync(mkdtempSync(join(tmpdir(), "john-oc-out-")));
      const marker = "MARQUEUR-SECRET-b81c";
      writeFileSync(join(outside, "secret.txt"), marker);
      const { h } = await realRun(
        `Lis le fichier ${join(outside, "secret.txt")} avec l'outil read et cite son contenu.`,
        { "vide.txt": "x" },
      );
      expect(h.events.some((e) => e.kind === "approval.decided" && e.decision === "deny")).toBe(
        true,
      );
      expect(JSON.stringify(h.events)).not.toContain(marker);
    },
    TIMEOUT,
  );
});
