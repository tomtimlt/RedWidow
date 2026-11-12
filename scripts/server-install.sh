#!/usr/bin/env bash
# Installation guidée de RedWidow Serveur (ADR 0052, point 7) sur un VPS dédié.
# Usage : scripts/server-install.sh [--force] [--no-start]
#   --force     écrase un .env existant (sinon le script refuse)
#   --no-start  prépare .env et le mot de passe, sans lancer « docker compose up »
#
# Données : dossier de l'hôte (REDWIDOW_DATA_HOST, /srv/redwidow par défaut) monté au même chemin dans le
# conteneur, propriétaire uid 10001 : Exegol exige des chemins identiques côté hôte et côté conteneur.
# Le script le crée s'il manque (sudo si besoin) et ne supprime ni ne remplace rien d'existant.
#
# Mot de passe : l'empreinte est écrite dans <données>/auth.json (0600) par
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
      sed -n '2,9p' "$0"
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

# Dossier de données sur l'hôte (chemin absolu, identique dans le conteneur).
data_host="${REDWIDOW_DATA_HOST:-/srv/redwidow}"
case "$data_host" in
  /*) ;;
  *) die "REDWIDOW_DATA_HOST doit être un chemin absolu : « $data_host »." ;;
esac
case "$data_host" in
  / | /bin | /boot | /dev | /etc | /home | /lib | /lib64 | /proc | /root | /run | /sbin | /sys | /usr | /var | /var/run)
    die "REDWIDOW_DATA_HOST ne peut pas être un dossier système : « $data_host »."
    ;;
esac
priv=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "créer $data_host exige les droits root (lancez le script avec sudo)."
  priv="sudo"
fi
echo "Dossier de données : $data_host (propriétaire uid 10001)."
$priv mkdir -p "$data_host/home" "$data_host/config"
$priv chown 10001:10001 "$data_host" "$data_host/home" "$data_host/config"
$priv chmod 700 "$data_host"

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
REDWIDOW_DATA_HOST=$data_host
EOF
umask "$old_umask"
chmod 600 .env
unset secret_key
echo ".env écrit (0600)."

echo "Construction de l'image (quelques minutes)..."
docker compose build redwidow

echo "Enregistrement du mot de passe dans le dossier de données..."
printf '%s\n' "$password" |
  docker compose run --rm -T redwidow node packages/server/dist/main.js set-password --stdin
unset password

if [ "$start" -eq 1 ]; then
  docker compose up -d --build
  echo
  echo "RedWidow démarre. Une fois le certificat obtenu : https://$domain"
  echo "Suivi : docker compose logs -f"
  echo "Exegol : acceptez une fois sa licence d'utilisation (voir docs/serveur.md, section Exegol)."
else
  echo "Prêt. Lancez « docker compose up -d --build » pour démarrer."
fi
