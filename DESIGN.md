# Cadre de design

L’atelier reprend les composants visuels existants : barre de conversation,
cartes de tâches et de validation, menus de modèles et de configuration,
Monitor et graphe avec minimap, légende dépliante et filtres.

## Objectif

Améliorer la cohérence des espacements, la lisibilité, les hiérarchies visuelles,
le rendu des états vides et des longues sorties, et le confort en fenêtre étroite.
Le graphe doit rester agréable à parcourir au clavier, à la souris et au zoom.

## Direction artistique : « Acier et signature »

- **Acier** : surfaces neutres tirées du thème (voiles `--jn-raise` et
  `--jn-raise-2` mélangés au premier plan), filets fins `--jn-line`, ombres
  réservées aux menus et panneaux flottants.
- **Signature** : `--jn-sig`, couleur de la palette choisie, marque le logo,
  les liserés, les sélections, l’effort et l’activité de l’agent. Les boutons
  principaux, les liens et le focus restent ceux du thème VS Code ; en
  contraste élevé, la signature devient la bordure active du thème.
- **Liseré** : un trait vertical de 2 px (`--jn-rail`) signale l’état des
  blocs : message envoyé, validation, entrée du Monitor, bandeaux, projet actif.
  Les éléments en pilule (rubrique, filtre, option) marquent la sélection par
  un fond teinté.
- **Typographie** : Geist pour l’interface, Geist Mono pour les repères
  techniques (étiquettes en capitales espacées `--jn-fs-2xs` / `--jn-track`,
  compteurs, horloges, mot-symbole « VENATOR OPS », « OPS » en signature et masqué sous 360 px) ; la police de l’éditeur
  (`--jn-code`) pour le code, les commandes et les sorties ; chiffres
  tabulaires. Polices locales sous licence OFL (`media/fonts/`).
- **Géométrie** : formes arrondies plutôt que carrées. Boutons, puces,
  badges, onglets, champs d’une ligne et rubriques en pilule
  (`--jn-r-pill`) ; blocs et panneaux en `--jn-r-sm` 8 px, `--jn-r-md` 12 px
  et `--jn-r-lg` 18 px pour le compositeur. Grille de 4 px, rangées de 28 à
  32 px.
- **Graphe** : canevas tramé, barre d’outils à pictogrammes (libellés masqués
  sous 640 px), légende en panneau latéral ou flottant, déplacement au clavier
  (flèches, Maj pour un grand pas, + / − pour zoomer, 0 pour ajuster).

## Logo

Quatre crochets de visée anguleux (offensif, verrouillage de cible) encadrent
une étincelle à quatre branches (l’IA) ; un satellite figure l’agent. Les
crochets prennent le gris de marque, l’étincelle et le satellite la couleur de
signature. Pendant la réflexion, les crochets se resserrent, l’étincelle pulse
en pivotant et le satellite orbite, dans l’en-tête comme dans l’indicateur du
chat ; à l’accueil, les crochets se verrouillent puis l’étincelle s’allume.
Classes `.brand-wing` (crochets), `.brand-core`, `.brand-lead`, `.brand-orbit`,
`.brand-node` ; `media/logo.svg`, `logo-small.svg` et `icon.svg` (barre
d’activité, monochrome) en sont les versions fixes.

## Marque Venator Ops

Nom retenu : **Venator Ops** (*venator*, « le chasseur » en latin ; aussi un
genre d’araignées-loups et un clin d’œil aux destroyers de Star Wars). Slogan :
*The offensive security workspace for VS Code*. C’est d’abord un espace de
travail : conteneurs Docker Kali puis Exegol (dans cet ordre), terminaux,
Monitor, kill chain et rapports, utilisables entièrement sans IA ; l’agent est
une option. Ne pas le présenter comme un agent autonome de plus. Le nom visible change ; les identifiants
internes (`warbandDesign.*`, commandes, réglages, classes, globales
`WarbandUI` / `WarbandIcons`) restent pour ne casser ni les réglages
existants ni la réintégration.

