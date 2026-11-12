#!/usr/bin/env bash
# Installation guidée de RedWidow Serveur (ADR 0052, point 7) sur un VPS dédié.
# Usage : scripts/server-install.sh [--force] [--no-start]
#   --force     écrase un .env existant (sinon le script refuse)
#   --no-start  prépare .env et le mot de passe, sans lancer « docker compose up »
#
# Mot de passe : l'empreinte est écrite dans /data/auth.json (volume Docker, 0600) par
# `set-password --stdin`, et NON dans .env : une empreinte contient des « $ » que Docker Compose
# interpolerait dans un fichier .env. Ainsi, aucun échappement fragile et aucun secret
# d'authentification dans un fichier de configuration lisible.
set -euo pipefail

force=0
start=1
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --no-start) start=0 ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Option inconnue : $arg" >&2
      exit 2
      ;;
  esac
done

cd "$(dirname "$0")/.."

die() {
  echo "Erreur : $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "docker est introuvable (installez Docker Engine)."
docker compose version >/dev/null 2>&1 || die "le plugin « docker compose » (v2) est introuvable."
docker info >/dev/null 2>&1 || die "le démon Docker ne répond pas (droits ou service arrêté ?)."

if [ -e .env ] && [ "$force" -ne 1 ]; then
  die ".env existe déjà ; relancez avec --force pour l'écraser."
fi

echo "RedWidow Serveur donne au conteneur les droits de l'hôte (socket Docker) : utilisez un VPS dédié."
echo

read -r -p "Nom de domaine (DNS déjà pointé vers ce serveur, ex. redwidow.example.com) : " domain
domain="${domain#https://}"
domain="${domain%/}"
if ! printf '%s' "$domain" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$'; then
  die "nom de domaine invalide : « $domain »."
fi

read -r -s -p "Mot de passe (12 caractères minimum) : " password
echo
read -r -s -p "Confirmation : " again
echo
[ "$password" = "$again" ] || die "les deux saisies diffèrent."
unset again
[ "${#password}" -ge 12 ] || die "mot de passe trop court (12 caractères minimum)."

# Clé secrète : 64 caractères hexadécimaux.
if command -v openssl >/dev/null 2>&1; then
  secret_key="$(openssl rand -hex 32)"
else
  secret_key="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
[ "${#secret_key}" -ge 32 ] || die "génération de la clé secrète impossible."

# gid du groupe propriétaire du socket Docker.
docker_gid="$(stat -c %g /var/run/docker.sock 2>/dev/null || true)"
case "$docker_gid" in
  '' | *[!0-9]*) docker_gid="$(getent group docker | cut -d: -f3 || true)" ;;
esac
case "$docker_gid" in
  '' | *[!0-9]*) die "gid du groupe docker introuvable (renseignez DOCKER_GID dans .env à la main)." ;;
esac

# .env en 0600 dès la création (umask), sans valeur à interpoler : domaine, origine, clé, gid.
old_umask="$(umask)"
umask 077
cat >.env <<EOF
# Généré par scripts/server-install.sh. Ne pas commiter. Voir .env.example pour les réglages avancés.
REDWIDOW_DOMAIN=$domain
REDWIDOW_PUBLIC_ORIGIN=https://$domain
REDWIDOW_SECRET_KEY=$secret_key
DOCKER_GID=$docker_gid
EOF
umask "$old_umask"
chmod 600 .env
unset secret_key
echo ".env écrit (0600)."

echo "Construction de l'image (quelques minutes)..."
docker compose build redwidow

echo "Enregistrement du mot de passe dans le volume de données..."
printf '%s\n' "$password" |
  docker compose run --rm -T redwidow node packages/server/dist/main.js set-password --stdin
unset password

if [ "$start" -eq 1 ]; then
  docker compose up -d --build
  echo
  echo "RedWidow démarre. Une fois le certificat obtenu : https://$domain"
  echo "Suivi : docker compose logs -f"
else
  echo "Prêt. Lancez « docker compose up -d --build » pour démarrer."
fi
