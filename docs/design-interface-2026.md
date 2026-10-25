# Interface Warband — refonte du 25 octobre 2026

## Décision

Les trois captures fournies par le propriétaire servent de référence pour la
densité, la hiérarchie et la finition de toute l’interface. Warband adopte une
présentation sobre intégrée à VS Code : surfaces neutres, typographie lisible,
icônes SVG fines, outils compacts et commandes regroupées. Cette décision
remplace les prescriptions visuelles historiques contradictoires de
`design-chat-ui.md` et `design-studio-ui.md`, selon les points ci-dessous.

Le parcours reste **Projet → Conteneurs → Chat → Approbations → Résultats**.
Les captures ne rendent pas disponibles des fonctions absentes : aucune
persona, jauge de contexte, licence, vitesse ou mode Plan/Answer n’est ajouté
pour remplir une rubrique.

## Langage visuel commun

- Surfaces : `editor-background`, `sideBar-background`, `editorWidget-background`
  et `input-background` du thème. Supprimer le bandeau noir forcé et les grands
  aplats de marque. Utiliser un seul niveau de surface surélevée pour les menus.
- Accent courant : couleurs des boutons et liens VS Code ; généralement bleu
  dans les thèmes de référence. Rouge/acier réservés à la marque discrète ;
  rouge sémantique aux actions destructrices et erreurs réelles. L’absence
  d’Exegol dans un projet Kali n’est pas un état d’erreur.
- Texte : police d’interface VS Code à 13 px ; titres locaux 13–14 px et graisse
  600 ; métadonnées 11–12 px ; code seul en police d’éditeur. Les capitales ne
  servent qu’aux petits libellés de section.
- Espacement : grille 4/8/12/16/24 px. Bordures fines et contrastes de surface
  remplacent les grands encarts. Rayons 6 px pour contrôles et lignes, 8 px
  pour menus, 10–12 px pour composer et message utilisateur.
- Icônes : SVG locaux, grille 24, taille habituelle 16 px, trait cohérent
  d’environ 1,5–1,75 px, extrémités arrondies, `currentColor`. Pas d’emoji,
  de symbole Unicode décoratif ou de ressource distante. Les icônes décoratives
  sont masquées aux lecteurs d’écran ; chaque bouton conserve son nom accessible.
- États : succès, avertissement et erreur utilisent les couleurs sémantiques
  du thème. Un état inconnu reste neutre. La sélection ne doit pas se confondre
  avec le succès. Hover discret, focus clavier visible ; pas d’animation décorative.

## Chat et réponses

La barre supérieure est compacte : marque, contexte disponible, historique et
nouvelle conversation. Les actions secondaires sont discrètes ; les textes
longs se tronquent sans déplacer les boutons.

Le message utilisateur est un panneau légèrement teinté, aligné sur la colonne
de lecture, avec une bordure discrète. Les réponses de l’agent sont de la prose
sur le fond du chat, avec une hiérarchie Markdown nette. Aucun nom de modèle,
temps de réflexion ou coût supposé n’est ajouté à une réponse.

Un appel d’outil est une ligne pliable avec chevron, icône de famille, nom et
résumé de commande. L’état reste visible, mais n’est pas répété dans plusieurs
badges. La zone dépliée distingue entrée et sortie ; les longs résultats ont
un défilement borné et un indicateur de troncature. Les erreurs Kali décodées
restent du texte sûr, avec stderr, code de retour et résultats partiels.

Le composer comporte la saisie puis une barre compacte. Le modèle est repérable
à gauche, Configurer et Envoyer/Arrêter à droite ; mentions et terminaux restent
accessibles sans multiplier les pastilles. La bordure active est celle du
focus. Une approbation en attente et un Bypass actif restent des états distincts.

## Configurer

Le menu regroupe les fonctions réellement câblées : raisonnement, fournisseur,
apprentissage et approbations. Les accès aux vues existantes ne doivent pas
afficher un faux état de sélection. Pas de ligne factice pour reproduire une
fonction des captures.

À partir de 420 px disponibles, deux colonnes équilibrées séparent raisonnement
et exécution. En dessous, le menu passe sur une colonne. Sa largeur ne dépasse
jamais la vue moins 16 px et sa hauteur est bornée avec défilement interne.
Les interrupteurs ont des états visuels nets, une étiquette et leur sémantique
accessible. L’avertissement du Bypass reste lisible et conforme à l’ADR 0017.

## Conteneurs et réglages

La navigation comporte les cinq rubriques utilisables, chacune avec une icône
SVG et un libellé. L’élément courant porte un fond neutre et un indicateur de
sélection ; pas de pastilles d’état inventées.

Les conteneurs sont des lignes compactes : chevron, état, nom, famille/image,
association et actions. Les chemins et détails sont repliables. Démarrer,
arrêter, terminal et association restent des actions existantes, clairement
nommées, désactivées avec une raison lorsque nécessaire. Le contexte du projet
actif apparaît au-dessus de la liste, sans grande carte concurrente.

La création s’ouvre depuis **Nouveau conteneur** ; le formulaire complet n’est
pas affiché en permanence. Nom, image, choix de dossier et validation sont
regroupés dans une surface lisible. La préparation du serveur Kali reste
visible dans la progression native et ses erreurs restent consultables.

La page Projet distingue sélection du projet, dossier et mémoire de projet.
Atlas, Monitor, historique et contrôle système reprennent les mêmes titres,
icônes, lignes et états vides. La Kill chain conserve ses nœuds circulaires,
sa minimap et la préservation de caméra introduites en 0.3.24.

## Largeurs et accessibilité

| Largeur | Comportement attendu |
|---|---|
| 280 px | Une colonne ; boutons secondaires en icônes nommées ; métadonnées repliées ou tronquées ; aucun débordement horizontal |
| 360 px | Priorités modèle, saisie et envoi visibles ; Configurer peut garder un libellé court |
| 520 px | Menu Configurer en deux colonnes si l’espace réel le permet ; lignes de conteneurs avec détails sur une seconde ligne |
| 900 px et plus | Colonne de lecture centrée de 720–820 px ; réglages et conteneurs plus larges sans étirer indéfiniment la prose |

Les libellés de navigation et les boutons de formulaire restent visibles en
mode compact ; les règles qui masquent le texte des boutons du chat ne doivent
pas s’appliquer à tout le studio. Les menus respectent le focus, Échap et les
dimensions de la vue. Les thèmes clair, sombre, contraste élevé et couleurs
forcées gardent un focus et des séparateurs visibles. Mouvement réduit respecté.

## Critères de livraison

Vérifier les écrans accueil, conversation, outil ouvert, approbation, Configurer,
historique, Monitor, Projet, conteneurs et création ouverte. Contrôler les
largeurs ci-dessus, les trois thèmes et la navigation clavier. Les actions,
états et messages doivent rester ceux du moteur ; CSP et rendu en texte sûr
restent en vigueur. Les modifications sont évaluées sur les captures réelles
de la nouvelle interface, en plus des contrôles automatisés.

## Ajustements demandés pour la 0.3.26

Envoyer et les voyants d’état sont circulaires. Le réglage d’effort est un
véritable slider natif avec piste remplie, pouce rond, souris et clavier ;
seuls les niveaux compatibles avec le modèle sont proposés, Auto reste
séparé. La police Inter variable est embarquée avec sa licence OFL, chargée
localement sous la CSP (font-src limité à l’origine de la webview).
La page Projet garde un bandeau actif nom/dossier, puis sépare le choix et
la création par deux panneaux. Le contexte actif reste dans la navigation.