Le logo reste celui de l’interface (`media/logo.svg`) ; le mot-symbole
« VENATOR OPS » est resserré (espace réduit avant « OPS »). Bannières dans
`media/brand/` : `banner-github.png` (1280 × 640, aperçu social du dépôt),
`banner-github@2x.png` (README) et `banner-linkedin.png` (1584 × 396 en 2x,
texte décalé hors de la photo de profil). Registre sobre : fond plat, aucune
lueur ni dégradé ; titre « The offensive security workspace for VS Code. »,
texte « Docker Kali and Exegol… Work by hand, or bring an AI agent when you
want one. », faits « Open source · Docker Kali · Exegol · AI optional ». À
droite, trois fenêtres séparées : chat à gauche, Kill chain en haut à droite,
Monitor (kali-1) en bas à droite. Les captures viennent de l’aperçu de
l’atelier ; leurs textes sont remplacés au moment de la capture par un lab
fictif (10.10.10.14, nmap, whatweb, ffuf, sqlmap), sans toucher aux fixtures.
Aucune donnée réelle (IP, flags, identifiants) n’y figure.

## Verrouillage, règles d’engagement et carte d’autorisation

- **Verrouillage** : les crochets du logo se referment sur ce qui est ciblé —
  nœud sélectionné du graphe, validation en attente (crochets d’alerte qui
  pulsent, verts une fois autorisée), conversation ouverte, projet actif. Le
  contour de focus clavier reste affiché en plus.
- **Règles d’engagement** : jauge à trois crans dans l’en-tête (Apprentissage,
  Supervisé, Automatique), tirée des réglages existants ; un clic ouvre
  Configurer. Sous 420 px, seule la jauge reste visible.
- **Carte d’autorisation** : pastilles « Exécution », « Réseau » et
  « Mémorisable » qui décrivent la demande elle-même ; aucune estimation de
  risque ni de sécurité n’est affichée. « Autoriser une fois », « Refuser » et
  « Toujours » se valident au clic simple ; les crochets de verrouillage passent
  au vert une fois la demande autorisée.
- **Ne pas réintroduire l’appui maintenu** : option et comportement supprimés
  à la demande du propriétaire (0.3.54).

## Menu Configurer compact

Le menu tient sans défilement (environ 370 px au lieu de 680) : pas de
sous-titre ni de titres de section visibles (conservés pour les lecteurs
d’écran), descriptions en infobulle et toujours liées par `aria-describedby`,
interrupteurs sur une ligne, curseur resserré. Seule la ligne d’état du bypass
reste visible ; le texte du fournisseur est limité à deux lignes et se déplie
au clic ou au clavier. En production, le texte réel du fournisseur et ses
infobulles dynamiques passent par les mêmes identifiants.

## Réflexion dans le chat

Chaque réponse de l’agent est signée du logo (`.msg-avatar`, clone de
l’en-tête) ; celui de la dernière réponse s’anime pendant l’activité et se
verrouille à l’arrivée d’une réponse. Au repos, le satellite de l’en-tête fait
lentement le tour et le logo d’accueil respire.

Logo animé, libellé balayé de lumière, trois points qui sautent et liseré
lumineux qui parcourt le haut du compositeur. En attente d’accord : tout passe
en couleur d’alerte et s’immobilise.

## Curseur d’effort

Carte compacte : pictogramme à gauche, niveau centré en couleur de signature
avec le modèle en dessous (ouvre le menu Modèle), retour à Auto à droite.
Piste épaisse en pilule, remplissage de signature, un point par niveau et
grande pastille claire. Au maximum, le remplissage passe en dégradé multicolore (cyan, bleu, violet, rose) qui ondule en boucle, quelle que soit la palette (classe `.is-max`, hors contraste élevé). Le glisser est continu, le relâchement se cale sur le
niveau le plus proche avec un rebond ; le clavier passe de niveau en niveau.

## Palettes et page Apparence

Cinq jeux de couleurs, au choix dans **Réglages › Apparence** (icône palette,
groupe « Interface »), par la commande **Venator Ops : choisir une palette** ou
par le réglage `warbandDesign.palette`. Le choix s’applique aussitôt à toutes
les vues, sans rechargement, et l’aperçu navigateur le garde d’une vue à
l’autre. Chaque jeu a un ton pour les thèmes sombres et un ton plus foncé pour
les thèmes clairs.

