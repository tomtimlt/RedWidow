import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("contribution de la commande", () => {
  const manifest = JSON.parse(read("../extension.manifest.json"));
  it("warband.openTerminal est déclarée avec le titre prévu", () => {
    const cmd = manifest.contributes.commands.find(
      (c: { command: string }) => c.command === "warband.openTerminal",
    );
    expect(cmd?.title).toBe("%command.openTerminal%");
    const fr = JSON.parse(read("../package.nls.fr.json"));
    const en = JSON.parse(read("../package.nls.en.json"));
    expect(fr["command.openTerminal"]).toBe("Venator Ops : ouvrir un terminal");
    expect(en["command.openTerminal"]).toBe("Venator Ops: Open a terminal");
  });
});
