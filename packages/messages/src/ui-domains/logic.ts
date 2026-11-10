// Textes produit de la logique hôte et des exports ; les données dynamiques restent intactes.
export const logicEn: Record<string, string> = {
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
  "Le dossier de projet doit être un dossier réel.": "The project folder must be a real directory.",
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
