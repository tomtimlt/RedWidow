# 0004 — Extension VS Code : structure, moteur hors de l'extension host, sécurité de l'UI

- Statut : proposé (questions de produit P1 à P3 à confirmer par l'utilisateur)
- Date : 2026-10-14
- S'appuie sur : ADR 0001 (processus), ADR 0002 (Windows natif) ; `docs/architecture-issues.md` point 9 et « À faire plus tard »

## Contexte

Le cœur expose déjà ce qu'il faut à une UI : `createApprovalQueue()` (`core/src/approval/gate.ts:287`, `pending`/`answer`/`requests`/`close`), `Recorder.subscribe/stream`, `AgentRunner.run(input, {recorder, gate, signal})`, `buildGraph` + `renderGraphHtml` (HTML autonome, échappé par `escapeHtml`, `export-html/src/index.ts:48`). La CLI montre l'assemblage d'un run (`cli/src/main.ts:134-217`). `createSdkRunner` accepte `processEnv` (`agent-sdk/src/runner.ts:186`) : l'environnement du SDK n'a pas besoin d'être celui du processus. Le SDK (0.3.299, version exacte) lance un binaire `claude` natif fourni par un paquet optionnel par plateforme (`@anthropic-ai/claude-agent-sdk-win32-x64`…). `pathToClaudeCodeExecutable` reste passable via `sdkOptions` (point « Durcissement » ouvert).

Modèle de menaces propre à l'extension :

- **Le dépôt ouvert contrôle** : ses fichiers, `.john-studio/policy.json` (inerte avant approbation de l'empreinte) **et `.vscode/settings.json`** : tout réglage de l'extension lisible au niveau espace de travail est une entrée hostile (chemin de binaire = exécution de code).
- **Le modèle contrôle** : tout le texte affiché (réponses, entrées d'outil, sorties). Une injection HTML dans une webview qui exécute du script peut poster une fausse réponse « allow » : la webview est la surface la moins sûre.
- **Les autres extensions** partagent l'extension host : aucune frontière contre elles (hors périmètre), mais on ne doit ni modifier leur `process.env` ni dépendre de gestionnaires globaux (`process.on("exit")`, signaux) dans un processus qui ne nous appartient pas.

## Décision

**A. Un paquet `packages/vscode` (privé), trois couches.** `src/engine/` : processus moteur, Node pur. `src/logic/` : état de session, réduction des événements en vue, formatage et nettoyage du texte affiché, validation des messages, sans `vscode`. `src/extension/` : couche fine (activation, commandes, webviews, SecretStorage, réglages). Un test interdit `import "vscode"` hors de `src/extension/`. Seules `engine` et `logic` sont testées par vitest ; `extension` est validée à la main (E6). Webview en DOM simple, sans framework. Nouvelles dépendances de développement seulement : `@types/vscode`, `@vscode/vsce`, `esbuild`.

**B. Le moteur tourne dans un processus enfant**, lancé par `child_process.fork` (Node de VS Code, `ELECTRON_RUN_AS_NODE=1`), canal IPC de Node. L'enfant porte recorder, journal (`.john-studio/runs/` comme la CLI), gate, file d'approbation et runner ; l'extension n'est qu'un client. Protocole versionné (`v: 1`), validé à la réception des deux côtés : vers l'enfant `start`, `prompt`, `answer {toolUseId, decision, remember}`, `abort`, `dispose` ; vers l'extension `event` (événements déjà masqués), `approval` (`PendingApproval`), `ended`, `error` (codes `Reason`, jamais de texte). Déconnexion IPC → l'enfant annule le run, tue ses arbres de processus (ADR 0001) et se termine. Environnement de l'enfant : `safeEnv()` + `ELECTRON_RUN_AS_NODE` + la seule variable d'authentification choisie ; le recorder masque sa valeur (`secretsFromEnv`).
**Binaire `claude`** : un `.vsix` **par plateforme** (`vsce package --target`), chacun ne contenant que le paquet optionnel de sa cible. Le chemin est fixé par le code via une nouvelle option `SdkRunnerOptions.executable`, et `pathToClaudeCodeExecutable` est retiré de `sdkOptions` (comme `extraArgs`). L'empreinte SHA-256 du binaire est calculée à l'empaquetage et embarquée ; l'enfant la vérifie une fois au démarrage, écart ou absence → refus `extension.binaryMismatch` (fail-closed). Portée honnête : détecte corruption et mise à jour partielle ; un attaquant capable d'écrire dans le dossier de l'extension modifie aussi le JS. `extensionKind: ["workspace"]` (remote SSH/WSL : le moteur tourne à côté des fichiers, avec le `.vsix` de la plateforme distante) ; VS Code web non pris en charge (pas de point d'entrée `browser`).

**C. Invariants côté UI.**
- **Cartes d'approbation = seule UI de la gate.** Aucun réglage ni bouton « tout autoriser », aucun mode autonome. Choix identiques à la CLI (`cli/src/ask.ts` : une fois, session, toujours, refuser) ; « toujours » n'est proposé que si le verdict est mémorisable (prédicat exporté par le cœur depuis `REMEMBERABLE`/`PERSISTABLE`, pas de copie) et exige une **confirmation modale native** (`showWarningMessage({ modal: true })`) émise par l'extension, hors webview : une webview compromise ne peut pas écrire de règle durable. La gate reste juge (`deny`, garde-fous, chemins : jamais mémorisés). Réponse refusée si `toolUseId` absent de `pending()`. Fermer la vue ne répond pas ; arrêter le run appelle `close()` (refus).
- **Webviews** : CSP `default-src 'none'; script-src 'nonce-<aléa>'; style-src ${cspSource}; img-src ${cspSource}` ; aucun script distant ni `eval`, `localResourceRoots` = dossier `media/` de l'extension, `enableCommandUris: false`. Tout texte venant du modèle passe par `textContent` (jamais `innerHTML`), après retrait des caractères C0/C1 (sauf `\n`, `\t`), séquences ESC et contrôles bidirectionnels Unicode (même fonction pour la carte d'approbation). Graphe : webview distincte, `enableScripts: false`, contenu de `renderGraphHtml`.
- **Secrets** : jeton (abonnement ou clé API) saisi par `showInputBox({ password: true })`, stocké dans `context.secrets`, transmis seulement à l'environnement de l'enfant ; jamais dans les réglages, l'IPC, la webview, le journal ou `process.env` de l'extension host. L'e-mail du compte n'est jamais affiché ni journalisé.
- **Confiance** : `capabilities.untrustedWorkspaces.supported: false` et `virtualWorkspaces: false`. La confiance VS Code **n'approuve pas** la politique du dépôt : l'avertissement `policy.repo.untrusted`/`modified` est affiché, la commande « Approuver la politique du dépôt » montre le fichier puis demande une confirmation modale avant `trustPolicy`. Réglages sensibles (Bash, binaires docker/opencode, politique explicite, variables transmises) en `scope: "machine"` et lus en ignorant toute valeur d'espace de travail.

## Alternatives écartées

- **Moteur dans l'extension host** : plus simple (pas de protocole), mais gestionnaires globaux du cœur dans un processus partagé, processus `claude` orphelins quand VS Code tue l'host (délai de `deactivate`), plantage du moteur = plantage de toutes les extensions.
- **Moteur = `john` de la CLI lancé en sous-commande** : impose une CLI installée et versionnée à part ; le point d'entrée reste dans le paquet, réutilisable plus tard par un `john serve`.
- **`.vsix` universel avec tous les binaires** : plusieurs centaines de Mio ; **téléchargement du binaire au premier lancement** : réseau, intégrité et proxy à gérer, aucun gain.
- **Approbation par boîtes natives uniquement** : sûr mais inutilisable pour des listes d'entrées longues ; on garde la modale native pour l'action durable seulement.

## Conséquences

- Positives : logique testable sans VS Code ; secret et environnement isolés de l'host ; même assemblage que la CLI, mêmes garanties.
- Négatives : protocole IPC à maintenir ; une construction par plateforme ; taille du `.vsix` (mesurée en E1).
- Risque accepté : le binaire `claude` peut être remplacé entre la lecture de l'empreinte et son lancement ; le dossier de l'extension a la confiance de l'utilisateur.
- À faire côté UI (E4) : appliquer l'équivalent de `stripControl` du cœur (bidi inclus) à l'argv et à la sortie affichés ; le texte renvoyé au modèle reste brut.
- À surveiller : comportement de `fork` sous Electron (Windows) et en remote ; mise à jour du SDK = nouvelle empreinte ; le nonce CSP doit être aléatoire à chaque rendu.

## Plan

Revue sécurité de l'architecte : E2, E3, E4. E4 et E5 parallélisables après E2 ; le reste séquentiel.

- **E1 — Spike d'empaquetage.** Paquet `packages/vscode` (références `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, lockfile), bundle esbuild, `vsce package --target win32-x64` (et `linux-x64`), manifeste d'empreinte ; `agent-sdk` : option `executable`, `pathToClaudeCodeExecutable` retiré de `sdkOptions` ; commande « john : diagnostic » qui forke l'enfant, vérifie l'empreinte et lance un run avec un `QueryFn` factice puis `claude --version`. Critères : `pnpm check` vert ; le `.vsix` contient exactement un binaire, celui de sa cible, et sa taille est notée ; installé par `code --install-extension` sous Windows, diagnostic OK ; binaire altéré d'un octet → refus ; test « pas d'import `vscode` hors `src/extension/` » ; test « `pathToClaudeCodeExecutable` via `sdkOptions` ignoré ».
- **E2 — Moteur enfant et protocole.** `src/engine/`, validation `src/logic/protocol.ts`, code `extension.binaryMismatch` et codes du protocole (`REASON_CODES`, fr, en). Critères (vitest, enfant forké, `QueryFn` factice) : message invalide ou version inconnue → ignoré et signalé ; `answer` sur un `toolUseId` inconnu sans effet ; déconnexion → run annulé et arbre tué ; aucun événement émis ne contient la valeur du jeton ; environnement de l'enfant = liste blanche exacte.
- **E3 — Secrets, réglages, confiance.** Commandes de saisie/effacement du jeton, `package.json` (scopes, capacités), commande d'approbation de politique. Critères : un `.vscode/settings.json` posant Bash ou un binaire n'a aucun effet (test sur la fonction de lecture) ; espace non approuvé → extension inactive ; jeton absent de `settings.json` et de l'IPC (test du message `start`).
- **E4 — Chat et cartes d'approbation.** Webview, CSP à nonce, nettoyage du texte, « toujours » sous modale native, prédicat de mémorisation exporté par le cœur. Critères : une réponse de modèle contenant `<img src=x onerror=…>`, `\x1b[2K` et U+202E s'affiche inerte ; CSP vérifiée par test sur le HTML produit (pas de `unsafe-inline`, nonce présent) ; « toujours » refusé sans confirmation modale.
- **E5 — Graphe en direct.** Webview sans script, rafraîchie au plus une fois par seconde à partir des événements reçus. Critère : HTML identique à `renderGraphHtml` sur le même journal.
- **E6 — Validation réelle et documentation.** Run Claude réel sous Windows depuis l'extension (approbation, refus, annulation, reprise), remote WSL si P2 le retient ; CI : empaquetage par cible ; README ; mise à jour de `docs/architecture-issues.md`.

## Questions de produit (utilisateur)

- **P1 — Moteurs en v1.** Claude seul, ou Claude et OpenCode ? Recommandation : **Claude seul** ; OpenCode exige un binaire externe (réglage machine) et un second chemin à valider, à ajouter ensuite.
- **P2 — Cibles et diffusion.** Recommandation : `.vsix` privés `win32-x64` et `linux-x64` (remote WSL/SSH), installés à la main ; Marketplace et autres plateformes plus tard (publication liée à la décision npm en attente).
- **P3 — Rendu des réponses.** Texte brut ou Markdown ? Recommandation : **texte brut en v1** (sûr par construction) ; Markdown ensuite via un rendu produisant du DOM par notre code, sans HTML brut. **Mis à jour : le rendu Markdown sûr (arbre abstrait puis nœuds DOM en liste blanche, liens en texte) est désormais livré.**
