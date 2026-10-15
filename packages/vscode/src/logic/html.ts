import { randomBytes } from "node:crypto";

/** Nonce CSP aléatoire, nouveau à chaque rendu. */
export const makeNonce = (): string => randomBytes(18).toString("base64url");

export interface ChatHtmlOptions {
  nonce: string;
  /** `webview.cspSource`. */
  cspSource: string;
  /** URI webview de `media/chat.js` et `media/chat.css`. */
  scriptUri: string;
  styleUri: string;
}

/** Valeurs insérées dans des attributs : jamais de guillemet, chevron ni espace. */
const SAFE = /^[A-Za-z0-9_\-+/=:.%~@]+$/;

/**
 * Page de la webview de chat. CSP stricte : `default-src 'none'`, un seul script (fichier de
 * l'extension) autorisé par nonce, feuille de style de l'extension seulement ; ni script inline
 * ni `eval` ni ressource distante. Les données arrivent par `postMessage`, affichées en `textContent`.
 */
export function chatHtml({ nonce, cspSource, scriptUri, styleUri }: ChatHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri })) {
    // `cspSource` peut contenir des espaces ou `'self'` selon l'hôte : on en retire seulement les caractères dangereux.
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok) throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title>John</title>
</head>
<body>
<div id="bar"><span id="sandbox"></span><button id="reset" type="button">Nouvelle conversation</button></div>
<div id="log" role="log" aria-live="polite"></div>
<div id="approvals"></div>
<form id="form">
<textarea id="input" rows="3" placeholder="Votre consigne… (Ctrl+Entrée pour envoyer)"></textarea>
<div id="buttons"><button id="send" type="submit">Envoyer</button><button id="stop" type="button">Stop</button></div>
</form>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
