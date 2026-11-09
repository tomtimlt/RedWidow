import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  type AuditHealth,
  type AuditRecord,
  type AuditTest,
  type AuditView,
  auditProjectIdSchema,
  auditRecordSchema,
  auditTestSchema,
  COVERAGE_STATES,
  type CoverageCellView,
  type CoverageState,
  type CoverageView,
  coverageCellsSchema,
  coverageKey,
} from "./audit-schema.js";
import { type CampaignLogView, campaignLogFromRecords } from "./engagement/campaign-log.js";
import { campaignOverview } from "./engagement/campaign-progress.js";
import { readTeardownSync } from "./engagement/teardown.js";
import type { EngineEvent } from "./events.js";
import { createRedactor, secretsFromEnv } from "./redact.js";

export * from "./audit-schema.js";
export const AUDIT_RECORD_MAX_BYTES = 64 * 1024;
export const AUDIT_STREAM_MAX_BYTES = 1024 * 1024 * 1024;
export const AUDIT_CHUNK_BYTES = 8 * 1024 * 1024;
const FILE = /^events-[0-9a-f-]{36}-[0-9]{6}\.jsonl$/;
const HEALTH = /^status-[0-9a-f-]{36}\.json$/;
const retained = new Set([
  "mission.noContainer",
  "mission.decision",
  "research.status",
  "run.started",
  "run.finished",
  "turn.started",
  "turn.finished",
  "continuation.auto",
  "pace.adjusted",
  "pace.halted",
  "session.started",
  "tool.requested",
  "tool.result",
  "approval.requested",
  "approval.decided",
  "permission.denied",
  "bypass.changed",
  "process.started",
  "process.output",
  "process.exited",
  "error",
  "sink.error",
  "journal.truncated",
  "audit.test",
  "audit.coverage",
  "campaign.step",
  "teardown.state",
]);

/** Journal de mission indépendant de la rétention du chat. Aucun effacement automatique. */
export class AuditStore {
  readonly instance = randomUUID();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly sizes = new Map<
    string,
    { chunk: number; bytes: number; total: number; count: number }
  >();
  private readonly health = new Map<string, AuditHealth>();
  private readonly pending = new Map<string, number>();
  private readonly redact = createRedactor({ values: secretsFromEnv() });
  private closed = false;
  constructor(
    readonly configDir: string,
    private readonly maxBytes = AUDIT_STREAM_MAX_BYTES,
  ) {}

