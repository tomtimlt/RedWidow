import type { Catalog, EventStrings, Messages } from "./catalog.js";

/** Formes de chemin refusées (`path.unsupported`) ; la plupart ne concernent que Windows. */
const PATH_FORMS: Readonly<Record<string, string>> = {
  unc: "chemin réseau (UNC)",
  device: "chemin de périphérique (\\\\?\\ ou \\\\.\\)",
  ads: "flux de données alternatif (« : » dans le nom)",
  "drive-relative": "chemin relatif à un lecteur (« C:fichier »)",
  "trailing-dot-space": "nom se terminant par un point ou une espace",
  "reserved-name": "nom de périphérique réservé (CON, NUL, COM1…)",
  "env-var": "variable d'environnement non développée (%VAR%)",
  "short-name": "nom court 8.3 (~1) non résolu",
  unresolvable: "chemin impossible à résoudre de façon sûre",
};

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

/** Motifs de refus d'un argument docker (`docker.invalidArgument`). */
const ARGUMENT_REASONS: Readonly<Record<string, string>> = {
  nul: "contient un caractère NUL",
  tooMany: "trop d'éléments (256 au plus)",
  tooLarge: "trop volumineux (32 Kio au plus)",
  notStrings: "tableau de chaînes attendu",
  notString: "chaîne attendue",
  program: "le programme ne doit pas être vide ni commencer par « - »",
  delimiter: "caractère interdit dans le montage",
  relative: "chemin relatif ou non absolu",
  root: "racine du système de fichiers",
  socket: "socket Docker",
  missing: "dossier introuvable",
  unsupported: "chemin non analysable",
  sensitive: "chemin sensible",
  notDirectory: "dossier attendu",
};

/** Motifs de `sandbox.imageUnsupported`. */
const IMAGE_REASONS: Readonly<Record<string, string>> = {
  missing: "aucune image fournie : --sandbox-image ou la configuration utilisateur",
  absent: "image absente en local, le moteur ne télécharge jamais d'image",
  noSleep: "l'image doit fournir sleep",
  init: "l'image doit fournir mkdir et chmod",
};

/** Motifs de `sandbox.invalidArgument`. */
const SANDBOX_ARGUMENT_REASONS: Readonly<Record<string, string>> = {
  ...ARGUMENT_REASONS,
  empty: "vide",
  notAbsolute: "chemin absolu attendu",
  outside: "hors de /work ou contenant « .. »",
  range: "hors des bornes autorisées",
  format: "format non admis",
  required: "option --sandbox requise",
};

/** Motifs de `sandbox.tarRejected`. */
const TAR_REASONS: Readonly<Record<string, string>> = {
  symlink: "lien symbolique",
  hardlink: "lien dur",
  special: "type d'entrée non admis (périphérique, FIFO…)",
  traversal: "chemin sortant de la racine (..)",
  absolute: "chemin absolu",
  name: "nom d'entrée invalide",
  nameTooLong: "nom d'entrée trop long",
  winName: "nom réservé ou flux de données Windows",
  tooLarge: "taille au-delà du plafond",
  tooManyEntries: "trop d'entrées",
  pax: "en-tête pax non admis",
  malformed: "archive mal formée",
  checksum: "somme de contrôle invalide",
  truncated: "archive tronquée",
  multiRoot: "plusieurs racines",
  duplicate: "entrée en double",
  conflict: "un fichier sert de répertoire parent",
  destExists: "la destination existe déjà",
  destDenied: "destination hors de l'espace de travail",
  sensitive: "chemin sensible",
  notRegular: "ni fichier régulier ni répertoire",
};

const text = (v: string | number | undefined): string => (v === undefined ? "?" : String(v));

