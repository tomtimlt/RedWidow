import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHORTCUTS, type ShortcutId, shortcutLabel } from "../src/logic/shortcuts.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("raccourcis du lanceur", () => {
  it("Alt+J hors macOS, Ctrl+J sous macOS", () => {
    expect(shortcutLabel("focusChat", "linux")).toBe("Alt+J C");
    expect(shortcutLabel("focusChat", "win32")).toBe("Alt+J C");
    expect(shortcutLabel("focusChat", "darwin")).toBe("Ctrl+J C");
    expect(shortcutLabel("launcher", "linux")).toBe("Alt+J Alt+J");
    expect(shortcutLabel("launcher", "darwin")).toBe("Ctrl+J Ctrl+J");
  });

  it("la table est alignée sur les raccourcis du manifeste, plate-forme par plate-forme", () => {
    const manifest = JSON.parse(read("../extension.manifest.json"));
    const bindings: { command: string; key: string; mac: string }[] =
      manifest.contributes.keybindings;
    for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
      const entry = SHORTCUTS[id];
      const binding = bindings.find((b) => b.command === entry.command);
      expect(binding, id).toBeDefined();
      const norm = (label: string) => label.toLowerCase();
      expect(norm(shortcutLabel(id, "linux"))).toBe(binding?.key);
      expect(norm(shortcutLabel(id, "darwin"))).toBe(binding?.mac);
    }
    expect(bindings.length).toBe(Object.keys(SHORTCUTS).length);
  });
});
