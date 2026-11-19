import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { chatHtml } from "../src/logic/html.js";

const js = readFileSync(join(__dirname, "..", "media", "chat.js"), "utf8");
const opts = {
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/chat.js",
  iconsUri: "https://x.vscode-cdn.net/media/icons.js",
  uiUri: "https://x.vscode-cdn.net/media/ui.js",
  styleUri: "https://x.vscode-cdn.net/media/chat.css",
};

describe("commandes du compositeur", () => {
  const html = chatHtml(opts);
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";

  it("propose deux commandes distinctes et accessibles en français et en anglais", () => {
    expect(tag("stop")).toContain('type="button"');
    expect(tag("stop")).toContain(`aria-label="Arrêter l'agent"`);
    expect(tag("send")).toContain('type="submit"');
    expect(tag("send")).toContain('aria-label="Envoyer"');
    const english = chatHtml({ ...opts, locale: "en" });
    expect(english).toContain('aria-label="Stop the agent"');
    expect(english).toContain('aria-label="Send"');
  });
  it("arrête un tour avec un brouillon sans modifier la saisie, sauf fermeture préalable du menu", () => {
    const start = js.indexOf(
      '  input.addEventListener("keydown", (e) => {',
      js.indexOf('$("form").addEventListener("submit"'),
    );
    const end = js.indexOf('  $("reset").addEventListener', start);
    expect(start).toBeGreaterThan(0);
    const handlers = js.slice(start, end);
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const sent: unknown[] = [];
    const input = {
      value: "brouillon",
      addEventListener: (_: string, fn: (e: Record<string, unknown>) => void) =>
        listeners.set("key", fn),
    };
    const stop = {
      disabled: false,
      addEventListener: (_: string, fn: (e: Record<string, unknown>) => void) =>
        listeners.set("stop", fn),
    };
    let menu = false;
    runInNewContext(handlers, {
      input,
      stop,
      lastView: { busy: true, stopping: false },
      draftFiles: [{ name: "note.txt" }],
      mentionOpen: () => menu,
      closeMention: () => {
        menu = false;
      },
      vscode: { postMessage: (message: unknown) => sent.push(message) },
    });
    listeners.get("key")!({ key: "Escape", preventDefault() {} });
    listeners.get("stop")!({});
    expect(sent).toEqual([{ type: "stop" }, { type: "stop" }]);
    expect(input.value).toBe("brouillon");
    menu = true;
    listeners.get("key")!({ key: "Escape", preventDefault() {} });
    expect(menu).toBe(false);
    expect(sent).toHaveLength(2);
    expect(tag("stop")).toContain(`aria-label="Arrêter l'agent"`);
  });
});
