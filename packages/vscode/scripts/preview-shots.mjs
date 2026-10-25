// Captures de la prévisualisation (manuel, hors `pnpm check`) : Edge (ou Chromium) headless.
// Usage : node scripts/preview-shots.mjs [--out DIR] [--widths 280,360,520,900] [--themes dark,light,hc]
//         [--states empty,running,approval,model,config,cockpit,studio-project,...|all]
// Mode vitrine (images du README) : node scripts/preview-shots.mjs --vitrine [--out DIR] [--height 900]
//         Produit 9 PNG en densité x2, sans bandeau : fenêtre plus grande que le contenu (largeur minimale du headless,
//         barre de chrome) puis recadrage au contenu avec ImageMagick (`convert`, déjà présent, aucune dépendance au dépôt),
//         quantification si le PNG dépasse son plafond. Verticaux (440 px, <= 200 Ko) : chat, accueil et configurer, en sombre
//         et en clair (configurer = popover ouvert sur l'accueil, plafond de hauteur levé dans la prévisualisation seulement).
//         Paysage (1280 x 800, mise en page large, <= 300 Ko) : paysage-chat sombre et clair (état `vitrine-paysage`, conversation
//         raccourcie pour tenir en 800 px) et paysage-configurer sombre.
//         Sortie par défaut : docs/img/ à la racine du dépôt. Les états `vitrine*` viennent de preview.test.ts.
// Génère d'abord les pages : pnpm exec vitest run packages/vscode/test/preview.test.ts
// Binaire : EDGE_BIN, sinon le chemin d'installation par défaut d'Edge (Windows).
// Les pages sont servies en HTTP local (127.0.0.1, port éphémère, lecture seule, arrêté en fin de script) : les masques
// `icon.svg` du logo ne se chargent pas en `file://` (CORS). La CSP des pages est celle de l'extension ; seule la source
// `file:` de la prévisualisation est remplacée, à la volée, par l'origine du serveur (comme l'hôte le fait avec `cspSource`).
// Vérifie via --dump-dom l'absence de violation CSP (#csp-violation) et de débordement horizontal (#overflow).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const vitrine = process.argv.includes("--vitrine");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const list = (name, def) => arg(name, def).split(",");
const edge =
  process.env.EDGE_BIN ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edge)) throw new Error(`Edge introuvable : ${edge} (définir EDGE_BIN)`);
const pkg = fileURLToPath(new URL("..", import.meta.url));
const out = arg(
  "out",
  vitrine ? join(pkg, "..", "..", "docs", "img") : join(pkg, "preview", "shots"),
);
mkdirSync(out, { recursive: true });
const widths = list("widths", "280,360,520,900");
const themes = list("themes", "dark,light,hc");
const ALL = [
  "empty",
  "noprovider",
  "idle",
  "running",
  "approval",
  "model",
  "config",
  "history",
  "mention",
  "cockpit",
  "studio-project",
  "studio-containers",
  "studio-atlas",
  "studio-killchain",
  "vitrine",
  "vitrine-config",
  "vitrine-accueil",
  "vitrine-accueil-config",
  "vitrine-paysage",
];
const requested = arg(
  "states",
  "empty,running,approval,model,config,cockpit,studio-project,studio-containers,studio-atlas,studio-killchain",
);
const states = requested === "all" ? ALL.slice(0, -5) : requested.split(",");
for (const s of states) if (!ALL.includes(s)) throw new Error(`état inconnu : ${s}`);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const SAFE_NAME = /^[A-Za-z0-9_-]+\.(html|css|js|svg)$/;

/** Recadre la capture (x2) à la taille exacte de l'iframe, puis quantifie sans perte visible si le PNG dépasse `maxKo` Ko. */
async function finish(file, w, h, maxKo = 200) {
  await run("convert", [file, "-crop", `${w * 2}x${h * 2}+0+0`, "+repage", file]);
  if (statSync(file).size > maxKo * 1024)
    await run("convert", [file, "-colors", "128", "-define", "png:compression-level=9", file]);
}

