// Types de fenêtres du bureau (pur). Une fenêtre est soit une `iframe` de même origine (identité
// `(vue, cadre)`, la même clé que celle de l'hôte de cadres), soit un écran natif de la coquille
// (identité `native:<nom>`). Rouvrir une identité déjà ouverte la focalise au lieu d'en créer une seconde.

/** Écrans natifs ouvrables depuis le dock (lot 4 : les écrans eux-mêmes ; ici, un écran d'attente). */
export const NATIVE_SCREENS = [
  { name: "approvals", title: "Approbations" },
  { name: "containers", title: "Conteneurs" },
  { name: "providers", title: "Fournisseurs" },
  { name: "journal", title: "Journal" },
  { name: "settings", title: "Réglages" },
];

const IFRAME_KINDS = {
  mission: { view: "chat", label: "Mission" },
  monitor: { view: "viewer", mode: "watch", label: "Monitor" },
  graph: { view: "killchain", label: "Graphe" },
  report: { view: "viewer", mode: "report", label: "Rapport" },
  program: { view: "program", label: "Programme" },
  engagement: { view: "engagement", label: "Engagement" },
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Spécification d'une fenêtre à iframe, ou `null` si le type ou l'identifiant sont refusés. */
export function iframeSpec(kind, id) {
  const def = Object.hasOwn(IFRAME_KINDS, kind) ? IFRAME_KINDS[kind] : undefined;
  if (!def || typeof id !== "string" || !ID_PATTERN.test(id)) return null;
  return {
    key: `${def.view}:${id}`,
    kind: "iframe",
    type: kind,
    title: `${def.label} ${id}`,
    view: def.view,
    frame: id,
    mode: def.mode ?? null,
  };
}

/** Spécification d'une fenêtre native, ou `null` si l'écran est inconnu. */
export function nativeSpec(name) {
  const screen = NATIVE_SCREENS.find((s) => s.name === name);
  if (!screen) return null;
  return {
    key: `native:${name}`,
    kind: "native",
    type: "native",
    title: screen.title,
    name,
  };
}

/** Destination d'un lien profond (`parseDeepLink`) → spécification de fenêtre, ou `null`. */
export function specFromRoute(route) {
  if (route === null || typeof route !== "object") return null;
  if (route.kind === "approvals") return nativeSpec("approvals");
  if (route.kind === "native") return nativeSpec(route.name);
  return iframeSpec(route.kind, route.id);
}

/** Libellé court d'un onglet (dock, mode pile). */
export function shortTitle(title, max = 22) {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}
