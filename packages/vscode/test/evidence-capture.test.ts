import { describe, expect, it } from "vitest";
import { evidenceEditorReference, evidenceTerminalAllowed } from "../src/logic/evidence-capture.js";

describe("sources des preuves", () => {
  it("conserve le chemin relatif complet de la sélection", () => {
    expect(evidenceEditorReference("/projet", "/projet/notes/rapport.txt")).toBe(
      "notes/rapport.txt",
    );
    expect(evidenceEditorReference("/projet", "/projet/autre/rapport.txt")).toBe(
      "autre/rapport.txt",
    );
  });
  it.each([
    "/autre/rapport.txt",
    "/projet-voisin/rapport.txt",
    "/projet",
    "/projet/../secret",
    "/projet/nom:invalide",
  ])("refuse une référence extérieure ou invalide : %s", (path) => {
    expect(() => evidenceEditorReference("/projet", path)).toThrow();
  });
  it("n’autorise que les conteneurs de l’allowlist actuelle", () => {
    expect(evidenceTerminalAllowed(["exegol-a"], "exegol-a")).toBe(true);
    expect(evidenceTerminalAllowed(["exegol-a"], "exegol-b")).toBe(false);
    expect(evidenceTerminalAllowed([], "exegol-a")).toBe(false);
    expect(evidenceTerminalAllowed(["exegol-a"], "a")).toBe(false);
  });
});
