# 0001 — Cycle de vie des processus, surface Docker et portabilité

- Statut : accepté
- Date : 2026-10-14

## Contexte

Points P2 18 à 21 de `docs/architecture-issues.md`.

- `runProcess` (`packages/core/src/process/run.ts:79-162`) passe `signal` à `spawn` : une annulation envoie un SIGTERM au seul enfant direct, sans escalade ni arrêt des descendants. La promesse se résout sur `close`, qui attend la fermeture des tubes : un enfant qui ignore SIGTERM, ou un descendant qui garde stdout ouvert, la laisse pendante. Il n'y a pas de timeout. Seul appelant : `DockerClient.exec` (`packages/core/src/docker/client.ts:146-152`).
- `agent-opencode/src/server.ts:154-168` réimplémente sa propre séquence SIGTERM (3 s) puis SIGKILL (1 s), sur l'enfant seul.
- La CLI interrompt un `run` au premier SIGINT via un `AbortController` (`packages/cli/src/main.ts:159-161`).
- `DockerClient.exec(args)` fait partie de l'interface publique (`client.ts:138`) sans validation, et n'a aucun appelant externe.
- Les valeurs de `run.env`, les éléments de `run.command` et le binaire (`--docker`) sont peu validés.
- `ps` et `images` analysent un objet JSON par ligne. Une autre forme de sortie (podman, version future) donne un résultat vide ou des noms vides, sans erreur.
- Les tests reposent sur des faux binaires `#!/bin/sh`. La liste des chemins sensibles de la politique est POSIX (`/etc/shadow`…). `resolveBinary` ignore `PATHEXT`.

Modèle de menaces : le modèle contrôle les arguments des outils docker (`image`, `command`, `env`…). L'opérateur contrôle la CLI, donc `--docker`. Le dépôt ne contrôle que la politique dont l'empreinte a été approuvée. La gate d'approbation reste l'unique autorité. Ici, on cherche à garantir qu'un processus lancé pour un outil se termine, qu'aucun argument du modèle ne devienne une option de l'hôte et que les échecs restent visibles (fail-closed).

## Décision

### A. Cycle de vie des processus (cœur)

1. Nouveau module `packages/core/src/process/terminate.ts`, exporté par le cœur :
   ```ts
   export interface TerminateOptions { graceMs?: number; killWaitMs?: number }
   /** SIGTERM au groupe, puis SIGKILL après graceMs ; résout quand l'enfant est fermé ou après killWaitMs. */
   export function terminateProcessTree(child: ChildProcess, opts?: TerminateOptions): Promise<{ forced: boolean }>;
   export function spawnOptionsForTree(): Pick<SpawnOptions, "detached">; // POSIX : { detached: true } ; win32 : {}
   ```
   - **POSIX** : l'enfant est lancé avec `detached: true` et devient chef de son groupe. La terminaison envoie `process.kill(-pid, "SIGTERM")`, puis `process.kill(-pid, "SIGKILL")` si l'enfant n'est pas fermé après `graceMs`. On ignore `ESRCH`. On ne signale plus le groupe une fois `close` reçu, pour limiter le risque de réutilisation de PID.
   - **Windows** : pas de `detached`, qui ouvrirait une console séparée. La terminaison se fait par `child.kill()`, qui est déjà une terminaison forcée. Les descendants ne sont pas arrêtés (voir D) et on n'utilise pas `taskkill`.
   - Si `close` n'arrive pas `killWaitMs` après SIGKILL (des descendants gardent les tubes ouverts), on détruit stdout et stderr puis on résout. **La promesse ne reste jamais pendante.**
   - Valeurs par défaut : `graceMs = 5000`, `killWaitMs = 1000`.
2. Un registre interne des groupes vivants reçoit un gestionnaire `process.on("exit")` qui envoie un SIGKILL synchrone à chaque groupe vivant. Avec `detached`, le Ctrl-C du terminal n'atteint plus les enfants, d'où ce filet. La CLI garde le premier SIGINT comme annulation propre. **Un second SIGINT appelle `process.exit(130)`**, ce qui déclenche le filet.
3. `RunProcessOptions` reçoit deux options : `timeoutMs?: number` (pas de défaut au niveau de `runProcess`) et `killGraceMs?: number` (défaut 5000). On ne passe plus `signal` à `spawn`. Une annulation ou un timeout appelle `terminateProcessTree`. Pour un signal déjà annulé au lancement, on conserve le comportement actuel. Ni l'annulation ni le timeout ne rejettent la promesse : elle se résout avec le résultat. Seul un binaire introuvable la rejette, comme aujourd'hui.
4. Format d'événement, rétrocompatible : `process.exited` et `ProcessResult` reçoivent deux champs optionnels.
   - `termination?: "abort" | "timeout"` : absent pour une fin naturelle.
   - `forced?: boolean` : vaut `true` si le SIGKILL a été envoyé.

   Le validateur est mis à jour en conséquence. On n'ajoute pas de nouveau `kind`.
5. `DockerClient` accepte `timeoutMs` à la construction (défaut **30 min**, filet contre les blocages, pas une limite métier) et le transmet à chaque appel.
6. L'arrêt du serveur OpenCode utilise `spawnOptionsForTree()` et `terminateProcessTree(child, { graceMs: 3000, killWaitMs: 1000 })`, ce qui supprime la séquence dupliquée.

### B. Surface Docker

