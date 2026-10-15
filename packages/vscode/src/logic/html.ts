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
<header id="bar"><span id="title">John</span><span id="sandbox" class="badge" hidden></span><button id="reset" type="button" class="ghost">Nouvelle conversation</button></header>
<main id="log" role="log" aria-live="polite" aria-label="Conversation"></main>
<section id="approvals" aria-label="Autorisations demandées"></section>
<div id="activity" role="status" hidden><span class="spinner" aria-hidden="true"></span>L'agent travaille…</div>
<div id="controls" hidden>
<label class="ctl" for="model-select"><span class="ctl-label">Modèle</span><select id="model-select" title="Modèle utilisé pour le message suivant"></select><input id="model-input" type="text" spellcheck="false" autocomplete="off" placeholder="identifiant du modèle" title="Liste indisponible : saisissez l'identifiant du modèle" hidden></label>
<button id="models-refresh" type="button" class="ghost" title="Actualiser la liste des modèles">Actualiser</button>
<div class="ctl effort"><label for="effort" class="ctl-label">Effort</label><input id="effort" type="range" min="0" max="4" step="1" value="2"><output id="effort-label" for="effort"></output></div>
<div id="effort-ticks" aria-hidden="true"></div>
</div>
<form id="form">
<textarea id="input" rows="1" aria-label="Votre consigne" placeholder="Votre consigne… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"></textarea>
<div id="buttons"><button id="send" type="submit" class="primary">Envoyer</button><button id="stop" type="button" class="stop">Stop</button></div>
</form>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
