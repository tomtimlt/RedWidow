import { CodedError } from "../reason.js";

const MENTION = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g;
const HASH = /(?:^|[\s(])#([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g;
/** `@` et `#` du texte, dans l'ordre. Même jeton que `MENTION` et `HASH`. */
const KALI_TOKEN = /(?:^|[\s(])([@#])([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g;
/** Shell au-delà du premier : `#court-2` … `#court-4`. L'indice 1 est le nom court. */
const SHELL_SUFFIX = /-([2-4])$/;

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
  return collectTokens(text, MENTION);
}

/** Jetons `#` d'une consigne, sans doublon, dans l'ordre. La sortie de terminal n'y est pas. */
export function parseHashes(text: string): string[] {
  return collectTokens(text, HASH);
}

function collectTokens(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Jeton `@` ou `#` du fil. `@` nomme, `#` désigne (nom, court nom ou shell). */
export interface KaliRecall {
  sigil: "@" | "#";
  token: string;
}

/** `@` et `#` du texte, dans l'ordre d'apparition. */
function kaliTokens(text: string): KaliRecall[] {
  const out: KaliRecall[] = [];
  for (const match of text.matchAll(KALI_TOKEN)) {
    const sigil = match[1];
    const token = match[2];
    if ((sigil === "@" || sigil === "#") && token !== undefined) out.push({ sigil, token });
  }
  return out;
}

/**
 * Conteneur unique désigné par un jeton : nom complet, nom court, ou shell
 * (`court-2` … `court-4`). Toute la liste compte. Absent ou ambigu : `null`.
 */
export function containerDesignatedBy(
  token: string,
  containers: readonly NamedContainer[],
): string | null {
  const want = token.trim();
  if (want === "") return null;
  const names = new Set<string>();
  const suffix = SHELL_SUFFIX.exec(want);
  for (const container of containers) {
    if (container.name === want || shortContainerName(container.name) === want) {
      names.add(container.name);
      continue;
    }
    if (suffix !== null && want === `${shortContainerName(container.name)}-${suffix[1]}`) {
      names.add(container.name);
    }
  }
  return names.size === 1 ? ([...names][0] ?? null) : null;
}

export interface ExegolTarget {
  /** Noms réels copiés de l'allowlist du projet actif au moment du message. */
  allowed: readonly string[];
  /** Jetons `@` du message en cours. Vide : un seul conteneur allowlisté et listé de la famille est admis. */
  mentions: readonly string[];
  /** Projet actif au moment du message, ou `null`. L'outil ne le reçoit pas du modèle. */
  projectId: string | null;
  /**
   * Cause d'un `projectId` nul par échec de lecture (jamais posé pour « aucun projet actif »).
   * `"invalid"` : `project.json` invalide, pas de nouvelle tentative ce tour-ci.
   * `"readFailed"` : erreur transitoire, une relecture déjà tentée a échoué aussi.
   * N'influence que le code de raison choisi par l'outil `note` : jamais l'allowlist ni la résolution
   * de conteneur, qui restent fail-closed (ADR 0015).
   */
  blocked?: "invalid" | "readFailed";
  /**
   * Jetons `#` du message, hors sortie de terminal. Sans `@`, ils autorisent les outils Kali
   * sur le conteneur unique qu'ils désignent ; un `#` ne remplace pas un `@`.
   * `resolveExegolContainer` les ignore.
   */
  hashes?: readonly string[];
  /**
   * `@` et `#` du fil, du plus ancien au plus récent, seulement quand ce message
   * n'en a aucun. Le plus récent qui désigne un Kali allowlisté tient lieu du dédié.
   * `resolveExegolContainer` l'ignore.
   */
  recall?: readonly KaliRecall[];
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
    throw new CodedError("exegol.containerDenied", {
      name,
      ...(real !== null && !target.allowed.includes(real) ? { unlinked: 1 } : {}),
    });
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
 * Kali de la liste désigné par ce jeton, ou `null`.
 * Un `@` ne compte que sur la liste Kali. Un `#` compte le shell, puis seulement si c'est un Kali.
 */
function designatedKali(
  recall: KaliRecall,
  listed: readonly NamedContainer[],
  containers: readonly NamedContainer[],
): string | null {
  if (recall.sigil === "@") return lookupContainer(recall.token, listed);
  const name = containerDesignatedBy(recall.token, containers);
  if (name === null || !listed.some((c) => c.name === name)) return null;
  return name;
}

/**
 * Nom Docker autorisé pour un outil Kali. Même règles que `resolveExegolContainer`
 * pour `@` et l'allowlist, sur les seules entrées `family === "kali"`.
 * Un `#` qui désigne un seul conteneur de la liste (nom complet, court, ou shell)
 * autorise ce conteneur allowlisté, sans `@`. Un `@` est la cible d'exécution : un `#`
 * du même message ne le remplace pas. Un Exegol allowlisté ne résout pas un Kali.
 * Sans `@` ni `#` dans le message, le `@` ou `#` le plus récent du fil qui désigne
 * un Kali allowlisté tient lieu du dédié. Un jeton qui n'en désigne pas ne le remplace pas.
 * Le `#` ou `@` en tête du champ est retiré par l'appelant (`containerToken`).
 */
export function resolveKaliContainer(
  target: ExegolTarget,
  requested: string,
  containers: readonly NamedContainer[],
): string {
  const name = requested.trim();
  const listed = containers.filter((c) => (c as { family?: unknown }).family === "kali");
  const fromShell = containerDesignatedBy(name, containers);
  const real =
    lookupContainer(name, listed) ??
    (fromShell !== null && listed.some((c) => c.name === fromShell) ? fromShell : null);
  if (real === null || !target.allowed.includes(real)) {
    throw new CodedError("exegol.containerDenied", { name });
  }
  const hashes = target.hashes ?? [];
  const stack = target.recall;
  if (
    target.mentions.length === 0 &&
    hashes.length === 0 &&
    stack !== undefined &&
    stack.length > 0
  ) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const item = stack[i];
      if (item === undefined) continue;
      const designated = designatedKali(item, listed, containers);
      if (designated === null || !target.allowed.includes(designated)) continue;
      if (designated !== real) throw new CodedError("exegol.containerDenied", { name });
      return real;
    }
  }
  const citedAt = target.mentions.some((mention) => lookupContainer(mention, listed) === real);
  if (citedAt) return real;
  // Un `#` est du contexte : il ne remplace pas un `@` déjà présent.
  if (target.mentions.length > 0) throw new CodedError("exegol.containerDenied", { name });
  const citedHash = hashes.some((hash) => containerDesignatedBy(hash, containers) === real);
  if (citedHash) return real;
  const familyNames = new Set(listed.map((c) => c.name));
  const intersection = [...new Set(target.allowed.filter((n) => familyNames.has(n)))];
  if (intersection.length !== 1 || intersection[0] !== real) {
    throw new CodedError("exegol.containerDenied", { name });
  }
  return real;
}

/** Cible du message en cours, lue par l'outil au moment de l'appel. */
export interface ExegolTargets {
  current(): ExegolTarget;
  note(
    text: string,
    allowed: readonly string[],
    projectId: string | null,
    blocked?: "invalid" | "readFailed",
  ): void;
  /**
   * Dossier hôte `outputs` du projet ouvert, où les sorties complètes des commandes sont
   * sauvegardées. Absent : l'extrait est renvoyé sans sauvegarde.
   */
  outputRoot?(): string | undefined;
}

export function createExegolTargets({
  outputRoot,
}: {
  outputRoot?: () => string | undefined;
} = {}): ExegolTargets {
  let target: ExegolTarget = { allowed: [], mentions: [], projectId: null, hashes: [] };
  const recall: KaliRecall[] = [];
  return {
    current: () => target,
    ...(outputRoot && { outputRoot }),
    note(text, allowed, projectId, blocked) {
      const prompt = promptForTargets(text);
      const mentions = parseMentions(prompt);
      const hashes = parseHashes(prompt);
      const named = kaliTokens(prompt);
      if (named.length > 0) recall.push(...named);
      target = {
        allowed: [...allowed],
        mentions,
        projectId,
        hashes,
        ...(blocked !== undefined && { blocked }),
      };
      if (mentions.length === 0 && hashes.length === 0 && recall.length > 0) {
        target = { ...target, recall: recall.slice() };
      }
    },
  };
}

/** Résultat d'une lecture du projet actif pour un tour (`onPrompt`, ADR 0015 point 3). */
export interface ProjectReadOutcome {
  /** Allowlist à copier dans la cible : vide dès que `projectId` est nul. */
  containers: readonly string[];
  /** Projet actif, ou `null` (aucun projet actif, ou lecture en échec : fail-closed). */
  projectId: string | null;
  /** Cause d'un `projectId` nul par échec de lecture ; absent pour « aucun projet actif ». */
  blocked?: "invalid" | "readFailed";
}

/**
 * Lecture robuste du projet actif pour un tour : ne relance jamais l'exception à l'appelant.
 * - `read` renvoie `null`, ou `getActive` renvoie `null` : aucun projet actif, résultat normal.
 * - `read`/`getActive` lève `project.invalid` : pas de nouvelle tentative, drapeau `"invalid"`.
 * - toute autre exception : une seule relecture ; si elle échoue aussi (quelle qu'en soit la cause),
 *   drapeau `"readFailed"`.
 * Isolée ici (plutôt que recopiée dans `onPrompt`) pour rester testable sans canal IPC.
 */
export async function readActiveProjectForPrompt<
  F,
  A extends { id: string; containers: readonly string[] },
>(read: () => Promise<F | null>, getActive: (file: F) => A | null): Promise<ProjectReadOutcome> {
  const attempt = async (): Promise<ProjectReadOutcome> => {
    const file = await read();
    const active = file === null ? null : getActive(file);
    return active === null
      ? { containers: [], projectId: null }
      : { containers: active.containers, projectId: active.id };
  };
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof CodedError && err.code === "project.invalid") {
      return { containers: [], projectId: null, blocked: "invalid" };
    }
    try {
      return await attempt();
    } catch {
      return { containers: [], projectId: null, blocked: "readFailed" };
    }
  }
}
