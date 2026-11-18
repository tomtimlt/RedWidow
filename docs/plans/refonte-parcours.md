# Refonte des parcours RedWidow

Proposition pour la branche `multi-agent`, établie sur le commit `4b10d93`.

## Ce qui coince

Sur la capture fournie, un appel de clôture a échoué et le chat affiche encore « Réflexion » après 2 h 44. L’échec concerne un appel. La capture seule ne permet pas de déterminer comment le processus s’est terminé. Dans la version examinée, `activityLabel` affiche « Réflexion » par défaut et l’horloge part de `turnStartedAt`. Elle mesure la durée du tour. Voir [le libellé](../../packages/vscode/media/ui.js) et [l’horloge](../../packages/vscode/media/chat.js).

Le lanceur de la barre d’état regroupe Chat latéral, Nouveau chat, Cockpit, Monitor, Kill chain et Réglages. Pour retrouver un rapport, l’utilisateur doit connaître une commande ou une autre vue. Voir [openLauncher](../../packages/vscode/src/extension/extension.ts) et [les commandes du manifeste](../../packages/vscode/extension.manifest.json).

Une idée à reprendre d’ARTEX est la séparation entre le déroulement d’une tâche et les résultats accompagnés de leurs preuves. Dans RedWidow, le journal et le rapport couvrent déjà ces besoins. [Présentation d’ARTEX](https://github.com/BaaRai/ARTEX#readme)

## Lots et critères de réception

1. **Lire l’état du chat.** Afficher le fait connu le plus utile, par exemple un arrêt demandé ou un accord attendu. Employer « Tour ouvert » quand seul le début du tour est connu. Identifier l’horloge comme durée du tour. En rouvrant un historique, on doit pouvoir relire le fil sans animation de travail en cours. Vérifier les transitions et les traductions. Le lecteur d’écran doit pouvoir annoncer un changement d’état sans annoncer chaque seconde.
2. **Retrouver une vue depuis le lanceur.** Organiser les destinations existantes par usage, en conservant les noms que les habitués recherchent. Donner accès aux conversations, au journal d’audit, à l’aperçu du rapport et aux réglages depuis le même point d’entrée. L’aperçu doit laisser l’utilisateur lire avant de choisir d’exporter. Vérifier la sélection au clavier et la disponibilité des entrées même lorsque la liste des conteneurs est vide.
3. **Valider les parcours à partir d’historiques.** Utiliser des données fictives en lecture seule. Sur un tour arrêté, demander à un lecteur d’indiquer ce qui a été interrompu. Sur une erreur isolée, lui faire retrouver l’entrée du journal. Sur une conversation terminée, lui faire ouvrir le rapport. Relever le chemin emprunté, les retours en arrière et les conclusions erronées. Pour un incident réel, comparer la dernière entrée horodatée du journal expurgé avec l’état affiché au même instant. Qualifier la cause d’inconnue quand il manque l’événement de fin.

Pour la revue visuelle, reprendre les largeurs de 280, 360, 520 et 900 px, les thèmes et les contrôles clavier de la [charte d’interface](../design-interface-2026.md). Une fois ces parcours observés, utiliser les hésitations relevées pour prioriser les écrans suivants.
