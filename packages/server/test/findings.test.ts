import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuditStore,
  appendFinding,
  attachEvidence,
  createEvidence,
  createProject,
  listEvidence,
  readFindings,
} from "@warband/core";
import { missionReport } from "@warband/vscode/logic/mission-report";
import { missionSnapshot } from "@warband/vscode/logic/mission-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { MAX_EVIDENCE_TEXT, reportFilename } from "../src/bridge/findings.js";
import { createServer } from "../src/http.js";
import { setup, shellOf, useStorage } from "./bridge-helpers.js";

const ctx = useStorage();
const SECRET_TEXT = `sortie ${"x".repeat(MAX_EVIDENCE_TEXT + 500)}`;

/** Projet factice avec deux trouvailles, dont une avec une preuve. */
async function fixture(name = "Mission test") {
  const configDir = join(ctx.dir, "config");
  await mkdir(configDir, { recursive: true });
  const project = await createProject(configDir, { name, workspace: ctx.dir });
  const evidence = await createEvidence(configDir, project.id, {
    label: "Capture nmap",
    text: SECRET_TEXT,
    source: { kind: "tool", reference: "nmap/scan.txt" },
  });
  const host = await appendFinding(configDir, project.id, {
    kind: "host",
    state: "confirmed",
    label: "Hôte 10.0.0.5",
  });
  await attachEvidence(configDir, project.id, host.id, evidence.id);
  const site = await appendFinding(configDir, project.id, {
    kind: "site",
    state: "hypothesis",
    label: "Site admin",
    from: [host.id],
  });
  return { configDir, project, evidence, host, site };
}

describe("messages findings (coquille)", () => {
  it("findingsList renvoie les trouvailles du projet sans contenu de preuve", async () => {
    const f = await fixture();
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "findingsList", project: f.project.id });
    await vi.waitFor(() => expect(shell.of("shell", "findings")).toHaveLength(1));
    const msg = shell.of("shell", "findings")[0]?.msg as {
      project: string;
      items: { id: string; label: string; evidence: unknown[] }[];
    };
    expect(msg.project).toBe(f.project.id);
    expect(msg.items.map((i) => i.id).sort()).toEqual([f.host.id, f.site.id].sort());
    expect(msg.items.find((i) => i.id === f.host.id)?.evidence).toEqual([
      { id: f.evidence.id, label: "Capture nmap" },
    ]);
    expect(JSON.stringify(msg)).not.toContain("xxxxx");
    expect(msg.items[0]).not.toHaveProperty("severity");
  });

  it("findingsList sans projet : tous les projets ; projet inconnu : configError", async () => {
    const f = await fixture();
    const other = await createProject(f.configDir, { name: "Autre", workspace: ctx.dir });
    await appendFinding(f.configDir, other.id, { kind: "host", state: "failed", label: "H" });
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "findingsList" });
    await vi.waitFor(() => expect(shell.of("shell", "findings")).toHaveLength(1));
    const msg = shell.of("shell", "findings")[0]?.msg as { project: unknown; items: unknown[] };
    expect(msg.project).toBeNull();
    expect(msg.items).toHaveLength(3);
    shell.say("shell", "shell", {
      type: "findingsList",
      project: "00000000-0000-4000-8000-000000000000",
    });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(1));
  });

  it("findingGet borne le texte de preuve et ne répond qu'à l'émetteur", async () => {
    const f = await fixture();
    const t = setup(ctx);
    const shell = shellOf(t);
    const other = shellOf(t);
    shell.say("shell", "shell", { type: "findingGet", project: f.project.id, id: f.host.id });
    await vi.waitFor(() => expect(shell.of("shell", "finding")).toHaveLength(1));
    const finding = shell.of("shell", "finding")[0]?.msg.finding as {
      evidenceDetails: { text: string; truncated: boolean }[];
    };
    expect(finding.evidenceDetails[0]?.text).toHaveLength(MAX_EVIDENCE_TEXT);
    expect(finding.evidenceDetails[0]?.truncated).toBe(true);
    expect(other.of("shell", "finding")).toHaveLength(0);
    shell.say("shell", "shell", { type: "findingGet", project: f.project.id, id: "inconnu" });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(1));
  });

  it("findingDelete sans confirmed:true est refusé ; avec, supprime et diffuse", async () => {
    const f = await fixture();
    const t = setup(ctx);
    const shell = shellOf(t);
    const other = shellOf(t);
    shell.say("shell", "shell", {
      type: "findingDelete",
      project: f.project.id,
      id: f.site.id,
      confirmed: false,
    });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(1));
    // Champ absent : message invalide, ignoré.
    shell.say("shell", "shell", { type: "findingDelete", project: f.project.id, id: f.site.id });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBeGreaterThan(0));
    expect(await readFindings(f.configDir, f.project.id)).toHaveLength(2);

    shell.say("shell", "shell", {
      type: "findingDelete",
      project: f.project.id,
      id: f.site.id,
      confirmed: true,
    });
    await vi.waitFor(() => expect(other.of("shell", "findings")).toHaveLength(1));
    expect(await readFindings(f.configDir, f.project.id)).toHaveLength(1);
    const items = other.of("shell", "findings")[0]?.msg.items as { id: string }[];
    expect(items.map((i) => i.id)).toEqual([f.host.id]);
  });
});

