# Passation à la session Windows

À lire en premier par la session Claude qui tourne sur le PC Windows de l'utilisateur. Ce fichier remplace la mémoire de la conversation précédente (session cloud, 2026-10-14). Lire ensuite `CLAUDE.md` (consignes permanentes, déjà chargées automatiquement) puis `docs/architecture-issues.md` et `docs/adr/0002-windows-natif.md`.

## Mission

**Valider warband sur un vrai Windows** (lot W-L6), corriger ce qui échoue, puis rendre le job Windows de la CI bloquant. Branche de travail : `claude/happy-bardeen-5u5dow` (ne pas pousser ailleurs, pas de PR sans demande).

Le projet : orchestration d'agents IA (adaptateurs Claude Agent SDK et OpenCode) avec journal d'événements, graphe causal, **gate d'approbation** des outils et outils Docker. Monorepo pnpm TypeScript, texte en français. L'utilisateur travaille sous Windows avec Docker Desktop (WSL2, conteneurs Linux) ; WSL lui est impossible, donc le support **natif** est la priorité n°1. Objectif à terme : une extension VS Code personnelle, compatible avec les conteneurs Exegol, pour s'entraîner aux CTF et certifications.

## État au moment de la passation

- Lots faits et poussés : P0, P1, P2, adaptateur OpenCode, validation du moteur avec le vrai SDK Claude (abonnement, 5 scénarios réels réussis), Windows W-L1 à W-L5b, W-L2b. `pnpm check` est vert sous Linux (724 tests).
- Le job `windows` de la CI (windows-latest, Node 22) est **non bloquant** (`continue-on-error`). Sa première exécution a échoué sur ~40 tests, corrigés par W-L2b (tests qui supposaient un Bash POSIX, chemins POSIX codés en dur, `ENAMETOOLONG`, absence de `SIGTERM`). Son résultat sur les derniers commits n'a pas été relu : à vérifier.
- **Jamais testé sur un vrai Windows** : `taskkill`, `realpathSync.native`, Docker Desktop, `claude.exe` du SDK, binaire OpenCode `.exe`.
- ADR 0003 (bac à sable Docker : exécution de commandes dans un conteneur confiné) écrit, statut « proposé », rien d'implémenté.

## Invariants de sécurité à ne jamais affaiblir

Détail dans `CLAUDE.md`. Les points qui comptent le plus sous Windows :

