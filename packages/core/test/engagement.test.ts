import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveEngagement,
  canonicalEngagement,
  clearHalt,
  createMissionDesk,
  createRecorder,
  DEFAULT_POLICY,
  engagementDigest,
  evaluateEngagementStatus,
  evaluatePolicy,
  importEngagementDraft,
  isHalted,
  type Policy,
  parseEngagementSheet,
  projectEngagementApprovalPath,
  projectEngagementHaltPath,
  projectEngagementPath,
  readEngagement,
  readEngagementSync,
  setHalt,
  suspendEngagement,
} from "../src/index.js";

const ID = "11111111-1111-4111-8111-111111111111";
const allowAll: Policy = { default: "allow", rules: [{ tool: "*", decision: "allow" }] };
const dir = () => mkdtemp(join(tmpdir(), "warband-engagement-"));

const cited = <T>(value: T, verified = true) => ({
  value,
  quote: "Lettre de mission, article 3",
  url: "https://example.com/mission",
  retrievedAt: "2026-11-08T10:00:00Z",
  verified,
});

const sheet = (over: Record<string, unknown> = {}) => ({
  version: 1,
  authorization: cited({ principal: "ACME SA", reference: "RT-2026-07", signatory: "J. Martin" }),
  window: cited({
    text: "du 1er au 15 décembre 2026, 20h-6h UTC",
    notBefore: "2026-12-01T00:00:00Z",
    notAfter: "2026-12-15T00:00:00Z",
  }),
  inScope: cited(["*.Example.com", "10.0.0.0/24"]),
  infrastructure: cited(["c2.redteam.example.net"]),
  outOfScope: cited(["admin.example.com"]),
  rulesOfEngagement: cited("Pas de déni de service. Systèmes de paie intouchables."),
  whiteTeam: cited({
    contact: "white@example.com",
    deconfliction: "Appel avant toute action risquée",
  }),
  osintPolicy: cited("Rôles et informations professionnelles publiques seulement."),
  ...over,
});

