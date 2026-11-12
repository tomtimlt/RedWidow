# 0055 — HostUi et fichiers web

- Statut : accepté
- Date : 2026-11-12

## Contexte
L'extension VS Code pose ses questions par les dialogues de l'éditeur (`showQuickPick`, `showInputBox`, `showOpenDialog`, modales de confirmation, `openExternal`). Le serveur web (ADR 0052) n'a pas d'éditeur : les modules du pont ont besoin d'un équivalent unique, et d'un moyen sûr d'échanger des fichiers avec le navigateur (imports, exports) sans jamais manipuler un chemin fourni par le client.

## Décision
1. **HostUi** (`bridge/hostui.ts`) : API interne `ui.pick`, `ui.input`, `ui.confirm`, `ui.file`, `ui.external`. Chaque appel diffuse à la coquille un message shell `dialog {id, kind, …}` et rend une promesse. La coquille répond `dialogResult {id, value|null}` ; le serveur retire la question par `dialogClosed {id}`. Annulation = `null` (`false` pour `confirm` et `external`).
2. **Jamais de valeur implicite** (modèle de `MissionHub.ask`) : sans réponse humaine la promesse reste en attente ; seul l'arrêt du serveur la résout, par `null`/`false`. Au-delà de 32 dialogues en attente : `null`/`false` immédiat, sans diffusion. La valeur est validée selon le `kind` (id de `pick` existant, saisie ≤ 4 Ko, booléen, identifiant d'upload créé par ce serveur pour ce dialogue) ; une réponse invalide est ignorée et le dialogue reste ouvert.
3. **Cible** : un dialogue est posé au socket émetteur du geste (paramètre `to`), sinon à toutes les coquilles. Seul un socket qui a reçu la question peut y répondre ; la première réponse valide gagne, la suivante est ignorée. Si le socket cible se ferme, la question est reposée aux autres coquilles.
4. **`external`** : seules les URL `http://` et `https://` (≤ 2048 caractères, sans caractère de contrôle) sont acceptées ; `javascript:`, `data:`, `file:` sont refusées avant toute diffusion. La coquille ouvre l'URL après confirmation (`rel=noopener`).
5. **Téléversement** : `POST /api/upload?dialog=<id>` (session et Origin exigés, `Content-Type: application/octet-stream`, nom dans `X-Filename`). Il n'est accepté que pour un dialogue `file` en attente (403 sinon), extension dans `accept` (415), taille ≤ `maxBytes` (défaut 5 Mio, plafond 25 Mio ; flux interrompu et fichier supprimé au-delà, 413). Le fichier est écrit en flux sous `<données>/uploads/up_<128 bits aléatoires>` en 0600 ; le nom client, assaini, n'est qu'un libellé. Réponse `{id, name, size}`. Les modules lisent avec `uploads.take(id)` (usage unique, `release()` après usage) ; un fichier non pris ou non libéré expire après 15 min ; le dossier est vidé au démarrage.
6. **Téléchargement** : `downloads.offer({filename, mime, body, maxAgeMs})` garde le contenu en mémoire (≤ 50 offres, ≤ 64 Mio au total) sous un identifiant de 128 bits ; la coquille reçoit `download {id, filename}` et lit `GET /api/download/<id>` (session exigée) : usage unique, `Content-Disposition: attachment` assaini, `nosniff`, `no-store`, expiration à 5 min.
7. **`BridgeContext`** : le hub crée une fois `ui`, `uploads` et `downloads` (`hub.context`) et les transmet aux modules du pont.

## Conséquences
- Un dialogue sans humain connecté ne fait rien : l'action demandée n'a pas lieu (pas de repli, pas de `true` implicite).
- Un fichier téléversé ne devient visible d'un module que par l'identifiant du dialogue qui l'a demandé ; la limite d'un envoi est de 25 Mio, un export de 64 Mio.
- Les exports non récupérés dans les 5 min sont perdus : le module doit en proposer un nouveau.
- Les dialogues ne passent pas par la gate d'approbation : ils ne remplacent jamais une approbation d'outil.

## API Fichiers (lot M6)
Explorateur et éditeur des fichiers du projet actif (notes, preuves, cours, `.warband/policy.json`), côté serveur : `bridge/files.ts` (opérations), `files-guard.ts` (garde des chemins), `files-messages.ts` (forme des messages), branchés par `MissionHub.control` (vue `shell`).

