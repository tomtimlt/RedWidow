import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const media = join(__dirname, "..", "media");

// Un seul bouton : « Envoyer » devient « Stop » pendant un tour quand la saisie est vide, et
// redevient « Envoyer » dès qu'il y a du texte ou une pièce jointe. Le bouton d'arrêt séparé
// n'est jamais affiché.
it("un seul bouton : envoi ↔ stop selon la saisie", () => {
  const js = readFileSync(join(media, "chat.js"), "utf8");
  const css = readFileSync(join(media, "css", "chat.css"), "utf8");
  expect(js).toContain(
    "const isStop = !!lastView?.busy && !input.value.trim() && !draftFiles.length;",
  );
  expect(js).toContain('send.type = isStop ? "button" : "submit"');
  expect(css).toMatch(/#toolbar #stop\s*\{\s*display:\s*none/);
});
