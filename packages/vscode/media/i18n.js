"use strict";
(() => {
  // packages/messages/src/ui-domains/audit.ts
  var auditEn = {
    "1 faille confirmée": "1 confirmed vulnerability",
    "{0} failles confirmées": "{0} confirmed vulnerabilities",
    Couverture: "Coverage",
    "Aucune case de couverture enregistrée.": "No coverage cell recorded.",
    "{0} % des cases testées ({1} cases)": "{0} % of cells tested ({1} cells)",
    "Filtrer par état": "Filter by state",
    "Tous les états": "All states",
    "Aucune case dans cet état.": "No cell in this state.",
    "Non testé": "Untested",
    Négatif: "Negative",
    Bloqué: "Blocked",
    Prérequis: "Prerequisite",
    "Prérequis manquant": "Missing prerequisite",
    Surface: "Surface",
    Paramètre: "Parameter",
    Classe: "Class",
    Note: "Note",
    "{0} contrôles · {1} Kio conservés": "{0} tests · {1} KiB retained",
    Audit: "Audit",
    Demandé: "Requested",
    "Retour reçu": "Returned",
    Erreur: "Error",
    Refusé: "Denied",
    Capturé: "Captured",
    Annoté: "Annotated",
    Constat: "Finding",
    "Non observé": "Not observed",
    "Non concluant": "Inconclusive",
    Agent: "Agent",
    "Brouillon automatique": "Automatic draft",
    "Brouillons automatiques et annotations de l’agent : vérifiez objectif, cible et preuves avant de les qualifier.":
      "Automatic drafts and agent annotations: check objective, target and evidence before assessing them.",
    "Capture automatique": "Automatic capture",
    Auto: "Auto",
    Partiel: "Partial",
    "En pause": "Paused",
    "À qualifier": "Needs review",
    "Revu par l’opérateur": "Reviewed by operator",
    "Registre des contrôles": "Test registry",
    "Journal de mission": "Mission timeline",
    "Aucun contrôle enregistré.": "No tests recorded.",
    "Une exécution enregistrée ne constitue pas un contrôle validé.":
      "A recorded execution is not a validated test.",
    "Les journaux JSONL contiennent les traces conservées. Cet HTML est un aperçu borné.":
      "The JSONL journals contain the retained records. This HTML is a bounded preview.",
    "Les captures manuelles sont périodiques et bornées ; les outils externes ne sont pas enregistrés.":
      "Manual terminal captures are periodic and bounded; external tools are not recorded.",
    "Collecte incomplète : consulter les interruptions et les limites dans manifest.json.":
      "Incomplete capture: see interruptions and limits in manifest.json.",
    Filtrer: "Filter",
    "Tous les acteurs": "All actors",
    Opérateur: "Operator",
    Système: "System",
    "Le dossier d’audit ne peut pas être écrasé par son export.":
      "An audit export cannot overwrite its storage directory.",
    "Activez un projet pour démarrer sa collecte Audit automatique.":
      "Activate a project to start its automatic Audit capture.",
    "Journal d’audit indisponible.": "Audit journal unavailable.",
    "Exporter le dossier d’audit": "Export audit bundle",
    "Actions de l’agent et captures périodiques des terminaux RedWidow associés au projet, même sans IA. Conservation séparée du chat, sans effacement automatique.":
      "Agent actions and periodic captures of project-linked RedWidow terminals, even without AI. Stored separately from chat, with no automatic deletion.",
    "Le ZIP contient un HTML autonome, le registre, les preuves conservées, les JSONL et un manifeste SHA-256. Ces empreintes ne sont ni une signature ni un horodatage indépendant.":
      "The ZIP contains standalone HTML, the registry, retained evidence, JSONL journals and a SHA-256 manifest. These hashes are neither a signature nor an independent timestamp.",
    "Collecte partielle : pauses, captures indisponibles ou sorties tronquées. Consultez les traces et le manifeste.":
      "Partial capture: pauses, unavailable captures or truncated output. See records and manifest.",
    "Aperçu limité aux traces récentes. Les journaux conservés restent présents dans le ZIP ; le registre exporté est également un aperçu.":
      "Preview limited to recent records. Retained journals remain in the ZIP; the exported registry is also a preview.",
    "{0} traces affichées · {1} contrôles · {2} Kio conservés":
      "{0} records shown · {1} tests · {2} KiB retained",
    "Objectif du contrôle": "Test objective",
    Cible: "Target",
    "Contexte de test / accès": "Test context / access",
    Méthode: "Method",
    "Observations et limites": "Observations and limits",
    "Conclusion du contrôle": "Test conclusion",
    "Enregistrer ma qualification": "Save my assessment",
    "Cible, outil, commande ou résultat": "Target, tool, command or result",
    "À partir du (heure locale)": "From (local time)",
    "Jusqu’au (heure locale)": "Until (local time)",
    "Tous les événements": "All events",
    "{0} traces correspondantes": "{0} matching records",
    requested: "Requested",
    returned: "Returned",
    error: "Error",
    denied: "Denied",
    captured: "Captured",
    annotated: "Annotated",
    unreviewed: "Needs review",
    finding: "Finding",
    "not-observed": "Not observed",
    inconclusive: "Inconclusive",
    agent: "Agent",
    operator: "Operator",
    system: "System",
    "La collecte Audit est incomplète. Ouvrez Audit pour consulter son état.":
      "Audit capture is incomplete. Open Audit to inspect its status.",
    "Choisissez un fichier local pour l’export Audit.": "Choose a local file for the Audit export.",
    "Export Audit…": "Exporting Audit…",
    "Afficher le fichier": "Show file",
    "Dossier d’audit exporté. L’empreinte SHA-256 est dans Output → RedWidow.":
      "Audit bundle exported. Its SHA-256 hash is in Output → RedWidow.",
    "Capture automatique des actions et des terminaux RedWidow du projet. Cliquez pour consulter les limites et exporter.":
      "Automatic capture of project actions and RedWidow terminals. Click to inspect limits and export.",
  };
  var AUDIT_LABELS = {
    requested: "Demandé",
    returned: "Retour reçu",
    error: "Erreur",
    denied: "Refusé",
    captured: "Capturé",
    annotated: "Annoté",
    unreviewed: "À qualifier",
    finding: "Constat",
    "not-observed": "Non observé",
    inconclusive: "Non concluant",
    agent: "Agent",
    operator: "Opérateur",
    system: "Système",
    automatic: "Brouillon automatique",
  };

  // packages/messages/src/ui-domains/chat.ts
  var chatEn = {
    Pentest: "Pentest",
    "Hack The Box / CTF": "Hack The Box / CTF",
    "Aucun conteneur lié : l'agent n'a pas de shell": "No linked container: the agent has no shell",
    "Lier un conteneur": "Link a container",
    "Lier {0} à ce projet ?": "Link {0} to this project?",
    Ignorer: "Ignore",
    "Identifiant détecté : il a été masqué dans les journaux. Utilisez la page Comptes de test pour que l'agent puisse s'en servir.":
      "Credential detected: it was masked in logs. Use the Test accounts page so the agent can use it.",
    "La signature de l’image ne correspond pas à son format.":
      "The image signature does not match its format.",
    "Ce modèle ne prend pas les images en charge.": "This model does not support images.",
    "La prise en charge des images par ce modèle est inconnue.":
      "Image support for this model is unknown.",
    "Limite des images : 5 Mio par image et 12 Mio au total.":
      "Image limit: 5 MiB per image and 12 MiB total.",
    "Seuls les textes UTF-8 et les images PNG, JPEG, GIF ou WebP sont pris en charge. Les PDF et binaires sont refusés.":
      "Only UTF-8 text and PNG, JPEG, GIF or WebP images are supported. PDFs and binary files are rejected.",
    "Ces fichiers seront transmis au fournisseur. Seuls leurs noms apparaissent dans la conversation. N’ajoutez pas de secrets.":
      "These files will be sent to the provider. Only their names appear in the conversation. Do not attach secrets.",
    "Partage du projet non vérifié : terminal ouvert dans /workspace. {0}":
      "Project share could not be verified: terminal opened in /workspace. {0}",
    "Le pentest dans VS Code, avec l’IA à la demande.": "Pentest in VS Code, with AI on call.",
    Copié: "Copied",
    Échec: "Failed",
    Copier: "Copy",
    Entrée: "Input",
    Sortie: "Output",
    "Copier le message": "Copy message",
    Critique: "Critical",
    Élevée: "High",
    Moyenne: "Medium",
    Faible: "Low",
    Info: "Info",
    "À évaluer": "Unrated",
    Rapport: "Report",
    "Exporter le brouillon Markdown": "Export Markdown draft",
    terminée: "completed",
    "en cours": "running",
    "en attente d'accord": "awaiting approval",
    "à venir": "upcoming",
    réussi: "succeeded",
    erreur: "error",
    refusé: "denied",
    approuvé: "approved",
    "en attente": "pending",
    actuelle: "current",
    "Fais un nmap peu verbeux et résume les ports ouverts":
      "Run a quiet nmap scan and summarize the open ports",
    "Parmi les services trouvés, lesquels valent un test en premier ?":
      "Which of the discovered services should we test first?",
    "Cherche les pages qui prennent un paramètre et sentent l'injection":
      "Find pages that accept parameters and look vulnerable to injection",
    "Pilote tes conteneurs depuis le cockpit, travaille dans les terminaux et relie tes trouvailles dans la Kill chain. L’IA intervient à la demande et reste optionnelle.":
      "Manage your containers from the cockpit, work in terminals and connect your findings in the Kill chain. AI is available on request and remains optional.",
    Exécution: "Execution",
    Réseau: "Network",
    Mémorisable: "Can be remembered",
    "Autorisation requise": "Approval required",
    " · réseau activé": " · network enabled",
    Outil: "Tool",
    Action: "Action",
    Raison: "Reason",
    Détails: "Details",
    "Confirmation native en cours…": "Native confirmation in progress…",
    Refusé: "Denied",
    Autorisé: "Allowed",
    "Autoriser une fois": "Allow once",
    Refuser: "Deny",
    Toujours: "Always",
    "Modèle par défaut": "Default model",
    "Réglage warband.model, sinon le modèle du binaire.":
      "The warband.model setting, otherwise the binary’s default model.",
    Gratuit: "Free",
    "Modèle annoncé « Free » par le fournisseur.": "Model advertised as “Free” by the provider.",
    actuel: "current",
    "Chargement de la liste…": "Loading the list…",
    "Aucun modèle ne correspond.": "No matching model.",
    "Récupération des modèles… Vous pouvez relancer si le chargement ne répond pas.":
      "Retrieving models… You can restart if loading stops responding.",
    "Liste indisponible. Vérifiez la connexion au fournisseur, puis réessayez.":
      "List unavailable. Check the provider connection, then try again.",
    "Relancer le chargement": "Restart loading",
    "Actualiser la liste": "Refresh list",
    Auto: "Auto",
    "Ce modèle n'a pas d'effort réglable.": "This model has no adjustable effort.",
    "Aucune variante de raisonnement connue pour ce modèle. Actualisez la liste des modèles.":
      "No known reasoning variants for this model. Refresh the model list.",
    Apprentissage: "Learning",
    "Bypass · en attente": "Bypass · pending",
    Bypass: "Bypass",
    Supervisé: "Supervised",
    "Réduire le texte": "Collapse text",
    "Afficher tout le texte": "Show full text",
    "Inopérant en mode Apprentissage": "Inactive in Learning mode",
    "terminal ouvert": "open terminal",
    arrêté: "stopped",
    "Aucun terminal RedWidow ouvert. {0} pour en ouvrir un.":
      "No RedWidow terminal open. Press {0} to open one.",
    "Aucun conteneur": "No containers",
    Terminaux: "Terminals",
    Conteneurs: "Containers",
    "Conteneurs, fichiers et contexte": "Containers, files and context",
    "Notes Kill Chain du projet actif": "Kill Chain notes of the active project",
    "Aucun projet actif": "No active project",
    "Aucune note dans le projet actif": "No notes in the active project",
    "Dernière sortie d’outil de la session": "Last tool output of the session",
    "Aucune sortie d’outil dans cette session": "No tool output in this session",
    fichier: "file",
    "Fichier refusé : chemin sensible ou hors de l’espace de travail.":
      "File refused: sensitive path or outside the workspace.",
    "Fichier introuvable.": "File not found.",
    "Fichier trop volumineux : 64 Kio au maximum.": "File too large: 64 KiB maximum.",
    "Rien à joindre.": "Nothing to attach.",
    "Mention invalide.": "Invalid mention.",
    "{0} utilisés": "{0} used",
    "{0} / {1} ({2} %)": "{0} / {1} ({2}%)",
    "Utilisation du contexte inconnue pour ce fournisseur":
      "Context usage unknown for this provider",
    "Filtrer les conversations par projet": "Filter conversations by project",
    "Sans projet": "No project",
    "Tous les projets": "All projects",
    "Supprimer toutes les conversations de ce chat, tous projets compris":
      "Delete all conversations in this chat, across all projects",
    "Aucune conversation enregistrée.": "No saved conversations.",
    "Nouveau titre": "New title",
    "Ouvrir en lecture seule": "Open read-only",
    Renommer: "Rename",
    Supprimer: "Delete",
    " · journal tronqué": " · truncated log",
    Reprendre: "Resume",
    "Reprendre (nouvelle session)": "Resume (new session)",
    "Désactiver le suivi du bas pour défiler librement":
      "Disable bottom following to scroll freely",
    "Activer le suivi et revenir en bas": "Enable following and return to bottom",
    "Activer le suivi du bas": "Enable bottom following",
    "sortie tronquée": "truncated output",
    "Suivre la sortie": "Follow output",
    "Chargement…": "Loading…",
    "Messages précédents": "Earlier messages",
    "Envoi refusé ou interrompu. Le texte reste dans le brouillon.":
      "Send refused or interrupted. The text remains in the draft.",
    "Envoi refusé ou interrompu. Les fichiers restent dans le brouillon.":
      "Send rejected or interrupted. Files remain in the draft.",
    "Maximum 10 fichiers joints.": "Maximum 10 attachments.",
    "Limite : 64 Kio par fichier et 256 Kio au total.": "Limit: 64 KiB per file and 256 KiB total.",
    "Nom de fichier invalide.": "Invalid file name.",
    "Seuls les textes, logs et fichiers de code UTF-8 sont pris en charge. Images et PDF exclus.":
      "Only UTF-8 text, log and code files are supported. Images and PDFs are excluded.",
    "Impossible de lire ce fichier : un texte UTF-8 valide est requis.":
      "Unable to read this file: valid UTF-8 text is required.",
    "Ce fichier n’est pas un texte UTF-8 pris en charge.": "This file is not supported UTF-8 text.",
    "Ces fichiers seront transmis au fournisseur et conservés dans le journal de conversation. N’ajoutez pas de secrets.":
      "These files will be sent to the provider and saved in the conversation log. Do not include secrets.",
    "Impossible de lire ces fichiers en UTF-8.": "Unable to read these files as UTF-8.",
    "La consigne dépasse la limite de 100 000 caractères.":
      "The instruction exceeds the 100,000 character limit.",
    "Par défaut": "Default",
    "En attente de votre accord": "Awaiting your approval",
    "Fournisseur indisponible · nouvelle tentative en attente":
      "Provider unavailable · retry pending",
    Réflexion: "Thinking",
    "En attente : actif dès que l'agent le confirme.": "Pending: active once the agent confirms.",
    "Bypass désactivé avant confirmation.": "Bypass disabled before confirmation.",
    "Bypass terminé.": "Bypass ended.",
    "{0}\n[…tronqué]": "{0}\n[…truncated]",
    "Bac à sable actif : les commandes tournent dans {0}.": "Sandbox active: commands run in {0}.",
    "Demande d'autorisation : {0}": "Approval request: {0}",
    "Modèle : {0} (utilisé pour le message suivant)": "Model: {0} (used for the next message)",
    "Configurer : effort {0}": "Configure: effort {0}",
    "Mode de supervision : {0}. Ouvrir Configurer": "Supervision mode: {0}. Open Configure",
    "Mode de supervision : Bypass, reste {0}. Ouvrir Configurer":
      "Supervision mode: Bypass, {0} remaining. Open Configure",
    "Bypass actif jusqu'à {0} : désactivable dans Configurer ou la barre d'état":
      "Bypass active until {0}: disable in Configure or the status bar",
    "Lecture seule : {0}": "Read-only: {0}",
    " · {0} ligne(s) du journal ignorée(s)": " · {0} log line(s) ignored",
    "Commande {0} : {1}, {2}": "Command {0}: {1}, {2}",
    "Bac à sable : {0} · réseau activé": "Sandbox: {0} · network enabled",
    "Bac à sable : {0}": "Sandbox: {0}",
    "{0} · {1} Kio": "{0} · {1} KiB",
    "Retirer {0}": "Remove {0}",
    "Outil : {0}": "Tool: {0}",
    "Actif jusqu'à {0} (reste {1}). Échéance fixée par le moteur.":
      "Active until {0} ({1} remaining). Expiry set by the engine.",
    "Mode de supervision : ouvrir Configurer": "Supervision mode: open Configure",
    MODE: "MODE",
    "Mode Apprentissage : lecture des cours seule, aucune action":
      "Learning mode: read lessons only, no actions",
    "Historique des conversations": "Conversation history",
    Historique: "History",
    "Nouvelle conversation": "New conversation",
    Nouvelle: "New",
    " conversation": " conversation",
    "Activité de la conversation": "Conversation activity",
    "Tout effacer": "Clear all",
    "Fermer l'historique (Échap)": "Close history (Escape)",
    "Fermer l'historique": "Close history",
    "Navigation dans les messages": "Message navigation",
    "interrompu ou état inconnu": "interrupted or unknown",
    "Rechercher pour ce message": "Research for this message",
    "Échange précédent": "Previous exchange",
    "Échange suivant": "Next exchange",
    Précédents: "Previous",
    Suivants: "Next",
    "Revenir au direct": "Return to live",
    Conversation: "Conversation",
    "Connecte un fournisseur pour utiliser le chat. Le cockpit, les terminaux et la Kill chain restent accessibles sans IA.":
      "Connect a provider to use chat. The cockpit, terminals and Kill chain remain available without AI.",
    "Ajouter un fournisseur": "Add a provider",
    Fermer: "Close",
    "Frise des commandes": "Command timeline",
    "Commandes Exegol / Kali (lecture seule)": "Exegol / Kali commands (read-only)",
    Monitor: "Monitor",
    "Temps écoulé depuis le début du tour": "Time elapsed since the turn started",
    "Sortie en direct. Cliquer une entrée pour la suivre en lecture seule.":
      "Live output. Click an entry to follow it read-only.",
    "Suivi du bas": "Follow bottom",
    "Aucun appel Exegol / Kali dans cette conversation.":
      "No Exegol / Kali calls in this conversation.",
    "Les commandes lancées par l’agent apparaîtront ici en direct.":
      "Commands run by the agent will appear here live.",
    "Autorisations demandées": "Requested approvals",
    "Fichiers joints": "Attachments",
    "Votre consigne": "Your instruction",
    "Votre consigne…": "Your instruction…",
    "Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne":
      "Enter to send, Shift+Enter for a new line",
    "Joindre des fichiers texte (10 fichiers, 64 Kio chacun)":
      "Attach text files (10 files, 64 KiB each)",
    "Joindre des fichiers texte": "Attach text files",
    "Citer un conteneur": "Mention a container",
    "Citer un terminal": "Mention a terminal",
    Commandes: "Commands",
    "Kill chain": "Kill chain",
    "Modèle utilisé pour le message suivant": "Model used for the next message",
    " (choisir le modèle)": " (choose model)",
    Configurer: "Configure",
    "Configurer : raisonnement et exécution": "Configure: reasoning and execution",
    "Arrêter l'agent": "Stop the agent",
    Stop: "Stop",
    "Envoyer (Entrée)": "Send (Enter)",
    Envoyer: "Send",
    Modèle: "Model",
    "Pour le message suivant": "For the next message",
    "Filtrer les modèles": "Filter models",
    "Filtrer les modèles…": "Filter models…",
    "Référence du modèle": "Model reference",
    "identifiant du modèle": "model identifier",
    "Liste indisponible : saisissez l'identifiant du modèle":
      "List unavailable: enter the model identifier",
    Modèles: "Models",
    "Configurer la connexion": "Configure connection",
    "Actualiser la liste des modèles": "Refresh model list",
    "S'applique au message suivant": "Applies to the next message",
    "Modèle et raisonnement": "Model and reasoning",
    Fournisseur: "Provider",
    "OpenAI : ChatGPT utilise l'authentification Codex via OpenCode. Une clé API utilise le mode hôte natif. Le CLI codex n'est pas utilisé.":
      "OpenAI: ChatGPT uses Codex authentication through OpenCode. An API key uses native host mode. The codex CLI is not used.",
    "Changer de modèle": "Change model",
    "Revenir à Auto : le modèle garde son effort par défaut":
      "Reset to Auto: the model keeps its default effort",
    "Revenir à Auto": "Reset to Auto",
    "Niveau d'effort": "Effort level",
    Encadrement: "Supervision",
    Léger: "Light",
    Standard: "Standard",
    Strict: "Strict",
    Acharné: "Relentless",
    "Léger : moins de relances du moteur.": "Light: fewer engine nudges.",
    "Standard : réglage par défaut.": "Standard: default setting.",
    "Strict : relances dès le premier signal et point de contrôle toutes les 8 actions, conseillé pour les petits modèles.":
      "Strict: nudges from the first signal and a checkpoint every 8 actions, recommended for small models.",
    "Acharné : relances automatiques, pas de point de contrôle, conseillé pour les longues missions.":
      "Relentless: automatic follow-ups, no checkpoint, recommended for long missions.",
    "Lecture des cours et explications, sans exécution ni écriture.":
      "Read lessons and explanations, without execution or writing.",
    "Pendant le Bypass, les actions de l’agent ne vous sont plus demandées ; vous en êtes responsable.":
      "During Bypass, the agent's actions no longer require your approval; you are responsible for them.",
    Heures: "Hours",
    Minutes: "Minutes",
    Illimité: "Unlimited",
    "∞ illimité": "∞ unlimited",
    Activer: "Activate",
    "Choisissez une durée de 1 minute à 48 h.": "Choose a duration from 1 minute to 48 hours.",
    "Bypass des approbations": "Approval bypass",
    "Approuve tout pendant la durée choisie, deny compris : chemins sensibles ou hors projet, accès hôte d'un conteneur, dangers shell, sans rien mémoriser.":
      "Approves everything for the chosen duration, including deny: sensitive or outside-project paths, container host access and shell hazards, without remembering anything.",
    "Vous en devenez responsable.": "You take responsibility for it.",
    Actualiser: "Refresh",
    Réglages: "Settings",
    Graphe: "Graph",
    "{0} constats": "{0} findings",
    "{0} constat": "{0} finding",
    "{0} commandes": "{0} commands",
    "{0} commande": "{0} command",
    "{0} en attente": "{0} pending",
    "{0} en erreur": "{0} failed",
    "{0} outils": "{0} tools",
    "{0} outil": "{0} tool",
    "{0} messages": "{0} messages",
    "{0} message": "{0} message",
    " · {0} en cours": " · {0} running",
    "{0} accords en attente": "{0} approvals pending",
    "{0} accord en attente": "{0} approval pending",
  };

  // packages/messages/src/ui-domains/cockpit.ts
  var cockpitEn = {
    "Conteneur créé et lié au projet après vérification du partage.":
      "Container created and linked to the project after share verification.",
    "Le nouveau conteneur monte le dossier du projet et sera lié après vérification du partage. Pour un autre montage, créez un conteneur pour ce projet ou choisissez un autre conteneur.":
      "The new container mounts the project folder and will be linked after the share is verified. For a different mount, create a container for this project or choose another container.",
    "Créer un conteneur pour ce projet": "Create a container for this project",
    "Choisir un autre conteneur": "Choose another container",
    "Créer un conteneur pour ce projet est recommandé.":
      "Creating a container for this project is recommended.",
    "Le projet reste sur votre PC dans {0} ; seuls les fichiers créés hors de /workspace dans le conteneur sont perdus.":
      "The project stays on your PC in {0}; only files created outside /workspace in the container are lost.",
    "Les fichiers sont partagés avec le dossier du projet ouvert dans VS Code. Un conteneur existant doit monter ce même dossier ; un autre montage nécessite une migration explicite.":
      "Files are shared with the project folder open in VS Code. An existing container must mount that same folder; a different mount requires an explicit migration.",
    "Dossier du projet": "Project folder",
    "Choisissez un projet avant de créer son conteneur.":
      "Choose a project before creating its container.",
    "Le projet a changé pendant la préparation.": "The project changed during preparation.",
    "Chemin de workspace invalide.": "Invalid workspace path.",
    Conteneurs: "Containers",
    Système: "System",
    "Contrôle système": "System control",
    Projet: "Project",
    Apparence: "Appearance",
    Interface: "Interface",
    "Non classé": "Unclassified",
    Hôte: "Host",
    "Site / URL": "Site / URL",
    Identifiant: "Credential",
    Étape: "Step",
    Confirmé: "Confirmed",
    Hypothèse: "Hypothesis",
    Échec: "Failed",
    État: "State",
    Réglages: "Settings",
    "Projet actif": "Active project",
    "Enregistrement…": "Saving…",
    Supprimer: "Delete",
    Arrêter: "Stop",
    présent: "present",
    absent: "absent",
    Démon: "Daemon",
    joignable: "reachable",
    injoignable: "unreachable",
    "en cours": "running",
    arrêté: "stopped",
    Annuler: "Cancel",
    "non lié": "not linked",
    "Préparation…": "Preparing…",
    "Kali RedWidow complète — MCP et outils prêts (construction locale)":
      "Complete Kali RedWidow — MCP and tools ready (local build)",
    "Kali officielle — image minimale": "Official Kali — minimal image",
    "Créer un conteneur": "Create a container",
    "Replier le formulaire": "Collapse form",
    "1 à 64 caractères : lettres, chiffres, point, tiret ou soulignement ; commence par une lettre ou un chiffre.":
      "1 to 64 characters: letters, digits, period, hyphen or underscore; must start with a letter or digit.",
    Nom: "Name",
    "Image Exegol (tag)": "Exegol image (tag)",
    "Dossier (facultatif)": "Folder (optional)",
    "Dossier (obligatoire)": "Folder (required)",
    "Activer le VPN": "Enable VPN",
    "Choisir une configuration VPN": "Choose a VPN configuration",
    "Activer le bureau web": "Enable web desktop",
    "Port du bureau web": "Web desktop port",
    "Le bureau est accessible uniquement sur votre machine (127.0.0.1). Choisissez un port libre, de 1 à 65535.":
      "The desktop is only accessible on your machine (127.0.0.1). Choose an available port from 1 to 65535.",
    "NAT (recommandé)": "NAT (recommended)",
    "Réseau de l’hôte": "Host network",
    "Sans réseau": "No network",
    Réseau: "Network",
    "Le réseau de l’hôte partage directement ses interfaces. Un VPN dans le conteneur peut modifier les routes de votre machine. Le bureau web exige le réseau NAT.":
      "Host networking shares its interfaces directly. A VPN in the container can change your machine’s routes. The web desktop requires NAT networking.",
    "Partager les ressources Exegol": "Share Exegol resources",
    "Partager mes ressources Exegol": "Share my Exegol resources",
    Créer: "Create",
    "Progression de l’opération": "Operation progress",
    "Actualisation…": "Refreshing…",
    "État système": "System status",
    "Conteneur lié": "Linked container",
    "Docker est absent.": "Docker is missing.",
    "Aucun conteneur lié. Choisissez-en un dans la liste ci-dessous (Lier).":
      "No linked container. Choose one from the list below (Link).",
    "Dossier hôte": "Host folder",
    "Projet invalide": "Invalid project",
    "Aucun conteneur lié en cours": "No running linked container",
    "Ouvrir le dossier": "Open folder",
    "Dossier et image": "Folder and image",
    "Nouveau conteneur": "New container",
    "Aucun conteneur.": "No containers.",
    Principal: "Primary",
    lié: "linked",
    "sans dossier": "no folder",
    "Définir comme conteneur principal (affichage seulement)":
      "Set as primary container (display only)",
    Lier: "Link",
    "Association indisponible": "Link unavailable",
    Démarrer: "Start",
    "Sans dossier hôte": "No host folder",
    "Détails de {0}": "Details for {0}",
    " · {0} Mio/s": " · {0} MiB/s",
    Téléchargement: "Downloading",
    Extraction: "Extracting",
    Annulé: "Cancelled",
  };

  // packages/messages/src/ui-domains/engagement.ts
  var engagementEn = {
    Engagement: "Engagement",
    "Engagement…": "Engagement…",
    "Aucun engagement": "no engagement",
    "Aucun engagement pour ce projet.": "No engagement for this project.",
    "Aucun plan de campagne pour ce projet.": "No campaign plan for this project.",
    "Arrêt d'urgence": "Emergency halt",
    "ARRÊT D'URGENCE ACTIF": "EMERGENCY HALT ACTIVE",
    "arrêt d'urgence actif": "emergency halt active",
    "Posé le": "Set on",
    "Les actions de l'agent sont refusées.": "The agent's actions are refused.",
    "Inactif. Un geste suffit pour refuser toute action de l'agent sur ce projet.":
      "Inactive. One gesture is enough to refuse every agent action on this project.",
    "Lever l'arrêt…": "Lift the halt…",
    "Activer…": "Activate…",
    Autorisation: "Authorization",
    Mandant: "Principal",
    Référence: "Reference",
    Signataire: "Signatory",
    "Fenêtre d'engagement": "Engagement window",
    Période: "Period",
    Début: "Start",
    Fin: "End",
    "Infrastructure de l'agent": "Agent infrastructure",
    "Règles d'engagement": "Rules of engagement",
    "White team": "White team",
    Contact: "Contact",
    Déconfliction: "Deconfliction",
    Notes: "Notes",
    "Politique OSINT": "OSINT policy",
    "Valider l'engagement…": "Validate the engagement…",
    Réussie: "Succeeded",
    Partielle: "Partial",
    Échec: "Failed",
    Bloquée: "Blocked",
    "Plan de campagne": "Campaign plan",
    "Synthèse de la menace": "Threat summary",
    Objectifs: "Objectives",
    Étapes: "Steps",
    Exécutée: "Executed",
    "À faire": "To do",
    "Valider le plan…": "Validate the plan…",
    "Journal d'opérations": "Operator log",
    "Aucune étape enregistrée.": "No step recorded.",
    Horodatage: "Timestamp",
    Technique: "Technique",
    Résultat: "Result",
    "{0} lignes sur {1} (les plus récentes).": "{0} of {1} rows (the most recent).",
    Clôture: "Closure",
    "Aucune liste de démontage.": "No teardown list.",
    "Démontage terminé": "Teardown complete",
    "{0} élément(s) restant(s)": "{0} item(s) remaining",
    "Fait le": "Done on",
    "Valider l'engagement ?": "Validate the engagement?",
    "Valider l'engagement": "Validate the engagement",
    "Empreinte : {0}\n\nL'engagement devient la référence de l'autorisation, du périmètre, de l'infrastructure et des règles pour ce projet. Vérifiez qu'il correspond à la lettre de mission signée.":
      "Digest: {0}\n\nThe engagement becomes the reference for authorization, scope, infrastructure and rules for this project. Check that it matches the signed engagement letter.",
    "Suspendre l'engagement ?": "Suspend the engagement?",
    "L'engagement cesse de s'appliquer ; la fiche et son empreinte sont conservées.":
      "The engagement stops applying; the sheet and its digest are kept.",
    "Valider le plan de campagne ?": "Validate the campaign plan?",
    "Valider le plan": "Validate the plan",
    "Empreinte : {0}\n\nLe plan devient la référence des objectifs, des étapes et de la liste de démontage. Les étapes enregistrées par l'agent seront comparées à ce plan.":
      "Digest: {0}\n\nThe plan becomes the reference for objectives, steps and the teardown list. Steps recorded by the agent will be checked against this plan.",
    "Suspendre le plan de campagne ?": "Suspend the campaign plan?",
    "Le plan cesse de s'appliquer ; le plan et son empreinte sont conservés.":
      "The plan stops applying; the plan and its digest are kept.",
    "Activer l'arrêt d'urgence ?": "Activate the emergency halt?",
    "Toute action de l'agent sur ce projet sera refusée jusqu'à la levée de l'arrêt. L'arrêt reste actif si VS Code est fermé.":
      "Every agent action on this project will be refused until the halt is lifted. The halt stays active if VS Code is closed.",
    "Activer l'arrêt": "Activate the halt",
    "Lever l'arrêt d'urgence ?": "Lift the emergency halt?",
    "L'agent pourra de nouveau agir dans le cadre de l'engagement validé. Vérifiez avec la white team que la reprise est autorisée.":
      "The agent will be able to act again within the validated engagement. Check with the white team that resuming is authorized.",
    "Lever l'arrêt": "Lift the halt",
    "Importer l'engagement": "Import the engagement",
    "Importer le plan": "Import the plan",
    "Ce fichier est trop volumineux pour un engagement ou un plan.":
      "This file is too large for an engagement or a plan.",
  };

  // packages/messages/src/ui-domains/host.ts
  var hostEn = {
    "Impossible d'ouvrir le dossier du projet {0} : {1}. Sélectionnez le projet pour réessayer.":
      "Could not open the {0} project folder: {1}. Select the project to try again.",
    "Le dossier de cette fenêtre ne correspond pas au projet actif. Utilisez la fenêtre du projet ou activez le projet correspondant dans les réglages.":
      "This window's folder does not match the active project. Use the project window or activate the matching project in Settings.",
    "Document indisponible.": "Document unavailable.",
    "Vérification du serveur Kali…": "Checking the Kali server…",
    "Installation du serveur Kali et de ses dépendances…":
      "Installing the Kali server and its dependencies…",
    "Démarrage et vérification du serveur Kali…": "Starting and checking the Kali server…",
    "Serveur Kali prêt.": "Kali server ready.",
    "Préparation de {0}": "Preparing {0}",
    "Identifiant de chat refusé.": "Chat identifier rejected.",
    "Quatre chats au maximum.": "A maximum of four chats is allowed.",
    "Ouvrez un dossier avant de lancer {0}.": "Open a folder before starting {0}.",
    "RedWidow attend une action de votre part : {reasons}":
      "RedWidow is waiting for you to act: {reasons}",
    "Ouvrir le chat": "Open chat",
    "Toujours autoriser": "Always allow",
    "{0} approbation en attente": "{0} approval pending",
    "{0} approbations en attente": "{0} approvals pending",
    "Cliquer pour ouvrir le chat qui attend votre réponse.":
      "Click to open the chat awaiting your answer.",
    "{0} : une approbation attend votre réponse.": "{0}: an approval is awaiting your answer.",
    "Changement de projet en cours, réessayez ensuite.":
      "Project change in progress. Try again afterwards.",
    "Terminal introuvable : {0}.": "Terminal not found: {0}.",
    "Terminaux introuvables : {0}.": "Terminals not found: {0}.",
    "La sortie de #{0} est illisible (conteneur arrêté, ou « script » absent de l'image).":
      "The output of #{0} cannot be read (container stopped or “script” missing from the image).",
    "Sortie illisible.": "Output cannot be read.",
    "Projet invalide : fichier project.json illisible ou incomplet.":
      "Invalid project: project.json cannot be read or is incomplete.",
    Terminé: "Done",
    "Opération annulée": "Operation cancelled",
    "Échec de l’opération": "Operation failed",
    "Paramètres invalides": "Invalid parameters",
    "Vérifiez le nom, l’image, le dossier et les options de création.":
      "Check the name, image, folder, and creation options.",
    "Dossier inaccessible : {0}": "Folder inaccessible: {0}",
    "{0} : terminal du projet": "{0}: project terminal",
    "Conteneur introuvable.": "Container not found.",
    "Démarrage du conteneur…": "Starting the container…",
    "Arrêt du conteneur…": "Stopping the container…",
    "Préparation Exegol…": "Preparing Exegol…",
    "Choisissez une configuration VPN avec le bouton VPN.":
      "Choose a VPN configuration with the VPN button.",
    "Le VPN et le bureau web nécessitent le réseau NAT.":
      "VPN and the web desktop require NAT networking.",
    "Ce conteneur existe déjà. Utilisez Démarrer dans la liste.":
      "This container already exists. Use Start in the list.",
    "Une création de ce nom est déjà ouverte dans un terminal.":
      "A creation with this name is already open in a terminal.",
    "Terminez la création Exegol dans le terminal, puis actualisez les conteneurs.":
      "Complete Exegol creation in the terminal, then refresh the containers.",
    "Création Exegol lancée — progression dans le terminal":
      "Exegol creation started — follow progress in the terminal",
    "Préparation de l’image Kali…": "Preparing the Kali image…",
    "Installation des outils Kali…": "Installing Kali tools…",
    "Téléchargement de l’image…": "Downloading the image…",
    "Image Kali absente de la sélection courante.":
      "Kali image missing from the current selection.",
    "Création et démarrage du conteneur…": "Creating and starting the container…",
    "Vérification du serveur MCP Kali…": "Checking the Kali MCP server…",
    "Serveur MCP Kali : {0}": "Kali MCP server: {0}",
    "Suppression du conteneur…": "Removing the container…",
    "Supprimer le conteneur": "Remove the container",
    "Supprimer {0} ({1}) ?{2} Les fichiers internes non montés seront perdus. Les images, volumes et dossiers hôtes sont conservés. Projets associés : {3}.":
      "Remove {0} ({1})?{2} Internal files outside mounts will be lost. Images, volumes, and host folders are kept. Linked projects: {3}.",
    " Il est en cours et sera arrêté de force.": " It is running and will be forcibly stopped.",
    "Le conteneur est supprimé, mais ses associations restent à nettoyer : {0}":
      "The container was removed, but its links still need cleanup: {0}",
    "Fichier OpenVPN / WireGuard": "OpenVPN / WireGuard file",
    "Dossier OpenVPN (certificats séparés)": "OpenVPN folder (separate certificates)",
    "Configuration VPN Exegol": "Exegol VPN configuration",
    "Choisir le VPN": "Choose the VPN",
    "{0} · Sortie": "{0} · Output",
    "{0} : chat, terminaux, cockpit, réglages ({1})":
      "{0}: chat, terminals, cockpit, settings ({1})",
    "Modèle par défaut": "Default model",
    "Modèle utilisé pour le message suivant (clic : ouvrir le chat)":
      "Model used for the next message (click to open chat)",
    "Conteneur lié : {0} (connecté). Clic : ouvrir un terminal ({1})":
      "Linked container: {0} (connected). Click to open a terminal ({1})",
    "Conteneur lié : {0} (arrêté)": "Linked container: {0} (stopped)",
    "Actualisation du graphe impossible : {0}": "Could not refresh the graph: {0}",
    "Projets indisponibles : {0}": "Projects unavailable: {0}",
    "Résumé indisponible : {0}": "Summary unavailable: {0}",
    "{0} · Rapport · Brouillon": "{0} · Report · Draft",
    "Exporter Attack Flow (étapes confirmées, identifiants et loot exclus)":
      "Export Attack Flow (confirmed steps, credentials and loot excluded)",
    "Exporter la Kill chain complète en image SVG":
      "Export the complete Kill chain as an SVG image",
    "Exporter un brouillon de rapport (identifiants et loot exclus)":
      "Export a draft report (credentials and loot excluded)",
    "Ce fichier contient des modifications non enregistrées. Choisissez un autre nom de rapport.":
      "This file has unsaved changes. Choose a different report name.",
    "{0}\n{1}\nSHA-256 du texte affiché : {2}{3}{4}\nCapturée : {5}\n\n{6}":
      "{0}\n{1}\nSHA-256 of displayed text: {2}{3}{4}\nCaptured: {5}\n\n{6}",
    "\nSHA-256 original stocké : {0}": "\nStored original SHA-256: {0}",
    "\nTexte remasqué et tronqué.": "\nText redacted again and truncated.",
    "Le projet actif a changé. Relancez l’action sur les preuves.":
      "The active project changed. Restart the evidence action.",
    Rattachée: "Attached",
    "Non rattachée": "Unattached",
    "Preuves du projet actif — lecture ou rattachement": "Active project evidence — read or attach",
    "Rattacher à une trouvaille existante": "Attach to an existing finding",
    "Rattacher la preuve à une trouvaille existante": "Attach evidence to an existing finding",
    "Le terminal n’appartient plus à l’allowlist du projet actif.":
      "This terminal is no longer on the active project's allowlist.",
    "Aucun terminal capturé n’appartient à l’allowlist du projet actif.":
      "No captured terminal is on the active project's allowlist.",
    "Capturer la fin du journal d’un terminal du projet actif":
      "Capture the end of an active project terminal log",
    "Ce terminal est fermé.": "This terminal is closed.",
    "Journal du terminal indisponible.": "Terminal log unavailable.",
    "Sélectionnez un extrait dans un fichier du projet actif.":
      "Select an excerpt from a file in the active project.",
    "Extrait vide ou supérieur à 16 Kio. Réduisez la sélection avant de capturer.":
      "Excerpt empty or larger than 16 KiB. Reduce the selection before capturing.",
    "Conserver cet extrait exact": "Keep this exact excerpt",
    "Aperçu multiligne ouvert en lecture seule — conserver cet extrait ?":
      "Read-only multiline preview opened — keep this excerpt?",
    "Titre de la preuve": "Evidence title",
    "Titre requis, 200 caractères maximum.": "Title required, up to 200 characters.",
    "Nouvelle trouvaille": "New finding",
    "Rattacher la preuve": "Attach evidence",
    " La preuve {0} a été créée dans le projet {1}, mais n’a pas été rattachée. Activez ce projet puis utilisez « {2} : Lister les preuves du projet » pour la retrouver et la rattacher.":
      " Evidence {0} was created in project {1}, but was not attached. Activate this project, then use “{2}: List project evidence” to find and attach it.",
    "Une suppression est déjà en cours. Réessayez ensuite.":
      "A removal is already in progress. Try again afterwards.",
    "Un changement de projet est en cours. Réessayez ensuite.":
      "A project change is in progress. Try again afterwards.",
    " Les liens vers cet élément seront retirés de {0} autre(s) élément(s).":
      " Links to this item will be removed from {0} other item(s).",
    "Supprimer « {0} » de la Kill chain du projet « {1} » ?{2} Les autres éléments sont conservés.":
      "Remove “{0}” from the Kill chain of project “{1}”?{2} Other items are kept.",
    "{0} · Réglages": "{0} · Settings",
    "Arrêtez les tours en cours avant de modifier un projet.":
      "Stop running turns before editing a project.",
    "Renommer le projet {0}": "Rename the {0} project",
    "Le dossier, les conversations et les conteneurs gardent leur identité.":
      "The folder, conversations, and containers keep their identity.",
    "Saisissez un nom de 1 à 80 caractères, sans caractères de contrôle.":
      "Enter a name of 1 to 80 characters, without control characters.",
    "Retirer le projet « {0} » de {1} ?": "Remove project “{0}” from {1}?",
    "Le dossier, les conteneurs, les journaux, les trouvailles et les notes restent sur le disque. Aucun autre projet ne sera activé automatiquement.":
      "The folder, containers, logs, findings, and notes remain on disk. No other project will be activated automatically.",
    "Retirer le projet": "Remove project",
    "Arrêtez les tours en cours avant de changer de projet.":
      "Stop running turns before switching projects.",
    "Choisir le dossier du projet": "Choose the project folder",
    "Arrêtez les tours en cours avant de créer le projet.":
      "Stop running turns before creating the project.",
    "Résumé non enregistré : {0}": "Summary not saved: {0}",
    "Aucun conteneur Exegol.": "No Exegol containers.",
    "en cours": "running",
    arrêté: "stopped",
    "{0} : ouvrir un terminal": "{0}: open a terminal",
    "Le conteneur {0} est arrêté.": "Container {0} is stopped.",
    "$(comment) Chat latéral": "$(comment) Sidebar chat",
    "$(comment-discussion) Nouveau chat": "$(comment-discussion) New chat",
    "$(settings-gear) Réglages": "$(settings-gear) Settings",
    "$(dashboard) Cockpit": "$(dashboard) Cockpit",
    "$(pulse) Monitor": "$(pulse) Monitor",
    "$(type-hierarchy) Kill chain": "$(type-hierarchy) Kill chain",
    "Ouvrir une fenêtre ou un terminal…": "Open a window or a terminal…",
    "terminal · en cours": "terminal · running",
    "Terminaux Exegol": "Exegol terminals",
    "Aucun conteneur Exegol": "No Exegol containers",
    "Aucune observation du run courant disponible.":
      "No observations available for the current run.",
    "Le paquet au dernier tour ci-dessous est le contexte structuré effectivement ajouté à la consigne, déjà masqué. Les observations reçues depuis peuvent être plus récentes. Aucun compteur de tokens n’est mesuré ici.":
      "The last-turn packet below is the structured context actually added to the instruction, already redacted. Observations received since may be more recent. No token count is measured here.",
    "Objectif limité à 8192 caractères ; 12 derniers résultats, 2048 caractères par aperçu. Aucun ancien journal ni autre projet n’est relu.":
      "Objective limited to 8192 characters; last 12 results, 2048 characters per preview. No old log or other project is read.",
    "Disponible à la consultation ; ne représente pas le prompt complet":
      "Available for inspection; does not represent the complete prompt",
    "montage absent": "mount missing",
    "Dossier de mission : {0}. {1}": "Mission folder: {0}. {1}",
    "Aucun montage lié vérifié : créez ou associez un conteneur avant de travailler.":
      "No linked mount verified: create or link a container before working.",
    "Général — méthode commune": "General — shared method",
    "Profil de travail de l’agent": "Agent work profile",
    "Choisissez un projet avant de configurer ses services MCP.":
      "Choose a project before configuring its MCP services.",
    "Le projet a changé pendant la configuration.": "The project changed during configuration.",
    "Configuration des intégrations invalide. Corrigez le réglage utilisateur warband.integrationsByProject.":
      "Invalid integration configuration. Fix the warband.integrationsByProject user setting.",
    configuré: "configured",
    "non configuré": "not configured",
    "Catalogue MCP — services externes locaux": "MCP catalog — local external services",
    "Configurer le service local": "Configure the local service",
    "Tester le catalogue réel": "Test the live catalog",
    "Désactiver ce connecteur": "Disable this connector",
    "Voir le dépôt source": "View the source repository",
    "Configurer le service avant le test. {0} n’installe ni ne démarre automatiquement le programme externe.":
      "Configure the service before testing. {0} does not install or start the external program automatically.",
    "{0} : {1} outils annoncés. Aucun outil distant exécuté.":
      "{0}: {1} tools advertised. No remote tool executed.",
    "{0} — port local 127.0.0.1": "{0} — local port 127.0.0.1",
    "Port entre 1 et 65535": "Port between 1 and 65535",
    "Transport du service déjà démarré": "Transport of the already running service",
    "Chemin MCP local": "Local MCP path",
    "Chemin local simple requis, sans URL ni paramètre":
      "A simple local path is required, without a URL or parameter",
    "Maximum quatre services actifs, sur des ports distincts.":
      "A maximum of four active services on distinct ports.",
    "Arrêtez les tours en cours avant de configurer Burp.":
      "Stop running turns before configuring Burp.",
    "Activer ou configurer la connexion locale": "Enable or configure the local connection",
    "Extension MCP officielle requise dans Burp Suite":
      "Official MCP extension required in Burp Suite",
    "Désactiver la connexion": "Disable the connection",
    "Connexion actuellement activée": "Connection currently enabled",
    "Connexion déjà désactivée": "Connection already disabled",
    "Connexion Burp désactivée.": "Burp connection disabled.",
    "Port MCP Burp sur 127.0.0.1": "Burp MCP port on 127.0.0.1",
    "Port affiché dans l’onglet MCP de Burp. {0} ne lance pas Burp ni Java.":
      "Port shown in Burp's MCP tab. {0} does not start Burp or Java.",
    "Port entier entre 1 et 65535 requis.": "An integer port between 1 and 65535 is required.",
    "SSE — serveur officiel": "SSE — official server",
    "/mcp, si proposé par votre serveur": "/mcp, if offered by your server",
    "Transport MCP Burp": "Burp MCP transport",
    "Un tour a démarré. Arrêtez-le avant de modifier cette connexion.":
      "A turn has started. Stop it before editing this connection.",
    "Connexion configurée. Testez-la, puis envoyez une nouvelle consigne. Les tours suivants utilisent ces réglages.":
      "Connection configured. Test it, then send a new instruction. The next turns use these settings.",
    "Connexion Burp désactivée : configurez-la avant le test.":
      "Burp connection disabled: configure it before testing.",
    "Connexion au MCP Burp local…": "Connecting to local Burp MCP…",
    "MCP Burp joignable : {0} outils dans cette page de catalogue. Aucun outil Burp exécuté, aucun appel au modèle.":
      "Burp MCP reachable: {0} tools on this catalog page. No Burp tool executed, no model call.",
    "Réglages modifiés. Les tours suivants utilisent la nouvelle connexion.":
      "Settings changed. The next turns use the new connection.",
    "Palette {0}": "{0} palette",
    "Abonnement ChatGPT": "ChatGPT subscription",
    "Connexion OAuth Codex via OpenCode": "Codex OAuth connection through OpenCode",
    "Clé API OpenAI": "OpenAI API key",
    "Stockage sécurisé de VS Code": "VS Code secure storage",
    "Connexion OpenAI": "OpenAI connection",
    "La clé est vide.": "The key is empty.",
    "{0} : connexion ChatGPT": "{0}: ChatGPT login",
    "{0} : connexion OpenCode": "{0}: OpenCode login",
    "Terminez la connexion dans le terminal, puis fermez-le ou actualisez la liste des modèles.":
      "Complete login in the terminal, then close it or refresh the model list.",
    "Jeton d'abonnement": "Subscription token",
    "Clé API": "API key",
    "{0} : type de jeton": "{0}: token type",
    "{0} : jeton": "{0}: token",
    "Le jeton est stocké dans le stockage sécurisé de VS Code.":
      "The token is stored in VS Code secure storage.",
    "Le jeton est vide.": "The token is empty.",
    "Jeton enregistré et appliqué.": "Token saved and applied.",
    "Connexion OpenAI désactivée dans {0}. Le cache OAuth d’OpenCode est conservé.":
      "OpenAI connection disabled in {0}. OpenCode's OAuth cache is kept.",
    "La connexion OpenCode se gère dans son terminal avec opencode auth logout.":
      "Manage the OpenCode connection in its terminal with opencode auth logout.",
    "Jeton effacé : le chat reste grisé tant qu'aucun fournisseur n'est ajouté.":
      "Token cleared: chat stays disabled until a provider is added.",
    "Bypass des approbations actif : cliquer pour le désactiver":
      "Approval bypass active: click to disable it",
    BYPASS: "BYPASS",
    "BYPASS · en attente": "BYPASS · pending",
    Supprimer: "Delete",
    aucun: "none",
    Ouvrir: "Open",
    Annuler: "Cancel",
    "{0} : création {1}": "{0} : creation {1}",
    Projet: "Project",
    Conteneurs: "Containers",
    "Contrôle système": "System control",
    Apparence: "Appearance",
  };

  // packages/messages/src/ui-domains/logic.ts
  var logicEn = {
    "La sélection doit appartenir au dossier du projet actif.":
      "The selection must belong to the active project folder.",
    "Référence de fichier invalide.": "Invalid file reference.",
    "Le dossier du projet est introuvable.": "The project folder could not be found.",
    "Catalogue de projets invalide.": "Invalid project catalog.",
    "Identité de projet invalide.": "Invalid project identity.",
    "Connexion MCP de projet invalide.": "Invalid project MCP connection.",
    "Ce projet n’existe plus.": "This project no longer exists.",
    "Le projet ou le travail en cours a changé. Recommencez l’action.":
      "The project or current work has changed. Try the action again.",
    "Conteneur absent ou famille non autorisée.": "Container missing or family not allowed.",
    "Identité Docker invalide.": "Invalid Docker identity.",
    "Identité ou état Docker modifié.": "Docker identity or state changed.",
    "Nom Docker invalide.": "Invalid Docker name.",
    "Le conteneur a changé depuis la confirmation ; recommencez.":
      "The container has changed since confirmation; try again.",
    "Les éléments ont été modifiés ; recommencez la suppression.":
      "The items have changed; try deleting again.",
    "Le dossier de projet doit être un dossier réel.":
      "The project folder must be a real directory.",
    "Les pièces jointes dépassent la taille totale du message.":
      "The attachments exceed the total message size.",
    Auto: "Auto",
    "Auto : aucun niveau d'effort n'est transmis, le modèle garde son comportement par défaut. Touchez le curseur pour en choisir un.":
      "Auto: no effort level is sent; the model keeps its default behavior. Move the slider to choose one.",
    "Sans projet": "No project",
    Projet: "Project",
    "Projet inconnu": "Unknown project",
    Conversation: "Conversation",
    "programme refusé": "program rejected",
    "Conteneur arrêté": "Container stopped",
    "Sans montage /workspace": "No /workspace mount",
    "Le chemin hôte doit être absolu et sans caractère de contrôle.":
      "The host path must be absolute and contain no control characters.",
    Nom: "Name",
    "Tag image": "Image tag",
    "Réseau Exegol invalide.": "Invalid Exegol network.",
    "Le VPN nécessite le réseau NAT.": "The VPN requires NAT networking.",
    "Le bureau nécessite un réseau actif.": "The desktop requires an active network.",
    "Option de bureau Exegol invalide.": "Invalid Exegol desktop option.",
    "Cette version d’Exegol ne permet pas de désactiver explicitement le bureau. Mettez Exegol à jour pour garantir l’absence d’exposition du bureau.":
      "This version of Exegol cannot explicitly disable the desktop. Update Exegol to ensure the desktop is not exposed.",
    "Port du bureau invalide (1 à 65535).": "Invalid desktop port (1 to 65535).",
    "Option de partage Exegol invalide.": "Invalid Exegol sharing option.",
    "Option de journalisation Exegol invalide.": "Invalid Exegol logging option.",
    "Cette version d’Exegol ne permet pas de désactiver explicitement les logs. Mettez Exegol à jour.":
      "This version of Exegol cannot explicitly disable logs. Update Exegol.",
    "Exegol est introuvable dans le PATH.": "Exegol was not found in PATH.",
    "Le chemin VPN est inaccessible.": "The VPN path is inaccessible.",
    "Le dossier de travail est inaccessible.": "The workspace folder is inaccessible.",
    "Le dossier de travail doit être un répertoire.": "The workspace folder must be a directory.",
    "Sélectionnez un fichier VPN .ovpn ou .conf, ou un répertoire.":
      "Select a VPN .ovpn or .conf file, or a directory.",
    "Impossible de vérifier les options de cette version d’Exegol.":
      "Unable to check the options supported by this version of Exegol.",
    "Le démarrage du serveur OpenCode a dépassé son délai. [opencode.serverTimeout]":
      "The OpenCode server startup timed out. [opencode.serverTimeout]",
    "Le moteur n'a pas renvoyé le catalogue dans le délai imparti. [ipc.startTimeout]":
      "The engine did not return the catalog in time. [ipc.startTimeout]",
    "L'intégrité du binaire embarqué n'est pas conforme. Réinstallez le VSIX officiel. [extension.binaryMismatch]":
      "The bundled binary failed its integrity check. Reinstall the official VSIX. [extension.binaryMismatch]",
    "Le binaire nécessaire au chargement des modèles est introuvable. Réinstallez le VSIX officiel. [process.notFound]":
      "The binary required to load models was not found. Reinstall the official VSIX. [process.notFound]",
    "La connexion au fournisseur est absente ou refusée. Reconnectez le fournisseur puis actualisez la liste.":
      "The provider connection is missing or was rejected. Reconnect the provider, then refresh the list.",
    "Impossible de charger les modèles. Réessayez ou vérifiez la connexion au fournisseur.":
      "Unable to load models. Try again or check the provider connection.",
    "Liste des projets indisponible : envoi suspendu, réessayez après vérification du projet actif.":
      "Project list unavailable: sending paused. Check the active project, then try again.",
    défaut: "default",
    "La connexion au fournisseur n’est plus disponible. Reconnectez-le avant de continuer.":
      "The provider connection is no longer available. Reconnect it before continuing.",
    "Connexion au fournisseur indisponible. Reconnectez-le puis réessayez.":
      "Provider connection unavailable. Reconnect it, then try again.",
    "Le fournisseur n’a renvoyé aucun modèle utilisable. Réessayez ou vérifiez sa connexion.":
      "The provider returned no usable models. Try again or check its connection.",
    "Le modèle choisi n'est plus proposé : retour au modèle par défaut.":
      "The selected model is no longer available: switching to the default model.",
    "Chargement des modèles interrompu après 45 secondes. Réessayez ou vérifiez la connexion au fournisseur.":
      "Model loading stopped after 45 seconds. Try again or check the provider connection.",
    "Réglages modifiés : nouveau moteur au prochain message, même session.":
      "Settings changed: a new engine will start for the next message in the same session.",
    "Journal indisponible ou pas encore écrit. Réessayez dans un instant.":
      "Journal unavailable or not written yet. Try again shortly.",
    "Lecture des messages précédents impossible. Réessayez.":
      "Unable to read earlier messages. Try again.",
    "Modèle refusé : identifiant invalide ou absent de la liste.":
      "Model rejected: invalid identifier or missing from the list.",
    "Variante refusée : absente du catalogue du modèle courant.":
      "Variant rejected: missing from the current model catalog.",
    "Niveau d'effort refusé : valeur inconnue.": "Effort level rejected: unknown value.",
    "Ultracode n'est pas disponible : ce modèle ne prend pas en charge « Max ».":
      "Ultracode is unavailable: this model does not support “Max”.",
    "Le projet actif a changé. Revenez au projet de cette conversation ou créez une nouvelle conversation dans le projet actif.":
      "The active project has changed. Return to this conversation’s project or create a new conversation in the active project.",
    "Jeton modifié : nouveau moteur démarré avec le nouveau jeton, même session.":
      "Token changed: a new engine started with the new token in the same session.",
    "Jeton modifié : nouveau moteur au prochain message, même session.":
      "Token changed: a new engine will start for the next message in the same session.",
    "Moteur arrêté. Les tâches détachées dans les conteneurs peuvent continuer ; vérifiez leur état.":
      "Engine stopped. Detached container tasks may still be running; check their status.",
    "Recherche demandée : une source web a répondu. Vérifiez sa pertinence.":
      "Requested research: a web source responded. Check its relevance.",
    "Recherche demandée interrompue : résultat inconnu.":
      "Requested research was interrupted; the result is unknown.",
    "Recherche demandée non aboutie : aucune source web confirmée pour ce tour.":
      "Requested research did not complete: no web source was confirmed for this turn.",
    "Activez les outils Web pour demander une recherche à ce tour.":
      "Enable Web tools to request research for this turn.",
    "Instantané des notes, du graphe et des contrôles : {0}":
      "Notes, graph and controls snapshot: {0}",
    "## Contrôles et références Audit": "## Audit controls and references",
    "Coupe de lecture non atomique : les notes et contrôles ont pu évoluer pendant la collecte.":
      "Non-atomic snapshot: notes and controls may have changed during collection.",
    "Contrôles Audit indisponibles : aucune conclusion de couverture.":
      "Audit controls unavailable: no coverage conclusion is possible.",
    "Registre des preuves indisponible : certaines références ne peuvent pas être vérifiées.":
      "Evidence registry unavailable: some references cannot be verified.",
    "Collecte Audit incomplète ou vue limitée : des contrôles et références peuvent manquer.":
      "Audit collection incomplete or view limited: controls and references may be missing.",
    "Aucun contrôle disponible dans cette coupe.": "No controls available in this snapshot.",
    "Références connues : {0}.": "Known references: {0}.",
    "Références absentes de cette coupe : {0}.": "References absent from this snapshot: {0}.",
    revu: "reviewed",
    "non revu": "not reviewed",
    "Recherche demandée pour ce message.": "Research requested for this message.",
    "Recherche et lecture demandées : réponses web reçues. Vérifiez leur pertinence.":
      "Requested search and reading: web responses received. Check their relevance.",
    "Recherche demandée non aboutie : recherche et lecture de source non confirmées.":
      "Requested research did not complete: search and source reading were not confirmed.",
    "Moteur terminé avec des outils sans résultat. Les tâches détachées dans les conteneurs peuvent continuer ; vérifiez leur état.":
      "Engine exited with unfinished tools. Detached container tasks may still be running; check their status.",
    "Arrêt demandé.": "Stop requested.",
    "Cette conversation appartient à un autre projet. Revenez à son projet ou créez une nouvelle conversation dans le projet actif.":
      "This conversation belongs to another project. Return to its project or create a new conversation in the active project.",
    "Session introuvable : le prochain message démarre une nouvelle session.":
      "Session not found: the next message will start a new session.",
    "Conversation reprise dans son projet : la politique actuelle s'applique.":
      "Conversation resumed in its project: the current policy applies.",
    "Titre refusé : il est vide.": "Title rejected: it is empty.",
    "Effacer tout l'historique des conversations et leurs journaux ?":
      "Clear the entire conversation history and its journals?",
    "Délai d’exécution dépassé.": "Execution timed out.",
    "Résultats partiels.": "Partial results.",
    "La commande a échoué.": "The command failed.",
    "Autoriser « {0} » sans redemander, pour la durée de cette conversation (la persistance sur disque n'est pas encore disponible) ?\n\n{1}":
      "Allow “{0}” without asking again for this conversation (disk persistence is not available yet)?\n\n{1}",
    "Bac à sable · {0}": "Sandbox · {0}",
    "Variante de raisonnement du modèle : {0}.": "Model reasoning variant: {0}.",
    "Bac à sable prêt : {0}": "Sandbox ready: {0}",
    "{0} Exegol invalide (128 caractères alphanumériques, point, tiret ou underscore maximum).":
      "Invalid Exegol {0} (up to 128 alphanumeric characters, dots, hyphens or underscores).",
    "Cette version d’Exegol ne prend pas en charge {0}.":
      "This version of Exegol does not support {0}.",
    "Cette version d’Exegol ne permet pas de configurer {0}.":
      "This version of Exegol cannot configure {0}.",
    "Chemin de mission incompatible : {0}": "Incompatible mission path: {0}",
    "OpenCode n'a pas pu démarrer{0}. Vérifiez le binaire embarqué et les blocages de sécurité du système. [opencode.serverFailed]":
      "OpenCode could not start{0}. Check the bundled binary and system security restrictions. [opencode.serverFailed]",
    " (code de sortie {0})": " (exit code {0})",
    "Le moteur de chargement des modèles s'est arrêté{0}. Consultez Sortie → {1}. [ipc.engineExited]":
      "The model loading engine stopped{0}. See Output → {1}. [ipc.engineExited]",
    "La configuration OpenCode contient des permissions, plugins ou hooks incompatibles avec les protections de {0}. [opencode.unsafeConfig]":
      "The OpenCode configuration contains permissions, plugins or hooks incompatible with {0} protections. [opencode.unsafeConfig]",
    "Le serveur OpenCode n'a pas pu fournir le catalogue{0}. [opencode.httpFailed]":
      "The OpenCode server could not provide the catalog{0}. [opencode.httpFailed]",
    "Niveau d'effort ramené à « {0} » : « {1} » n'est pas pris en charge par ce modèle.":
      "Effort level reduced to “{0}”: “{1}” is not supported by this model.",
    "[stderr trop volumineux : diagnostic ignoré]": "[stderr too large: diagnostic discarded]",
    "[stderr incomplet : diagnostic ignoré]": "[stderr incomplete: diagnostic discarded]",
    "Le moteur s'est arrêté (code {0}).": "The engine stopped (code {0}).",
    "Catalogue des modèles : {0}\n": "Model catalog: {0}\n",
    "{0} ligne(s) invalide(s) ignorée(s).": "{0} invalid line(s) ignored.",
    "Aucun fournisseur n'a été ajouté : ajoute un jeton ({0} : définir le jeton) pour utiliser le chat.":
      "No provider has been added: add a token ({0}: set token) to use the chat.",
    "Supprimer la conversation « {0} » et ses journaux ?":
      "Delete the conversation “{0}” and its journals?",
    "Code de sortie : {0}": "Exit code: {0}",
    "Sortie d’erreur :\n{0}": "Standard error:\n{0}",
    Lecture: "Read",
    Écriture: "Write",
    Modification: "Edit",
    "Modification de notebook": "Notebook edit",
    "Recherche de fichiers": "File search",
    "Recherche dans les fichiers": "Search in files",
    "Liste du dossier": "Directory listing",
    Commande: "Command",
    "Page web": "Web page",
    "Recherche web": "Web search",
    "Lire une page web": "Read a web page",
    "Burp · catalogue des outils": "Burp · tool catalog",
    "Burp · appel d’outil": "Burp · tool call",
    "Sous-agent": "Subagent",
    "Liste de tâches": "Task list",
    "Fournisseur temporairement indisponible{0}. Nouvelle tentative dans {1} s.":
      "Provider temporarily unavailable{0}. Retrying in {1} s.",
    "{0} journal(aux) introuvable(s).": "{0} journal(s) not found.",
    "sans plafond de tours": "no turn limit",
    "{0} tours au plus": "at most {0} turns",
    "sans plafond de dépense": "no spending limit",
    "dépense plafonnée à {0} $": "spending capped at {0} USD",
    " L'effet exact dépend du modèle.": " The exact effect depends on the model.",
    "Préréglage : réflexion « Max » (mêmes capacités que Max, pas un mode distinct du modèle) avec des limites longues réglables ({0}, {1}). Réglages : warband.ultracode.maxTurns et warband.ultracode.maxBudgetUsd.{2}":
      "Preset: “Max” reasoning (same capabilities as Max, not a separate model mode) with adjustable extended limits ({0}, {1}). Settings: warband.ultracode.maxTurns and warband.ultracode.maxBudgetUsd.{2}",
    "Réponses rapides et économes, réflexion minimale.{0}":
      "Fast, economical responses with minimal reasoning.{0}",
    "Équilibre entre vitesse et réflexion.{0}": "A balance between speed and reasoning.{0}",
    "Réflexion soutenue, adaptée à la plupart des tâches.{0}":
      "Sustained reasoning suitable for most tasks.{0}",
    "Réflexion approfondie, plus lente et plus coûteuse.{0}":
      "In-depth reasoning, slower and more costly.{0}",
    "Réflexion la plus poussée, la plus lente et la plus coûteuse.{0}":
      "The deepest, slowest and most costly reasoning.{0}",
    Sentinelle: "Sentinel",
    "Sarcelle et ardoise": "Teal and slate",
    Braise: "Ember",
    "Cramoisi et acier": "Crimson and steel",
    Spectre: "Specter",
    "Violet et glace": "Purple and ice",
    Éditeur: "Editor",
    "Accent du thème VS Code": "VS Code theme accent",
    Multicolore: "Multicolor",
    "Six teintes réparties dans l’interface": "Six colors across the interface",
    Hôte: "Host",
    Site: "Site",
    "Site / URL": "Site / URL",
    Étape: "Step",
    Identifiant: "Credential",
    Loot: "Loot",
    Confirmé: "Confirmed",
    Hypothèse: "Hypothesis",
    Échec: "Failed",
    "**Brouillon à relire et compléter avant diffusion.**":
      "**Draft: review and complete before sharing.**",
    "## Cadre de la mission": "## Mission scope",
    "- Objectif et périmètre autorisé : à compléter.":
      "- Objective and authorized scope: to be completed.",
    "Dates et conditions d’évaluation : à compléter.":
      "Evaluation dates and conditions: to be completed.",
    "- Dates et conditions d’évaluation : à compléter.":
      "- Evaluation dates and conditions: to be completed.",
    "- Ce document reprend les notes du projet ; il ne déduit aucune vulnérabilité d’un simple accès.":
      "- This document reproduces the project notes; it does not infer a vulnerability from access alone.",
    "- Les identifiants et le loot sont exclus. Le journal, les sorties brutes et les captures ne sont pas joints.":
      "- Credentials and loot are excluded. The journal, raw output and captures are not attached.",
    "## Synthèse": "## Summary",
    "## Chemin retenu": "## Selected path",
    "Le marquage des liens décrit le parcours retenu par l’agent ou l’utilisateur ; il ne constitue pas une preuve supplémentaire.":
      "Link markings describe the path selected by the agent or user; they do not provide additional evidence.",
    "Aucun lien exportable marqué.": "No exportable link marked.",
    "Éléments confirmés": "Confirmed items",
    "Hypothèses à vérifier": "Hypotheses to verify",
    "Essais non concluants": "Inconclusive attempts",
    "Aucun élément exporté.": "No items exported.",
    "- Preuve, chemin d’artefact et reproduction : à référencer après vérification.":
      "- Evidence, artifact path and reproduction: reference after verification.",
    "- Impact, gravité/CVSS et recommandation : à évaluer si cet élément décrit une vulnérabilité.":
      "- Impact, severity/CVSS and recommendation: assess if this item describes a vulnerability.",
    "## Conclusion et suites": "## Conclusion and next steps",
    "Objectifs démontrés, limites, pistes restantes et nettoyage : à compléter à partir des preuves.":
      "Demonstrated objectives, limitations, remaining leads and cleanup: complete from the evidence.",
    "## Préparation du rapport final": "## Preparing the final report",
    "Ce Markdown peut être repris dans les notes SysReptor. Pour produire un rapport final, choisir un modèle, renseigner les champs requis et joindre uniquement les preuves vérifiées et autorisées. Ce fichier n’est pas une archive native d’import SysReptor.":
      "This Markdown can be reused in SysReptor notes. To produce a final report, choose a template, complete the required fields and attach only verified, authorized evidence. This file is not a native SysReptor import archive.",
    "Brouillon à compléter. Les notes ne constituent pas une liste de vulnérabilités. Gravité, preuves et remédiations restent à évaluer. Identifiants et loot exclus.":
      "Draft to complete. These notes are not a list of vulnerabilities. Severity, evidence and remediation still require assessment. Credentials and loot excluded.",
    "# Rapport de mission — {0}": "# Mission report — {0}",
    "Projet : {0} · Export : {1}": "Project: {0} · Export: {1}",
    "{0} élément(s) confirmé(s), {1} hypothèse(s), {2} essai(s) en échec parmi les notes exportées.":
      "{0} confirmed item(s), {1} hypothesis/hypotheses, {2} failed attempt(s) among the exported notes.",
    "- Référence : {0} ; type : {1} ; état : {2}.": "- Reference: {0}; type: {1}; state: {2}.",
    "- Tactique ATT&CK : {0}.": "- ATT&CK tactic: {0}.",
    "- Technique ATT&CK : {0}.": "- ATT&CK technique: {0}.",
    "Notes du projet — {0}": "Project notes — {0}",
    "{0} éléments. Les liens verts indiquent le chemin retenu, sans déduire une réussite.":
      "{0} items. Green links show the selected path without inferring success.",
    "{0} éléments · Hôte / Site / Identifiant / Étape / Loot":
      "{0} items · Host / Site / Credential / Step / Loot",
    "États : Confirmé / Hypothèse / Échec · Lien vert : chemin retenu":
      "States: Confirmed / Hypothesis / Failed · Green link: selected path",
    "argv interdit": "forbidden argv",
    "licence absente": "license missing",
    "chemin de journal refusé": "journal path rejected",
    "Tampon vide.": "Empty buffer.",
    "Analyse les fichiers joints.": "Analyze the attached files.",
    "{0}\n\nPièces jointes :\n{1}": "{0}\n\nAttachments:\n{1}",
  };

  // packages/messages/src/ui-domains/program.ts
  var programEn = {
    "Fiche programme": "Program sheet",
    "Fiche programme…": "Program sheet…",
    "aucune fiche": "no sheet",
    "brouillon à valider": "draft to validate",
    validée: "validated",
    suspendue: "suspended",
    "modifiée depuis la validation": "changed since validation",
    illisible: "unreadable",
    "{0} hôte(s) arrêté(s)": "{0} host(s) halted",
    "Aucune fiche": "No sheet",
    "Brouillon, non validé": "Draft, not validated",
    "Validée et appliquée": "Validated and applied",
    Suspendue: "Suspended",
    "Modifiée depuis la validation": "Changed since validation",
    Illisible: "Unreadable",
    "{0} requête(s) par seconde au plus": "At most {0} request(s) per second",
    Rapide: "Fast",
    Normal: "Normal",
    Prudent: "Careful",
    "Citation non vérifiée": "Unverified citation",
    "Ouvrir la source…": "Open the source…",
    Aucun: "None",
    État: "State",
    "Aucune fiche programme pour ce projet.": "No program sheet for this project.",
    "Demander à l'agent de rédiger la fiche": "Ask the agent to draft the sheet",
    "Importer un fichier…": "Import a file…",
    "Adresse de la page du programme": "Program page address",
    "Remplir par IA": "Fill with AI",
    "Rédige la fiche programme du projet actif à partir de cette page officielle : {0}. Lis cette page avec read_url, puis appelle program_draft avec le périmètre, le hors périmètre, le rythme et le suffixe User-Agent, chacun cité depuis la page. Ne valide rien : je relirai le brouillon et je le validerai moi-même depuis la page Fiche programme.":
      "Draft the program sheet for the active project from this official page: {0}. Read that page with read_url, then call program_draft with the scope, the out-of-scope list, the pace and the User-Agent suffix, each cited from the page. Do not validate anything: I will review the draft and validate it myself from the Program sheet page.",
    "Le chat n’est pas disponible (occupé, sans fournisseur ou en lecture seule).":
      "The chat is not available (busy, no provider or read-only).",
    "Importer la fiche": "Import the sheet",
    "Ce fichier est trop volumineux pour une fiche programme.":
      "This file is too large for a program sheet.",
    "Empreinte : ": "Digest: ",
    "Validée le": "Validated on",
    "Suspendue le": "Suspended on",
    Périmètre: "Scope",
    "Hors périmètre": "Out of scope",
    "Suffixe User-Agent": "User-Agent suffix",
    Rythme: "Pace",
    "Hôtes arrêtés": "Halted hosts",
    "Aucun hôte arrêté.": "No halted host.",
    Reprendre: "Resume",
    "Valider la fiche…": "Validate the sheet…",
    Suspendre: "Suspend",
    "Aucun projet actif.": "No active project.",
    "Rien n’est affiché. Actualisez la page.": "Nothing is displayed. Refresh the page.",
    "Le projet actif a changé. Recommencez l’action.":
      "The active project changed. Try the action again.",
    "Ouvrir dans le navigateur": "Open in the browser",
    "Ouvrir cette source ?": "Open this source?",
    "Adresse : {0}\n\nElle provient de la fiche, qui est une donnée non fiable.":
      "Address: {0}\n\nIt comes from the sheet, which is untrusted data.",
    "Valider la fiche": "Validate the sheet",
    "Valider la fiche programme ?": "Validate the program sheet?",
    "Empreinte : {0}\n\nLa fiche devient la référence du périmètre, du rythme et du suffixe User-Agent pour ce projet. Vérifiez qu’elle correspond au programme officiel.":
      "Digest: {0}\n\nThe sheet becomes the reference for scope, pace and User-Agent suffix for this project. Check that it matches the official program.",
    "Suspendre la fiche programme ?": "Suspend the program sheet?",
    "Le projet revient au profil généraliste ; la fiche et son empreinte sont conservées.":
      "The project goes back to the generalist profile; the sheet and its digest are kept.",
    "Reprendre l’hôte {0} ?": "Resume host {0}?",
    "L’hôte avait été arrêté par le contrôle de rythme (réponses de limitation ou blocage). Les requêtes pourront reprendre.":
      "The host was halted by the pace control (throttling or blocking responses). Requests may resume.",
  };

  // packages/messages/src/ui-domains/redwidow.ts
  var redwidowEn = {
    "Supprimer l’historique commun des chats, tous projets compris":
      "Delete the shared chat history across all projects",
    "Impossible d’enregistrer l’historique partagé.": "Unable to save shared history.",
    "Arrêtez les conversations en cours avant de supprimer leur historique.":
      "Stop running conversations before deleting their history.",
    "Effacer l’historique commun des chats et ses journaux ?":
      "Clear shared chat history and its journals?",
    Widow: "Widow",
    Venin: "Venom",
    Arctique: "Arctic",
    Ultraviolet: "Ultraviolet",
    Tactique: "Tactical",
    Rouge: "Red",
    Orange: "Orange",
    Jaune: "Yellow",
    Vert: "Green",
    Bleu: "Blue",
    Rose: "Pink",
    Blanc: "White",
    Aurore: "Aurora",
    Synthwave: "Synthwave",
    Toxique: "Toxic",
    "Lune de sang": "Blood moon",
    Abysse: "Ocean",
    Nébuleuse: "Nebula",
    "Noir profond et cramoisi : la marque RedWidow":
      "Deep black and crimson: the RedWidow identity",
    "Cramoisi et acier : la marque d'origine, plus offensive":
      "Crimson and steel: the original, more offensive brand",
    "Vert toxique sur acier : terminal, offensif": "Toxic green on steel: terminal, offensive",
    "Bleu glacier : froid, net, défensif": "Glacier blue: cool, sharp, defensive",
    "Violet électrique : nuit, IA, laboratoire": "Electric violet: night, AI, laboratory",
    "Olive et kaki : terrain, opérations": "Olive and khaki: field work, operations",
    "Rouge franc": "Classic red",
    "Orange vif ; proche de la couleur des alertes": "Bright orange; close to alert colors",
    "Jaune soleil ; proche de la couleur des alertes": "Sun yellow; close to alert colors",
    "Vert franc": "Classic green",
    "Bleu franc": "Classic blue",
    "Rose vif": "Bright pink",
    "Blanc pur, graphite en thème clair": "Pure white, graphite in light themes",
    "Dégradé cyan, bleu et violet": "Cyan, blue and violet gradient",
    "Dégradé rose, violet et bleu": "Pink, violet and blue gradient",
    "Dégradé lime, vert et cyan": "Lime, green and cyan gradient",
    "Dégradé cramoisi, magenta et violet": "Crimson, magenta and violet gradient",
    "Dégradé sarcelle, bleu et indigo": "Teal, blue and indigo gradient",
    "Dégradé rose, violet et cyan": "Pink, violet and cyan gradient",
  };

  // packages/messages/src/ui-domains/resources.ts
  var resourcesEn = {
    "Fournisseurs OpenCode": "OpenCode providers",
    "Actualiser le catalogue": "Refresh catalog",
    "Chargement du catalogue OpenCode…": "Loading the OpenCode catalog…",
    "Activez les fournisseurs souhaités. OpenCode conserve aussi son accès général à tous les modèles connectés.":
      "Enable the providers you want. OpenCode also keeps its general access to all connected models.",
    "Rechercher un fournisseur…": "Search providers…",
    "Rechercher un fournisseur": "Search providers",
    connecté: "connected",
    "à connecter": "not connected",
    "Configuration invalide : identifiants et ports distincts requis.":
      "Invalid configuration: distinct IDs and ports are required.",
    "Ajouter des outils et du contexte": "Add tools and context",
    "Outils et contexte": "Tools and context",
    Ajouter: "Add",
    Fichiers: "Files",
    "Configurer les outils et fournisseurs": "Configure tools and providers",
    "Configurez vos connexions dans Réglages → Fournisseurs, puis choisissez votre fournisseur ici.":
      "Configure your connections in Settings → Providers, then choose your provider here.",
    "Choisir un fournisseur": "Choose a provider",
    "Skills / méthodes": "Skills / methods",
    Activé: "On",
    Désactivé: "Off",
    "Connecteurs MCP": "MCP connectors",
    Recherche: "Search",
    "Recherche web": "Web search",
    "Le mode Apprentissage lit seulement les cours du dossier de cours.":
      "Learning mode only reads the courses in the course folder.",
    "Activer ou désactiver ici met aussi à jour les réglages. Les actions restent soumises aux approbations.":
      "Turning a capability on or off here also updates the settings. Actions still require the usual approvals.",
    "en pause": "paused",
    "Fournisseurs IA": "AI providers",
    "Configurez une connexion, puis activez son accès dans le chat. Les clés restent dans le stockage sécurisé ou le gestionnaire du fournisseur.":
      "Configure a connection, then enable it for the chat. Keys stay in secure storage or the provider’s credential manager.",
    "Ajouter Ollama / un endpoint compatible": "Add Ollama / a compatible endpoint",
    "Activez les méthodes à proposer dans le menu + du chat. Choisissez ensuite une méthode par conversation.":
      "Enable the methods you want in the chat + menu. Then choose one method per conversation.",
    "Configurez les services locaux du projet, puis activez-les. Ils apparaîtront dans le menu + du chat pour une sélection explicite. Quatre services maximum.":
      "Configure the project’s local services, then enable them. They will appear in the chat + menu for explicit selection. Up to four services.",
    "Disponible à la demande dans le menu +. Désactivée pour les nouvelles conversations.":
      "Available on demand in the + menu. Off for new conversations.",
    "Supprimer la configuration": "Remove configuration",
    "Endpoint compatible OpenAI": "OpenAI-compatible endpoint",
    "Nom du fournisseur": "Provider name",
    "Nom requis (128 caractères maximum).": "Name required (up to 128 characters).",
    "URL de l’API compatible OpenAI": "OpenAI-compatible API URL",
    "Identifiants des modèles, séparés par des virgules": "Model IDs, separated by commas",
    "Ce nom de fournisseur existe déjà.": "This provider name already exists.",
    "URL ou modèles invalides. Utilisez une URL HTTP(S) sans secret ni paramètre et au moins un modèle.":
      "Invalid URL or models. Use an HTTP(S) URL without credentials or query parameters and at least one model.",
    "Sans clé (local)": "No key (local)",
    "Configurer une clé API": "Configure an API key",
    "Authentification du fournisseur": "Provider authentication",
    "Choisissez un fournisseur activé et un modèle disponible avant d’envoyer.":
      "Choose an enabled provider and an available model before sending.",
  };

  // packages/messages/src/ui-domains/sessions.ts
  var sessionsEn = {
    Sessions: "Sessions",
    "{0} · Sessions": "{0} · Sessions",
    Toutes: "All",
    "En attente de toi": "Waiting for you",
    Filtre: "Filter",
    "Taille des tuiles": "Tile size",
    "Au repos": "Idle",
    "Tour en cours": "Working",
    "Approbation en attente": "Approval pending",
    Erreur: "Error",
    "Chat latéral": "Sidebar chat",
    Éditeur: "Editor",
    "Aucune session ouverte.": "No open session.",
    "Aucune session n’attend de toi.": "No session is waiting for you.",
    "Ouvrir {0}": "Open {0}",
    "{0} approbation(s)": "{0} approval(s)",
    "Aucune activité": "No activity",
  };

  // packages/messages/src/ui-domains/studio.ts
  var studioEn = {
    "Fichier OpenCode recherché : {0}": "OpenCode file searched: {0}",
    "Test du catalogue en cours…": "Testing the catalog…",
    "Statut de connexion non annoncé.": "Connection status not reported.",
    "Connexion déclarée par le fournisseur.": "Connection reported by the provider.",
    "Connexion non déclarée par le fournisseur.": "Connection not reported by the provider.",
    "Catalogue accessible : {0} modèle(s).": "Catalog accessible: {0} model(s).",
    "Aucune génération testée.": "No generation tested.",
    "Mise à jour des conteneurs…": "Updating containers…",
    "État des conteneurs indisponible.": "Container status unavailable.",
    "Impossible d’enregistrer ce fournisseur. Réessayez.":
      "Could not save this provider. Try again.",
    "Créer le projet": "Create project",
    "Donnez un nom au projet : son dossier est créé automatiquement.":
      "Name the project: its folder is created automatically.",
    "Dossier des nouveaux projets : {0}": "New project folder root: {0}",
    "Dossiers des projets": "Project folders",
    "Racine des nouveaux projets (avancé)": "Root for new projects (advanced)",
    "Ce réglage machine concerne les nouveaux projets. Les projets existants restent à leur emplacement. Vide : ~/.exegol/workspaces.":
      "This machine setting applies to new projects. Existing projects stay in place. Empty: ~/.exegol/workspaces.",
    "Comptes de test": "Test accounts",
    "Valeur trop courte pour être masquée dans les journaux.":
      "Value too short to be masked in logs.",
    "Comptes du projet actif, utilisés par l’agent et masqués dans les journaux.":
      "Accounts for the active project, used by the agent and masked in logs.",
    "Activez un projet pour ajouter un compte.": "Activate a project to add an account.",
    "Ajouter ou remplacer un compte": "Add or replace an account",
    "Libellé (A, B…)": "Label (A, B…)",
    "Site ou hôte (facultatif)": "Site or host (optional)",
    "Type de secret": "Secret type",
    "Mot de passe": "Password",
    "Cookie de session": "Session cookie",
    Secret: "Secret",
    "Impossible d’enregistrer les comptes de test.": "Could not save test accounts",
    Conteneurs: "Containers",
    Système: "System",
    "Contrôle système": "System control",
    Global: "Global",
    Intégrations: "Integrations",
    Fournisseurs: "Providers",
    "Limites par défaut": "Default limits",
    "Valeurs globales pour tous les projets, lues depuis les paramètres VS Code (warband.maxTurns, warband.ultracode.*). Le niveau d’effort se choisit dans le chat.":
      "Global values for all projects, read from the VS Code settings (warband.maxTurns, warband.ultracode.*). The effort level is chosen in the chat.",
    "Tours maximum": "Maximum turns",
    "Ultracode : tours maximum": "Ultracode: maximum turns",
    "Ultracode : budget maximum": "Ultracode: maximum budget",
    "sans plafond": "no limit",
    "clé présente : oui": "key present: yes",
    "clé présente : non": "key present: no",
    "connexion gérée par OpenCode": "connection managed by OpenCode",
    "Configurez les services locaux du projet actif. Le chat les propose ensuite dans le menu + pour une sélection explicite. Quatre services maximum.":
      "Configure the local services of the active project. The chat then offers them in the + menu for explicit selection. Four services at most.",
    Profil: "Profile",
    "Profil par défaut du projet :": "Project default profile:",
    "Aucun profil par défaut.": "No default profile.",
    "La méthode d’une conversation se choisit dans le chat.":
      "A conversation's method is chosen in the chat.",
    Projet: "Project",
    Apparence: "Appearance",
    "Prompt du terminal Docker": "Docker terminal prompt",
    "D’origine": "Original",
    "Conserver le prompt et le thème du conteneur.": "Keep the container's prompt and theme.",
    "Deux lignes : identité et dossier courant.": "Two lines: identity and current directory.",
    "Utilisateur, hôte et dossier sur une ligne.": "User, host and directory on one line.",
    "Le dossier courant, sans couleurs.": "Current directory, without colors.",
    Compact: "Compact",
    Minimal: "Minimal",
    "Le texte avant le curseur, pas une bannière. S’applique aux nouveaux terminaux Bash ouverts par RedWidow, pour Kali et Exegol. Les terminaux déjà ouverts restent inchangés.":
      "The text before the cursor, rather than a banner. Applies to new Bash terminals opened by RedWidow, for Kali and Exegol. Existing terminals stay unchanged.",
    "Aperçus illustratifs. Le nom de l’utilisateur, l’hôte et le dossier suivent le terminal. Aucun fichier .bashrc n’est modifié. Choisissez D’origine pour retrouver votre thème habituel.":
      "Illustrative previews. User, host and directory follow the terminal. No .bashrc file is changed. Choose Original to keep your usual theme.",
    "Impossible d’enregistrer le prompt. Réessayez.": "Could not save the prompt. Try again.",
    "Enregistré. Ouvrez un nouveau terminal pour appliquer ce choix.":
      "Saved. Open a new terminal to apply this choice.",
    Interface: "Interface",
    "Non classé": "Unclassified",
    Hôte: "Host",
    "Site / URL": "Site / URL",
    Identifiant: "Credential",
    Étape: "Step",
    Confirmé: "Confirmed",
    Hypothèse: "Hypothesis",
    Échec: "Failed",
    État: "State",
    Réglages: "Settings",
    "Projet actif": "Active project",
    "Enregistrement…": "Saving…",
    Supprimer: "Delete",
    Arrêter: "Stop",
    présent: "present",
    absent: "absent",
    Démon: "Daemon",
    joignable: "reachable",
    injoignable: "unreachable",
    "en cours": "running",
    arrêté: "stopped",
    Annuler: "Cancel",
    "Sarcelle et ardoise : veille, terminal, sécurité":
      "Teal and slate: monitoring, terminal, security",
    "Cramoisi et acier : la marque d’origine, plus offensive":
      "Crimson and steel: the original, more offensive brand",
    "Violet et glace : agents, recherche, nuit": "Purple and ice: agents, research, night",
    Éditeur: "Editor",
    "Accent du thème VS Code : intégration maximale": "VS Code theme accent: full integration",
    Multicolore: "Multicolor",
    "Six teintes, une par rôle : corail, vert, cyan, bleu, violet et rose":
      "Six colors, one per role: coral, green, cyan, blue, purple and pink",
    "Choisissez le jeu de couleurs de RedWidow. Il s’applique aussitôt à toutes les vues et s’adapte aux thèmes clair, sombre et contraste élevé de VS Code.":
      "Choose the RedWidow color palette. It applies immediately to all views and adapts to VS Code light, dark and high contrast themes.",
    "En contraste élevé, RedWidow utilise les couleurs du thème : le choix est enregistré et s’applique dès que vous changez de thème.":
      "In high contrast, RedWidow uses theme colors. Your choice is saved and applies when you change themes.",
    "Jeu de couleurs": "Color palette",
    Ajuster: "Fit",
    "Ajuster le graphe à la fenêtre (0)": "Fit graph to window (0)",
    "Dézoomer (−)": "Zoom out (−)",
    Dézoomer: "Zoom out",
    "Zoomer (+)": "Zoom in (+)",
    Zoomer: "Zoom in",
    "Exporter le brouillon": "Export draft",
    "Rapport Markdown du projet, identifiants et loot exclus":
      "Project Markdown report, excluding credentials and loot",
    "Aperçu du rapport": "Report preview",
    "Exporter l’image": "Export image",
    "Image SVG de tous les éléments, noms complets et liens (sans filtre ni cadrage)":
      "SVG image of all items, full names and links (without filters or cropping)",
    "Exporter les étapes confirmées au format Attack Flow 2.0":
      "Export confirmed steps in Attack Flow 2.0 format",
    "Supprimer l’élément sélectionné": "Delete selected item",
    "Chemin retenu": "Selected path",
    "Visualiser les liens retenus, étape par étape. Aucune commande exécutée.":
      "View selected links step by step. No commands are executed.",
    Rejouer: "Replay",
    "Preuve indisponible": "Evidence unavailable",
    "Retirer du chemin": "Remove from path",
    "Marquer le chemin": "Mark path",
    "Liens du graphe": "Graph links",
    ", chemin retenu": ", selected path",
    "Parcours visualisé.": "Path displayed.",
    "Rejeu interrompu.": "Replay stopped.",
    Légende: "Legend",
    "Tout afficher": "Show all",
    "Chemin retenu : liens verts marqués par l’agent ou par vous. Sélectionnez un lien pour le modifier.":
      "Selected path: green links marked by the agent or by you. Select a link to edit it.",
    "Déplier la légende": "Expand legend",
    "Replier la légende": "Collapse legend",
    "Minimap du graphe : zone actuellement visible": "Graph minimap: currently visible area",
    "Graphe : flèches pour se déplacer, + et − pour zoomer, 0 pour ajuster, Échap pour désélectionner":
      "Graph: arrow keys to move, + and − to zoom, 0 to fit, Escape to deselect",
    "Ouvrir l’espace RedWidow": "Open RedWidow workspace",
    "Préparer et vérifier les fichiers de mission": "Prepare and check mission files",
    "Attendez la fin du travail en cours pour changer de projet.":
      "Wait for the current task to finish before switching projects.",
    "Aucun projet actif": "No active project",
    "Gestion des projets": "Project management",
    "Choisir un projet": "Choose a project",
    "Nouveau projet": "New project",
    "Choisir un projet…": "Choose a project…",
    "Activer le projet": "Activate project",
    "Renommer…": "Rename…",
    "Supprimer…": "Delete…",
    "Nom du nouveau projet": "New project name",
    "Créer un projet et choisir son dossier…": "Create a project and choose its folder…",
    "Donnez un nom au projet, puis choisissez son dossier.":
      "Name the project, then choose its folder.",
    "Aucun conteneur affiché. Gérez les associations dans le cockpit.":
      "No container displayed. Manage links in the cockpit.",
    "Espace affiché": "Displayed workspace",
    "Mémoire du projet": "Project memory",
    "Notes privées du projet. Non transmises automatiquement aux conversations.":
      "Private project notes. They are not automatically sent to conversations.",
    "Résumé de session": "Session summary",
    "Enregistrer le résumé": "Save summary",
    "Résumé trop long : 8 Kio maximum.": "Summary too long: maximum 8 KiB.",
    "Résumé enregistré.": "Summary saved.",
    "Gérer les econtainers": "Manage containers",
    "Bureau agent et catalogue MCP": "Agent desktop and MCP catalog",
    "Services externes activés à la demande, quatre maximum. Aucun programme téléchargé automatiquement. Profil : ":
      "External services enabled on demand, up to four. No programs downloaded automatically. Profile: ",
    général: "general",
    "Catalogue MCP…": "MCP catalog…",
    "Choisir un skill / profil…": "Choose a skill / profile…",
    "configuré (test requis)": "configured (test required)",
    "non configuré": "not configured",
    "Connexion locale activée. Les appels aux outils restent soumis à la gate RedWidow.":
      "Local connection enabled. Tool calls remain subject to the RedWidow gate.",
    "Connexion désactivée. Installez l’extension MCP officielle dans Burp Suite pour la connecter.":
      "Connection disabled. Install the official MCP extension in Burp Suite to connect it.",
    "Configurer Burp Suite MCP…": "Configure Burp Suite MCP…",
    "Tester la connexion": "Test connection",
    "Aucun conteneur pour l’instant. Créez-en un depuis « Gérer les econtainers ».":
      "No containers yet. Create one from “Manage containers”.",
    "Le graphe est vide : les éléments notés par l’agent apparaîtront ici.":
      "The graph is empty: items recorded by the agent will appear here.",
    Graphe: "Graph",
    "Graphe des éléments notés par l’agent. Ouvrez la vue plein écran pour explorer le graphe.":
      "Graph of items recorded by the agent. Open the full screen view to explore the graph.",
    "Ouvrir le graphe": "Open graph",
    "Dossier de cours lu par le mode Apprentissage, en lecture seule. Aucun cours inclus : dépose-y des sources libres, un sous-dossier par source.":
      "Read-only course folder used by Learning mode. No courses included: add openly licensed sources, one subfolder per source.",
    "Ouvrir le dossier de cours": "Open course folder",
    "Aucune source dans le dossier de cours.": "No sources in the course folder.",
    "Choisissez une rubrique dans la navigation.": "Choose a section in the navigation.",
    "Actualisation du graphe indisponible.": "Graph refresh unavailable.",
    "Impossible d’enregistrer le jeu de couleurs. Réessayez.":
      "Unable to save the color palette. Try again.",
    Langue: "Language",
    "{0} élément{1}": "{0} item{1}",
    "Étape {0}/{1} : {2}": "Step {0}/{1}: {2}",
    "Mettre en évidence : {0}": "Highlight: {0}",
    "Lien {0} vers {1}{2}": "Link {0} to {1}{2}",
    "{0} / 8192 octets · Les secrets reconnus sont masqués à l’enregistrement.":
      "{0} / 8192 bytes · Recognized secrets are hidden when saving.",
    "{0}/{1} actifs": "{0}/{1} running",
    "{0} élément{1} : ouvrez la vue plein écran pour le graphe interactif.":
      "{0} item{1}: open the full screen view for the interactive graph.",
  };

  // packages/messages/src/ui-domains/viewer.ts
  var viewerEn = {
    "Monitor — lecture seule, ce n'est pas un shell": "Monitor — read-only, not a shell",
    "Sortie — lecture seule": "Output — read-only",
    "Rapport — brouillon": "Report — draft",
    "Actions de la page": "Page actions",
    "Copier tout le contenu visible": "Copy all visible content",
    Exporter: "Export",
    "Enregistrer le contenu en texte": "Save the content as text",
    "Suivre la fin": "Follow the end",
    "Désactiver le suivi de la fin pour défiler librement":
      "Turn off end-following to scroll freely",
    "Filtrer les lignes": "Filter lines",
    "Filtrer les lignes…": "Filter lines…",
    "{0} / {1} lignes": "{0} / {1} lines",
    "Aucune ligne ne contient ce texte.": "No line contains this text.",
    "Aucune sortie à afficher.": "No output to show.",
    "Aucun constat dans ce brouillon.": "No finding in this draft.",
    "Contenu trop volumineux pour l'export : filtrez-le d'abord.":
      "Content too large to export: filter it first.",
    "Enregistrer le contenu du Monitor en texte": "Save the Monitor content as text",
    "Enregistrer la sortie en texte": "Save the output as text",
    Texte: "Text",
    "Ce fichier contient des modifications non enregistrées. Choisissez un autre nom.":
      "This file has unsaved changes. Choose another name.",
  };

  // packages/messages/src/ui.ts
  var UI_EN = {
    ...chatEn,
    ...cockpitEn,
    ...hostEn,
    ...logicEn,
    ...studioEn,
    ...resourcesEn,
    ...auditEn,
    ...redwidowEn,
    ...programEn,
    ...engagementEn,
    ...sessionsEn,
    ...viewerEn,
  };
  var currentLocale = "fr";
  var getUiLocale = () => currentLocale;
  function setUiLocale(value) {
    currentLocale = value === "en" ? "en" : "fr";
  }
  function uiText(locale, key, params = {}) {
    const template = locale === "en" ? (UI_EN[key] ?? key) : key;
    return template.replace(/\{(\w+)\}/g, (token, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : token,
    );
  }
  function createUiTranslator(locale) {
    return (input, ...values) => {
      if (typeof input === "string") return uiText(locale(), input, values[0]);
      const params = {};
      const key = input.reduce((text, part, index) => {
        if (index < values.length) params[String(index)] = values[index];
        return text + part + (index < values.length ? `{${index}}` : "");
      }, "");
      return uiText(locale(), key, params);
    };
  }
  var t = createUiTranslator(getUiLocale);
  function auditLabel(value, locale = currentLocale) {
    return uiText(locale, AUDIT_LABELS[value] ?? value);
  }

  // packages/vscode/src/webview/i18n.ts
  setUiLocale(document.documentElement.lang);
  function applyStatic(root = document) {
    document.documentElement.lang = getUiLocale();
    for (const element of root.querySelectorAll("[data-i18n]")) {
      const key = element.getAttribute("data-i18n");
      if (key !== null) element.textContent = t(key);
    }
    for (const attribute of ["title", "aria-label", "placeholder"]) {
      for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
        const key = element.getAttribute(`data-i18n-${attribute}`);
        if (key !== null) element.setAttribute(attribute, t(key));
      }
    }
  }
  Object.assign(globalThis, {
    WarbandI18n: { t, auditLabel, setLocale: setUiLocale, getLocale: getUiLocale, applyStatic },
  });
})();
