# Extension VS Code : installation et usage

Extension privée (ADR 0004, lots E3 + E4) : chat d'agent dans VS Code, avec une politique d’approbation et des cartes pour les demandes qui nécessitent une réponse. Le Bypass suspend ces demandes pendant sa durée. Pas de Marketplace : le `.vsix` s'installe à la main. Le workflow de release construit les cibles `win32-x64` et `linux-x64`.

## Construire et installer

```
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @warband/vscode package        # cible win32-x64 par défaut
code --install-extension packages/vscode/warband-0.3.32-win32-x64.vsix
```

Raccourci : `pnpm maj` (ou `node scripts/update.mjs`). Il enchaîne `git pull --ff-only`, `pnpm install`, `pnpm build`, l'empaquetage et `code --install-extension --force`. Options : `--check` (ajoute `pnpm check`), `--no-install`, `--dry-run`, `--target=…`. Recharger ensuite la fenêtre VS Code.

Le `.vsix` embarque les binaires Claude du SDK et OpenCode 1.19.0 pour sa cible. Leurs empreintes SHA-256 sont vérifiées avant lancement. Sa taille dépend de la cible et des versions embarquées ; il est ignoré par git.

## Publier une release

Pousser un tag `vX.Y.Z` égal à la version de `packages/vscode/extension.manifest.json` déclenche `.github/workflows/release.yml` : `pnpm check`, `pnpm build`, empaquetage `linux-x64` puis `win32-x64`, empreintes SHA-256, puis création de la release GitHub avec les deux `.vsix`. Un tag qui ne correspond pas à la version du manifeste fait échouer le workflow avant toute publication. Relancer le workflow sur un tag déjà publié remplace les fichiers de la release (`--clobber`). Le job demande `contents: write` ; le dépôt est extrait sans identifiants persistants et le jeton n'est lu que par l'étape de publication.

## Interface et palettes (0.3.53)

La commande **Warband : choisir une palette** (`warband.choosePalette`) propose
Sentinelle, Braise, Spectre, Éditeur et Multicolore. Le réglage `warband.palette`
s’applique aux vues ouvertes sans rechargement. Les polices sont locales ; le
code conserve la police de l’éditeur. Les thèmes clair, sombre et contrasté et
le mouvement réduit sont respectés.

Les boutons **Autoriser une fois**, **Refuser** et **Toujours** répondent au clic
simple ou au clavier. L’option « Appui maintenu » de la 0.3.53 est retirée en
0.3.54. **Toujours** conserve sa confirmation native ; les contrôles de la gate
restent applicables.

Depuis la 0.3.55, le Bypass est signalé en magenta dans la vue : contour en
pointillés en attente de confirmation, plein lorsqu’il est actif. Le compteur
reprend l’échéance fournie par le moteur ; il disparaît à expiration et sa mise
à jour est suspendue dans les vues masquées. Il ne modifie aucune autorisation.
La barre d’état VS Code conserve son avertissement natif. Le formulaire
**Nouveau conteneur** possède un bouton **Replier le formulaire** : les champs
saisis restent disponibles après réouverture.

Depuis la 0.3.56, le menu **Configurer** est plus compact. Le texte du fournisseur
se déplie au clic, avec Entrée ou Espace ; il reste dans le parcours Tab avec le
sélecteur. Le détail complet de l’effort est conservé en infobulle et dans la
description accessible du curseur. L’avertissement complet du Bypass reste
visible et le menu garde son défilement interne pour les petites fenêtres.
Les cartes d’autorisation conservent leurs trois boutons au clic simple et leurs
caractéristiques descriptives, sans badge de niveau de risque. « Toujours »
affiche l’attente de confirmation native ; en cas d’annulation ou d’erreur du
dialogue, les boutons redeviennent disponibles sans autoriser l’action.

Le rail du chat affiche des compteurs de la page courante, pas un pourcentage
ou une progression de mission. L’horloge indique la durée du tour actif. Le
Monitor ajoute une frise cliquable et numérote les petites sorties ; les longues
sorties restent du texte. La flèche vers le bas active ou suspend le suivi.

Depuis la 0.3.58, **Réglages → Apparence** propose les cinq jeux, avec un aperçu
sur chaque carte. Flèches, Début et Fin changent le choix ; Entrée, Espace et
clic permettent aussi de le sélectionner. Le choix est enregistré avant son
application, sans recharger les vues ouvertes. En cas d’erreur, réessayez depuis
la même page. Les anciennes valeurs Bastion se replient sur Sentinelle.
Multicolore répartit six teintes décoratives depuis la 0.3.59 dans l’interface ; le contraste
élevé garde les couleurs natives et les couleurs d’état restent distinctes.

