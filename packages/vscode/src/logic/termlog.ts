import {
  containerDesignatedBy,
  type NamedContainer,
  parseHashes,
  TERMINAL_CONTEXT_MARK,
} from "@warband/core";
import { type Locale, t, translateFr } from "@warband/messages";

import { productTitleSuffix } from "./brand.js";

export { parseHashes };

/** Octets lus en fin de fichier, avant nettoyage des séquences. */
export const TERMINAL_TAIL_RAW = 65_536;
/** Texte gardé pour le modèle, après nettoyage. */
export const TERMINAL_TAIL_CHARS = 16_384;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** Retire retours chariot et séquences d'échappement (CSI, OSC, simple). */
function stripControls(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 13) continue;
    if (code !== 27) {
      out += raw[i];
      continue;
    }
    const next = raw.charCodeAt(i + 1);
    if (next === 91) {
      i += 2;
      while (i < raw.length && raw.charCodeAt(i) < 64) i++;
    } else if (next === 93) {
      i += 2;
      while (i < raw.length) {
        const cur = raw.charCodeAt(i);
        if (cur === 7) break;
        if (cur === 27 && raw.charCodeAt(i + 1) === 92) {
          i++;
          break;
        }
        i++;
      }
    } else if (Number.isFinite(next)) {
      i += 1;
    }
  }
  return out;
}

/** Dossier des journaux de shell, dans le conteneur (jamais sur l'hôte). */
export const CONTAINER_LOG_DIR = "/tmp/warband-terminals";
const LOG_PATH = /^\/tmp\/warband-terminals\/[A-Za-z0-9][A-Za-z0-9_.-]{0,63}-[0-9a-f]{8}\.log$/;

/**
 * Chemin du journal d'un shell : jeton validé et suffixe aléatoire (deux fenêtres VS Code ne
 * partagent jamais un fichier). `null` si le jeton ou le suffixe ne tient pas.
 */
export function containerLogPath(token: string, suffix: string): string | null {
  const path = `${CONTAINER_LOG_DIR}/${token}-${suffix}.log`;
  return TOKEN.test(token) && LOG_PATH.test(path) ? path : null;
}

function assertLogPath(logPath: string): string {
  if (!LOG_PATH.test(logPath)) throw new Error(t("chemin de journal refusé"));
  return logPath;
}

/**
 * Programme du shell capturé, exécuté DANS le conteneur : `script` (util-linux, présent dans les
 * images Exegol) garde le pty et journalise la session ; sans `script`, bash nu (pas de capture).
 * Le script est constant ; le chemin passe en argument positionnel, jamais interpolé.
 */
export function capturedShell(logPath: string): string[] {
  const body = [
    `mkdir -p ${CONTAINER_LOG_DIR} && chmod 700 ${CONTAINER_LOG_DIR}`,
    'if command -v script >/dev/null 2>&1; then exec script -q -f -c /bin/bash "$1"; fi',
    "exec /bin/bash",
  ].join("; ");
  return ["/bin/bash", "-c", body, "warband", assertLogPath(logPath)];
}

/** Lecture de la fin du journal (argv de `docker exec`, sans shell). */
export function tailCommand(logPath: string): string[] {
  return ["tail", "-c", String(TERMINAL_TAIL_RAW), assertLogPath(logPath)];
}

/** Suppression du journal à la fermeture du terminal. */
export function removeLogCommand(logPath: string): string[] {
  return ["rm", "-f", assertLogPath(logPath)];
}

/** Jeton `#` : nom court, puis `nom-2` pour le deuxième shell. `null` si le jeton ne tient pas. */
export function shellToken(short: string, index: number): string | null {
  if (!Number.isInteger(index) || index < 1 || index > 4) return null;
  const token = index === 1 ? short : `${short}-${index}`;
  return TOKEN.test(token) ? token : null;
}

/** Indice du titre actuel ou historique exact, puis jeton court. */
export function mentionToken(real: string, title: string, short: string): string | null {
  const suffix = productTitleSuffix(title);
  if (suffix === real) return shellToken(short, 1);
  const prefix = `${real} (`;
  if (suffix === null || !suffix.startsWith(prefix) || !suffix.endsWith(")")) return null;
  const index = suffix.slice(prefix.length, -1);
  if (!/^[2-4]$/.test(index)) return null;
  return shellToken(short, Number(index));
}

const clipLine = (value: string): string => (value.length > 72 ? `${value.slice(0, 71)}…` : value);

/** Dernière commande visible, sinon la dernière ligne, pour distinguer deux shells. */
export function lastCommand(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && line !== "Tampon vide.");
  let fallback = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    if (fallback === "") fallback = line;
    const prompt = /[#%$]\s+(\S.*)$/.exec(line);
    if (prompt?.[1]) return clipLine(prompt[1]);
  }
  return fallback === "" ? "" : clipLine(fallback);
}

/** Sortie lisible : sans séquences, fin du tampon. Vide → une ligne fixe. */
export function readableTerminal(
  raw: string,
  max = TERMINAL_TAIL_CHARS,
  locale: Locale = "fr",
): string {
  const clean = stripControls(raw)
    .split("\n")
    .filter((line) => !line.startsWith("Script started on ") && !line.startsWith("Script done on "))
    .join("\n")
    .replaceAll(TERMINAL_CONTEXT_MARK, "");
  const tail = clean.length > max ? clean.slice(-max) : clean;
  const trimmed = tail.trim();
  return trimmed === "" ? translateFr("Tampon vide.", locale) : trimmed;
}

/**
 * Consigne affichée, puis le marqueur et les extraits. Sans extrait : la consigne seule.
 * Chaque extrait garde le `#jeton` et la sortie (le ping). Le nom Docker suit quand il est connu.
 */
export function withTerminalContext(
  text: string,
  sections: readonly { token: string; text: string; container?: string }[],
): string {
  if (sections.length === 0) return text;
  const body = sections
    .map((section) => {
      const name = section.container;
      const head =
        name !== undefined && name !== ""
          ? `Terminal #${section.token}, shell du conteneur ${name}.`
          : `Terminal #${section.token}.`;
      return `${head}\n${section.text}`;
    })
    .join("\n\n");
  return `${text}${TERMINAL_CONTEXT_MARK}${body}`;
}

export interface ClassifiedHashes {
  /** Jetons dont le shell est ouvert. */
  open: string[];
  /** Jetons qui désignent un seul conteneur de la liste. */
  designated: string[];
  /** Ni shell ouvert, ni conteneur unique. */
  unknown: string[];
}

/** Classe les `#` : terminal ouvert, conteneur de la liste, ou inconnu. */
export function classifyMessageHashes(
  hashes: readonly string[],
  hasShell: (token: string) => boolean,
  containers: readonly NamedContainer[],
): ClassifiedHashes {
  const open: string[] = [];
  const designated: string[] = [];
  const unknown: string[] = [];
  for (const token of hashes) {
    const shell = hasShell(token);
    const container = containerDesignatedBy(token, containers);
    if (shell) open.push(token);
    if (container !== null) designated.push(token);
    if (!shell && container === null) unknown.push(token);
  }
  return { open, designated, unknown };
}
