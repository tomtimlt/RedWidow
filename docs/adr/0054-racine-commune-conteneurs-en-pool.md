# 0054 — Racine commune : les projets vivent dans un dossier partagé, les conteneurs sont un pool

- Statut : accepté (remplace l'ADR 0053 : un dossier par conteneur et projet dans un conteneur ; garde de 0053 le point 8 sur les projets existants et le point 9 sur la sécurité)
- Date : 2026-11-27

## Contexte
Le modèle a changé six fois en trois semaines (ADR 0013, 0015, 0047, 0050, 0052, 0053). Avec l'ADR 0053, le conteneur possède le dossier et le projet vit dedans (`<racine>/kali-1/RedWidow/projects/<slug>/`). Un projet liste plusieurs conteneurs, mais seul celui qui l'héberge voit ses fichiers : `projectPlacement` accepte le projet si un seul partage le contient, puis `prepareContainerProjectWorkspace` échoue avec `project.workspaceNotMounted` sur les autres conteneurs. Comparaison faite : Exegol Studio (projet = engagement = liste de conteneurs), ARTEX (projet = simple étiquette, un espace de fichiers commun).

## Décision
1. **Une racine machine** `warband.root` (chemin absolu, proposée à `~/RedWidow`), validée comme tout dossier partagé (absolue, chemin réel, sans lien symbolique, `mountExposesSensitive` nul). Elle contient `projets/<slug>/`, `conteneurs/<nom>/` et `ressources/`.
2. **Montages uniformes** (Kali et Exegol) posés à la création : `conteneurs/<nom>` → `/workspace`, `projets` → `/workspace/projets`, `ressources` → `/workspace/ressources` en lecture seule. On ne monte pas la racine entière en `/workspace` : `exegol remove` propose de supprimer tout `/workspace` non vide, ce qui effacerait tous les projets.
3. **Règle unique : la visibilité.** Un projet est utilisable dans un conteneur si son dossier réel est sous l'une des sources de montage du conteneur. Le chemin dans le conteneur se déduit de la cible du montage. La règle vaut pour les nouveaux conteneurs, les anciens (partage de l'ADR 0053) et les importés.
4. **Autorisation déduite.** L'agent d'un projet peut exécuter dans un conteneur si celui-ci est d'une famille connue, démarré, et voit le projet. La gate approuve toujours chaque appel. La liste `containers` du projet n'est plus la source de vérité.
5. **Fiche projet v2** : `{id, name, workspace, primary?}`. `primary` est le conteneur par défaut (préférence). Une fiche v1 se lit avec `primary ?? containers[0]`, `containers` disparaît à la réécriture.
6. **Un projet n'a pas besoin de conteneur pour exister.** Un tour sans conteneur démarré qui voit le projet est refusé (`project.noVisibleContainer`).
7. **Conteneur libre** : un conteneur existe sans projet, avec son dossier `conteneurs/<nom>/`. **Conteneur partageable** : plusieurs projets, plusieurs conteneurs.
8. **Projets existants** : rien n'est déplacé d'office. Un projet visible d'au moins un conteneur reste utilisable. Sinon : « Créer un conteneur » ou « Déplacer vers la racine » (déplacement confirmé de l'ADR 0052). `warband.containers.root` est déprécié et n'est plus lu.
9. **Invariants de sécurité inchangés.** Le montage est une action humaine directe, aucune action de l'agent ne change un montage ; gate, politique et règles `docker run` intactes.

## Alternatives écartées
- Racine entière montée en `/workspace` : un `exegol remove` pourrait effacer tous les projets.
- Projet d'abord (un dossier par projet, conteneurs créés depuis lui) : plus isolant, écarté par l'utilisateur au profit de la racine commune.
- Migration automatique : déplace des données sans accord.

## Conséquences
- Un conteneur, et l'agent qui y tourne, peut lire les dossiers de tous les projets sous `projets/`. Perte d'isolation entre clients, assumée.
- Un conteneur ancien ne voit que son partage : ses projets hors partage restent « non associés ».
- Exegol doit accepter un `-V` dont la cible est sous `/workspace` ; à vérifier sur machine réelle, repli sur `/projets` et `/ressources`.
- Nouveau code de raison : `project.noVisibleContainer` (catalogues fr complet et en).