Depuis la 0.3.59, le curseur d’effort affiche un dégradé animé à son dernier
niveau disponible, quelle que soit la palette. L’effet est décoratif : il ne
change pas le niveau envoyé au modèle. Il reste fixe avec le mouvement réduit,
s’arrête en vue masquée et respecte le contraste élevé et les couleurs forcées.
Auto ne lance pas cet effet. Multicolore exclut désormais le jaune et l’orange.

Dans la Kill Chain, **Rejouer** visualise les liens verts sans exécuter de
commande. Échap arrête le rejeu et désélectionne. Les flèches déplacent la vue,
+ / − zooment et 0 ajuste le graphe. **Aperçu du rapport** (également accessible
par `warband.previewReport`) affiche un instantané des notes du projet actif,
sans identifiants ni loot. Toutes les gravités restent **À évaluer**. Le bouton
d’export produit le brouillon Markdown existant, à compléter avec preuves et
remédiations ; aucune instance SysReptor n’est nécessaire.

## Parcours de travail

**Choisir un projet → associer ses conteneurs → travailler avec l’agent → approuver les actions nécessaires → consulter les résultats et les traces.**

Le cockpit gère les conteneurs et leurs associations. La page Projet des réglages permet de choisir un projet existant avec
**Activer**, ou de le créer en donnant un nom puis un dossier via le dialogue
natif. L'activation et la création ouvrent aussi le dossier du projet dans VS Code.
Au démarrage, une fenêtre sans dossier restaure celui du projet actif ; une
fenêtre qui contient déjà un dossier est conservée. Si un document n'est pas
enregistré, le dossier cible s'ouvre dans une nouvelle fenêtre. L'ouverture
native conserve les contrôles de confiance de VS Code. Une tentative automatique
refusée ou échouée n'est pas répétée en boucle : **Activer** permet de réessayer.
Dans une ancienne fenêtre conservée pour ses brouillons, l'envoi et la reprise
restent bloqués si son dossier ne correspond plus au projet actif ; l'historique
reste consultable et les conversations gardent leur projet d'origine.
Le changement de projet est bloqué pendant un tour actif. Le chat
conduit les échanges. Monitor affiche
les exécutions et Kill chain les trouvailles. Le conteneur principal affiché
ne remplace pas la sélection de cible autorisée par le moteur.

Dans le Monitor et le panneau de suivi d'une commande, le bouton **flèche vers le bas** active
ou désactive le défilement automatique. Activé par défaut, il suit les nouvelles
sorties ; désactivé, il conserve la position de lecture, y compris dans les
sorties défilantes. Le réactiver revient immédiatement en bas. Ce réglage reste
propre au panneau ouvert.

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
2. Dans **Configurer**, choisir **Claude**, **OpenAI** ou **OpenCode**, puis **Ajouter un fournisseur** ou la commande **Warband : définir le jeton**. Pour Claude, choisir le jeton d'abonnement (`claude setup-token`) ou la clé API. Pour OpenAI, choisir **Abonnement ChatGPT** (connexion OAuth Codex dans le terminal OpenCode embarqué) ou **Clé API OpenAI** (saisie masquée, stockage `SecretStorage` de VS Code). Terminer la connexion OAuth dans le terminal puis le fermer, ou actualiser les modèles. Le mode abonnement écarte la clé API ; le mode API isole le cache OAuth pour éviter une utilisation involontaire de l'abonnement. Le fournisseur OpenCode utilise sa connexion gérée par `auth login`. Aucun message ne part quand la connexion requise manque. **Warband : effacer le jeton** désactive la connexion OpenAI dans Warband et supprime sa clé ; son cache OAuth reste géré par OpenCode (`auth logout`).
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

Dans la barre d'outils du composer : une **pastille de modèle** et, sous « Configurer », le réglage d'effort. Pour **Claude**, c'est un **curseur** à 6 crans (Low, Medium, High, Extra, Max, Ultracode ; Extra correspond à l'effort `xhigh` du SDK). **Par défaut le curseur est sur « Auto »** : aucun effort n'est transmis et le modèle garde son comportement par défaut, tant que vous n'avez pas touché au curseur ; le bouton « Auto » y revient. Le libellé du cran courant est affiché, l'infobulle décrit l'effet (Low : rapide et économe ; Max : réflexion la plus poussée, plus lent et plus coûteux), et les crans non pris en charge par le modèle choisi sont grisés (un niveau non pris en charge est ramené au plus proche niveau permis, avec un avis). Le curseur se pilote au clavier (flèches) et expose son libellé aux lecteurs d'écran.