**Périmètre.** Le client ne donne qu'un chemin RELATIF à la racine du projet actif (chemin réel de son dossier, qui doit se trouver sous la racine des projets du serveur, comme les mentions `@`). Sans projet actif utilisable : `fs.noProject`. Chaque opération revalide : segments non vides, ni `.` ni `..`, ni chemin absolu, NUL, contrôle, `\`, échappement `%2e`/`%2f`/`%5c`, lecteur `C:` ; ≤ 255 octets par segment, ≤ 1024 au total ; `.git` et `node_modules` refusés partout (lecture, listage, écriture, renommage) ; `lstat` de chaque composant, un lien symbolique (intermédiaire ou cible, même vers l'intérieur) est refusé, jamais suivi (`O_NOFOLLOW` à l'ouverture) ; le parent réel est comparé à la racine réelle. Les liens et fichiers spéciaux n'apparaissent pas dans les listages. L'arrêt d'urgence vise les agents et n'interdit pas ces gestes humains.

**Messages** (client → serveur, réponse au seul émetteur) : `fsList {path}` → `fsEntries {path, entries[{name, kind, size, mtime}], truncated}` (≤ 1000 entrées, dossiers d'abord ; au plus 5000 lues) ; `fsStat {path}` → `fsInfo` ; `fsRead {path, as}` → `fsContent {path, mtime, etag, size, truncated, text|base64}` ; `fsWrite {path, text, etag|null}` → `fsWritten {path, mtime, etag, size}` ou `fsConflict {path}` ; `fsMkdir`, `fsRename {from, to}`, `fsDelete`, `fsUpload {dir}`, `fsDownload`, `fsCaptureEvidence` → `fsDone {op, path, …}` ou `fsCancelled {op, path}` ; tout refus → `fsError {op, path?, reason {code, params?}, message}` (code stable, jamais un chemin hôte). `policyChanged` est diffusé à toutes les coquilles quand la politique du dépôt est écrite, renommée ou supprimée.

**Limites.** Lecture texte ≤ 1 Mio (au-delà : début du fichier, `truncated`, sans `etag`, donc non réécrivable) ; base64 ≤ 5 Mio (aperçus) ; binaire demandé en texte : `fs.notText` ; écriture ≤ 1 Mio d'octets UTF-8 (en pratique le message tient dans la trame WebSocket de 1 Mio) ; téléversement ≤ 25 Mio, extension dans une liste fixe de 50 (reconfirmée à la prise du fichier), nom assaini ; téléchargement ≤ 64 Mio (plafond du magasin en mémoire, point 6) ; preuve ≤ 16 Kio. La taille est lue (`fstat`) avant tout contenu.

**Écriture.** Atomique (fichier temporaire voisin, `fsync`, `rename`), mode d'origine conservé (0644 pour un nouveau fichier). L'`etag` (mtime + taille) lu doit être celui du fichier au moment de l'écriture : sinon `fsConflict`, jamais d'écrasement silencieux (contrôlé avant et juste avant le `rename`, opérations sérialisées). `etag` nul : création seulement. Renommage sans écrasement, jamais d'un dossier dans lui-même. Suppression : `ui.confirm` danger (récursive pour un dossier) ; sans réponse ou refus rien n'est supprimé, et la cible est revérifiée après la réponse. Téléversement sur un fichier existant : confirmation de remplacement.

**Politique du dépôt.** `.warband/policy.json` s'écrit comme un autre fichier, mais son empreinte change : l'approbation précédente ne correspond plus (`policy.repo.modified`) et la politique du dépôt cesse de s'appliquer jusqu'à une nouvelle approbation par la modale humaine (`trustRepoPolicy`). Cette API n'approuve jamais rien.

**Preuve.** `fsCaptureEvidence` crée, pour le projet actif, une preuve (source `editor`, lignes 1 à N) avec le texte entier du fichier, titre demandé par `ui.input`, rattachée à une nouvelle trouvaille « hypothèse » comme la capture d'éditeur de l'extension ; le cœur masque les secrets.

**Audit.** `fs.write`, `fs.delete`, `fs.rename`, `fs.upload` : chemin relatif, projet, taille ; jamais le contenu.
