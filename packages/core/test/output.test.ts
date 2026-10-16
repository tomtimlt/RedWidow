import { describe, expect, it } from "vitest";
import { capOutput } from "../src/index.js";

describe("capOutput", () => {
  it("laisse intact un texte sous le plafond", () => {
    expect(capOutput("héllo", 100)).toEqual({ output: "héllo", truncated: false, bytes: 6 });
  });

  it("coupe au plafond en octets sans casser un caractère multi-octets", () => {
    const r = capOutput("aé€😀b", 4); // a(1) é(2) €(3) : coupe avant €
    expect(r).toEqual({ output: "aé", truncated: true, bytes: Buffer.byteLength("aé€😀b") });
    expect(Buffer.byteLength(capOutput("x".repeat(100), 10).output)).toBe(10);
  });

  it("applique le plafond par défaut de 64 Kio", () => {
    const r = capOutput("x".repeat(70_000));
    expect(r).toMatchObject({ truncated: true, bytes: 70_000 });
    expect(r.output).toHaveLength(64 * 1024);
  });
});
