import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOrigin } from "./auth/origin.js";

/** Configuration de l'hôte web. */
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly webDir: string;
  /** Origine publique normalisée (`REDWIDOW_PUBLIC_ORIGIN`). */
  readonly publicOrigin: string;
  /** `REDWIDOW_TRUST_PROXY=1` : l'IP cliente est la dernière valeur de `X-Forwarded-For`. */
  readonly trustProxy: boolean;
}

/** Variable d'environnement invalide (message technique, jamais de secret). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Dossier des fichiers statiques : `web/` du paquet (même position relative depuis `src` ou `dist`). */
const DEFAULT_WEB_DIR = fileURLToPath(new URL("../web", import.meta.url));

/** Dossier de données (`REDWIDOW_DATA_DIR`, `/data` par défaut). */
export function resolveDataDir(env: Readonly<Record<string, string | undefined>>): string {
  return resolve(env.REDWIDOW_DATA_DIR?.trim() || "/data");
}

/** Lit la configuration depuis l'environnement. Pure : ne touche ni au disque ni au réseau. L'origine publique est obligatoire (erreur codée). */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const host = env.REDWIDOW_HOST?.trim() || "127.0.0.1";
  const rawPort = env.REDWIDOW_PORT?.trim();
  let port = 8080;
  if (rawPort !== undefined && rawPort !== "") {
    if (!/^\d+$/.test(rawPort)) {
      throw new ConfigError("REDWIDOW_PORT doit être un entier entre 1 et 65535");
    }
    port = Number(rawPort);
    if (port < 1 || port > 65535) {
      throw new ConfigError("REDWIDOW_PORT doit être un entier entre 1 et 65535");
    }
  }
  return {
    host,
    port,
    dataDir: resolveDataDir(env),
    webDir: resolve(env.REDWIDOW_WEB_DIR?.trim() || DEFAULT_WEB_DIR),
    publicOrigin: normalizeOrigin(env.REDWIDOW_PUBLIC_ORIGIN),
    trustProxy: env.REDWIDOW_TRUST_PROXY?.trim() === "1",
  };
}
