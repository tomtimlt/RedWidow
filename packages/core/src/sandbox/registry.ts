export type SandboxNetwork = "none" | "bridge";

/** Un bac à sable créé par ce processus : l'enregistrement est ce qui l'autorise (jamais le label Docker). */
export interface SandboxRecord {
  /** Identifiant complet (64 hex). */
  readonly id: string;
  readonly runId: string;
  /** Réseau et limites choisis à la création (opérateur), jamais relus depuis un outil. */
  readonly network: SandboxNetwork;
  readonly memory: string;
  readonly cpus: number;
  /** Hors service (redémarrage impossible) : toute exécution est refusée. */
  unavailable: boolean;
  /** Suppression synchrone (filet de sortie) ; ne lève pas. */
  readonly removeSync: () => void;
}

/**
 * Registre en mémoire des bacs à sable créés par ce processus : l'AUTORITÉ sur
 * les identifiants de conteneur. Un identifiant absent est refusé, quel que soit
 * son label Docker (falsifiable par quiconque peut lancer `docker run`).
 */
export class SandboxRegistry {
  readonly #records = new Map<string, SandboxRecord>();

  /** S'inscrit au filet de sortie à l'ajout et s'en retire une fois vide (pas de fuite de registres). */
  add(record: SandboxRecord): void {
    installExitHook();
    liveRegistries.add(this);
    this.#records.set(record.id, record);
  }

  get(id: string): SandboxRecord | undefined {
    return this.#records.get(id);
  }

  has(id: string): boolean {
    return this.#records.has(id);
  }

  delete(id: string): void {
    this.#records.delete(id);
    if (this.#records.size === 0) liveRegistries.delete(this);
  }

  ids(): string[] {
    return [...this.#records.keys()];
  }

  /** @internal Filet de sortie. */
  drain(): SandboxRecord[] {
    const all = [...this.#records.values()];
    this.#records.clear();
    liveRegistries.delete(this);
    return all;
  }
}

const liveRegistries = new Set<SandboxRegistry>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", removeAllSandboxesSync);
}

/**
 * Filet de sortie (exporté pour les tests) : supprime de façon SYNCHRONE tous les
 * bacs à sable encore enregistrés (second Ctrl-C, `process.exit`), comme
 * `killAllGroups` pour les arbres de processus.
 */
export function removeAllSandboxesSync(): void {
  for (const registry of liveRegistries) {
    for (const record of registry.drain()) {
      try {
        record.removeSync();
      } catch {
        // à la sortie, rien d'autre à tenter : `john sandbox prune` rattrapera l'orphelin.
      }
    }
  }
}
