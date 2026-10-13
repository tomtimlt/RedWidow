import type { Catalog, EventStrings, Messages } from "./catalog.js";

/** Dangers d'une commande shell (`ShellHazard`), tels que listés dans `bash.hazard`. */
const HAZARDS: Readonly<Record<string, string>> = {
  substitution: "substitution de commande",
  expansion: "expansion non résolue statiquement",
  redirect: "redirection",
  assignment: "affectation de variable en préfixe",
  background: "exécution en arrière-plan",
  indirection: "exécute une autre commande (bash -c, env, xargs, find -exec…)",
};

/** Nature des opérandes docker (`DockerOperandLabel`). */
const OPERANDS: Readonly<Record<string, string>> = {
  container: "conteneur",
  name: "nom",
  image: "image",
  target: "cible",
  since: "since",
};

const text = (v: string | number | undefined): string => (v === undefined ? "?" : String(v));

const REPO_HINT = "Après relecture : john policy trust";

/** Catalogue complet : `REASON_CODES` est testé contre lui. */
export const reasons: Catalog = {
  "policy.rule": (p) => `règle #${text(p.index)} ${text(p.decision)} ${text(p.target)}`,
  "policy.rule.custom": (p) => text(p.text),
  "policy.default": (p) => `aucune règle pour l'outil ${text(p.tool)}`,
  "bash.unparseable": (_p, c) => `commande non analysable : ${c.cause ?? "?"}`,
  "bash.empty": () => "commande vide",
  "bash.missingCommand": () => "commande absente",
  "bash.noRule": (p) => `aucune règle pour « ${text(p.command)} »`,
  "bash.hazard": (p) => {
    const labels = text(p.hazards)
      .split(",")
      .map((h) => HAZARDS[h] ?? h)
      .join(", ");
    return `non approuvable automatiquement : ${labels}`;
  },
  "docker.hostAccess": (p) => `conteneur avec accès à l'hôte (${text(p.flag)}) : à faire à la main`,
  "path.sensitive": (p) => `chemin sensible : ${text(p.path)}`,
  "path.outside": (p) => `chemin hors de l'espace de travail : ${text(p.path)}`,

  "approval.noAsker": (_p, c) => `${c.cause ?? "?"} (aucun approbateur interactif)`,
  "approval.interrupted": (_p, c) => `approbation interrompue : ${c.cause ?? "?"}`,
  "approval.timeout": (p, c) =>
    `aucune réponse en ${text(p.seconds)} s : refusé (${c.cause ?? "?"})`,
  "approval.remembered": (_p, c) => `autorisé pour la session (${c.cause ?? "?"})`,
  "guard.unrouted": (p) =>
    `appel non routé par la garde (canUseTool appelé sans décision PreToolUse : ${text(p.tool)}, ${text(p.toolUseId)})`,

  "auth.missingApiKey": () =>
    "--auth api-key exige la variable ANTHROPIC_API_KEY, qui n'est pas définie",
  "auth.failed": () =>
    "authentification refusée : lancez « claude » puis /login (ou « claude setup-token » et exportez CLAUDE_CODE_OAUTH_TOKEN), ou définissez ANTHROPIC_API_KEY",
  "auth.orgNotAllowed": () =>
    "l'organisation du compte connecté n'est pas autorisée : reconnectez-vous avec /login (compte autorisé) ou définissez ANTHROPIC_API_KEY",

  "shell.unclosedQuote": (p) => `guillemet ${text(p.quote)} non fermé`,
  "shell.trailingBackslash": () => "backslash final",

  "policy.invalid.object": () => "politique invalide : objet attendu",
  "policy.invalid.default": (p) => `politique invalide : default « ${text(p.value)} »`,
  "policy.invalid.rules": () => "politique invalide : rules doit être un tableau",
  "policy.invalid.ruleObject": (p) => `politique invalide : rules[${text(p.index)}] objet attendu`,
  "policy.invalid.ruleField": (p) =>
    `politique invalide : rules[${text(p.index)}].${text(p.field)}`,
  "policy.repo.untrusted": (p) =>
    `politique du dépôt ignorée (non approuvée) : ${text(p.path)} [sha256 ${text(p.digest)}]. ${REPO_HINT}`,
  "policy.repo.modified": (p) =>
    `politique du dépôt ignorée (modifiée depuis son approbation) : ${text(p.path)} [sha256 ${text(p.digest)}]. ${REPO_HINT}`,

  "docker.failed": (p) =>
    `${text(p.binary)} ${text(p.command)} a échoué (code ${text(p.exitCode)}) : ${text(p.stderr)}`,
  "docker.invalidOperand": (p) =>
    `${OPERANDS[text(p.label)] ?? text(p.label)} invalide : « ${text(p.value)} »`,
  "docker.invalidTail": (p) => `tail invalide : ${text(p.value)}`,
  "docker.invalidPort": (p) => `port invalide : « ${text(p.value)} »`,
  "docker.invalidEnvKey": (p) => `variable invalide : « ${text(p.key)} »`,
  "process.emptyArgv": () => "argv vide",
  "process.notFound": (p) => `binaire introuvable : ${text(p.binary)}`,

  "journal.invalidJson": (p) => `JSON invalide : ${text(p.message)}`,
  "event.notObject": () => "objet attendu",
  "event.unknownKind": (p) => `kind inconnu : ${text(p.kind)}`,
  "event.invalidVersion": () => "v invalide",
  "event.unsupportedVersion": (p) =>
    `version de schéma ${text(p.version)} non prise en charge (connue : ${text(p.known)})`,
  "event.missingField": (p) => `${text(p.field)} manquant`,
  "event.invalidField": (p) => `${text(p.field)} invalide`,

  "error.unknown": (p) => (p.message === undefined ? "erreur inconnue" : text(p.message)),
  legacy: (p) => text(p.text),
};

export const events: EventStrings = {
  run: "run",
  thinking: "réflexion",
  thinkingMasked: "réflexion (masquée)",
  deniedBySdk: "refusé par le SDK",
  retry: "nouvel essai",
  task: "tâche",
  rateLimit: "limite d'usage",
  session: "session",
  tools: "outils",
  turns: "tours",
  journalTruncated: "journal tronqué",
  lostEvents: "événements perdus",
  lines: "l.",
  authSubscription: "abonnement",
  authApiKey: "clé API",
  authCloud: "fournisseur cloud",
  authUnknown: "inconnue",
  authentication: "authentification",
  authenticating: "authentification en cours",
  approvalRequested: "approbation demandée",
  turn: "tour",
};

export const fr: Messages = { reasons, events };
