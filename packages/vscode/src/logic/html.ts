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
<button id="attach" type="button" class="ghost tool-btn" disabled aria-disabled="true" title="Pièces jointes : bientôt" aria-label="Pièces jointes : bientôt"><span class="ico" aria-hidden="true">📎</span></button>
<button id="mention-btn" type="button" class="ghost tool-btn" title="Insérer @ pour citer un conteneur" aria-label="Insérer @ pour citer un conteneur"><span class="ico" aria-hidden="true">@</span></button>
<button id="slash-btn" type="button" class="ghost tool-btn" popovertarget="slash-pop" aria-haspopup="menu" aria-expanded="false" title="Commandes" aria-label="Commandes"><span class="ico" aria-hidden="true">/</span></button>
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
<div id="slash-pop" class="pop" popover="auto" aria-label="Commandes">
<button id="cmd-clear" type="button" class="cmd-opt"><span class="cmd">/clear</span><span class="cmd-desc">Nouvelle conversation</span></button>
<button id="cmd-start" type="button" class="cmd-opt"><span class="cmd">/start &lt;nom&gt;</span><span class="cmd-desc">Ouvre un terminal qui lance le conteneur nommé</span></button>
</div>
<div id="cfg-pop" class="pop" popover="auto" role="dialog" aria-label="Configurer">
<section class="cfg-col" aria-labelledby="cfg-h-reason"><h3 id="cfg-h-reason">Raisonnement</h3>
<div class="effort-row"><label for="effort" class="sr-only">Niveau d'effort</label><input id="effort" type="range" min="0" max="4" step="1" value="2"><button id="effort-auto" type="button" class="ghost" title="Revenir à Auto : le modèle garde son effort par défaut">Auto</button></div>
<div id="effort-ticks" aria-hidden="true"></div>
<div class="effort-now"><output id="effort-label" for="effort"></output></div>
<p id="effort-tip" class="tip"></p></section>
<section class="cfg-col" aria-labelledby="cfg-h-prov"><h3 id="cfg-h-prov">Fournisseur</h3>
<fieldset class="provider"><legend class="sr-only">Fournisseur</legend><label class="radio"><input type="radio" name="provider" checked><span>Claude</span></label><label class="radio off"><input type="radio" name="provider" disabled><span>OpenCode</span><em>bientôt</em></label></fieldset>
<p class="tip">Modèle, effort et plafonds Ultracode : réglages John dans Paramètres (john.model, john.ultracode.*).</p></section>
<section class="cfg-col cfg-later" aria-labelledby="cfg-h-later"><h3 id="cfg-h-later">Bientôt</h3>
<button type="button" class="cfg-off" disabled aria-disabled="true"><span>Mode (Answer, Plan, Auto)</span><em>bientôt</em></button>
<button type="button" class="cfg-off" disabled aria-disabled="true"><span>Bypass</span><em>bientôt</em></button>
<button type="button" class="cfg-off" disabled aria-disabled="true"><span>Persona</span><em>bientôt</em></button>
</section>
</div>
<script nonce="${nonce}" src="${uiUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

export interface CockpitHtmlOptions {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
}

/** Page de la webview cockpit : même CSP que le chat, un seul script `cockpit.js`. */
export function cockpitHtml({ nonce, cspSource, scriptUri, styleUri }: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri })) {
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
<title>Cockpit</title>
</head>
<body class="cockpit">
<header id="bar"><span id="title">Cockpit</span><button id="refresh" type="button" class="ghost" title="Actualiser"><span class="ico" aria-hidden="true">⟳</span><span class="btn-text">Actualiser</span></button></header>
<main id="main" role="main" aria-live="polite"></main>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

/** Page des réglages : même CSP, script `studio.js`. */
export function studioHtml({ nonce, cspSource, scriptUri, styleUri }: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri })) {
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
<title>Réglages</title>
</head>
<body class="studio">
<div class="studio-shell">
<nav id="studio-nav" aria-label="Réglages"></nav>
<main id="studio-main"></main>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

/**
 * Page du terminal latéral Exegol : même CSP que le chat, un seul script `terminal.js` (nonce) et la
 * feuille `terminal.css` de l'extension. Aucune donnée dans la page : elles arrivent par `postMessage`.
 */
export function terminalHtml({
  nonce,
  cspSource,
  scriptUri,
  styleUri,
}: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri })) {
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
<title>Terminal</title>
</head>
<body class="terminal">
<header id="bar"><span id="title">Terminal</span><span id="container" class="badge" hidden></span><button id="clear" type="button" class="ghost" title="Efface l'affichage local seulement : la conversation n'est pas modifiée">Effacer</button></header>
<div id="tabs" role="tablist" aria-label="Sessions du terminal"><button id="tab-agent" type="button" role="tab" class="tab" aria-selected="true" aria-controls="panel-agent" data-tab="agent">agent</button><button id="tab-shell" type="button" role="tab" class="tab" aria-selected="false" aria-controls="panel-shell" aria-disabled="true" data-tab="shell">shell<em>bientôt</em></button></div>
<section id="panel-agent" role="tabpanel" aria-labelledby="tab-agent"><ol id="out" aria-live="polite" aria-label="Commandes Exegol de l'agent"></ol><p id="empty" class="empty">Aucune commande Exegol dans cette conversation.</p></section>
<section id="panel-shell" role="tabpanel" aria-labelledby="tab-shell" hidden><p class="empty">Shell interactif : bientôt. En attendant, il s'ouvre dans le terminal VS Code.</p><button id="open-shell" type="button" class="primary" disabled aria-disabled="true">Ouvrir dans le terminal VS Code</button></section>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
