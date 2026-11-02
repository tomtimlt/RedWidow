# Venator Ops — consignes Codex / GPT

## Langue et périmètre

Répondre toujours en français. Rédiger commentaires, messages et documentation
en français, en conservant les identifiants et termes techniques du code.
Ces consignes concernent Codex. Les fiches `.claude/agents/` et
`.cursor/agents/` restent propres à leurs outils : ne pas les lancer depuis
Codex ni importer leurs restrictions de fournisseurs ou de facturation.

## Comprendre le projet avant d'agir

Venator Ops (anciennement Warband) est une extension VS Code et une CLI d'orchestration d'agents IA pour
des missions de pentest autorisées et l'apprentissage. L'utilisateur garde
le contrôle des actions sensibles par une gate d'approbation écrite en code.
Les actions alimentent un journal JSONL, un graphe causal et des trouvailles
par projet. Ne jamais déléguer la décision de sécurité au modèle.

Repères :

- `README.md` : présentation et premiers pas pour les utilisateurs.
- `CONTRIBUTING.md` : installation de développement, compilation et repères techniques.
- `docs/venator-ops.md` : identité publique et compatibilité des identifiants Warband.
- `docs/etat-du-projet.md` : parcours central, inventaire et prochaines étapes ;
  vérifier le commit de référence avant de reprendre ses statuts.
- `docs/idees.md` : réserve d'idées, pas un engagement ni un état fiable du code.
- `docs/architecture-issues.md` : décisions, lots et suivi ; certaines sections
  historiques ou certains titres peuvent être périmés.
- `docs/adr/` : décisions structurantes ; vérifier leur statut et leurs remplacements.
- `docs/cli.md`, `docs/extension-vscode.md` : parcours techniques et utilisateur.
- `docs/design-chat-ui.md`, `docs/design-studio-ui.md` : conventions visuelles.

Recouper toute affirmation d'avancement avec le code et les tests actuels.
Une décision acceptée ne prouve pas sa réalisation ; une idée peut déjà être
implémentée ou abandonnée. Signaler les contradictions sans transformer une
analyse en chantier de réécriture documentaire non demandé.

## Architecture à préserver

| Paquet | Responsabilité |
|---|---|
| `core` | Événements, recorder, gate, politique, processus, Docker, projets, trouvailles, contrat `AgentRunner` |
| `messages` | Traduction des codes du cœur : français complet, anglais minimal |
| `agent-sdk` | Adaptateur Claude Agent SDK, hooks et outils MCP |
| `agent-opencode` | Adaptateur OpenCode et traduction des permissions vers la gate |
| `cli` | Interface terminal |
| `export-html` | Export autonome du graphe |
| `vscode` | Extension, logique d'interface, webviews et moteur enfant avec protocole IPC |

Le cœur ne dépend d'aucun SDK d'agent ni d'une interface. Il émet des codes
`Reason` et des paramètres, pas des libellés d'affichage. Les adaptateurs
implémentent le contrat neutre ; les interfaces dépendent du cœur.

## Organisation des rôles GPT

La session principale coordonne, intègre et vérifie. Garder les deux voies
existantes : moteur (`architect` → `dev`) et produit (`cadre` → `surface`).
Une demande qui porte sur une interface, un branchement ou un rendu relève
de la voie produit ; un contrat de paquet, un événement ou la gate relève
de la voie moteur.

| Rôle | Modèle GPT souhaité | Mission et limites |
|---|---|---|
| Session principale | `gpt-6.1-sol` | Coordination, synthèse, intégration et validation finale |
| `explorer` | `gpt-6.1-sol` | Lecture seule, faits avec `fichier:ligne`, incertitudes explicites ; aucune écriture ni décision |
| `architect` | `gpt-6-astra` | Décisions moteur et revues de sécurité ; ADR et lots, aucune implémentation |
| `dev` | `gpt-6.1-sol` | Un lot moteur décidé, code et tests ; remonter les décisions manquantes |
| `cadre` | `gpt-6-astra` | Cadrage produit et lots vérifiables ; aucune implémentation |
| `surface` | `gpt-6.1-sol` | Un lot produit cadré, interface et tests ; respecter les conventions visuelles |

