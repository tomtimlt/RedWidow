# Cadre de design

L’atelier reprend les composants visuels existants : barre de conversation,
cartes de tâches et de validation, menus de modèles et de configuration,
Monitor et graphe avec minimap, légende dépliante et filtres.

## Objectif

Améliorer la cohérence des espacements, la lisibilité, les hiérarchies visuelles,
le rendu des états vides et des longues sorties, et le confort en fenêtre étroite.
Le graphe doit rester agréable à parcourir au clavier, à la souris et au zoom.

## Direction artistique : « Acier et braise »

- **Acier** : surfaces neutres tirées du thème (voiles `--jn-raise` et
  `--jn-raise-2` mélangés au premier plan), filets fins `--jn-line`, ombres
  réservées aux menus et panneaux flottants.
- **Liseré** : un trait vertical de 2 px (`--jn-rail`) signale l’état des
  blocs : message envoyé, validation, entrée du Monitor, bandeaux, projet actif.
  Les éléments en pilule (rubrique, filtre, option) marquent la sélection par
  un fond teinté.
- **Braise** : le cramoisi de la marque (`--jn-brand`) reste rare : logo, trait
  sous la marque, fil d’activité de l’agent. L’interaction suit l’accent
  (`--jn-accent`) et le focus (`--jn-focus`) du thème.
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

Les jetons sont définis en tête de `media/chat.css` et redéfinis pour les
thèmes clair et contraste élevé ; les composants n’utilisent pas de couleur fixe
hors marque et repli du chemin retenu.

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
