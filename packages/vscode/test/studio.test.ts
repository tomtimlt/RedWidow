import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { studioHtml } from "../src/logic/html.js";
import { parseStudioMessage } from "../src/logic/studio.js";

describe("réglages", () => {
  it("accepte open, refresh, unlink et refuse le reste", () => {
    expect(parseStudioMessage({ type: "open", page: "project" })).toEqual({
      type: "open",
      page: "project",
    });
    expect(parseStudioMessage({ type: "refresh" })).toEqual({ type: "refresh" });
    expect(parseStudioMessage({ type: "unlink" })).toEqual({ type: "unlink" });
    expect(parseStudioMessage({ type: "open", page: "nope" })).toBeNull();
    expect(parseStudioMessage({ type: "send", text: "x" })).toBeNull();
  });

  it("HTML : nonce, pas de style inline", () => {
    const html = studioHtml({
      nonce: "abc",
      cspSource: "https://example.test",
      scriptUri: "https://example.test/studio.js",
      styleUri: "https://example.test/chat.css",
    });
    expect(html).toContain("nonce-abc");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("<style");
  });

  it("studio.js n'injecte pas de HTML", () => {
    const src = readFileSync(fileURLToPath(new URL("../media/studio.js", import.meta.url)), "utf8");
    expect(src).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|eval\(|requestAnimationFrame|setInterval/,
    );
  });
});
