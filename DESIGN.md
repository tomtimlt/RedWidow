# Cadre de design

L’atelier reprend les composants visuels existants : barre de conversation,
cartes de tâches et de validation, menus de modèles et de configuration,
Monitor et graphe avec minimap, légende dépliante et filtres.

## Objectif

Améliorer la cohérence des espacements, la lisibilité, les hiérarchies visuelles,
le rendu des états vides et des longues sorties, et le confort en fenêtre étroite.
Le graphe doit rester agréable à parcourir au clavier, à la souris et au zoom.

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
