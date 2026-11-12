import {
  chatHtml,
  cockpitHtml,
  engagementHtml,
  killchainHtml,
  programHtml,
  sessionsHtml,
  studioHtml,
  type ViewerKind,
  viewerHtml,
} from "@warband/vscode/logic/html";

/** Liste fermée des vues servies sous `/view/<nom>` (une page par cadre `iframe` de la coquille). */
export const VIEW_PAGES = [
  "chat",
  "cockpit",
  "sessions",
  "program",
  "engagement",
  "studio",
  "killchain",
  "viewer",
] as const;
export type ViewPage = (typeof VIEW_PAGES)[number];

export const isViewPage = (value: string): value is ViewPage =>
  (VIEW_PAGES as readonly string[]).includes(value);

/** Modes de la vue `viewer` (paramètre `mode`), `monitor` par défaut. */
export const VIEWER_MODES: readonly ViewerKind[] = ["monitor", "watch", "report"];
export const isViewerMode = (value: string): value is ViewerKind =>
  (VIEWER_MODES as readonly string[]).includes(value);

/** Fichiers de `packages/vscode/media`, servis en lecture seule sous `/media/`. */
const asset = (...parts: string[]): string => ["/media", ...parts].join("/");

export interface ViewPageOptions {
  nonce: string;
  /** Mode du `viewer` ; ignoré pour les autres vues. */
  mode?: ViewerKind;
}

/**
 * Page d'une vue : le HTML de l'extension (mêmes fonctions `*Html`, `cspSource` valant `'self'`), avec le
 * pont (`bridge.js`, avant tout script de la page) et les variables de thème (`theme.css`) insérés sous
 * le même nonce. Les données arrivent par le pont, jamais dans le HTML.
 */
export function renderViewPage(
  view: ViewPage,
  { nonce, mode = "monitor" }: ViewPageOptions,
): string {
  const page = (script: string, style: string) => ({
    nonce,
    cspSource: "'self'",
    i18nUri: asset("i18n.js"),
    iconsUri: asset("icons.js"),
    baseStyleUri: asset("css", "base.css"),
    scriptUri: asset(script),
    styleUri: asset("css", style),
  });
  const spiderUri = asset("spider.js");
  let body: string;
  switch (view) {
    case "chat":
      body = withChatExtras(
        chatHtml({ ...page("chat.js", "chat.css"), uiUri: asset("ui.js"), spiderUri }),
        nonce,
      );
      break;
    case "cockpit":
      body = cockpitHtml(page("cockpit.js", "cockpit.css"));
      break;
    case "sessions":
      body = sessionsHtml(page("sessions.js", "sessions.css"));
      break;
    case "program":
      body = programHtml(page("program.js", "program.css"));
      break;
    case "engagement":
      body = engagementHtml(page("engagement.js", "engagement.css"));
      break;
    case "studio":
      body = studioHtml({ ...page("studio.js", "studio.css"), spiderUri });
      break;
    case "killchain":
      body = killchainHtml({ ...page("studio.js", "killchain.css"), spiderUri });
      break;
    case "viewer":
      body = viewerHtml({ ...page("viewer.js", "viewer.css"), kind: mode, uiUri: asset("ui.js") });
      break;
  }
  return withBridge(body, nonce);
}

/**
 * Ajoute `chat-extras.js` (pièce jointe par dialogue, brouillon de mission) après le dernier script de la
 * page de chat, sous le même nonce : il s'exécute une fois `chat.js` chargé. Même origine, aucun inline.
 */
export function withChatExtras(html: string, nonce: string): string {
  const tag = `<script nonce="${nonce}" src="/chat-extras.js"></script>\n`;
  const end = html.lastIndexOf("</body>");
  return end === -1 ? `${html}\n${tag}` : `${html.slice(0, end)}${tag}${html.slice(end)}`;
}

/** Insère `theme.css` avant la première feuille et `bridge.js` avant le premier script. */
export function withBridge(html: string, nonce: string): string {
  const withTheme = html.replace(
    '<link rel="stylesheet"',
    () => '<link rel="stylesheet" href="/theme.css">\n<link rel="stylesheet"',
  );
  return withTheme.replace(
    "<script ",
    () => `<script nonce="${nonce}" src="/bridge.js"></script>\n<script `,
  );
}
