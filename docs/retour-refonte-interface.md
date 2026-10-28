# Retour d’intégration — refonte de l’interface

Source initiale : `design/ui-vscode`, commit `4565ce6` (0.3.53).
Seconde passe : commits `11543e8` à `d72f0e0` (0.3.55), intégrés sur `main`.
Troisième passe : commits `122139c` et `6281a6b` (0.3.56).
Quatrième passe : commits `4957feb`, `432778e` et `834cff1` (0.3.58).

## Cinquième passe — 0.3.59

Source : commits `062363a`, `9a7d062` et `7749b8f` de `design/ui-vscode`.
Multicolore passe à six teintes (corail, vert, cyan, bleu, violet et rose) : le
jaune et l’orange sont retirés des décorations de ce jeu. Le curseur reçoit
un dégradé animé à son dernier niveau disponible, dans toutes les palettes.

Adaptations conservées : vrai conteneur des messages pour le cycle des liserés,
ids de navigation de production, texte du Monitor lisible, cyan clair corrigé,
compteurs réels et choix de palette confirmé par l’hôte. Le dégradé reste fixe
en mouvement réduit, revient à la couleur du thème en contraste élevé/couleurs
forcées et se suspend dans une vue masquée. Auto ne lance pas l’animation. Le
niveau est calculé depuis le catalogue et les variantes disponibles, sans
changer la sélection envoyée au moteur ni inventer un niveau supplémentaire.
Les consignes agents, confirmations natives et fonctions précédentes restent
conservées.

## Quatrième passe — 0.3.58

Repris : page Apparence, cartes avec aperçus de chaque jeu, choix au clavier,
Multicolore et ses huit teintes réparties dans les vues. La palette Bastion est
retirée comme dans la maquette ; une ancienne valeur retombe sur Sentinelle,
sans effacer ni réécrire automatiquement le réglage utilisateur.

Adaptations :

- Les messages utilisent le protocole réel : demande `setPalette` validée par
  liste blanche et sans champ supplémentaire ; confirmation `palette` avec
  `value`. L’enregistrement passe par `warband.palette`, au même niveau global
  ou workspace que la commande native. Aucun rechargement de webview.
- La carte n’annonce pas un choix enregistré avant confirmation de l’hôte.
  Les demandes concurrentes sont ignorées pendant l’attente ; une erreur
  rétablit le réglage réel et permet de réessayer. Le focus clavier est conservé.
- Les aperçus ont leurs propres variables de palette. La cascade du thème clair
  est corrigée pour Éditeur et Multicolore. Les corrections de contraste de
  Braise et de l’accent Éditeur précédemment livrées sont conservées ; le cyan
  clair de Multicolore est légèrement assombri. Les libellés de conteneur restent
  dans la couleur du texte, avec un fond teinté stable pour la lisibilité.
- Le contraste élevé utilise les couleurs natives, y compris dans les aperçus.
  Les états du Monitor, des erreurs et du Bypass gardent leurs couleurs. Les
  repères du rail correspondent aux compteurs réels, pas à des phases inventées.
- Les sélecteurs de démonstration `spaces` / `graph` sont adaptés à `containers`
  / `killchain`. Un doublon de couleur de navigation est supprimé.
- Le crédit du cerveau externe ajouté dans `4957feb` est encore incomplet :
  auteur, URL d’origine et version de licence restent « à compléter/confirmer ».
  Ce SVG et l’affirmation d’attribution finalisée ne sont pas distribués ; le
  dessin original reste en place. Compléter ces trois références avant reprise.
- Les exemples et le harnais de démonstration restent sur leur branche. Les
  confirmations natives corrigées et les consignes communes de la 0.3.57 sont
  conservées.

## Troisième passe — 0.3.56

Repris : menu Configurer compact, titres conservés pour les lecteurs d’écran,
texte fournisseur dépliable au clic / Entrée / Espace, descriptions d’effort
complètes en infobulle, interrupteurs resserrés et retrait du badge « À vérifier »
des cartes. Les pastilles décrivent seulement les caractéristiques de la demande.

Adaptations :

- L’avertissement complet du Bypass reste visible. Le masquage dans une infobulle
  proposé sur la branche n’est pas repris. Le menu conserve le défilement interne
  lorsque la fenêtre ou le zoom l’exige ; sa hauteur n’est pas supposée fixe.
- La navigation Tab inclut désormais le sélecteur de fournisseur et le nouveau
  texte dépliable. Ces éléments étaient absents du parcours de focus du prototype.
- L’état du Bypass, abrégé visuellement sur une ligne, conserve son texte complet
  dans `role=status` et son infobulle dynamique. Le compteur, l’échéance et l’aura
  corrigés en 0.3.55 restent en place.
- La protection contre les doubles réponses d’une carte et le cache DOM de
  production sont conservés. Le prototype n’intègre pas tous ces garde-fous ;
  ses fonctions d’autorisation ne sont donc pas recopiées intégralement.
- La revue a révélé une carte figée après annulation de « Toujours ». Elle affiche
  maintenant « Confirmation native en cours… », sans prétendre à une autorisation,
  puis redevient utilisable si le dialogue est annulé ou échoue. Une confirmation
  périmée ne peut pas répondre à une nouvelle carte, même de même identifiant.
- Les suppressions de l’appui maintenu déjà réalisées en 0.3.54 ne sont pas un
  nouveau chantier ; l’option reste absente.

## Seconde passe — 0.3.55

