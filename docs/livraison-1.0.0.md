# RedWidow 1.0.0 — bêta publique

Première version publique. Elle rassemble le travail des versions 0.3.x : agent IA sous approbation dans les conteneurs Exegol et Kali, Monitor, graphe d'attaque, matrice de couverture, comptes de test, journal d'audit exportable et commande `trace`.

## Ce que contient cette version

- **Un profil par mission** : Pentest (défaut, sans document), HTB/CTF, Bug bounty (fiche programme), Red Team (fiche d'engagement), Mentor.
- **Comptes de test** pour tester les parties authentifiées, avec session conservée et masquage dans les journaux et exports.
- **Fiche programme remplie par l'IA** dans une conversation dédiée, à relire et à valider.
- **Niveau Acharné** : relances automatiques tant que l'agent peut avancer seul, arrêt quand seule une action humaine peut le débloquer.
- **Bypass** à durée choisie (1 minute à 48 h) ou illimité, éteint à l'arrêt du moteur.
- **Monitor complet** (shell et web), **export du fil de mission**, ZIP d'audit lisible par `trace`.
- **Sorties longues conservées** en entier et relisibles par tranche ou par recherche.
- **Création automatique du dossier de projet**, « Nouveau conteneur » qui se lie tout seul.
- **Interface** : Réglages réactifs, matrice de couverture colorée, fiche flottante des nœuds de la kill chain, bouton Stop dans la saisie, accès rapide au chat.

## Limites connues

- Bêta : des défauts d'interface sont possibles.
- Non publié sur le Marketplace : installation par fichier `.vsix`.
- Testé sous Windows et Linux, pas sous macOS.
- Les relances automatiques du niveau Acharné fonctionnent avec OpenCode.
- Reporté à la 1.1 : réglages par usage, menu « + » en sections repliables, plancher de commandes refusées même en Bypass, import de skills.

## Vérifications

`pnpm check` vert : 3 239 tests réussis, 14 ignorés. La recette complète sous Windows (installation, terminal conteneur, création de projet, comptes de test, Bypass, kill chain) est à faire sur le VSIX avant toute publication.