Cette table est une consigne de routage, pas une configuration exécutée :
`AGENTS.md` ne crée pas de sous-agents et ne change pas le modèle de la session.
Utiliser seulement les modèles réellement proposés par l'outil. Si le modèle
souhaité manque, garder le modèle GPT courant et indiquer cette limite ; ne
pas inventer d'alias ni basculer vers un autre fournisseur. Choisir un effort
élevé pour les décisions et revues sensibles si ce réglage est disponible.
Les identifiants ci-dessus concernent uniquement l'outillage de développement,
pas les modèles proposés aux utilisateurs de Warband.

Pour un travail conséquent, déléguer aux rôles pertinents si l'outil le permet.
Une petite modification dans un fichier connu se fait directement. Si la
délégation est indisponible, appliquer les étapes lecture, décision,
implémentation et vérification dans la session, sans prétendre à une revue
indépendante.

- Brief court : Objectif, Fichiers, Faits, Décision, Critères, Interdits.
- Démarrer sans historique partagé quand l'outil le permet ; transmettre les
  contraintes utiles, des faits cités et la décision, pas tout le fil.
- Un sous-agent reste dans son rôle et ne délègue pas à son tour.
- Paralléliser les lectures indépendantes, jamais les écritures sur les mêmes fichiers.
- Rapport de 400 mots maximum : faits, fichiers, validation, écarts, décisions requises.
- Revue `architect` pour gate, politique, secrets, authentification, chemins ou processus.
- Après deux échecs sur le même lot, réexaminer la décision et le diagnostic.
- Vérifier le diff et les résultats soi-même avant de livrer.

## Invariants de sécurité

- Gate unique : hook `PreToolUse` côté Claude, permissions côté OpenCode ;
  `canUseTool` reste un filet qui refuse en cas d'incertitude.
- Depuis la 0.3.19 (ADR 0017), Bypass actif et Asker présent autorisent
  une demande normalement refusée, une seule fois, sans mémorisation, avec
  verdict initial conservé dans le journal. Ne pas rétablir silencieusement
  l'ancien contrat de la 0.3.18. Asker présent désigne un canal de réponse
  disponible, pas une confirmation humaine de chaque action. L'apprentissage
  et la CLI sans Asker restent exclus. Les validations hors de la gate et
  les outils réellement exposés par le runner ne sont pas supprimés.
- Préserver le verrouillage des options SDK : permissions, outils, hooks,
  configuration et environnement ne sont pas surchargeables par l'appelant.
- Masquer les secrets dans le recorder avant tout sink. Ne jamais journaliser
  les identifiants secrets ou l'e-mail du compte ; conserver `safeEnv`.
- Politique de dépôt applicable seulement après approbation de son empreinte.
- Bash désactivé par défaut ; mode apprentissage en lecture seule.
- Allowlist d'exécution du projet et résolution par famille de conteneur
  restent contrôlées par le moteur. `primary` sert à l'affichage et n'autorise
  aucune exécution. En cas de lecture invalide, rester fermé par défaut.
- Ne pas retirer la vérification d'intégrité du binaire embarqué ni la CSP
  des webviews pour contourner un problème de lancement.

## Développement et validation

- Node >= 22.12, pnpm épinglé par `packageManager` dans `package.json`.
- Installation : `pnpm install --frozen-lockfile`.
- Vérification : `pnpm check` (Biome, types des sources et tests, Vitest).
- Compilation : `pnpm build` ; CLI : `node packages/cli/dist/main.js --help`.
- TypeScript strict et style Biome ; réutiliser `reason()`, `CodedError`,
  `capOutput`, `errorInfo` et les utilitaires existants.
- Nouveau code de raison : `REASON_CODES`, catalogues fr/en, tests d'exhaustivité.
  Nouvel événement : validation et classification de l'export HTML.