const REPO_HINT = "Après relecture : warband policy trust";

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
  "shell.unanalyzable": (p) =>
    `shell non analysable de façon sûre (${text(p.tool)}) : jamais approuvé automatiquement ni mémorisé`,
  "docker.hostAccess": (p) => `conteneur avec accès à l'hôte (${text(p.flag)}) : à faire à la main`,
  "path.sensitive": (p) => `chemin sensible : ${text(p.path)}`,
  "path.outside": (p) => `chemin hors de l'espace de travail : ${text(p.path)}`,
  "path.unsupported": (p) =>
    `chemin non analysable de façon sûre, refusé (${PATH_FORMS[text(p.form)] ?? text(p.form)}) : ${text(p.path)}`,

  "approval.noAsker": (_p, c) => `${c.cause ?? "?"} (aucun approbateur interactif)`,
  "approval.interrupted": (_p, c) => `approbation interrompue : ${c.cause ?? "?"}`,
  "approval.timeout": (p, c) =>
    `aucune réponse en ${text(p.seconds)} s : refusé (${c.cause ?? "?"})`,
  "approval.remembered": (_p, c) => `autorisé pour la session (${c.cause ?? "?"})`,
  "approval.bypassed": (_p, c) => `auto-approuvé par le bypass (${c.cause ?? "?"})`,
  "approval.override": (_p, c) =>
    `refus levé par le bypass, sous la responsabilité de l'utilisateur (${c.cause ?? "?"})`,
  "bypass.enabled": () => "bypass des approbations activé",
  "bypass.disabled": () => "bypass des approbations désactivé",
  "bypass.expired": () => "bypass des approbations expiré",
  "guard.unrouted": (p) =>
    `appel non routé par la garde (canUseTool appelé sans décision PreToolUse : ${text(p.tool)}, ${text(p.toolUseId)})`,

  "sdk.unexpectedTool": (p) =>
    `outil de shell inattendu annoncé par le SDK (${text(p.tool)}) : run arrêté`,

  "auth.missingApiKey": () =>
    "--auth api-key exige la variable ANTHROPIC_API_KEY, qui n'est pas définie",
  "auth.failed": () =>
    "authentification refusée : lancez « claude » puis /login (ou « claude setup-token » et exportez CLAUDE_CODE_OAUTH_TOKEN), ou définissez ANTHROPIC_API_KEY",
  "auth.orgNotAllowed": () =>
    "l'organisation du compte connecté n'est pas autorisée : reconnectez-vous avec /login (compte autorisé) ou définissez ANTHROPIC_API_KEY",

  "provider.authFailed": (p) =>
    `authentification refusée par le fournisseur ${text(p.provider)} : lancez « opencode auth login » ou transmettez sa clé avec --pass-env <VARIABLE>`,
  "provider.error": (p) =>
    `erreur du fournisseur de modèle (${text(p.name)}) : ${text(p.message)}${p.status === undefined ? "" : ` [HTTP ${text(p.status)}]`}`,
  "budget.exceeded": (p) =>
    `plafond de dépense dépassé : ${text(p.spent)} $ dépensés pour ${text(p.limit)} $ autorisés`,

  "opencode.unsafeConfig": (p) =>
    `configuration OpenCode trop permissive (${text(p.setting)}) : warband exige « ask » ou « deny » pour tous les outils`,
  "extension.binaryMismatch": () =>
    "binaire claude absent ou altéré (empreinte SHA-256 différente) : refusé",
  "ipc.invalidMessage": (p) => `message du moteur invalide (${text(p.field)}) : ignoré`,
  "ipc.unsupportedVersion": (p) =>
    `version de protocole non prise en charge (${text(p.version)}, attendue ${text(p.known)})`,
  "ipc.startTimeout": (p) => `le moteur n'a pas démarré en ${text(p.seconds)} s`,
  "ipc.engineExited": (p) =>
    `moteur terminé (${p.signal === undefined ? `code ${text(p.code)}` : `signal ${text(p.signal)}`})`,
  "opencode.noModel": () =>
    "aucun modèle : indiquez --model fournisseur/modèle (ou « model » dans la configuration OpenCode)",
  "opencode.invalidModel": (p) =>
    `modèle invalide : « ${text(p.value)} » (format attendu : fournisseur/modèle)`,
  "opencode.serverFailed": (p) => `le serveur OpenCode n'a pas démarré : ${text(p.detail)}`,
  "opencode.serverTimeout": (p) => `le serveur OpenCode n'a pas répondu en ${text(p.seconds)} s`,
  "opencode.sessionNotFound": (p) => `session OpenCode introuvable : ${text(p.id)}`,
  "opencode.pathUnknown": (p) =>
    `chemin de l'outil ${text(p.tool)} introuvable : refusé faute de pouvoir appliquer les garde-fous`,
  "opencode.replyFailed": (p) =>
    `réponse à une permission OpenCode refusée par le serveur (HTTP ${text(p.status)}) : session interrompue`,

  "shell.unclosedQuote": (p) => `guillemet ${text(p.quote)} non fermé`,
  "shell.trailingBackslash": () => "backslash final",

  "policy.invalid.object": () => "politique invalide : objet attendu",
  "policy.invalid.default": (p) => `politique invalide : default « ${text(p.value)} »`,
  "policy.invalid.rules": () => "politique invalide : rules doit être un tableau",
  "policy.invalid.ruleObject": (p) => `politique invalide : rules[${text(p.index)}] objet attendu`,
  "policy.invalid.ruleField": (p) =>
    `politique invalide : rules[${text(p.index)}].${text(p.field)}`,
  "policy.invalid.commandWildcard": (p) =>
    `politique invalide : rules[${text(p.index)}].command, « * » doit être un jeton entier (pas de joker partiel)`,
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
  "docker.invalidArgument": (p) =>
    `argument invalide (${text(p.field)}) : ${ARGUMENT_REASONS[text(p.reason)] ?? text(p.reason)}`,
  "docker.invalidBinary": (p) =>
    `binaire docker invalide : « ${text(p.binary)} » (nom simple ou chemin absolu attendu)`,
  "docker.unexpectedOutput": (p) =>
    `sortie inattendue de docker ${text(p.command)}${p.line === undefined ? "" : ` (ligne ${text(p.line)})`} : docker uniquement, podman n'est pas supporté`,
  "process.emptyArgv": () => "argv vide",
  "process.commandTooLong": (p) =>
    `ligne de commande trop longue pour le système (${text(p.length)} caractères)`,
  "process.notFound": (p) => `binaire introuvable : ${text(p.binary)}`,
  "binary.shimUnsupported": (p) =>
    `le script ${text(p.shim)} (shim .cmd/.bat) n'est jamais exécuté : indiquez le chemin absolu de l'.exe de ${text(p.binary)}`,

  "sandbox.tampered": (p) =>
    `bac à sable altéré (${text(p.field)}) : exécution refusée, jamais mémorisée`,
  "sandbox.unavailable": () => "bac à sable indisponible",
  "sandbox.unknownContainer": () => "conteneur inconnu du registre des bacs à sable : refusé",
  "sandbox.imageUnsupported": (p) =>
    `image de bac à sable inutilisable (${IMAGE_REASONS[text(p.reason)] ?? text(p.reason)})`,
  "sandbox.tarRejected": (p) =>
    `archive tar refusée (${TAR_REASONS[text(p.reason)] ?? text(p.reason)})${p.entry === undefined ? "" : ` : ${text(p.entry)}`}, rien n'a été écrit`,
  "sandbox.invalidArgument": (p) =>
    `argument invalide (${text(p.field)}) : ${SANDBOX_ARGUMENT_REASONS[text(p.reason)] ?? text(p.reason)}`,
  "sandbox.networkUnsafe": (p) =>
    p.reason === "adapterServer"
      ? "réseau bridge refusé : serveur local de l'adaptateur joignable depuis le conteneur"
      : `réseau bridge refusé : API Docker exposée sur 127.0.0.1:${text(p.port)}`,

  "sandbox.execTimeout": (p) =>
    `délai de ${text(p.seconds)} s dépassé : bac à sable ${p.restarted === 1 ? "redémarré" : "hors service"}. Sortie partielle :\n${text(p.output)}`,
  "sandbox.execAborted": (p) =>
    `exécution annulée : bac à sable ${p.restarted === 1 ? "redémarré" : "hors service"}. Sortie partielle :\n${text(p.output)}`,

  "sandbox.interpreter": (p) =>
    `interpréteur ou enveloppe dans le bac à sable (${text(p.program)}) : la commande réelle n'est pas vérifiable, approbation requise`,

  "project.notFound": (p) => `conteneur introuvable : ${text(p.name)}`,
  "project.notExegol": (p) => `conteneur non Exegol : ${text(p.name)}`,
  "project.notRunning": (p) => `conteneur arrêté : ${text(p.name)}`,
  "project.noWorkspace": (p) => `conteneur sans montage /workspace : ${text(p.name)}`,
  "project.invalid": () => "projet invalide : fichier project.json illisible ou incomplet",
  "project.absent": () => "aucun projet actif",
  "project.readFailed": () => "lecture du projet impossible ce tour-ci",
  "cours.absent": () => "aucun cours installé (dossier de cours absent)",
  "exegol.containerDenied": (p) =>
    `conteneur non autorisé pour ce message : ${text(p.name)} (allowlist du projet, cité par @, ou désigné par #)`,
  "kali.unavailable": (p) => `serveur Kali indisponible dans le conteneur : ${text(p.name)}`,

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
  user: "utilisateur",
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
  bypass: "bypass",
  turn: "tour",
  sandbox: "bac à sable",
};

export const fr: Messages = { reasons, events };
