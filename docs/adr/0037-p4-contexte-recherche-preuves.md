# 0037 — Continuité, recherche explicite et références de mission

- Statut : accepté
- Date : 2026-11-06
- Lot : P4, livraison 0.3.73

## Décision

La fenêtre affichée du chat demeure bornée à 60 éléments. Elle ne définit pas la
mémoire transmise lors d’un changement de fournisseur : le transfert relit les
journaux de la conversation, conserve l’objectif initial et une fin bornée, puis
fusionne la fin encore visible pour couvrir un retard d’écriture. Les omissions
et lectures incomplètes sont signalées. Les données historiques ne rejouent ni
outil ni approbation et ne donnent aucune nouvelle autorisation.

La disponibilité des outils Web et la demande de recherche pour le prochain
message sont deux choix distincts. L’intention est validée par l’IPC. Le moteur
contrôle des résultats d’outils réellement observés ; il ne peut pas établir la
pertinence d’une source par la seule réussite technique d’une requête. L’échec
ou l’annulation restent visibles et les états de recherche sont journalisés.
L’apprentissage conserve son contrat de lecture seule et ses outils limités.

L’arrêt d’un moteur laisse un délai de grâce puis utilise la terminaison de
l’arbre de processus existante. Les outils dont le suivi n’a pas abouti sont
interrompus ou d’état inconnu. Cette sortie ne prouve jamais l’arrêt des tâches
détachées dans un conteneur ; leur état doit être revérifié avant toute relance.

Les exports peuvent partager une coupe identifiée des notes, des références de
preuves et des contrôles Audit disponibles. Cette coupe est une projection de
lecture non atomique, pas une nouvelle base de données ni une certification des
conclusions de l’agent. Les références manquantes et les limites de collecte
restent explicites. Le rapport demeure un brouillon lorsque ses champs ou ses
preuves sont incomplets.

Le profil `red-team` devient Red Team — Expert. L’identifiant, la génération
canonique du skill et le chargement des sections à la demande sont conservés.
Le profil n’active aucun modèle, effort ou droit supplémentaire. Ses effets sur
les résultats d’un modèle nécessitent une évaluation comparative distincte des
tests de câblage et des recettes synthétiques.

## Validation et limites

La recette P4 rassemble les contrôles ciblés, la vérification complète et les
recettes navigateur et Docker. Aucun test de contrat facturé n’est automatique.
Les essais natifs Windows et Exegol restent distincts de l’inspection des VSIX.