describe("fiche d'engagement : validation et empreinte", () => {
  it("normalise les motifs et fournit une empreinte stable", () => {
    const a = parseEngagementSheet(sheet());
    expect(a.inScope.value).toEqual(["*.example.com", "10.0.0.0/24"]);
    const b = parseEngagementSheet(
      sheet({ inScope: cited(["10.0.0.0/24", "*.example.com", "*.example.com"]) }),
    );
    expect(canonicalEngagement(a)).toBe(canonicalEngagement(b));
    expect(engagementDigest(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["champ inconnu", sheet({ extra: 1 })],
    ["version", sheet({ version: 2 })],
    ["motif d'hôte invalide", sheet({ inScope: cited(["pas un hôte!"]) })],
    ["infrastructure invalide", sheet({ infrastructure: cited(["10.0.0.0/99"]) })],
    [
      "infrastructure confondue avec le périmètre",
      sheet({ infrastructure: cited(["10.0.0.0/24"]) }),
    ],
    ["citation sans url valide", sheet({ osintPolicy: { ...cited("x"), url: "ftp://x" } })],
    [
      "autorisation sans signataire",
      sheet({ authorization: cited({ principal: "A", reference: "B" }) }),
    ],
    [
      "fenêtre inversée",
      sheet({ window: cited({ text: "t", notBefore: "2026-12-15", notAfter: "2026-12-01" }) }),
    ],
    ["texte vide", sheet({ rulesOfEngagement: cited("   ") })],
    ["white team sans déconfliction", sheet({ whiteTeam: cited({ contact: "x" }) })],
  ])("refuse : %s", (_name, raw) => {
    expect(() => parseEngagementSheet(raw)).toThrowError(
      expect.objectContaining({ code: "engagement.invalid" }),
    );
  });
});

describe("fiche d'engagement : stockage et états", () => {
  it("aucune fiche : none ; import : draft, 0o600, rien d'appliqué", async () => {
    const d = await dir();
    expect((await readEngagement(d, ID)).state).toBe("none");
    const status = await importEngagementDraft(d, ID, JSON.stringify(sheet()));
    expect(status.state).toBe("draft");
    expect(status.applied).toBeUndefined();
    await expect(readFile(projectEngagementApprovalPath(d, ID))).rejects.toMatchObject({
      code: "ENOENT",
    });
    if (process.platform !== "win32") {
      expect((await stat(projectEngagementPath(d, ID))).mode & 0o777).toBe(0o600);
      expect((await stat(join(d, "projects", ID))).mode & 0o777).toBe(0o700);
    }
  });

  it("brouillon invalide ou id non UUID : refus, rien d'écrit", async () => {
    const d = await dir();
    await expect(importEngagementDraft(d, ID, "pas du json")).rejects.toMatchObject({
      code: "engagement.invalid",
    });
    expect((await readEngagement(d, ID)).state).toBe("none");
    for (const bad of ["../x", "11111111-1111-1111-1111-111111111111"]) {
      await expect(importEngagementDraft(d, bad, JSON.stringify(sheet()))).rejects.toMatchObject({
        code: "project.invalid",
      });
      expect(() => isHalted(d, bad)).toThrow();
    }
    expect(readdirSync(d)).toEqual([]);
  });

  it("approve sans empreinte ou avec une fausse empreinte : refus", async () => {
    const d = await dir();
    await expect(approveEngagement(d, ID, "x")).rejects.toMatchObject({
      code: "engagement.absent",
    });
    const draft = await importEngagementDraft(d, ID, JSON.stringify(sheet()));
    await expect(approveEngagement(d, ID, undefined)).rejects.toMatchObject({
      code: "engagement.digestRequired",
    });
    await expect(approveEngagement(d, ID, "")).rejects.toMatchObject({
      code: "engagement.digestRequired",
    });
    await expect(approveEngagement(d, ID, "0".repeat(64))).rejects.toMatchObject({
      code: "engagement.digestMismatch",
    });
    expect((await readEngagement(d, ID)).state).toBe("draft");
    const ok = await approveEngagement(d, ID, draft.digest?.toUpperCase());
    expect(ok.state).toBe("approved");
    expect(ok.applied).toBeDefined();
    if (process.platform !== "win32")
      expect((await stat(projectEngagementApprovalPath(d, ID))).mode & 0o777).toBe(0o600);
  });

  it("brouillon modifié après approbation : invalidated ; suspension puis réapprobation", async () => {
    const d = await dir();
    const first = await importEngagementDraft(d, ID, JSON.stringify(sheet()));
    await approveEngagement(d, ID, first.digest);
    const changed = await importEngagementDraft(
      d,
      ID,
      JSON.stringify(sheet({ rulesOfEngagement: cited("Règles élargies") })),
    );
    expect(changed.state).toBe("invalidated");
    expect(changed.applied).toBeUndefined();
    expect(readEngagementSync(d, ID).state).toBe("invalidated");
    const again = await approveEngagement(d, ID, changed.digest);
    expect(again.state).toBe("approved");
    const suspended = await suspendEngagement(d, ID);
    expect(suspended.state).toBe("suspended");
    expect(suspended.applied).toBeUndefined();
    expect((await approveEngagement(d, ID, changed.digest)).state).toBe("approved");
  });

  it("suspendre sans approbation : engagement.absent", async () => {
    await expect(suspendEngagement(await dir(), ID)).rejects.toMatchObject({
      code: "engagement.absent",
    });
  });

  it("approbation ou brouillon illisible : unreadable, rien d'appliqué", async () => {
    const d = await dir();
    await importEngagementDraft(d, ID, JSON.stringify(sheet()));
    await writeFile(
      projectEngagementApprovalPath(d, ID),
      JSON.stringify({ version: 1, digest: "x" }),
    );
    const bad = await readEngagement(d, ID);
    expect(bad.state).toBe("unreadable");
    expect(bad.applied).toBeUndefined();
    expect(
      evaluateEngagementStatus(
        "{",
        JSON.stringify({ version: 1, digest: "a".repeat(64), approvedAt: "t" }),
      ).state,
    ).toBe("unreadable");
  });
});

describe("arrêt d'urgence", () => {
  it("halt puis isHalted vrai ; resume puis faux", async () => {
    const d = await dir();
    expect(isHalted(d, ID)).toBe(false);
    expect(await clearHalt(d, ID)).toBe(false);
    const halt = await setHalt(d, ID, () => new Date("2026-11-08T10:00:00Z"));
    expect(halt.haltedAt).toBe("2026-11-08T10:00:00.000Z");
    expect(isHalted(d, ID)).toBe(true);
    // Idempotent : la date d'origine est conservée.
    expect((await setHalt(d, ID, () => new Date("2027-01-01T00:00:00Z"))).haltedAt).toBe(
      halt.haltedAt,
    );
    if (process.platform !== "win32")
      expect((await stat(projectEngagementHaltPath(d, ID))).mode & 0o777).toBe(0o600);
    expect(await clearHalt(d, ID)).toBe(true);
    expect(isHalted(d, ID)).toBe(false);
  });

  it("fichier illisible : arrêt considéré actif (fail-closed)", async () => {
    const d = await dir();
    await setHalt(d, ID);
    await writeFile(projectEngagementHaltPath(d, ID), "pas du json");
    expect(isHalted(d, ID)).toBe(true);
  });

  it("le projet voisin n'est pas arrêté", async () => {
    const d = await dir();
    await setHalt(d, ID);
    expect(isHalted(d, "22222222-2222-4222-8222-222222222222")).toBe(false);
  });
});

describe("chemins sensibles de l'engagement", () => {
  const custom = "/srv/wb-config";
  const files = [
    `${custom}/projects/${ID}/engagement.json`,
    `${custom}/projects/${ID}/engagement.approval.json`,
    `${custom}/projects/${ID}/engagement-halt.json`,
    `${custom}/projects/${ID}/engagement.json.123.tmp`,
  ];
  const ctx = { cwd: "/work", home: "/home/u", platform: "posix" as const, env: {} };

  it.each(files)("Write, Edit et Read refusés : %s", (file_path) => {
    for (const tool of ["Write", "Edit", "Read"]) {
      const v = evaluatePolicy(allowAll, tool, { file_path }, ctx);
      expect(v).toMatchObject({ decision: "deny", reason: { code: "path.sensitive" } });
    }
  });

  it.each(files)("Bash refusé : %s", (file) => {
    for (const command of [`cat ${file}`, `echo '{}' > ${file}`, `rm ${file}`]) {
      expect(evaluatePolicy(allowAll, "Bash", { command }, ctx).decision).toBe("deny");
    }
  });

  it("noms nus de l'approbation et de l'arrêt refusés dans un shell", () => {
    for (const command of ["rm engagement-halt.json", "cat engagement.approval.json"]) {
      expect(evaluatePolicy(allowAll, "Bash", { command }, ctx).decision).toBe("deny");
    }
    expect(
      evaluatePolicy(allowAll, "mcp__exegol__exec", { command: `rm ${files[2]}` }, ctx).decision,
    ).toBe("deny");
  });

  it("variante Windows", () => {
    const v = evaluatePolicy(
      allowAll,
      "Write",
      { file_path: `D:\\cfg\\projects\\${ID}\\engagement-halt.json` },
      {
        cwd: "D:\\w",
        platform: "win32",
        home: "C:\\Users\\x",
        env: { USERPROFILE: "C:\\Users\\x" },
      },
    );
    expect(v.decision).toBe("deny");
  });

  it("les autres fichiers du projet restent régis par la règle générale", () => {
    const v = evaluatePolicy(
      DEFAULT_POLICY,
      "Read",
      { file_path: `${custom}/projects/${ID}/notes.json` },
      ctx,
    );
    expect(v.reason.code).not.toBe("path.sensitive");
  });
});

describe("mission_context", () => {
  async function desk(d: string) {
    const recorder = createRecorder({ runId: "run", redact: false });
    return createMissionDesk({
      recorder,
      engagement: () => readEngagementSync(d, ID),
      halted: () => isHalted(d, ID),
    });
  }

  it("contient la fiche approuvée (bloc non fiable) et l'état d'arrêt", async () => {
    const d = await dir();
    const draft = await importEngagementDraft(d, ID, JSON.stringify(sheet()));
    const mission = await desk(d);
    expect(mission.context().engagement).toBeNull();
    expect(mission.context().halted).toBe(false);
    await approveEngagement(d, ID, draft.digest);
    const ctx = mission.context();
    expect(ctx.engagement).toMatchObject({ untrusted: true, digest: draft.digest });
    expect(ctx.engagement?.notice).toContain("non fiables");
    expect(ctx.engagement?.sheet.infrastructure.value).toEqual(["c2.redteam.example.net"]);
    await setHalt(d, ID);
    expect(mission.context().halted).toBe(true);
    // Fiche invalidée : plus injectée.
    await importEngagementDraft(d, ID, JSON.stringify(sheet({ osintPolicy: cited("autre") })));
    expect(mission.context().engagement).toBeNull();
  });

  it("halted qui échoue : considéré actif", async () => {
    const recorder = createRecorder({ runId: "run", redact: false });
    const mission = createMissionDesk({
      recorder,
      halted: () => {
        throw new Error("illisible");
      },
    });
    expect(mission.context().halted).toBe(true);
  });
});

describe("aucun outil d'agent n'approuve ni ne lève l'arrêt", () => {
  it("approveEngagement/suspendEngagement/importEngagementDraft/setHalt/clearHalt ne sont référencés que par le module et la CLI", () => {
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dirPath: string) => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "test")
          continue;
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|js|mjs)$/.test(entry.name) &&
          !full.includes(`${join("vscode", "media")}`) &&
          /\b(approveEngagement|suspendEngagement|importEngagementDraft|setHalt|clearHalt)\b/.test(
            readFileSync(full, "utf8"),
          )
        )
          hits.push(relative(root, full).split("\\").join("/"));
      }
    };
    for (const pkg of readdirSync(root)) walk(join(root, pkg, "src"));
    expect(hits.sort()).toEqual([
      "cli/src/main.ts",
      "core/src/engagement/halt.ts",
      "core/src/engagement/store.ts",
    ]);
  });
});
