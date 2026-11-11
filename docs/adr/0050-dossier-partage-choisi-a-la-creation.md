# 0050 — Dossier partagé choisi à la création d'un conteneur

- Statut : accepté (remplace la phrase « Un nouveau conteneur monte le dossier du projet sélectionné » de l'ADR 0047)
- Date : 2026-11-11

## Contexte
Aujourd'hui, un nouveau conteneur Kali ou Exegol monte toujours le dossier du projet actif. Le chemin envoyé par la webview est ignoré (`packages/vscode/src/extension/extension.ts:1829`, `:1905-1908`). Le formulaire affiche un bouton « Dossier du projet » qui ne fait qu'ouvrir ce dossier. L'utilisateur le prend pour un sélecteur, et ne comprend pas pourquoi le dossier proposé peut se trouver dans le partage d'un autre conteneur. Il veut choisir lui-même le dossier partagé, sans lien imposé avec le projet.

La liaison conteneur ↔ projet exige que le dossier du projet soit dans le montage, ou égal à lui (`packages/core/src/project-workspace.ts:153-167`). `mountExposesSensitive` (`packages/core/src/approval/paths.ts:591`) existe déjà pour refuser un montage qui exposerait un secret.

## Décision
1. Le formulaire de création a un champ obligatoire « Dossier partagé », rempli par un bouton « Choisir… ». Ce bouton ouvre le sélecteur de dossiers de VS Code côté hôte (`showOpenDialog`, dossiers seulement). Il n'y a pas de valeur par défaut.
2. L'hôte n'accepte que le chemin issu de son propre sélecteur, mémorisé par panneau. Un chemin envoyé en texte par la webview n'est jamais monté.
3. Avant la création, l'hôte vérifie que le chemin est absolu, qu'il existe et que c'est un dossier (sans lien symbolique, chemin réel). Il refuse un chemin pour lequel `mountExposesSensitive` ne répond pas `null`, ce qui couvre la racine d'un disque et le dossier personnel, qui contiennent des secrets. Ces refus ne sont pas contournables.
4. Ce dossier remplace `selectedProject.workspace` comme source du montage, pour Kali (`--mount`) comme pour Exegol (`--workspace`).
5. Après la création, la liaison au projet actif n'est tentée que si le dossier du projet se trouve dans le dossier partagé. Elle passe par le parcours vérifié existant, inchangé. Sinon, le conteneur est créé sans liaison, avec une indication neutre, et ce n'est pas une erreur.

## Alternatives écartées
- Pré-remplir avec le dossier du projet : c'est justement ce qui embrouillait l'utilisateur.
- Accepter un chemin saisi dans la webview : la webview est une entrée non fiable.

## Conséquences
- Plusieurs conteneurs peuvent partager des dossiers qui se recouvrent. C'est le choix de l'utilisateur.
- Un conteneur peut exister sans être lié à aucun projet.
- Les invariants de sécurité sont inchangés : la gate, la politique et les règles `docker run` de l'agent ne sont pas touchées. Le montage est une action humaine directe, refusée si elle exposerait un chemin sensible.
