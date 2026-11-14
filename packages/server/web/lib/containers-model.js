// Logique pure de l'écran Conteneurs : lecture défensive des messages du serveur (`containers`, `projects`,
// `images`, `imageProgress`), regroupement des projets, disponibilité des boutons, formats. Aucune
// manipulation du DOM ici : tout est testable sous Node. Toute donnée reçue est bornée et nettoyée.
import { isRecord, safeText } from "../screens/common.js";

/** Nom ou identifiant de conteneur accepté par le serveur (miroir de `CONTAINER_REF`). */
export const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Étiquette d'image Exegol acceptée par le serveur (miroir de `isExegolTag`). */
export const EXEGOL_TAG = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KINDS = ["kali", "exegol", "autre"];
/** Plafond de couches affichées (le reste est résumé). */
export const MAX_LAYERS = 12;

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Message `containers` → éléments lisibles (entrées illisibles écartées). */
export function parseContainers(msg) {
  if (!isRecord(msg) || !Array.isArray(msg.items)) return [];
  const out = [];
  for (const it of msg.items.slice(0, 500)) {
    if (!isRecord(it) || typeof it.id !== "string" || it.id === "") continue;
    const projects = [];
    if (Array.isArray(it.projects)) {
      for (const p of it.projects.slice(0, 500)) {
        if (isRecord(p) && typeof p.id === "string" && p.id !== "") {
          projects.push({ id: safeText(p.id, 128), name: safeText(p.name, 120) || p.id });
        }
      }
    }
    out.push({
      id: it.id,
      name: safeText(it.name, 128) || it.id.slice(0, 12),
      image: safeText(it.image, 200),
      state: it.state === "running" ? "running" : "stopped",
      kind: KINDS.includes(it.kind) ? it.kind : "autre",
      project: typeof it.project === "string" ? safeText(it.project, 64) : "",
      folder: typeof it.folder === "string" && CONTAINER_NAME.test(it.folder) ? it.folder : "",
      projects,
    });
  }
  return out;
}

/** Message `projects` → { id, name, linked, container } (entrées illisibles écartées). */
export function parseProjectList(msg) {
  if (!isRecord(msg) || !Array.isArray(msg.items)) return [];
  const out = [];
  for (const it of msg.items.slice(0, 1000)) {
    if (!isRecord(it) || typeof it.id !== "string" || it.id === "") continue;
    out.push({
      id: safeText(it.id, 128),
      name: safeText(it.name, 120) || safeText(it.id, 128),
      linked: it.linked === true,
      container: typeof it.container === "string" ? safeText(it.container, 128) : "",
    });
  }
  return out;
}

/**
 * Regroupe les projets par conteneur : `groups` (ordre des conteneurs connus, puis les autres noms),
 * `toLink` (projets « à lier », sans conteneur). Un projet lié à un conteneur inconnu garde son groupe.
 */
export function groupProjects(projects, containers) {
  const toLink = [];
  const byName = new Map();
  for (const p of projects) {
    if (!p.linked || p.container === "") {
      toLink.push(p);
      continue;
    }
    const list = byName.get(p.container) ?? [];
    list.push(p);
    byName.set(p.container, list);
  }
  const groups = [];
  for (const c of containers) {
    const list = byName.get(c.name);
    if (list !== undefined) {
      groups.push({ container: c.name, known: true, items: list });
      byName.delete(c.name);
    }
  }
  for (const [name, items] of byName) groups.push({ container: name, known: false, items });
  return { groups, toLink };
}

/** Nombre de projets d'un conteneur : la liste du serveur, à défaut le regroupement des projets. */
export function projectCount(container, grouped) {
  if (container.projects.length > 0) return container.projects.length;
  return grouped.groups.find((g) => g.container === container.name)?.items.length ?? 0;
}

/** Vérifie le nom saisi pour un nouveau conteneur : message d'erreur ou `null`. */
export function checkContainerName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return "Donnez un nom au conteneur.";
  if (!CONTAINER_NAME.test(name))
    return "Nom refusé : lettres, chiffres, « _ », « . » et « - », sans tiret initial (128 caractères au plus).";
  return null;
}

/** Vérifie le nom d'un nouveau projet (miroir du serveur : 1 à 80 caractères, sans contrôle). */
export function checkProjectName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return "Donnez un nom au projet.";
  if (name.length > 80) return "Nom trop long (80 caractères au plus).";
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return "Le nom ne doit pas contenir de caractère de contrôle.";
  }
  return null;
}