- La **liste des modèles Claude** vient du SDK au runtime (aucun identifiant n'est codé en dur) : un moteur de sondage éphémère, lancé à l'ouverture du chat **sans aucune consigne** (donc sans tour, sans outil ni inférence), interroge `supportedModels()` puis s'arrête. Elle est mise en cache (`globalState`) par version du SDK ; « Actualiser la liste » la recharge. Si elle est indisponible, le popover propose une **saisie libre** (identifiant sans espace, 200 caractères maximum).
- Les catalogues **OpenAI/OpenCode** sont interrogés au runtime auprès du serveur local OpenCode, sans consigne ni inférence. Aucun catalogue statique de secours n’est embarqué. Le chargement est borné à **45 secondes**, lecture de la connexion comprise. Un nouvel essai annule le sondage précédent, y compris sa requête HTTP. Les échecs de connexion, dépassements de délai et listes vides affichent un message fixe avec une action pour réessayer ; le popover de modèle propose aussi **Configurer la connexion**.
- Le sélecteur regroupe les modèles par fournisseur annoncé dans leur identifiant et affiche cet identifiant sous le nom. Deux modèles de même nom restent ainsi distinguables. Le badge **Gratuit** reprend uniquement une indication explicite « Free » du catalogue ; les autres modèles n’ont pas de prix présumé. Le filtre accepte aussi le fournisseur et « gratuit ».
- Pour **OpenAI/OpenCode**, le réglage d’effort propose uniquement les **variantes exactes annoncées au runtime par le modèle réellement choisi**. Aucun alias de niveau Claude ni préréglage Ultracode n’est envoyé. **Auto** omet la variante ; sans variante annoncée, aucun effort explicite n’est transmis. Le moteur vérifie à nouveau la variante avant le tour.
- Changer de **fournisseur** conserve la **même conversation**, son projet, son fil et ses identifiants de run. Chaque changement crée une **nouvelle session SDK**, y compris un retour A → B → A. Seuls les messages utilisateur/assistant du fil courant sont transférés, après masquage des secrets : au plus **80 messages**, **80 000 caractères** au total et **8 000 caractères par message**. Un contexte partiel est signalé au modèle. Les appels d’outils, résultats et verdicts ne sont pas rejoués ; les mentions anciennes ne peuvent pas autoriser une cible. **Nouvelle conversation** conserve son sens : repartir de zéro, sans les autres fils.
- Les choix de modèle et d’effort s'appliquent au **message suivant** (gelés pendant un tour) : le moteur inactif est remplacé par un nouveau qui reprend la même session (`resume`), sans perdre le fil. Ils sont persistés dans `globalState` (jamais dans l'espace de travail). Le modèle par défaut reste le réglage machine `warband.model`.
- L'extension **revalide** tout choix venu de la webview : identifiant de la liste (ou bien formé en saisie libre), niveau d'effort Claude dans l'énumération, ou variante exacte du modèle OpenAI/OpenCode.
- **Ultracode** (fournisseur Claude seulement, grisé si le modèle ne supporte pas `max`) est ici un **préréglage honnête** : effort `max` + plafonds de tours et de dépense issus des réglages `warband.ultracode.maxTurns` et `warband.ultracode.maxBudgetUsd` (0 : pas de plafond ; `warband.ultracode.maxTurns` remplace `warband.maxTurns` quand Ultracode est choisi). Il ne change PAS ce que raisonne le modèle (même capacité que Max) ; l'infobulle affiche les valeurs en vigueur. Le SDK connaît un vrai « ultracode » (réglage de session `ultracode` + mot-clé de prompt, qui orchestrent l'outil `Workflow` et des sous-agents) : il n'est volontairement pas branché, voir la décision en attente dans le rapport (ADR 0005, Q1).

