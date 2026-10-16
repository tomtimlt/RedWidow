import { describe, expect, it } from "vitest";
import { parseWindows, WINDOW_CAP } from "../src/logic/windows.js";

describe("parseWindows", () => {
  it("garde une liste valide et ignore john.layout", () => {
    expect(
      parseWindows([
        { kind: "chat", chatId: "c2" },
        { kind: "terminal", chatId: "c2" },
        { kind: "monitor" },
        { kind: "cockpit" },
        { kind: "settings" },
      ]),
    ).toEqual([
      { kind: "chat", chatId: "c2" },
      { kind: "terminal", chatId: "c2" },
      { kind: "monitor" },
      { kind: "cockpit" },
      { kind: "settings" },
    ]);
    expect(parseWindows({ kind: "editor" })).toEqual([]);
  });

  it("refuse les formes invalides, le chat latéral et les singletons doublés", () => {
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
        "chat",
      ]),
    ).toEqual([{ kind: "monitor" }, { kind: "terminal", chatId: "c3" }]);
  });

  it("plafonne la liste", () => {
    const raw = Array.from({ length: WINDOW_CAP + 5 }, (_, i) => ({
      kind: "terminal",
      chatId: `c${i + 2}`,
    }));
    expect(parseWindows(raw)).toHaveLength(WINDOW_CAP);
  });
});
