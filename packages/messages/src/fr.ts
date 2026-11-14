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
const providerDiagnostic = (p: Record<string, string | number>, includeMessage: boolean): string =>
  `${p.provider === undefined ? "" : `\nFournisseur : ${text(p.provider)}`}${p.model === undefined ? "" : `\nModèle : ${text(p.model)}`}${p.tokenSource === undefined ? "" : `\nSource des identifiants : ${p.tokenSource === "indeterminate" ? "indéterminée (OpenCode)" : text(p.tokenSource)}`}${p.sourceFile === undefined ? "" : `\nCache OpenCode recherché : ${text(p.sourceFile)}`}${includeMessage && p.message !== undefined ? `\nMessage : ${text(p.message)}` : ""}`;

const REPO_HINT = "Après relecture : warband policy trust";

/** Catalogue complet : `REASON_CODES` est testé contre lui. */
export const reasons: Catalog = {
  "account.invalid": () =>
    "Compte de test invalide : vérifiez le libellé, l’hôte et les champs requis.",
  "integration.invalidConfig": () => "Configuration MCP locale invalide.",
  "integration.invalidResponse": () =>
    "Réponse MCP locale refusée : origine, taille ou format invalide.",
  "integration.unavailable": () =>
    "Service MCP local indisponible. Vérifier son état avant de retenter une action.",
  "integration.timeout": () =>
    "Délai MCP dépassé ; une action peut continuer. Vérifier son état avant toute relance.",
  "burp.invalidConfig": () =>
    "Configuration MCP Burp invalide : port local et transport SSE ou HTTP requis.",
  "burp.invalidResponse": () => "Réponse MCP Burp refusée : origine, format ou taille invalide.",
  "burp.unavailable": () =>
    "Connexion MCP Burp impossible ou interrompue. Vérifiez Burp et son extension MCP locale. Une action peut avoir continué : vérifiez son état avant de retenter.",
  "burp.timeout": () =>
    "Le serveur MCP Burp ne répond plus. Une action peut avoir continué : vérifiez son état dans Burp avant de retenter.",
  "opencode.httpFailed": (p) =>
    `requête OpenCode refusée : ${text(p.operation)} (HTTP ${text(p.status)})`,
  "kali.taskRequired": () =>
    "Scan complet non lancé : utilisez mcp__kali__task_start avec un argv nmap, puis task_status. nmap_scan est synchrone et peut expirer en laissant le processus actif. Consultez task_list avant de relancer une tâche ; les anciens scans synchrones n'y figurent pas.",
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
    `authentification refusée par le fournisseur ${text(p.provider)} : lancez « opencode auth login » ou transmettez sa clé avec --pass-env <VARIABLE>${providerDiagnostic(p, true)}`,
  "provider.error": (p) =>
    `erreur du fournisseur de modèle (${text(p.name)}) : ${text(p.message)}${p.status === undefined ? "" : ` [HTTP ${text(p.status)}]`}${providerDiagnostic(p, false)}`,
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
  "opencode.invalidVariant": () =>
    "variante de raisonnement indisponible pour le modèle OpenCode choisi : sélectionnez Auto ou actualisez le catalogue",
  "opencode.unsupportedEffort": () =>
    "les niveaux d'effort Claude ne sont pas pris en charge par OpenCode : choisissez une variante du catalogue",
  "task.invalidResponse": () =>
    "réponse de suivi de tâche invalide ; ne pas relancer sans vérifier les tâches existantes",
  "output.invalidPath": () =>
    "chemin de sortie refusé : relatif au dossier outputs, sans « .. », sans lien sortant",
  "output.notFound": () => "fichier de sortie introuvable ou non régulier dans le dossier outputs",
  "output.patternInvalid": (p) => `motif de recherche refusé (${text(p.reason)})`,
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
  "policy.repo.changedBeforeTrust": (p) =>
    `politique du dépôt modifiée avant son approbation, rien n'a été approuvé : ${text(p.path)}`,
  "policy.repo.modified": (p) =>
    `politique du dépôt ignorée (modifiée depuis son approbation) : ${text(p.path)} [sha256 ${text(p.digest)}]. ${REPO_HINT}`,

  "docker.failed": (p) =>
    `${text(p.binary)} ${text(p.command)} a échoué (code ${text(p.exitCode)}) : ${p.stderr === undefined || p.stderr === "" ? "aucun détail renvoyé par Docker" : text(p.stderr)}`,
  "docker.pathNotShared": (p) =>
    `Docker Desktop ne partage pas le dossier ${p.path === undefined ? "demandé" : text(p.path)} : ajoutez-le (ou son dossier parent) dans Docker Desktop, Settings > Resources > File sharing, puis « Apply & restart » et réessayez.`,
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
  "web.invalidUrl": () =>
    "Les outils web acceptent uniquement des URL HTTP(S) publiques, sans identifiants.",
  "kali.nmapUnavailable": () =>
    "Nmap ne peut pas s’exécuter dans ce conteneur. Vérifiez ses capacités Linux et les restrictions Docker.",
  "web.unavailable": (p) =>
    `La requête web a échoué${p.status ? ` (HTTP ${p.status})` : ""}. Réessayez ou vérifiez la connexion.`,
  "web.timeout": (p) =>
    `La requête web a dépassé le délai de ${text(p.seconds)} secondes. Le service ou la connexion ne répond pas assez vite.`,
  "web.dnsFailed": (p) =>
    `Impossible de résoudre l’adresse du service web (DNS : ${text(p.code)}). Vérifiez le réseau, le VPN ou le proxy du poste.`,
  "web.tlsFailed": (p) =>
    `Le certificat HTTPS du service web ou du proxy n’est pas validé (${text(p.code)}). Vérifiez les certificats et le proxy du poste ; la vérification TLS reste active.`,
  "web.connectionFailed": (p) =>
    `Connexion au service web impossible ou interrompue (${text(p.code)}). Vérifiez l’accès réseau, le VPN, le proxy ou le pare-feu du poste.`,
  "web.rateLimited": () =>
    "Le service web limite temporairement les requêtes (HTTP 429). Réessayez plus tard ; répéter immédiatement la même recherche n’aide pas.",
  "web.tooLarge": () =>
    "La page dépasse la limite de lecture de 1 Mio. Utilisez une page plus courte ou le fichier brut.",
  "web.unsupportedType": () =>
    "Ce contenu web n’est pas un texte pris en charge (page HTML, Markdown, JSON ou texte brut).",
  "web.reference_source": (p) =>
    `lecture autorisée : source de référence (${text(p.host)}), HTTPS uniquement`,
  "web.query_sensitive": (p) =>
    `${text(p.tool)} : la requête ou l'URL pourrait fuiter vers un tiers (constat : ${text(p.finding)} ; secret, valeur masquée ou adresse privée), approbation requise à chaque appel`,
  "web.redirectOffList": (p) =>
    `redirection vers ${text(p.host)}, hors des sources de référence : lecture interrompue ; rappelez read_url sur la cible pour la soumettre à approbation`,
  "research.techUnsearched": (p) =>
    `${text(p.tech)}${p.version === undefined ? "" : ` ${text(p.version)}`} identifié sans recherche web : chercher le composant et sa version (CVE, avis, configuration) avant de conclure`,
  "research.repeatedError": (p) =>
    `même erreur ${text(p.count)} fois (${text(p.tool)}) : chercher le message d'erreur du composant avant de réessayer`,
  "research.blocked": (p) =>
    `${text(p.count)} refus 403 ou WAF : chercher les contournements documentés du composant (sans y mettre d'identifiant de la cible)`,
  "research.noSearch": () =>
    "aucune recherche web dans ce run alors que les outils web sont exposés : chercher la pile identifiée",
  "mission.noContainer": () => "Pas de conteneur attaché : outils shell indisponibles.",
  "mission.sourceUnknown": () =>
    "source inconnue : citez l'appel d'outil ou un fichier produit dans ce run",
  "coverage.testRefUnknown": (p) =>
    `référence de test inconnue dans ce run : ${text(p.id)} n'est pas un événement audit.test`,
  "coverage.testRefRequired": (p) =>
    `case « ${text(p.surface)} » à l'état ${text(p.state)} : au moins une référence testRefs (événement audit.test du run) est requise`,
  "coverage.singleProbe": (p) =>
    `${text(p.count)} case(s) : une seule sonde : précise les variantes essayées ou garde untested`,
  "coverage.untested": (p) =>
    `${text(p.count)} case(s) de la matrice encore non testée(s) (${text(p.examples)}) : les tester, ou les marquer bloquée / prérequis manquant avec la justification, avant de conclure`,
  "supervision.checkpoint": (p) =>
    `${text(p.calls)} appels d'outils depuis la dernière décision : appeler record_decision (objectif, critère de sortie, prochaine action) avant de poursuivre`,
  "web.relayRefused": () =>
    "Relais tiers refusé vers une cible d’un programme validé : utilisez exec ou http_request.",
  "web.relayDiscouraged": () =>
    "Relais tiers déconseillé vers une cible : utilisez exec ou http_request pour conserver le trafic direct.",
  "web.targetRead": () =>
    "read_url retire le JavaScript, les commentaires et les champs cachés : pour tester la cible, utilisez le conteneur (exec) ou http_request",
  "web.invalidRequest": () =>
    "requête http_request invalide (méthode, en-têtes ou corps incompatibles)",
  "web.searchFailed": () =>
    "Le service de recherche n’a pas renvoyé de réponse exploitable. Réessayez plus tard.",
  "finding.busy": () =>
    "Les trouvailles du projet sont occupées. Réessayer après la fin de l’opération en cours.",
  "finding.notFound": () => "Trouvaille introuvable dans le projet actif.",
  "finding.invalidLinks": () =>
    "Liens de trouvaille invalides : référence inconnue ou cycle causal.",
  "finding.parentUnknown": (p) =>
    `parent de trouvaille inconnu : ${text(p.ids)} ; relire les ids avec list_notes (une note ancienne a pu être évincée) puis réessayer avec des ids existants.`,
  "finding.pathNotSubset": (p) =>
    `pathFrom doit être un sous-ensemble des parents from de la trouvaille : ${text(p.ids)} n'en fait pas partie ; relire list_notes.`,
  "finding.invalidInput": (p) =>
    `entrée invalide pour ${text(p.field)} : corriger ce champ puis réessayer.`,
  "finding.labelInvalid": (p) =>
    `libellé de trouvaille invalide : utiliser un titre de 1 à ${text(p.max)} caractères ; conserver les détails dans le fichier de résultats, puis réessayer note avec un titre court.`,
  "project.invalid": () => "projet invalide : fichier project.json illisible ou incomplet",
  "program.unreadable": (p) =>
    p.part === "sheet"
      ? "fiche programme illisible : approbation requise à chaque appel réseau vers un hôte connu"
      : p.part === "approval"
        ? "fiche programme : approbation illisible, fiche non appliquée"
        : "fiche programme : brouillon illisible, fiche non appliquée",
  "program.invalid": (p) =>
    `fiche programme invalide${p.field ? ` (champ : ${text(p.field)})` : ""} : motifs d'hôte, URL, date, suffixe et rythme attendus`,
  "program.absent": () => "aucune fiche programme à traiter pour ce projet",
  "program.out_of_scope": (p) =>
    `${text(p.tool)} : hôte hors du périmètre du programme (${text(p.host)}), approbation requise ; une approbation de session ne vaut que pour cet hôte`,
  "program.host_unresolved": (p) =>
    `${text(p.tool)} : hôte non déterminable (variable, liste, substitution ou cible absente), approbation requise à chaque appel`,
  "program.flag_missing": (p) =>
    `${text(p.binary)} : drapeau attendu par la fiche programme absent ou incompatible (${text(p.flag)}), approbation requise ; une approbation de session ne vaut que pour ce binaire`,
  "program.in_scope": (p) =>
    `${text(p.tool)} : hôte dans le périmètre du programme validé (${text(p.host)})`,
  "program.digestRequired": () =>
    "empreinte requise : relire « program show », puis relancer « program approve --digest <empreinte> »",
  "program.digestMismatch": (p) =>
    `le brouillon courant a changé (empreinte ${text(p.actual)}, attendue ${text(p.expected)}) : relire « program show » avant d'approuver`,
  "program.required": () =>
    "Le profil Bug bounty exige une fiche programme approuvée pour le projet actif (« program show », puis « program approve »)",
  "pace.edgeBanSuspected": (p) =>
    `Bannissement d’edge suspecté : arrêter toute requête vers ${p.host} pendant au moins cinq minutes. Passer à une source passive ou à un autre groupe réseau.`,
  "program.paced": (p) =>
    `rythme du programme : la requête vers ${text(p.host)} doit attendre ${text(p.retryAfterMs)} ms, au-delà du délai d'attente borné ; réessayez plus tard`,
  "program.halted": (p) =>
    `hôte ${text(p.host)} arrêté par le contrôleur de rythme (signaux répétés de limitation) : reprise par un humain avec « program resume ${text(p.host)} »`,
  "engagement.unreadable": (p) =>
    p.part === "approval"
      ? "fiche d'engagement : approbation illisible, fiche non appliquée"
      : p.part === "halt"
        ? "arrêt d'urgence : fichier illisible, arrêt considéré comme actif"
        : "fiche d'engagement : brouillon illisible, fiche non appliquée",
  "engagement.invalid": (p) =>
    `fiche d'engagement invalide${p.field ? ` (champ : ${text(p.field)})` : ""} : autorisation, fenêtre, périmètre, infrastructure distincte du périmètre, exclusions, règles, white team et politique OSINT attendus, chacun cité`,
  "engagement.required": () => "Le profil Red Team exige une fiche d’engagement validée.",
  "engagement.absent": () => "aucune fiche d'engagement à traiter pour ce projet",
  "engagement.digestRequired": () =>
    "empreinte requise : relire « engagement show », puis relancer « engagement approve --digest <empreinte> »",
  "engagement.digestMismatch": (p) =>
    `le brouillon courant a changé (empreinte ${text(p.actual)}, attendue ${text(p.expected)}) : relire « engagement show » avant d'approuver`,
  "engagement.halted": () =>
    "arrêt d'urgence actif pour ce projet : reprise par un humain avec « engagement resume »",
  "engagement.out_of_scope": (p) =>
    `${text(p.tool)} : hôte hors du périmètre et de l'infrastructure de l'engagement (${text(p.host)}), approbation requise ; une approbation de session ne vaut que pour cet hôte`,
  "engagement.infrastructure": (p) =>
    `${text(p.tool)} : hôte de l'infrastructure déclarée de l'engagement (${text(p.host)}), autorisé et journalisé`,
  "campaign.unreadable": (p) =>
    p.part === "approval"
      ? "plan de campagne : approbation illisible, plan non appliqué"
      : p.part === "steps"
        ? "plan de campagne : avancement illisible, aucune étape considérée comme exécutée"
        : p.part === "teardown"
          ? "démontage : avancement illisible, aucun élément considéré comme fait"
          : "plan de campagne : brouillon illisible, plan non appliqué",
  "campaign.invalid": (p) =>
    `plan de campagne invalide${p.field ? ` (champ : ${text(p.field)})` : ""} : synthèse de menace citée, objectifs, étapes ordonnées (identifiants uniques, tactique TA00xx et technique Txxxx facultatives, objectif existant) et liste de démontage attendus`,
  "campaign.absent": () => "aucun plan de campagne à traiter pour ce projet",
  "campaign.digestRequired": () =>
    "empreinte requise : relire « campaign show », puis relancer « campaign approve --digest <empreinte> »",
  "campaign.digestMismatch": (p) =>
    `le brouillon courant a changé (empreinte ${text(p.actual)}, attendue ${text(p.expected)}) : relire « campaign show » avant d'approuver`,
  "campaign.notApproved": (p) =>
    `aucun plan de campagne approuvé pour ce projet (état : ${text(p.state)}) : l'humain l'approuve avec « campaign approve --digest »`,
  "campaign.stepUnknown": (p) =>
    `étape ${text(p.stepId)} absente du plan de campagne approuvé : une étape hors plan ne peut pas être enregistrée`,
  "campaign.evidenceRequired": (p) =>
    `étape ${text(p.stepId)} : un résultat success ou partial exige au moins une référence de preuve (evidenceIds)`,
  "campaign.evidenceUnknown": (p) => `référence de preuve inconnue dans ce run : ${text(p.id)}`,
  "teardown.itemUnknown": (p) =>
    `élément de démontage ${text(p.itemId)} absent de la liste du plan de campagne approuvé`,
  "teardown.closeBlocked": (p) =>
    `clôture bloquée : ${text(p.count)} éléments de démontage restants (artefacts, comptes, infrastructure) ; les cocher avec record_teardown et une preuve`,
  "project.workspaceNotMounted": (p) =>
    `Le conteneur ${text(p.container)} partage le dossier ${text(p.mounted)}, qui ne contient pas le projet ${text(p.project)}. L’agent et le conteneur ne verraient pas les mêmes fichiers.`,
  "project.absent": () => "aucun projet actif",
  "project.readFailed": () => "lecture du projet impossible ce tour-ci",
  "cours.absent": () => "aucun cours installé (dossier de cours absent)",
  "exegol.containerDenied": (p) =>
    p.unlinked
      ? `${text(p.name)} n’est pas lié au projet : une mention @ ne suffit pas, liez-le dans le cockpit.`
      : `conteneur non autorisé pour ce message : ${text(p.name)} (choisissez un conteneur lié, cité par @ ou désigné par #)`,
  "kali.unavailable": (p) => {
    const name = text(p.name);
    if (p.reason === "unsupportedImage")
      return `préparation impossible dans ${name} : une image Kali avec APT est nécessaire pour installer le serveur manquant`;
    if (p.stage === "installing")
      return `installation du serveur Kali échouée dans ${name} : consultez la sortie RedWidow`;
    if (p.stage === "checking")
      return `vérification des prérequis Kali échouée dans ${name} : consultez la sortie RedWidow`;
    return `serveur Kali indisponible dans le conteneur : ${name}`;
  },

  "journal.invalidJson": (p) => `JSON invalide : ${text(p.message)}`,
  "event.notObject": () => "objet attendu",
  "event.unknownKind": (p) => `kind inconnu : ${text(p.kind)}`,
  "event.invalidVersion": () => "v invalide",
  "event.unsupportedVersion": (p) =>
    `version de schéma ${text(p.version)} non prise en charge (connue : ${text(p.known)})`,
  "event.missingField": (p) => `${text(p.field)} manquant`,
  "event.invalidField": (p) => `${text(p.field)} invalide`,

  "server.originMissing": () =>
    "REDWIDOW_PUBLIC_ORIGIN est obligatoire (ex. https://chasse.exemple.fr) : démarrage refusé",
  "server.originInvalid": () =>
    "REDWIDOW_PUBLIC_ORIGIN doit être une origine http(s) valide (ex. https://chasse.exemple.fr)",
  "server.passwordHashMissing": () =>
    "aucun mot de passe configuré : définissez REDWIDOW_PASSWORD_HASH ou lancez « redwidow-server set-password »",
  "server.passwordHashInvalid": () =>
    "l’empreinte du mot de passe est invalide : régénérez-la avec « redwidow-server set-password »",
  "server.passwordTooShort": (p) =>
    `mot de passe trop court : ${text(p.min)} caractères au minimum`,
  "server.passwordMismatch": () => "les deux saisies du mot de passe diffèrent",
  "server.passwordNeedsStdin": () =>
    "aucun terminal interactif : fournissez le mot de passe sur l’entrée standard avec --stdin",
  "server.secretKeyMissing": () =>
    "REDWIDOW_SECRET_KEY est obligatoire (32 caractères au minimum) : démarrage refusé",
  "server.secretKeyTooShort": (p) =>
    `REDWIDOW_SECRET_KEY est trop courte : ${text(p.min)} caractères au minimum`,
  "server.secretKeyWrong": () =>
    "REDWIDOW_SECRET_KEY ne correspond pas au coffre de secrets existant : démarrage refusé",
  "server.secretsCorrupt": () => "le fichier du coffre de secrets est illisible ou invalide",
  "server.secretEntryInvalid": () =>
    "une entrée du coffre de secrets est altérée (authentification échouée)",
  "server.secretNameInvalid": () => "nom de secret invalide ou réservé",
  "auth.required": () => "authentification requise",
  "auth.invalidCredentials": () => "identifiants invalides",
  "auth.rateLimited": (p) => `trop de tentatives : réessayez dans ${text(p.seconds)} s`,
  "auth.originDenied": () => "origine refusée",
  "docker.unavailable": () => "démon Docker injoignable",
  "terminal.invalidContainer": () => "nom ou identifiant de conteneur invalide",
  "terminal.notManaged": () => "conteneur non géré par RedWidow : terminal refusé",
  "terminal.notRunning": () => "le conteneur n’est pas démarré",
  "terminal.limit": () => "trop de terminaux ouverts",
  "terminal.inputTooLarge": () => "saisie trop volumineuse pour le terminal",
  "terminal.failed": () => "échec du terminal",
  "container.invalidName": () => "nom de conteneur invalide",
  "container.exists": () => "un conteneur porte déjà ce nom",
  "container.failed": () => "échec de l’opération sur le conteneur",
  "container.folderExists": () =>
    "un dossier partagé porte déjà ce nom : choisissez un autre nom de conteneur",
  "project.noContainer": () =>
    "créez d’abord un conteneur dans Conteneurs : un projet vit dans un conteneur",
  "project.unlinked": () =>
    "projet à lier : choisissez le conteneur où le déplacer pour l’utiliser",
  "project.containerUnknown": () => "conteneur inconnu ou sans dossier partagé",
  "project.moveFailed": () => "le déplacement du projet a échoué ; rien n’a été supprimé",
  "project.destExists": () => "le dossier de destination existe déjà ; rien n’a été écrasé",
  "exegol.notInstalled": () => "Exegol n’est pas installé dans cette image",
  "exegol.createFailed": () => "la création du conteneur Exegol a échoué",
  "exegol.vpnMissing": () => "choisissez d’abord une configuration VPN",
  "exegol.needsNat": () => "le VPN et le bureau web nécessitent le réseau NAT",
  "exegol.folderMissing": () => "choisissez d’abord le dossier partagé",
  "image.busy": () =>
    "une installation d’image est déjà en cours : attendez qu’elle se termine ou annulez-la",
  "image.invalidTag": () =>
    "étiquette d’image invalide (lettres minuscules, chiffres, « . », « _ » ou « - », 64 caractères au plus)",
  "image.rateLimited": () =>
    "Docker Hub limite le débit des téléchargements (erreur 429) : patientez quelques minutes, ou connectez le démon Docker à un compte Docker Hub, puis réessayez",
  "image.notFound": () =>
    "image introuvable sur le registre (étiquette inexistante ou accès refusé)",
  "image.inUse": () =>
    "l’image est utilisée par un conteneur : supprimez-le avant de la reconstruire",
  "exegol.eulaRequired": () =>
    "acceptez d’abord le contrat d’utilisation d’Exegol (bouton « Accepter le contrat »)",
  "exegol.eulaFailed": () => "l’enregistrement de l’acceptation du contrat Exegol a échoué",
  "vpn.invalid": () => "configuration VPN invalide (fichier .ovpn en texte attendu)",
  "folder.none": () => "aucun dossier à partager : créez d’abord un projet",
  "folder.invalid": () => "ce dossier ne peut pas être partagé",
  "folder.name": () =>
    "nom de dossier invalide (lettres, chiffres, point, tiret ou souligné ; 64 caractères au plus, sans point initial)",
  "import.tooLarge": () => "ce fichier est trop volumineux pour une fiche",
  "import.badFile": () => "fichier illisible (texte UTF-8 attendu)",
  "auth.badRequest": () => "requête invalide",
  "hostui.uploadForbidden": () => "aucun dialogue de téléversement en attente pour ce fichier",
  "hostui.uploadTooLarge": (p) => `fichier trop volumineux (maximum ${text(p.max)} octets)`,
  "hostui.uploadBadType": () => "type de fichier non accepté",
  "hostui.downloadGone": () => "téléchargement introuvable, déjà effectué ou expiré",
  "fs.noProject": () =>
    "aucun projet actif utilisable (dossier absent ou hors de la racine des conteneurs)",
  "fs.invalidPath": () => "chemin invalide",
  "fs.notFound": () => "fichier ou dossier introuvable",
  "fs.exists": () => "un fichier ou un dossier porte déjà ce nom",
  "fs.symlink": () => "lien symbolique refusé : jamais suivi",
  "fs.protected": () => "emplacement protégé (.git, node_modules)",
  "fs.notFile": () => "ce n’est pas un fichier",
  "fs.notDir": () => "ce n’est pas un dossier",
  "fs.notText": () => "fichier binaire : lecture en texte impossible",
  "fs.tooLarge": (p) => `fichier trop volumineux (maximum ${text(p.max)} octets)`,
  "fs.badType": () => "type de fichier non accepté",
  "fs.empty": () => "contenu vide",
  "fs.failed": () => "opération impossible sur le fichier",
  "fs.permission": () =>
    "droits insuffisants : ces fichiers appartiennent probablement à root (créés par le conteneur)",
  "fs.rootOwned": (p) =>
    p.container === undefined
      ? "Fichiers créés par le conteneur (root) : modifiez-les depuis son terminal"
      : `Fichiers créés par le conteneur (root) : démarrez le conteneur ${text(p.container)}, ou supprimez-les depuis son terminal`,
  "fs.rootRemoveFailed": (p) =>
    p.code === undefined
      ? "la suppression en root dans le conteneur a échoué"
      : `la suppression en root dans le conteneur a échoué (code ${text(p.code)})`,

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
  rotated: "bascule de clé",
  paceAdjusted: "rythme ajusté",
  paceHalted: "hôte arrêté",
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
  programSheet: "fiche programme",
  engagementSheet: "fiche d'engagement",
  engagementHalt: "arrêt d'urgence",
  campaignPlan: "plan de campagne",
  campaignStep: "étape",
  teardown: "démontage",
  turn: "tour",
  context: "contexte",
  sandbox: "bac à sable",
  terminal: "terminal",
};

export const fr: Messages = { reasons, events };
