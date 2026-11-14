# 0056 — Un projet vit dans un conteneur

- Statut : accepté
- Date : 2026-11-14

## Contexte
Sur le serveur web (ADR 0052), un projet est un dossier sous `<données>/projects`, sans lien obligatoire avec un conteneur. Le bouton « Dossier partagé » du cockpit demande de choisir ce dossier à la main, ce que l'utilisateur ne veut pas : même sans IA, on travaille dans un conteneur Kali ou Exegol, et le projet doit y vivre.

## Décision
1. **Racine des conteneurs.** Un seul dossier, `<données>/containers` (sur le VPS : `/srv/redwidow/containers`), contient le dossier partagé de chaque conteneur : `kali-1/`, `kali-2/`, `exegol-1/`… C'est l'équivalent du `.workspace` d'Exegol. Le dossier est créé avec le conteneur, jamais choisi à la main.
2. **Racine RedWidow dans chaque dossier partagé.** À la création d'un conteneur, son dossier reçoit la racine RedWidow (`evidence`, `notes`, `payloads`, `reports`, `scans`, `scripts`) et est monté dans le conteneur. Le chemin est identique sur l'hôte et dans le conteneur serveur (ADR 0052 : indispensable à Exegol).
3. **Un projet n'existe que dans un conteneur.** Créer un projet exige un conteneur, démarré ou arrêté (on écrit dans son dossier partagé dans les deux cas). Sans conteneur, la création est refusée et l'interface dit de créer un conteneur d'abord. Le dossier du projet est `<racine des conteneurs>/<conteneur>/<projet>`.
4. **Un conteneur peut héberger plusieurs projets, ou aucun.** On peut créer autant de conteneurs qu'on veut sans projet.
5. **Projets existants sans conteneur.** Ils sont conservés, marqués « à lier ». Quand l'utilisateur veut en activer un, une fenêtre lui fait choisir l'un des conteneurs existants ; le projet est alors déplacé dans le dossier de ce conteneur et lié. Sans conteneur existant, la fenêtre propose d'en créer un. Rien n'est déplacé sans réponse humaine.
6. **Une seule racine pour les chemins sensibles.** Toutes les gardes de chemin (Fichiers, mentions, dossier partagé) travaillent sous `<racine des conteneurs>` ; aucun chemin hôte libre n'est accepté.

## Conséquences
- Le choix du « dossier partagé » disparaît de l'interface web : il découle du nom du conteneur.
- Les images Kali et Exegol s'installent depuis l'interface (ADR suivant ou section de la documentation), pas par le terminal.
- La gate, la politique et les invariants de sécurité ne changent pas ; la politique du dépôt reste appliquée seulement après approbation de son empreinte.
- L'extension VS Code n'est pas modifiée par cette décision ; la règle (« pas de projet sans conteneur ») lui sera appliquée séparément.
