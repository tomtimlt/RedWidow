# Extension VS Code : installation et usage

Extension privée (ADR 0004, lots E3 + E4) : chat d'agent dans VS Code, avec une politique d’approbation et des cartes pour les demandes qui nécessitent une réponse. Le Bypass suspend ces demandes pendant sa durée. Pas de Marketplace : le `.vsix` s'installe à la main. Le workflow de release construit les cibles `win32-x64` et `linux-x64`.

## Construire et installer

```
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @warband/vscode package        # cible win32-x64 par défaut
code --install-extension packages/vscode/warband-0.3.29-win32-x64.vsix
```

Raccourci : `pnpm maj` (ou `node scripts/update.mjs`). Il enchaîne `git pull --ff-only`, `pnpm install`, `pnpm build`, l'empaquetage et `code --install-extension --force`. Options : `--check` (ajoute `pnpm check`), `--no-install`, `--dry-run`, `--target=…`. Recharger ensuite la fenêtre VS Code.

Le `.vsix` fait environ 117 Mio (il embarque le binaire `claude` du SDK, 257 Mio décompressé, vérifié par empreinte SHA-256 au démarrage du moteur). Il est ignoré par git.

## Publier une release

Pousser un tag `vX.Y.Z` égal à la version de `packages/vscode/extension.manifest.json` déclenche `.github/workflows/release.yml` : `pnpm check`, `pnpm build`, empaquetage `linux-x64` puis `win32-x64`, empreintes SHA-256, puis création de la release GitHub avec les deux `.vsix`. Un tag qui ne correspond pas à la version du manifeste fait échouer le workflow avant toute publication. Relancer le workflow sur un tag déjà publié remplace les fichiers de la release (`--clobber`). Le job demande `contents: write` ; le dépôt est extrait sans identifiants persistants et le jeton n'est lu que par l'étape de publication.

## Parcours de travail

**Choisir un projet → associer ses conteneurs → travailler avec l’agent → approuver les actions nécessaires → consulter les résultats et les traces.**

Le cockpit gère les conteneurs et leurs associations. La page Projet des réglages permet de choisir un projet existant avec
**Activer**, ou de le créer en donnant un nom puis un dossier via le dialogue
natif. Le changement de projet est bloqué pendant un tour actif. Le chat
conduit les échanges. Monitor affiche
les exécutions et Kill chain les trouvailles. Le conteneur principal affiché
ne remplace pas la sélection de cible autorisée par le moteur.

Les réglages proposent cinq pages : **Projet**, **Conteneurs**, **Kill chain**,
**Atlas** et **Contrôle système**. Les rubriques sans fonction disponible ont
été retirées de la navigation.

La page **Projet** affiche aussi le résumé réel du projet actif. On peut le
modifier puis choisir **Enregistrer le résumé** ; la saisie est limitée à
8 Kio, le brouillon est conservé pendant la navigation, et la page signale la
réussite ou l’erreur d’écriture. Le contenu est masqué à l’écriture par les
helpers du cœur. Les notes ne sont plus injectées automatiquement dans les conversations ; elles ne remplacent
pas l’historique.

## Premier run