describe("filename", () => {
  it("assaini : ni séparateur, ni guillemet, ni ..", () => {
    const d = new Date("2026-01-02T03:04:05Z");
    const name = reportFilename('../../etc/"passwd"\r\n.md', d);
    expect(name).toMatch(/^rapport-[A-Za-z0-9._-]+-2026-01-02\.md$/);
    expect(name).not.toMatch(/[/\\"\r\n]|\.\./);
    expect(reportFilename("////", d)).toBe("rapport-projet-2026-01-02.md");
  });
});

describe("GET /api/report", () => {
  const ORIGIN = "https://chasse.exemple.fr";
  let srv: ReturnType<typeof createServer>;
  let base = "";
  let cookie = "";

  async function start(configDir: string) {
    const passwordHash = await hashPassword("un-mot-de-passe-solide");
    srv = createServer(
      {
        host: "127.0.0.1",
        port: 0,
        dataDir: "/tmp/x",
        webDir: fileURLToPath(new URL("../web", import.meta.url)),
        publicOrigin: ORIGIN,
        trustProxy: false,
      },
      { passwordHash, configDir },
    );
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ password: "un-mot-de-passe-solide" }),
    });
    cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }
  beforeEach(() => {
    cookie = "";
  });
  afterEach(async () => {
    srv.closeAllConnections();
    await new Promise((ok) => srv.close(ok));
  });

  it("sans session : 401", async () => {
    const f = await fixture();
    await start(f.configDir);
    const res = await fetch(`${base}/api/report?project=${f.project.id}`);
    expect(res.status).toBe(401);
  });

  it("avec session : Markdown identique à missionReport, en-têtes et nom assaini", async () => {
    const f = await fixture('Mission "../x"');
    await start(f.configDir);
    const res = await fetch(`${base}/api/report?project=${f.project.id}&locale=fr`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(
      /^attachment; filename="rapport-[A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2}\.md"$/,
    );
    expect(disposition).not.toMatch(/\.\./);
    const body = await res.text();
    const date = /Export : (\S+)/.exec(body)?.[1] ?? "";
    const findings = await readFindings(f.configDir, f.project.id);
    const audit = await new AuditStore(f.configDir).view(f.project.id).catch(() => null);
    const evidence = await listEvidence(f.configDir, f.project.id);
    const snapshot = missionSnapshot(findings, audit, evidence);
    expect(body).toBe(missionReport(f.project, snapshot.findings, new Date(date), "fr", snapshot));
    expect(body).toContain("Hôte 10.0.0.5");
    expect(body).not.toContain("xxxxx");
    const en = await fetch(`${base}/api/report?project=${f.project.id}&locale=en`, {
      headers: { Cookie: cookie },
    });
    expect(en.status).toBe(200);
  });

  it("projet inconnu, chemin ou langue invalides : 404 / 400 JSON", async () => {
    const f = await fixture();
    await start(f.configDir);
    const get = (q: string) => fetch(`${base}/api/report?${q}`, { headers: { Cookie: cookie } });
    for (const q of [
      "project=00000000-0000-4000-8000-000000000000",
      "project=..%2F..%2Fetc",
      `project=${encodeURIComponent(f.configDir)}`,
    ]) {
      const res = await get(q);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("project.absent");
    }
    expect((await get("")).status).toBe(400);
    expect((await get(`project=${f.project.id}&locale=de`)).status).toBe(400);
  });
});
