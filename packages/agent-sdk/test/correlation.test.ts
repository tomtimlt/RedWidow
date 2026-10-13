import { describe, expect, it } from "vitest";
import { canonicalJson, ToolCallRegistry, toolUseIdFromExtra } from "../src/index.js";

describe("canonicalJson", () => {
  it("ignore l'ordre des clés et les undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: undefined } })).toBe(
      canonicalJson({ a: { d: 1 }, b: 1 }),
    );
  });
});

describe("ToolCallRegistry", () => {
  const call = (n: number) => ({ toolUseId: `t${n}`, eventId: `e${n}` });

  it("apparie par outil + arguments, quel que soit l'ordre", () => {
    const r = new ToolCallRegistry();
    r.register("t", { a: 1 }, call(1));
    r.register("t", { a: 2 }, call(2));
    expect(r.claim("t", { a: 2 })).toEqual(call(2));
    expect(r.claim("t", { a: 1 })).toEqual(call(1));
    expect(r.claim("t", { a: 1 })).toBeUndefined();
  });

  it("FIFO pour des appels identiques", () => {
    const r = new ToolCallRegistry();
    r.register("t", { a: 1 }, call(1));
    r.register("t", { a: 1 }, call(2));
    expect(r.claim("t", { a: 1 })?.toolUseId).toBe("t1");
    expect(r.claim("t", { a: 1 })?.toolUseId).toBe("t2");
  });

  it("se rabat sur le plus ancien appel du même outil si les arguments diffèrent", () => {
    const r = new ToolCallRegistry();
    r.register("t", { a: 1, extra: true }, call(1)); // zod aura retiré `extra`
    expect(r.claim("t", { a: 1 })?.toolUseId).toBe("t1");
  });

  it("ne mélange pas les outils", () => {
    const r = new ToolCallRegistry();
    r.register("x", {}, call(1));
    expect(r.claim("y", {})).toBeUndefined();
  });
});

describe("toolUseIdFromExtra", () => {
  it("lit la clé claudecode/toolUseId de _meta", () => {
    expect(toolUseIdFromExtra({ _meta: { "claudecode/toolUseId": "toolu_1" } })).toBe("toolu_1");
  });

  it("accepte toute clé contenant toolUseId", () => {
    expect(toolUseIdFromExtra({ _meta: { "autre/toolUseId": "t2" } })).toBe("t2");
    expect(toolUseIdFromExtra({ _meta: { toolUseId: "t3" } })).toBe("t3");
  });

  it("renvoie undefined sans identifiant exploitable", () => {
    expect(toolUseIdFromExtra(undefined)).toBeUndefined();
    expect(toolUseIdFromExtra({})).toBeUndefined();
    expect(toolUseIdFromExtra({ _meta: null })).toBeUndefined();
    expect(
      toolUseIdFromExtra({ _meta: { progressToken: 1, toolUseId: 4, x: "y" } }),
    ).toBeUndefined();
    expect(toolUseIdFromExtra({ _meta: { "claudecode/toolUseId": "" } })).toBeUndefined();
  });
});

describe("ToolCallRegistry.claimById", () => {
  const call = (n: number) => ({ toolUseId: `t${n}`, eventId: `e${n}` });

  it("apparie exactement, hors FIFO, et retire l'entrée", () => {
    const r = new ToolCallRegistry();
    r.register("t", { a: 1 }, call(1));
    r.register("t", { a: 1 }, call(2));
    expect(r.claimById("t2")).toEqual(call(2));
    expect(r.claimById("t2")).toBeUndefined();
    expect(r.claim("t", { a: 1 })?.toolUseId).toBe("t1");
    expect(r.claim("t", { a: 1 })).toBeUndefined();
  });

  it("renvoie undefined pour un identifiant inconnu", () => {
    expect(new ToolCallRegistry().claimById("nope")).toBeUndefined();
  });
});
