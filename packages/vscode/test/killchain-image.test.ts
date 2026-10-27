import type { Finding } from "@warband/core";
import { describe, expect, it } from "vitest";
import { killchainImage } from "../src/logic/killchain-image.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const node = (id: string, patch: Partial<Finding> = {}): Finding =>
  ({ id, kind: "host", label: id, state: "confirmed", ...patch }) as Finding;
describe("image de la Kill Chain", () => {
  it("inclut tous les types, les noms longs complets et les arcs verts, arrière et isolés", () => {
    const label = "Nom intégral très long " + "abcdefghij".repeat(10);
    const svg = killchainImage({ name: "Projet complet" }, [
      node("a", { label, from: ["b"] }),
      node("b", { from: ["a"], pathFrom: ["a"], state: "failed" }),
      node("c", { kind: "credential", state: "hypothesis" }),
      node("d", { kind: "loot" }),
      node("e", { kind: "site" }),
      node("f", { kind: "step" }),
    ]);
    expect(svg.match(/rx="10"/g)).toHaveLength(6);
    expect(svg.match(/marker-end=/g)).toHaveLength(2);
    expect(svg).toContain('marker-end="url(#path)"');
    expect(svg).toContain("Identifiant");
    expect(svg).toContain("Loot");
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
      .map((match) => match[1])
      .join("");
    expect(texts.replaceAll(" ", "")).toContain(label.replaceAll(" ", ""));
    expect(svg).not.toContain("…");
  });
  it("échappe les libellés hostiles sans ressource externe ni script et accepte un graphe vide", () => {
    const svg = killchainImage({ name: '<script src="https://test">' }, [
      node("a", {
        label: `<image href="https://test" onload="go()"> & '`,
        note: "secret",
      } as Partial<Finding>),
    ]);
    expect(svg).not.toMatch(/<script|<image|<foreignObject|\shref=["']/);
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("secret");
    expect(killchainImage({ name: "Vide" }, [])).toContain("0 éléments");
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect(parseStudioMessage({ type: "exportKillchain", projectId })).toEqual({
      type: "exportKillchain",
      projectId,
    });
    expect(parseStudioMessage({ type: "exportKillchain", projectId, svg: "<script/>" })).toBeNull();
    expect(parseStudioMessage({ type: "exportKillchain", projectId: "../x" })).toBeNull();
  });
});