Le transfert du fil constitue une donnée de contexte, pas une nouvelle consigne :
`onPrompt`, la résolution des mentions et l’événement `user.message` du journal
reçoivent uniquement la **nouvelle consigne utilisateur**. La gate reste
responsable de chaque nouvelle action, sous la politique actuelle.

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
- Claude, OpenAI et OpenCode sont proposés ; les variantes d’effort OpenAI/OpenCode dépendent du catalogue runtime du modèle. Markdown limité (tableaux pris en charge, liens non cliquables, pas d’images).
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

## Préparation automatique des conteneurs Kali (depuis 0.3.23)

La création complète décrite ci-dessous prépare désormais une image dédiée. Les actions **Démarrer** et **Lier**, ainsi que la création à partir d’une autre image Kali, vérifient
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


## Création et suppression des conteneurs — 0.3.30

**Exegol** : le formulaire ouvre un terminal interactif pour laisser les
questions et diagnostics de la CLI visibles. Exegol doit être installé sur
l’hôte ; les options sont vérifiées dans son aide avant lancement. Le dossier
de travail et le VPN se choisissent dans un dialogue natif. Le VPN accepte
un fichier OpenVPN `.ovpn`, WireGuard `.conf` ou un dossier ; son contenu
n’est pas lu par la webview. Le VPN exige le réseau **NAT**, proposé par
défaut. Le bureau web est optionnel, lié à `127.0.0.1:6080` par défaut
(port réglable). Le partage des ressources Exegol, des ressources personnelles
et de l’affichage se règle explicitement. La journalisation est activée par
défaut avec `--log`, et la méthode `script` quand la CLI la propose.
Une option indisponible produit une erreur explicite.

**Kali complet** : Warband construit localement `warband/kali:complete-1`
sur `kalilinux/kali-rolling:latest`, avec `kali-linux-headless`, Python,
`mcp-kali-server`, `subfinder`, `httpx-toolkit` et `nuclei`, sans paquets
recommandés. Ce nom désigne une image locale construite, pas une image
publiée à télécharger. Le pull de base affiche les couches, les octets et la
vitesse quand le démon local les fournit ; la construction affiche son
état. L’opération est annulable. Les contextes Docker distants utilisent la
CLI et peuvent fournir une progression moins détaillée. Prévoir la place
pour l’image et les couches temporaires de construction. Chaque nouveau
Kali utilise le journal Docker `json-file`, limité à 3 fichiers de 10 Mio ;
les conteneurs existants ne sont pas reconfigurés.

**Supprimer** demande une confirmation native présentant le nom, la famille,
l’état et les projets associés. Un conteneur actif est supprimé de force
après cet avertissement. L’identité Docker est revérifiée puis la suppression
vise son ID ; un changement de conteneur ou d’état oblige à recommencer.
Les fichiers internes non montés sont perdus. Images, volumes et dossiers
hôtes sont conservés. Les associations et le conteneur principal des projets
sont nettoyés après réussite ; un échec de nettoyage est signalé séparément.

## Résultats et correction des trouvailles — 0.3.30

Chaque session reçoit une consigne opérationnelle : enregistrer chaque scan
autorisé sous `/workspace/outputs`, avec un nom unique, les formats natifs
utiles, stderr et le code de retour ; signaler tout échec et citer seulement
les fichiers effectivement créés. Cette consigne n’est pas une garantie
qu’un outil ou un modèle a écrit les fichiers : contrôler les chemins
annoncés. Les journaux techniques ne remplacent pas ces résultats.

L’outil `list_notes` lit les trouvailles du projet actif et leurs identifiants,
sans lire l’historique des conversations. `update_note` corrige une trouvaille
par ID : les champs omis sont conservés, `null` efface la tactique ou la
technique et `[]` efface les parents. Les parents doivent exister et ne pas
former de cycle ; le titre reste limité à 200 caractères.

## Supprimer une trouvaille — 0.3.34

Dans la **Kill chain**, cliquer sur un nœud (ou le sélectionner avec Tab puis
Entrée/Espace), puis choisir **Supprimer** dans la barre du graphe. Une
confirmation native précise l’élément et les liens concernés. Les autres
nœuds sont conservés ; seuls les liens vers l’élément supprimé sont retirés.
Le graphe s’actualise après suppression.

L’agent peut aussi utiliser **`delete_note`**, après `list_notes` pour retrouver
l’identifiant. Cette action passe par les approbations habituelles. Un projet
ou un contenu modifié pendant la confirmation impose de recommencer.

## Méthode commune — 0.3.47

