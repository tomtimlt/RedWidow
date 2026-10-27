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
  /** Catalogue SVG local, chargé avant les scripts de rendu. */
  iconsUri?: string;
}

/** Valeurs insérées dans des attributs : jamais de guillemet, chevron ni espace. */
const SAFE = /^[A-Za-z0-9_\-+/=:.%~@]+$/;

/**
 * Icônes au trait (16 px, `currentColor`), en SVG inline : rendu net et centré quel que soit la police,
 * contrairement aux glyphes Unicode. Aucun attribut d'événement, aucune ressource externe.
 */
const ICONS = {
  loader: '<path d="M20 12a8 8 0 1 1-8-8"/>',
  container: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  brain:
    '<path d="M12 5v14M8 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 2 5 3 3 0 0 0 6 2M16 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-2 5 3 3 0 0 1-6 2"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1zM12 6v14"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  terminal: '<path d="m5 8 4 4-4 4"/><path d="M12 17h7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clip: '<path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6L15.5 7"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  slash: '<path d="M15 4 9 20"/>',
  pulse: '<path d="M3 12h4l2.5-6 5 12L17 12h4"/>',
  killchain: '<path d="M4 5h5v5H4zM15 3h5v7h-5zM7 15h13v6H7z"/><path d="M9 8h1M17 6h1M10 18h8"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  send: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  down: '<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>',
  caret: '<path d="m7 10 5 5 5-5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  sparkle:
    '<path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9z"/>',
  sliders:
    '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
} as const;

const icon = (name: keyof typeof ICONS, cls = "ico"): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

/**
 * Marque Warband : formation de chevrons (chef rouge, deux ailiers acier) et curseur.
 * SVG inline avec classes CSS pour les couleurs de marque. Décoratif : `aria-hidden`.
 */
const BRAND =
  '<svg class="brand" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><polygon points="1,1 4,1 8,5 4,9 1,9 5,5" class="brand-wing"/><polygon points="1,15 4,15 8,19 4,23 1,23 5,19" class="brand-wing"/><polygon points="13,5 16,5 23,12 16,19 13,19 20,12" class="brand-lead"/><rect x="18" y="20" width="5" height="3" class="brand-cursor"/></svg>';

/**
 * Page de la webview de chat. CSP stricte : `default-src 'none'`, trois scripts (fichiers de
 * l'extension) autorisés par nonce, feuille de style de l'extension seulement ; ni script inline
 * ni `eval` ni ressource distante. Les données arrivent par `postMessage`, affichées en `textContent`.
 */
