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
- **Typographie** : Inter pour l’interface, police de l’éditeur pour les
  données ; étiquettes en capitales mono espacées (`--jn-fs-2xs`,
  `--jn-track`) comme repère commun ; chiffres tabulaires.
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

## Réflexion dans le chat

Logo animé, libellé balayé de lumière, trois points qui sautent et liseré
lumineux qui parcourt le haut du compositeur. En attente d’accord : tout passe
en couleur d’alerte et s’immobilise.

## Curseur d’effort

Carte compacte : pictogramme à gauche, niveau centré en couleur de signature
avec le modèle en dessous (ouvre le menu Modèle), retour à Auto à droite.
Piste épaisse en pilule, remplissage de signature, un point par niveau et
grande pastille claire. Le glisser est continu, le relâchement se cale sur le
niveau le plus proche avec un rebond ; le clavier passe de niveau en niveau.

## Palettes

Réglage `warbandDesign.palette` ou commande **Warband UI : choisir une
palette** ; sélecteur « Palette » dans l’aperçu navigateur. Chaque palette a un
ton pour les thèmes sombres et un ton plus foncé pour les thèmes clairs.

| Palette | Sombre | Clair | Intention |
| --- | --- | --- | --- |
| Sentinelle (défaut) | `#3cc7c0` | `#0b7a82` | sarcelle et ardoise : veille, terminal, sécurité |
| Braise | `#f0506e` | `#c41a3d` | cramoisi et acier, marque d’origine ; proche du rouge d’erreur |
| Bastion | `#f28c4b` | `#b04f12` | cuivre et graphite, chaleur d’atelier |
| Spectre | `#a990ff` | `#6741d9` | violet et glace, distinct de toutes les couleurs d’état |
| Éditeur | accent du thème | accent du thème | intégration maximale avec n’importe quel thème |

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

## Pictogrammes et mouvement

`media/icons.js` est la source unique des tracés : les pages HTML ne contiennent
que des emplacements `<svg data-icon="…">`, remplis au chargement, et un test
vérifie que chaque nom existe. Les micro-interactions (flèche d’envoi qui
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
