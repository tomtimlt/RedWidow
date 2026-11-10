import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentProfile,
  clearPaceHalt,
  createApprovalGate,
  createBypassSwitch,
  createPaceController,
  createPaceRegistry,
  createRecorder,
  createTestAccounts,
  createWebProgram,
  DEFAULT_POLICY,
  type EngagementView,
  type EngineEvent,
  HTTP_REQUEST_TOOL,
  haltedPaceHosts,
  MAX_PACE_WAIT_MS,
  outputFileSpecs,
  type PaceController,
  type ProgramSheet,
  parseEngagementSheet,
  parseProgramSheet,
  projectPaceHaltedPath,
  type WebProgram,
  webToolSpecs,
} from "../src/index.js";
import { requestRaw, type WebDependencies, type WebResponse } from "../src/web/network.js";

const cited = <T>(value: T) => ({
  value,
  quote: "Règle du programme",
  url: "https://example.com/program",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified: true,
});

const SUFFIX = "bugbounty-pseudo";
const sheet = (over: Record<string, unknown> = {}): ProgramSheet =>
  parseProgramSheet({
    version: 1,
    inScope: cited(["*.example.com", "app.test"]),
    outOfScope: cited([]),
    userAgentSuffix: cited(SUFFIX),
    pace: cited({ maxRequestsPerSecond: 1 }),
    ...over,
  });

const ctx = { parentId: null, correlation: undefined, signal: undefined };
const lookup = async () => [{ address: "93.184.216.34", family: 4 }];

function reply(
  status: number,
  body = "ok",
  headers: Record<string, string> = { "content-type": "text/plain" },
): WebResponse {
  return {
    status,
    headers,
    body: (async function* () {
      yield new TextEncoder().encode(body);
    })(),
  };
}

/** Horloge simulée : `sleep` avance le temps sans attendre. */
function fixture(
  options: {
    profile?: AgentProfile;
    sheet?: ProgramSheet | undefined;
    pace?: PaceController | null;
    responses?: (() => WebResponse)[];
  } = {},
) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const pace =
    options.pace === undefined
      ? createPaceController({ maxRequestsPerSecond: 1, now: () => t })
      : options.pace;
  const calls: {
    url: string;
    address: string;
    init: Parameters<NonNullable<WebDependencies["transport"]>>[2];
  }[] = [];
  const queue = [...(options.responses ?? [])];
  const deps: WebDependencies = {
    lookup,
    transport: async (url, address, init) => {
      calls.push({ url: url.href, address, init });
      return (queue.shift() ?? (() => reply(200)))();
    },
  };
  const program: WebProgram = {
    profile: () => options.profile ?? "bug-bounty",
    sheet: () => ("sheet" in options ? options.sheet : sheet()),
    pace: () => pace,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  const specs = webToolSpecs(deps, program);
  const find = (name: string) => {
    const tool = specs.find((s) => s.name === name);
    if (!tool) throw new Error(`outil absent : ${name}`);
    return tool;
  };
  return {
    deps,
    program,
    pace,
    calls,
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
    http: (args: Record<string, unknown>) => find("http_request").run(args, ctx),
    read: (url: string) => find("read_url").run({ url }, ctx),
  };
}

const URL_OK = "https://app.example.com/api";
const parse = (text: string) => JSON.parse(text) as Record<string, any>;