| Jeu | Sombre | Clair | Intention |
| --- | --- | --- | --- |
| Sentinelle (défaut) | `#3cc7c0` | `#0b7a82` | sarcelle et ardoise : veille, terminal, sécurité |
| Braise | `#f0506e` | `#c41a3d` | cramoisi et acier, marque d’origine ; proche du rouge d’erreur |
| Spectre | `#a990ff` | `#6741d9` | violet et glace, distinct de toutes les couleurs d’état |
| Éditeur | accent du thème | accent du thème | intégration maximale avec n’importe quel thème |
| Multicolore | `#ff6b81` `#5fd68a` `#35c4d8` `#6ea0ff` `#a98bff` `#ff7eb6` | `#d6334f` `#17803f` `#0a7f95` `#2a5fd0` `#6a3fd0` `#c2306f` | six teintes (`--jn-rb-1` à `--jn-rb-6`), sans jaune ni orange (réservés aux alertes), une par rôle, jamais en contraste élevé |

Bastion (cuivre) est retiré : trop proche de l’orange des alertes. Une valeur
inconnue, y compris « bastion » dans les réglages existants, retombe sur
Sentinelle.

- **Page Apparence** : une carte par jeu, dans un groupe `radiogroup`
  (flèches, Début et Fin pour passer de l’un à l’autre, Entrée ou Espace pour
  choisir). Chaque carte aperçoit son propre jeu (logo, pastilles, curseur) car
  les variables de palette s’appliquent à tout élément `data-palette`. La carte
  choisie porte les crochets de verrouillage et une coche. En contraste élevé,
  une note rappelle que les couleurs du thème prennent le relais.
- **Multicolore** : six teintes (corail, vert, cyan, bleu, violet, rose ; ni jaune
  ni orange, réservés aux alertes) réparties dans toute l’interface. Dégradé continu pour le
  soulignement de marque et le curseur d’effort ; logo (étincelle bleue,
  satellite rose) ; liserés des messages envoyés qui parcourent le spectre ;
  une teinte par page de Réglages (pictogramme de navigation), par phase de la
  mission, par espace du Monitor (somme des caractères du nom modulo 6, attribut
  `data-hue`) ; flèches des exemples ; compteurs et barres des règles
  d’engagement. Les états (ok, alerte,
  erreur), la gravité et le bypass gardent leurs couleurs ; la couleur n’est
  jamais seule porteuse de sens.
- **Messages** : la page envoie `setPalette` ; l’extension enregistre le
  réglage et diffuse `palette` aux vues ouvertes. Le harnais fictif les traite
  localement ; aucune autre donnée n’est ajoutée.

## Monitor et cockpit

- **Monitor** : en-tête collant avec voyant en direct (orange s’il reste une
  commande en attente), compteur de commandes, bouton « Suivi » du bas. Chaque
  entrée est une carte terminal : pastille d’état, espace en pilule, commande,
  état en pilule colorée, sortie dans un volet encastré ; au survol, « Suivre › »
  invite à ouvrir la lecture seule. État vide expliqué, pastille et texte.
- **Cockpit** (Réglages › Espaces et Contrôle système) : tuiles d’état
  (pictogramme, libellé, valeur, voyant ok / alerte / erreur), compteur d’espaces
  actifs, lignes d’espace avec pastille et état en pilule. Sous 640 px, les
  tuiles deviennent des lignes compactes.

## Monitor tactique et chemin d’attaque

- **Frise** sous l’en-tête du Monitor : un trait par commande, coloré par son
  état ; un clic amène l’entrée juste sous l’en-tête et la fait briller.
- **Horloge de mission** (T+mm:ss) pendant l’activité, dans le Monitor et dans
  l’indicateur de réflexion (masquée aux lecteurs d’écran pour ne pas
  annoncer chaque seconde).
- **Sorties numérotées** : une ligne par élément texte, numéros non
  sélectionnables, retrait suspendu pour les lignes longues.
- **Chemin d’attaque** : les liens du chemin retenu défilent en pointillés vers
  la cible ; « Rejouer » parcourt le chemin nœud par nœud (crochets verrouillés,
  liens allumés, reste du graphe atténué, étape annoncée), « Arrêter »
  l’interrompt.

## Progression de la mission et rapport

