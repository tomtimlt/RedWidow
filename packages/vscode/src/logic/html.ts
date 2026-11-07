import { randomBytes } from "node:crypto";
import { type Locale, translateFr } from "@warband/messages";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENTS,
} from "./attachments.js";
import { PRODUCT_NAME } from "./brand.js";
import { paletteOf } from "./palette.js";
import { shortcutLabel } from "./shortcuts.js";

/** Échappement des traductions insérées dans les attributs ou les textes statiques. */
const localized = (text: string, locale: Locale): string =>
  translateFr(text, locale).replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

/** Nonce CSP aléatoire, nouveau à chaque rendu. */
export const makeNonce = (): string => randomBytes(18).toString("base64url");

export interface ChatHtmlOptions {
  palette?: unknown;
  locale?: Locale;
  /** Catalogue de traduction local, chargé avant les scripts de rendu. */
  i18nUri?: string;
  nonce: string;
  /** `webview.cspSource`. */
  cspSource: string;
  /** URI webview de `media/chat.js`, `media/ui.js` (logique pure, chargée avant) et `media/chat.css`. */
  scriptUri: string;
  uiUri: string;
  styleUri: string;
  /** Catalogue SVG local, chargé avant les scripts de rendu. */
  iconsUri?: string;
  /** Araignée décorative locale ; chargée sous le même nonce que le chat. */
  spiderUri?: string;
  /** Libellé du raccourci d'ouverture d'un terminal (selon la plate-forme), par exemple « Alt+J T ». */
  terminalShortcut?: string;
}

/** Valeurs insérées dans des attributs : jamais de guillemet, chevron ni espace. */
const SAFE = /^[A-Za-z0-9_\-+/=:.%~@]+$/;

/**
 * Icônes au trait (16 px, `currentColor`), en SVG inline : rendu net et centré quel que soit la police,
 * contrairement aux glyphes Unicode. Aucun attribut d'événement, aucune ressource externe.
 */
const ICONS = new Set([
  "loader",
  "container",
  "brain",
  "book",
  "shield",
  "history",
  "plus",
  "close",
  "terminal",
  "folder",
  "clip",
  "at",
  "hash",
  "slash",
  "pulse",
  "graph",
  "killchain",
  "stop",
  "send",
  "down",
  "caret",
  "refresh",
  "sparkle",
  "sliders",
  "search",
  "check",
  "bolt",
  "play",
  "chevronRight",
]);
const icon = (name: string, cls = "ico"): string => {
  if (!ICONS.has(name)) throw new Error(`Pictogramme inconnu : ${name}`);
  return `<svg class="${cls}" data-icon="${name}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"></svg>`;
};

/**
 * Marque RedWidow : viseur vide et satellite.
 * SVG inline avec classes CSS pour les couleurs de marque. Décoratif : `aria-hidden`.
 */
export const BRAND_SHAPES =
  '<path class="brand-wing" d="M12 1.8v5M12 17.2v5M1.8 12h5M17.2 12h5"/><g class="brand-core"><path class="brand-lead" fill-rule="evenodd" d="M12 5.2a6.8 6.8 0 1 0 0 13.6a6.8 6.8 0 1 0 0-13.6zM12 7.2a4.8 4.8 0 1 1 0 9.6a4.8 4.8 0 1 1 0-9.6z"/></g><g class="brand-orbit"><circle class="brand-node" cx="19.2" cy="4.8" r="1.4"/></g>';
const BRAND = `<svg class="brand" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${BRAND_SHAPES}</svg>`;

