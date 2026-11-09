# 0047 — Dossiers de projets et liaison vérifiée

Statut : accepté — lot 8 du plan de finition.

La création dans l’extension demande seulement le nom du projet. Le cœur
réserve son dossier sous `~/.exegol/workspaces/<slug>`, puis prépare les six
catégories de fichiers avant d’enregistrer le projet. Les noms réservés sous
Windows sont préfixés et une collision produit un suffixe numérique ; aucun
dossier existant n’est réutilisé. Le nom, le chemin et les ancêtres sont
contrôlés avant création. Les liens symboliques sont refusés. Il n’y a aucun
nettoyage récursif en cas d’échec.

La racine avancée `warband.projects.workspaceRoot` se règle dans Système. Elle
est lue uniquement depuis les préférences machine de l’hôte, sans héritage du
dépôt. Le message de création n’accepte aucun chemin. La CLI et les projets
existants gardent leurs dossiers ; aucune migration automatique n’est faite.

Un nouveau conteneur monte le dossier du projet sélectionné. Pour Exegol,
l’ouverture du terminal interactif ne prouve pas la réussite : une observation
annulable, bornée à trente minutes, attend son apparition. Le projet, son
dossier, la famille Exegol et l’identité Docker sont vérifiés à nouveau avant
la liaison. La fermeture du terminal ou un changement de projet désarme cette
intention. Une liaison automatique ne propose jamais un autre conteneur.
Kali utilise le même parcours de liaison vérifiée après sa création.

Le marqueur exclusif, sa preuve de lecture dans le conteneur et l’alias restent
inchangés. Ils sont vérifiés avant d’ajouter le conteneur à l’allowlist, puis
après liaison. Ces contrôles par chemins et identités ne sont pas une
transaction atomique du système de fichiers.

Un montage incompatible produit `project.workspaceNotMounted`, avec le nom du
conteneur, son montage et le nom/chemin du projet. La liaison manuelle propose
de créer un conteneur pour le projet (recommandé) ou d’en choisir un autre,
toujours sous les mêmes contrôles. La suppression précise le chemin du projet
conservé sur le PC et la perte des seuls fichiers internes hors `/workspace`.

Validation : réservation et collisions, noms Windows, ancêtres symboliques,
marqueur réel et fausse preuve, observation de création annulée/périmée,
identité Docker remplacée, absence de récupération automatique vers une autre
cible, création sans dialogue et réglage Système. Libellés fr/en, composants
visuels existants et captures avant/après dans `docs/img/projet-*`,
`docs/img/systeme-projets-*` et `docs/img/conteneur-partage-*`.
La recette native Windows et les dialogues VS Code restent à vérifier sur la
machine de l’utilisateur.
