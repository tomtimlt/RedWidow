import { randomUUID } from "node:crypto";
import {
  type AuditStore,
  auditTextHash,
  createRedactor,
  type EngineEvent,
  secretsFromEnv,
} from "@warband/core";
import { readableTerminal, TERMINAL_TAIL_RAW } from "./termlog.js";

export interface AuditShell {
  auditId: string;
  projectId: string | null;
  container: string;
  label: string;
}
/** Les clés privées, y compris les blocs partiels, sont retirées avant le bornage. */
export function auditTerminalText(raw: string): string {
  const keySafe = raw
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g,
      "[PRIVATE KEY REDACTED]",
    )
    .replace(/^[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/, "[PARTIAL PRIVATE KEY REDACTED]");
  const clean = readableTerminal(keySafe, TERMINAL_TAIL_RAW);
  return createRedactor({ values: secretsFromEnv() })(clean).slice(-16_384);
}
/** Attribution épinglée par run et terminal : aucune trace n’est réattribuée au projet suivant. */
export class AuditCapture {
  private readonly runs = new Map<string, string>();
  private readonly hashes = new Map<string, string>();
  private readonly previous = new Map<string, string>();
  private readonly paused = new Set<string>();
  private readonly epochs = new Map<string, number>();
  private readonly unavailable = new Set<string>();
  private readonly shells = new Map<string, Promise<boolean>>();
  constructor(
    readonly store: AuditStore,
    private readonly changed: () => void,
    private readonly failed: (error: unknown) => void,
  ) {}
  event(projectId: string | null, event: EngineEvent | null): void {
    if (!event) return;
    if (event.kind === "run.started" && projectId) {
      this.runs.set(event.runId, projectId);
      if (this.runs.size > 2048) this.runs.delete(this.runs.keys().next().value as string);
    }
    const pinned = this.runs.get(event.runId);
    if (pinned)
      void this.store
        .recordEvent(pinned, event)
        .then((row) => {
          if (row) this.changed();
        })
        .catch(this.failed);
  }
  async shell(
    shell: AuditShell,
    read: () => Promise<string | null>,
    final = false,
  ): Promise<boolean> {
    const task = (this.shells.get(shell.auditId) ?? Promise.resolve(true)).then(() =>
      this.captureShell(shell, read, final),
    );
    this.shells.set(shell.auditId, task);
    void task
      .finally(() => {
        if (this.shells.get(shell.auditId) === task) this.shells.delete(shell.auditId);
      })
      .catch(() => undefined);
    return task;
  }
  pauseCapture(id: string): void {
    this.paused.add(id);
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
  }
  async flush(): Promise<void> {
    await Promise.allSettled([...this.shells.values()]);
    await this.store.flush();
  }
  private async captureShell(
    shell: AuditShell,
    read: () => Promise<string | null>,
    final = false,
  ): Promise<boolean> {
    if (!shell.projectId) return true;
    const projectId = shell.projectId,
      source = `${shell.label} · ${shell.auditId}`;
    try {
      const epoch = this.epochs.get(shell.auditId) ?? 0;
      if (!(await this.store.enabled(projectId))) {
        this.paused.add(shell.auditId);
        if (final) {
          this.previous.delete(shell.auditId);
          this.hashes.delete(shell.auditId);
          this.paused.delete(shell.auditId);
        }
        return true;
      }
      const raw = await read();
      if (epoch !== (this.epochs.get(shell.auditId) ?? 0)) return true;
      if (raw === null) {
        if (!this.unavailable.has(shell.auditId)) {
          await this.store.markGap(projectId, source, "Terminal capture unavailable");
          this.changed();
        }
        this.unavailable.add(shell.auditId);
        return false;
      }
      if (this.unavailable.delete(shell.auditId))
        await this.store.append(
          projectId,
          {
            actor: "system",
            kind: "capture.gap",
            source,
            data: { reason: "Terminal capture resumed; missing interval is not reconstructed" },
          },
          true,
        );
      const text = auditTerminalText(raw),
        sha256 = auditTextHash(text);
      if (this.paused.delete(shell.auditId)) {
        // À la reprise, le tampon courant sert seulement de point de départ ; la pause reste un trou explicite.
        this.previous.set(shell.auditId, text);
        this.hashes.set(shell.auditId, sha256);
      }
      if (this.hashes.get(shell.auditId) !== sha256) {
        const previous = this.previous.get(shell.auditId),
          overlap = previous === undefined ? 0 : terminalOverlap(previous, text);
        const delta = text.slice(overlap);
        const saved = await this.store.append(projectId, {
          actor: "operator",
          kind: "terminal.snapshot",
          source,
          data: {
            captureId: shell.auditId,
            container: shell.container,
            text: delta,
            sha256: auditTextHash(delta),
            periodic: true,
            bounded: true,
            tailBytes: TERMINAL_TAIL_RAW,
            truncated:
              previous === undefined
                ? raw.length > 16_384 || Buffer.byteLength(raw) >= TERMINAL_TAIL_RAW
                : overlap === 0 && raw.length >= 16_384,
          },
        });
        if (saved) {
          this.hashes.set(shell.auditId, sha256);
          this.previous.set(shell.auditId, text);
          this.changed();
        }
      }
      if (final) {
        await this.store.append(projectId, {
          actor: "system",
          kind: "terminal.closed",
          source,
          data: { captureId: shell.auditId },
        });
        this.hashes.delete(shell.auditId);
        this.previous.delete(shell.auditId);
        this.changed();
      }
      return true;
    } catch (error) {
      this.failed(error);
      return false;
    }
  }
}

/** Chevauchement suffixe/préfixe en temps linéaire sur deux tampons déjà masqués. */
export function terminalOverlap(previous: string, next: string): number {
  const combined = `${next}\u0000${previous}`,
    prefix = new Uint32Array(combined.length);
  for (let i = 1; i < combined.length; i++) {
    let j = prefix[i - 1] ?? 0;
    while (j > 0 && combined[i] !== combined[j]) j = prefix[j - 1] ?? 0;
    if (combined[i] === combined[j]) j++;
    prefix[i] = j;
  }
  return Math.min(next.length, prefix[combined.length - 1] ?? 0);
}

export const newAuditCaptureId = (): string => randomUUID();
