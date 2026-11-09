# 0045 — Outils de cible et liaison explicite des conteneurs

Statut : accepté — décisions utilisateur du 9 novembre 2026 (lot 24).

`read_url` reste disponible sur les cibles. Sa réponse précise que le nettoyage
retire JavaScript, commentaires et champs cachés ; les tests utilisent `exec`
dans un conteneur ou `http_request`, la documentation reste dans `read_url`.
Les relais connus vers une cible sont refusés seulement avec une fiche
programme validée. Sinon une note les déconseille. Les redirections sont
contrôlées avant de joindre le relais, y compris avec un point DNS final.

La cible provient des fiches validées ou des hôtes d’appels HTTP/shell approuvés.
Seuls les hôtes sont mémorisés dans `target-hosts.json`, séparément par projet,
avec une borne de 1 024 entrées. Cette mémoire indicative n’accorde aucune
permission et une erreur de lecture n’interdit pas les outils.

Une mention `@` ne modifie jamais l’allowlist. Le chat propose une carte de
liaison et signale l’absence de conteneur. Son bouton emprunte le parcours du
cockpit : contrôle du montage avant liaison, préparation du serveur Kali si
nécessaire, revalidation du projet et contrôle après liaison. L’identité de la
proposition descend jusqu’à la mutation ; les changements de projet de
l’interface sont suspendus pendant cette opération. Un conteneur lié reste
utilisable sans mention.

Assets : icône de lien existante, jetons communs `--jn-line`, `--jn-raise`,
`--jn-r-sm`, libellés fr/en et captures `docs/img/chat-conteneur-*` avant/après,
clair/sombre et mobile. Le banc vérifie bandeau, carte et actions des boutons.