Tous les modèles des fournisseurs Claude, OpenAI et OpenCode reçoivent le
[skill de conduite vérifiable](methodologie-agent.md), dès le lancement et
à la reprise. Il encadre la vérification d'état, les hypothèses, les preuves,
la réévaluation d'une branche bloquée et la recherche de pistes alternatives.
Il ne faut pas le recopier dans chaque prompt. L'apprentissage reste en lecture
seule ; la méthode ne donne aucun droit supplémentaire et ne garantit pas la
réussite d'un challenge.

## Recherche web — 0.3.35

Les agents Claude, OpenAI et OpenCode peuvent utiliser **`search_web`** pour
chercher une information récente ou un outil GitHub, puis **`read_url`** pour
lire une documentation, un README ou une release. Les résultats indiquent les
sources et la date de consultation. Exemple : « Cherche la documentation
actuelle de cet outil sur GitHub et résume son installation sans l’exécuter. »

Aucune clé de recherche à renseigner pour cette version : la recherche passe
par le service public Exa, soumis à ses limites. Les approbations habituelles
restent applicables. L’installation ou l’exécution d’un outil trouvé est une
action distincte dans le conteneur. La lecture concerne les pages publiques
textuelles ; elle ne fait pas tourner de navigateur JavaScript.

## Nmap et capacités Docker — 0.3.36

Certains paquets Kali placent `cap_net_bind_service,cap_net_admin,cap_net_raw=eip`
sur `/usr/lib/nmap/nmap`. Docker peut refuser son exécution (code 126,
« Operation not permitted ») si `NET_ADMIN` est absente du jeu de capacités
maximal du conteneur, même pour `nmap --version`.

La préparation humaine Kali vérifie désormais le lancement de Nmap lorsqu’il
est installé. Si ce cas est rencontré, elle retire uniquement les capacités
Nmap connues absentes du conteneur, puis vérifie de nouveau `--version`.
Aucune capacité Docker n’est ajoutée. Le contrôle est rejoué à la liaison et
au démarrage via le cockpit. Un échec persistant est signalé explicitement.
Les nouvelles constructions de l’image complète incluent aussi la correction.

Pour le cas standard Docker (NET_RAW et NET_BIND_SERVICE présentes), une
correction manuelle dans le terminal root du conteneur est :

```sh
setcap cap_net_bind_service,cap_net_raw=eip /usr/lib/nmap/nmap
nmap --version
```


## Tâches longues dans Kali et Exegol

Les scans complets Nmap (`-p-`, ports `1-65535` ou `0-65535`) sont refusés dans
`nmap_scan` avant tout lancement, avec une indication d'utiliser `task_start`.
Les vérifications Nmap courtes restent synchrones. Ce refus ne lance aucune
tâche automatiquement et ne remplace pas les approbations de `task_start`.

Commencer par `task_list`, lancer par `task_start`, retenir son `task_id`,
puis consulter `task_status` jusqu'à un état final. `task_list` n'est pas une
liste générale des processus : un ancien scan synchrone qui a dépassé le délai
MCP peut tourner sans y apparaître. Vérifier les processus avant toute relance.
Le shell Kali est POSIX : créer les dossiers avec des chemins explicites,
sans expansion `{a,b}`, et vérifier leur existence avant d'y écrire les sorties.

Les agents Claude, OpenAI et OpenCode disposent de `task_start`, `task_list`,
`task_status` et `task_cancel`. Pour un scan ou une commande dont la durée est
incertaine, le lancement rend un identifiant sans attendre la fin du programme.
Les consultations affichent l’état réel, le temps écoulé, le code de sortie
final et les dernières sorties. L’attente de consultation est bornée à dix
secondes (deux par défaut), sans garder un appel MCP ouvert pendant tout le scan.

Exemples de demandes : « Lance cette commande en tâche longue », « Liste les
tâches de ce projet dans @kali-1 », « Donne l’état de la tâche … », « Annule
la tâche … puis confirme son arrêt ». Le lancement reçoit un tableau `argv`,
sans shell implicite, et s’exécute depuis `/workspace`. Les approbations et
l’allowlist restent applicables ; le mode Apprentissage ne reçoit pas ces outils.

Chaque tâche conserve `stdout.txt`, `stderr.txt` et, en fin normale du
superviseur, `result.json` sous `/workspace/outputs/warband-task-<identifiant>`.
Sur Linux, les nouveaux fichiers de résultats reprennent le propriétaire du
dossier monté lorsque le superviseur est root. Le suivi est séparé par projet
et par conteneur ; aucune ancienne conversation n’est injectée.