1. Ouvrir un **dossier approuvé** (l'extension est inerte dans un espace non approuvé ou virtuel).
2. Palette de commandes : **Warband : définir le jeton**. Choisir « Jeton d'abonnement » (`claude setup-token`) ou « Clé API », puis coller le jeton (saisie masquée). Il est stocké dans le stockage sécurisé de VS Code, transmis uniquement à l'environnement du processus moteur, jamais écrit dans les réglages, un message d'erreur ou un journal. « Warband : effacer le jeton » le supprime. Le jeton est appliqué tout de suite, sans redémarrer VS Code : le moteur inactif est remplacé (la conversation reprend la même session), et pendant un tour le nouveau jeton sert au message suivant. **Sans jeton, le chat est grisé** (« Aucun fournisseur n'a été ajouté ») avec un bouton « Ajouter un fournisseur » qui ouvre la saisie du jeton ; aucun message ne part tant qu'aucun jeton n'est défini.
3. **Warband : ouvrir le chat** (ou l'icône Warband de la barre d'activité). Saisir une consigne, `Ctrl+Entrée` ou « Envoyer ».
4. Le fil affiche le texte de l'agent en Markdown sûr (paragraphes, code en ligne et en bloc avec bouton Copier, gras, italique, listes, titres ; liens et HTML restent du texte), et une ligne compacte par appel d'outil (icône d'état, nom lisible, résumé) dont les détails (entrée et sortie, plafonds selon l’outil ; sorties Kali normalisées jusqu’à 12 000 caractères) sont repliés ; un indicateur signale que l'agent travaille. **Stop** annule le run ; le message suivant relance un moteur en reprenant la session. **Nouvelle conversation** repart de zéro.

## Interface du chat (refonte 0.3.26, docs/design-interface-2026.md)

- **Responsive** : la mise en page suit la largeur de la vue (container queries sur `body`) : compact < 360 px (boutons en icône, pastille de modèle tronquée), standard 360-599 px, large ≥ 600 px (colonne de lecture centrée, 720 px). Aucun élément ne déborde.
- **Composer** : la zone de saisie porte une barre d'outils avec la **pastille de modèle** (liste ARIA avec filtre, ↑/↓/Début/Fin/Entrée/Échap, « Actualiser la liste » en pied), le bouton **Configurer** (curseur d'effort à crans cliquables, bouton Auto, fournisseur et configuration du chat) et Envoyer/Stop. Les popovers se placent en JavaScript (au-dessus de l'ancre, dessous si la place manque, jamais hors de l'écran) ; piège de focus, Échap et clic extérieur ferment.
- **Présentation** : surfaces du thème VS Code, message utilisateur légèrement teinté, prose de l’agent intégrée au fil et appels d’outils repliables avec petites icônes SVG locales. Les longues sorties dépliées défilent dans une zone bornée.
- **Configurer** : deux colonnes à partir de 420 px, une en dessous ; slider d’effort glissable et accessible au clavier, Apprentissage et Bypass regroupés. Les fonctions futures ne sont plus affichées comme des réglages disponibles. L’avertissement et la confirmation native du Bypass sont conservés.
- **Mouvement réduit, contraste élevé, couleurs forcées** : transitions courtes et désactivées dans ces modes ; indicateur d’activité SVG animé pendant le travail, statique dans ces modes.
- **Prévisualiser** : `pnpm exec vitest run packages/vscode/test/preview.test.ts` génère dans `packages/vscode/preview/` (ignoré par git) les pages du chat (9 états), du cockpit et de quatre pages des réglages (`studio-project`, `studio-containers`, `studio-atlas`, `studio-killchain`), en 3 thèmes, avec le HTML, le CSS, le JS et la CSP réels. Puis `node packages/vscode/scripts/preview-shots.mjs` (Edge ; `EDGE_BIN` pour un autre Chromium, par exemple `EDGE_BIN="C:\\...\\msedge.exe"` ou un binaire lancé avec `--no-sandbox` en conteneur) prend les captures dans `preview/shots/` : par défaut accueil (`empty`), `running`, `approval`, `model` et `config` (popovers ouverts), `cockpit` et les quatre pages `studio-*`, à 280, 360, 520 et 900 px, en sombre, clair et contraste élevé (`--states all`, `--widths`, `--themes`, `--out` pour changer). Il signale toute violation CSP et tout débordement horizontal (code de sortie 1). Les pages sont servies par un petit serveur HTTP local (127.0.0.1, port éphémère, lecture seule, arrêté en fin de script) : les masques de `icon.svg` (logo) ne se chargent pas en `file://` (CORS). Seule la source `file:` de la CSP de prévisualisation est remplacée à la volée par l'origine du serveur ; la CSP des pages de l'extension n'est pas modifiée. Ouvertes directement en `file://`, les pages s'affichent sans le logo d'accueil. L'iframe prend la hauteur de la fenêtre pour que le composer soit entier. Durée : environ 6 minutes pour la série par défaut.

## Modèle et effort

