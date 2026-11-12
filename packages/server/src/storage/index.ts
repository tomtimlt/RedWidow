import { type DataPaths, ensureDataDir } from "./paths.js";
import { createSecretStore, readSecretKey, type SecretStore } from "./secrets.js";
import { createStateStore, type StateStoreHandle } from "./state.js";

export { type DataPaths, dataPaths, ensureDataDir } from "./paths.js";
export {
  createSecretStore,
  MIN_SECRET_KEY_LENGTH,
  readSecretKey,
  type SecretStore,
} from "./secrets.js";
export { createStateStore, type StateStore, type StateStoreHandle } from "./state.js";

/** Stockage persistant du serveur, passé aux lots suivants (sans logique métier). */
export interface ServerStorage {
  readonly paths: DataPaths;
  readonly state: StateStoreHandle;
  readonly secrets: SecretStore;
}

/** Ouvre le dossier de données, l'état et le coffre. La clé maître ne sort pas de cette fonction. */
export async function openStorage(
  dataDir: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<ServerStorage> {
  const masterKey = readSecretKey(env);
  const paths = await ensureDataDir(dataDir);
  const state = createStateStore(paths.state);
  await state.open();
  const secrets = await createSecretStore(paths.secrets, masterKey);
  return { paths, state, secrets };
}
