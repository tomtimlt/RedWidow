# Recette P1 — dossier de projet partagé

Date : 5 novembre 2026. Branche : `temp/p1-project-workspace`.
Base de travail : préparation 0.3.72 (`76cfb53`). P0 conservé ; aucune release, publication ou
personnalisation du prompt P2 effectuée.

## Comportement livré

- Le dossier hôte du projet reste accessible dans l’Explorateur VS Code.
- La création depuis le cockpit utilise ce dossier comme partage Docker.
  Kali est associé automatiquement après vérification ; Exegol utilise son
  lancement interactif avec `--workspace`, puis une association explicite.
- Les catégories `reports`, `payloads`, `scans`, `scripts`, `evidence`, `notes`
  sont préparées sans déplacer ni remplacer les anciens fichiers.
- Le conteneur expose les mêmes fichiers via `/workspace` et un alias
  `/redwidow/Workspace/<nom-normalisé>-<8-caractères-UUID>/`.
  Le terminal démarre dans ce dernier chemin logique.
- Le partage est vérifié par comparaison des chemins et lecture, depuis le
  conteneur, d’un marqueur temporaire créé sur l’hôte. Un montage incohérent
  est refusé ; aucun ancien conteneur n’est recréé ou supprimé.
- L’outil `write_project_artifact` crée un nouveau fichier UTF-8 dans une
  catégorie fixe, jusqu’à 256 Kio, sans écrasement. Traversées, liens sortants
  et noms Windows réservés sont refusés. Les consignes communes aux moteurs
  demandent de ranger les fichiers de mission dans le dossier du projet.
- Le mode Apprentissage ne prépare pas le conteneur et n’expose pas cet outil.

## Vérifications réalisées

- TypeScript : vérification réussie.
- Biome : zéro erreur ; 185 avertissements et 8 informations restent signalés.
- Suite complète : **2 271 tests réussis, 14 ignorés**, avec deux workers.
  Aucun test ni assertion désactivé pour cette exécution.
- Un premier passage avait rencontré un délai de démarrage dans le test
  existant des processus orphelins : son arrêt à 100 ms précédait l’émission
  du PID. Le fichier inchangé a ensuite réussi ses 30 tests seul, puis la
  suite complète a réussi avec deux workers.
- Docker réel, image Kali locale, réseau désactivé : dossier hôte contenant
  des espaces, alias nommé, rapport hôte lisible dans le conteneur, scan du
  conteneur lisible sur l’hôte, chemin logique du terminal, refus du dossier
  d’un autre projet, conservation des fichiers après retrait du conteneur de
  test. Seul le conteneur créé pour la recette a été retiré.
- Navigateur, cockpit réel avec sa CSP : dossier actif affiché et transmis
  à la création, changement de projet pris en compte, bouton ouvrant
  l’Explorateur, libellés FR/EN, aucune erreur remontée.

Preuves locales de la session :
`/workspace/work/p1-native-workspace-verification.json` et
`/workspace/work/p1-cockpit-verification.json`.
Journal de la suite finale : `/tmp/p1-suite-confirmed.log`.

## Limites et recette manuelle restante

Windows avec Docker Desktop et Exegol natif restent à vérifier sur leurs
environnements respectifs. Le scénario navigateur ne remplace pas une recette
dans une fenêtre VS Code installée.

Pour un ancien conteneur dont le montage diffère, sauvegarder ses données,
créer explicitement un conteneur avec le dossier du projet et comparer les
fichiers avant de retirer l’ancien. Aucun `chmod 777` ni migration forcée.

L’outil d’artefacts contrôle ses écritures. Les commandes shell arbitraires
et outils externes gardent leurs permissions habituelles : le rangement et
le dossier courant ne constituent pas un confinement de tout le conteneur.
Les garanties et choix techniques sont décrits dans
[l’ADR 0035](../adr/0035-workspace-projet-partage.md).
