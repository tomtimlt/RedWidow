import { TERMINAL_CONTEXT_MARK } from "@warband/core";

/** Octets lus en fin de fichier, avant nettoyage des séquences. */
export const TERMINAL_TAIL_RAW = 65_536;
/** Texte gardé pour le modèle, après nettoyage. */
export const TERMINAL_TAIL_CHARS = 16_384;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HASH = /(?:^|[\s(])#([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g;

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
  if (!LOG_PATH.test(logPath)) throw new Error("chemin de journal refusé");
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

/** Indice porté par le titre `Warband : <réel>` ou `Warband : <réel> (n)`, puis jeton court. */
export function mentionToken(real: string, title: string, short: string): string | null {
  if (title === `Warband : ${real}`) return shellToken(short, 1);
  const prefix = `Warband : ${real} (`;
  if (!title.startsWith(prefix) || !title.endsWith(")")) return null;
  const index = Number(title.slice(prefix.length, -1));
  return shellToken(short, index);
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

/** Jetons `#` d'une consigne, sans doublon, dans l'ordre. */
export function parseHashes(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(HASH)) {
    const name = match[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Sortie lisible : sans séquences, fin du tampon. Vide → une ligne fixe. */
export function readableTerminal(raw: string, max = TERMINAL_TAIL_CHARS): string {
  const clean = stripControls(raw)
    .split("\n")
    .filter((line) => !line.startsWith("Script started on ") && !line.startsWith("Script done on "))
    .join("\n")
    .replaceAll(TERMINAL_CONTEXT_MARK, "");
  const tail = clean.length > max ? clean.slice(-max) : clean;
  const trimmed = tail.trim();
  return trimmed === "" ? "Tampon vide." : trimmed;
}

/**
 * Consigne affichée, puis le marqueur et les extraits. Sans extrait : la consigne seule.
 * Chaque extrait nomme le terminal (`#jeton`). S'il s'agit du shell d'un conteneur, le nom
 * Docker réel suit, en clair : ce n'est pas un `@`, donc pas une autorisation.
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