describe("http_request : fiche et en-têtes", () => {
  it.each(["out-of-box", "red-team", "htb", "mentor"] as const)(
    "%s sans fiche : approbation de la gate puis requête, sans suffixe imposé",
    async (profile) => {
      const f = fixture({ profile, sheet: undefined });
      const ask = vi.fn(async () => ({ decision: "allow" as const, remember: "session" as const }));
      const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder: createRecorder(), ask });
      const input = { method: "GET", url: URL_OK, headers: { "User-Agent": "ClientLibre" } };
      const decide = (id: string) =>
        gate.decide(
          { toolUseId: id, tool: HTTP_REQUEST_TOOL, input },
          new AbortController().signal,
        );
      expect((await decide("premier")).decision).toBe("allow");
      expect(ask).toHaveBeenCalledTimes(1);
      expect((await decide("second")).reason.code).toBe("approval.remembered");
      expect(parse(await f.http(input)).status).toBe(200);
      expect(f.calls[0]?.init.userAgent).toBe("ClientLibre");
    },
  );

  it("applique encore la fiche et son suffixe hors Bug bounty", async () => {
    const f = fixture({ profile: "htb" });
    await f.http({ method: "GET", url: URL_OK });
    expect(f.calls[0]?.init.userAgent).toContain(SUFFIX);
    await f.http({ method: "GET", url: URL_OK });
    expect(f.sleeps).toEqual([1000]);
  });

  it("exige une fiche approuvée", async () => {
    const f = fixture({ sheet: undefined });
    await expect(f.http({ method: "GET", url: URL_OK })).rejects.toMatchObject({
      code: "program.required",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("sans fournisseur de fiche, l'outil refuse aussi", async () => {
    const tool = webToolSpecs({ lookup }).find((s) => s.name === "http_request");
    await expect(tool?.run({ method: "GET", url: URL_OK }, ctx)).rejects.toMatchObject({
      code: "program.required",
    });
  });

  it("ajoute toujours le suffixe de la fiche au User-Agent, fourni ou non, sans pouvoir le retirer", async () => {
    const f = fixture();
    await f.http({ method: "GET", url: URL_OK });
    expect(f.calls[0]?.init.userAgent).toMatch(new RegExp(`${SUFFIX}$`));
    f.advance(5000);
    await f.http({ method: "GET", url: URL_OK, headers: { "User-Agent": "Mozilla/5.0 X" } });
    expect(f.calls[1]?.init.userAgent).toBe(`Mozilla/5.0 X ${SUFFIX}`);
    f.advance(5000);
    await f.http({ method: "GET", url: URL_OK, headers: { "user-agent": "" } });
    expect(f.calls[2]?.init.userAgent).toMatch(new RegExp(`${SUFFIX}$`));
    for (const call of f.calls) expect(call.init.headers).not.toHaveProperty("user-agent");
  });

  it("n'ajoute rien sans suffixe dans la fiche et ignore les en-têtes gérés par le moteur", async () => {
    const f = fixture({ sheet: sheet({ userAgentSuffix: undefined }) });
    await f.http({
      method: "POST",
      url: URL_OK,
      headers: { Host: "evil.example", "Content-Length": "1", "X-Test": "1" },
      body: "a=1",
    });
    expect(f.calls[0]?.init.userAgent).toBe("Warband/0.3 (http_request)");
    expect(f.calls[0]?.init.headers).toEqual({ "x-test": "1" });
    expect(f.calls[0]?.init.body).toBe("a=1");
  });

  it("refuse un corps avec GET et un en-tête injecté", async () => {
    const f = fixture();
    await expect(f.http({ method: "GET", url: URL_OK, body: "x" })).rejects.toMatchObject({
      code: "web.invalidRequest",
    });
    await expect(
      f.http({ method: "GET", url: URL_OK, headers: { "X-A": "1\r\nX-B: 2" } }),
    ).rejects.toMatchObject({ code: "web.invalidRequest" });
    await expect(f.http({ method: "TRACE", url: URL_OK })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});

describe("http_request : réseau", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://10.1.2.3/",
  ])("refuse l'adresse non publique %s", async (url) => {
    const f = fixture();
    await expect(f.http({ method: "GET", url })).rejects.toMatchObject({ code: "web.invalidUrl" });
    expect(f.calls).toHaveLength(0);
  });

  it("refuse un nom qui se résout vers une adresse locale", async () => {
    const f = fixture();
    const deps: WebDependencies = {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      transport: vi.fn(),
    };
    const tool = webToolSpecs(deps, f.program).find((s) => s.name === "http_request");
    await expect(tool?.run({ method: "GET", url: URL_OK }, ctx)).rejects.toMatchObject({
      code: "web.invalidUrl",
    });
    expect(deps.transport).not.toHaveBeenCalled();
  });

  it("ne suit pas une redirection : rend le 3xx et Location", async () => {
    const f = fixture({
      responses: [() => reply(302, "", { location: "https://autre.example.net/x" })],
    });
    const out = parse(await f.http({ method: "GET", url: URL_OK }));
    expect(f.calls).toHaveLength(1);
    expect(out.status).toBe(302);
    expect(out.headers.location).toBe("https://autre.example.net/x");
  });

  it("rend statut, en-têtes, corps plafonné et durée", async () => {
    const big = "é".repeat(80_000);
    const f = fixture({ responses: [() => reply(200, big)] });
    const out = parse(await f.http({ method: "GET", url: URL_OK }));
    expect(out).toMatchObject({ status: 200, truncated: true });
    expect(out.headers["content-type"]).toBe("text/plain");
    expect(Buffer.byteLength(out.body)).toBeLessThanOrEqual(64 * 1024);
    expect(typeof out.durationMs).toBe("number");
  });
});

describe("http_request : rythme", () => {
  it("attend le créneau (≤ 90 s) puis envoie", async () => {
    const f = fixture();
    await f.http({ method: "GET", url: URL_OK });
    await f.http({ method: "GET", url: URL_OK });
    expect(f.sleeps).toEqual([1000]);
    expect(f.calls).toHaveLength(2);
  });

  it("au-delà de 90 s d'attente cumulée, rend program.paced avec retryAfterMs", async () => {
    const stub: PaceController = {
      ceilingRps: 1,
      acquire: () => ({ action: "wait", ms: 50_000 }),
      report: vi.fn(),
      resume: vi.fn(),
      status: () => ({ halted: false, rps: 1, pausedUntil: 0 }),
    };
    const f = fixture({ pace: stub });
    const error = await f.http({ method: "GET", url: URL_OK }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "program.paced",
      params: { host: "app.example.com", retryAfterMs: 50_000 },
    });
    expect(f.sleeps).toEqual([50_000]);
    expect(f.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_PACE_WAIT_MS);
    expect(f.calls).toHaveLength(0);
  });

  it("une attente unique supérieure à 90 s n'est pas dormie", async () => {
    const stub: PaceController = {
      ceilingRps: 1,
      acquire: () => ({ action: "wait", ms: 120_000 }),
      report: vi.fn(),
      resume: vi.fn(),
      status: () => ({ halted: false, rps: 1, pausedUntil: 0 }),
    };
    const f = fixture({ pace: stub });
    await expect(f.http({ method: "GET", url: URL_OK })).rejects.toMatchObject({
      code: "program.paced",
      params: { retryAfterMs: 120_000 },
    });
    expect(f.sleeps).toEqual([]);
  });

  it("l'attente est annulable", async () => {
    const abort = new AbortController();
    const f = fixture();
    const specs = webToolSpecs(f.deps, {
      ...f.program,
      sleep: (_ms, signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
          abort.abort(new Error("stop"));
        }),
    });
    const tool = specs.find((s) => s.name === "http_request");
    await tool?.run({ method: "GET", url: URL_OK }, ctx);
    await expect(
      tool?.run({ method: "GET", url: URL_OK }, { ...ctx, signal: abort.signal }),
    ).rejects.toThrow("stop");
  });

  it("un 429 divise le débit de l'hôte par deux, puis impose la pause de 60 s", async () => {
    const f = fixture({ responses: [() => reply(429, "slow down")] });
    const out = parse(await f.http({ method: "GET", url: URL_OK }));
    expect(out.status).toBe(429);
    expect(f.pace?.status("app.example.com").rps).toBeCloseTo(0.5);
    await f.http({ method: "GET", url: URL_OK });
    expect(f.sleeps).toEqual([60_000]);
  });

  it("403 d'un WAF (en-tête, serveur ou corps) ralentit ; un 403 ordinaire non", async () => {
    const f = fixture({
      responses: [() => reply(403, "Forbidden"), () => reply(403, "x", { server: "cloudflare" })],
    });
    await f.http({ method: "GET", url: URL_OK });
    expect(f.pace?.status("app.example.com").rps).toBe(1);
    await f.http({ method: "GET", url: URL_OK });
    expect(f.pace?.status("app.example.com").rps).toBeCloseTo(0.5);

    const g = fixture({
      responses: [() => reply(403, "<h1>Attention Required! | Cloudflare</h1>")],
    });
    await g.http({ method: "GET", url: URL_OK });
    expect(g.pace?.status("app.example.com").rps).toBeCloseTo(0.5);
  });

  it("un délai dépassé est rapporté comme timeout", async () => {
    const f = fixture();
    const slow = webToolSpecs(
      {
        lookup,
        transport: async () => {
          throw new TypeError("fetch failed", {
            cause: Object.assign(new Error("x"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
          });
        },
      },
      f.program,
    ).find((s) => s.name === "http_request");
    await expect(slow?.run({ method: "GET", url: URL_OK }, ctx)).rejects.toMatchObject({
      code: "web.timeout",
    });
    expect(f.pace?.status("app.example.com").rps).toBeCloseTo(0.5);
  });

  it("un arrêt bloque également les alias résolus sur le même edge", async () => {
    const f = fixture({
      responses: [() => reply(429), () => reply(429), () => reply(429)],
    });
    for (let i = 0; i < 3; i++) {
      await f.http({ method: "GET", url: URL_OK });
      f.advance(120_000);
    }
    await expect(f.http({ method: "GET", url: URL_OK })).rejects.toMatchObject({
      code: "program.halted",
      params: { host: "app.example.com" },
    });
    await expect(f.http({ method: "GET", url: "https://b.example.com/" })).rejects.toMatchObject({
      code: "program.halted",
    });
    expect(f.calls).toHaveLength(3);
  });
});

describe("registre de contrôleurs", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const setup = () => {
    const configDir = mkdtempSync(join(tmpdir(), "warband-pace-"));
    dirs.push(configDir);
    const projectId = randomUUID();
    let t = 1_000_000;
    const registry = createPaceRegistry({ configDir, projectId: () => projectId, now: () => t });
    const recorder = createRecorder();
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    registry.attach(recorder);
    return { configDir, projectId, registry, events, advance: (ms: number) => (t += ms) };
  };

  it("sans fiche : rythme Normal, alias par IP et arrêts persistés", () => {
    const s = setup();
    const web = createWebProgram({ program: () => ({ state: "none" }), registry: s.registry });
    expect(web.profile?.()).toBe("out-of-box");
    const pace = web.pace();
    expect(pace?.ceilingRps).toBe(createPaceController({ preset: "normal" }).ceilingRps);
    pace?.bind?.("a.example", ["203.0.113.7"]);
    pace?.bind?.("b.example", ["203.0.113.7"]);
    pace?.report("a.example", "http429");
    expect(pace?.status("b.example").pausedUntil).toBeGreaterThan(0);
    pace?.report("a.example", "http429");
    pace?.report("b.example", "http429");
    const restarted = createPaceRegistry({
      configDir: s.configDir,
      projectId: () => s.projectId,
    }).controller();
    expect(restarted?.acquire("b.example").action).toBe("halted");
  });

  it("journalise pace.adjusted et pace.halted ; l'arrêt est persisté et repris par clearPaceHalt", () => {
    const s = setup();
    const pace = s.registry.controller(sheet());
    expect(pace).not.toBeNull();
    expect(s.registry.controller(sheet())).toBe(pace);
    pace?.report("a.example.com", "http429");
    expect(s.events.map((e) => e.kind)).toEqual(["pace.adjusted"]);
    pace?.report("a.example.com", "http429");
    pace?.report("a.example.com", "http429");
    expect(s.events.map((e) => e.kind)).toEqual(["pace.adjusted", "pace.adjusted", "pace.halted"]);
    expect(haltedPaceHosts(s.configDir, s.projectId)).toEqual(["a.example.com"]);
    expect(pace?.acquire("a.example.com")).toEqual({ action: "halted" });

    // Reprise depuis un autre processus (CLI) : prise en compte à la décision suivante.
    expect(clearPaceHalt(s.configDir, s.projectId, "A.example.com")).toBe(true);
    expect(clearPaceHalt(s.configDir, s.projectId, "a.example.com")).toBe(false);
    expect(pace?.acquire("a.example.com").action).not.toBe("halted");
    expect(pace?.status("a.example.com").rps).toBeCloseTo(0.5);
  });

  it("relit les arrêts historiques et reprend tous les alias après redémarrage", () => {
    const s = setup();
    const path = projectPaceHaltedPath(s.configDir, s.projectId);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(["a.example.com"]));
    const pace = s.registry.controller(sheet());
    pace?.bind?.("a.example.com", ["203.0.113.1"]);
    pace?.bind?.("b.example.com", ["203.0.113.1"]);
    const next = createPaceRegistry({
      configDir: s.configDir,
      projectId: () => s.projectId,
    }).controller(sheet());
    expect(next?.acquire("b.example.com")).toEqual({ action: "halted" });
    expect(clearPaceHalt(s.configDir, s.projectId, "b.example.com")).toBe(true);
    expect(next?.acquire("a.example.com").action).not.toBe("halted");
    expect(haltedPaceHosts(s.configDir, s.projectId)).toEqual([]);
  });

  it("conserve la pause suspecte au redémarrage et la reprise CLI la lève", () => {
    const s = setup();
    const pace = s.registry.controller(sheet());
    pace?.bind?.("a.example.com", ["203.0.113.1"]);
    pace?.bind?.("b.example.com", ["203.0.113.1"]);
    pace?.report("a.example.com", "ok");
    pace?.report("a.example.com", "timeout");
    const next = createPaceRegistry({
      configDir: s.configDir,
      projectId: () => s.projectId,
      now: () => 1000000,
    }).controller(sheet());
    expect(next?.acquire("b.example.com")).toEqual({ action: "wait", ms: 300000 });
    expect(clearPaceHalt(s.configDir, s.projectId, "b.example.com")).toBe(true);
    expect(next?.acquire("a.example.com")).toEqual({ action: "send" });
  });

  it("sans projet actif, contrôleur éphémère Normal conservé pendant la session", () => {
    const registry = createPaceRegistry({ configDir: tmpdir(), projectId: () => null });
    expect(registry.controller()?.ceilingRps).toBe(
      createPaceController({ preset: "normal" }).ceilingRps,
    );
    expect(registry.controller()).toBe(registry.controller());
  });
});

