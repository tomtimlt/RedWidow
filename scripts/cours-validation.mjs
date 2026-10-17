// Validation du manifeste des sources de cours (cours/sources.json). Module pur, sans réseau :
// utilisé par scripts/cours-sync.mjs et testé par vitest.

const NOM = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SHA = /^[0-9a-f]{7,40}$/i;
// Étiquette git : caractères sûrs uniquement (pas de « - » initial, pas d'option déguisée).
const ETIQUETTE = /^[A-Za-z0-9][A-Za-z0-9._/+-]{0,99}$/;
const BRANCHES = new Set(["main", "master", "develop", "dev", "trunk", "head", "latest"]);
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
const CLES = new Set(["nom", "url", "ref", "licence", "sousDossier"]);

/** Valide une entrée ; renvoie la liste des erreurs (vide si valide). */
export function validerEntree(entree) {
  if (entree === null || typeof entree !== "object" || Array.isArray(entree))
    return ["l'entrée doit être un objet"];
  const erreurs = [];
  for (const cle of Object.keys(entree))
    if (!CLES.has(cle)) erreurs.push(`clé inconnue « ${cle} »`);

  const { nom, url, ref, licence, sousDossier } = entree;
  if (typeof nom !== "string" || !NOM.test(nom)) erreurs.push("nom invalide");

  if (typeof url !== "string") erreurs.push("url invalide");
  else {
    let u = null;
    try {
      u = new URL(url);
    } catch {
      /* url invalide */
    }
    if (u === null || u.protocol !== "https:" || !u.hostname || u.username || u.password)
      erreurs.push("url invalide : https:// uniquement, sans identifiants");
  }

  if (typeof ref !== "string" || ref === "") erreurs.push("ref absente");
  else if (!SHA.test(ref) && (!ETIQUETTE.test(ref) || ref.includes("..")))
    erreurs.push("ref invalide");
  else if (BRANCHES.has(ref.toLowerCase())) erreurs.push("ref : un nom de branche est refusé");

  if (typeof licence !== "string" || !SPDX.test(licence))
    erreurs.push("licence absente ou invalide (identifiant SPDX requis)");

  if (sousDossier !== undefined) {
    if (typeof sousDossier !== "string" || sousDossier === "") erreurs.push("sousDossier invalide");
    else if (
      sousDossier.includes("\0") ||
      /^([/\\]|[A-Za-z]:)/.test(sousDossier) ||
      sousDossier.split(/[\\/]/).some((s) => s === ".." || s.includes(":"))
    )
      erreurs.push("sousDossier : chemin relatif sans « .. » ni chemin absolu requis");
  }
  return erreurs;
}

/** Valide le manifeste entier ; lève une Error listant toutes les erreurs. */
export function validerManifeste(manifeste) {
  if (!Array.isArray(manifeste)) throw new Error("le manifeste doit être un tableau");
  const erreurs = [];
  const noms = new Set();
  manifeste.forEach((entree, i) => {
    for (const e of validerEntree(entree)) erreurs.push(`entrée ${i} : ${e}`);
    const nom = entree?.nom;
    if (typeof nom === "string") {
      if (noms.has(nom)) erreurs.push(`entrée ${i} : nom en double « ${nom} »`);
      noms.add(nom);
    }
  });
  if (erreurs.length > 0) throw new Error(erreurs.join("\n"));
  return manifeste;
}