export function chatHtml({
  nonce,
  cspSource,
  scriptUri,
  uiUri,
  styleUri,
  iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"),
}: ChatHtmlOptions): string {
  for (const [name, value] of Object.entries({
    nonce,
    cspSource,
    scriptUri,
    uiUri,
    styleUri,
    iconsUri,
  })) {
    // `cspSource` peut contenir des espaces ou `'self'` selon l'hôte : on en retire seulement les caractères dangereux.
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok) throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title>Warband</title>
</head>
<body>
<header id="bar"><span id="title">${BRAND}<span class="brand-name">Warband</span></span><span id="sandbox" class="badge" hidden></span><span id="bypass-badge" class="badge" hidden></span><span id="learning-badge" class="badge" title="Mode Apprentissage : lecture des cours seule, aucune action" hidden>Apprentissage</span><button id="history-btn" type="button" class="ghost" aria-expanded="false" aria-controls="history" title="Historique des conversations">${icon("history")}<span class="btn-text">Historique</span></button><button id="reset" type="button" class="ghost" title="Nouvelle conversation">${icon("plus")}<span class="btn-text">Nouvelle<span class="btn-more"> conversation</span></span></button></header>
<section id="history" aria-label="Historique des conversations" hidden><div class="hist-head"><strong>Historique</strong><button id="history-clear" type="button" class="ghost">Tout effacer</button><button id="history-close" type="button" class="ghost icon-btn" title="Fermer l'historique (Échap)" aria-label="Fermer l'historique">${icon("close")}</button></div><ul id="history-list"></ul></section>
<main id="log" role="log" aria-live="polite" aria-label="Conversation"></main>
<div id="no-provider" role="status" hidden><span id="no-provider-text">Aucun fournisseur n'a été ajouté. Ajoute un jeton pour utiliser le chat.</span><button id="no-provider-add" type="button" class="primary">Ajouter un fournisseur</button></div>
<div id="readonly" role="status" hidden><span id="readonly-text"></span><button id="readonly-resume" type="button" class="primary">Reprendre</button><button id="readonly-close" type="button" class="ghost">Fermer</button></div>
<section id="monitor" aria-label="Commandes Exegol (lecture seule)"><div class="mon-head"><p class="hint">Sortie en direct. Cliquer une ligne pour l'ouvrir en lecture seule.</p><button id="monitor-follow" type="button" class="ghost" aria-label="Suivi du bas" aria-pressed="true" title="Désactiver le suivi du bas pour défiler librement">${icon("down")}</button></div><ol id="monitor-rows"></ol><p id="monitor-empty" class="empty">Aucun appel Exegol dans cette conversation.</p></section>
<section id="approvals" aria-label="Autorisations demandées"></section>
<div id="thinking" role="status">${icon("loader", "ico activity-icon")}<span id="thinking-label">Réflexion</span></div>
<form id="form">
<div id="composer">
<textarea id="input" rows="1" aria-label="Votre consigne" placeholder="Votre consigne…" title="Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne"></textarea>
<div id="toolbar">

<span class="composer-tools"><button id="mention-btn" type="button" class="ghost tool-btn" title="Citer un conteneur" aria-label="Citer un conteneur" aria-haspopup="listbox" aria-expanded="false" aria-controls="mention-pop">${icon("at")}</button>
<button id="hash-btn" type="button" class="ghost tool-btn" title="Citer un terminal" aria-label="Citer un terminal" aria-haspopup="listbox" aria-expanded="false" aria-controls="mention-pop">${icon("hash")}</button>
<button id="slash-btn" type="button" class="ghost tool-btn" popovertarget="slash-pop" aria-haspopup="menu" aria-expanded="false" title="Commandes" aria-label="Commandes">${icon("slash")}</button>
<button id="monitor-btn" type="button" class="ghost tool-btn" title="Monitor" aria-label="Monitor">${icon("pulse")}</button>
<button id="killchain-btn" type="button" class="ghost tool-btn" title="Kill chain" aria-label="Kill chain">${icon("killchain")}</button>
</span>
<span id="ctl-group" hidden><button id="model-chip" type="button" class="chip" popovertarget="model-pop" aria-haspopup="listbox" aria-expanded="false" title="Modèle utilisé pour le message suivant">${icon("sparkle", "ico chip-ico")}<span id="model-chip-label" class="chip-label">Modèle par défaut</span>${icon("caret", "caret")}<span class="sr-only"> (choisir le modèle)</span></button></span>

<span class="spacer"></span><button id="cfg-btn" type="button" class="chip" popovertarget="cfg-pop" aria-haspopup="dialog" aria-expanded="false" aria-label="Configurer" title="Configurer : raisonnement et exécution">${icon("sliders", "ico chip-ico")}<span class="cfg-text">Configurer</span><span id="cfg-level" class="cfg-level"></span>${icon("caret", "caret")}</button>
<button id="stop" type="button" class="danger" title="Arrêter l'agent">${icon("stop")}<span class="btn-text">Stop</span></button>
<button id="send" type="submit" class="primary" title="Envoyer (Entrée)" aria-label="Envoyer">${icon("send")}</button>
</div>
</div>
</form>
<div id="model-pop" class="pop" popover="auto" aria-label="Choisir le modèle">
<p id="models-status" class="tip" role="status" aria-live="polite" hidden></p>
<input id="model-filter" type="text" role="combobox" aria-controls="model-list" aria-expanded="true" aria-autocomplete="list" aria-label="Filtrer les modèles" placeholder="Filtrer les modèles…" spellcheck="false" autocomplete="off">
<input id="model-input" type="text" aria-label="Identifiant du modèle" placeholder="identifiant du modèle" title="Liste indisponible : saisissez l'identifiant du modèle" spellcheck="false" autocomplete="off" hidden>
<div id="model-list" role="listbox" aria-label="Modèles"></div>
<div class="pop-foot"><button id="models-connect" type="button" class="ghost" hidden>Configurer la connexion</button><button id="models-refresh" type="button" class="ghost" title="Actualiser la liste des modèles">Actualiser la liste</button></div>
</div>
<div id="mention-pop" class="pop" popover="auto" aria-label="Conteneurs"><div id="mention-list" role="listbox" aria-label="Conteneurs"></div><p id="mention-empty" class="tip" hidden>Aucun conteneur</p></div>
<div id="slash-pop" class="pop" popover="auto" aria-label="Commandes">
<button id="cmd-clear" type="button" class="cmd-opt"><span class="cmd">/clear</span><span class="cmd-desc">Nouvelle conversation</span></button>
</div>
<div id="cfg-pop" class="pop" popover="auto" role="dialog" aria-label="Configurer">
<section class="cfg-col cfg-model" aria-labelledby="cfg-h-reason"><h3 id="cfg-h-reason">${icon("brain")}Modèle et raisonnement</h3>
<div class="cfg-provider"><label for="provider">Fournisseur</label><select id="provider" aria-describedby="provider-help"><option value="claude">Claude</option><option value="openai">OpenAI (ChatGPT / API)</option><option value="opencode">OpenCode</option></select></div>
<button id="provider-connect" type="button" class="ghost">Configurer la connexion</button>
<p id="provider-help" class="tip">OpenAI : ChatGPT utilise l'authentification Codex via OpenCode. Une clé API utilise le mode hôte natif. Le CLI codex n'est pas utilisé.</p>
<div class="effort-now">Effort : <output id="effort-label" for="effort"></output></div>
<label for="effort" class="sr-only">Niveau d'effort</label>
<div id="effort-scale"><input id="effort" type="range" min="0" max="4" step="1" value="2" aria-describedby="effort-tip"></div>
<div class="effort-row"><button id="effort-auto" type="button" class="ghost" title="Revenir à Auto : le modèle garde son effort par défaut">Auto</button></div>
<p id="effort-tip" class="tip"></p></section>
<section class="cfg-col cfg-execution" aria-labelledby="cfg-h-execution"><h3 id="cfg-h-execution">${icon("sliders")}Exécution</h3>
<div class="cfg-control"><button id="learning-switch" type="button" role="switch" aria-checked="false" aria-describedby="learning-help"><span class="cfg-switch-label">${icon("book")}Apprentissage</span></button>
<p id="learning-help" class="tip">Lecture des cours et explications, sans exécution ni écriture. S'applique au message suivant.</p></div>
<div class="cfg-control"><button id="bypass-switch" type="button" role="switch" aria-checked="false" aria-describedby="bypass-state bypass-warn"><span class="cfg-switch-label">${icon("shield")}Bypass</span></button>
<p id="bypass-state" role="status"></p>
<p id="bypass-warn" class="tip"><span class="warn-line">Approuve tout pendant 2 h, deny compris : chemins sensibles ou hors projet, accès hôte d'un conteneur, dangers shell, sans rien mémoriser.</span> <span class="warn-line">Vous en devenez responsable.</span></p></div></section>
</div>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${uiUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

export interface CockpitHtmlOptions {
  iconsUri?: string;
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
}

/** Page de la webview cockpit : même CSP que le chat, un seul script `cockpit.js`. */
export function cockpitHtml({
  nonce,
  cspSource,
  scriptUri,
  styleUri,
  iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"),
}: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri, iconsUri })) {
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok) throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title>Conteneurs</title>
</head>
<body class="cockpit">
<header id="bar"><span id="title">${icon("container")}Conteneurs</span><button id="refresh" type="button" class="ghost" title="Actualiser">${icon("refresh")}<span class="btn-text">Actualiser</span></button></header>
<main id="main" role="main" aria-live="polite"></main>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

/** Page des réglages : même CSP, script `studio.js`. */
export function studioHtml({
  nonce,
  cspSource,
  scriptUri,
  styleUri,
  iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"),
}: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri, iconsUri })) {
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok) throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`,
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
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

/** Kill chain plein écran : même script que les réglages, sans navigation latérale. */
export function killchainHtml({
  nonce,
  cspSource,
  scriptUri,
  styleUri,
  iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"),
}: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri, iconsUri })) {
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok) throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title>Kill chain</title>
</head>
<body class="studio killchain-full">
<div class="studio-shell">
<main id="studio-main"></main>
</div>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