- Gate d'approbation = seule autorité ; un `deny`, un chemin sensible ou hors espace de travail, un `docker run` donnant accès à l'hôte ne sont jamais contournables ni mémorisables.
- **Sous win32, `Bash` est non POSIX par défaut** (fail-closed) ; seul le code appelant peut déclarer `posixShell: true`. L'outil PowerShell de l'agent est toujours interdit.
- Binaires toujours résolus en chemin absolu `.exe` (jamais `.cmd`, jamais cmd.exe, jamais le répertoire courant). Processus enfants avec `safeEnv` (liste blanche). Arrêt d'arbre par `taskkill /PID n /T /F`.
- Formes de chemin refusées : UNC, `\\?\`, `\\.\`, flux ADS (`:`), noms réservés (CON, NUL…), fin par point ou espace, `%VAR%`, noms 8.3 non résolus.
- Secrets masqués dans le recorder. **Ne jamais demander ni accepter un jeton ou une clé collé dans le chat** ; passer par une variable d'environnement de la session.

## Organisation du travail (consigne permanente)

Utiliser le modèle le moins cher qui fait le travail : `explorer` (haiku) lit, session principale et `dev` (sonnet) codent, `architect` (opus) décide et relit la sécurité (pas de code). Vérifier chaque lot soi-même (`pnpm check`, relecture du diff, `git status`) avant de pousser. L'utilisateur surveille son quota de 5 heures : pas de sous-agents inutiles.

## Plan de validation W-L6 (PowerShell)

Noter pour chaque étape : réussi / échec + sortie utile. Corriger les échecs par petits lots, avec tests.

0. **Prérequis** : `node -v` (>= 22.12), `corepack enable` puis `pnpm -v` (10.28), `git --version`, `docker version` (Docker Desktop démarré, conteneurs Linux).
1. **Installation** : `pnpm install --frozen-lockfile`.
2. **`pnpm check`** complet. Tout échec propre à Windows est un résultat de validation : le corriger (cause réelle, pas de `skip`).
3. **Build et CLI** : `pnpm build`, puis `node packages/cli/dist/main.js --help` et `agents`.
4. **Résolution du binaire** : vérifier que `docker` se résout en chemin absolu `docker.exe` (via `resolveBinary` du cœur, par exemple `node -e` sur `packages/core/dist`), et qu'un faux `docker.exe` déposé dans le dossier de travail n'est jamais choisi.
5. **Chemins** : avec `node packages/cli/dist/main.js policy check --help` pour la syntaxe, tester `Read` sur : `C:\Users\<vous>\.ssh\id_rsa` (deny sensible), `C:\Users\<vous>\.claude\.credentials.json` (deny), `\\?\C:\Windows\win.ini`, `\\localhost\c$\x`, `C:\dossier\fichier.txt:flux`, `CON`, `C:\dossier\nom.` (point final), `%USERPROFILE%\x`, `..\..\x`, un lien symbolique/jonction vers l'extérieur. Attendu : `deny`/`ask` fail-closed, jamais `allow` hors espace de travail.
6. **Arrêt d'arbre** : lancer un processus Node qui crée un enfant de longue durée, appeler `terminateProcessTree`, vérifier avec `tasklist` que les descendants ont disparu et que `forced` vaut `true`.
7. **Environnement** : exporter une fausse variable `ANTHROPIC_API_KEY`, lancer un enfant via `runProcess`, vérifier qu'elle n'est pas transmise alors que `PATH`/`SystemRoot` le sont.
8. **Docker réel** : `ps` et `images` via le client du cœur ; création et suppression d'un conteneur de test (`docker run` simple, sans volume) ; vérifier le tube nommé et l'arrêt d'un `docker` tué.
9. **Claude réel** : l'utilisateur crée un jeton avec `claude setup-token` et le place **lui-même** dans la variable d'environnement `CLAUDE_CODE_OAUTH_TOKEN` de la session (jamais dans le chat). Puis `$env:WARBAND_CONTRACT_SUBSCRIPTION="1"; pnpm test:contract` (5 scénarios attendus). Vérifier au `system/init` que ni `PowerShell` ni `Bash` n'apparaissent dans la liste d'outils (sinon le run doit s'arrêter avec `sdk.unexpectedTool`).
10. **OpenCode** : installer le binaire natif `.exe`, `$env:OPENCODE_BIN="C:\chemin\opencode.exe"; pnpm test` (contrats hors ligne). Un modèle gratuit répond 403 avec notre configuration (documenté) ; un vrai fournisseur demande une clé passée par variable d'environnement.
11. **Politique et journal** : `policy trust` sur un fichier de dépôt (empreinte via `realpathSync.native`), `run` avec un agent factice, `journal` et `graph`, ouverture de l'export HTML.

## Après la validation

- Si tout passe : rendre le job `windows` bloquant dans `.github/workflows/ci.yml` (retirer `continue-on-error`), lever l'avertissement « best effort » de la CLI (voir ADR 0001 D / ADR 0002), mettre à jour `docs/architecture-issues.md` (section « Windows natif ») et l'ADR 0002 (statut). Sinon : consigner précisément ce qui reste.
- Limite connue à traiter : `docker run` avec plus de 32 767 caractères d'arguments lève un `ENAMETOOLONG` brut sous Windows ; prévoir une limite plus basse sous win32 avec une erreur codée (`CodedError`, catalogues fr/en).
- Points non vérifiés sans Windows : forme réelle des retours de `realpathSync.native`, comportement de `taskkill`, outils réellement exposés par le SDK, shell utilisé par le bash d'OpenCode.

## Suite du projet (après Windows)

1. **Bac à sable Docker** (ADR 0003) : exécution de commandes dans un conteneur confiné créé par le moteur (profil durci par défaut : non root, aucune capacité, réseau coupé, un conteneur par run). Lots S1 à S4 à relire par l'architecte. Le profil visé par l'utilisateur (images Exegol : root, réseau, capacités réseau) a été bloqué à trois reprises par un filtre de sécurité automatique lors de la rédaction par l'architecte : **ne pas le contourner** (ni reformulation ni changement de modèle). Cadrage confirmé par l'utilisateur : usage personnel (CTF, certifications), cibles autorisées, liste d'exclusion de cibles définie par l'utilisateur dans un fichier hors de portée de l'agent, approbation à chaque exécution avec avertissement de non-responsabilité. À rediscuter avec lui avant d'avancer sur ce profil.
2. **Extension VS Code** (le plus gros bloc) : spike sur l'empaquetage du binaire du SDK dans l'extension host, puis chat, cartes d'approbation (`createApprovalQueue`, `Recorder.stream`), réglages, graphe en direct.
3. Rotation des journaux, nettoyage des conteneurs après arrêt forcé, export HTML amélioré.

## Rappels pour l'utilisateur

- Révoquer l'ancien jeton `setup-token` (il est apparu en clair dans une autre conversation) et supprimer la variable `CLAUDE_TEST`.
- Messages de commit en français, sans identifiant de modèle ; lignes d'attribution indiquées par la session.
