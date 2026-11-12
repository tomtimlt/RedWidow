import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope, parseEnvelope } from "../src/bridge/envelope.js";

const ok = { v: 1, view: "chat", frame: "a-1_B", msg: { type: "ready" } };

describe("enveloppe du pont", () => {
  it("accepte la forme exacte et encode à l'identique", () => {
    expect(parseEnvelope(ok)).toEqual(ok);
    expect(decodeEnvelope(encodeEnvelope("shell", "shell", { type: "ready" }))).toEqual({
      v: 1,
      view: "shell",
      frame: "shell",
      msg: { type: "ready" },
    });
  });

  it.each([
    ["version", { ...ok, v: 2 }],
    ["vue inconnue", { ...ok, view: "terminal" }],
    ["cadre vide", { ...ok, frame: "" }],
    ["cadre trop long", { ...ok, frame: "a".repeat(65) }],
    ["cadre avec séparateur", { ...ok, frame: "../x" }],
    ["msg tableau", { ...ok, msg: [] }],
    ["msg nul", { ...ok, msg: null }],
    ["msg chaîne", { ...ok, msg: "ready" }],
    ["champ en trop", { ...ok, extra: 1 }],
    ["champ manquant", { v: 1, view: "chat", frame: "a" }],
    ["tableau", []],
    ["nul", null],
  ])("refuse : %s", (_nom, value) => {
    expect(parseEnvelope(value)).toBeNull();
  });

  it("refuse le binaire et le JSON invalide", () => {
    expect(decodeEnvelope(Buffer.from("{}"))).toBeNull();
    expect(decodeEnvelope("{pas du json")).toBeNull();
    expect(decodeEnvelope("")).toBeNull();
  });
});
