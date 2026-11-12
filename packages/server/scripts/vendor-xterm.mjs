// Copie déterministe d'xterm.js vers `web/vendor/` (lot 5 de l'interface web, ADR 0053).
// Usage : node scripts/vendor-xterm.mjs   (`pnpm --filter @warband/server vendor:xterm`)
//
// Pourquoi un correctif : xterm.js crée des éléments `<style>` par script (rendu DOM et barre de
// défilement). La CSP du serveur (`style-src 'self'`, sans 'unsafe-inline') les bloque. Le correctif
// remplace chaque `X.createElement("style")` par `__rwStyle(X)` : un élément neutre dont l'affectation de
// `textContent` alimente une feuille constructible (`adoptedStyleSheets`), que la CSP n'interdit pas.
// Même raison pour `_addStyle` (couleurs 24 bits, contraste minimum) : `setAttribute("style", …)` est
// bloqué, l'écriture par `element.style.cssText` (CSSOM) ne l'est pas.
// Les fichiers sont copiés en `.js` (le serveur ne connaît pas `.mjs`) et commités : l'image Docker n'a
// pas d'étape de build web. Versions exactes : voir `package.json` (@xterm/xterm, @xterm/addon-fit).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const VENDOR_DIR = join(HERE, "..", "web", "vendor");

/** Nombre exact d'éléments `<style>` créés par xterm 6.0.0 ; tout autre nombre fait échouer la copie. */
export const EXPECTED_STYLE_SITES = 3;

/** Nombre exact d'écritures `setAttribute("style", …)` d'xterm 6.0.0. */
export const EXPECTED_ATTR_SITES = 1;

const ATTR_SITE =
  /([A-Za-z_$][\w$]*)\.setAttribute\("style",`\$\{\1\.getAttribute\("style"\)\|\|""\}\$\{([A-Za-z_$][\w$]*)\};`\)/g;

const STYLE_SITE = /([A-Za-z_$][\w$.]*)\.createElement\("style"\)/g;

const SHIM = `
function __rwStyle(d){const e=d.createElement("span");e.hidden=true;const s=new CSSStyleSheet();let on=false;Object.defineProperty(e,"textContent",{configurable:true,get:()=>"",set(v){s.replaceSync(String(v));if(!on){d.adoptedStyleSheets=[...d.adoptedStyleSheets,s];on=true}}});const rm=e.remove.bind(e);e.remove=()=>{d.adoptedStyleSheets=d.adoptedStyleSheets.filter(x=>x!==s);on=false;rm()};return e}
`;

const banner = (name, version) =>
  `// Fichier généré par scripts/vendor-xterm.mjs : ne pas éditer. ${name} ${version} (licence MIT, voir LICENSE-xterm.txt).\n`;

/** Retire la référence à la carte de sources (non servie). */
const stripMap = (src) => src.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");

/** Applique le correctif CSP à `xterm.mjs` : `{ code, count, attrCount }` (sites remplacés). */
export function patchXterm(src) {
  let count = 0;
  let attrCount = 0;
  const code = stripMap(src)
    .replace(STYLE_SITE, (_m, doc) => {
      count += 1;
      return `__rwStyle(${doc})`;
    })
    .replace(ATTR_SITE, (_m, el, css) => {
      attrCount += 1;
      return `${el}.style.cssText=(${el}.style.cssText||"")+${css}+";"`;
    });
  return { code: code + SHIM, count, attrCount };
}

/** Contenu de chaque fichier de `web/vendor/`, calculé depuis `node_modules`. */
export function buildVendor(requireFrom = import.meta.url) {
  const require = createRequire(requireFrom);
  const read = (spec) => readFileSync(require.resolve(spec), "utf8");
  const version = (pkg) => JSON.parse(read(`${pkg}/package.json`)).version;
  const xv = version("@xterm/xterm");
  const fv = version("@xterm/addon-fit");
  const patched = patchXterm(read("@xterm/xterm/lib/xterm.mjs"));
  if (patched.count !== EXPECTED_STYLE_SITES || patched.attrCount !== EXPECTED_ATTR_SITES) {
    throw new Error(
      `xterm : ${patched.count} élément(s) <style> (${EXPECTED_STYLE_SITES} attendus) et ${patched.attrCount} écriture(s) de l'attribut style (${EXPECTED_ATTR_SITES} attendue). Le correctif CSP doit être revu.`,
    );
  }
  return {
    "xterm.js": banner("@xterm/xterm", xv) + patched.code,
    "xterm-addon-fit.js":
      banner("@xterm/addon-fit", fv) + stripMap(read("@xterm/addon-fit/lib/addon-fit.mjs")),
    "xterm.css": read("@xterm/xterm/css/xterm.css"),
    "LICENSE-xterm.txt": read("@xterm/xterm/LICENSE"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(VENDOR_DIR, { recursive: true });
  for (const [name, content] of Object.entries(buildVendor())) {
    writeFileSync(join(VENDOR_DIR, name), content);
    console.log(`vendor : ${name} (${content.length} octets)`);
  }
}