- Nouveau paquet : références TypeScript, paths de tests, alias Vitest,
  dépendances workspace et lockfile cohérents avec les tests du workspace.
- Conserver les peers requis des SDK et leurs versions exactes si instables.
- Les modèles de l'application sont découverts au runtime, jamais codés en dur.
- Tester les comportements modifiés, refus et erreurs compris. Ne pas ajouter
  de tests artificiels pour une simple modification documentaire.
- Ne pas lancer automatiquement `pnpm test:contract` : appels réels facturés.
  Les contrats OpenCode locaux sont optionnels et nécessitent `OPENCODE_BIN`.
  Distinguer tests passés, échoués, ignorés et non exécutés.

Dans l'environnement cloud préparé, suivre les instructions de démarrage
enregistrées pour activer pnpm et, si nécessaire, exécuter les tests sous le
reaper local : le PID 1 du conteneur peut laisser des zombies qui faussent les
tests d'arrêt des descendants. Ne pas modifier les assertions pour les faire passer.
Les tâches cloud sont déjà isolées : utiliser le checkout existant, sans créer
de worktree sauf demande explicite.

## Livraison

Pipeline permanente validée par l'utilisateur le 30 octobre 2026 :

1. Travailler sur une branche temporaire. Contrôler le code, les types et les
   tests, puis compiler localement les VSIX `linux-x64` et `win32-x64`.
   `pnpm release:local` automatise cette préparation sans GitHub Actions.
2. Vérifier les archives, la version et la plateforme du manifeste, les binaires
   embarqués et leurs empreintes. Fournir les deux VSIX et leurs SHA-256, les
   sources exactes, le patch, les notes et les instructions de publication.
3. Committer avec l'identité `tomtimlt`, pousser la branche temporaire et créer
   un brouillon GitHub visant le commit exact des sources compilées. Le tag
   `vX.Y.Z` doit correspondre à `extension.manifest.json`. Préserver les tags
   existants ; laisser la publication finale à l'utilisateur.
4. Déposer la livraison en accès privé dans le dossier **Warband** à la racine
   du Google Drive connecté. Réutiliser le dossier vérifié ; ranger les versions
   sans écraser les précédentes. L'utilisateur autorise durablement cet envoi,
   y compris sources, patch, journaux de construction et artefacts du projet.
5. Si le connecteur refuse les gros fichiers (100 Mio actuellement), découper
   l'archive en parties de 90 Mio, joindre les assembleurs Windows/Linux et le
   SHA-256 du ZIP complet. Tester la reconstitution locale, puis relire les
   métadonnées Drive pour vérifier présence, tailles et emplacement privé.
6. Donner les liens du dossier Drive et du brouillon. L'utilisateur récupère les
   fichiers, ajoute les deux VSIX et leurs deux SHA-256 au brouillon, puis publie.

Cette autorisation de commit, push sur branche temporaire, création de brouillon
et livraison privée Drive reste valable pour les prochaines versions de ce
projet, sauf instruction contraire. Ne pas redemander cette autorisation déjà
donnée. GitHub Actions reste facultatif ; un échec du workflow ne remplace pas
la livraison locale. Distinguer tests logiciels, vérification des paquets et
essais manuels natifs. Annoncer un brouillon comme brouillon, une release publiée
seulement après vérification de ses fichiers disponibles.

Préserver les changements de l'utilisateur. Pas de refactoring hors périmètre,
de secret ou de binaire ajouté au dépôt. Lire les fichiers avant modification.
Une décision structurante mérite un ADR ; un détail local réversible non.
La pipeline ci-dessus autorise les commits et push de livraison ; toute autre
publication ou PR demande une instruction explicite. Un sous-agent ne committe
ni ne pousse. Messages de commit en français, sur la
branche de la session. Rapporter ce qui a changé, les vérifications exécutées
et leurs limites, sans présenter une lecture comme une validation fonctionnelle.
