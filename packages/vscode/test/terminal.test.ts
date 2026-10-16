import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("contribution de la commande", () => {
  const manifest = JSON.parse(read("../extension.manifest.json"));
  it("john.openTerminal est déclarée avec le titre prévu", () => {
    const cmd = manifest.contributes.commands.find(
      (c: { command: string }) => c.command === "john.openTerminal",
    );
    expect(cmd?.title).toBe("John : ouvrir un terminal");
  });
});
