/** Choix visuels fermés : aucune saisie utilisateur n'est interprétée par un shell. */
export const TERMINAL_PROMPTS = ["native", "redwidow", "compact", "minimal"] as const;
export type TerminalPrompt = (typeof TERMINAL_PROMPTS)[number];

export function isTerminalPrompt(value: unknown): value is TerminalPrompt {
  return TERMINAL_PROMPTS.includes(value as TerminalPrompt);
}

export function terminalPromptOf(value: unknown): TerminalPrompt {
  return isTerminalPrompt(value) ? value : "native";
}

const PS1: Record<Exclude<TerminalPrompt, "native">, string> = {
  redwidow:
    "\\[\\e[31m\\]┌─[RedWidow] \\[\\e[0m\\]\\u@\\h \\[\\e[36m\\]\\w\\[\\e[0m\\]\\n\\[\\e[31m\\]└─\\$\\[\\e[0m\\] ",
  compact: "\\[\\e[36m\\]\\u@\\h\\[\\e[0m\\]:\\w\\$ ",
  minimal: "\\w\\$ ",
};

/** Réservé aux constantes de ce module, pas à du contenu fourni par le projet. */
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Scripts constants du lanceur : aucun guillemet ni retour à la ligne dans l’argv transporté. */
export function encodedBashScript(script: string, args: readonly string[] = []): string[] {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return ["/bin/bash", "-c", `source <(printf %s ${encoded} | base64 -d)`, "redwidow", ...args];
}

/** Bash interactif éphémère : conserve le rc utilisateur sans l'écrire sur disque. */
export function terminalShell(style: TerminalPrompt = "native"): string[] {
  if (!isTerminalPrompt(style)) throw new Error("Style de prompt invalide");
  if (style === "native") return ["/bin/bash"];
  // Réappliquer après les hooks existants sans les effacer ni transformer un tableau en chaîne.
  // Le statut entrant est rendu tel quel ; aucun fichier de configuration n'est modifié.
  const rc = [
    "if [[ -r ~/.bashrc ]]; then . ~/.bashrc; fi",
    `__redwidow_apply_prompt() { local status=$?; PS1=${quote(PS1[style])}; return "$status"; }`,
    "__redwidow_apply_prompt",
    'case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in',
    '  "declare -a "*) PROMPT_COMMAND+=(__redwidow_apply_prompt) ;;',
    "  *) PROMPT_COMMAND=\"${PROMPT_COMMAND:+$PROMPT_COMMAND$'\\n'}__redwidow_apply_prompt\" ;;",
    "esac",
  ].join("\n");
  const encoded = Buffer.from(rc, "utf8").toString("base64");
  return ["/bin/bash", "-c", `exec /bin/bash --rcfile <(printf %s ${encoded} | base64 -d) -i`];
}

/** Commande fermée pour `script -c`, quel que soit le shell défini dans l'image. */
export function terminalShellCommand(style: TerminalPrompt): string {
  return terminalShell(style).map(quote).join(" ");
}
