# 0007 — Noms courts des conteneurs

- Statut : accepté
- Date : 2026-10-16

## Contexte

Les conteneurs Exegol portent le nom Docker `exegol-<nom>` (`exegol-htb1`). L'affichage et les mentions `@` utilisent le nom court (`htb1`). `parseMentions` et `parseSlashStart` comparent aujourd'hui le jeton brut (`packages/core/src/exegol/targets.ts`). `resolveExegolContainer` n'accepte qu'un nom cité par `@` ou le conteneur dédié, sans regarder la liste Docker. Coller le préfixe `exegol-` devant un nom déjà préfixé créerait `exegol-exegol-htb1`.

`DockerClient.start` et `DockerClient.stop` existent et passent par `assertOperand` (`packages/core/src/docker/client.ts`). Le cockpit ne lance ni n'arrête un conteneur.

## Décision

1. **Affichage et mentions.** Le nom court retire un seul préfixe `exegol-` si le reste n'est pas vide. C'est le nom montré et le jeton après `@`.
2. **Résolution.** Le nom Docker est celui de la liste Docker **courante** (`listLabelPrefix`). Correspondance unique sur le nom complet ou sur le nom court. Aucune correspondance, ou deux conteneurs pour le même court : refus (`exegol.containerDenied`). Jamais de concaténation `exegol-` + jeton.
3. **`resolveExegolContainer`.** Le nom renvoyé est le nom réel de la liste. Avec des `@`, il doit être l'un des conteneurs cités (court ou complet). Sans `@`, il doit être le dédié. Un nom cité ou dédié absent de la liste est refusé. L'outil `exec` interroge la liste au moment de l'appel.
4. **`/start <jeton>`.** L'argument passé à `exegol start` est le nom court du jeton. `/start htb1` et `/start exegol-htb1` lancent `exegol start htb1`, jamais `exegol start exegol-htb1`.
5. **Boutons du cockpit.** `start` : `docker start` du nom réel, seulement s'il est dans la liste et arrêté. `stop` : `DockerClient.stop` du nom réel, seulement s'il est dans la liste et en cours. `create` (conteneur lié absent) : `exegol start` du nom court du projet, sans nom fourni par la webview. Les trois messages passent par `parseCockpitMessage`. Le nom exécuté est celui de la liste, pas la chaîne de la webview.

## Alternatives écartées

- **Préfixer systématiquement `exegol-`.** Produit `exegol-exegol-htb1` dès que le jeton est déjà un nom Docker.
- **Accepter le jeton tel quel dans `exec` sans liste.** Un `@` citerait un conteneur qui n'existe pas, ou un nom qui n'est pas le dédié réel.
- **Laisser la webview choisir la chaîne passée à `docker start`.** La liste courante est la seule source du nom exécuté.

## Conséquences

- Un court nom ambigu (à la fois `htb1` et `exegol-htb1`) n'est ni proposé ni résolu.
- `exec` fait un `listLabelPrefix` de plus par appel.
- Les boutons ne créent un conteneur que pour le projet lié absent, via le même `exegol start` que `/start`.

## Plan

**Lot N.** Fichiers : `packages/core/src/exegol/targets.ts`, `tool-specs.ts`, tests, `packages/vscode/src/logic/cockpit.ts`, `media/cockpit.js`, `extension.ts`. Critères : `htb1` résout vers `exegol-htb1` présent dans la liste ; absent ou ambigu → refus ; aucun test ne construit `exegol-` + nom ; `start`/`stop`/`create` rejetés s'ils ont une clé en trop ; `pnpm check` vert.