- `exec` sort de l'interface `DockerClient` et reste une fonction interne au module. Ce changement casse l'API publique, ce qui est acceptable en 0.1.0 non publiée.
- `image` doit être non vide et ne pas commencer par `-` : un argument du modèle ne doit jamais être interprété comme une option de `docker run`. On vérifie si ce contrôle existe déjà et on l'ajoute sinon. Après l'image, docker ne lit plus d'options : les éléments de `command` n'atteignent que le conteneur. On les borne sans les filtrer : au plus 256 éléments, aucun `\0`, au plus 32 Kio chacun.
- `env` : la validation des clés est inchangée. Une valeur ne doit contenir ni `\0` ni dépasser 32 Kio.
- `binary` : on accepte un nom nu (`^[A-Za-z0-9._-]+$`, sans `-` initial), résolu par `PATH`, ou un chemin absolu. Un chemin relatif est refusé : un `./docker` fourni par l'espace de travail ne doit pas pouvoir prendre la place du vrai binaire. Le binaire ne vient que de la CLI, jamais de la politique du dépôt.
- Nouveaux codes de raison (`REASON_CODES`, catalogues fr et en) : `docker.invalidArgument` (paramètres `field` et `reason`) et `docker.invalidBinary`.

### C. Podman et contextes

- **Podman n'est pas supporté** et le README le dit. On n'ajoute pas d'option `engine` ni d'analyse spécifique.
- **Échec explicite plutôt que résultat vide.** Pour `ps` et `images`, chaque ligne non vide doit être un objet JSON dont les champs attendus sont des chaînes. Sinon, on lève `CodedError("docker.unexpectedOutput", { command })` (nouveau code, fr et en). Une sortie vide reste une liste vide.
- **Contextes** : on ne change rien. `safeEnv` transmet déjà `DOCKER_HOST` et `DOCKER_CONTEXT`, et la CLI docker résout le contexte.

### D. Windows

**Décision de l'utilisateur (amende la recommandation initiale de l'architecte, qui était de refuser) : Windows natif en « best effort », sans garantie.**

- `john run` n'est **pas** refusé sous `win32` ; la CLI affiche sur stderr, au démarrage de `run` et de `agents`, un avertissement : Windows natif sans garantie, la garde des chemins sensibles est POSIX donc **incomplète**, WSL recommandé, ne pas utiliser en production. Usage personnel du porteur du projet uniquement.
- Risque assumé : fausse impression de sécurité sous Windows. Il est consigné dans `docs/architecture-issues.md` (section « À faire plus tard ») avec le détail du support à construire.
- On ne touche ni à `resolveBinary` (PATHEXT, `.cmd`), ni aux tests `sh`, ni à `taskkill` ; la CI n'a pas de job Windows. Un support complet fera l'objet d'une fonctionnalité dédiée et d'un nouvel ADR (chemins sensibles Windows, recherche des binaires, arrêt de l'arbre de processus, tests portables, CI).

## Alternatives écartées

- **SIGKILL immédiat** : empêche docker de relayer l'arrêt au conteneur.
- **`killSignal` et `timeout` natifs de `spawn`** : ils ne touchent pas le groupe, n'escaladent pas et ne règlent pas les tubes gardés ouverts.
- **Bibliothèque `tree-kill`** : dépendance supplémentaire pour du code de quelques lignes. Sous POSIX, elle parcourt `ps` au lieu de s'appuyer sur le groupe.
- **Timeout par défaut court dans `runProcess`** : les `docker build` et `pull` sont légitimement longs. Le filet se place dans `DockerClient`.
- **Garder `exec` public avec validation** : aucun appelant ne le justifie. Toute commande arbitraire serait une surface d'approbation à valider de nouveau.
- **Filtrer le contenu de `command`** : il n'atteint que le conteneur, et un filtrage donnerait une fausse impression de sécurité.
- **Support de podman tolérant** (tableau JSON, `Names` en tableau) : il impliquerait un support à tester (CI, versions). L'erreur explicite suffit à supprimer le résultat silencieusement faux.
- **Refuser `john run` sous Windows** (recommandation initiale) : écarté par l'utilisateur, qui accepte le risque pour un usage personnel ; l'avertissement visible remplace le refus.

## Conséquences

- **Positives** : une annulation ou un timeout termine toujours le processus, ses descendants et la promesse. Le journal indique la cause (`termination`) et le forçage (`forced`). La logique d'arrêt n'existe plus qu'à un endroit. La surface publique du cœur est réduite. Les sorties inattendues échouent bruyamment.
- **Risques et points de vigilance** :
  - Le SIGKILL de la CLI docker **ne supprime pas le conteneur** : un `docker run` forcé peut laisser un conteneur actif. Suivi possible, hors de ce lot : nommer les conteneurs et appeler `docker rm -f` après `forced`.
  - Avec `detached`, un parent tué par SIGKILL laisse des enfants orphelins : le filet `exit` ne couvre pas ce cas.
  - Avec `DOCKER_HOST` vers un démon distant, les contrôles de montage s'appliquent au système de fichiers local et non à celui du démon. Ce point est connu et n'est pas traité ici.
  - Les valeurs `-e` figurent dans l'`argv` journalisé. Seuls les motifs de secrets connus sont masqués par le recorder.
  - La revue de sécurité du lot processus par `architect` est obligatoire.

## Plan

Les lots 1 et 2 du plan P2, détaillés dans la réponse de l'architecte du 2026-10-14 et repris dans `docs/architecture-issues.md` par l'orchestrateur.
