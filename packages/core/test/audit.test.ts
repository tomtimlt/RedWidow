import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_RECORD_MAX_BYTES,
  AuditStore,
  auditTests,
  type CoverageView,
  coverageView,
} from "../src/audit.js";
import { createRecorder } from "../src/recorder.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(max?: number) {
  const root = await mkdtemp(join(tmpdir(), "venator-audit-"));
  roots.push(root);
  return { root, store: new AuditStore(root, max), project: randomUUID() };
}
const input = {
  actor: "operator",
  kind: "terminal.snapshot",
  source: "kali-1",
  data: { text: "id\nuid=1000", container: "kali-1" },
} as const;

describe("journal d’audit par projet", () => {
  it("la vue compacte retire les traces du transport sans effacer les journaux", async () => {
    const { store, project } = await fixture();
    const row = await store.append(project, input);
    expect((await store.view(project, { compact: true })).records).toEqual([]);
    expect((await store.view(project)).records.map((r) => r.id)).toEqual([row?.id]);
    await store.close();
  });
  it("démarre activé, refuse les chemins étrangers et sépare deux missions", async () => {
    const { store, project } = await fixture(),
      other = randomUUID();
    expect(await store.enabled(project)).toBe(true);
    expect(() => store.directory("../outside")).toThrow();
    const row = await store.append(project, input);
    expect((await store.view(project)).records.map((r) => r.id)).toEqual([row?.id]);
    expect((await store.view(other)).records).toEqual([]);
    await store.close();
  });
  it("masque avant écriture, exclut chat et authentification, conserve les liens réels", async () => {
    vi.stubEnv("AUDIT_TEST_SECRET", "literal-in-environment");
    const { store, project } = await fixture(),
      r = createRecorder({ redact: false });
    await store.recordEvent(
      project,
      r.emit({ kind: "run.started", prompt: "PRIVATE-PROMPT", cwd: "/workspace" }),
    );
    await store.recordEvent(
      project,
      r.emit({ kind: "agent.thinking", text: "PRIVATE-THINKING", redacted: false }),
    );
    await store.recordEvent(project, r.emit({ kind: "auth.info", apiKeySource: "PRIVATE-AUTH" }));
    const event = r.emit({
      kind: "tool.requested",
      toolUseId: "tool-1",
      tool: "read",
      input: { password: "secret-password", text: "literal-in-environment token=abcde12345" },
    });
    await store.recordEvent(project, event);
    const files = await store.files(project),
      raw = await readFile(files[0]?.path as string, "utf8");
    expect(raw).not.toMatch(/PRIVATE-|secret-password|literal-in-environment|abcde12345/);
    expect(raw).toContain("[REDACTED]");
    expect((await store.view(project)).records.at(-1)?.data).toMatchObject({
      id: event.id,
      parentId: null,
      seq: event.seq,
    });
    await store.close();
  });
  it("sérialise, persiste les pauses, reprend et ne purge pas au redémarrage", async () => {
    const { root, store, project } = await fixture();
    await Promise.all(
      Array.from({ length: 12 }, (_, n) => store.append(project, { ...input, data: { n } })),
    );
    await store.setEnabled(project, false);
    expect(await store.append(project, input)).toBeNull();
    expect((await store.view(project)).health.incomplete).toBe(true);
    await store.close();
    const next = new AuditStore(root);
    expect(await next.enabled(project)).toBe(false);
    await next.setEnabled(project, true);
    await next.append(project, input);
    const view = await next.view(project);
    expect(view.records).toHaveLength(15);
    expect(
      view.records
        .filter((r) => r.kind === "terminal.snapshot")
        .slice(0, 12)
        .map((r) => r.data.n),
    ).toEqual(Array.from({ length: 12 }, (_, n) => n));
    expect(view.health.incomplete).toBe(true);
    await next.close();
  });
  it("signale les troncatures et la saturation sans effacer les traces déjà écrites", async () => {
    const { root, store, project } = await fixture(80_000);
    const huge = { ...input, data: { text: "a".repeat(100_000), password: "private" } };
    const row = await store.append(project, huge);
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(AUDIT_RECORD_MAX_BYTES);
    expect(row?.data).toMatchObject({ truncated: true });
    for (let n = 0; n < 5; n++) await store.append(project, huge).catch(() => undefined);
    const view = await store.view(project);
    expect(view.health.incomplete).toBe(true);
    expect(view.health.failedEntries).toBeGreaterThan(0);
    expect(view.records.length).toBeGreaterThan(0);
    const bytes = view.bytes;
    await store.close();
    const reopened = new AuditStore(root, bytes);
    await expect(reopened.append(project, input)).rejects.toThrow("capacity");
    expect((await reopened.view(project)).bytes).toBe(bytes);
    await reopened.close();
  });
  it("rend visibles les trous, les lignes invalides et un collecteur interrompu", async () => {
    const { store, project } = await fixture();
    await store.append(project, input);
    const path = (await store.files(project))[0]?.path as string;
    await appendFile(path, '{"invalid":true}\n');
    await writeFile(
      join(store.directory(project), `status-${randomUUID()}.json`),
      JSON.stringify({ closed: false, processId: -1 }),
    );
    await store.markGap(project, "terminal", "capture indisponible");
    const view = await store.view(project);
    expect(view.health.incomplete).toBe(true);
    expect(view.health.failedEntries).toBe(1);
    expect(view.records.some((r) => r.kind === "capture.gap")).toBe(true);
    await store.close();
  });
  it("ne suit pas un lien symbolique placé à la place d’un journal", async () => {
    const { root, store, project } = await fixture();
    await mkdir(store.directory(project), { recursive: true });
    const outside = join(root, "outside");
    await writeFile(outside, "PRIVATE-OUTSIDE");
    await symlink(outside, join(store.directory(project), `events-${randomUUID()}-000000.jsonl`));
    await expect(store.files(project)).rejects.toThrow("regular file");
  });
  it("l’aperçu borné conserve toutes les traces sources et n’affirme pas être exhaustif", async () => {
    const { store, project } = await fixture();
    await Promise.all(
      Array.from({ length: 510 }, (_, n) => store.append(project, { ...input, data: { n } })),
    );
    const view = await store.view(project);
    expect(view.records).toHaveLength(500);
    expect(view.viewLimited).toBe(true);
    const files = await store.files(project);
    expect((await readFile(files[0]?.path as string, "utf8")).trim().split("\n")).toHaveLength(510);
    await store.close();
    // 510 écritures sérialisées sur disque : lentes sur les runners Windows.
  }, 30_000);
  it("une fermeture propre est persistée et ne déclenche pas de fausse alerte", async () => {
    const { root, store, project } = await fixture();
    await store.append(project, input);
    await store.close();
    const status = (await readdir(store.directory(project))).find((n) =>
      n.startsWith("status-"),
    ) as string;
    expect(JSON.parse(await readFile(join(store.directory(project), status), "utf8")).closed).toBe(
      true,
    );
    const reopened = new AuditStore(root);
    expect((await reopened.view(project)).health.incomplete).toBe(false);
    await expect(store.append(project, input)).rejects.toThrow("closed");
  });
});

