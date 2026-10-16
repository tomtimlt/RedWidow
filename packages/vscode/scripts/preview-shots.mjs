// Captures de la prévisualisation du chat (manuel, hors `pnpm check`) : Edge headless.
// Usage : node scripts/preview-shots.mjs [--out DIR] [--widths 280,360,520,900] [--themes dark,light,hc]
//         [--states empty,idle,running,approval,model,config,history]
// Génère d'abord les pages : pnpm exec vitest run packages/vscode/test/preview.test.ts
// Binaire : EDGE_BIN, sinon le chemin d'installation par défaut. Vérifie ensuite via --dump-dom
// l'absence de violation CSP (#csp-violation) et de débordement horizontal (#overflow).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const list = (name, def) => arg(name, def).split(",");
const edge =
  process.env.EDGE_BIN ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edge)) throw new Error(`Edge introuvable : ${edge} (définir EDGE_BIN)`);
const pkg = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = arg("out", join(pkg, "preview", "shots"));
mkdirSync(out, { recursive: true });
const widths = list("widths", "280,360,520,900");
const themes = list("themes", "dark,light,hc");
const states = list("states", "idle,running,approval,model,config");

// La page est chargée dans une iframe de la largeur voulue : Edge headless impose ~500 px de fenêtre.
const host = (
  src,
  w,
) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#777"><iframe src="${src}" style="width:${w}px;height:800px;border:0;display:block"></iframe>
<script>addEventListener("message",(e)=>{const d=e.data||{};const add=(id,t)=>{const n=document.createElement("div");n.id=id;n.textContent=t;document.body.append(n);};if(d.csp)add("csp-violation",d.csp);if(d.overflow)add("overflow",d.overflow);if(d.ready)document.body.dataset.ready="1";});</script>`;

let problems = 0;
for (const state of states) {
  for (const theme of themes) {
    for (const w of widths) {
      const hostFile = join(pkg, "preview", `host-${state}-${theme}-${w}.html`);
      writeFileSync(hostFile, host(`${state}-${theme}.html`, w));
      const page = pathToFileURL(hostFile).href;
      const base = [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--virtual-time-budget=3000",
      ];
      const size = `--window-size=${Math.max(w, 500)},800`;
      const file = join(out, `${state}-${theme}-${w}.png`);
      execFileSync(edge, [...base, size, `--screenshot=${file}`, page], { stdio: "ignore" });
      const dom = execFileSync(edge, [...base, size, "--dump-dom", page], {
        encoding: "utf8",
        maxBuffer: 16 << 20,
      });
      const csp = /<div id="csp-violation">([^<]*)/.exec(dom);
      const over = /<div id="overflow">([^<]*)/.exec(dom);
      const ready = dom.includes('data-ready="1"');
      if (csp || over || !ready) {
        problems++;
        console.log(
          `${state}/${theme}/${w}: ${csp ? `CSP ${csp[1]} ` : ""}${over ? `débordement ${over[1]} ` : ""}${ready ? "" : "page non prête"}`,
        );
      }
    }
  }
}
console.log(`captures dans ${out} ; problèmes : ${problems}`);
process.exitCode = problems > 0 ? 1 : 0;