Repris : en-tête transparent et surface du Monitor, suppression du contour au
clic souris avec conservation des indicateurs clavier, retrait de l’éclair du
curseur d’effort, nouveau cerveau original, bouton de repli du formulaire de
conteneur, Bypass magenta avec aura et compte à rebours.

Adaptations et éléments écartés :

- Les identifiants de démonstration `automatic` sont raccordés au vrai Bypass.
  Le clic ne change pas l’état actif par anticipation. L’attente de confirmation
  est distincte du mode actif ; l’apprentissage annule tous ces indicateurs.
- Le compte à rebours utilise seulement `expiresAt` transmis par le moteur.
  Il ne crée ni ne prolonge une autorisation. Une seule échéance de rendu est
  conservée, au plus toutes les 15 secondes et exactement à expiration. Le
  minuteur s’arrête au masquage et à la fermeture de la vue.
- À l’échéance, l’interface retire l’indication active même si le prochain
  message de l’hôte n’est pas encore reçu. La gate reste seule responsable des
  autorisations. La durée n’est jamais inventée dans l’interface.
- Le magenta est mélangé au premier plan du thème pour préserver le contraste
  du badge. Le compteur utilise le texte du thème pour rester lisible sur la
  jauge. Le contraste élevé, les vues masquées et le mouvement réduit arrêtent
  aussi l’animation portée par le pseudo-élément de la page.
- Le SVG externe « brain generator idea » du dernier commit n’est pas distribué :
  `DESIGN.md` indique que sa licence reste à confirmer. Le dessin original de
  `c874a10` est repris à sa place ; les branches du catalogue et styles réservés
  à ce SVG externe sont écartés. Pour le reprendre ultérieurement, fournir son
  URL d’origine et la licence exacte autorisant la redistribution.
- La recommandation de colorer la barre d’état native n’est pas reprise : son
  fond d’avertissement natif est conservé. Les webviews utilisent l’aura magenta.
- Le repli du formulaire ne crée aucune ressource, conserve les champs saisis
  et rend le focus à « Nouveau conteneur ».
- L’appui maintenu reste supprimé conformément à la demande pour la 0.3.54.
  Le harnais et les données fictives restent sur la branche de design.

## Correction demandée après intégration — 0.3.54

L’option « Appui maintenu » et son comportement sont supprimés à la demande du
propriétaire. Les autorisations reviennent au clic simple. Ne pas réintroduire
ce réglage lors d’une prochaine passe graphique. Les mentions ci-dessous
retracent l’intégration initiale de la 0.3.53.

## Éléments repris

La direction « Acier et signature », les polices Geist et Geist Mono et leurs
licences locales, les cinq palettes, la marque et ses animations, les cartes
d’approbation avec appui maintenu, le curseur d’effort, les réglages, le Monitor
avec frise et numérotation, la navigation clavier du graphe, son rejeu visuel,
le rail d’activité et les cartes du rapport.

## Modifications effectuées pendant l’intégration

- Les contrats de démonstration sont remplacés par les fournisseurs, projets,
  conteneurs, messages et contrôles réels. Le harnais fictif reste sur sa branche.
- Le rail mesure l’activité de la page, sans inventer une progression de mission.
  L’horloge part du début réel du tour, pas du chargement de l’interface.
- L’aperçu du rapport utilise les notes du projet actif. Identifiants et loot sont
  exclus ; aucune gravité n’est attribuée automatiquement. Le bouton exporte
  le brouillon Markdown réel par le dialogue natif.
- Le rejeu reste purement visuel. Changement de projet, masquage et Échap l’arrêtent.
- Les cartes d’approbation conservent leur DOM pendant les mises à jour : le flux
  n’annule plus l’appui maintenu par une perte de focus artificielle. Les
  validations périmées sont annulées et une seule réponse peut être envoyée.
- Les badges indiquent des caractéristiques de la demande, pas une estimation
  de sécurité. La gate et la confirmation native « Toujours » restent actives.
- La pagination et les optimisations de la 0.3.52 sont conservées. La numérotation
  des sorties est bornée ; au-delà, leur texte reste intégral dans la limite
  déjà imposée par le moteur. Les animations sont suspendues en page masquée.
- Les textes secondaires et le cramoisi sombre ont été éclaircis après mesures
  de contraste. Les thèmes contrastés et le mouvement réduit restent respectés.
- Le changement de palette se fait sans rechargement ni perte du brouillon.

## Questions pour une éventuelle prochaine passe

Aucune question ne bloque cette intégration.

1. Si le rail doit représenter une véritable progression de mission, proposer
   d’abord un contrat de données et les états observables nécessaires. Le calcul
   ne doit pas reposer sur une succession de libellés fictifs.
2. Pour un rapport avec gravités, préciser un futur contrat comprenant preuves,
   justification, remédiations et validation. Conserver « À évaluer » en l’absence
   de données ; ne pas déduire la gravité du type de nœud ou de son état.
3. Une harmonisation ultérieure du SVG exporté peut reprendre cette charte, en
   préservant tous les noms, liens et éléments, indépendamment du cadrage et des
   filtres de la vue. L’export complet existant est conservé dans cette version.
4. Une recette sur VS Code Windows natif reste utile pour les polices, les
   couleurs de thème et le clavier avec les aides d’accessibilité.

Pour toute reprise graphique : rester sur `design/ui-vscode`, ne pas fusionner
`main`, ne pas modifier les protocoles ou simuler de nouvelles données de
production, et documenter les nouvelles sources de données nécessaires.