describe("registre des contrôles", () => {
  it("distingue retour sans erreur, conclusion de l’agent et qualification humaine", async () => {
    const { store, project } = await fixture(),
      r = createRecorder({ redact: false });
    await store.recordEvent(
      project,
      r.emit({
        kind: "tool.requested",
        toolUseId: "t",
        tool: "http",
        input: { url: "http://lab.test" },
      }),
    );
    const result = r.emit({
      kind: "tool.result",
      toolUseId: "t",
      output: "HTTP 403",
      bytes: 8,
      isError: false,
      truncated: false,
    });
    await store.recordEvent(project, result);
    let view = await store.view(project);
    expect(view.tests[0]).toMatchObject({
      execution: "returned",
      conclusion: "unreviewed",
      reviewed: false,
      target: "http://lab.test",
    });
    const claim = {
      objective: "Vérifier l’accès anonyme",
      target: "http://lab.test",
      testContext: "Sans authentification",
      method: "HTTP GET",
      observed: "Un seul chemin testé : 403",
      conclusion: "not-observed" as const,
      evidenceIds: [result.id],
    };
    const annotation = await store.recordEvent(project, r.emit({ kind: "audit.test", claim }));
    await store.recordEvent(
      project,
      r.emit({ kind: "audit.test", claim: { ...claim, evidenceIds: ["invented"] } }),
    );
    view = await store.view(project);
    expect(view.tests).toHaveLength(2);
    expect(view.tests[1]).toMatchObject({
      reviewed: false,
      author: "agent",
      conclusion: "not-observed",
    });
    await store.append(project, {
      actor: "agent",
      kind: "test.review",
      data: { testId: annotation?.id, claim },
    });
    expect((await store.view(project)).tests.at(-1)?.reviewed).toBe(false);
    await store.append(project, {
      actor: "operator",
      kind: "test.review",
      data: { testId: annotation?.id, claim },
    });
    expect((await store.view(project)).tests.at(-1)).toMatchObject({
      reviewed: true,
      author: "operator",
      testContext: "Sans authentification",
    });
    await store.close();
  });
  it("un refus n’est jamais un test achevé ou une absence de vulnérabilité", async () => {
    const { store, project } = await fixture(),
      r = createRecorder();
    await store.recordEvent(
      project,
      r.emit({
        kind: "approval.decided",
        toolUseId: "x",
        decision: "deny",
        source: "user",
        reason: { code: "approval.denied" },
      }),
    );
    expect(auditTests((await store.view(project)).records)[0]).toMatchObject({
      execution: "denied",
      conclusion: "unreviewed",
      reviewed: false,
    });
    await store.close();
  });

  it("agrège la matrice de couverture : dernier état par case, comptes et pourcentage", async () => {
    const { store, project } = await fixture();
    const r = createRecorder({ runId: "run", redact: false });
    expect((await store.view(project)).coverage).toMatchObject({ total: 0, coveredPercent: 0 });
    const a = { surface: "/api/users", parameter: "id", testClass: "IDOR" };
    const b = { surface: "/login", testClass: "SQLi" };
    const c = { surface: "/upload", parameter: "file", testClass: "XXE" };
    await store.recordEvent(
      project,
      r.emit({
        kind: "audit.coverage",
        cells: [
          { ...a, state: "untested" },
          { ...b, state: "untested" },
          { ...c, state: "untested" },
        ],
      }),
    );
    await store.recordEvent(
      project,
      r.emit({
        kind: "audit.coverage",
        cells: [{ surface: " /API/users", parameter: "ID", testClass: "idor", state: "blocked" }],
      }),
    );
    const coverage = (await store.view(project)).coverage as CoverageView;
    expect(coverage.total).toBe(3);
    expect(coverage.counts).toEqual({
      untested: 2,
      negative: 0,
      blocked: 1,
      prerequisite: 0,
      confirmed: 0,
    });
    expect(coverage.coveredPercent).toBe(33);
    expect(coverage.cells.find((x) => x.testClass === "idor")).toMatchObject({
      state: "blocked",
      runId: "run",
    });
    // Données illisibles ignorées, sans lever.
    expect(
      coverageView([
        {
          v: 1,
          id: randomUUID(),
          projectId: project,
          ts: new Date().toISOString(),
          actor: "agent",
          kind: "engine",
          data: { kind: "audit.coverage", cells: "nope" },
        },
      ]).total,
    ).toBe(0);
  });
});
