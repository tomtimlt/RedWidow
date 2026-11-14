# RedWidow Serveur

Version web de RedWidow, à installer sur un VPS Linux et à ouvrir dans un navigateur derrière un mot de passe. Décisions : ADR 0052 (version serveur web et authentification), ADR 0053 (terminal humain dans l'interface web), ADR 0054 (identifiant enregistré par l'agent), ADR 0055 (dialogues et fichiers web), ADR 0056 (un projet vit dans un conteneur) et ADR 0057 (images de conteneurs depuis le web).

Tout se fait depuis l'interface : conteneurs, images Kali et Exegol, projets, fichiers (éditeur compris), terminal, fournisseurs et clés, rapport. Le terminal de l'hôte n'est utile que pour l'installation et les mises à jour.

## Ce qu'il faut

- Un VPS **dédié** : le conteneur serveur reçoit le socket Docker de l'hôte, donc les droits de l'hôte. N'y faites rien tourner d'autre.
- Docker Engine et le plugin Compose.
- Un nom de domaine dont le DNS pointe vers le VPS, ports 80 et 443 ouverts (Caddy obtient le certificat HTTPS tout seul). **Sans domaine** : utilisez `<adresse IP>.sslip.io` (par exemple `141.95.162.224.sslip.io`), qui pointe tout seul vers votre IP et reçoit un vrai certificat ; pensez à bien recopier l'adresse.

## Installation

```bash
git clone <ce dépôt> redwidow
```

```bash
cd redwidow && git checkout claude/tender-maxwell-sd8ptd
```

```bash
scripts/server-install.sh
```

Le script :
1. vérifie Docker et Compose ;
2. demande le domaine et le mot de passe (saisie sans écho, deux fois, 12 caractères minimum) ;
3. génère `REDWIDOW_SECRET_KEY` et écrit `.env` en `0600` (refuse d'écraser un `.env` existant sans `--force`) ;
4. crée le dossier de données de l'hôte `/srv/redwidow` (propriétaire uid 10001, `REDWIDOW_DATA_HOST` pour un autre chemin), sans rien supprimer d'existant (demande `sudo` si vous n'êtes pas root) ;
5. écrit l'empreinte du mot de passe dans `auth.json` de ce dossier, pas dans `.env` ;
6. lance `docker compose up -d --build`.

Ouvrez ensuite `https://<votre domaine>`.

Sans le script : copiez `.env.example` en `.env`, remplissez-le (`chmod 600 .env`). Pour le partage Exegol, créez le dossier de données (`sudo install -d -o 10001 -g 10001 -m 700 /srv/redwidow /srv/redwidow/home /srv/redwidow/config`) et ajoutez `REDWIDOW_DATA_HOST=/srv/redwidow` à `.env`. Puis :

```bash
docker compose run --rm -T redwidow node packages/server/dist/main.js set-password
```

```bash
docker compose up -d --build
```

Les images Kali et Exegol s'installent depuis l'interface (section « Images de conteneurs »), sans terminal.

## Variables

| Variable | Rôle |
|---|---|
| `REDWIDOW_DOMAIN` | Domaine servi par Caddy. |
| `REDWIDOW_PUBLIC_ORIGIN` | Origine exacte (`https://domaine`), obligatoire : contrôle d'origine des requêtes et des WebSocket. |
| `REDWIDOW_SECRET_KEY` | Clé maître (≥ 32 caractères), obligatoire : chiffre les secrets du dossier de données. **Sans elle, les secrets sont perdus.** |
| `REDWIDOW_PASSWORD_HASH` | Facultatif, à la place de `auth.json` (doubler les `$` dans `.env`). |
| `REDWIDOW_DATA_HOST` | Dossier de données de l'hôte (`/srv/redwidow`), monté au même chemin dans le conteneur. Vide : volume nommé historique `/data`. |
| `REDWIDOW_DEFAULT_PROVIDER` | Facultatif : fournisseur initial d'un nouveau chat (`claude`, `openai` ou `opencode`). Vide : OpenCode si le serveur a une clé OpenCode (jeton ou réserve), sinon le premier fournisseur ayant un jeton. Valeur invalide ignorée. |
| `REDWIDOW_DEFAULT_MODEL` | Facultatif : modèle initial d'un nouveau chat, à renseigner dans votre `.env` (identifiant tel que le fournisseur l'annonce). Appliqué seulement s'il figure dans la liste du fournisseur par défaut, sinon ignoré (trace dans l'audit) ; au plus 200 caractères, sans caractère de contrôle. |
| `DOCKER_GID` | Groupe propriétaire du socket Docker de l'hôte. |

Le serveur refuse de démarrer sans mot de passe, sans origine ou sans clé maître.

Les deux défauts ne valent que pour un chat qui n'a encore aucune préférence enregistrée : le choix de l'utilisateur (fournisseur, modèle) prime ensuite. Ils sont exposés en lecture seule (`defaultProvider`, `defaultModel`) dans le message `settings` de la coquille.

