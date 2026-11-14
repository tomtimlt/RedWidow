// Écran Réglages : Bypass (durée, une confirmation explicite, désactivation en un clic), notifications
// système (permission demandée seulement sur clic), réglages du moteur, palette et déconnexion. Aucun
// Bypass n'est activé sans action humaine explicite sur ce panneau.

import { bypassLabel } from "../lib/topbar.js";
import {
  actionButton,
  badge,
  el,
  field,
  isRecord,
  screenRoot,
  statusLine,
  syncOnline,
  textInput,
} from "./common.js";

/** Durées proposées pour le Bypass (minutes ; `null` : illimité, valeur par défaut). */
export const BYPASS_DURATIONS = [
  { label: "Illimité", minutes: null },
  { label: "1 heure", minutes: 60 },
  { label: "8 heures", minutes: 480 },
  { label: "24 heures", minutes: 1440 },
  { label: "48 heures", minutes: 2880 },
];
export const BYPASS_CONFIRM_TEXT =
  "Le Bypass laisse passer les refus de politique, les chemins sensibles et les dangers shell, sans vous demander. Vous en devenez responsable pendant toute sa durée. Il s'éteint à l'arrêt du moteur.";
export const PROFILES = ["mentor", "bug-bounty", "out-of-box", "red-team", "htb"];

/** Message `setBypass` pour une durée choisie (`""` ou `"null"` : illimité) ; `null` si la durée est refusée. */
export function bypassMessage(active, rawMinutes) {
  if (!active) return { type: "setBypass", active: false, durationMinutes: null };
  const minutes =
    rawMinutes === "" || rawMinutes === null || rawMinutes === undefined
      ? null
      : Number(rawMinutes);
  if (minutes !== null && !BYPASS_DURATIONS.some((d) => d.minutes === minutes)) return null;
  return { type: "setBypass", active: true, durationMinutes: minutes };
}

/** État des notifications système : { label, tone, canAsk }. */
export function notificationState(api) {
  if (!api) return { label: "non prises en charge par ce navigateur", tone: "mute", canAsk: false };
  if (api.permission === "granted") return { label: "autorisées", tone: "ok", canAsk: false };
  if (api.permission === "denied")
    return {
      label: "refusées : à réautoriser dans le navigateur",
      tone: "err",
      canAsk: false,
    };
  return { label: "non demandées", tone: "warn", canAsk: true };
}

/** Message `settingsSet` de l'interrupteur « Effets visuels » (booléen strict, enregistré côté serveur). */
export function effectsMessage(enabled) {
  return { type: "settingsSet", patch: { effects: enabled === true } };
}

/** Effets visuels activés ? Oui par défaut : seul un `false` explicite les coupe. */
export function effectsEnabled(values) {
  return values?.effects !== false;
}

/** Patch `settingsSet` : seulement ce qui change ; un modèle vidé redevient « par défaut » (`null`). */
export function settingsPatch(before, after) {
  const patch = {};
  const flat = (key, v) =>
    key === "burp.enabled" || key === "chat.webSearch"
      ? v === true
      : typeof v === "string"
        ? v
        : "";
  for (const key of ["profile", "model", "burp.enabled", "chat.webSearch"]) {
    const a = flat(key, after[key]);
    if (a === flat(key, before[key])) continue;
    patch[key] = a === "" ? null : a;
  }
  return patch;
}

/**
 * @param {Document} doc
 * @param {{ send(msg: object): boolean, notifications?: object, requestPermission?: () => Promise<unknown>, openPalette(): void, logout(): void, now?: () => number }} deps
 */