/**
 * Page de la webview de chat. CSP stricte : `default-src 'none'`, cinq scripts (fichiers de
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
  i18nUri = scriptUri.replace(/[^/]+$/, "i18n.js"),
  spiderUri = scriptUri.replace(/[^/]+$/, "spider.js"),
  locale = "fr",
  palette,
  terminalShortcut = shortcutLabel("openTerminal"),
}: ChatHtmlOptions): string {
  if (!/^[A-Za-z0-9+ ]{1,24}$/.test(terminalShortcut))
    throw new Error("valeur invalide pour terminalShortcut");
  for (const [name, value] of Object.entries({
    nonce,
    cspSource,
    scriptUri,
    uiUri,
    styleUri,
    iconsUri,
    i18nUri,
    spiderUri,
  })) {
    // `cspSource` peut contenir des espaces ou `'self'` selon l'hôte : on en retire seulement les caractères dangereux.
    const ok = name === "cspSource" ? !/["<>]/.test(value) && value !== "" : SAFE.test(value);
    if (!ok) throw new Error(`valeur invalide pour ${name}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "fr"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title>${PRODUCT_NAME}</title>
</head>
<body data-palette="${paletteOf(palette)}" data-terminal-shortcut="${terminalShortcut}">
<header id="bar"><span id="title">${BRAND}<span class="brand-heading"><span class="brand-name"><span class="brand-ops">Red</span>Widow</span><span id="context-title" class="context-title" hidden></span></span></span><button id="roe" type="button" class="roe" popovertarget="cfg-pop" aria-haspopup="dialog" data-i18n-title="Mode de supervision : ouvrir Configurer" title="${localized("Mode de supervision : ouvrir Configurer", locale)}" hidden><span class="roe-gauge" aria-hidden="true"><i></i><i></i><i></i></span><span class="roe-text"><span class="roe-kicker" aria-hidden="true"><span data-i18n="MODE">${localized("MODE", locale)}</span></span><span id="roe-label"><span data-i18n="Supervisé">${localized("Supervisé", locale)}</span></span></span><span id="roe-left" class="roe-left" aria-hidden="true"></span></button><span id="sandbox" class="badge" hidden></span><span id="bypass-badge" class="badge" hidden></span><span id="learning-badge" class="badge" data-i18n-title="Mode Apprentissage : lecture des cours seule, aucune action" title="${localized("Mode Apprentissage : lecture des cours seule, aucune action", locale)}" hidden><span data-i18n="Apprentissage">${localized("Apprentissage", locale)}</span></span><button id="history-btn" type="button" class="ghost" aria-expanded="false" aria-controls="history" data-i18n-title="Historique des conversations" title="${localized("Historique des conversations", locale)}">${icon("history")}<span class="btn-text"><span data-i18n="Historique">${localized("Historique", locale)}</span></span></button><button id="reset" type="button" class="ghost" data-i18n-title="Nouvelle conversation" title="${localized("Nouvelle conversation", locale)}">${icon("plus")}<span class="btn-text"><span data-i18n="Nouvelle">${localized("Nouvelle", locale)}</span><span class="btn-more"><span data-i18n=" conversation">${localized(" conversation", locale)}</span></span></span></button></header>
<nav id="mission" data-i18n-aria-label="Activité de la conversation" aria-label="${localized("Activité de la conversation", locale)}" hidden><ol id="mission-steps"></ol></nav>
<section id="history" data-i18n-aria-label="Historique des conversations" aria-label="${localized("Historique des conversations", locale)}" hidden><div class="hist-head"><strong><span data-i18n="Historique">${localized("Historique", locale)}</span></strong><button id="history-clear" type="button" class="ghost"><span data-i18n="Tout effacer">${localized("Tout effacer", locale)}</span></button><button id="history-close" type="button" class="ghost icon-btn" data-i18n-title="Fermer l&#x27;historique (Échap)" title="${localized("Fermer l'historique (Échap)", locale)}" data-i18n-aria-label="Fermer l&#x27;historique" aria-label="${localized("Fermer l'historique", locale)}">${icon("close")}</button></div><ul id="history-list"></ul></section>
<nav id="timeline" data-i18n-aria-label="Navigation dans les messages" aria-label="${localized("Navigation dans les messages", locale)}" hidden><button id="timeline-older" type="button" class="ghost"><span data-i18n="Échange précédent">${localized("Échange précédent", locale)}</span></button><button id="timeline-newer" type="button" class="ghost"><span data-i18n="Échange suivant">${localized("Échange suivant", locale)}</span></button><button id="timeline-latest" type="button" class="ghost"><span data-i18n="Revenir au direct">${localized("Revenir au direct", locale)}</span></button><span id="timeline-status" role="status"></span></nav>
<main id="log" role="log" aria-live="polite" data-i18n-aria-label="Conversation" aria-label="${localized("Conversation", locale)}"></main>
<div id="no-provider" role="status" hidden><span id="no-provider-text"><span data-i18n="Connecte un fournisseur pour utiliser le chat. Le cockpit, les terminaux et la Kill chain restent accessibles sans IA.">${localized("Connecte un fournisseur pour utiliser le chat. Le cockpit, les terminaux et la Kill chain restent accessibles sans IA.", locale)}</span></span><button id="no-provider-add" type="button" class="primary"><span data-i18n="Ajouter un fournisseur">${localized("Ajouter un fournisseur", locale)}</span></button></div>
<div id="readonly" role="status" hidden><span id="readonly-text"></span><button id="readonly-resume" type="button" class="primary"><span data-i18n="Reprendre">${localized("Reprendre", locale)}</span></button><button id="readonly-close" type="button" class="ghost"><span data-i18n="Fermer">${localized("Fermer", locale)}</span></button></div>
<div id="monitor-layout"><div id="monitor-strip" class="mon-strip" role="group" data-i18n-aria-label="Frise des commandes" aria-label="${localized("Frise des commandes", locale)}"></div><section id="monitor" data-i18n-aria-label="Commandes Exegol / Kali (lecture seule)" aria-label="${localized("Commandes Exegol / Kali (lecture seule)", locale)}"><div class="mon-head"><div class="mon-title"><span class="mon-live" aria-hidden="true"></span><strong><span data-i18n="Monitor">${localized("Monitor", locale)}</span></strong><span id="monitor-count" class="mon-count"></span><span id="mission-clock" class="mon-clock" data-i18n-title="Temps écoulé depuis le début du tour" title="${localized("Temps écoulé depuis le début du tour", locale)}" aria-hidden="true"></span></div><p class="hint"><span data-i18n="Sortie en direct. Cliquer une entrée pour la suivre en lecture seule.">${localized("Sortie en direct. Cliquer une entrée pour la suivre en lecture seule.", locale)}</span></p><button id="monitor-follow" type="button" class="ghost" data-i18n-aria-label="Suivi du bas" aria-label="${localized("Suivi du bas", locale)}" aria-pressed="true" data-i18n-title="Désactiver le suivi du bas pour défiler librement" title="${localized("Désactiver le suivi du bas pour défiler librement", locale)}">${icon("down")}</button></div><ol id="monitor-rows"></ol><div id="monitor-empty" class="empty"><span class="mon-empty-ico">${icon("pulse")}</span><span><span data-i18n="Aucun appel Exegol / Kali dans cette conversation.">${localized("Aucun appel Exegol / Kali dans cette conversation.", locale)}</span></span><span class="mon-empty-sub"><span data-i18n="Les commandes lancées par l’agent apparaîtront ici en direct.">${localized("Les commandes lancées par l’agent apparaîtront ici en direct.", locale)}</span></span></div></section>
</div>
<section id="approvals" data-i18n-aria-label="Autorisations demandées" aria-label="${localized("Autorisations demandées", locale)}"></section>
<div id="thinking" role="status"><svg class="brand thinking-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${BRAND_SHAPES}</svg><span id="thinking-label"><span data-i18n="Réflexion">${localized("Réflexion", locale)}</span></span><span id="thinking-clock" class="thinking-clock" aria-hidden="true"></span><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
<form id="form">
<div id="composer">
<input id="attachment-input" type="file" multiple hidden disabled data-count="${MAX_ATTACHMENTS}" data-bytes="${MAX_ATTACHMENT_BYTES}" data-total="${MAX_ATTACHMENT_TOTAL_BYTES}">
<ul id="attachment-list" data-i18n-aria-label="Fichiers joints" aria-label="${localized("Fichiers joints", locale)}" hidden></ul>
<div id="selected-resources" class="selected-resources" aria-live="polite" hidden></div>
<p id="attachment-vision-warning" class="hint" role="status" hidden></p>
<p id="attachment-status" class="hint" role="status" hidden></p>
<textarea id="input" rows="1" data-i18n-aria-label="Votre consigne" aria-label="${localized("Votre consigne", locale)}" data-i18n-placeholder="Votre consigne…" placeholder="${localized("Votre consigne…", locale)}" data-i18n-title="Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne" title="${localized("Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne", locale)}"></textarea>
<div id="toolbar">

<button id="composer-menu-btn" type="button" class="ghost tool-btn" popovertarget="composer-menu" aria-haspopup="dialog" aria-expanded="false" data-i18n-aria-label="Ajouter des outils et du contexte" aria-label="${localized("Ajouter des outils et du contexte", locale)}">${icon("plus")}</button>
<span id="ctl-group" hidden><button id="model-chip" type="button" class="chip" popovertarget="model-pop" aria-haspopup="listbox" aria-expanded="false" data-i18n-title="Modèle utilisé pour le message suivant" title="${localized("Modèle utilisé pour le message suivant", locale)}">${icon("sparkle", "ico chip-ico")}<span id="model-chip-label" class="chip-label"><span data-i18n="Modèle par défaut">${localized("Modèle par défaut", locale)}</span></span>${icon("caret", "caret")}<span class="sr-only"><span data-i18n=" (choisir le modèle)">${localized(" (choisir le modèle)", locale)}</span></span></button></span>

<button id="research-next" type="button" class="chip research-request" aria-pressed="false" disabled>${icon("search", "ico chip-ico")}<span data-i18n="Rechercher pour ce message">${localized("Rechercher pour ce message", locale)}</span></button>
<span class="spacer"></span><button id="cfg-btn" type="button" class="chip" popovertarget="cfg-pop" aria-haspopup="dialog" aria-expanded="false" data-i18n-aria-label="Configurer" aria-label="${localized("Configurer", locale)}" data-i18n-title="Configurer : raisonnement et exécution" title="${localized("Configurer : raisonnement et exécution", locale)}">${icon("sliders", "ico chip-ico")}<span class="cfg-text"><span data-i18n="Configurer">${localized("Configurer", locale)}</span></span><span id="cfg-level" class="cfg-level"></span>${icon("caret", "caret")}</button>
<button id="stop" type="button" class="danger" data-i18n-title="Arrêter l&#x27;agent" title="${localized("Arrêter l'agent", locale)}">${icon("stop")}<span class="btn-text"><span data-i18n="Stop">${localized("Stop", locale)}</span></span></button>
<button id="send" type="submit" class="primary" data-i18n-title="Envoyer (Entrée)" title="${localized("Envoyer (Entrée)", locale)}" data-i18n-aria-label="Envoyer" aria-label="${localized("Envoyer", locale)}">${icon("send")}</button>
</div>
</div>
</form>
<div id="composer-menu" class="pop composer-menu" popover="auto" data-i18n-aria-label="Outils et contexte" aria-label="${localized("Outils et contexte", locale)}">
<p class="composer-section" data-i18n="Ajouter">${localized("Ajouter", locale)}</p>
<button id="attach-btn" type="button" disabled class="ghost composer-action" data-i18n-title="Joindre des fichiers texte (10 fichiers, 64 Kio chacun)" title="${localized("Joindre des fichiers texte (10 fichiers, 64 Kio chacun)", locale)}" data-i18n-aria-label="Joindre des fichiers texte" aria-label="${localized("Joindre des fichiers texte", locale)}">${icon("clip")}<span data-i18n="Fichiers">${localized("Fichiers", locale)}</span></button>
<button id="mention-btn" type="button" class="ghost composer-action" data-i18n-title="Citer un conteneur" title="${localized("Citer un conteneur", locale)}" data-i18n-aria-label="Citer un conteneur" aria-label="${localized("Citer un conteneur", locale)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="mention-pop">${icon("at")}<span data-i18n="Citer un conteneur">${localized("Citer un conteneur", locale)}</span></button>
<button id="hash-btn" type="button" class="ghost composer-action" data-i18n-title="Citer un terminal" title="${localized("Citer un terminal", locale)}" data-i18n-aria-label="Citer un terminal" aria-label="${localized("Citer un terminal", locale)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="mention-pop">${icon("hash")}<span data-i18n="Citer un terminal">${localized("Citer un terminal", locale)}</span></button>
<button id="slash-btn" type="button" class="ghost composer-action" popovertarget="slash-pop" aria-haspopup="menu" aria-expanded="false" data-i18n-title="Commandes" title="${localized("Commandes", locale)}" data-i18n-aria-label="Commandes" aria-label="${localized("Commandes", locale)}">${icon("slash")}<span data-i18n="Commandes">${localized("Commandes", locale)}</span></button>
<button id="monitor-btn" type="button" class="ghost composer-action" data-i18n-title="Monitor" title="${localized("Monitor", locale)}" data-i18n-aria-label="Monitor" aria-label="${localized("Monitor", locale)}">${icon("pulse")}<span data-i18n="Monitor">${localized("Monitor", locale)}</span></button>
<button id="killchain-btn" type="button" class="ghost composer-action" data-i18n-title="Kill chain" title="${localized("Kill chain", locale)}" data-i18n-aria-label="Kill chain" aria-label="${localized("Kill chain", locale)}">${icon("graph")}<span data-i18n="Kill chain">${localized("Kill chain", locale)}</span></button>
<div id="composer-resources"></div>
<button id="composer-settings" type="button" class="ghost composer-action">${icon("sliders")}<span data-i18n="Configurer les outils et fournisseurs">${localized("Configurer les outils et fournisseurs", locale)}</span></button>
</div>
<div id="model-pop" class="pop" popover="auto" aria-labelledby="model-pop-title">
<div class="pop-head"><span id="model-pop-title" class="pop-title">${icon("sparkle", "ico pop-title-ico")}<span data-i18n="Modèle">${localized("Modèle", locale)}</span></span><span class="pop-sub"><span data-i18n="Pour le message suivant">${localized("Pour le message suivant", locale)}</span></span></div>
<p id="models-status" class="tip" role="status" aria-live="polite" hidden></p>
<div class="pop-search">${icon("search", "ico pop-search-ico")}<input id="model-filter" type="text" role="combobox" aria-controls="model-list" aria-expanded="true" aria-autocomplete="list" data-i18n-aria-label="Filtrer les modèles" aria-label="${localized("Filtrer les modèles", locale)}" data-i18n-placeholder="Filtrer les modèles…" placeholder="${localized("Filtrer les modèles…", locale)}" spellcheck="false" autocomplete="off"></div>
<input id="model-input" type="text" data-i18n-aria-label="Référence du modèle" aria-label="${localized("Référence du modèle", locale)}" data-i18n-placeholder="identifiant du modèle" placeholder="${localized("identifiant du modèle", locale)}" data-i18n-title="Liste indisponible : saisissez l&#x27;identifiant du modèle" title="${localized("Liste indisponible : saisissez l'identifiant du modèle", locale)}" spellcheck="false" autocomplete="off" hidden>
<div id="model-list" role="listbox" data-i18n-aria-label="Modèles" aria-label="${localized("Modèles", locale)}"></div>
<div class="pop-foot"><button id="models-connect" type="button" class="ghost" hidden><span data-i18n="Configurer la connexion">${localized("Configurer la connexion", locale)}</span></button><button id="models-refresh" type="button" class="ghost" data-i18n-title="Actualiser la liste des modèles" title="${localized("Actualiser la liste des modèles", locale)}">${icon("refresh")}<span id="models-refresh-label"><span data-i18n="Actualiser la liste">${localized("Actualiser la liste", locale)}</span></span></button></div>
</div>
<div id="mention-pop" class="pop" popover="auto" data-i18n-aria-label="Conteneurs" aria-label="${localized("Conteneurs", locale)}"><div id="mention-list" role="listbox" data-i18n-aria-label="Conteneurs" aria-label="${localized("Conteneurs", locale)}"></div><p id="mention-empty" class="tip" hidden><span data-i18n="Aucun conteneur">${localized("Aucun conteneur", locale)}</span></p></div>
<div id="slash-pop" class="pop" popover="auto" data-i18n-aria-label="Commandes" aria-label="${localized("Commandes", locale)}">
<button id="cmd-clear" type="button" class="cmd-opt"><span class="cmd">/clear</span><span class="cmd-desc"><span data-i18n="Nouvelle conversation">${localized("Nouvelle conversation", locale)}</span></span></button>
</div>
<div id="cfg-pop" class="pop" popover="auto" role="dialog" aria-labelledby="cfg-pop-title">
<div class="pop-head"><span id="cfg-pop-title" class="pop-title">${icon("sliders", "ico pop-title-ico")}<span data-i18n="Configurer">${localized("Configurer", locale)}</span></span><span class="pop-sub sr-only"><span data-i18n="S&#x27;applique au message suivant">${localized("S'applique au message suivant", locale)}</span></span></div>
<section class="cfg-col cfg-model" aria-labelledby="cfg-h-reason"><h3 id="cfg-h-reason" class="sr-only"><span data-i18n="Modèle et raisonnement">${localized("Modèle et raisonnement", locale)}</span></h3>
<div class="cfg-provider"><label for="provider"><span data-i18n="Fournisseur">${localized("Fournisseur", locale)}</span></label><select id="provider" aria-describedby="provider-help"><option value="claude">Claude</option><option value="openai">OpenAI (ChatGPT / API)</option><option value="opencode">OpenCode</option></select><button id="provider-connect" type="button" class="link"><span data-i18n="Configurer la connexion">${localized("Configurer la connexion", locale)}</span></button></div>
<p id="provider-help" class="tip" tabindex="0" role="button" aria-expanded="false" data-i18n-title="Afficher tout le texte" title="${localized("Afficher tout le texte", locale)}"><span data-i18n="Configurez vos connexions dans Réglages → Fournisseurs, puis choisissez votre fournisseur ici.">${localized("Configurez vos connexions dans Réglages → Fournisseurs, puis choisissez votre fournisseur ici.", locale)}</span></p>
<div class="effort-card">
<div class="effort-head"><div class="effort-now"><output id="effort-label" for="effort"></output><button id="effort-model" type="button" class="effort-model" data-i18n-title="Changer de modèle" title="${localized("Changer de modèle", locale)}"><span id="effort-model-label"></span>${icon("chevronRight", "ico effort-model-ico")}</button></div><div class="effort-row"><button id="effort-auto" type="button" class="ghost icon-btn" data-i18n-title="Revenir à Auto : le modèle garde son effort par défaut" title="${localized("Revenir à Auto : le modèle garde son effort par défaut", locale)}" data-i18n-aria-label="Revenir à Auto" aria-label="${localized("Revenir à Auto", locale)}">${icon("refresh")}</button></div></div>
<label for="effort" class="sr-only"><span data-i18n="Niveau d&#x27;effort">${localized("Niveau d'effort", locale)}</span></label>
<div id="effort-scale"><div class="effort-notches" aria-hidden="true"></div><input id="effort" type="range" min="0" max="4" step="any" value="2" aria-describedby="effort-tip"><span class="effort-knob" aria-hidden="true"></span></div>
</div>
<p id="effort-tip" class="tip"></p>
<div class="cfg-provider cfg-supervision"><label for="supervision"><span data-i18n="Encadrement">${localized("Encadrement", locale)}</span></label><select id="supervision" aria-describedby="supervision-tip"><option value="light" data-i18n="Léger" data-i18n-title="Léger : moins de relances du moteur." title="${localized("Léger : moins de relances du moteur.", locale)}">${localized("Léger", locale)}</option><option value="standard" data-i18n="Standard" data-i18n-title="Standard : réglage par défaut." title="${localized("Standard : réglage par défaut.", locale)}">${localized("Standard", locale)}</option><option value="strict" data-i18n="Strict" data-i18n-title="Strict : relances dès le premier signal et point de contrôle toutes les 8 actions, conseillé pour les petits modèles." title="${localized("Strict : relances dès le premier signal et point de contrôle toutes les 8 actions, conseillé pour les petits modèles.", locale)}">${localized("Strict", locale)}</option></select></div>
<p id="supervision-tip" class="tip"></p></section>
<section class="cfg-col cfg-execution" aria-labelledby="cfg-h-execution"><h3 id="cfg-h-execution" class="sr-only"><span data-i18n="Exécution">${localized("Exécution", locale)}</span></h3>
<div class="cfg-control"><button id="learning-switch" type="button" role="switch" data-i18n-title="Lecture des cours et explications, sans exécution ni écriture." title="${localized("Lecture des cours et explications, sans exécution ni écriture.", locale)}" aria-checked="false" aria-describedby="learning-help"><span class="cfg-switch-label"><span class="cfg-switch-ico">${icon("book")}</span><span data-i18n="Apprentissage">${localized("Apprentissage", locale)}</span></span></button>
<p id="learning-help" class="tip"><span data-i18n="Lecture des cours et explications, sans exécution ni écriture.">${localized("Lecture des cours et explications, sans exécution ni écriture.", locale)}</span></p></div>
<div class="cfg-control cfg-bypass"><button id="bypass-switch" type="button" role="switch" aria-checked="false" aria-describedby="bypass-state bypass-warn"><span class="cfg-switch-label"><span class="cfg-switch-ico">${icon("play")}</span><span data-i18n="Bypass des approbations">${localized("Bypass des approbations", locale)}</span></span></button>
<p id="bypass-state" role="status"></p>
<p id="bypass-warn" class="tip"><span class="warn-line"><span data-i18n="Approuve tout pendant 2 h, deny compris : chemins sensibles ou hors projet, accès hôte d&#x27;un conteneur, dangers shell, sans rien mémoriser.">${localized("Approuve tout pendant 2 h, deny compris : chemins sensibles ou hors projet, accès hôte d'un conteneur, dangers shell, sans rien mémoriser.", locale)}</span></span> <span class="warn-line"><span data-i18n="Vous en devenez responsable.">${localized("Vous en devenez responsable.", locale)}</span></span></p></div>
</section>
</div>
<script nonce="${nonce}" src="${i18nUri}"></script>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${spiderUri}"></script>
<script nonce="${nonce}" src="${uiUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

export interface CockpitHtmlOptions {
  palette?: unknown;
  locale?: Locale;
  /** Catalogue de traduction local, chargé avant les scripts de rendu. */
  i18nUri?: string;
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
  i18nUri = scriptUri.replace(/[^/]+$/, "i18n.js"),
  locale = "fr",
  palette,
}: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({
    nonce,
    cspSource,
    scriptUri,
    styleUri,
    iconsUri,
    i18nUri,
  })) {
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
<html lang="${locale === "en" ? "en" : "fr"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title data-i18n="Conteneurs">${localized("Conteneurs", locale)}</title>
</head>
<body class="cockpit" data-palette="${paletteOf(palette)}">
<header id="bar"><span id="title">${icon("container")}<span data-i18n="Conteneurs">${localized("Conteneurs", locale)}</span></span><button id="refresh" type="button" class="ghost" data-i18n-title="Actualiser" title="${localized("Actualiser", locale)}">${icon("refresh")}<span class="btn-text"><span data-i18n="Actualiser">${localized("Actualiser", locale)}</span></span></button></header>
<main id="main" role="main" aria-live="polite"></main>
<script nonce="${nonce}" src="${i18nUri}"></script>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

/** Page « Fiche programme » : CSP stricte, un seul script `program.js`, aucune donnée de la fiche dans le HTML. */
export function programHtml({
  nonce,
  cspSource,
  scriptUri,
  styleUri,
  iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"),
  i18nUri = scriptUri.replace(/[^/]+$/, "i18n.js"),
  locale = "fr",
  palette,
}: CockpitHtmlOptions): string {
  for (const [name, value] of Object.entries({
    nonce,
    cspSource,
    scriptUri,
    styleUri,
    iconsUri,
    i18nUri,
  })) {
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
  const title = localized("Fiche programme", locale);
  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "fr"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title data-i18n="Fiche programme">${title}</title>
</head>
<body class="cockpit program" data-palette="${paletteOf(palette)}">
<header id="bar"><span id="title"><span data-i18n="Fiche programme">${title}</span></span><button id="refresh" type="button" class="ghost" data-i18n-title="Actualiser" title="${localized("Actualiser", locale)}">${icon("refresh")}<span class="btn-text"><span data-i18n="Actualiser">${localized("Actualiser", locale)}</span></span></button></header>
<main id="main" role="main" aria-live="polite"></main>
<script nonce="${nonce}" src="${i18nUri}"></script>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

export interface StudioHtmlOptions extends CockpitHtmlOptions {
  /** Araignée locale, chargée avant les cartes de palettes. */
  spiderUri?: string;
}

/** Page des réglages : même CSP, scripts locaux dont `studio.js`. */
export function studioHtml({
  nonce,
  cspSource,
  scriptUri,
  styleUri,
  iconsUri = scriptUri.replace(/[^/]+$/, "icons.js"),
  i18nUri = scriptUri.replace(/[^/]+$/, "i18n.js"),
  spiderUri = scriptUri.replace(/[^/]+$/, "spider.js"),
  locale = "fr",
  palette,
}: StudioHtmlOptions): string {
  for (const [name, value] of Object.entries({
    nonce,
    cspSource,
    scriptUri,
    styleUri,
    iconsUri,
    i18nUri,
    spiderUri,
  })) {
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
<html lang="${locale === "en" ? "en" : "fr"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title data-i18n="Réglages">${localized("Réglages", locale)}</title>
</head>
<body class="studio" data-palette="${paletteOf(palette)}">
<div class="studio-shell">
<nav id="studio-nav" data-i18n-aria-label="Réglages" aria-label="${localized("Réglages", locale)}"></nav>
<main id="studio-main"></main>
</div>
<script nonce="${nonce}" src="${i18nUri}"></script>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${spiderUri}"></script>
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
  i18nUri = scriptUri.replace(/[^/]+$/, "i18n.js"),
  spiderUri = scriptUri.replace(/[^/]+$/, "spider.js"),
  locale = "fr",
  palette,
}: StudioHtmlOptions): string {
  for (const [name, value] of Object.entries({
    nonce,
    cspSource,
    scriptUri,
    styleUri,
    iconsUri,
    i18nUri,
    spiderUri,
  })) {
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
<html lang="${locale === "en" ? "en" : "fr"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUri}">
<title data-i18n="Graphe">${localized("Graphe", locale)}</title>
</head>
<body class="studio killchain-full" data-palette="${paletteOf(palette)}">
<div class="studio-shell">
<main id="studio-main"></main>
</div>
<script nonce="${nonce}" src="${i18nUri}"></script>
<script nonce="${nonce}" src="${iconsUri}"></script>
<script nonce="${nonce}" src="${spiderUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