  directory(projectId: string): string {
    auditProjectIdSchema.parse(projectId);
    return join(this.configDir, "projects", projectId, "audit");
  }
  async enabled(projectId: string): Promise<boolean> {
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(this.directory(projectId), "config.json"), "utf8"),
      );
      return z.object({ enabled: z.boolean() }).strict().parse(raw).enabled;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }
  private async json(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private status(projectId: string, closed = false): Promise<void> {
    return this.json(join(this.directory(projectId), `status-${this.instance}.json`), {
      ...this.health.get(projectId),
      closed,
      processId: process.pid,
    });
  }
  private async failure(projectId: string, error: unknown): Promise<void> {
    const old = this.health.get(projectId);
    const next: AuditHealth = {
      incomplete: true,
      failedEntries: (old?.failedEntries ?? 0) + 1,
      firstErrorAt: old?.firstErrorAt ?? new Date().toISOString(),
      error: this.redact(error instanceof Error ? error.message : "audit write failed").slice(
        0,
        1000,
      ),
    };
    this.health.set(projectId, next);
    try {
      await this.status(projectId, this.closed);
    } catch {
      /* L’état en mémoire reste visible si le disque est indisponible. */
    }
  }
  async markGap(projectId: string, source: string, reason: string): Promise<void> {
    const old = this.health.get(projectId);
    this.health.set(projectId, {
      ...old,
      incomplete: true,
      failedEntries: old?.failedEntries ?? 0,
    });
    await this.append(
      projectId,
      { actor: "system", kind: "capture.gap", source, data: { reason } },
      true,
    );
  }
  async setEnabled(projectId: string, enabled: boolean): Promise<void> {
    const directory = this.directory(projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.flush(projectId);
    if (!enabled) {
      const old = this.health.get(projectId);
      this.health.set(projectId, {
        ...old,
        incomplete: true,
        failedEntries: old?.failedEntries ?? 0,
      });
      await this.json(join(directory, "config.json"), { enabled });
    }
    await this.append(
      projectId,
      { actor: "operator", kind: enabled ? "recording.resumed" : "recording.paused", data: {} },
      true,
    );
    if (enabled) await this.json(join(directory, "config.json"), { enabled });
  }
  async append(
    projectId: string,
    input: Omit<AuditRecord, "id" | "v" | "projectId" | "ts">,
    force = false,
  ): Promise<AuditRecord | null> {
    this.directory(projectId);
    if (this.closed) throw Error("Audit collector is closed");
    const pending = (this.pending.get(projectId) ?? 0) + 1;
    if (pending > 5000) {
      await this.failure(projectId, Error("Audit queue capacity exceeded"));
      throw Error("Audit queue capacity exceeded");
    }
    this.pending.set(projectId, pending);
    const task = (this.queues.get(projectId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (!force && !(await this.enabled(projectId))) return null;
        const directory = this.directory(projectId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const sanitized = this.redact(input);
        let data = sanitized.data;
        const full = JSON.stringify(data);
        if (Buffer.byteLength(full) > 48000)
          data = {
            kind: data.kind,
            id: data.id,
            toolUseId: data.toolUseId,
            tool: data.tool,
            truncated: true,
            originalBytes: Buffer.byteLength(full),
            excerpt: full.slice(0, 16000),
          };
        const record = auditRecordSchema.parse({
          ...sanitized,
          v: 1,
          id: randomUUID(),
          projectId,
          ts: new Date().toISOString(),
          data,
        });
        if (
          data.truncated === true ||
          data.kind === "journal.truncated" ||
          (typeof data.droppedLines === "number" && data.droppedLines > 0)
        ) {
          const old = this.health.get(projectId);
          this.health.set(projectId, {
            ...old,
            incomplete: true,
            failedEntries: old?.failedEntries ?? 0,
          });
        }
        const line = `${JSON.stringify(record)}\n`,
          bytes = Buffer.byteLength(line);
        if (bytes > AUDIT_RECORD_MAX_BYTES) throw Error("Audit record capacity exceeded");
        let size = this.sizes.get(projectId);
        if (!size) {
          size = {
            chunk: 0,
            bytes: 0,
            total: (await this.files(projectId)).reduce((n, f) => n + f.size, 0),
            count: 0,
          };
          await this.status(projectId);
          this.sizes.set(projectId, size);
        }
        if (size.total + bytes > this.maxBytes)
          throw Error(
            "Audit recording capacity reached; export or change mission before continuing capture",
          );
        if (size.bytes + bytes > AUDIT_CHUNK_BYTES) {
          size.chunk++;
          size.bytes = 0;
        }
        const path = join(
          directory,
          `events-${this.instance}-${String(size.chunk).padStart(6, "0")}.jsonl`,
        );
        const handle = await open(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        try {
          await handle.writeFile(line, "utf8");
          await handle.datasync();
        } finally {
          await handle.close();
        }
        size.bytes += bytes;
        size.total += bytes;
        size.count++;
        this.sizes.set(projectId, size);
        const health = this.health.get(projectId);
        if (
          health &&
          (size.count % 100 === 0 ||
            data.truncated === true ||
            record.kind === "capture.gap" ||
            record.kind === "recording.paused" ||
            data.kind === "journal.truncated" ||
            (typeof data.droppedLines === "number" && data.droppedLines > 0))
        )
          await this.status(projectId);
        return record;
      })
      .catch(async (error) => {
        await this.failure(projectId, error);
        throw error;
      })
      .finally(() => this.pending.set(projectId, (this.pending.get(projectId) ?? 1) - 1));
    this.queues.set(projectId, task);
    return task;
  }
  recordEvent(projectId: string, event: EngineEvent): Promise<AuditRecord | null> {
    if (!retained.has(event.kind)) return Promise.resolve(null);
    // Le raisonnement, le chat et les données d’authentification ne font pas partie de cet export.
    const data: Record<string, unknown> =
      event.kind === "run.started"
        ? { kind: event.kind, id: event.id, ts: event.ts, cwd: event.cwd }
        : event.kind === "run.finished"
          ? {
              kind: event.kind,
              id: event.id,
              ts: event.ts,
              status: event.status,
              turns: event.turns,
              costUsd: event.costUsd,
            }
          : event.kind === "session.started"
            ? {
                kind: event.kind,
                id: event.id,
                ts: event.ts,
                model: event.model,
                tools: event.tools,
              }
            : { ...event };
    const actor =
      event.kind === "approval.decided"
        ? event.source === "user"
          ? "operator"
          : "system"
        : event.kind === "bypass.changed" || event.kind === "mission.noContainer"
          ? "system"
          : "agent";
    return this.append(projectId, { actor, kind: "engine", runId: event.runId, data });
  }
  async flush(projectId?: string): Promise<void> {
    if (projectId) await this.queues.get(projectId);
    else await Promise.allSettled([...this.queues.values()]);
  }
  localHealth(projectId: string): AuditHealth {
    return this.health.get(projectId) ?? { incomplete: false, failedEntries: 0 };
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
    await Promise.all(
      [...new Set([...this.sizes.keys(), ...this.health.keys()])].map((id) =>
        this.status(id, true),
      ),
    );
  }
  async files(
    projectId: string,
  ): Promise<{ name: string; path: string; size: number; modifiedAt: number }[]> {
    const dir = this.directory(projectId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const rows = [];
    for (const name of names.filter((n) => FILE.test(n)).sort()) {
      const path = join(dir, name),
        info = await lstat(path);
      if (!info.isFile()) throw Error("Audit journal is not a regular file");
      rows.push({ name, path, size: info.size, modifiedAt: info.mtimeMs });
    }
    return rows;
  }
  async view(projectId: string, options: { compact?: boolean } = {}): Promise<AuditView> {
    await this.flush(projectId).catch(() => undefined);
    const files = await this.files(projectId),
      records: AuditRecord[] = [];
    let limited = false,
      readBytes = 0;
    const issues: AuditHealth[] = [];
    for (const file of [...files].sort(
      (a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name),
    )) {
      if (readBytes >= (options.compact ? 4 : 32) * 1024 * 1024) {
        limited = true;
        break;
      }
      const length = Math.min(
          file.size,
          AUDIT_CHUNK_BYTES,
          (options.compact ? 4 : 32) * 1024 * 1024 - readBytes,
        ),
        handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let text: string;
      try {
        const buffer = Buffer.alloc(length);
        const r = await handle.read(buffer, 0, length, Math.max(0, file.size - length));
        text = buffer.subarray(0, r.bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
      readBytes += length;
      if (length < file.size) {
        text = text.slice(text.indexOf("\n") + 1);
        limited = true;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          if (Buffer.byteLength(line) > AUDIT_RECORD_MAX_BYTES) throw Error();
          const row = auditRecordSchema.parse(JSON.parse(line));
          if (row.projectId !== projectId) throw Error();
          records.push(this.redact(row));
        } catch {
          issues.push({ incomplete: true, failedEntries: 1, error: "Invalid audit record" });
        }
      }
    }
    let names: string[] = [];
    try {
      names = await readdir(this.directory(projectId));
    } catch {}
    for (const name of names.filter((n) => HEALTH.test(n))) {
      if (name === `status-${this.instance}.json`) continue;
      try {
        const path = join(this.directory(projectId), name),
          info = await lstat(path);
        if (!info.isFile() || info.size > 8192) throw Error();
        const raw = JSON.parse(await readFile(path, "utf8"));
        if (raw.incomplete === true)
          issues.push({
            incomplete: true,
            failedEntries:
              Number.isSafeInteger(raw.failedEntries) && raw.failedEntries >= 0
                ? raw.failedEntries
                : 0,
            ...(typeof raw.error === "string" && { error: this.redact(raw.error).slice(0, 1000) }),
          });
        if (raw.closed !== true && !collectorAlive(raw.processId))
          issues.push({
            incomplete: true,
            failedEntries: 0,
            error: "Previous audit collector did not close cleanly",
          });
      } catch {
        issues.push({ incomplete: true, failedEntries: 0, error: "Invalid audit status" });
      }
    }
    const live = this.health.get(projectId);
    if (live) issues.push(live);
    // Le tri stable préserve l’ordre d’écriture d’un collecteur dans la même milliseconde.
    const sorted = records.sort((a, b) => a.ts.localeCompare(b.ts));
    const health: AuditHealth = {
      incomplete:
        issues.some((i) => i.incomplete) ||
        records.some(
          (r) =>
            r.kind === "capture.gap" || r.kind === "recording.paused" || r.data.truncated === true,
        ),
      failedEntries: issues.reduce((n, i) => n + i.failedEntries, 0),
      ...(issues.find((i) => i.error)?.error && {
        error: issues.find((i) => i.error)?.error as string,
      }),
    };
    return {
      enabled: await this.enabled(projectId),
      records: options.compact ? [] : sorted.slice(-500),
      tests: auditTests(sorted).slice(-1000),
      coverage: coverageView(sorted),
      ...campaignSection(this.configDir, projectId, sorted),
      bytes: files.reduce((n, f) => n + f.size, 0),
      health,
      viewLimited: limited || sorted.length > 500,
    };
  }
}

function collectorAlive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || (pid as number) < 1) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Les codes de retour qualifient l’exécution, jamais la validité d’un contrôle. */
export function auditTests(records: readonly AuditRecord[]): AuditTest[] {
  const tests = new Map<string, AuditTest>();
  const known = new Set(
    records.flatMap((r) => [r.id, typeof r.data.id === "string" ? r.data.id : ""]),
  );
  for (const record of records) {
    const e = record.data;
    if (
      record.kind === "engine" &&
      typeof e.toolUseId === "string" &&
      ["tool.requested", "tool.result", "approval.decided"].includes(String(e.kind))
    ) {
      const id = `${record.runId}:${e.toolUseId}`;
      const old = tests.get(id);
      const input =
        e.input && typeof e.input === "object" ? (e.input as Record<string, unknown>) : {};
      const tool = typeof e.tool === "string" ? e.tool : (old?.method ?? "tool");
      if (
        /(?:^|__)(?:load_skill|mission_context|record_decision|record_test|record_coverage|record_step|record_teardown)$/.test(
          tool,
        )
      )
        continue;
      tests.set(id, {
        id,
        objective: old?.objective ?? tool,
        target:
          old?.target || String(input.url ?? input.container ?? input.host ?? "").slice(0, 500),
        testContext: old?.testContext ?? "",
        method: tool,
        observed: typeof e.output === "string" ? e.output.slice(0, 8000) : (old?.observed ?? ""),
        execution:
          e.kind === "tool.result"
            ? e.isError === true
              ? "error"
              : "returned"
            : e.decision === "deny"
              ? "denied"
              : (old?.execution ?? "requested"),
        conclusion: "unreviewed",
        author: old?.author ?? "automatic",
        reviewed: false,
        evidenceIds: [...new Set([...(old?.evidenceIds ?? []), record.id])].slice(-32),
        ts: record.ts,
        startedAt: old?.startedAt ?? record.ts,
      });
    } else if (record.kind === "terminal.snapshot") {
      tests.set(record.id, {
        id: record.id,
        objective: `Terminal · ${String(e.container ?? record.source ?? "")}`,
        target: String(e.container ?? ""),
        testContext: "",
        method: "terminal.snapshot",
        observed: String(e.text ?? "").slice(0, 8000),
        execution: "captured",
        conclusion: "unreviewed",
        author: "automatic",
        reviewed: false,
        evidenceIds: [record.id],
        ts: record.ts,
        startedAt: record.ts,
      });
    } else if (record.kind === "engine" && e.kind === "audit.test") {
      const parsed = auditTestSchema.safeParse(e.claim);
      if (parsed.success) {
        const c = parsed.data;
        if (!c.evidenceIds.every((id) => known.has(id))) continue;
        tests.set(record.id, {
          id: record.id,
          ...c,
          execution: "annotated",
          author: "agent",
          reviewed: false,
          ts: record.ts,
          startedAt: record.ts,
        });
      }
    } else if (
      record.kind === "test.review" &&
      record.actor === "operator" &&
      typeof e.testId === "string"
    ) {
      const old = tests.get(e.testId),
        parsed = auditTestSchema.safeParse(e.claim);
      if (old && parsed.success && parsed.data.evidenceIds.every((id) => known.has(id)))
        tests.set(old.id, {
          ...old,
          ...parsed.data,
          author: "operator",
          reviewed: true,
          ts: record.ts,
        });
    }
  }
  return [...tests.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Dernier état de chaque case (clé normalisée) sur les événements `audit.coverage` du projet. */
export function coverageView(records: readonly AuditRecord[]): CoverageView {
  const latest = new Map<string, CoverageCellView>();
  for (const record of records) {
    if (record.kind !== "engine" || record.data.kind !== "audit.coverage") continue;
    const parsed = coverageCellsSchema.safeParse(record.data.cells);
    if (!parsed.success) continue;
    for (const cell of parsed.data) {
      const key = coverageKey(cell);
      // Retire l'ancienne entrée pour que l'ordre reste celui de la dernière écriture.
      latest.delete(key);
      latest.set(key, {
        ...cell,
        key,
        ts: record.ts,
        ...(record.runId !== undefined && { runId: record.runId }),
      });
    }
  }
  const cells = [...latest.values()];
  const counts = Object.fromEntries(COVERAGE_STATES.map((state) => [state, 0])) as Record<
    CoverageState,
    number
  >;
  for (const cell of cells) counts[cell.state]++;
  const total = cells.length;
  return {
    cells,
    total,
    counts,
    coveredPercent: total === 0 ? 0 : Math.round(((total - counts.untested) / total) * 100),
  };
}

export function auditTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Journal de campagne (ADR 0041) : agrège les événements `campaign.step` et `teardown.state` du
 * projet en entrées d'« operator log » (horodatage UTC, étape, technique ATT&CK, cible, résultat,
 * références de preuve), avec l'avancement du plan approuvé. Lecture seule.
 */
export async function campaignLog(configDir: string, projectId: string): Promise<CampaignLogView> {
  const view = await new AuditStore(configDir).view(projectId);
  return view.campaign ?? { entries: [], teardown: [] };
}

/** Section `campaign` d'`AuditView` : absente tant que le projet n'a ni événement de campagne ni plan approuvé. */
function campaignSection(
  configDir: string,
  projectId: string,
  records: readonly AuditRecord[],
): { campaign?: CampaignLogView } {
  const log = campaignLogFromRecords(records);
  try {
    const overview = campaignOverview(configDir, projectId);
    if (overview.plan !== null && overview.digest !== undefined)
      log.progress = {
        total: overview.steps.length,
        executed: overview.executedCount,
        percent: overview.executedPercent,
        planDigest: overview.digest,
      };
    const teardown = readTeardownSync(configDir, projectId);
    if (teardown.items.length > 0) log.teardownRemaining = teardown.remaining;
  } catch {
    // Plan illisible : le journal reste celui des événements.
  }
  const present =
    log.entries.length > 0 ||
    log.teardown.length > 0 ||
    log.progress !== undefined ||
    log.teardownRemaining !== undefined;
  return present ? { campaign: log } : {};
}
