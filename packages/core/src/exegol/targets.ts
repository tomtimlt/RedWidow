import { CodedError } from "../reason.js";

const MENTION = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g;

/** Coupe la consigne de la sortie de terminal citée par `#`. Tout ce qui suit est ignoré par la cible. */
export const TERMINAL_CONTEXT_MARK = "\n\n<<<sortie-terminal>>>\n";

/** Texte qui décide des `@`. La sortie collée après le marqueur n'y entre pas. */
export function promptForTargets(text: string): string {
  const at = text.indexOf(TERMINAL_CONTEXT_MARK);
  return at === -1 ? text : text.slice(0, at);
}

const EXEGOL_PREFIX = "exegol-";

/** Nom affiché et cité : un seul préfixe `exegol-` retiré, s'il reste quelque chose. */
export function shortContainerName(name: string): string {
  if (!name.startsWith(EXEGOL_PREFIX)) return name;
  const rest = name.slice(EXEGOL_PREFIX.length);
  return rest === "" ? name : rest;
}

export interface NamedContainer {
  name: string;
}

/**
 * Nom Docker de la liste courante correspondant au jeton (nom complet ou court).
 * Absent ou ambigu : `null`. Ne construit jamais un nom.
 */
export function lookupContainer(
  token: string,
  containers: readonly NamedContainer[],
): string | null {
  const want = token.trim();
  if (want === "") return null;
  const names = [
    ...new Set(
      containers
        .filter((c) => c.name === want || shortContainerName(c.name) === want)
        .map((c) => c.name),
    ),
  ];
  return names.length === 1 ? (names[0] ?? null) : null;
}

/** Noms cités par `@` dans une consigne, sans doublon, dans l'ordre d'apparition. */
export function parseMentions(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const name = match[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

export interface ExegolTarget {
  /** Noms réels copiés de l'allowlist du projet actif au moment du message. */
  allowed: readonly string[];
  /** Jetons `@` du message en cours. Vide : un seul conteneur allowlisté et listé de la famille est admis. */
  mentions: readonly string[];
  /** Projet actif au moment du message, ou `null`. L'outil ne le reçoit pas du modèle. */
  projectId: string | null;
}

/**
 * Résolution commune : seules les entrées de `family` comptent. Un champ absent est ignoré.
 * Le nom réel doit être une entrée exacte de `allowed`.
 * Avec des `@`, il doit être l'un des `@` résolus sur cette même liste.
 * Sans `@`, l'intersection entre `allowed` et les noms listés de la famille doit être exactement ce nom.
 * Jamais de nom construit.
 */
function resolveListedContainer(
  family: "exegol" | "kali",
  target: ExegolTarget,
  requested: string,
  containers: readonly NamedContainer[],
): string {
  const name = requested.trim();
  const listed = containers.filter((c) => (c as { family?: unknown }).family === family);
  const real = lookupContainer(name, listed);
  if (real === null || !target.allowed.includes(real)) {
    throw new CodedError("exegol.containerDenied", { name });
  }
  if (target.mentions.length > 0) {
    const cited = target.mentions.some((mention) => lookupContainer(mention, listed) === real);
    if (!cited) throw new CodedError("exegol.containerDenied", { name });
    return real;
  }
  const familyNames = new Set(listed.map((c) => c.name));
  const intersection = [...new Set(target.allowed.filter((n) => familyNames.has(n)))];
  if (intersection.length !== 1 || intersection[0] !== real) {
    throw new CodedError("exegol.containerDenied", { name });
  }
  return real;
}

/**
 * Nom Docker autorisé pour cet appel, lu dans la liste courante.
 * Seules les entrées `family === "exegol"` comptent ; un champ absent est ignoré.
 * Avec des `@`, uniquement un conteneur cité (court ou complet) qui existe.
 * Sans `@`, uniquement le dédié, et il doit exister. Jamais de nom construit.
 */
export function resolveExegolContainer(
  target: ExegolTarget,
  requested: string,
  containers: readonly NamedContainer[],
): string {
  return resolveListedContainer("exegol", target, requested, containers);
}

/**
 * Nom Docker autorisé pour un outil Kali. Même règles que `resolveExegolContainer`,
 * sur les seules entrées `family === "kali"`. Un dédié Exegol ne résout pas un Kali.
 */
export function resolveKaliContainer(
  target: ExegolTarget,
  requested: string,
  containers: readonly NamedContainer[],
): string {
  return resolveListedContainer("kali", target, requested, containers);
}

/** Cible du message en cours, lue par l'outil au moment de l'appel. */
export interface ExegolTargets {
  current(): ExegolTarget;
  note(text: string, allowed: readonly string[], projectId: string | null): void;
}

export function createExegolTargets(): ExegolTargets {
  let target: ExegolTarget = { allowed: [], mentions: [], projectId: null };
  return {
    current: () => target,
    note(text, allowed, projectId) {
      target = {
        allowed: [...allowed],
        mentions: parseMentions(promptForTargets(text)),
        projectId,
      };
    },
  };
}
