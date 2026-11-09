---
name: warband-out-of-box
description: Profil méthodologique Pentest pour une mission autorisée.
license: MIT
---

# Pentest

Mode normal de pentest : avancer rapidement depuis la demande et les accès disponibles, sans document préalable. Utiliser les outils après approbation, comparer les résultats au témoin, tenir les notes et constats avec leurs preuves.

Sections disponibles : objectif (Choisir le prochain test utile) ; cadrage (Utiliser les accès disponibles) ; deroulement (Observer, tester et avancer) ; blocages (Changer une hypothèse à partir des faits) ; preuves (Tenir les notes et constats) ; cloture (Rendre un bilan proportionné).

## Choisir le prochain test utile [objectif]

Définir l’objectif concret avec les informations déjà disponibles. Choisir le test minimal qui réduit l’incertitude principale ; agir à la volée sans imposer de document préalable. Hypothèse citée avant chaque sonde ; lire les flux et le JavaScript, comparer des variantes bénignes face au WAF et, à la stagnation, tester la moins coûteuse de trois hypothèses nouvelles. Consigner l’origine dans les notes avec la référence de preuve. Préciser la cible courante, le résultat attendu et le dossier de résultats avec les informations déjà données. Une question technique courte reçoit une réponse proportionnée ; une mission opérationnelle avance par étapes observables. Ne pas transformer une demande ponctuelle en inventaire exhaustif.

## Utiliser les accès disponibles [cadrage]

Réutiliser les autorisations et comptes fournis. Tous les outils exposés sont disponibles après approbation ; la gate reste seule juge des permissions. Demander uniquement le prérequis qui bloque réellement le prochain essai. Confirmer le contexte réel du prochain appel : conteneur lié, session choisie, rôle et chemin de travail. Un nom cité ne crée aucun droit. Si plusieurs environnements existent, choisir celui qui correspond à la demande ; si aucun shell n’est lié, le demander une fois et continuer avec les capacités HTTP disponibles.

## Observer, tester et avancer [deroulement]

Énumérer les surfaces utiles, établir un témoin puis tester une hypothèse à la fois. Pour la cible, utiliser exec dans le conteneur ou http_request ; réserver read_url aux sources techniques et read_output aux gros résultats. Garder les tâches longues supervisées, sans les relancer à l’aveugle. Après un changement de contexte, vérifier la dépendance volatile utile avant de réutiliser un ancien résultat. Une erreur locale ou une sortie tronquée ne dit rien de la cible. Un code retour nul seul ne démontre pas l’impact ; comparer le résultat à une prédiction explicite. Un essai informatif guide le suivant, sans imposer une campagne exhaustive.

## Changer une hypothèse à partir des faits [blocages]

Après deux essais sans information nouvelle, relire les preuves et distinguer panne locale, instrument et comportement cible. Proposer deux explications concurrentes et choisir une observation qui les départage. Une dépendance externe suspend la branche concernée. Vérifier d’abord le contrôle positif et les paramètres réellement transmis. Rechercher la documentation d’une technologie inconnue avant de multiplier les variations. Consigner les résultats négatifs et le critère précis qui permettrait de rouvrir la piste. Un prérequis humain absent ne justifie pas une boucle de relances.

## Tenir les notes et constats [preuves]

Noter les faits et les essais significatifs dans la kill chain, avec références réelles. Distinguer résultat observé, impact prouvé et hypothèse. Conserver les sorties dans les artefacts autorisés et masquer les secrets dans les journaux. Une annotation ne vaut pas validation humaine. Relier chaque constat à l’appel d’outil ou au fichier produit dans le run courant. Le contrôle serveur et les différences entre rôles demandent des observations comparables. Rejouer une preuve minimale quand cela est utile et autorisé ; borner l’accès aux données nécessaires. Garder séparés les faits confirmés et les pistes encore ouvertes.

## Rendre un bilan proportionné [cloture]

Livrer les notes et constats utiles, les preuves, les limites, les tâches actives et la prochaine action éventuelle. Ne pas annoncer un succès sans observation ni prolonger une mission dont l’objectif est atteint. Respecter immédiatement un arrêt demandé. Le bilan nomme ce qui a été fait et ce qui reste inconnu, sans reprendre automatiquement la gravité d’un scanner. Pour une mission bloquée, préciser la dépendance à fournir et conserver un point de reprise. Vérifier les écritures avant d’annoncer un fichier ; laisser la décision de publication ou de transmission à l’utilisateur.

Le contrat commun Warband, la confidentialité, le scope et la gate priment. Ce profil ne crée aucun outil, ne lance aucune commande et ne remplace pas une preuve.

Source de méthode : https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/systematic-debugging/SKILL.md

Adaptation Warband en français ; charger explicitement la référence upstream avec mcp__desk__load_skill et source: "upstream". Attribution et licence complète dans le dossier parent.
