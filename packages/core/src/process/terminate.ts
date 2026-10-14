import {
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
  spawn,
  spawnSync,
} from "node:child_process";
import { win32 } from "node:path";
import { safeEnv } from "./run.js";

export interface TerminateOptions {
  /** Délai entre SIGTERM et SIGKILL (défaut : 5000 ms). */
  graceMs?: number;
  /** Attente maximale après SIGKILL avant d'abandonner les tubes (défaut : 1000 ms). */
  killWaitMs?: number;
  /** Plateforme simulée (défaut : `process.platform`) ; sous win32, arrêt par `taskkill`. */
  platform?: NodeJS.Platform;
  /** Lanceur de `taskkill` (test) : résout `true` si la commande a réussi. Défaut : `spawn` réel. */
  taskkill?: TaskkillLauncher;
  /** Environnement où lire `SystemRoot` (défaut : `process.env`). */
  env?: NodeJS.ProcessEnv;
}

/** Lance `file args` (sans shell) et résout `true` en cas de succès (code 0), `false` sinon. */
export type TaskkillLauncher = (
  file: string,
  args: readonly string[],
  options: SpawnOptions & { timeout: number },
) => Promise<boolean>;

/** Variante synchrone, pour le filet de sortie. */
export type TaskkillSyncLauncher = (
  file: string,
  args: readonly string[],
  options: SpawnSyncOptions & { timeout: number },
) => boolean;

const TASKKILL_TIMEOUT_MS = 5000;
const TASKKILL_EXIT_TIMEOUT_MS = 2000;

const isWindows = (platform: NodeJS.Platform = process.platform) => platform === "win32";

/** Chemin absolu de `taskkill.exe` : `<SystemRoot>\System32`, repli `C:\Windows`. */
function taskkillPath(env: NodeJS.ProcessEnv): string {
  let root: string | undefined;
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === "SYSTEMROOT" && value) {
      root = value;
      break;
    }
  }
  if (root === undefined || !win32.isAbsolute(root)) root = "C:\\Windows";
  return win32.join(root, "System32", "taskkill.exe");
}

const taskkillArgs = (pid: number): string[] => ["/PID", String(pid), "/T", "/F"];

const defaultTaskkill: TaskkillLauncher = (file, args, { timeout, ...options }) =>
  new Promise((resolve) => {
    try {
      const proc = spawn(file, args, { ...options, stdio: "ignore" });
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // déjà terminé
        }
        resolve(false);
      }, timeout);
      proc.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      proc.once("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });

const defaultTaskkillSync: TaskkillSyncLauncher = (file, args, options) => {
  try {
    const r = spawnSync(file, args, { ...options, stdio: "ignore" });
    return r.error === undefined && r.status === 0;
  } catch {
    return false;
  }
};

const taskkillOptions = (env: NodeJS.ProcessEnv, timeout: number) => ({
  shell: false,
  env: safeEnv(env, "win32"),
  windowsHide: true,
  timeout,
});

/**
 * Options de `spawn` pour que l'enfant devienne chef de son propre groupe de
 * processus (POSIX), ce qui permet de terminer aussi ses descendants. Sous
 * Windows, `detached` ouvrirait une console séparée : on n'y touche pas.
 */
export function spawnOptionsForTree(): Pick<SpawnOptions, "detached"> {
  return isWindows() ? {} : { detached: true };
}

/** Groupes vivants (pid du chef), tués de façon synchrone à la sortie du processus. */
const liveGroups = new Set<number>();
let exitHookInstalled = false;

/** Arbres Windows vivants : enfant suivi et lanceur synchrone de `taskkill`. */
const liveWinTrees = new Map<
  number,
  { child: ChildProcess; env: NodeJS.ProcessEnv; launch: TaskkillSyncLauncher }
>();

/** Filet de sortie (exporté pour les tests) : tue les groupes POSIX et les arbres Windows restants. */
export function killAllGroups(): void {
  for (const pid of liveGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // groupe déjà terminé (ESRCH) ou signal refusé : rien à faire à la sortie.
    }
  }
  liveGroups.clear();
  for (const [pid, { child, env, launch }] of liveWinTrees) {
    // Enfant déjà sorti : le PID peut avoir été réutilisé, on ne lance rien.
    if (child.exitCode !== null || child.signalCode !== null) continue;
    launch(taskkillPath(env), taskkillArgs(pid), taskkillOptions(env, TASKKILL_EXIT_TIMEOUT_MS));
  }
  liveWinTrees.clear();
}

