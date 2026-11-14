// Copie déterministe de Chakra Petch (police d'affichage, licence OFL-1.1) vers `web/assets/fonts/`.
// Usage : node scripts/vendor-fonts.mjs   (`pnpm --filter @warband/server vendor:fonts`)
//
// Pourquoi `web/assets/` : `/media/` exige une session, seul `/assets/` est public. L'écran de connexion
// affiche déjà la police. Seuls les poids 500 et 700, sous-ensembles latin et latin-ext, sont copiés (les
// fichiers sont commités : l'image Docker n'a pas d'étape de build web). Version exacte : `package.json`
// (@fontsource/chakra-petch).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FONTS_DIR = join(HERE, "..", "web", "assets", "fonts");

/** Fichiers woff2 copiés : poids 500 et 700, latin et latin-ext. */
export const FONT_FILES = [
  "chakra-petch-latin-500-normal.woff2",
  "chakra-petch-latin-700-normal.woff2",
  "chakra-petch-latin-ext-500-normal.woff2",
  "chakra-petch-latin-ext-700-normal.woff2",
];

/** Contenu (Buffer) de chaque fichier de `web/assets/fonts/`, calculé depuis `node_modules`. */
export function buildFonts(requireFrom = import.meta.url) {
  const require = createRequire(requireFrom);
  const out = {};
  for (const name of FONT_FILES) {
    out[name] = readFileSync(require.resolve(`@fontsource/chakra-petch/files/${name}`));
  }
  out["LICENSE-chakra-petch.txt"] = readFileSync(
    join(dirname(require.resolve("@fontsource/chakra-petch/package.json")), "LICENSE"),
  );
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(FONTS_DIR, { recursive: true });
  for (const [name, content] of Object.entries(buildFonts())) {
    writeFileSync(join(FONTS_DIR, name), content);
    console.log(`fonts : ${name} (${content.length} octets)`);
  }
}
