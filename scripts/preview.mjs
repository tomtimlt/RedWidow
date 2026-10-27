import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chatHtml, graphHtml, studioHtml } from "../src/views.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4173);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const kind = url.searchParams.get("view") ?? "chat";
      const options = { nonce: "designPreviewLocal", cspSource: origin, scriptUri: `${origin}/media/${kind === "graph" || kind === "settings" ? "studio.js" : "chat.js"}`, uiUri: origin + "/media/ui.js", iconsUri: origin + "/media/icons.js", styleUri: origin + "/media/chat.css" };
      let html = (kind === "graph" ? graphHtml : kind === "settings" ? studioHtml : chatHtml)(options);
      html = html.replace("</head>", `<link rel="stylesheet" href="${origin}/scripts/preview.css"><script nonce="designPreviewLocal" src="${origin}/scripts/bridge.js"><\/script></head>`).replace("</body>", `<script nonce="designPreviewLocal" type="module" src="${origin}/scripts/preview-browser.mjs"><\/script></body>`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    const path = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!["media", "src", "scripts"].some((dir) => path.startsWith(resolve(root, dir) + "/"))) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const data = await readFile(path);
    res.setHeader("Content-Type", { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(path)] ?? "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Aperçu local : http://127.0.0.1:${server.address().port}`));
