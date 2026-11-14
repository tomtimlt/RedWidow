// Catalogue client minimal : code de raison renvoyé par le serveur → texte français. Le serveur ne renvoie
// que des codes (jamais le message brut du démon) ; un code inconnu est affiché tel quel, borné.
const REASONS = {
  "container.invalidName": "Nom de conteneur invalide.",
  "container.exists": "Un conteneur porte déjà ce nom.",
  "container.folderExists": "Un dossier partagé porte déjà ce nom : choisissez un autre nom.",
  "container.failed": "L'opération sur le conteneur a échoué.",
  "container.link": "Le dossier partagé du conteneur n'a pas pu être préparé.",
  "docker.unavailable": "Docker est injoignable depuis le serveur.",
  "docker.failed": "Docker a refusé l'opération.",
  "image.busy": "Une installation d'image est déjà en cours : attendez sa fin ou annulez-la.",
  "image.inUse": "L'image est utilisée par un conteneur : supprimez-le d'abord.",
  "image.invalidTag": "Étiquette d'image refusée.",
  "image.notFound": "Image introuvable sur le registre.",
  "image.rateLimited":
    "Docker Hub limite le débit des téléchargements anonymes. Réessayez plus tard, ou connectez le démon Docker à un compte Docker Hub.",
  "exegol.notInstalled": "La commande exegol est absente du serveur.",
  "exegol.eulaRequired": "Le contrat d'utilisation d'Exegol doit d'abord être accepté.",
  "exegol.eulaFailed": "L'acceptation du contrat Exegol a échoué.",
  "exegol.containerDenied": "Création du conteneur Exegol refusée.",
  "exegol.createFailed": "La création du conteneur Exegol a échoué.",
  "exegol.needsNat": "Exegol demande un réseau NAT que ce serveur ne fournit pas.",
  "exegol.vpnMissing": "Le VPN demandé pour Exegol est introuvable.",
  "project.noContainer": "Créez d'abord un conteneur : un projet vit toujours dans un conteneur.",
  "project.containerUnknown": "Ce conteneur n'existe pas ou n'est pas géré par RedWidow.",
  "project.invalid": "Nom de projet invalide.",
  "project.create": "La création du projet a échoué.",
  "project.destExists": "Un projet de ce nom existe déjà dans ce conteneur.",
  "project.move": "Le projet n'a pas pu être déplacé.",
  "project.moveFailed": "Le projet n'a pas pu être déplacé.",
  "project.notRunning": "Le conteneur doit être démarré pour cette opération.",
  "project.absent": "Projet introuvable.",
  "project.changed": "Le projet a changé entre-temps : actualisez puis recommencez.",
  "project.unlinked": "Ce projet n'est pas encore lié à un conteneur.",
  "project.activate": "L'activation du projet a échoué.",
  "project.none": "Aucun projet actif.",
  "project.remove": "Le projet n'a pas pu être supprimé.",
  "project.rename": "Le projet n'a pas pu être renommé.",
};

/** Texte borné d'une donnée reçue (sans contrôle). */
function clean(value, max) {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value.slice(0, max)) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out;
}

/** Vrai si le code a un libellé dans le catalogue. */
export const knownReason = (code) => typeof code === "string" && Object.hasOwn(REASONS, code);

/** Libellé d'un code de raison ; un code inconnu est affiché tel quel. */
export const reasonText = (code) =>
  knownReason(code) ? REASONS[code] : `Refusé (${clean(code, 80)})`;
