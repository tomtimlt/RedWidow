# ADR 0022 — Suppression des trouvailles de la Kill chain

- Statut : accepté
- Date : 2026-10-26

## Décision

Une suppression vise une seule trouvaille du projet actif. Elle retire son
identifiant des parents `from` des enfants directs ; les autres éléments et
leurs autres liens sont conservés. Aucun descendant n’est supprimé et aucun
lien n’est créé pour remplacer le nœud supprimé.

Dans le graphe, sélectionner le nœud puis Supprimer ouvre une confirmation
native. Le projet, le panneau et les données confirmées sont revérifiés avant
le remplacement du fichier. Un changement de projet, de cible ou la fermeture
du panneau avant le commit annule la demande. Une demande refusée reçoit un
accusé pour ne pas bloquer le bouton.

L’outil MCP `delete_note({id})` utilise exclusivement le projet du message
courant. Il reste soumis à la gate, aux règles existantes et au contrat Bypass ;
le mode Apprentissage ne l’expose pas. `list_notes` fournit les identifiants.

Ajout, modification et suppression partagent un verrou interprocessus par
fichier, couvrant lecture, validation et remplacement atomique. L’attente est
bornée à trois secondes et respecte l’annulation. Le contexte est revérifié
après écriture du temporaire, immédiatement avant son renommage.

## Limites et récupération

Le verrou n’est jamais volé sur la seule base de son ancienneté. Un arrêt
brutal peut laisser `findings.json.lock` : arrêter les moteurs Warband concernés
avant de retirer manuellement ce seul verrou dans le dossier du projet.
Ne pas supprimer `findings.json`, qui contient les données.

## Validation

Tests de suppression et détachement, annulation, confirmations périmées,
changement de projet, verrou occupé et concurrence entre véritables processus.
Tests des outils partagés et du rendu accessible du graphe. Le bilan final est
consigné dans l’état du projet après exécution.
