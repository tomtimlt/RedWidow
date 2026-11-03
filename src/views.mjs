import { randomBytes } from "node:crypto";
export const PALETTES = [
  ["sentinelle", "Sentinelle", "Sarcelle et ardoise : veille, terminal, sécurité"],
  ["widow", "Widow", "Noir profond et cramoisi : la marque RedWidow"],
  ["braise", "Braise", "Cramoisi et acier : la marque d'origine, plus offensive"],
  ["venom", "Venin", "Vert toxique sur acier : terminal, offensif"],
  ["arctic", "Arctique", "Bleu glacier : froid, net, défensif"],
  ["spectre", "Spectre", "Violet et glace : agents, recherche, nuit"],
  ["ultraviolet", "Ultraviolet", "Violet électrique : nuit, IA, laboratoire"],
  ["tactical", "Tactique", "Olive et kaki : terrain, opérations"],
  ["aurora", "Aurore", "Dégradé cyan, bleu et violet"],
  ["synthwave", "Synthwave", "Dégradé rose, violet et bleu"],
  ["toxic", "Toxique", "Dégradé lime, vert et cyan"],
  ["bloodmoon", "Lune de sang", "Dégradé cramoisi, magenta et violet"],
  ["ocean", "Abysse", "Dégradé sarcelle, bleu et indigo"],
  ["nebula", "Nébuleuse", "Dégradé rose, violet et cyan"],
  ["multi", "Multicolore", "Six teintes, une par rôle : corail, vert, cyan, bleu, violet et rose"],
  ["editeur", "Éditeur", "Accent du thème VS Code : intégration maximale"]
];
const paletteOf = (value) => PALETTES.some(([key]) => key === value) ? value : PALETTES[0][0];
export const makeNonce = () => randomBytes(18).toString("base64url");
const SAFE = /^[A-Za-z0-9_\-+/=:.%~@]+$/;
// Pictogrammes : emplacements remplis par media/icons.js, source unique des tracés.
const ICONS = new Set(["loader", "space", "brain", "book", "shield", "history", "plus", "close", "terminal", "folder", "clip", "at", "hash", "slash", "pulse", "graph", "stop", "send", "down", "caret", "refresh", "sparkle", "sliders", "search", "check", "bolt", "play", "chevronRight"]);
const icon = (name, cls = "ico") => {
  if (!ICONS.has(name)) throw new Error(`pictogramme inconnu : ${name}`);
  return `<svg class="${cls}" data-icon="${name}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"></svg>`;
};
// Logo : crochets de visée (offensif) verrouillés sur une étincelle (l'IA), avec un
// satellite (l'agent). Pendant la réflexion : verrouillage, pulsation, orbite.
export const BRAND_SHAPES = '<path class="brand-wing" d="M3 8.5V3h5.5M15.5 3H21v5.5M21 15.5V21h-5.5M8.5 21H3v-5.5"/><g class="brand-core"><path class="brand-lead" d="M12 5c.8 3.9 3.1 6.2 7 7-3.9.8-6.2 3.1-7 7-.8-3.9-3.1-6.2-7-7 3.9-.8 6.2-3.1 7-7z"/></g><g class="brand-orbit"><circle class="brand-node" cx="17.4" cy="6.6" r="1.3"/></g>';
const BRAND = `<svg class="brand" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${BRAND_SHAPES}</svg>`;
export function chatHtml({ nonce, cspSource, scriptUri, uiUri, styleUri, iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"), palette }) {
  for (const [name, value] of Object.entries({
    nonce,
    cspSource,
    scriptUri,
    uiUri,
    styleUri,
    iconsUri
  })) {
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok)
      throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`
  ].join("; ");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title>Venator Ops</title>
</head>
<body data-palette="${paletteOf(palette)}">
<header id="bar"><span id="title">${BRAND}<span class="brand-name">Venator<span class="brand-ops"> Ops</span></span></span><button id="roe" type="button" class="roe" popovertarget="cfg-pop" aria-haspopup="dialog" title="Règles d'engagement : ouvrir Configurer" hidden><span class="roe-gauge" aria-hidden="true"><i></i><i></i><i></i></span><span class="roe-text"><span class="roe-kicker" aria-hidden="true">ROE</span><span id="roe-label">Supervisé</span></span><span id="roe-left" class="roe-left" aria-hidden="true"></span></button><span id="sandbox" class="badge" hidden></span><span id="automatic-badge" class="badge" hidden></span><span id="learning-badge" class="badge" title="Mode Apprentissage : lecture des cours seule, aucune action" hidden>Apprentissage</span><button id="history-btn" type="button" class="ghost" aria-expanded="false" aria-controls="history" title="Historique des conversations">${icon("history")}<span class="btn-text">Historique</span></button><button id="reset" type="button" class="ghost" title="Nouvelle conversation">${icon("plus")}<span class="btn-text">Nouvelle<span class="btn-more"> conversation</span></span></button></header>
<nav id="mission" aria-label="Progression de la mission" hidden><ol id="mission-steps"></ol></nav>
<section id="history" aria-label="Historique des conversations" hidden><div class="hist-head"><strong>Historique</strong><button id="history-clear" type="button" class="ghost">Tout effacer</button><button id="history-close" type="button" class="ghost icon-btn" title="Fermer l'historique (Échap)" aria-label="Fermer l'historique">${icon("close")}</button></div><ul id="history-list"></ul></section>
<nav id="timeline" aria-label="Navigation dans les messages" hidden><button id="timeline-older" type="button" class="ghost">Précédents</button><button id="timeline-newer" type="button" class="ghost">Suivants</button><button id="timeline-latest" type="button" class="ghost">Revenir au direct</button><span id="timeline-status" role="status"></span></nav>
<main id="log" role="log" aria-live="polite" aria-label="Conversation"></main>
<div id="no-provider" role="status" hidden><span id="no-provider-text">Aucun fournisseur n'a été ajouté. Ajoute un jeton pour utiliser le chat.</span><button id="no-provider-add" type="button" class="primary">Ajouter un fournisseur</button></div>
<div id="readonly" role="status" hidden><span id="readonly-text"></span><button id="readonly-resume" type="button" class="primary">Reprendre</button><button id="readonly-close" type="button" class="ghost">Fermer</button></div>
<section id="monitor" aria-label="Commandes Atelier (lecture seule)"><div class="mon-head"><div class="mon-title"><span class="mon-live" aria-hidden="true"></span><strong>Monitor</strong><span id="monitor-count" class="mon-count"></span><span id="mission-clock" class="mon-clock" title="Temps écoulé depuis le début de l'activité" aria-hidden="true"></span></div><p class="hint">Sortie en direct. Cliquer une entrée pour la suivre en lecture seule.</p><button id="monitor-follow" type="button" class="ghost" aria-label="Suivi du bas" aria-pressed="true" title="Désactiver le suivi du bas pour défiler librement">${icon("down")}<span class="btn-text">Suivi</span></button><div id="monitor-strip" class="mon-strip" role="group" aria-label="Frise des commandes"></div></div><ol id="monitor-rows"></ol><div id="monitor-empty" class="empty"><span class="mon-empty-ico">${icon("pulse")}</span><span>Aucun appel Atelier dans cette conversation.</span><span class="mon-empty-sub">Les commandes lancées par l’agent apparaîtront ici en direct.</span></div></section>
<section id="approvals" aria-label="Autorisations demandées"></section>
<div id="thinking" role="status"><svg class="brand thinking-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${BRAND_SHAPES}</svg><span id="thinking-label">Réflexion</span><span id="thinking-clock" class="thinking-clock" aria-hidden="true"></span><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
<form id="form">
<div id="composer">
<textarea id="input" rows="1" aria-label="Votre consigne" placeholder="Votre consigne…" title="Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne"></textarea>
<div id="toolbar">

<span class="composer-tools"><button id="mention-btn" type="button" class="ghost tool-btn" title="Citer un espace" aria-label="Citer un espace" aria-haspopup="listbox" aria-expanded="false" aria-controls="mention-pop">${icon("at")}</button>
<button id="hash-btn" type="button" class="ghost tool-btn" title="Citer un terminal" aria-label="Citer un terminal" aria-haspopup="listbox" aria-expanded="false" aria-controls="mention-pop">${icon("hash")}</button>
<button id="slash-btn" type="button" class="ghost tool-btn" popovertarget="slash-pop" aria-haspopup="menu" aria-expanded="false" title="Commandes" aria-label="Commandes">${icon("slash")}</button>
<button id="monitor-btn" type="button" class="ghost tool-btn" title="Monitor" aria-label="Monitor">${icon("pulse")}</button>
<button id="graph-btn" type="button" class="ghost tool-btn" title="Graphe" aria-label="Graphe">${icon("graph")}</button>
</span>
<span id="ctl-group" hidden><button id="model-chip" type="button" class="chip" popovertarget="model-pop" aria-haspopup="listbox" aria-expanded="false" title="Modèle utilisé pour le message suivant">${icon("sparkle", "ico chip-ico")}<span id="model-chip-label" class="chip-label">Modèle par défaut</span>${icon("caret", "caret")}<span class="sr-only"> (choisir le modèle)</span></button></span>

<span class="spacer"></span><button id="cfg-btn" type="button" class="chip" popovertarget="cfg-pop" aria-haspopup="dialog" aria-expanded="false" aria-label="Configurer" title="Configurer : raisonnement et exécution">${icon("sliders", "ico chip-ico")}<span class="cfg-text">Configurer</span><span id="cfg-level" class="cfg-level"></span>${icon("caret", "caret")}</button>
<button id="stop" type="button" class="danger" title="Arrêter l'agent">${icon("stop")}<span class="btn-text">Stop</span></button>
<button id="send" type="submit" class="primary" title="Envoyer (Entrée)" aria-label="Envoyer">${icon("send")}</button>
</div>
</div>
</form>
<div id="model-pop" class="pop" popover="auto" aria-labelledby="model-pop-title">
<div class="pop-head"><span id="model-pop-title" class="pop-title">${icon("sparkle", "ico pop-title-ico")}Modèle</span><span class="pop-sub">Pour le message suivant</span></div>
<p id="models-status" class="tip" role="status" aria-live="polite" hidden></p>
<div class="pop-search">${icon("search", "ico pop-search-ico")}<input id="model-filter" type="text" role="combobox" aria-controls="model-list" aria-expanded="true" aria-autocomplete="list" aria-label="Filtrer les modèles" placeholder="Filtrer les modèles…" spellcheck="false" autocomplete="off"></div>
<input id="model-input" type="text" aria-label="Référence du modèle" placeholder="identifiant du modèle" title="Liste indisponible : saisissez l'identifiant du modèle" spellcheck="false" autocomplete="off" hidden>
<div id="model-list" role="listbox" aria-label="Modèles"></div>
<div class="pop-foot"><button id="models-connect" type="button" class="ghost" hidden>Configurer la connexion</button><button id="models-refresh" type="button" class="ghost" title="Actualiser la liste des modèles">${icon("refresh")}<span id="models-refresh-label">Actualiser la liste</span></button></div>
</div>
<div id="mention-pop" class="pop" popover="auto" aria-label="Espaces"><div id="mention-list" role="listbox" aria-label="Espaces"></div><p id="mention-empty" class="tip" hidden>Aucun espace</p></div>
<div id="slash-pop" class="pop" popover="auto" aria-label="Commandes">
<button id="cmd-clear" type="button" class="cmd-opt"><span class="cmd">/clear</span><span class="cmd-desc">Nouvelle conversation</span></button>
</div>
<div id="cfg-pop" class="pop" popover="auto" role="dialog" aria-labelledby="cfg-pop-title">
<div class="pop-head"><span id="cfg-pop-title" class="pop-title">${icon("sliders", "ico pop-title-ico")}Configurer</span><span class="pop-sub sr-only">S'applique au message suivant</span></div>
<section class="cfg-col cfg-model" aria-labelledby="cfg-h-reason"><h3 id="cfg-h-reason" class="sr-only">Modèle et raisonnement</h3>
<div class="cfg-provider"><label for="provider">Fournisseur</label><select id="provider" aria-describedby="provider-help"><option value="demo">Démo</option><option value="local">Local (ChatGPT / API)</option><option value="atelier">Atelier</option></select><button id="provider-connect" type="button" class="link">Connexion</button></div>
<p id="provider-help" class="tip" tabindex="0" role="button" aria-expanded="false" title="Afficher tout le texte">Catalogue fictif : les options servent uniquement à explorer les états visuels.</p>
<div class="effort-card">
<div class="effort-head"><div class="effort-now"><output id="effort-label" for="effort"></output><button id="effort-model" type="button" class="effort-model" title="Changer de modèle"><span id="effort-model-label"></span>${icon("chevronRight", "ico effort-model-ico")}</button></div><div class="effort-row"><button id="effort-auto" type="button" class="ghost icon-btn" title="Revenir à Auto : le modèle garde son effort par défaut" aria-label="Revenir à Auto">${icon("refresh")}</button></div></div>
<label for="effort" class="sr-only">Niveau d'effort</label>
<div id="effort-scale"><div class="effort-notches" aria-hidden="true"></div><input id="effort" type="range" min="0" max="4" step="any" value="2" aria-describedby="effort-tip"><span class="effort-knob" aria-hidden="true"></span></div>
</div>
<p id="effort-tip" class="tip"></p></section>
<section class="cfg-col cfg-execution" aria-labelledby="cfg-h-execution"><h3 id="cfg-h-execution" class="sr-only">Exécution</h3>
<div class="cfg-control"><button id="learning-switch" type="button" role="switch" title="Lecture des cours et explications, sans exécution ni écriture." aria-checked="false" aria-describedby="learning-help"><span class="cfg-switch-label"><span class="cfg-switch-ico">${icon("book")}</span>Apprentissage</span></button>
<p id="learning-help" class="tip">Lecture des cours et explications, sans exécution ni écriture.</p></div>
<div class="cfg-control cfg-automatic"><button id="automatic-switch" type="button" role="switch" title="Approuve tout pendant 2 h au maximum, échéance fixée par l'outil au lancement." aria-checked="false" aria-describedby="automatic-state automatic-warn"><span class="cfg-switch-label"><span class="cfg-switch-ico">${icon("play")}</span>Bypass des approbations</span></button>
<p id="automatic-state" role="status"></p>
<p id="automatic-warn" class="tip"><span class="warn-line">Approuve tout pendant 2 h au maximum, échéance fixée par l'outil au lancement. Ce réglage modifie uniquement les indicateurs de la démonstration.</span></p></div>
</section>
</div>
<script nonce="${nonce}" src="${iconsUri}"><\/script>
<script nonce="${nonce}" src="${uiUri}"><\/script>
<script nonce="${nonce}" src="${scriptUri}"><\/script>
</body>
</html>
`;
}
export function studioHtml({ nonce, cspSource, scriptUri, styleUri, iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"), palette }) {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri, iconsUri })) {
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok)
      throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`
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
<body class="studio" data-palette="${paletteOf(palette)}">
<div class="studio-shell">
<nav id="studio-nav" aria-label="Réglages"></nav>
<main id="studio-main"></main>
</div>
<script nonce="${nonce}" src="${iconsUri}"><\/script>
<script nonce="${nonce}" src="${scriptUri}"><\/script>
</body>
</html>
`;
}
export function graphHtml({ nonce, cspSource, scriptUri, styleUri, iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"), palette }) {
  for (const [name, value] of Object.entries({ nonce, cspSource, scriptUri, styleUri, iconsUri })) {
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok)
      throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`
  ].join("; ");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title>Graphe</title>
</head>
<body class="studio graph-full" data-palette="${paletteOf(palette)}">
<div class="studio-shell">
<main id="studio-main"></main>
</div>
<script nonce="${nonce}" src="${iconsUri}"><\/script>
<script nonce="${nonce}" src="${scriptUri}"><\/script>
</body>
</html>
`;
}
