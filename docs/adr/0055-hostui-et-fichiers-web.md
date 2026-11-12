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
