import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Empreinte SHA-256 (hex minuscule) d'un fichier, lue en flux (le binaire `claude` pèse plusieurs centaines de Mio). */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Vrai si le fichier existe et correspond à l'empreinte attendue. Fail-closed :
 * fichier absent ou illisible, ou empreinte attendue mal formée, donnent `false`.
 */
export async function matchesFingerprint(path: string, expected: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  try {
    return (await sha256File(path)) === expected;
  } catch {
    return false;
  }
}
