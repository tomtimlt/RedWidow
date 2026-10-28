# Retour d’intégration — refonte de l’interface

Source inspectée : `design/ui-vscode`, commit `4565ce6`.
Intégration de production : 0.3.53, sur `main`.

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
   couleurs de thème, le clavier et l’appui maintenu avec les aides d’accessibilité.

Pour toute reprise graphique : rester sur `design/ui-vscode`, ne pas fusionner
`main`, ne pas modifier les protocoles ou simuler de nouvelles données de
production, et documenter les nouvelles sources de données nécessaires.
