// Copie déterministe de Geist (police de l'interface, licence OFL-1.1) depuis l'extension
// (`packages/vscode/media/fonts`) vers `web/assets/fonts/`.
// Usage : node scripts/vendor-fonts.mjs   (`pnpm --filter @warband/server vendor:fonts`)
//
// Pourquoi `web/assets/` : `/media/` exige une session, seul `/assets/` est public ; l'écran de connexion
// affiche donc la même police que la coquille. Les fichiers sont commités : l'image Docker n'a pas d'étape
// de build web.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FONTS_DIR = join(HERE, "..", "web", "assets", "fonts");
const SOURCE_DIR = join(HERE, "..", "..", "vscode", "media", "fonts");

/** Fichiers copiés (nom source = nom de destination). */
export const FONT_FILES = ["geist-latin.woff2", "OFL-Geist.txt"];

/** Contenu (Buffer) de chaque fichier de `web/assets/fonts/`, lu depuis les médias de l'extension. */
export function buildFonts(sourceDir = SOURCE_DIR) {
  const out = {};
  for (const name of FONT_FILES) out[name] = readFileSync(join(sourceDir, name));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(FONTS_DIR, { recursive: true });
  for (const [name, content] of Object.entries(buildFonts())) {
    writeFileSync(join(FONTS_DIR, name), content);
    console.log(`fonts : ${name} (${content.length} octets)`);
  }
}
