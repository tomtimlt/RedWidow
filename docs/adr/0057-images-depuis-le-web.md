# 0057 — Images de conteneurs depuis le web

- Statut : accepté
- Date : 2026-11-14

## Contexte
Sur le serveur web, l'image Kali (`redwidow-kali:local`) devait être construite à la main (`docker compose --profile tools build kali`) et l'image Exegol téléchargée par la CLI dans un terminal. L'utilisateur veut tout faire depuis l'interface, comme dans l'extension VS Code (qui construit `warband/kali:complete-1` avec progression, et laisse la CLI Exegol gérer son contrat et son téléchargement dans un terminal interactif).

## Décision
1. **Kali comme l'extension.** L'image par défaut du serveur devient `warband/kali:complete-1` (`REDWIDOW_KALI_IMAGE` la surcharge). Son installation réutilise `ensureWarbandKaliImage` du cœur : `image inspect`, pull de `kalilinux/kali-rolling` par l'API Engine (progression par couches), puis `docker build` du Dockerfile du cœur (une seule source de vérité, rien à embarquer de plus dans l'image serveur : le client `docker` y est déjà). Reconstruite seulement si absente, ou sur « Reconstruire » (image retirée sans force : refus si un conteneur s'en sert). Une image configurée à la main est seulement téléchargée.
2. **Exegol : pull Docker, contrat à part.** L'image `nwodtuhs/exegol:<étiquette>` est téléchargée par l'API Engine (mêmes messages de progression par couches), pas par `exegol install`. Raisons, vérifiées sur la CLI 6.0.2 embarquée : sans terminal, la CLI s'arrête (code 1) à l'invite du contrat tant qu'il n'est pas accepté, puis `install` télécharge aussi des ressources par git et pose d'autres invites ; sa sortie est mise en forme pour un terminal (aucune progression exploitable), l'annulation et l'erreur 429 y sont indistinguables. L'image obtenue est celle que `exegol start` retrouve localement. Limite connue : `exegol install` enregistre aussi une étiquette de version locale ; le pull direct non, sans effet sur la création.
3. **Contrat d'utilisation.** L'état se lit par `exegol version` sans terminal (entrée fermée, 20 s au plus) : code 0 = accepté. « Accepter le contrat » = lien officiel (`ui.external`) puis `ui.confirm` explicite ; seulement après un oui humain, le serveur exécute exactement `exegol version --accept-eula`. Aucune acceptation implicite : sans contrat, ni installation d'image Exegol ni création d'Exegol (dialogue d'acceptation proposé, refus = rien n'est lancé).
4. **Installation.** Une à la fois (`image.busy`), annulable (arrêt du pull, SIGTERM puis SIGKILL côté `docker build`), plafonnée à 30 minutes, diffusée à la coquille en `imageProgress` (espacée de 120 ms) même si elle part du cockpit. `createKali` installe l'image absente avant de créer ; `createExegol` propose d'installer l'image absente (`ui.confirm`) avant `exegol start`.
5. **Sécurité.** Aucun argument libre vers docker ou exegol : étiquettes `[a-z0-9][a-z0-9._-]{0,63}`, arguments fixes, processus sous `safeEnv`, sans shell. Les détails d'erreur sont masqués (`createRedactor`) et bornés (400 caractères) avant diffusion ; 429 et 404 du registre deviennent des codes dédiés (`image.rateLimited`, `image.notFound`). La gate, la politique et les options verrouillées ne changent pas.

## Contrat des messages (coquille)
- `imagesStatus {}` → `images {docker:{present,daemon}, kali:{image,installed,size?}, exegol:{cli,eulaAccepted,installed:[{tag,size?}],available:[étiquettes]}}`.
- `imageInstall {kind:"kali", rebuild?:boolean}` ou `{kind:"exegol", tag}` → flux `imageProgress {id, kind, phase:"pull"|"build"|"", stage, message?, layers[], busy, done?, cancelled?, error?, code?}`. Refus immédiat (occupé, étiquette) : `imageError {op, kind, code, text?}`.
- `imageCancel {id}` ; `exegolEula {}` (dialogues puis `images` rafraîchi).
- La page cockpit reçoit les mêmes progressions en `operation` quand `createKali` ou `createExegol` installe l'image.

## Conséquences
- Volume : Kali complet et les images Exegol pèsent de plusieurs Go à des dizaines de Go ; l'espace disque de l'hôte est à prévoir.
- Docker Hub limite le débit anonyme (429) : l'interface le dit clairement ; une connexion du démon à un compte Docker Hub lève la limite.
- L'utilisateur est le seul à accepter le contrat Exegol ; l'acceptation est enregistrée dans la configuration d'Exegol du serveur, pour tous ses utilisateurs.
- `docker compose --profile tools build kali` n'est plus nécessaire (le service reste pour qui veut `REDWIDOW_KALI_IMAGE=redwidow-kali:local`).