describe("http_request : engagement facultatif, exclusions et arrêt d’urgence", () => {
  const engagement = parseEngagementSheet({
    version: 1,
    authorization: cited({ principal: "Exemple", reference: "RT-1", signatory: "Équipe test" }),
    window: cited({ text: "novembre 2026" }),
    inScope: cited(["*.example.com"]),
    infrastructure: cited([]),
    outOfScope: cited(["admin.example.com"]),
    rulesOfEngagement: cited("Pas de déni de service"),
    whiteTeam: cited({ contact: "white@example.com", deconfliction: "Appeler avant intervention" }),
    osintPolicy: cited("Sources publiques"),
  });

  it.each([false, true])("refuse une exclusion après approbation (Bypass %s)", async (enabled) => {
    const f = fixture({ profile: "out-of-box", sheet: undefined });
    const view = (): EngagementView => ({
      status: { state: "approved", applied: engagement },
      halted: false,
    });
    f.program.engagement = view;
    const bypass = createBypassSwitch({ now: Date.now });
    if (enabled) bypass.enable(60_000);
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder: createRecorder(),
      engagement: view,
      bypass,
      ask: async () => ({ decision: "allow" }),
    });
    const input = { method: "GET", url: "https://admin.example.com/" };
    expect(
      (
        await gate.decide(
          { toolUseId: "exclu", tool: HTTP_REQUEST_TOOL, input },
          new AbortController().signal,
        )
      ).decision,
    ).toBe("allow");
    await expect(f.http(input)).rejects.toMatchObject({ code: "engagement.out_of_scope" });
    expect(f.calls).toHaveLength(0);
  });

  it.each(["dns", "attente"])("arrêt pendant %s : aucun transport", async (stage) => {
    const f = fixture({ profile: "red-team", sheet: undefined });
    let halted = false;
    f.program.engagement = () => ({ status: { state: "approved", applied: engagement }, halted });
    if (stage === "attente") {
      await f.http({ method: "GET", url: URL_OK });
      f.calls.length = 0;
      f.program.sleep = async () => {
        halted = true;
      };
    } else {
      f.deps.lookup = async () => {
        halted = true;
        return lookup();
      };
    }
    await expect(f.http({ method: "GET", url: URL_OK })).rejects.toMatchObject({
      code: "engagement.halted",
    });
    expect(f.calls).toHaveLength(0);
  });
});

