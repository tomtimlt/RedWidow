import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPaceHalt,
  createPaceController,
  createPaceRegistry,
  createRecorder,
  type EngineEvent,
  haltedPaceHosts,
  MAX_PACE_WAIT_MS,
  outputFileSpecs,
  type PaceController,
  type ProgramSheet,
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

  it("sans projet actif, pas de contrôleur", () => {
    const registry = createPaceRegistry({ configDir: tmpdir(), projectId: () => null });
    expect(registry.controller(sheet())).toBeNull();
  });
});

describe("read_url : redirections et périmètre", () => {
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
    const body = "x".repeat(100000) + "MIDDLE_SENTINEL" + "y".repeat(100000);
    const f = fixture({
      responses: [() => reply(200, body, { "content-type": "application/javascript" })],
    });
    f.program.outputRoot = () => root;
    const result = JSON.parse(await f.http({ method: "GET", url: URL_OK }));
    expect(result.bodyFile).toMatch(/warband-http-.*body.txt$/);
    expect(result.note).toContain("read_output");
    expect(result.truncated).toBe(true);
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