Dans la barre d'outils du composer : une **pastille de modèle** et, sous « Configurer », un **curseur d'effort** à 6 crans (Low, Medium, High, Extra, Max, Ultracode ; Extra correspond à l'effort `xhigh` du SDK). **Par défaut le curseur est sur « Auto »** : aucun effort n'est transmis et le modèle garde son comportement par défaut, tant que vous n'avez pas touché au curseur ; le bouton « Auto » y revient. Le libellé du cran courant est affiché, l'infobulle décrit l'effet (Low : rapide et économe ; Max : réflexion la plus poussée, plus lent et plus coûteux), et les crans non pris en charge par le modèle choisi sont grisés (un niveau non pris en charge est ramené au plus proche niveau permis, avec un avis). Le curseur se pilote au clavier (flèches) et expose son libellé aux lecteurs d'écran.

- La **liste des modèles** vient du SDK au runtime (aucun identifiant n'est codé en dur) : un moteur de sondage éphémère, lancé à l'ouverture du chat **sans aucune consigne** (donc sans tour, sans outil ni inférence), interroge `supportedModels()` puis s'arrête. Elle est mise en cache (`globalState`) par version du SDK ; « Actualiser la liste » la recharge. Si elle est indisponible, le popover propose une **saisie libre** (identifiant sans espace, 200 caractères maximum).
- Les choix s'appliquent au **message suivant** (gelés pendant un tour) : le moteur inactif est remplacé par un nouveau qui reprend la même session (`resume`), sans perdre le fil. Ils sont persistés dans `globalState` (jamais dans l'espace de travail). Le modèle par défaut reste le réglage machine `warband.model`.
- L'extension **revalide** tout choix venu de la webview : identifiant de la liste (ou bien formé en saisie libre), niveau d'effort dans l'énumération.
- **Ultracode** (fournisseur Claude seulement, grisé si le modèle ne supporte pas `max`) est ici un **préréglage honnête** : effort `max` + plafonds de tours et de dépense issus des réglages `warband.ultracode.maxTurns` et `warband.ultracode.maxBudgetUsd` (0 : pas de plafond ; `warband.ultracode.maxTurns` remplace `warband.maxTurns` quand Ultracode est choisi). Il ne change PAS ce que raisonne le modèle (même capacité que Max) ; l'infobulle affiche les valeurs en vigueur. Le SDK connaît un vrai « ultracode » (réglage de session `ultracode` + mot-clé de prompt, qui orchestrent l'outil `Workflow` et des sous-agents) : il n'est volontairement pas branché, voir la décision en attente dans le rapport (ADR 0005, Q1).

## Historique des conversations

Bouton **Historique** de l’en-tête : filtre par projet (dont « Tous les projets » et conversations sans projet), puis liste des conversations (titre = première consigne tronquée, date, nombre d'outils, fournisseur et modèle). Actions : **ouvrir** (le fil est reconstruit depuis les journaux, en **lecture seule** : aucune carte d'approbation, saisie désactivée), **Reprendre** (nouveau message avec `resume` de la session, sous la politique **actuelle**), **Renommer**, **Supprimer**, **Tout effacer** (confirmation modale native).

- Les journaux de l'extension sont écrits **hors du dépôt**, dans le stockage de l'extension (`storageUri/runs/<runId>.jsonl`), jamais dans `.warband/runs/` ; l'index léger est dans `workspaceState`. Le moteur consigne chaque consigne de l'utilisateur dans un événement `user.message`.
- Le lien au projet est fixé à la création. L’envoi et la reprise sont bloqués si
  le projet actif diffère, y compris entre « sans projet » et un projet actif.
  La lecture reste possible. Aucun projet n’est activé automatiquement ; une
  erreur de lecture des projets bloque le lancement plutôt que de changer le contexte.
  Pour reprendre une conversation ancienne, revenir d’abord à son projet ;
  son lien enregistré n’est pas réécrit.
- Rétention : 100 conversations ou 200 Mio ; les plus anciennes sont purgées (la conversation en cours est conservée).
- Un journal relu est une **entrée non fiable** : nom de fichier formé seulement d'un `runId` UUID validé, 16 Mio et 50 000 lignes au plus (lignes de plus de 1 Mo ignorées), `validateEvent` sur chaque ligne (invalides ignorées et comptées dans la bannière), événements d'un autre run ignorés, texte passé par `stripControl`, rendu par les mêmes chemins sûrs que le chat.

## Cartes d'approbation

Chaque demande de la gate d'approbation devient une carte : outil, entrée (neutralisée : caractères de contrôle, séquences ESC et contrôles bidirectionnels retirés), raison de la politique. Boutons :

- **Autoriser une fois** ;
- **Refuser** ;
- **Toujours** : proposé seulement si le verdict est mémorisable (prédicat `isRememberable` du cœur : jamais pour un `deny`, un chemin sensible ou hors espace de travail, un accès hôte ou un danger shell). Exige une **confirmation modale native** de VS Code, hors webview. Effet actuel : autorisation **pour la durée de la conversation**. La persistance dans la politique utilisateur sur disque, comme `warband run` le fait, n'est pas encore branchée.

Hors Bypass, la gate applique la politique et la webview relaie les réponses.
Le **Bypass** (ADR 0017) autorise temporairement les verdicts `ask` et `deny`,
y compris les refus durs, sans demande ni mémorisation. Sa durée par défaut
est de 2 h, plafonnée à 4 h. Le verdict initial reste dans le journal. Il
exige un Asker et reste sans effet en apprentissage ou en CLI non interactive.
Il ne crée pas d’outils supplémentaires et ne supprime pas les validations
qui existent hors de la gate.

