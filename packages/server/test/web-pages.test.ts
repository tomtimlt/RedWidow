import { readdirSync, readFileSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createServer } from "../src/http.js";
import {
  renderViewPage,
  VIEW_PAGES,
  withBridge,
  withViewExtras,
  withViewFx,
} from "../src/web/view-page.js";

const webDir = fileURLToPath(new URL("../web", import.meta.url));
const mediaDir = fileURLToPath(new URL("../../vscode/media", import.meta.url));
const ORIGIN = "https://chasse.exemple.fr";
const PASSWORD = "un-mot-de-passe-solide";
const NONCE = "bm9uY2UtZGUtdGVzdC0xMjM=";

/** Tout le texte source de l'interface (HTML, JS, CSS de `web/`). */
function webFiles(dir = webDir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? webFiles(path) : [path];
  });
}

describe("pages de vue", () => {
  it.each([...VIEW_PAGES])(
    "%s : nonce partout, pont avant la page, thème, rien d'inline",
    (view) => {
      const html = renderViewPage(view, { nonce: NONCE });
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length).toBeGreaterThan(1);
      for (const tag of scripts) expect(tag).toContain(`nonce="${NONCE}"`);
      // Pont d'abord : `acquireVsCodeApi` doit exister avant tout script de la page.
      expect(scripts[0]).toContain('src="/bridge.js"');
      expect(html.indexOf("/theme.css")).toBeGreaterThan(-1);
      expect(html.indexOf("/theme.css")).toBeLessThan(html.indexOf("/media/css/base.css"));
      // Feuille d'harmonisation : après base.css et la feuille propre à la page, une seule fois.
      const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
      expect(sheets).toHaveLength(4);
      expect(sheets[0]).toBe("/theme.css");
      expect(sheets[1]).toBe("/media/css/base.css");
      expect(sheets[2]).toMatch(/^\/media\/css\/[a-z]+\.css$/);
      expect(sheets[3]).toBe("/view-extras.css");
      // Aucun script ni style inline, aucun gestionnaire d'événement, aucune ressource distante.
      expect(html).not.toMatch(/<script\b(?![^>]*\bsrc=)/);
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      expect(html).not.toContain("unsafe-inline");
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).toContain("style-src 'self'");
      // Les fichiers viennent de /media/.
      for (const [, src] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        expect(src).toMatch(
          /^\/(media\/|bridge\.js$|chat-extras\.js$|view-fx\.js$|theme\.css$|view-extras\.css$)/,
        );
      }
    },
  );

  it("le mode du viewer est celui demandé", () => {
    expect(renderViewPage("viewer", { nonce: NONCE, mode: "report" })).toContain(
      'data-kind="report"',
    );
    expect(renderViewPage("viewer", { nonce: NONCE })).toContain('data-kind="monitor"');
  });

  it("withViewExtras suit la dernière feuille, ne touche pas une page sans feuille", () => {
    const html =
      '<head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css"></head><body></body>';
    const out = withViewExtras(html);
    expect(out.indexOf("/view-extras.css")).toBeGreaterThan(out.indexOf("b.css"));
    expect(out.match(/view-extras\.css/g)).toHaveLength(1);
    expect(withViewExtras("<p>rien</p>")).toBe("<p>rien</p>");
  });

  it("withViewFx pose view-fx.js sous le nonce, une fois, avant les scripts de la page, pont devant", () => {
    const out = withViewFx('<script nonce="n" src="a.js"></script>', "n");
    expect(out).toBe(
      '<script nonce="n" src="/view-fx.js"></script>\n<script nonce="n" src="a.js"></script>',
    );
    for (const view of VIEW_PAGES) {
      const scripts = (renderViewPage(view, { nonce: NONCE }).match(/<script\b[^>]*>/g) ?? []).map(
        (t) => /src="([^"]+)"/.exec(t)?.[1],
      );
      expect(
        scripts.filter((src) => src === "/view-fx.js"),
        view,
      ).toHaveLength(1);
      expect(scripts[0]).toBe("/bridge.js");
      expect(scripts[1]).toBe("/view-fx.js");
    }
  });

  it("view-extras.css : aucune valeur hexadécimale, mouvement coupé, aucun effet sur approbations et arrêt d'urgence", () => {
    const css = readFileSync(join(webDir, "view-extras.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--jn-[a-z-]+\s*:/);
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("body.cockpit section:not(.eng-halt)");
    const fx = readFileSync(join(webDir, "view-fx.js"), "utf8");
    expect(fx).toContain("prefers-reduced-motion");
    expect(fx).toContain(".eng-halt, #approvals, .card");
  });

  it("withBridge pose le pont et le thème une seule fois", () => {
    const out = withBridge(
      '<link rel="stylesheet" href="a.css"><script nonce="n" src="a.js"></script>',
      "n",
    );
    expect(out.match(/bridge\.js/g)).toHaveLength(1);
    expect(out.match(/theme\.css/g)).toHaveLength(1);
  });
});

