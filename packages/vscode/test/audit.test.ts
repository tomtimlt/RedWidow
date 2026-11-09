import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditStore, createRecorder, createTestAccounts } from "@warband/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditCapture, auditTerminalText, terminalOverlap } from "../src/logic/audit-capture.js";
import { auditHtml, exportAuditBundle } from "../src/logic/audit-export.js";
import { reviewAuditTest } from "../src/logic/audit-review.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "venator-audit-ui-"));
  roots.push(root);
  const config = join(root, "config");
  const store = new AuditStore(config);
  const project = randomUUID(),
    failed = vi.fn(),
    changed = vi.fn();
  return {
    root,
    store,
    project,
    failed,
    changed,
    capture: new AuditCapture(store, changed, failed),
  };
}
const shell = (projectId: string | null) => ({
  auditId: randomUUID(),
  projectId,
  container: "kali-1",
  label: "kali-1",
});
const claim = {
  objective: "Contrôle d’accès",
  target: "lab.test",
  testContext: "Anonyme",
  method: "GET /",
  observed: "HTTP 403 sur ce seul chemin",
  conclusion: "not-observed" as const,
};

describe("capture automatique indépendante du modèle", () => {
  it("épingler les événements au projet de début évite une fuite au changement de mission", async () => {
    const { store, project, capture } = await fixture(),
      other = randomUUID(),
      r = createRecorder();
    capture.event(project, r.emit({ kind: "run.started", prompt: "tester", cwd: "/workspace" }));
    capture.event(
      other,
      r.emit({
        kind: "tool.requested",
        toolUseId: "x",
        tool: "read",
        input: { path: "result.txt" },
      }),
    );
    await capture.flush();
    expect((await store.view(project)).records).toHaveLength(2);
    expect((await store.view(other)).records).toHaveLength(0);
    await store.close();
  });
  it("capture aussi sans IA, déduplique et conserve le dernier delta avant fermeture", async () => {
    const { store, project, capture } = await fixture(),
      s = shell(project);
    await capture.shell(s, async () => "$ id\nuid=1000\n");
    await capture.shell(s, async () => "$ id\nuid=1000\n");
    await capture.shell(s, async () => "$ id\nuid=1000\n$ whoami\ndev\n", true);
    const rows = (await store.view(project)).records;
    expect(rows.filter((r) => r.kind === "terminal.snapshot").map((r) => r.data.text)).toEqual([
      "$ id\nuid=1000",
      "\n$ whoami\ndev",
    ]);
    expect(rows.at(-1)?.kind).toBe("terminal.closed");
    await store.close();
  });
  it("respecte la pause sans lire le terminal et ne recopie pas son intervalle à la reprise", async () => {
    const { store, project, capture } = await fixture(),
      s = shell(project),
      read = vi.fn(async () => "old\nPAUSED-CONTENT");
    await capture.shell(s, async () => "old");
    capture.pauseCapture(s.auditId);
    await store.setEnabled(project, false);
    await capture.shell(s, read);
    expect(read).not.toHaveBeenCalled();
    await store.setEnabled(project, true);
    await capture.shell(s, read);
    await capture.shell(s, async () => "old\nPAUSED-CONTENT\nnew");
    const rows = (await store.view(project)).records;
    expect(JSON.stringify(rows)).not.toContain("PAUSED-CONTENT");
    expect(rows.filter((r) => r.kind === "terminal.snapshot").map((r) => r.data.text)).toEqual([
      "old",
      "\nnew",
    ]);
    expect((await store.view(project)).health.incomplete).toBe(true);
    await store.close();
  });
  it("une pause pendant une lecture en vol invalide ce tampon avant toute reprise", async () => {
    const { store, project, capture } = await fixture(),
      s = shell(project);
    await capture.shell(s, async () => "before");
    let release: (text: string) => void = () => {};
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = capture.shell(s, () => {
      started();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    await running;
    capture.pauseCapture(s.auditId);
    await store.setEnabled(project, false);
    await store.setEnabled(project, true);
    release("PRIVATE-PAUSE-INTERVAL");
    await pending;
    await capture.shell(s, async () => "before\nPRIVATE-PAUSE-INTERVAL");
    await capture.shell(s, async () => "before\nPRIVATE-PAUSE-INTERVAL\nafter");
    expect(JSON.stringify((await store.view(project)).records)).not.toContain(
      "PRIVATE-PAUSE-INTERVAL",
    );
    await store.close();
  });
  it("une capture indisponible produit un trou durable, sans répétition ni invention", async () => {
    const { store, project, capture, failed } = await fixture(),
      s = shell(project);
    expect(await capture.shell(s, async () => null)).toBe(false);
    await capture.shell(s, async () => null);
    await capture.shell(s, async () => "back", true);
    const rows = (await store.view(project)).records;
    expect(rows.filter((r) => r.kind === "capture.gap")).toHaveLength(2);
    expect((await store.view(project)).health.incomplete).toBe(true);
    expect(failed).not.toHaveBeenCalled();
    await store.close();
  });
  it("aucun projet associé ne donne accès à une lecture du terminal", async () => {
    const { store, capture } = await fixture(),
      read = vi.fn(async () => "PRIVATE");
    expect(await capture.shell(shell(null), read)).toBe(true);
    expect(read).not.toHaveBeenCalled();
    await store.close();
  });
  it("retire ANSI et secrets avant de tronquer, y compris les fragments de clés privées", () => {
    vi.stubEnv("AUDIT_TEST_SECRET", "literal-secret-value");
    const raw = `\u001b[31mpassword=hidden\u001b[0m\nliteral-secret-value\n-----BEGIN OPENSSH PRIVATE KEY-----\n${"private-line\n".repeat(3000)}-----END OPENSSH PRIVATE KEY-----\nresult`;
    const text = auditTerminalText(raw);
    expect(text).toContain("result");
    expect(text).not.toMatch(/hidden|literal-secret-value|private-line/);
    expect(text).not.toContain(String.fromCharCode(27));
    expect(auditTerminalText("private-fragment\n-----END RSA PRIVATE KEY-----\nok")).not.toContain(
      "private-fragment",
    );
    expect(
      auditTerminalText(`-----BEGIN PRIVATE KEY-----\n${"secret\n".repeat(5000)}`),
    ).not.toContain("secret");
    expect(terminalOverlap("old\nnext", "next\nnew")).toBe(4);
    expect(terminalOverlap("abc", "abc")).toBe(3);
    expect(terminalOverlap("abc", "xyz")).toBe(0);
  });
});

describe("qualification humaine locale", () => {
  it("borne les messages et refuse des références ou droits fournis par la webview", () => {
    const projectId = randomUUID(),
      message = { type: "reviewAuditTest", projectId, testId: "run:call", claim };
    expect(parseStudioMessage(message)).toEqual(message);
    for (const bad of [
      { ...message, path: "/tmp" },
      { ...message, projectId: "../other" },
      { ...message, claim: { ...claim, reviewed: true } },
      { ...message, claim: { ...claim, evidenceIds: ["forged"] } },
      { ...message, claim: { ...claim, objective: "x".repeat(501) } },
    ])
      expect(parseStudioMessage(bad)).toBeNull();
    expect(parseStudioMessage({ type: "setAuditEnabled", projectId, enabled: false })).toEqual({
      type: "setAuditEnabled",
      projectId,
      enabled: false,
    });
    expect(
      parseStudioMessage({ type: "setAuditEnabled", projectId, enabled: false, path: "/" }),
    ).toBeNull();
  });
  it("rattache uniquement les références relues et annule si le projet a changé", async () => {
    const { store, project, capture } = await fixture();
    await capture.shell(shell(project), async () => "HTTP 403");
    const test = (await store.view(project)).tests[0];
    if (!test) throw Error("missing test");
    let checks = 0;
    await expect(
      reviewAuditTest({
        store,
        projectId: project,
        testId: test.id,
        claim,
        isCurrent: async () => {
          if (++checks === 2) throw Error("project changed");
        },
      }),
    ).rejects.toThrow("project changed");
    expect((await store.view(project)).tests[0]?.reviewed).toBe(false);
    await reviewAuditTest({
      store,
      projectId: project,
      testId: test.id,
      claim,
      isCurrent: async () => {},
    });
    expect((await store.view(project)).tests[0]).toMatchObject({
      ...claim,
      reviewed: true,
      evidenceIds: test.evidenceIds,
    });
    await store.close();
  });
});

// Lecteur ZIP déjà employé par VSCE ; pas de nouvelle dépendance de production pour les tests.
const require = createRequire(import.meta.url),
  vsceRequire = createRequire(require.resolve("@vscode/vsce"));
interface TestZip {
  on(event: "error", callback: (error: Error) => void): void;
  on(event: "end", callback: () => void): void;
  on(event: "entry", callback: (entry: { fileName: string }) => void): void;
  readEntry(): void;
  openReadStream(
    entry: { fileName: string },
    callback: (error: Error | null, stream: NodeJS.ReadableStream) => void,
  ): void;
}
const yauzl = vsceRequire("yauzl") as {
  fromBuffer(
    buffer: Buffer,
    options: unknown,
    callback: (error: Error | null, zip: TestZip) => void,
  ): void;
};
async function unzip(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const rows = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("end", () => resolve(rows));
      zip.on("entry", (entry: { fileName: string }) =>
        zip.openReadStream(entry, (error: Error | null, stream: NodeJS.ReadableStream) => {
          if (error) return reject(error);
          const chunks: Buffer[] = [];
          stream.on("data", (b: Buffer) => chunks.push(b));
          stream.on("error", reject);
          stream.on("end", () => {
            rows.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        }),
      );
      zip.readEntry();
    }),
  );
}

describe("dossier client autonome", () => {
  it("exporte les traces complètes, un HTML échappé, les contrôles et les empreintes vérifiables", async () => {
    const { root, store, project, capture } = await fixture();
    await capture.shell(shell(project), async () => '<script>alert("x")</script>\npassword=hidden');
    for (let n = 0; n < 505; n++)
      await store.append(project, { actor: "system", kind: "terminal.closed", data: { n } });
    const destination = join(root, "audit.zip"),
      beforeCommit = vi.fn(async () => {});
    const result = await exportAuditBundle({
      store,
      projectId: project,
      projectName: "Lab <img src=x onerror=bad()>",
      destination,
      locale: "en",
      chat: "# Fil de mission\nTexte déjà masqué",
      beforeCommit,
    });
    const bytes = await readFile(destination),
      entries = await unzip(bytes),
      manifest = JSON.parse(entries.get("manifest.json")?.toString() as string);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(entries.has("tests.json")).toBe(true);
    expect(entries.has("evidence.json")).toBe(true);
    expect(entries.get("index.html")?.toString()).toContain(
      "A recorded execution is not a validated test.",
    );
    expect(entries.get("index.html")?.toString()).not.toContain("<img src=x");
    const raw = [...entries]
      .filter(([name]) => name.startsWith("journals/"))
      .map(([, data]) => data.toString())
      .join("");
    expect(raw.trim().split("\n")).toHaveLength(506);
    expect(raw).not.toContain("hidden");
    expect(entries.get("chat.md")?.toString()).toContain("Texte déjà masqué");
    expect(manifest.collection.chatIncluded).toBe(true);
    expect(manifest.collection.htmlLimited).toBe(true);
    expect(manifest.collection.cryptographicSignature).toBe(false);
    for (const file of manifest.files) {
      const data = entries.get(file.name) as Buffer;
      expect(data.length).toBe(file.size);
      expect(createHash("sha256").update(data).digest("hex")).toBe(file.sha256);
    }
    await store.close();
  });
  it("exclut du ZIP les comptes masqués par le recorder", async () => {
    const { root, store, project, capture } = await fixture();
    const accounts = createTestAccounts([
      { label: "A", host: "", identifier: "alice@example.com", secret: "xy", kind: "password" },
    ]);
    const recorder = createRecorder({ redact: accounts.redact });
    capture.event(
      project,
      recorder.emit({ kind: "run.started", prompt: "alice@example.com xy", cwd: "/workspace" }),
    );
    await capture.flush();
    const destination = join(root, "audit-comptes.zip");
    const chatEvent = recorder.emit({ kind: "user.message", text: "alice@example.com xy" });
    if (chatEvent.kind !== "user.message") throw new Error("événement inattendu");
    await exportAuditBundle({
      store,
      projectId: project,
      projectName: "Test",
      destination,
      locale: "fr",
      chat: chatEvent.text,
      beforeCommit: async () => {},
    });
    const entries = await unzip(await readFile(destination));
    const output = [...entries.values()].map((value) => value.toString()).join("\n");
    expect(output).not.toContain("alice@example.com");
    expect(output).not.toContain("xy");
    await store.close();
  });
  it("échappe aussi les preuves dans l’HTML et traduit le français", async () => {
    const { store, project, capture } = await fixture();
    await capture.shell(shell(project), async () => '<script>alert("x")</script>');
    const html = auditHtml("Mission", await store.view(project), "fr");
    expect(html).toContain("Une exécution enregistrée");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("default-src 'none'");
    await store.close();
  });
  it("un changement de projet annule le remplacement du fichier final et nettoie le temporaire", async () => {
    const { root, store, project, capture } = await fixture();
    await capture.shell(shell(project), async () => "ok");
    const destination = join(root, "audit.zip");
    await writeFile(destination, "EXISTING");
    await expect(
      exportAuditBundle({
        store,
        projectId: project,
        projectName: "Lab",
        destination,
        locale: "en",
        beforeCommit: async () => {
          throw Error("project changed");
        },
      }),
    ).rejects.toThrow("project changed");
    expect(await readFile(destination, "utf8")).toBe("EXISTING");
    expect((await readdir(root)).some((n) => n.endsWith(".tmp"))).toBe(false);
    await store.close();
  });
  it("refuse d’écraser le stockage de l’application", async () => {
    const { store, project, capture } = await fixture();
    await capture.shell(shell(project), async () => "ok");
    await expect(
      exportAuditBundle({
        store,
        projectId: project,
        projectName: "Lab",
        destination: join(store.directory(project), "config.json"),
        locale: "en",
        beforeCommit: async () => {},
      }),
    ).rejects.toThrow("cannot overwrite");
    await store.close();
  });
});