// La page est chargée dans une iframe de la largeur voulue (Edge headless impose ~500 px de fenêtre minimum) et de la
// hauteur de la fenêtre : une iframe plus haute que la zone visible coupe le composer en bas de la capture.
const host = (
  src,
  w,
  h = 0,
) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#777"><iframe src="${src}" style="width:${w}px;height:${h > 0 ? `${h}px` : "100vh"};border:0;display:block"></iframe>
<script>addEventListener("message",(e)=>{const d=e.data||{};const add=(id,t)=>{const n=document.createElement("div");n.id=id;n.textContent=t;document.body.append(n);};if(d.csp)add("csp-violation",d.csp);if(d.overflow)add("overflow",d.overflow);if(d.ready)document.body.dataset.ready="1";});</script>`;

/** Serveur local en lecture seule : `/preview/*` et `/media/*` (noms simples, sans sous-dossier), plus `/host`. */
function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = `http://${req.headers.host}`;
    const send = (code, type, body) => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    if (req.method !== "GET") return send(405, "text/plain", "méthode refusée");
    if (url.pathname === "/host") {
      const src = url.searchParams.get("src") ?? "";
      const w = Number(url.searchParams.get("w"));
      const h = Number(url.searchParams.get("h") ?? 0);
      if (
        !SAFE_NAME.test(src) ||
        !Number.isInteger(w) ||
        w < 1 ||
        w > 4000 ||
        !Number.isInteger(h) ||
        h < 0 ||
        h > 4000
      )
        return send(400, "text/plain", "paramètres invalides");
      return send(200, TYPES[".html"], host(`/preview/${src}`, w, h));
    }
    if (url.pathname === "/media/fonts/inter-latin.woff2") {
      return send(
        200,
        "font/woff2",
        readFileSync(join(pkg, "media", "fonts", "inter-latin.woff2")),
      );
    }
    const m = /^\/(preview|media)\/([^/]+)$/.exec(url.pathname);
    if (!m || !SAFE_NAME.test(m[2])) return send(404, "text/plain", "introuvable");
    const file = join(pkg, m[1], m[2]);
    if (!existsSync(file)) return send(404, "text/plain", "introuvable");
    let body = readFileSync(file);
    if (m[1] === "preview" && m[2].endsWith(".html"))
      body = body
        .toString("utf8")
        .replace(
          "style-src file:; img-src file:; font-src file:",
          `style-src ${origin}; img-src ${origin}; font-src ${origin}`,
        );
    send(200, TYPES[extname(m[2])], body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
let problems = 0;
const jobs = [];
if (vitrine) {
  const h = Number(arg("height", "900"));
  for (const [state, theme, name] of [
    ["vitrine", "dark", "chat-sombre"],
    ["vitrine", "light", "chat-clair"],
    ["vitrine-accueil", "dark", "accueil-sombre"],
    ["vitrine-accueil", "light", "accueil-clair"],
    ["vitrine-accueil-config", "dark", "configurer-sombre"],
    ["vitrine-accueil-config", "light", "configurer-clair"],
  ])
    jobs.push({ state, theme, w: 440, file: join(out, `${name}.png`), crop: { h } });
  // Paysage (format PC, mise en page large) : fenêtre 1280 x 800, même méthode, PNG <= 300 Ko.
  for (const [state, theme, name] of [
    ["vitrine-paysage", "dark", "paysage-chat-sombre"],
    ["vitrine-paysage", "light", "paysage-chat-clair"],
    ["vitrine-accueil-config", "dark", "paysage-configurer-sombre"],
  ])
    jobs.push({
      state,
      theme,
      w: 1280,
      file: join(out, `${name}.png`),
      crop: { h: 800, maxKo: 300 },
    });
} else {
  for (const state of states)
    for (const theme of themes)
      for (const w of widths)
        jobs.push({ state, theme, w, file: join(out, `${state}-${theme}-${w}.png`) });
}
try {
  for (const { state, theme, w, file, crop } of jobs) {
    const page = `${base}/host?src=${state}-${theme}.html&w=${w}&h=${crop ? crop.h : 0}`;
    const flags = [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--virtual-time-budget=3000",
      `--window-size=${Math.max(w, 500)},${crop ? crop.h + 200 : 800}`,
      ...(crop ? ["--force-device-scale-factor=2"] : []),
    ];
    await run(edge, [...flags, `--screenshot=${file}`, page]);
    if (crop) await finish(file, w, crop.h, crop.maxKo);
    const { stdout: dom } = await run(edge, [...flags, "--dump-dom", page], {
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
} finally {
  server.close();
  server.closeAllConnections();
}
console.log(`captures dans ${out} ; problèmes : ${problems}`);
process.exitCode = problems > 0 ? 1 : 0;
