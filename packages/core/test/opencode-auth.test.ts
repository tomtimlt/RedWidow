import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { opencodeAuthFile } from "../src/opencode-auth.js";

describe("chemin du cache OpenCode", () => {
  it("respecte XDG, puis HOME, puis le répertoire de repli", () => {
    expect(opencodeAuthFile({ XDG_DATA_HOME: "/data", HOME: "/home/a" }, "/fallback")).toBe(
      join("/data", "opencode", "auth.json"),
    );
    expect(opencodeAuthFile({ HOME: "/home/a" }, "/fallback")).toBe(
      join("/home/a", ".local", "share", "opencode", "auth.json"),
    );
    expect(opencodeAuthFile({}, "/fallback")).toBe(
      join("/fallback", ".local", "share", "opencode", "auth.json"),
    );
  });
});
