import { randomBytes } from "node:crypto";

/** Nonce CSP aléatoire, nouveau à chaque rendu. */
export const makeNonce = (): string => randomBytes(18).toString("base64url");

export interface ChatHtmlOptions {
  nonce: string;
  /** `webview.cspSource`. */
  cspSource: string;
  /** URI webview de `media/chat.js`, `media/ui.js` (logique pure, chargée avant) et `media/chat.css`. */
  scriptUri: string;
  uiUri: string;
  styleUri: string;
}

/** Valeurs insérées dans des attributs : jamais de guillemet, chevron ni espace. */
const SAFE = /^[A-Za-z0-9_\-+/=:.%~@]+$/;

/** Trames du spinner braille : une par ligne d'une bande verticale, déplacée par `transform` (CSS). */
const BRAILLE = [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"].map((c) => `<span>${c}</span>`).join("");

/**
 * Page de la webview de chat. CSP stricte : `default-src 'none'`, deux scripts (fichiers de
 * l'extension) autorisés par nonce, feuille de style de l'extension seulement ; ni script inline
 * ni `eval` ni ressource distante. Les données arrivent par `postMessage`, affichées en `textContent`.
 */
export function chatHtml({
  nonce,
  cspSource,
  scriptUri,
  uiUri,
  styleUri,
}: ChatHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, uiUri, styleUri })) {
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
<header id="bar"><span id="title">John</span><span id="sandbox" class="badge" hidden></span><button id="history-btn" type="button" class="ghost" aria-expanded="false" aria-controls="history" title="Historique des conversations"><span class="ico" aria-hidden="true">☰</span><span class="btn-text">Historique</span></button><button id="reset" type="button" class="ghost" title="Nouvelle conversation"><span class="ico" aria-hidden="true">+</span><span class="btn-text">Nouvelle<span class="btn-more"> conversation</span></span></button></header>
<section id="history" aria-label="Historique des conversations" hidden><div class="hist-head"><strong>Historique</strong><button id="history-clear" type="button" class="ghost">Tout effacer</button></div><ul id="history-list"></ul></section>
<main id="log" role="log" aria-live="polite" aria-label="Conversation"></main>
<div id="readonly" role="status" hidden><span id="readonly-text"></span><button id="readonly-resume" type="button" class="primary">Reprendre</button><button id="readonly-close" type="button" class="ghost">Fermer</button></div>
<section id="approvals" aria-label="Autorisations demandées"></section>
<div id="thinking" role="status"><span class="spin" aria-hidden="true"><span class="spin-strip">${BRAILLE}</span></span><span class="spin-static" aria-hidden="true">…</span><span id="thinking-label">Réflexion</span><span class="cursor" aria-hidden="true">▍</span></div>
<form id="form">
<div id="composer"><span class="sweep" aria-hidden="true"></span>
<textarea id="input" rows="1" aria-label="Votre consigne" placeholder="Votre consigne…" title="Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne"></textarea>
<div id="toolbar">
<span id="ctl-group" hidden><button id="model-chip" type="button" class="chip" popovertarget="model-pop" aria-haspopup="listbox" aria-expanded="false" title="Modèle utilisé pour le message suivant"><span class="ico" aria-hidden="true">◈</span><span id="model-chip-label" class="chip-label">Modèle par défaut</span><span class="caret" aria-hidden="true">▾</span><span class="sr-only"> (choisir le modèle)</span></button><button id="cfg-btn" type="button" class="chip" popovertarget="cfg-pop" aria-haspopup="dialog" aria-expanded="false" aria-label="Configurer" title="Configurer : raisonnement et exécution"><span class="ico" aria-hidden="true">⚙</span><span class="cfg-text">Configurer</span><span id="cfg-level" class="cfg-level"></span><span class="caret" aria-hidden="true">▾</span></button></span>
<span class="spacer"></span>
<button id="stop" type="button" class="danger" title="Arrêter l'agent"><span class="ico" aria-hidden="true">■</span><span class="btn-text">Stop</span></button>
<button id="send" type="submit" class="primary" title="Envoyer (Entrée)"><span class="ico" aria-hidden="true">↑</span><span class="btn-text">Envoyer</span></button>
</div>
</div>
</form>
<div id="model-pop" class="pop" popover="auto" aria-label="Choisir le modèle">
<input id="model-filter" type="text" role="combobox" aria-controls="model-list" aria-expanded="true" aria-autocomplete="list" aria-label="Filtrer les modèles" placeholder="Filtrer les modèles…" spellcheck="false" autocomplete="off">
<input id="model-input" type="text" aria-label="Identifiant du modèle" placeholder="identifiant du modèle" title="Liste indisponible : saisissez l'identifiant du modèle" spellcheck="false" autocomplete="off" hidden>
<div id="model-list" role="listbox" aria-label="Modèles"></div>
<div class="pop-foot"><button id="models-refresh" type="button" class="ghost" title="Actualiser la liste des modèles">Actualiser la liste</button></div>
</div>
<div id="cfg-pop" class="pop" popover="auto" role="dialog" aria-label="Configurer">
<div class="cfg-cols">
<section class="cfg-col" aria-labelledby="cfg-h-reason"><h3 id="cfg-h-reason">Raisonnement</h3>
<div class="effort-row"><label for="effort" class="sr-only">Niveau d'effort</label><input id="effort" type="range" min="0" max="4" step="1" value="2"><button id="effort-auto" type="button" class="ghost" title="Revenir à Auto : le modèle garde son effort par défaut">Auto</button></div>
<div id="effort-ticks" aria-hidden="true"></div>
<div class="effort-now"><output id="effort-label" for="effort"></output></div>
<p id="effort-tip" class="tip"></p></section>
<section class="cfg-col" aria-labelledby="cfg-h-exec"><h3 id="cfg-h-exec">Exécution</h3>
<fieldset class="provider"><legend>Fournisseur</legend><label class="radio"><input type="radio" name="provider" checked><span>Claude</span></label><label class="radio off"><input type="radio" name="provider" disabled><span>OpenCode</span><em>bientôt</em></label></fieldset>
<p class="tip">Modèle, effort et plafonds Ultracode : réglages John dans Paramètres (john.model, john.ultracode.*).</p></section>
</div>
</div>
<script nonce="${nonce}" src="${uiUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
