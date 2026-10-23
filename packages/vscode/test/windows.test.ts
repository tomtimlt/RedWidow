import { describe, expect, it } from "vitest";
import { parseWindows, WINDOW_CAP } from "../src/logic/windows.js";

describe("parseWindows", () => {
  it("garde une liste valide et ignore warband.layout", () => {
    expect(
      parseWindows([
        { kind: "chat", chatId: "c2" },
        { kind: "terminal", container: "exegol-htb1" },
        { kind: "monitor" },
        { kind: "cockpit" },
        { kind: "settings" },
        { kind: "killchain" },
      ]),
    ).toEqual([
      { kind: "chat", chatId: "c2" },
      { kind: "terminal", container: "exegol-htb1" },
      { kind: "monitor" },
      { kind: "cockpit" },
      { kind: "settings" },
      { kind: "killchain" },
    ]);
    expect(parseWindows({ kind: "editor" })).toEqual([]);
  });

  it("refuse les formes invalides, le chat latéral, terminal chatId et les singletons doublés", () => {
    expect(
      parseWindows([
        null,
        { kind: "layout" },
        { kind: "chat" },
        { kind: "chat", chatId: "sidebar" },
        { kind: "chat", chatId: "../x" },
        { kind: "chat", chatId: "c2", extra: 1 },
        { kind: "monitor", chatId: "c2" },
        { kind: "monitor" },
        { kind: "monitor" },
        { kind: "terminal", chatId: "c3" },
        { kind: "terminal", container: "" },
        { kind: "terminal", container: "bad name" },
        "chat",
      ]),
    ).toEqual([{ kind: "monitor" }]);
  });

  it("accepte le nom réel du conteneur et refuse un cinquième doublon", () => {
    const four = Array.from({ length: 4 }, () => ({
      kind: "terminal" as const,
      container: "my.box:tag/v1",
    }));
    expect(parseWindows(four)).toHaveLength(4);
    expect(parseWindows([...four, { kind: "terminal", container: "my.box:tag/v1" }])).toHaveLength(
      4,
    );
  });

  it("plafonne la liste", () => {
    const raw = Array.from({ length: WINDOW_CAP + 5 }, (_, i) => ({
      kind: "terminal",
      container: `c${i}`,
    }));
    expect(parseWindows(raw)).toHaveLength(WINDOW_CAP);
  });
});
