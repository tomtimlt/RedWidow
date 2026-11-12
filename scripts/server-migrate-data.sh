#!/usr/bin/env bash
# Migration des données d'une installation existante : volume Docker nommé -> dossier de l'hôte.
# Usage : scripts/server-migrate-data.sh [--yes] [dossier]   (dossier : /srv/redwidow par défaut)
#   --yes  ne demande pas de confirmation
#
# Pourquoi : Exegol (lancé par le serveur) fait monter par le démon Docker de l'HÔTE le dossier de
# travail ; le chemin doit donc être identique côté hôte et côté conteneur (docker-compose.yml).
#
# Le script : arrête le serveur, copie le volume `redwidow_redwidow-data` vers le dossier (permissions
# conservées, propriétaire uid 10001), écrit REDWIDOW_DATA_HOST dans .env puis relance. Le volume
# d'origine n'est PAS supprimé (sauvegarde : supprimez-le à la main une fois la migration vérifiée).
# Idempotent : si .env pointe déjà sur le dossier, ou si le dossier contient déjà des données, il
# n'écrase rien et s'arrête.
set -euo pipefail

yes=0
target=""
for arg in "$@"; do
  case "$arg" in
    --yes) yes=1 ;;
    -h | --help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    -*)
      echo "Option inconnue : $arg" >&2
      exit 2
      ;;
    *) target="$arg" ;;
  esac
done
target="${target:-/srv/redwidow}"
volume="${REDWIDOW_VOLUME:-redwidow_redwidow-data}"
helper_image="${MIGRATE_IMAGE:-mirror.gcr.io/library/alpine}"

cd "$(dirname "$0")/.."

die() {
  echo "Erreur : $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "docker est introuvable."
docker compose version >/dev/null 2>&1 || die "le plugin « docker compose » (v2) est introuvable."
docker info >/dev/null 2>&1 || die "le démon Docker ne répond pas."
[ -f .env ] || die ".env introuvable (lancez le script depuis le dépôt de l'installation)."
case "$target" in
  /*) ;;
  *) die "le dossier doit être un chemin absolu : « $target »." ;;
esac
case "$target" in
  / | /bin | /boot | /dev | /etc | /home | /lib | /lib64 | /proc | /root | /run | /sbin | /sys | /usr | /var | /var/run)
    die "dossier système refusé : « $target »."
    ;;
esac

current="$(grep -E '^REDWIDOW_DATA_HOST=' .env | tail -n 1 | cut -d= -f2- || true)"
if [ -n "$current" ]; then
  echo "Déjà migré : .env contient REDWIDOW_DATA_HOST=$current. Rien à faire."
  exit 0
fi

docker volume inspect "$volume" >/dev/null 2>&1 || die "volume « $volume » introuvable (REDWIDOW_VOLUME pour un autre nom)."

priv=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "créer $target exige les droits root (lancez le script avec sudo)."
  priv="sudo"
fi

if [ -e "$target" ] && [ -n "$($priv ls -A "$target" 2>/dev/null)" ]; then
  die "$target existe et n'est pas vide : rien n'est écrasé. Videz-le ou choisissez un autre dossier."
fi

echo "Migration : volume « $volume » -> $target (même chemin dans le conteneur)."
echo "Le serveur sera arrêté pendant la copie ; le volume d'origine est conservé."
if [ "$yes" -ne 1 ]; then
  read -r -p "Continuer ? [o/N] " answer
  case "$answer" in
    o | O | oui | OUI | y | Y) ;;
    *) die "annulé." ;;
  esac
fi

docker compose stop redwidow || true

$priv mkdir -p "$target"
# Copie fidèle (droits, dates, liens) : le conteneur d'aide ne voit que ces deux montages, sans réseau.
docker run --rm --network none \
  -v "$volume":/from:ro \
  -v "$target":/to \
  "$helper_image" sh -c 'cp -a /from/. /to/ && mkdir -p /to/home /to/config && chown 10001:10001 /to /to/home /to/config && chmod 700 /to'
# Contrôle : auth.json copié si présent à la source.
if docker run --rm --network none -v "$volume":/from:ro "$helper_image" test -e /from/auth.json; then
  $priv test -e "$target/auth.json" || die "copie incomplète (auth.json absent de $target) ; .env non modifié."
fi

printf '\nREDWIDOW_DATA_HOST=%s\n' "$target" >>.env
echo "REDWIDOW_DATA_HOST=$target ajouté à .env."
docker compose up -d
echo "Terminé. Vérifiez le site, puis supprimez l'ancien volume si vous le souhaitez :"
echo "  docker volume rm $volume"