describe("read_url : redirections et périmètre", () => {
  it("mémorise seulement les cibles approuvées, les isole par projet et les retrouve au prochain moteur", async () => {
    const root = mkdtempSync(join(tmpdir(), "targets-"));
    try {
      let project = "a";
      const make = () =>
        createWebProgram({
          program: () => ({ state: "none" }),
          registry: createPaceRegistry({ configDir: root, projectId: () => null }),
          targetsFile: () => join(root, project, "target-hosts.json"),
        });
      const web = make();
      const recorder = createRecorder();
      web.attach?.(recorder);
      recorder.emit({
        kind: "tool.requested",
        toolUseId: "shell",
        tool: "mcp__exegol__exec",
        input: { argv: ["curl", "https://cible.example/"] },
      });
      recorder.emit({
        kind: "approval.decided",
        toolUseId: "shell",
        decision: "allow",
        source: "user",
        reason: { code: "approval.remembered" },
      });
      recorder.emit({
        kind: "tool.requested",
        toolUseId: "refus",
        tool: HTTP_REQUEST_TOOL,
        input: { url: "https://refuse.example/" },
      });
      recorder.emit({
        kind: "approval.decided",
        toolUseId: "refus",
        decision: "deny",
        source: "user",
        reason: { code: "approval.noAsker" },
      });
      expect(web.isTarget?.("cible.example")).toBe(true);
      expect(web.isTarget?.("refuse.example")).toBe(false);
      project = "b";
      expect(web.isTarget?.("cible.example")).toBe(false);
      project = "a";
      const next = make();
      expect(next.isTarget?.("cible.example")).toBe(true);
      const f = fixture({ sheet: undefined });
      const read = webToolSpecs(f.deps, next).find((tool) => tool.name === "read_url");
      expect(parse(await read!.run({ url: "https://cible.example/" }, ctx)).notes[0].code).toBe(
        "web.targetRead",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("une cible reçoit sa réponse nettoyée et la note ; une documentation reste lisible", async () => {
    const f = fixture({
      responses: [
        () =>
          reply(200, "<main>Page<script>secret()</script><input hidden value='x'></main>", {
            "content-type": "text/html",
          }),
      ],
    });
    const target = parse(await f.read(URL_OK));
    expect(target.text).toBe("Page");
    expect(target.notes[0]).toMatchObject({ code: "web.targetRead" });
    expect(target.notes[0].message).toContain("champs cachés");
    expect(parse(await f.read("https://docs.example.net/guide")).notes).toBeUndefined();
  });

  it.each([
    "https://r.jina.ai/https://app.example.com/",
    "https://r.jina.ai./https://app.example.com/",
    "https://corsproxy.io/?url=https%3A%2F%2Fapp.example.com%2F",
    "https://translate.google.com/translate?u=https%3A%2F%2Fapp.example.com%2F",
    "https://app-example-com.translate.goog/",
  ])("relais %s : refus avec fiche, note sans fiche", async (url) => {
    const approved = fixture();
    await expect(approved.read(url)).rejects.toMatchObject({ code: "web.relayRefused" });
    expect(approved.calls).toHaveLength(0);
    const general = fixture({ profile: "out-of-box", sheet: undefined });
    general.program.isTarget = (host) => host === "app.example.com";
    expect(parse(await general.read(url)).notes[0].code).toBe("web.relayDiscouraged");
    expect(general.calls).toHaveLength(1);
  });

  it("un relais de documentation et une URL documentaire qui cite la cible restent lisibles", async () => {
    const f = fixture();
    await f.read("https://r.jina.ai/https://docs.example.net/guide");
    await f.read("https://docs.example.net/?url=https://app.example.com/");
    expect(f.calls).toHaveLength(2);
  });

  it("un saut vers un relais est contrôlé avant de contacter le relais", async () => {
    const f = fixture({
      responses: [() => reply(302, "", { location: "https://r.jina.ai/https://app.example.com/" })],
    });
    await expect(f.read("https://docs.example.net/")).rejects.toMatchObject({
      code: "web.relayRefused",
    });
    expect(f.calls).toHaveLength(1);
  });
  it("un hôte du périmètre qui redirige hors périmètre échoue", async () => {
    const f = fixture({
      responses: [() => reply(302, "", { location: "https://hors-perimetre.example.net/" })],
    });
    await expect(f.read("https://app.example.com/page")).rejects.toMatchObject({
      code: "web.redirectOffList",
      params: { host: "hors-perimetre.example.net" },
    });
    expect(f.calls).toHaveLength(1);
  });

  it("une redirection vers un autre hôte du périmètre ou une source de référence passe", async () => {
    const f = fixture({
      responses: [
        () => reply(302, "", { location: "https://b.example.com/" }),
        () => reply(302, "", { location: "https://github.com/x" }),
        () => reply(200, "fin"),
      ],
    });
    const out = parse(await f.read("https://app.example.com/page"));
    expect(out.url).toBe("https://github.com/x");
  });

  it("sans fiche appliquée, l'hôte n'est pas restreint (comportement antérieur)", async () => {
    const f = fixture({
      sheet: undefined,
      responses: [
        () => reply(302, "", { location: "https://hors-perimetre.example.net/" }),
        () => reply(200, "ok"),
      ],
    });
    const out = parse(await f.read("https://app.example.com/page"));
    expect(out.url).toBe("https://hors-perimetre.example.net/");
  });
});

it("la limite DNS ne raccourcit pas le transport après l’attente de rythme", async () => {
  const output = await requestRaw(
    "https://example.test/",
    {
      method: "GET",
      signal: new AbortController().signal,
      timeoutMs: 1,
      beforeRequest: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    },
    { lookup, transport: async () => reply(200, "ok") },
  );
  expect(output.status).toBe(200);
});

it("sauvegarde 200 Kio minifiés et read_output trouve une chaîne au milieu", async () => {
  const root = mkdtempSync(join(tmpdir(), "http-output-"));
  try {
    const body = "é".repeat(50000) + "MIDDLE_SENTINEL" + "é".repeat(50000) + "TAIL_END";
    const f = fixture({
      responses: [() => reply(200, body, { "content-type": "application/javascript" })],
    });
    f.program.outputRoot = () => root;
    const result = JSON.parse(await f.http({ method: "GET", url: URL_OK }));
    expect(result.bodyFile).toMatch(/warband-http-.*body.txt$/);
    expect(result.note).toContain("read_output");
    expect(result.truncated).toBe(true);
    expect(result.body).toContain("TAIL_END");
    const local = result.bodyFile.replace("/workspace/outputs", root);
    expect(readFileSync(local, "utf8")).toBe(body);
    const read = outputFileSpecs(() => root)[0];
    const found = JSON.parse(
      await read!.run({ path: result.splitFile, pattern: "MIDDLE_SENTINEL" }, ctx),
    );
    expect(found.matchCount).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("réinitialise la colonne du fichier découpé sur chaque retour à la ligne existant", async () => {
  const root = mkdtempSync(join(tmpdir(), "http-lines-"));
  try {
    const body = `${"a".repeat(190)}\n${"b".repeat(20)},${"c".repeat(2100)}`;
    const f = fixture({
      responses: [() => reply(200, body, { "content-type": "application/javascript" })],
    });
    f.program.outputRoot = () => root;
    const result = parse(await f.http({ method: "GET", url: URL_OK }));
    const split = readFileSync(result.splitFile.replace("/workspace/outputs", root), "utf8");
    expect(split.startsWith(`${"a".repeat(190)}\n${"b".repeat(20)},${"c".repeat(1979)}\n`)).toBe(
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("read_url refuse plus de 1 Mio alors que http_request accepte cette taille", async () => {
  const body = "x".repeat(1024 * 1024 + 1);
  const f = fixture({ responses: [() => reply(200, body), () => reply(200, body)] });
  await expect(f.read(URL_OK)).rejects.toMatchObject({ code: "web.tooLarge" });
  const result = parse(await f.http({ method: "GET", url: URL_OK }));
  expect(result.status).toBe(200);
  expect(result.bytes).toBe(Buffer.byteLength(body));
});
it("ne sauvegarde pas une réponse HTTP courte et lisible", async () => {
  const root = mkdtempSync(join(tmpdir(), "http-short-"));
  try {
    const f = fixture();
    f.program.outputRoot = () => root;
    const result = JSON.parse(await f.http({ method: "GET", url: URL_OK }));
    expect(result.bodyFile).toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("http_request utilise les jetons et conserve les cookies dans la session choisie", async () => {
  const f = fixture({
    responses: [
      () => ({
        ...reply(200),
        setCookies: ["sid=abc123; Path=/; Secure", "other=def456; Path=/; Secure"],
      }),
      () => reply(200),
    ],
  });
  const accounts = createTestAccounts([
    {
      label: "A",
      host: "",
      identifier: "test@example.com",
      secret: "jeton-test",
      kind: "password",
    },
  ]);
  const tool = webToolSpecs(f.deps, f.program, accounts).find((s) => s.name === "http_request");
  if (!tool) throw new Error("outil absent");
  await tool.run(
    {
      method: "POST",
      url: URL_OK,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "login={{compte:A:identifiant}}&pass={{compte:A:secret}}",
      session: "A",
    },
    ctx,
  );
  await tool.run({ method: "GET", url: URL_OK, session: "A" }, ctx);
  expect(f.calls[0]?.init.body).toContain("login=test%40example.com");
  expect(f.calls[0]?.init.body).toContain("pass=jeton-test");
  expect(f.calls[1]?.init.headers?.cookie).toContain("sid=abc123");
  expect(f.calls[1]?.init.headers?.cookie).toContain("other=def456");
});