export interface TrackOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Lanceur synchrone de `taskkill` pour le filet de sortie (test). */
  taskkillSync?: TaskkillSyncLauncher;
}

/**
 * Inscrit le groupe de l'enfant au registre de secours : si le processus
 * parent sort (second Ctrl-C, `process.exit`), le groupe reçoit un SIGKILL.
 * À appeler juste après un `spawn` fait avec `spawnOptionsForTree()`. Le
 * groupe est retiré à la fermeture de l'enfant.
 */
export function trackProcessTree(child: ChildProcess, options: TrackOptions = {}): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", killAllGroups);
  }
  if (isWindows(options.platform)) {
    liveWinTrees.set(pid, {
      child,
      env: options.env ?? process.env,
      launch: options.taskkillSync ?? defaultTaskkillSync,
    });
    child.once("close", () => liveWinTrees.delete(pid));
    return;
  }
  liveGroups.add(pid);
  child.once("close", () => liveGroups.delete(pid));
}

/** Vrai si l'enfant est sorti et que ses tubes sont fermés. */
function isClosed(child: ChildProcess): boolean {
  if (child.exitCode === null && child.signalCode === null) return false;
  return [child.stdout, child.stderr].every((s) => !s || s.destroyed);
}

/**
 * Termine l'enfant et ses descendants : SIGTERM au groupe, puis SIGKILL après
 * `graceMs`. Résout à la fermeture de l'enfant, ou `killWaitMs` après le
 * SIGKILL en détruisant les tubes que des descendants orphelins garderaient
 * ouverts : ne reste jamais pendante. Sous Windows : `taskkill /T /F` (pas de
 * grâce, `graceMs` ignoré, `forced: true`), repli sur `child.kill()`.
 */
export function terminateProcessTree(
  child: ChildProcess,
  {
    graceMs = 5000,
    killWaitMs = 1000,
    platform = process.platform,
    taskkill = defaultTaskkill,
    env = process.env,
  }: TerminateOptions = {},
): Promise<{ forced: boolean }> {
  const pid = child.pid;
  if (pid === undefined || isClosed(child)) return Promise.resolve({ forced: false });

  if (isWindows(platform)) {
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      let finished = false;
      const done = () => {
        finished = true;
        if (timer) clearTimeout(timer);
        child.off("close", done);
        resolve({ forced: true });
      };
      child.once("close", done);
      const afterKill = () => {
        if (finished) return;
        timer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          done();
        }, killWaitMs);
      };
      taskkill(
        taskkillPath(env),
        taskkillArgs(pid),
        taskkillOptions(env, TASKKILL_TIMEOUT_MS),
      ).then(
        (ok) => {
          // Fermé pendant l'attente : jamais de kill sur un PID peut-être réutilisé.
          if (!ok && child.exitCode === null && child.signalCode === null) {
            try {
              child.kill();
            } catch {
              // enfant déjà mort
            }
          }
          afterKill();
        },
        () => {
          try {
            child.kill();
          } catch {
            // enfant déjà mort
          }
          afterKill();
        },
      );
    });
  }

  const signalTree = (signal: "SIGTERM" | "SIGKILL") => {
    try {
      process.kill(-pid, signal);
    } catch {
      // Pas de groupe (enfant lancé sans `detached`) ou signal refusé : on vise l'enfant seul.
      try {
        child.kill(signal);
      } catch {
        // enfant déjà mort
      }
    }
  };

  return new Promise((resolve) => {
    let forced = false;
    let timer: NodeJS.Timeout | undefined;
    const done = () => {
      if (timer) clearTimeout(timer);
      child.off("close", done);
      resolve({ forced });
    };
    child.once("close", done);
    signalTree("SIGTERM");
    timer = setTimeout(() => {
      forced = true;
      signalTree("SIGKILL");
      timer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        done();
      }, killWaitMs);
    }, graceMs);
  });
}
