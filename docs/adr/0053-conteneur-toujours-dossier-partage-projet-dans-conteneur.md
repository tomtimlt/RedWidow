# 0053 — Un conteneur a toujours un dossier partagé ; un projet n'existe que dans un conteneur

- Statut : accepté (remplace de l'ADR 0052 les points 1 à 4 sur la création de projet et de conteneur, le choix libre du dossier partagé de l'ADR 0050, et la phrase « aucun dossier par défaut »)
- Date : 2026-11-14

## Contexte
Avec les ADR 0050 et 0052, le dossier partagé d'un conteneur et le dossier d'un projet sont deux choix libres et indépendants. Le moteur doit ensuite vérifier qu'ils se contiennent, et refuse le tour sinon (`project.workspaceNotMounted`). Résultat observé : des projets « flottants », hors de tout conteneur, ou hors du partage du conteneur qui devrait les servir. Un cockpit où l'on peut créer un projet sans conteneur, ou un conteneur qui ne voit pas son projet, n'a pas de sens pour un outil où l'on travaille toujours dans un conteneur, avec ou sans IA.

Faits du code : pas de serveur en plus de l'extension (seuls `vscode` crée projets et conteneurs) ; le nom du conteneur est saisi à la main ; aucun réglage de racine de conteneurs ; le dossier partagé est choisi à chaque création et n'est pas mémorisé (`extension.ts:1613`, `:2164`) ; `createProject`, `adoptProjectDirectory`, `registerImportedProject` acceptent `containers: []` (`packages/core/src/project.ts:425-569`).

## Décision
1. **Racine des conteneurs.** Un réglage machine `warband.containers.root` (chemin absolu) contient un dossier par conteneur : `<racine>/kali-1/`, `kali-2/`, `exegol-1/`… Au premier lancement d'une création de conteneur, si le réglage est vide, l'hôte ouvre le sélecteur de dossier natif avec une proposition (`<dossier personnel>/RedWidow-conteneurs`) que l'utilisateur confirme ou change. La racine est validée comme tout dossier partagé (absolu, chemin réel, sans lien symbolique, `mountExposesSensitive` nul). Elle n'est jamais envoyée par la webview.
2. **Un dossier par conteneur, toujours.** À la création, l'hôte réserve `<racine>/<nom>/` (création exclusive, mode `0o700`) et le monte : `--mount …,target=/workspace` pour Kali, `--workspace` pour Exegol. Le dossier partagé n'est plus un choix libre. Le nom est généré : `kali-N` ou `exegol-N`, avec le plus petit N libre parmi les conteneurs existants et les dossiers de la racine. Il reste modifiable.
3. **Racine RedWidow dans chaque dossier de conteneur.** `<racine>/<nom>/RedWidow/` contient `evidence`, `notes`, `payloads`, `reports`, `scans`, `scripts` (travail du conteneur, sans projet) et `projects/`. Créée à la création du conteneur, et à la demande pour un conteneur existant.
4. **Un projet n'existe que dans un conteneur.** Son dossier est `<partage du conteneur>/RedWidow/projects/<slug>/`, avec les six sous-dossiers usuels. Créer un projet commence par choisir un conteneur, démarré ou éteint (le montage est relu par `docker inspect`, valable aux deux états, et le dossier hôte est accessible dans les deux cas). Le conteneur est lié au projet à la création (`containers: [conteneur]`, `primary`).
   - « Nouveau dossier » libre et « Dossier existant » libre disparaissent. « Dossier existant » reste possible seulement pour un dossier déjà situé sous le partage d'un conteneur : le projet est alors associé à ce conteneur.
   - L'import d'archive `.rwproj` demande d'abord le conteneur ; l'extraction va sous son dossier de projets.
   - Le cœur refuse de créer, d'adopter ou d'enregistrer un projet sans conteneur et sans dossier contenu dans le partage de ce conteneur.
5. **L'inverse est libre.** On crée autant de conteneurs qu'on veut, sans projet.
6. **Plus de modes « conteneur projet » / « multi-projets »** ni de sélecteur de dossier partagé à la création de conteneur. La liste d'un conteneur affiche les projets qu'il héberge.
7. **Sans conteneur, pas de projet.** Le bouton de création de projet est désactivé et le message dit : « Créez d'abord un conteneur. »
8. **Projets existants.** Aucun n'est déplacé ni supprimé. Un projet sans conteneur, ou hors du partage de son conteneur, est signalé « non associé » et propose « Déplacer dans un conteneur » (déplacement confirmé de l'ADR 0052). Le contrôle moteur de l'ADR 0035 reste en place et refuse les tours d'un projet mal placé.
9. **Invariants de sécurité inchangés.** Le montage est une action humaine directe, refusée si elle exposerait un chemin sensible. Aucune action de l'agent ne change un montage. La gate, la politique et les règles `docker run` ne sont pas touchées.

## Alternatives écartées
- Garder le choix libre du dossier partagé : c'est la cause des projets flottants.
- Un dossier partagé unique pour tous les conteneurs : les conteneurs se verraient les fichiers les uns des autres.
- Migrer d'office les projets existants : cela déplace des données sans accord.

## Conséquences
- Un conteneur existant avec un dossier partagé libre garde son montage. Il peut héberger des projets, sous `<son partage>/RedWidow/projects/`, créé à la demande.
- Docker ne permet pas de changer le montage d'un conteneur existant : le projet doit être sous ce partage, sinon il est « non associé ».
- Le plan d'interface de l'ADR 0052 (`docs/plans/projets-dossiers-archive.md`) est en partie remplacé : création de projet à trois choix, modes de conteneur.
- Nouveaux codes de raison éventuels : racine invalide, conteneur obligatoire, dossier hors du partage.