export function createSettingsScreen(
  doc,
  { send, notifications, requestPermission, openPalette, logout, now = () => Date.now() },
) {
  const root = screenRoot(doc, "settings", "Réglages");
  let online = false;
  let bypass = null;
  let values = {};
  let loaded = false;

  // ── Bypass ──
  const bypassSection = el(doc, "section", "scr-section");
  bypassSection.append(el(doc, "h2", "scr-h2", "Bypass"));
  const bypassState = el(doc, "p", "scr-state");
  bypassState.setAttribute("role", "status");
  const bypassNote = el(
    doc,
    "p",
    "scr-note",
    "Le Bypass permet de contourner les refus de politique le temps d'une session de travail. Il n'a d'effet que si vous répondez vous-même aux demandes.",
  );
  const durationSelect = el(doc, "select", "scr-input");
  for (const d of BYPASS_DURATIONS) {
    const o = el(doc, "option", "", d.label);
    o.value = d.minutes === null ? "" : String(d.minutes);
    durationSelect.append(o);
  }
  durationSelect.value = "";
  const askBox = el(doc, "div", "scr-warning");
  askBox.hidden = true;
  askBox.setAttribute("role", "alertdialog");
  askBox.setAttribute("aria-label", "Confirmer le Bypass");
  const askText = el(doc, "p", "", BYPASS_CONFIRM_TEXT);
  const askDuration = el(doc, "p", "scr-strong");
  const confirm = actionButton(doc, "Activer le Bypass", "scr-btn-primary", () => {
    const msg = bypassMessage(true, durationSelect.value);
    askBox.hidden = true;
    askStart.hidden = false;
    if (msg === null || !send(msg))
      status.set("Hors ligne ou durée refusée : le Bypass n'a pas été activé.", "err");
    else status.set("", "mute");
  });
  const cancel = el(doc, "button", "scr-btn", "Annuler");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    askBox.hidden = true;
    askStart.hidden = false;
    askStart.focus();
  });
  const askActions = el(doc, "div", "scr-actions");
  askActions.append(confirm, cancel);
  askBox.append(askText, askDuration, askActions);
  const askStart = actionButton(doc, "Activer le Bypass…", "scr-btn-danger", () => {
    const d = BYPASS_DURATIONS.find(
      (x) => (x.minutes === null ? "" : String(x.minutes)) === durationSelect.value,
    );
    askDuration.textContent = `Durée : ${d ? d.label.toLowerCase() : "illimitée"}.`;
    askBox.hidden = false;
    askStart.hidden = true;
    confirm.focus();
  });
  const off = actionButton(doc, "Désactiver le Bypass", "scr-btn-primary", () => {
    if (!send(bypassMessage(false, null)))
      status.set("Hors ligne : la désactivation n'a pas été transmise.", "err");
  });
  const status = statusLine(doc);
  const bypassForm = el(doc, "div", "scr-form");
  bypassForm.append(field(doc, "Durée", durationSelect), askStart, off);
  bypassSection.append(bypassState, bypassNote, bypassForm, askBox, status.node);

  // ── Notifications ──
  const notifSection = el(doc, "section", "scr-section");
  notifSection.append(el(doc, "h2", "scr-h2", "Notifications système"));
  const notifState = el(doc, "p", "scr-state");
  const notifBtn = el(doc, "button", "scr-btn scr-btn-primary", "Autoriser les notifications");
  notifBtn.type = "button";
  notifBtn.addEventListener("click", async () => {
    // Seule action qui demande la permission : un clic de l'utilisateur.
    try {
      await requestPermission?.();
    } catch {
      // Refus ou API indisponible : l'état affiché le dira.
    }
    renderNotif();
  });
  notifSection.append(
    el(
      doc,
      "p",
      "scr-note",
      "Une notification signale chaque nouvelle demande d'approbation quand l'onglet n'est pas au premier plan.",
    ),
    notifState,
    notifBtn,
  );

  // ── Moteur ──
  const engineSection = el(doc, "section", "scr-section");
  engineSection.append(el(doc, "h2", "scr-h2", "Moteur"));
  const profile = el(doc, "select", "scr-input");
  const none = el(doc, "option", "", "(par défaut)");
  none.value = "";
  profile.append(none);
  for (const p of PROFILES) {
    const o = el(doc, "option", "", p);
    o.value = p;
    profile.append(o);
  }
  const model = textInput(doc, { placeholder: "(par défaut)", maxLength: 200 });
  const burp = el(doc, "input");
  burp.type = "checkbox";
  const web = el(doc, "input");
  web.type = "checkbox";
  const check = (input, text) => {
    const l = el(doc, "label", "scr-check");
    l.append(input, el(doc, "span", "", text));
    return l;
  };
  const engineStatus = statusLine(doc);
  const save = actionButton(doc, "Enregistrer", "scr-btn-primary", () => {
    const after = {
      profile: profile.value,
      model: model.value.trim(),
      "burp.enabled": burp.checked,
      "chat.webSearch": web.checked,
    };
    const patch = settingsPatch(values, after);
    if (Object.keys(patch).length === 0) {
      engineStatus.set("Rien à enregistrer.", "mute");
      return;
    }
    engineStatus.set(
      send({ type: "settingsSet", patch })
        ? "Enregistrement demandé…"
        : "Hors ligne : réglages non transmis.",
      "mute",
    );
  });
  const engineForm = el(doc, "div", "scr-form");
  engineForm.append(
    field(doc, "Profil", profile),
    field(doc, "Modèle", model, "Vide : modèle par défaut du moteur."),
    check(burp, "Intégration Burp"),
    check(web, "Recherche web du chat"),
    save,
  );
  engineSection.append(engineForm, engineStatus.node);

  // ── Interface ──
  const uiSection = el(doc, "section", "scr-section");
  uiSection.append(el(doc, "h2", "scr-h2", "Interface"));
  const uiList = el(doc, "dl", "scr-meta");
  uiList.append(
    el(doc, "dt", "", "Langue"),
    el(doc, "dd", "", "Français (seule langue de l'interface web)"),
    el(doc, "dt", "", "Palette de commandes"),
    el(doc, "dd", "", "Ctrl+K, ou Ctrl+Maj+K depuis un terminal"),
  );
  const paletteBtn = el(doc, "button", "scr-btn", "Ouvrir la palette");
  paletteBtn.type = "button";
  paletteBtn.addEventListener("click", () => openPalette());
  // Effets visuels : enregistré tout de suite (réglage serveur `effects`, pas de stockage navigateur).
  const effects = el(doc, "input");
  effects.type = "checkbox";
  const effectsLabel = el(doc, "label", "scr-check");
  effectsLabel.append(effects, el(doc, "span", "", "Effets visuels"));
  const effectsNote = el(
    doc,
    "p",
    "scr-note",
    "Transitions et animations de l'interface (survol, ouverture des fenêtres). Désactivées d'office si votre système demande de réduire les animations.",
  );
  effects.addEventListener("change", () => {
    if (!send(effectsMessage(effects.checked))) effects.checked = effectsEnabled(values);
  });
  uiSection.append(uiList, paletteBtn, effectsLabel, effectsNote);

  // ── Session ──
  const sessionSection = el(doc, "section", "scr-section");
  sessionSection.append(el(doc, "h2", "scr-h2", "Session"));
  const out = el(doc, "button", "scr-btn scr-btn-danger", "Se déconnecter");
  out.type = "button";
  out.addEventListener("click", () => logout());
  sessionSection.append(
    el(
      doc,
      "p",
      "scr-note",
      "Termine la session de ce navigateur. Les missions en cours continuent côté serveur.",
    ),
    out,
  );

  root.append(bypassSection, notifSection, engineSection, uiSection, sessionSection);

  function renderBypass() {
    const label = bypassLabel(bypass, now());
    bypassState.textContent = "";
    if (bypass === null) {
      bypassState.append(
        badge(doc, "état inconnu", "mute"),
        doc.createTextNode(" En attente du serveur."),
      );
    } else if (label === null) {
      bypassState.append(
        badge(doc, "désactivé", "ok"),
        doc.createTextNode(" Les refus de politique sont appliqués."),
      );
    } else {
      bypassState.append(badge(doc, label, "crimson"));
    }
    const active = bypass?.active === true;
    off.hidden = !active;
    askStart.hidden = active || !askBox.hidden;
    durationSelect.closest(".scr-field").hidden = active;
    if (active) askBox.hidden = true;
    syncOnline(root, online);
  }

  function renderNotif() {
    const s = notificationState(
      notifications ?? (typeof Notification === "undefined" ? null : Notification),
    );
    notifState.textContent = "";
    notifState.append(badge(doc, s.label, s.tone));
    notifBtn.hidden = !s.canAsk;
  }

  function renderEngine() {
    const p =
      typeof values.profile === "string" && PROFILES.includes(values.profile) ? values.profile : "";
    profile.value = p;
    model.value = typeof values.model === "string" ? values.model : "";
    burp.checked = values["burp.enabled"] === true;
    web.checked = values["chat.webSearch"] === true;
    effects.checked = effectsEnabled(values);
    syncOnline(root, online);
  }

  renderBypass();
  renderNotif();
  renderEngine();

  return {
    root,
    onMessage(msg) {
      if (msg.type === "settings" && isRecord(msg.values)) {
        values = msg.values;
        loaded = true;
        engineStatus.set("Réglages à jour.", "ok");
        renderEngine();
      } else if (
        msg.type === "configError" &&
        (msg.op === "settingsSet" || msg.op === "setBypass")
      ) {
        (msg.op === "setBypass" ? status : engineStatus).set(
          "Le serveur a refusé ce réglage.",
          "err",
        );
      }
    },
    /** État Bypass de la coquille (message `bypass` du serveur, ou `null` hors ligne). */
    setBypass(value) {
      bypass = value;
      renderBypass();
    },
    refresh: () => send({ type: "settingsGet" }),
    setOnline(value) {
      online = value;
      syncOnline(root, online);
    },
    /** Rafraîchit le temps restant du Bypass et l'état de la permission. */
    tick() {
      renderBypass();
      renderNotif();
    },
    isLoaded: () => loaded,
  };
}
