import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Configuration de l'hôte web. */
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly webDir: string;
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

/** Lit la configuration depuis l'environnement. Pure : ne touche ni au disque ni au réseau. */
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
    dataDir: resolve(env.REDWIDOW_DATA_DIR?.trim() || "/data"),
    webDir: resolve(env.REDWIDOW_WEB_DIR?.trim() || DEFAULT_WEB_DIR),
  };
}
