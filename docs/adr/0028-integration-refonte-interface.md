# ADR 0028 — Intégration de la refonte de l’interface

Statut : accepté et implémenté pour la 0.3.53. Lecture, décision, intégration
et revue dans la session principale, sans sous-agents à la demande du propriétaire.

## Amendement 0.3.54

À la demande du propriétaire, l’appui maintenu est supprimé, ainsi que son
réglage, son état local et ses animations. Les trois boutons répondent au clic
simple et au clavier ; « Toujours » conserve sa confirmation native et la gate
ses contrôles. Les mentions du maintien ci-dessous décrivent la 0.3.53.

## Contexte

La branche autonome `design/ui-vscode`, inspectée au commit `4565ce6`, propose
une nouvelle direction artistique sur des données simulées. Son historique est
indépendant de `main` et ses contrats de démonstration ne sont pas ceux du moteur.
Une fusion brute réintroduirait des fournisseurs fictifs et remplacerait des
fonctions de production, notamment la pagination et les contrôles de projet.

## Décision

Porter les composants visuels et les interactions dans les fichiers de production,
sans fusionner le harnais de démonstration. La charte « Acier et signature »
remplace les prescriptions visuelles antérieures contradictoires : Geist et
Geist Mono locales sous OFL, surfaces neutres, rails de couleur, rayons 8/12/18,
pilules, nouvelle marque et cinq palettes. Le code conserve la police de l’éditeur.

La préférence `warband.palette`, validée par liste blanche, est mise à jour dans
les vues ouvertes sans rechargement. Les thèmes clair, sombre, contrasté et le
mouvement réduit restent pris en charge. Les animations sont suspendues dans
les pages masquées ; aucune police ni bibliothèque distante n’est chargée.

L’appui maintenu de 900 ms est une prévalidation d’interface, désactivable dans
Configurer → Exécution pour revenir au clic simple. Il n’accorde aucune permission lui-même : les
messages et la gate existants restent seuls responsables du verdict. Une seule
réponse est envoyée ; retrait de carte, changement de conversation, perte de
focus, relâchement et page masquée annulent l’attente. Les cartes inchangées
conservent leur nœud DOM pour ne pas perdre le focus pendant le flux. « Toujours »
conserve la confirmation native et ses contrôles existants. Les repères affichés
sont descriptifs ; aucun niveau de risque n’est déduit d’une icône.

Le rail du chat compte les messages, outils et accords réellement visibles dans
la page courante. Il ne déduit pas des phases de mission. L’horloge mesure le
tour actif depuis sa date connue par ChatState ; elle ne mesure pas une mission.
Le Monitor conserve la pagination, les caches bornés et les détails à la demande.
Sa numérotation est limitée à 80 lignes par sortie et 2 000 lignes par page ; les
autres sorties sont affichées comme texte, sans troncature supplémentaire.

Le rejeu de la Kill Chain visualise seulement les liens du chemin retenu. Il
n’exécute aucune action et s’arrête sur changement de projet, nouvelle vue,
masquage ou Échap. Les exports SVG complets et Markdown restent générés par
l’hôte avec les contrôles natifs d’écriture existants.

L’aperçu de rapport affiche les notes réelles du projet actif, en excluant les
identifiants et le loot comme l’export Markdown. Toutes les gravités sont
« À évaluer ». Il s’agit d’un instantané à la demande, pas d’un audit validé ni
d’une intégration SysReptor. Un changement de projet ferme cet aperçu et invalide
les réponses périmées. La webview ne peut demander que l’export du projet lié.

## Validation et limites

Tests des protocoles, de la CSP, des palettes, des données du rapport, de
l’appui maintenu et de ses annulations, des contrastes et des ressources locales.
Parcours Chromium sur les gabarits de production : cinq vues, trois thèmes,
largeurs 280/360/1 000 px, clavier, palettes, maintien pendant les mises à jour,
isolation, rejeu, export et mouvement réduit. Aucun fournisseur payant sollicité.

Les contrôles du moteur, des adaptateurs, du magasin de secrets et de TLS restent
inchangés. La recette native Windows et le problème historique des autorités
HTTPS système restent à confirmer sur le poste utilisateur. Les compteurs ne
représentent pas toute une conversation lorsqu’une seule page d’archives est lue.