**Fermer le chat ou arrêter le tour n’annule pas une tâche déjà lancée.**
Utiliser `task_cancel`, puis vérifier l’état. Un redémarrage du conteneur
interrompt le travail ; aucune reprise automatique n’a lieu. Après un timeout
au lancement, consulter la liste avant toute relance pour éviter les doublons.

Limites : une heure par défaut, 24 heures maximum ; huit tâches actives et
500 tâches conservées par projet/conteneur ; liste des 50 plus récentes.
Les flux capturés sont plafonnés à 32 Mio cumulés, puis la commande est arrêtée
avec un état explicite. La consultation affiche au plus 8 Kio par flux.
Les fichiers écrits directement par le programme ne sont pas soumis à ce plafond.
Un programme qui détache lui-même ses descendants peut échapper à l’arrêt du
groupe : voir [ADR 0024](adr/0024-taches-longues-conteneurs.md).


### Diagnostic de la recherche web

La recherche passe par le service public Exa ; la lecture d’une page n’en
dépend pas. Une lecture réussie ne prouve donc pas que le service de recherche
est joignable depuis le même poste. Les erreurs distinguent désormais DNS,
certificat HTTPS, connexion interrompue/refusée, délai de 25 secondes et quota
HTTP 429. Les codes DNS/TLS/connexion peuvent être copiés pour le diagnostic ;
aucune URL de proxy ni valeur d’authentification n’est affichée.

Un quota exige d’attendre ; un problème de certificat demande de vérifier la
chaîne de confiance du poste/proxy, sans désactiver TLS. Les autres statuts
HTTP restent affichés. Un HTTP 405 en lisant l’adresse MCP Exa confirme une
réponse HTTP mais indique que cette route attend une autre méthode.


### Vérification proactive des informations

Quand les outils web sont disponibles, Claude, OpenAI et OpenCode reçoivent
une consigne système commune : rechercher avant d’affirmer ignorer un outil
ou une technologie, vérifier les informations incertaines ou susceptibles
d’avoir changé, et lire les sources officielles pertinentes pour les
technologies/versions découvertes pendant le travail. Les réponses doivent
citer les sources et distinguer faits vérifiés et hypothèses.

Les sources déjà vérifiées dans le fil sont réutilisées pour éviter les
requêtes inutiles. Un échec de recherche est signalé comme tel, sans conclure
à l’inexistence de l’information. Les consignes hors ligne et les approbations
restent applicables ; aucune installation ni exécution n’est autorisée par
une recherche. Le mode Apprentissage conserve ses outils de cours locaux.


### Autorités HTTPS du poste

Les outils web utilisent les autorités de confiance de Node et du système
(en particulier le magasin Windows), si le moteur embarqué par VS Code dispose
de `tls.getCACertificates` (Node 22.15+). Cela permet de reconnaître une
inspection HTTPS déjà approuvée sur le poste, sans désactiver la vérification
du certificat ou du nom du site. Le proxy HTTPS éventuel est vérifié aussi.
Aucun certificat joint dans une conversation n’est automatiquement approuvé.

