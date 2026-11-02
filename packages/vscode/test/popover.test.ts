import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const uiSource = readFileSync(new URL("../media/ui.js", import.meta.url), "utf8");
const ui = runInNewContext(`${uiSource}\nWarbandUI;`);
const source = readFileSync(new URL("../media/chat.js", import.meta.url), "utf8");
const placement = source.slice(
  source.indexOf("  function place(pop, anchor) {"),
  source.indexOf("  function wirePop("),
);

describe("placement du menu après rétraction de son contenu", () => {
  it("ancre la hauteur réellement obtenue, sans vide sous le menu", () => {
    const styles = new Map<string, string>();
    const pop = {
      style: { setProperty: (key: string, value: string) => styles.set(key, value) },
      offsetWidth: 300,
      get offsetHeight() {
        // La mesure intrinsèque et la mise en page contrainte diffèrent.
        return styles.get("--jn-maxh") === "9999px" ? 900 : 180;
      },
      classList: { add: () => {} },
    };
    const anchor = { getBoundingClientRect: () => ({ left: 20, top: 500, bottom: 528 }) };
    runInNewContext(`${placement}\nplace(pop, anchor);`, {
      UI: ui,
      pop,
      anchor,
      document: { documentElement: { clientWidth: 400, clientHeight: 600 } },
    });
    expect(styles.get("--jn-x")).toBe("20px");
    expect(styles.get("--jn-maxh")).toBe("486px");
    expect(styles.get("--jn-y")).toBe("314px");
  });
});