## Réglages (`Fichier > Préférences > Paramètres`, section Warband)

Tous en scope **machine** : la valeur posée dans `.vscode/settings.json` d'un dépôt est ignorée (le code relit uniquement la valeur utilisateur ou le défaut).

| Réglage | Rôle |
|---|---|
| `warband.model` | Modèle, texte libre. Vide : défaut du SDK. |
| `warband.maxTurns` | Plafond de tours (0 : aucun). |
| `warband.ultracode.maxTurns` | Plafond de tours du préréglage Ultracode (0 : aucun). |
| `warband.ultracode.maxBudgetUsd` | Plafond de dépense (USD) du préréglage Ultracode (0 : aucun). |

Les réglages sont lus au démarrage du moteur : pour les appliquer, **Nouvelle conversation**.

## Ancien bac à sable

Le bac à sable supplémentaire a été abandonné le 22 octobre 2026 (ADR 0003).
Les options `--sandbox*` et réglages `warband.sandbox.*` n’existent plus.
Les conteneurs Exegol/Kali associés au projet constituent le cadre de travail.
L’ADR conserve la décision historique ; ses anciennes commandes ne sont pas
une procédure d’installation actuelle.

## Limites connues

- La validation Windows historique du moteur (W-L6) ne valide pas automatiquement les ajouts récents de l’extension. Un essai complet de cette version dans VS Code reste à distinguer des tests automatisés et prévisualisations headless ; remote, lecteur d’écran et profilage restent à vérifier.
- Claude seul (pas d'OpenCode) ; Markdown limité (tableaux pris en charge, liens non cliquables, pas d’images).
- Kill chain affiche le graphe des trouvailles, avec minimap ; ce graphe est distinct du graphe causal des événements exporté par la CLI. Pas de commande d’approbation de la politique du dépôt (la politique du dépôt n'est appliquée qu'après approbation de son empreinte, comme dans la CLI ; sans approbation elle est inerte et un avertissement est affiché).
- « Toujours » ne persiste pas sur disque (voir plus haut).
- Une seule demande de tour à la fois ; l'historique affiché est limité aux 300 derniers éléments.
- Les journaux de l'extension sont dans le stockage de VS Code (l'historique ne survit pas à sa suppression) ; la CLI garde `.warband/runs/`.
- Réglages en scope machine : comportement en remote (SSH/WSL) à valider.
- Les gardes de changement de projet protègent le parcours UI, sans verrouiller
  les écritures externes dans les fichiers de projet pendant un tour.

## Ce qui a été vérifié

Tests vitest : logique (cartes, mapping des réponses, validation des messages de la webview, réglages, état du chat, session avec contrôleur factice), HTML généré (CSP stricte, nonce, aucun script inline), script de la webview (aucun `innerHTML`/`eval`), manifeste (scope machine, espace non approuvé). Ces tests ne démontrent pas à eux seuls le parcours complet dans l’hôte VS Code. Pour les résultats de la version en cours, voir [l’état du projet](etat-du-projet.md).

Non vérifié en vrai : installation `code --install-extension`, rendu de la webview, saisie masquée du jeton, `fork` sous Electron (`ELECTRON_RUN_AS_NODE`), run Claude complet depuis l'extension, parcours Exegol/Kali avec Docker actif, comportement en espace non approuvé.

## Préparation automatique des conteneurs Kali (0.3.23)

Les actions **Créer**, **Démarrer** et **Lier** du cockpit vérifient maintenant
`python3`, `kali-server-mcp` et la santé du serveur. Les dépendances manquantes
sont installées dans le conteneur s’il s’agit d’une image Kali avec APT.
Une notification indique la progression ; l’installation initiale nécessite
l’accès aux dépôts configurés dans l’image et peut prendre plusieurs minutes.
Aucune mise à jour APT ni réinstallation n’est lancée si les binaires sont déjà
présents. Les dépendances restent installées après arrêt/redémarrage du même
conteneur. Chaque nouveau conteneur est préparé séparément.

En cas d’échec, le conteneur est conservé et les détails sont dans la sortie
**Warband**. Corriger l’accès aux dépôts ou l’image, puis utiliser Démarrer ou
Lier pour retenter. Le démarrage depuis Docker Desktop seul n’exécute pas cette
préparation du cockpit. Les appels de l’agent n’installent aucun paquet.
Le serveur reste dans le conteneur, sur `127.0.0.1:5000`, sans port publié.
Les commandes sont exécutées depuis `/workspace`, même si le lanceur du paquet
se place initialement dans `/usr/share/mcp-kali-server`.

