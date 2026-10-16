import { CodedError } from "../reason.js";

const MENTION = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g;
const SLASH_START = /^\/start\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\s*$/;
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

/** Commande opérateur `/start <nom>`. Toute autre forme, y compris des options, est refusée. */
export function parseSlashStart(text: string): string | null {
  const match = SLASH_START.exec(text.trim());
  return match?.[1] ?? null;
}

export interface ExegolTarget {
  /** Conteneur dédié du projet, ou `null` s'il n'y en a pas. */
  dedicated: string | null;
  /** Jetons `@` du message en cours. Vide : seul le dédié est admis. */
  mentions: readonly string[];
}

/**
 * Nom Docker autorisé pour cet appel, lu dans la liste courante.
 * Avec des `@`, uniquement un conteneur cité (court ou complet) qui existe.
 * Sans `@`, uniquement le dédié, et il doit exister. Jamais de nom construit.
 */
export function resolveExegolContainer(
  target: ExegolTarget,
  requested: string,
  containers: readonly NamedContainer[],
): string {
  const name = requested.trim();
  const real = lookupContainer(name, containers);
  if (real === null) throw new CodedError("exegol.containerDenied", { name });
  if (target.mentions.length > 0) {
    const cited = target.mentions.some((mention) => lookupContainer(mention, containers) === real);
    if (!cited) throw new CodedError("exegol.containerDenied", { name });
    return real;
  }
  if (target.dedicated === null || lookupContainer(target.dedicated, containers) !== real) {
    throw new CodedError("exegol.containerDenied", { name });
  }
  return real;
}

/** Cible du message en cours, lue par l'outil au moment de l'appel. */
export interface ExegolTargets {
  current(): ExegolTarget;
  note(text: string, dedicated: string | null): void;
}

export function createExegolTargets(): ExegolTargets {
  let target: ExegolTarget = { dedicated: null, mentions: [] };
  return {
    current: () => target,
    note(text, dedicated) {
      target = { dedicated, mentions: parseMentions(text) };
    },
  };
}
