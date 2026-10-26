import * as tls from "node:tls";

type CertificateLoader = (source: "default" | "system") => readonly string[];
interface CertificateSource {
  getCACertificates?: CertificateLoader;
}
// API disponible depuis Node 22.15 ; les hôtes plus anciens gardent leurs
// autorités par défaut et NODE_EXTRA_CA_CERTS, sans désactiver la validation.
const runtimeSource = tls as unknown as CertificateSource;

/** Fusion locale au client web : ne modifie pas la confiance TLS globale du processus. */
export function webCertificateAuthorities(
  source: CertificateSource = runtimeSource,
): string[] | undefined {
  const load = source.getCACertificates;
  if (typeof load !== "function") return undefined;
  try {
    // « default » conserve aussi les certificats supplémentaires chargés au
    // démarrage. « system » inclut notamment le magasin de confiance Windows.
    const certificates = [...new Set([...load("default"), ...load("system")])];
    return certificates.length > 0 ? certificates : undefined;
  } catch {
    // Un magasin indisponible ne doit jamais faire accepter un certificat
    // invalide : absence de surcharge = comportement strict habituel de Node.
    return undefined;
  }
}