## Sécurité, en bref

- Seul Caddy publie des ports ; le serveur écoute sur le réseau interne.
- Cookie de session `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, 12 h glissantes, 7 jours au plus. Attente croissante après chaque mauvais mot de passe.
- La gate d'approbation reste l'unique autorité : sans navigateur connecté, une demande attend. L'arrêt d'urgence est persisté et survit à un redémarrage.
- Les clés des fournisseurs et les comptes de test sont chiffrés au repos (AES-256-GCM).
- Le terminal humain s'ouvre seulement dans un conteneur Kali/Exegol géré et tout y est journalisé (secrets connus masqués).

## Conteneurs et projets (ADR 0056)

La règle est simple : **un projet vit toujours dans un conteneur**, et un conteneur peut vivre sans projet.

- **Un dossier partagé par conteneur, créé tout seul.** Tous sont sous `<dossier de données>/containers/` (`/srv/redwidow/containers/`) : `kali-1/`, `kali-2/`, `exegol-1/`… Aucun dossier à choisir à la main. Chaque dossier reçoit la racine RedWidow (`evidence`, `notes`, `payloads`, `reports`, `scans`, `scripts`) et est monté dans le conteneur sur `/workspace` : c'est le seul montage de l'hôte, sans privilèges ni socket Docker.
- **Créer un projet exige un conteneur**, démarré ou arrêté. Le projet est un sous-dossier : `containers/<conteneur>/<projet>/`. Un conteneur héberge plusieurs projets. Sans conteneur, la création est refusée et l'interface dit d'en créer un d'abord.
- **Projets plus anciens, sans conteneur.** Ils sont conservés et marqués « à lier ». Quand vous en activez un, une fenêtre vous demande dans quel conteneur le déplacer ; rien ne bouge sans votre réponse.
- **Supprimer un conteneur** garde son dossier et ses projets. Les supprimer aussi demande une seconde confirmation explicite.
- **Fichiers créés par les outils.** Les outils tournent en root dans le conteneur : le serveur lit et modifie ces fichiers sans souci. Supprimer un dossier créé par root se fait en root dans le conteneur démarré, après une confirmation dédiée de votre part ; conteneur arrêté, l'interface vous dit de le démarrer ou d'utiliser son terminal. Si vous supprimez un conteneur **et** son dossier partagé alors que celui-ci contient des fichiers root, le conteneur n'existe déjà plus : l'interface vous demande alors de supprimer le dossier depuis l'hôte, avec les droits administrateur.

## Clés de fournisseur et bascule

Dans Fournisseurs, enregistrez plusieurs clés pour un même fournisseur (par exemple plusieurs comptes OpenCode) et ordonnez-les. Quand le fournisseur signale la limite (« Free usage exceeded », 429), le serveur refuse proprement les approbations en attente, relance le moteur avec la clé suivante sur la même conversation et demande à l'agent de reprendre. La bascule est confirmée quand l'agent répond sans nouvelle erreur ; sinon la clé suivante est essayée. Clés toutes épuisées : la mission s'arrête et l'interface l'indique. Chaque bascule est journalisée par libellé, jamais par valeur.

## Images de conteneurs (Kali, Exegol)

Aucune commande n'est nécessaire : l'interface propose l'installation des images (ADR 0057, images de conteneurs depuis le web). Une seule installation à la fois, avec progression par couches et bouton Annuler.

- **Kali.** Image `warband/kali:complete-1`, la même que l'extension VS Code : le serveur télécharge `kalilinux/kali-rolling` puis construit l'image (outils Kali, plusieurs Go, plusieurs minutes) avec le client `docker` de l'image serveur. L'image n'est construite que si elle est absente ; « Reconstruire » la retire d'abord (refusé tant qu'un conteneur s'en sert). Créer un conteneur Kali alors que l'image manque l'installe automatiquement. `REDWIDOW_KALI_IMAGE` choisit une autre image : elle est alors téléchargée, jamais construite.
- **Exegol.** Étiquettes proposées : `free`, `full`, `light`, `web`, `osint`, `ad`, `nightly` (saisie libre, validée `[a-z0-9._-]`, 64 caractères). L'image `nwodtuhs/exegol:<étiquette>` est téléchargée par le démon Docker (API Engine) : la CLI `exegol install` n'est pas utilisée (voir l'ADR). Avant tout, **vous** acceptez le contrat d'utilisation d'Exegol : le bouton « Accepter le contrat » ouvre le lien officiel et demande une confirmation explicite, puis le serveur exécute `exegol version --accept-eula`. Sans cette acceptation, aucune image Exegol n'est installée ni aucun conteneur Exegol créé.
- **Volume et limites.** Une image Exegol pèse de plusieurs Go à plusieurs dizaines de Go ; prévoyez l'espace du disque de l'hôte. Docker Hub limite le débit des téléchargements anonymes (erreur 429, message clair dans l'interface) : patientez, ou connectez le démon Docker de l'hôte à un compte Docker Hub (`docker login` sur l'hôte). Un téléchargement est interrompu au bout de 30 minutes. Derrière un miroir de registre, voir la dernière section.

## Exegol

L'image serveur embarque la CLI Exegol (paquet Python `exegol` **6.0.2**, version exacte dans `containers/server/Dockerfile`, argument `EXEGOL_VERSION`, installée dans `/opt/exegol`, lien `/usr/local/bin/exegol`). Le bouton de création d'un Exegol du cockpit lance `exegol start` côté serveur ; sans la CLI, le cockpit répond « Exegol n'est pas installé ». L'image grossit d'environ 240 Mo (Python, git et les bibliothèques d'Exegol). Aucune clé ni licence n'est dans l'image.

À faire **une fois**, par vous (l'acceptation vous engage, le serveur ne la fait pas à votre place) : bouton « Accepter le contrat » de l'interface (section précédente), ou, en terminal :

```bash
docker compose exec redwidow exegol version
```

Exegol demande d'accepter son contrat d'utilisation (EULA) puis propose d'activer un abonnement. Sans abonnement, l'édition Community est gratuite mais limitée à un usage personnel, non commercial, éducatif ou de recherche. Votre choix est mémorisé dans `<dossier de données>/home/.exegol` : les créations lancées depuis le cockpit ne posent plus de question. Avec un abonnement, activez-le de la même façon (`exegol activate`, invite interactive) ; la clé reste dans ce dossier, jamais dans l'image ni dans `.env`.

Points à connaître :
- **Dossier de données au même chemin.** Le démon Docker de l'hôte monte le dossier de travail transmis à `exegol start` : le chemin doit être identique côté hôte et côté conteneur serveur. Le service monte donc `REDWIDOW_DATA_HOST` (`/srv/redwidow`) sur le même chemin. Avec l'ancien volume nommé (variable vide), le partage Exegol échoue : migrez (section suivante).
- **Images volumineuses.** La première création télécharge l'image Exegol (de plusieurs Go à plusieurs dizaines de Go selon l'image choisie) sur le disque de l'hôte : prévoyez l'espace et la patience (le cockpit attend jusqu'à 30 minutes). Les mises à jour d'images sont proposées par Exegol, jamais lancées d'office.
- Les conteneurs Exegol sont des conteneurs frères, créés par l'hôte. Le socket Docker n'est jamais monté dans un conteneur Exegol ou Kali.

## Migration du volume nommé vers le dossier de l'hôte

Pour une installation faite avant le dossier de données (volume `redwidow_redwidow-data`). `docker compose up` continue de fonctionner sans rien changer ; la migration n'est nécessaire que pour Exegol et pour une sauvegarde plus simple.

```bash
git pull
```

```bash
sudo scripts/server-migrate-data.sh
```

Le script demande confirmation, arrête le serveur, copie le volume vers `/srv/redwidow` (droits conservés, propriétaire uid 10001), ajoute `REDWIDOW_DATA_HOST=/srv/redwidow` à `.env` et relance. Il refuse d'écraser un dossier non vide et s'arrête si la migration est déjà faite. Un autre dossier se passe en argument (`sudo scripts/server-migrate-data.sh /chemin`). L'ancien volume est conservé : supprimez-le (`docker volume rm redwidow_redwidow-data`) une fois le site vérifié. Ne relancez pas `scripts/server-install.sh --force` sur une installation existante : il écraserait `.env`.

## Sauvegarde

Tout l'état est dans le dossier de données (`/srv/redwidow` ; volume `redwidow-data` pour une installation non migrée) : état, coffre chiffré, mot de passe, projets, journaux, configuration Exegol. **Gardez `REDWIDOW_SECRET_KEY` à part** : sans elle, la sauvegarde du coffre est illisible.

```bash
sudo tar czpf redwidow-data.tgz -C /srv/redwidow .
```

Installation non migrée :

```bash
docker run --rm -v redwidow_redwidow-data:/data -v "$PWD":/sauvegarde mirror.gcr.io/library/alpine tar czf /sauvegarde/redwidow-data.tgz -C /data .
```

Restauration : arrêter (`docker compose down`), extraire l'archive dans le dossier (`sudo tar xzpf redwidow-data.tgz -C /srv/redwidow`, propriétaire uid 10001), relancer.

## Mise à jour

```bash
git pull
```

```bash
docker compose up -d --build
```

Les données (dossier ou volume) sont conservées. Un arrêt d'urgence actif le reste après la mise à jour.

## Derrière un miroir de registre

Si Docker Hub refuse les téléchargements (429), passez les images de base par un miroir dans `.env` : `NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim`, `DOCKER_CLI_IMAGE=mirror.gcr.io/library/docker:27-cli`, `CADDY_IMAGE=mirror.gcr.io/library/caddy:2-alpine`.
