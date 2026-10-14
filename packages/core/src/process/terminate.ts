import type { ChildProcess, SpawnOptions } from "node:child_process";

export interface TerminateOptions {
  /** Délai entre SIGTERM et SIGKILL (défaut : 5000 ms). */
  graceMs?: number;
  /** Attente maximale après SIGKILL avant d'abandonner les tubes (défaut : 1000 ms). */
  killWaitMs?: number;
}

const isWindows = () => process.platform === "win32";

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

function killAllGroups(): void {
  for (const pid of liveGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // groupe déjà terminé (ESRCH) ou signal refusé : rien à faire à la sortie.
    }
  }
  liveGroups.clear();
}

/**
 * Inscrit le groupe de l'enfant au registre de secours : si le processus
 * parent sort (second Ctrl-C, `process.exit`), le groupe reçoit un SIGKILL.
 * À appeler juste après un `spawn` fait avec `spawnOptionsForTree()`. Le
 * groupe est retiré à la fermeture de l'enfant.
 */
export function trackProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || isWindows()) return;
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", killAllGroups);
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
 * ouverts : ne reste jamais pendante. Sous Windows : `child.kill()` seul
 * (best effort, descendants non arrêtés).
 */
export function terminateProcessTree(
  child: ChildProcess,
  { graceMs = 5000, killWaitMs = 1000 }: TerminateOptions = {},
): Promise<{ forced: boolean }> {
  const pid = child.pid;
  if (pid === undefined || isClosed(child)) return Promise.resolve({ forced: false });

  const signalTree = (signal: "SIGTERM" | "SIGKILL") => {
    try {
      if (isWindows()) child.kill();
      else process.kill(-pid, signal);
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