- **Rail de progression** sous l’en-tête du chat : Repérage, Analyse, Action,
  Rapport. Phase faite cochée en signature, phase en cours teintée (orange en
  attente d’accord), `aria-current="step"` et état écrit pour les lecteurs
  d’écran. Sous 420 px, seules les marques restent, sauf la phase en cours.
- **Rapport** : carte alignée sur les réponses, barre de répartition, résumé
  chiffré et constats avec pastille de gravité écrite.
- **Gravité** : échelle `--jn-sev-critical` à `--jn-sev-info` construite sur
  les couleurs d’état du thème ; le libellé porte toujours le sens.

Données de démonstration : `mission` et l’élément `report` dans `src/demo.mjs`.

## À reprendre dans le cockpit (production)

Le formulaire « Nouveau conteneur » vit dans `packages/vscode/media/cockpit.js`
(branche `main`), hors de cet atelier. Les styles sont prêts dans
`media/chat.css` (`.cockpit-create-head`, `.cockpit-create-close`, état ouvert
de `#cockpit-create-toggle`). Ajout proposé dans `renderCreate`, à la place de
`section.append(heading("Créer un conteneur"))` :

```js
const head = el("div", "cockpit-create-head");
const close = button("ghost cockpit-create-close", "Replier le formulaire", "caret", () => {
  form.open = false;
  rerender();
  document.getElementById("cockpit-create-toggle")?.focus();
});
close.setAttribute("aria-controls", "cockpit-create");
close.querySelector(".btn-text")?.remove();
head.append(heading("Créer un conteneur"), close);
section.append(head);
```

Le bouton n’existe que quand le formulaire est ouvert, garde son nom
accessible (`aria-label`) et rend le focus à « Nouveau conteneur ». Aucun
protocole ni donnée ne change.

## Pictogrammes et mouvement

`media/icons.js` est la source unique des tracés : les pages HTML ne contiennent
que des emplacements `<svg data-icon="…">`, remplis au chargement, et un test
vérifie que chaque nom existe. Le cerveau du raisonnement est un pictogramme plein (grille 256) repris
d’un fichier fourni (« brain generator idea », SVG Repo, CC Attribution :
crédit et modifications dans `media/ATTRIBUTIONS.md`, auteur, URL et version
de licence encore à compléter) : contours et rayons en couleur du texte, fonds retirés,
éclair en couleur de signature (`.ico-accent`, couleur du texte en contraste
élevé). Les micro-interactions (flèche d’envoi qui
décolle, historique qui remonte, nouvelle conversation qui pivote, noyau qui
respire et orbite qui tourne pendant l’activité, logo qui se trace à l’accueil) sont regroupées
en fin de `media/chat.css` et désactivées en mouvement réduit et en contraste
élevé.

## Conventions

- Variables `--vscode-*` pour intégrer les thèmes de l’éditeur.
- Icônes SVG locales et textes accessibles pour les boutons sans libellé visible.
- Titres et sorties insérés comme texte, sans interprétation HTML.
- Sélection et filtres réversibles, états en attente visibles, erreurs compréhensibles.
- Mouvement discret et prise en charge de la réduction des animations.

## Réintégration

Le nom de fichier `media/chat.css` et les classes des composants (notamment
`.msg`, `.tool`, `.card`, `.mon-*`, `.studio-*`, `.kc-*`) sont conservés pour
faciliter la reprise des ajustements visuels. Les identifiants du scénario et
les noms des événements de démonstration appartiennent à ce prototype : reprendre
les changements de comportement après revue, sans remplacer le moteur de
l’application par la simulation.

Préférer un commit par lot visuel cohérent, avec vues touchées et validations
exécutées dans son compte rendu. Les aperçus du navigateur utilisent une palette
approchée ; vérifier le résultat natif avec F5 dans VS Code avant de valider un thème.

## Validation du point de départ

- Vérification syntaxique des sources et cinq tests : scénarios, pages, messages,
  annotations du graphe, CSP et pont VS Code simulé.
- Vingt-neuf parcours Chromium : quatre vues, trois thèmes, largeur 320/1000 px,
  cinq scénarios supplémentaires et absence de requête vers un service externe.
- La fenêtre de développement VS Code native reste à vérifier sur le poste avec F5.
