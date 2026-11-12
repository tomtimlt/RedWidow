// Bundle déterministe de CodeMirror 6 vers `web/vendor/` (lot P2 de l'interface web : fenêtre Fichiers).
// Usage : node scripts/vendor-codemirror.mjs   (`pnpm --filter @warband/server vendor:codemirror`)
//
// Un seul fichier ESM `codemirror.js` (esbuild, minifié, sans carte de sources) réexporte l'API utile à
// l'éditeur : état, vue, commandes, recherche, langages (markdown, JSON, YAML, XML, HTML, JavaScript,
// Python, CSS, shell via `@codemirror/legacy-modes`) et `tags` pour le thème sombre sur mesure de la
// charte (écrit dans `web/lib/files-editor.js`). Versions exactes : voir `package.json` (devDependencies).
//
// CSP (`style-src 'self'`, sans 'unsafe-inline') : CodeMirror injecte ses feuilles de style par
// `style-mod`, qui utilise `document.adoptedStyleSheets` quand il existe (feuilles constructibles, non
// concernées par la CSP). Mais `style-mod` 4.1.4 ne les utilise que pour une racine sans `head` (ShadowRoot) ;
// pour un `Document` il crée un élément `<style>`, bloqué par la CSP. Le correctif retire la condition
// `!root.head` (`patchStyleMod`, un seul site attendu : sinon la copie échoue) : un `Document` accepte
// `adoptedStyleSheets`. Les mises en forme dynamiques de la vue passent par le CSSOM
// (`element.style.x = …`), jamais par l'attribut `style`. Le test d'e2e vérifie l'absence de violation.
// Les fichiers sont servis en `.js` et commités : l'image Docker n'a pas d'étape de build web.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "..");
export const VENDOR_DIR = join(PACKAGE_DIR, "web", "vendor");

/** Point d'entrée du bundle : ce que `files-editor.js` importe, et rien d'autre. */
export const ENTRY = `
export { Compartment, EditorSelection, EditorState } from "@codemirror/state";
export {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
export {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
export { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
export { tags } from "@lezer/highlight";
export { markdown } from "@codemirror/lang-markdown";
export { json } from "@codemirror/lang-json";
export { yaml } from "@codemirror/lang-yaml";
export { xml } from "@codemirror/lang-xml";
export { html } from "@codemirror/lang-html";
export { javascript } from "@codemirror/lang-javascript";
export { python } from "@codemirror/lang-python";
export { css } from "@codemirror/lang-css";
export { shell } from "@codemirror/legacy-modes/mode/shell";
`;

const banner = `// Fichier généré par scripts/vendor-codemirror.mjs : ne pas éditer. CodeMirror 6 (licence MIT, voir LICENSE-codemirror.txt).\n`;

/** Nombre exact de sites corrigés dans style-mod 4.1.4. */
export const EXPECTED_STYLE_SITES = 1;

/** Fait utiliser `adoptedStyleSheets` aussi pour un `Document` : `{ code, count }`. */
export function patchStyleMod(src) {
  let count = 0;
  const code = src.replace(/!([A-Za-z_$][\w$]*)\.head&&\1\.adoptedStyleSheets&&/g, (_m, r) => {
    count += 1;
    return `${r}.adoptedStyleSheets&&`;
  });
  return { code, count };
}

/** Nom du paquet npm d'un chemin de `node_modules` (`@scope/nom` ou `nom`), ou `null`. */
function packageOf(inputPath) {
  const parts = inputPath.split("node_modules/");
  const last = parts.at(-1);
  if (parts.length < 2 || last === undefined) return null;
  const segs = last.split("/");
  return segs[0]?.startsWith("@") ? `${segs[0]}/${segs[1]}` : (segs[0] ?? null);
}

/** Contenu de chaque fichier de `web/vendor/` pour CodeMirror, calculé depuis `node_modules`. */
export function buildVendor(requireFrom = import.meta.url) {
  const require = createRequire(requireFrom);
  const esbuild = require("esbuild");
  const result = esbuild.buildSync({
    // `absWorkingDir` : chemins du métafichier relatifs au paquet, quel que soit le dossier d'appel (script ou test).
    absWorkingDir: PACKAGE_DIR,
    stdin: { contents: ENTRY, resolveDir: PACKAGE_DIR, sourcefile: "codemirror-entry.js" },
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify: true,
    legalComments: "none",
    charset: "utf8",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (out === undefined) throw new Error("codemirror : esbuild n'a produit aucun fichier.");
  const patched = patchStyleMod(out.text);
  if (patched.count !== EXPECTED_STYLE_SITES) {
    throw new Error(
      `codemirror : ${patched.count} site(s) style-mod corrigé(s) (${EXPECTED_STYLE_SITES} attendu). Le correctif CSP doit être revu.`,
    );
  }
  // Racine de chaque paquet embarqué, déduite du chemin réel des sources (dépendances transitives comprises).
  const roots = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    const name = packageOf(input);
    if (name === null) continue;
    const cut = input.lastIndexOf(`node_modules/${name}/`);
    roots.set(name, join(PACKAGE_DIR, input.slice(0, cut + `node_modules/${name}`.length)));
  }
  const licenses = [];
  for (const name of [...roots.keys()].sort()) {
    const dir = roots.get(name);
    const pkgJson = join(dir, "package.json");
    const version = JSON.parse(readFileSync(pkgJson, "utf8")).version;
    licenses.push(
      `== ${name} ${version} ==\n${readFileSync(join(dir, "LICENSE"), "utf8").trim()}\n`,
    );
  }
  return {
    "codemirror.js": banner + patched.code,
    "LICENSE-codemirror.txt": `${licenses.join("\n")}`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(VENDOR_DIR, { recursive: true });
  for (const [name, content] of Object.entries(buildVendor())) {
    writeFileSync(join(VENDOR_DIR, name), content);
    console.log(`vendor : ${name} (${content.length} octets)`);
  }
}
