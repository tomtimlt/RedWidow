# RedWidow Serveur

Version web de RedWidow, à installer sur un VPS Linux et à ouvrir dans un navigateur derrière un mot de passe. Décisions : ADR 0052 (version serveur web et authentification) et ADR 0053 (terminal humain dans l'interface web).

## Ce qu'il faut

- Un VPS **dédié** : le conteneur serveur reçoit le socket Docker de l'hôte, donc les droits de l'hôte. N'y faites rien tourner d'autre.
- Docker Engine et le plugin Compose.
- Un nom de domaine dont le DNS pointe vers le VPS, ports 80 et 443 ouverts (Caddy obtient le certificat HTTPS tout seul).

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
4. écrit l'empreinte du mot de passe dans `/data/auth.json` (volume Docker), pas dans `.env` ;
5. lance `docker compose up -d --build`.

Ouvrez ensuite `https://<votre domaine>`.

Sans le script : copiez `.env.example` en `.env`, remplissez-le (`chmod 600 .env`), puis :

```bash
docker compose run --rm -T redwidow node packages/server/dist/main.js set-password
```

```bash
docker compose up -d --build
```

Image Kali pour les missions (facultatif) :

```bash
docker compose --profile tools build kali
```

## Variables

| Variable | Rôle |
|---|---|
| `REDWIDOW_DOMAIN` | Domaine servi par Caddy. |
| `REDWIDOW_PUBLIC_ORIGIN` | Origine exacte (`https://domaine`), obligatoire : contrôle d'origine des requêtes et des WebSocket. |
| `REDWIDOW_SECRET_KEY` | Clé maître (≥ 32 caractères), obligatoire : chiffre les secrets de `/data`. **Sans elle, les secrets sont perdus.** |
| `REDWIDOW_PASSWORD_HASH` | Facultatif, à la place de `/data/auth.json` (doubler les `$` dans `.env`). |
| `DOCKER_GID` | Groupe propriétaire du socket Docker de l'hôte. |

Le serveur refuse de démarrer sans mot de passe, sans origine ou sans clé maître.

## Sécurité, en bref

- Seul Caddy publie des ports ; le serveur écoute sur le réseau interne.
- Cookie de session `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, 12 h glissantes, 7 jours au plus. Attente croissante après chaque mauvais mot de passe.
- La gate d'approbation reste l'unique autorité : sans navigateur connecté, une demande attend. L'arrêt d'urgence est persisté et survit à un redémarrage.
- Les clés des fournisseurs et les comptes de test sont chiffrés au repos (AES-256-GCM).
- Le terminal humain s'ouvre seulement dans un conteneur Kali/Exegol géré et tout y est journalisé (secrets connus masqués).

## Clés de fournisseur et bascule

Dans Fournisseurs, enregistrez plusieurs clés pour un même fournisseur (par exemple plusieurs comptes OpenCode) et ordonnez-les. Quand le fournisseur signale la limite (« Free usage exceeded », 429), le serveur refuse proprement les approbations en attente, relance le moteur avec la clé suivante sur la même conversation et demande à l'agent de reprendre. La bascule est confirmée quand l'agent répond sans nouvelle erreur ; sinon la clé suivante est essayée. Clés toutes épuisées : la mission s'arrête et l'interface l'indique. Chaque bascule est journalisée par libellé, jamais par valeur.

## Sauvegarde

Tout l'état est dans le volume `redwidow-data` (`/data`) : état, coffre chiffré, mot de passe, projets, journaux. **Gardez `REDWIDOW_SECRET_KEY` à part** : sans elle, la sauvegarde du coffre est illisible.

```bash
docker run --rm -v redwidow_redwidow-data:/data -v "$PWD":/sauvegarde mirror.gcr.io/library/alpine tar czf /sauvegarde/redwidow-data.tgz -C /data .
```

Restauration : arrêter (`docker compose down`), recréer le volume, extraire l'archive dedans, relancer.

## Mise à jour

```bash
git pull
```

```bash
docker compose up -d --build
```

Les données du volume sont conservées. Un arrêt d'urgence actif le reste après la mise à jour.

## Derrière un miroir de registre

Si Docker Hub refuse les téléchargements (429), passez les images de base par un miroir dans `.env` : `NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim`, `DOCKER_CLI_IMAGE=mirror.gcr.io/library/docker:27-cli`, `CADDY_IMAGE=mirror.gcr.io/library/caddy:2-alpine`.