/** Message `images` → état normalisé, ou `null` si illisible. */
export function parseImages(msg) {
  if (!isRecord(msg)) return null;
  const docker = isRecord(msg.docker) ? msg.docker : {};
  const kali = isRecord(msg.kali) ? msg.kali : {};
  const exegol = isRecord(msg.exegol) ? msg.exegol : {};
  const installed = [];
  for (const it of Array.isArray(exegol.installed) ? exegol.installed.slice(0, 100) : []) {
    if (isRecord(it) && typeof it.tag === "string" && EXEGOL_TAG.test(it.tag)) {
      const size = num(it.size);
      installed.push({ tag: it.tag, ...(size !== undefined && { size }) });
    }
  }
  const available = Array.isArray(exegol.available)
    ? exegol.available.filter((t) => typeof t === "string" && EXEGOL_TAG.test(t)).slice(0, 50)
    : [];
  const kaliSize = num(kali.size);
  return {
    docker: { present: docker.present === true, daemon: docker.daemon === true },
    kali: {
      image: safeText(kali.image, 200),
      installed: kali.installed === true,
      ...(kaliSize !== undefined && { size: kaliSize }),
    },
    exegol: {
      cli: exegol.cli === true,
      eulaAccepted: exegol.eulaAccepted === true,
      installed,
      available,
    },
  };
}

/** Message `imageProgress` → progression normalisée, ou `null` si illisible. */
export function parseImageProgress(msg) {
  if (!isRecord(msg) || typeof msg.id !== "string" || msg.id === "") return null;
  if (msg.kind !== "kali" && msg.kind !== "exegol") return null;
  const layers = [];
  for (const l of Array.isArray(msg.layers) ? msg.layers.slice(0, 200) : []) {
    if (!isRecord(l) || typeof l.id !== "string") continue;
    const current = num(l.current);
    const total = num(l.total);
    const speed = num(l.speedBytesPerSecond);
    layers.push({
      id: safeText(l.id, 80),
      status: safeText(l.status, 80),
      phase: l.phase === "download" || l.phase === "extract" ? l.phase : "other",
      ...(current !== undefined && { current }),
      ...(total !== undefined && { total }),
      ...(speed !== undefined && { speed }),
    });
  }
  return {
    id: safeText(msg.id, 64),
    kind: msg.kind,
    phase: msg.phase === "pull" || msg.phase === "build" ? msg.phase : "",
    stage: safeText(msg.stage, 200),
    message: typeof msg.message === "string" ? safeText(msg.message, 400) : "",
    layers,
    busy: msg.busy === true,
    done: msg.done === true,
    cancelled: msg.cancelled === true,
    error: typeof msg.error === "string" ? safeText(msg.error, 400) : "",
    code: typeof msg.code === "string" ? safeText(msg.code, 80) : "",
  };
}

/** Pourcentage (0-100) d'une couche, ou `null` si sa taille est inconnue. */
export function layerPercent(layer) {
  if (layer.total === undefined || layer.total <= 0) return null;
  const done = Math.min(layer.current ?? 0, layer.total);
  return Math.round((done / layer.total) * 100);
}

/** Pourcentage global du téléchargement (couches de taille connue), ou `null`. */
export function overallPercent(layers) {
  let done = 0;
  let total = 0;
  for (const l of layers) {
    if (l.phase !== "download" || l.total === undefined || l.total <= 0) continue;
    total += l.total;
    done += Math.min(l.current ?? 0, l.total);
  }
  return total > 0 ? Math.round((done / total) * 100) : null;
}

/** Taille lisible (o, Ko, Mo, Go) ; « — » si inconnue. */
export function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = i === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${text.replace(".", ",")} ${units[i]}`;
}

/** Vitesse lisible (« 12,3 Mo/s ») ; chaîne vide si inconnue. */
export const formatSpeed = (bps) => (bps === undefined ? "" : `${formatBytes(bps)}/s`);

/**
 * Disponibilité des boutons. Un seul téléchargement à la fois : tout bouton d'installation est désactivé
 * tant qu'une installation tourne (`progress.busy`) ou qu'une demande vient de partir (`pending`). Hors
 * ligne, rien ne part. Docker doit répondre ; Exegol demande sa commande et son contrat.
 * @param {{ online: boolean, images: ReturnType<typeof parseImages>, progress: ReturnType<typeof parseImageProgress> | null, pending: boolean }} s
 */
export function installAvailability({ online, images, progress, pending }) {
  const busy = pending || progress?.busy === true;
  const daemon = images?.docker.daemon === true;
  const docker = daemon && images.docker.present === true;
  const base = online && !busy;
  return {
    busy,
    kaliInstall: base && docker && images?.kali.installed !== true,
    kaliRebuild: base && docker && images?.kali.installed === true,
    exegolEula: online && images?.exegol.cli === true && !images.exegol.eulaAccepted,
    exegolInstall:
      base && daemon && images?.exegol.cli === true && images.exegol.eulaAccepted === true,
    cancel: online && progress?.busy === true && progress.id !== "",
  };
}