describe("sources de l'interface", () => {
  const sources = webFiles().filter((f) => /\.(html|js|css)$/.test(f));

  it("a des sources à contrôler", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it("pas d'innerHTML ni d'écriture de HTML sur donnée reçue, pas d'eval", () => {
    for (const file of sources.filter((f) => f.endsWith(".js"))) {
      const text = readFileSync(file, "utf8");
      for (const forbidden of [
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "eval(",
        "new Function",
        'setAttribute("style"',
        "setAttribute('style'",
        "localStorage",
      ]) {
        expect(text, `${file} : ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("pas d'attribut style, de 'unsafe-inline' ni de ressource distante dans le HTML, JS et CSS", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(".html")) expect(text, file).not.toMatch(/\sstyle=/);
      expect(text, file).not.toContain("unsafe-inline");
      // Copies d'xterm et de CodeMirror (web/vendor/) : seuls un commentaire de licence, des espaces de
      // noms XML et un préfixe de schéma (`"https://"` + saisie, auto-lien de la saisie Markdown) contiennent
      // une URL, jamais une ressource à charger. Hors vendor, seul l'espace de noms SVG des icônes
      // (`createElementNS`) est admis. Tout autre domaine fait échouer le test.
      const inVendor = file.includes(`${sep}vendor${sep}`);
      const urls = (text.match(/https?:\/\/[^\s"'`)]*/g) ?? []).filter(
        (u) =>
          !(
            u === "http://www.w3.org/2000/svg" ||
            (inVendor &&
              [
                "http://bellard.org/jslinux/",
                "https://github.com/chjj/term.js",
                "http://www.w3.org/1999/xhtml",
                "https://",
              ].includes(u))
          ),
      );
      expect(urls, file).toEqual([]);
    }
  });

  it("chaque script du HTML porte le nonce", () => {
    for (const file of sources.filter((f) => f.endsWith(".html"))) {
      for (const tag of readFileSync(file, "utf8").match(/<script\b[^>]*>/g) ?? []) {
        expect(tag, file).toContain('nonce="{{nonce}}"');
      }
    }
  });
});

// ───────────────────────────── Routes ─────────────────────────────

let base = "";
let cookie = "";
let srv: ReturnType<typeof createServer>;

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  srv = createServer(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir: "/tmp/x",
      webDir,
      publicOrigin: ORIGIN,
      trustProxy: false,
    },
    { passwordHash, mediaDir },
  );
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
});
afterAll(async () => {
  srv.closeAllConnections();
  await new Promise((ok) => srv.close(ok));
});

const get = (path: string, withCookie = true) =>
  fetch(`${base}${path}`, {
    redirect: "manual",
    headers: withCookie ? { Cookie: cookie } : {},
  });

describe("routes /view et /media", () => {
  it("exigent une session", async () => {
    for (const path of [
      "/view/chat?frame=m1",
      "/media/css/base.css",
      "/shell.js",
      "/theme.css",
      "/view-extras.css",
      "/",
    ]) {
      const res = await get(path, false);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    }
  });

  it("sert la page d'une vue avec le même nonce dans l'en-tête et le HTML", async () => {
    const res = await get("/view/chat?frame=m1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
    expect(nonce).not.toBe("");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const body = await res.text();
    const tags = body.match(/<script\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(1);
    for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`);
  });

  it("nonce différent à chaque réponse", async () => {
    const a = (await get("/view/cockpit?frame=a")).headers.get("content-security-policy");
    const b = (await get("/view/cockpit?frame=a")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });

  it("refuse les vues hors liste, les cadres invalides et les modes inconnus", async () => {
    expect((await get("/view/shell?frame=m1")).status).toBe(404);
    expect((await get("/view/term?frame=m1")).status).toBe(404);
    expect((await get("/view/chat")).status).toBe(400);
    expect((await get("/view/chat?frame=a%2Fb")).status).toBe(400);
    expect((await get(`/view/chat?frame=${"x".repeat(65)}`)).status).toBe(400);
    expect((await get("/view/viewer?frame=m1&mode=edit")).status).toBe(400);
    expect((await get("/view/viewer?frame=m1&mode=watch")).status).toBe(200);
  });

  it("n'accepte que GET et HEAD", async () => {
    const res = await fetch(`${base}/view/chat?frame=m1`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(405);
  });

  it("sert les fichiers de media en lecture seule", async () => {
    const css = await get("/media/css/base.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    const font = await get("/media/fonts/geist-latin.woff2");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect((await get("/media/chat.js")).status).toBe(200);
    expect((await get("/media/fonts/OFL-Geist.txt")).status).toBe(404);
    expect((await get("/media/")).status).toBe(404);
    expect((await get("/media/nexiste-pas.js")).status).toBe(404);
  });

  it("refuse la traversée hors de media", async () => {
    const { request } = await import("node:http");
    const status = (path: string) =>
      new Promise<number>((ok, ko) => {
        const u = new URL(base);
        const req = request(
          { host: u.hostname, port: u.port, path, headers: { Cookie: cookie } },
          (res) => {
            res.resume();
            ok(res.statusCode ?? 0);
          },
        );
        req.on("error", ko);
        req.end();
      });
    for (const path of [
      "/media/../package.json",
      "/media/%2e%2e/package.json",
      "/media/css/..%2f..%2fpackage.json",
      "/media/..%5cpackage.json",
      "/media/css/%00.css",
    ]) {
      expect([400, 404], path).toContain(await status(path));
    }
  });

  it("sert la coquille avec le nonce, sans style inline", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    const nonce = /script-src 'nonce-([^']+)'/.exec(
      res.headers.get("content-security-policy") ?? "",
    )?.[1];
    const body = await res.text();
    expect(body).toContain(`nonce="${nonce}"`);
    expect(body).not.toContain("{{nonce}}");
    expect((await get("/shell.js")).headers.get("content-type")).toContain("text/javascript");
    expect((await get("/lib/channel.js")).status).toBe(200);
    expect((await get("/screens/approvals.js")).status).toBe(200);
  });
});