Si l’API n’existe pas, les autorités Node habituelles restent utilisées.
Mettre VS Code à jour est alors recommandé. Une chaîne incomplète ou une
racine absente peut encore nécessiter l’intervention de l’administrateur du
poste. `NODE_EXTRA_CA_CERTS` reste pris en charge pour un bundle PEM approuvé,
chargé au lancement : fermer complètement puis relancer VS Code après une
modification de cette variable. Ne pas utiliser `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Configuration OpenCode isolée — 0.3.48

Le serveur OpenCode de l'extension utilise une configuration temporaire séparée
pour le catalogue et les conversations. Les plugins, hooks, agents et fournisseurs
personnalisés de la configuration globale ne sont pas importés. Les connexions du
magasin d'authentification (dont Zen) restent accessibles ; aucun fichier personnel
n'est modifié. Les permissions imposées par Warband restent vérifiées. Les
fournisseurs intégrés connectés restent découverts au runtime.

## Attente fournisseur — 0.3.49

Une nouvelle tentative annoncée par le fournisseur est affichée dans le chat,
avec un indicateur distinct de « Réflexion ». Un quota gratuit Zen épuisé termine
le tour avec un diagnostic ; une attente annoncée de plus d'une minute avant
une nouvelle tentative termine aussi le tour. Il reste possible de choisir un
autre modèle ou de réessayer ultérieurement. Les tâches longues, les approbations
et les réponses en cours ne sont pas plafonnées par ce seuil.

## Kill Chain et brouillon de rapport — 0.3.50

L'agent peut marquer de façon autonome les liens du chemin retenu avec
`list_notes`, puis `mark_path`. Les liens sont verts et persistés dans les
trouvailles du projet ; ils ne changent pas l'état confirmé/hypothèse/échec.
Cliquer un lien ou le sélectionner au clavier permet aussi de l'ajouter ou de
le retirer du chemin. Un clic dans le vide ou Échap efface la sélection.

La légende est repliable. Ses boutons Type et État atténuent les éléments qui
ne correspondent pas ; les deux critères se combinent, un second clic retire
le critère et **Tout afficher** rétablit la vue. Aucun nœud n'est supprimé.
La barre d'actions dispose d'une rangée séparée sur les petites fenêtres.

**Exporter le brouillon** ouvre un dialogue natif pour un rapport Markdown
local, également disponible dans la palette de commandes. Identifiants et loot
sont exclus ; les preuves, la gravité et la remédiation restent à compléter.
Voir [rapports, SysReptor et MCP](rapports-et-mcp.md) pour la portée de cet export,
les alternatives et les 97 tests du MCP officiel Burp effectués avec API simulée.

## Image du graphe et longues conversations — 0.3.52

**Exporter l’image**, dans la Kill Chain, et la commande **Warband : Exporter la
Kill Chain en image SVG** enregistrent le graphe entier. Le SVG reste net au
zoom : noms complets sur plusieurs lignes, types, états et chemin vert sont
inclus, indépendamment des filtres et du cadrage. Tous les éléments sont présents,
identifiants et loot compris : relire leurs libellés avant de diffuser l’image.
Le fichier ne contient ni sortie de commande ni valeur de secret séparée.

Dans le chat et le Monitor, **Précédents** permet de relire les messages et
commandes conservés dans les journaux ; **Suivants** et **Revenir au direct**
reviennent aux messages récents. Les pages contiennent au maximum 300 éléments,
y compris après réouverture de l’historique et pour un journal de plus de 16 Mio.
Le tour continue pendant la lecture et ses approbations restent disponibles dans
le chat. Le Monitor désactive le suivi du bas lors de la navigation dans les
archives ; sa flèche permet toujours de basculer ce suivi. Une fenêtre de sortie
individuelle garde sa dernière commande visible si elle sort de la page.

Les limites de taille des sorties et la rétention de l’historique restent en
place : les journaux supprimés ou sorties déjà tronquées ne sont pas récupérables.
Le chargement par pages, les détails créés à l’ouverture des cartes, la
réutilisation des nœuds et le regroupement du flux réduisent les allocations de
l’interface. Le Monitor ne construit plus un deuxième chat invisible. Cela ne
constitue pas une garantie de plafond mémoire pour VS Code et ses agents.

## Fichiers joints au chat — 0.3.74

Utiliser le **trombone**, déposer ou coller les fichiers exposés par le
presse-papiers dans la zone de saisie. Vérifier les noms et aperçus d’images,
retirer les pièces avec **×**, puis envoyer. Une
consigne est facultative : sans texte, l’agent reçoit « Analyse les fichiers
joints. ». Cette version accepte les textes, logs et fichiers de code **UTF-8**,
ainsi que les images PNG, JPEG, GIF et WebP : dix pièces au maximum. Les textes
restent limités à 64 Kio chacun et 256 Kio au total ; les images à 5 Mio chacune
et 12 Mio au total. PDF et autres documents binaires ne sont pas pris en charge.

Le contenu est envoyé au fournisseur choisi : texte ou blocs d’images selon le
type de pièce. Le texte rejoint le journal avec le masquage de secrets existant ;
les octets des images ne sont pas recopiés dans ce journal par le moteur. Le
fournisseur peut conserver les images dans son historique. Le masquage n’est pas
une garantie de détection de tous les secrets : relire les fichiers avant envoi.
Le chemin local n’est pas transmis et aucun fichier n’est installé dans Kali.
Le chat direct montre les noms ; la relecture du journal peut montrer le prompt
complet. Le transfert de contexte lors d’un changement de moteur reprend les
bulles affichées : joindre à nouveau les fichiers si leur contenu est nécessaire.

Un refus d’envoi garde les fichiers dans le brouillon. Un changement de
conversation, de chat ou un rechargement de la webview retire les pièces jointes
non envoyées : elles ne sont pas enregistrées dans l’état persistant de VS Code.
Aucun fichier du disque n’est modifié. La confiance du dossier reste obligatoire.

Un modèle explicitement sans vision bloque l’envoi avec images ; retirer les
images ou changer de modèle permet de continuer. Une capacité non annoncée
déclenche un avertissement et laisse essayer. Le collage dépend des formats
exposés par le système : coller un chemin comme texte ne lit aucun fichier hôte.

## Renommer et supprimer un projet — 0.3.61

Dans **Réglages → Projet → Choisir un projet**, sélectionner une fiche, puis
**Renommer…** ou **Supprimer…**. Il n’est pas nécessaire d’activer son dossier.
Le renommage change le nom affiché et garde les données et les conversations.
La suppression demande une confirmation et retire uniquement la fiche Warband :
dossier, conteneurs, notes, trouvailles et journaux restent sur disque. Supprimer
le projet actif n’en active aucun autre et ne ferme pas le dossier VS Code.
Les conversations conservées ne sont pas transférées à un autre projet.
Terminer ou arrêter les tours en cours avant ces modifications.

## Burp Suite MCP — 0.3.61

1. Installer l’[extension MCP officielle PortSwigger](https://github.com/PortSwigger/mcp-server)
   dans Burp Suite et activer son serveur dans l’onglet **MCP**. Warband ne fournit
   ni Burp ni sa licence, et ne lance aucun proxy Java.
2. Ouvrir **Réglages → Contrôle système → Burp Suite MCP → Configurer…**, ou la
   commande **Warband : configurer Burp Suite MCP**. Choisir le port affiché par
   Burp (9876 par défaut) et le transport : SSE `/sse` pour le serveur officiel,
   HTTP `/mcp` si le serveur installé le propose. Seul `127.0.0.1` est pris en charge.
3. Cliquer **Tester la connexion**, ou lancer **Warband : tester la connexion MCP
   Burp Suite**. Le test lit le catalogue sans exécuter d’outil Burp ni appeler de
   modèle. Envoyer ensuite une nouvelle consigne à l’agent.

La connexion fonctionne avec les fournisseurs Claude et OpenCode. L’agent découvre
les outils avec `mcp__burp__list_tools`, puis utilise `mcp__burp__call_tool` avec le
nom et les arguments exacts du catalogue. Les appels sont soumis à la gate et ne
proposent pas « Toujours » ; le Bypass garde son fonctionnement habituel. Le mode
Apprentissage n’expose pas Burp. Vérifier séparément le projet et les cibles
ouverts dans Burp : Warband n’effectue pas cette association automatiquement.

Désactivée par défaut, la connexion n’utilise que les réglages utilisateur machine
`warband.burp.enabled`, `warband.burp.port` et `warband.burp.transport`. Les réglages
du dépôt sont ignorés. Désactiver la connexion arrête un tour actif ; les consignes
suivantes utilisent un moteur sans Burp. Les autres changements s’appliquent au
prochain tour. Les réponses textuelles sont bornées à 32 Kio et leur troncature
est signalée ; privilégier la pagination Burp. Après un timeout, consulter Burp
avant de retenter : l’action peut avoir continué. Les résultats et les arguments
rejoignent le journal et son masquage existants : ne pas y exposer de secrets.

Les deux transports ont été testés avec des serveurs MCP locaux factices. Le
fonctionnement sur une instance Burp réelle reste à confirmer sur votre poste.

## Limites des pièces jointes — 0.3.61

Le nombre maximal passe à **10 fichiers**. Les bornes de **64 Kio par fichier** et
**256 Kio au total** restent en place. La demande de 40 Mo par fichier et 400 Mo
au total nécessite une lecture progressive distincte du prompt ; elle n’est pas
annoncée comme implémentée dans cette version. L’ajout des images en 0.3.74 est
décrit dans la section des fichiers joints ; les PDF restent exclus.

## Atelier de mission — 0.3.62

Voir le [guide de l’atelier](atelier-agent.md) : disposition, dossier partagé,
lecture de gros fichiers par extraits, catalogue MCP par projet et cinq skills
méthodologiques avec sources et licences. Les applications externes ne sont pas
installées automatiquement et les pièces jointes du chat gardent leurs limites.