L’installation automatique utilise `--no-install-recommends` : elle prépare
le serveur et ses dépendances nécessaires, sans ajouter toute la suite
d’outils Kali recommandée par le paquet. Les outils de mission disponibles
restent ceux installés dans l’image choisie.

## Graphe et sorties Kali (0.3.24)

La Kill chain utilise des nœuds circulaires avec une icône par type, un statut,
un libellé sur deux lignes et des métadonnées secondaires. Le libellé complet
reste accessible au survol et au clavier. Les arêtes représentent uniquement
les relations enregistrées entre trouvailles.

Le panneau ouvert s’actualise lorsque les trouvailles ou le projet actif
changent. Une mise à jour du même projet conserve le zoom et le déplacement ;
changer de projet réinitialise la caméra. La minimap et le bouton Ajuster
restent disponibles. Une erreur de lecture affiche un message et conserve
le dernier graphe au lieu de l’effacer.

Les résultats de commande Kali sont décodés avant leur affichage : sortie
standard lisible, sortie d’erreur séparée, code d’échec, dépassement de délai
et résultats partiels signalés. Les séquences de terminal sont neutralisées.
Le chat, le Monitor et la relecture de l’historique partagent cette présentation.
Le plafond d’affichage Kali est de 12 000 caractères, avec indicateur de
troncature ; le journal conserve l’événement brut. Si le transport contient
déjà un JSON incomplet, l’interface affiche ce texte incomplet sans inventer
la partie manquante.

## Conteneurs et réglages — 0.3.26

La gestion des conteneurs affiche une synthèse système compacte, le contexte
lié et des lignes à détails dépliables. **Nouveau conteneur** ouvre le
formulaire ; le refermer ou actualiser conserve son brouillon. L’absence
d’Exegol est neutre pour un environnement Kali. Les commandes existantes
Démarrer, Arrêter, Lier et Terminal gardent leurs validations natives.
La page Conteneurs des réglages propose **Gérer les conteneurs** pour ouvrir
cette vue. Les cinq rubriques des réglages utilisent les mêmes icônes SVG,
contrôles et couleurs que le chat.

La 0.3.26 ajoute la police Inter embarquée, Envoyer et voyants ronds, et un
slider d’effort natif. La page Projet distingue le projet actif, le choix d’un
projet existant et la création dans deux panneaux séparés ; le brouillon est
conservé quand on change de panneau. Le projet actif reste indiqué dans la
navigation des réglages.

## Isolation des conversations — 0.3.27

Une nouvelle conversation ne reçoit plus le résumé du projet. L’outil remember
n’est plus exposé dans l’extension, et la mémoire automatique du SDK est
verrouillée à désactivée. Les événements tardifs d’un moteur abandonné ne
peuvent pas rétablir son identifiant de session après Nouvelle conversation.
Les notes et l’historique existants sont conservés. Reprendre explicitement
une conversation ou changer de modèle dans cette conversation conserve son
contexte. Citer un terminal avec # partage sa sortie dans la conversation
courante ; les fichiers de projet restent accessibles selon les permissions.

## Activité et famille de conteneur — 0.3.28

L’indicateur de réflexion utilise un anneau animé ; sa rangée ne peut plus
rétrécir au point de couper l’icône. Animation suspendue pendant une approbation
ou quand la vue est masquée ; mouvement réduit et contraste élevé respectés.

À chaque consigne, le moteur joint au modèle les noms réels, familles et états
des conteneurs liés vérifiés dans Docker. Exegol se pilote avec mcp__exegol__exec,
Kali avec mcp__kali__*. Une liste indisponible est signalée explicitement.
Ce contexte courant n’inclut aucune ancienne conversation. L’annotation ne
modifie pas les @/# utilisés pour autoriser la cible et n’est pas ajoutée aux
messages utilisateur du journal. Les contrôles au moment de l’appel restent
décisifs si l’état du conteneur change.

## Titres des trouvailles — 0.3.29

Le champ label de note est un titre court, limité à 200 caractères après
suppression des espaces de bord. La limite figure dans le schéma transmis au
modèle. Un titre trop long ou vide produit une erreur dédiée proposant de
réessayer avec un titre court ; il ne signale plus un project.json invalide.
Aucune troncature silencieuse : les détails restent dans leur fichier de
résultats, référencé depuis le titre. Un rejet n’altère aucune trouvaille.
