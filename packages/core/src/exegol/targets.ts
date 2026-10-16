import { CodedError } from "../reason.js";

const MENTION = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g;
const SLASH_START = /^\/start\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\s*$/;

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
 * Nom autorisé pour cet appel. Avec des `@`, uniquement ceux-là.
 * Sans `@`, uniquement le conteneur dédié, et le nom demandé doit être le sien.
 */
export function resolveExegolContainer(target: ExegolTarget, requested: string): string {
  const name = requested.trim();
  if (target.mentions.length > 0) {
    if (!target.mentions.includes(name)) throw new CodedError("exegol.containerDenied", { name });
    return name;
  }
  if (target.dedicated === null || name !== target.dedicated) {
    throw new CodedError("exegol.containerDenied", { name });
  }
  return name;
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
