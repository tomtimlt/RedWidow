import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const media = join(__dirname, "..", "media");

// Pendant un tour, le bouton d'envoi devient « Arrêter » (saisie vide) : le bouton d'arrêt séparé
// doit alors être caché, sinon deux carrés d'arrêt s'affichent côte à côte.
it("un seul bouton d'arrêt visible quand l'envoi fait office d'arrêt", () => {
  const js = readFileSync(join(media, "chat.js"), "utf8");
  const css = readFileSync(join(media, "css", "chat.css"), "utf8");
  expect(js).toContain('document.body.classList.toggle("send-is-stop", isStop)');
  expect(css).toMatch(/body\.send-is-stop #toolbar #stop\s*\{\s*display:\s*none/);
});
