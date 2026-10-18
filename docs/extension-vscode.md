# Extension VS Code : installation et usage

Extension privée (ADR 0004, lots E3 + E4) : chat d'agent dans VS Code, avec une carte d'approbation pour chaque outil demandé. Pas de Marketplace : le `.vsix` s'installe à la main. Cible construite et testée à la construction : `win32-x64`.

## Construire et installer

```
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @warband/vscode package        # cible win32-x64 par défaut
code --install-extension packages/vscode/warband-0.3.0-win32-x64.vsix
```

Raccourci : `pnpm maj` (ou `node scripts/update.mjs`). Il enchaîne `git pull --ff-only`, `pnpm install`, `pnpm build`, l'empaquetage et `code --install-extension --force`. Options : `--check` (ajoute `pnpm check`), `--no-install`, `--dry-run`, `--target=…`. Recharger ensuite la fenêtre VS Code.

Le `.vsix` fait environ 117 Mio (il embarque le binaire `claude` du SDK, 257 Mio décompressé, vérifié par empreinte SHA-256 au démarrage du moteur). Il est ignoré par git.

## Premier run

1. Ouvrir un **dossier approuvé** (l'extension est inerte dans un espace non approuvé ou virtuel).
2. Palette de commandes : **Warband : définir le jeton**. Choisir « Jeton d'abonnement » (`claude setup-token`) ou « Clé API », puis coller le jeton (saisie masquée). Il est stocké dans le stockage sécurisé de VS Code, transmis uniquement à l'environnement du processus moteur, jamais écrit dans les réglages, un message d'erreur ou un journal. « Warband : effacer le jeton » le supprime. Sans jeton, le binaire utilise ses propres identifiants (mode `auto`).
3. **Warband : ouvrir le chat** (ou l'icône Warband de la barre d'activité). Saisir une consigne, `Ctrl+Entrée` ou « Envoyer ».
4. Le fil affiche le texte de l'agent en Markdown sûr (paragraphes, code en ligne et en bloc avec bouton Copier, gras, italique, listes, titres ; liens et HTML restent du texte), et une ligne compacte par appel d'outil (icône d'état, nom lisible, résumé) dont les détails (entrée et sortie, plafonnés à 2000 caractères) sont repliés ; un indicateur signale que l'agent travaille. **Stop** annule le run ; le message suivant relance un moteur en reprenant la session. **Nouvelle conversation** repart de zéro.

## Interface du chat (design « néon », docs/design-chat-ui.md)

- **Responsive** : la mise en page suit la largeur de la vue (container queries sur `body`) : compact < 360 px (boutons en icône, pastille de modèle tronquée), standard 360-599 px, large ≥ 600 px (colonne centrée de 820 px). Aucun élément ne déborde.
- **Composer** : la zone de saisie porte une barre d'outils avec la **pastille de modèle** (liste ARIA avec filtre, ↑/↓/Début/Fin/Entrée/Échap, « Actualiser la liste » en pied), le bouton **Configurer** (curseur d'effort à crans cliquables, bouton Auto, fournisseur, bac à sable et réseau en lecture seule) et Envoyer/Stop. Les popovers se placent en JavaScript (au-dessus de l'ancre, dessous si la place manque, jamais hors de l'écran) ; piège de focus, Échap et clic extérieur ferment.
- **Effets** (tous en `transform`/`opacity`, liste fermée) : halo au focus du composer, balayage lumineux et « pop » de la pastille quand le modèle accepté change, indicateur « thinking » (spinner braille, curseur clignotant, scanline discrète) pendant un run, entrée des cartes d'approbation. Rien ne tourne sans run actif ; tout est figé quand la vue est cachée ou pendant l'attente d'une approbation.
- **Mouvement réduit, contraste élevé, couleurs forcées** : tous les effets sont coupés (le spinner devient « … »). `workbench.reduceMotion` : le média `prefers-reduced-motion` honoré par la webview suffit, l'extension ne lit pas ce réglage (aucun champ ajouté à la vue).
- **Prévisualiser** : `pnpm exec vitest run packages/vscode/test/preview.test.ts` génère les pages (7 états, 3 thèmes, CSP réelle) dans `packages/vscode/preview/` ; `node packages/vscode/scripts/preview-shots.mjs` (Edge, `EDGE_BIN` sinon chemin par défaut) prend les captures à 280, 360, 520 et 900 px (iframe de la largeur voulue) et signale violation CSP et débordement horizontal.

## Modèle et effort

Dans la barre d'outils du composer : une **pastille de modèle** et, sous « Configurer », un **curseur d'effort** à 6 crans (Low, Medium, High, Extra, Max, Ultracode ; Extra correspond à l'effort `xhigh` du SDK). **Par défaut le curseur est sur « Auto »** : aucun effort n'est transmis et le modèle garde son comportement par défaut, tant que vous n'avez pas touché au curseur ; le bouton « Auto » y revient. Le libellé du cran courant est affiché, l'infobulle décrit l'effet (Low : rapide et économe ; Max : réflexion la plus poussée, plus lent et plus coûteux), et les crans non pris en charge par le modèle choisi sont grisés (un niveau non pris en charge est ramené au plus proche niveau permis, avec un avis). Le curseur se pilote au clavier (flèches) et expose son libellé aux lecteurs d'écran.

- La **liste des modèles** vient du SDK au runtime (aucun identifiant n'est codé en dur) : un moteur de sondage éphémère, lancé à l'ouverture du chat **sans aucune consigne** (donc sans tour, sans outil ni inférence), interroge `supportedModels()` puis s'arrête. Elle est mise en cache (`globalState`) par version du SDK ; « Actualiser la liste » la recharge. Si elle est indisponible, le popover propose une **saisie libre** (identifiant sans espace, 200 caractères maximum).
- Les choix s'appliquent au **message suivant** (gelés pendant un tour) : le moteur inactif est remplacé par un nouveau qui reprend la même session (`resume`), sans perdre le fil. Ils sont persistés dans `globalState` (jamais dans l'espace de travail). Le modèle par défaut reste le réglage machine `warband.model`.
- L'extension **revalide** tout choix venu de la webview : identifiant de la liste (ou bien formé en saisie libre), niveau d'effort dans l'énumération.
- **Ultracode** (fournisseur Claude seulement, grisé si le modèle ne supporte pas `max`) est ici un **préréglage honnête** : effort `max` + plafonds de tours et de dépense issus des réglages `warband.ultracode.maxTurns` et `warband.ultracode.maxBudgetUsd` (0 : pas de plafond ; `warband.ultracode.maxTurns` remplace `warband.maxTurns` quand Ultracode est choisi). Il ne change PAS ce que raisonne le modèle (même capacité que Max) ; l'infobulle affiche les valeurs en vigueur. Le SDK connaît un vrai « ultracode » (réglage de session `ultracode` + mot-clé de prompt, qui orchestrent l'outil `Workflow` et des sous-agents) : il n'est volontairement pas branché, voir la décision en attente dans le rapport (ADR 0005, Q1).

## Historique des conversations

Bouton **Historique** de l'en-tête : liste des conversations (titre = première consigne tronquée, date, nombre d'outils, fournisseur et modèle). Actions : **ouvrir** (le fil est reconstruit depuis les journaux, en **lecture seule** : aucune carte d'approbation, saisie désactivée), **Reprendre** (nouveau message avec `resume` de la session, sous la politique **actuelle**), **Renommer**, **Supprimer**, **Tout effacer** (confirmation modale native).

- Les journaux de l'extension sont écrits **hors du dépôt**, dans le stockage de l'extension (`storageUri/runs/<runId>.jsonl`), jamais dans `.warband/runs/` ; l'index léger est dans `workspaceState`. Le moteur consigne chaque consigne de l'utilisateur dans un événement `user.message`.
- Rétention : 100 conversations ou 200 Mio ; les plus anciennes sont purgées (la conversation en cours est conservée).
- Un journal relu est une **entrée non fiable** : nom de fichier formé seulement d'un `runId` UUID validé, 16 Mio et 50 000 lignes au plus (lignes de plus de 1 Mo ignorées), `validateEvent` sur chaque ligne (invalides ignorées et comptées dans la bannière), événements d'un autre run ignorés, texte passé par `stripControl`, rendu par les mêmes chemins sûrs que le chat.

## Cartes d'approbation

Chaque demande de la gate d'approbation devient une carte : outil, entrée (neutralisée : caractères de contrôle, séquences ESC et contrôles bidirectionnels retirés), raison de la politique. Boutons :

- **Autoriser une fois** ;
- **Refuser** ;
- **Toujours** : proposé seulement si le verdict est mémorisable (prédicat `isRememberable` du cœur : jamais pour un `deny`, un chemin sensible ou hors espace de travail, un accès hôte ou un danger shell). Exige une **confirmation modale native** de VS Code, hors webview. Effet actuel : autorisation **pour la durée de la conversation** (pour le bac à sable, c'est la sémantique voulue : conteneur éphémère). La persistance dans la politique utilisateur sur disque, comme `warband run` le fait, n'est pas encore branchée.

Il n'y a ni « tout autoriser » ni mode autonome. La gate reste l'unique juge : la webview ne fait que relayer le choix.

## Réglages (`Fichier > Préférences > Paramètres`, section Warband)

Tous en scope **machine** : la valeur posée dans `.vscode/settings.json` d'un dépôt est ignorée (le code relit uniquement la valeur utilisateur ou le défaut).

| Réglage | Rôle |
|---|---|
| `warband.model` | Modèle, texte libre. Vide : défaut du SDK. |
| `warband.maxTurns` | Plafond de tours (0 : aucun). |
| `warband.ultracode.maxTurns` | Plafond de tours du préréglage Ultracode (0 : aucun). |
| `warband.ultracode.maxBudgetUsd` | Plafond de dépense (USD) du préréglage Ultracode (0 : aucun). |
| `warband.sandbox.enabled` | Active le bac à sable Docker (`mcp__sandbox__exec`). |
| `warband.sandbox.image` | Image **locale** (obligatoire si activé ; jamais téléchargée). |
| `warband.sandbox.timeoutSec` | Délai par exécution, 1 à 1800 s (défaut 600). |

Les réglages sont lus au démarrage du moteur : pour les appliquer, **Nouvelle conversation**.

## Tester le bac à sable

```
docker pull alpine:3.20
```

Puis activer `warband.sandbox.enabled`, poser `warband.sandbox.image` à `alpine:3.20`, ouvrir une nouvelle conversation et demander par exemple « exécute `uname -a` dans le bac à sable ». Une carte `mcp__sandbox__exec` apparaît. Le conteneur (réseau coupé, utilisateur non privilégié) est créé au démarrage du run et supprimé à la fin, à l'annulation et sur erreur. Docker Desktop doit être démarré.

## Limites connues

- **Non vérifié dans un VS Code réel** (voir ci-dessous) : le rendu est contrôlé dans Edge headless ; ni profilage (Performance, Paint flashing), ni lecteur d'écran, ni navigation clavier complète n'ont été faits ; cible `linux-x64` non construite sur ce poste.
- Claude seul (pas d'OpenCode) ; Markdown limité (pas de tableaux, liens non cliquables, pas d'images).
- Pas de graphe en direct (E5), pas de commande d'approbation de la politique du dépôt (la politique du dépôt n'est appliquée qu'après approbation de son empreinte, comme dans la CLI ; sans approbation elle est inerte et un avertissement est affiché).
- « Toujours » ne persiste pas sur disque (voir plus haut).
- Une seule demande de tour à la fois ; l'historique affiché est limité aux 300 derniers éléments.
- Les journaux de l'extension sont dans le stockage de VS Code (l'historique ne survit pas à sa suppression) ; la CLI garde `.warband/runs/`.
- Réglages en scope machine : comportement en remote (SSH/WSL) à valider.

## Ce qui a été vérifié

Tests vitest : logique (cartes, mapping des réponses, validation des messages de la webview, réglages, état du chat, session avec contrôleur factice), HTML généré (CSP stricte, nonce, aucun script inline), script de la webview (aucun `innerHTML`/`eval`), manifeste (scope machine, espace non approuvé). Le `.vsix` se construit ; le moteur empaqueté démarre sous Node et atteint la création du bac à sable.

Non vérifié en vrai : installation `code --install-extension`, rendu de la webview, saisie masquée du jeton, `fork` sous Electron (`ELECTRON_RUN_AS_NODE`), run Claude complet depuis l'extension, bac à sable avec un démon Docker actif, comportement en espace non approuvé.
