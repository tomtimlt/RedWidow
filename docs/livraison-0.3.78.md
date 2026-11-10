# RedWidow 0.3.78 — préparation de livraison

Cette version rassemble les améliorations de mission et d'interface préparées sur la branche temporaire.

- Comptes de test utilisables par l'agent, masquage des valeurs admissibles dans les journaux et exports, et avertissement pour les valeurs trop courtes.
- Preuves issues du run, arrêt des relances lorsque l'humain doit intervenir et avertissement lorsqu'un résultat négatif repose sur une seule sonde sans justification.
- Création des dossiers de projet et liaison contrôlée des conteneurs ; corrections du terminal sous Windows.
- Profils et documents associés, outils web, diagnostic fournisseur, fiche programme remplie dans une nouvelle conversation et bouton Stop dans la saisie.
- Réglages plus réactifs, accès rapide au chat, matrice de couverture lisible et mesures de trace corrigées.
- Bypass à durée choisie de une minute à 48 heures ou illimitée, avec coupure et journalisation des transitions. Il s'éteint à l'arrêt du moteur.

Les lots 6, 13, 14, 15, 18, 22 et 26 sont reportés à la 1.1, conformément à la décision de l'utilisateur.

## Vérifications et limites

Les contrôles complets `pnpm check` ont été exécutés pour chaque lot livré ; le dernier contrôle du lot 19 a réussi avec 3 239 tests réussis et 14 ignorés. Les captures des nouvelles interfaces ont été vérifiées dans Chromium. La reconnaissance d'un balayage de racines dans `trace` est une mesure heuristique.

La recette native sous Windows reste à réaliser : terminal, création et liaison de projet, réglages, comptes de test, bouton Stop, remplissage de la fiche programme et Bypass limité ou illimité. Les tests de contrat avec fournisseurs réels n'ont pas été lancés.

Le manifeste est préparé en version 0.3.78. Aucun VSIX n'a été compilé et aucune publication n'a été effectuée pour cette préparation.
