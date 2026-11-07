import { describe, expect, it } from "vitest";
import { createMissionDesk } from "../src/mission-desk.js";
import { createRecorder } from "../src/recorder.js";
import { detectTechnologies, researchTriggers } from "../src/research-triggers.js";
import { READ_URL_TOOL, SEARCH_WEB_TOOL } from "../src/web/guard.js";

const out = (output: string, isError = false, tool = "bash") => ({
  tool,
  input: "{}",
  output,
  isError,
});
const web = (input: string, tool = SEARCH_WEB_TOOL) => ({
  tool,
  input,
  output: "résultats",
  isError: false,
});
const codes = (events: Parameters<typeof researchTriggers>[0]["events"], webToolsExposed = false) =>
  researchTriggers({ events, webToolsExposed }).map((r) => r.code);

describe("détection des technologies", () => {
  it("lit les en-têtes, la balise generator et les chaînes nom/version", () => {
    expect(
      detectTechnologies("HTTP/1.1 200 OK\nServer: nginx/1.18.0\nX-Powered-By: PHP/7.4.3"),
    ).toEqual([
      { name: "nginx", version: "1.18.0" },
      { name: "PHP", version: "7.4.3" },
    ]);
    expect(detectTechnologies('<meta name="generator" content="WordPress 6.4.2">')).toEqual([
      { name: "WordPress", version: "6.4.2" },
    ]);
    expect(detectTechnologies("banner: OpenSSH/8.9.1 ready")).toEqual([
      { name: "OpenSSH", version: "8.9.1" },
    ]);
  });
  it("ignore les clients et les chemins", () => {
    expect(detectTechnologies("User-Agent: Mozilla/5.0 curl/8.1.2 /usr/lib/python/3.11.2")).toEqual(
      [],
    );
  });
});

describe("déclencheurs de recherche", () => {
  it("(a) technologie identifiée sans recherche, puis couverte par une requête ou une URL", () => {
    const seen = out("Server: Jetty/9.4.2");
    expect(researchTriggers({ events: [seen], webToolsExposed: false })).toEqual([
      { code: "research.techUnsearched", params: { tech: "Jetty", version: "9.4.2" } },
    ]);
    const nginx = out("Server: nginx/1.18.0");
    expect(codes([nginx, web('{"query":"nginx 1.18.0 CVE"}')])).toEqual([]);
    expect(
      codes([nginx, web('{"url":"https://nginx.org/en/security_advisories.html"}', READ_URL_TOOL)]),
    ).toEqual([]);
    // Une recherche sur autre chose ne couvre pas ; une recherche antérieure non plus.
    expect(codes([nginx, web('{"query":"waf bypass"}')])).toEqual(["research.techUnsearched"]);
    expect(codes([web('{"query":"nginx"}'), nginx])).toEqual(["research.techUnsearched"]);
  });
  it("(b) même erreur au moins deux fois", () => {
    const e = out("connection refused 10.0.0.1:8080", true);
    expect(codes([e])).toEqual([]);
    expect(researchTriggers({ events: [e, e], webToolsExposed: false })).toEqual([
      { code: "research.repeatedError", params: { tool: "bash", count: 2 } },
    ]);
    expect(codes([e, e, web('{"query":"connection refused"}')])).toEqual([]);
  });
  it("(c) 403 et WAF répétés", () => {
    const w = out("HTTP/1.1 403 Forbidden");
    expect(codes([w])).toEqual([]);
    expect(
      researchTriggers({ events: [w, out("blocked by ModSecurity")], webToolsExposed: false }),
    ).toEqual([{ code: "research.blocked", params: { count: 2 } }]);
  });
  it("(d) aucune recherche alors que les outils web sont exposés", () => {
    expect(codes([out("ok")], true)).toEqual(["research.noSearch"]);
    expect(codes([out("ok")], false)).toEqual([]);
    expect(codes([out("ok"), web("{}", READ_URL_TOOL)], true)).toEqual([]);
  });
});

function fixture() {
  const recorder = createRecorder({ runId: "run", redact: false });
  const desk = createMissionDesk({ recorder });
  let n = 0;
  const call = (tool: string, input: Record<string, unknown>, output: string, isError = false) => {
    const toolUseId = `c${n++}`;
    const requested = recorder.emit({ kind: "tool.requested", toolUseId, tool, input });
    const result = recorder.emit({
      kind: "tool.result",
      toolUseId,
      output,
      isError,
      truncated: false,
      bytes: output.length,
    });
    return { requested, result };
  };
  return { recorder, desk, call };
}
const decision = {
  objective: "Conclure sur le service",
  evidenceIds: [] as string[],
  nextAction: "Clôturer la branche",
  successCriterion: "Rien à relever",
};
const claim = (evidenceIds: string[], extra: object = {}) => ({
  objective: "Tester",
  target: "http://cible",
  testContext: "",
  method: "curl",
  observed: "rien",
  conclusion: "not-observed" as const,
  evidenceIds,
  ...extra,
});
const NGINX = { code: "research.techUnsearched", params: { tech: "nginx", version: "1.18.0" } };

describe("relances et sources dans le bureau de mission", () => {
  it("expose les relances et les recherches dans mission_context, sans bloquer", () => {
    const f = fixture();
    f.call("bash", { cmd: "curl -I" }, "Server: nginx/1.18.0");
    const search = f.call(SEARCH_WEB_TOOL, { query: "autre sujet" }, "{}");
    expect(f.desk.context().research.triggers).toEqual([NGINX]);
    expect(f.desk.context().research.searches).toMatchObject([
      { eventId: search.result.id, tool: SEARCH_WEB_TOOL, target: "autre sujet" },
    ]);
    f.call(SEARCH_WEB_TOOL, { query: "nginx 1.18.0 vulnérabilités" }, "{}");
    expect(f.desk.context().research.triggers).toEqual([]);
  });
  it("renvoie les relances avec un test négatif ou une clôture, pas avec un constat", () => {
    const f = fixture();
    const obs = f.call("bash", {}, "Server: nginx/1.18.0");
    expect(f.desk.recordTest(claim([obs.result.id])).research).toEqual([NGINX]);
    expect(
      f.desk.recordTest(claim([obs.result.id], { conclusion: "finding" })).research,
    ).toBeUndefined();
    expect(f.desk.recordDecision({ ...decision, evidenceIds: [obs.result.id] }).research).toEqual([
      NGINX,
    ]);
    expect(
      f.desk.recordDecision({ ...decision, nextAction: "Lire la version", objective: "Vérifier" })
        .research,
    ).toBeUndefined();
  });
  it("accepte des sources web du run et refuse les autres", () => {
    const f = fixture();
    const obs = f.call("bash", {}, "ok");
    const page = f.call(READ_URL_TOOL, { url: "https://nvd.nist.gov/x" }, '{"text":"cve"}');
    const ok = f.desk.recordTest(
      claim([obs.result.id], { sources: [page.result.id, page.requested.id] }),
    );
    expect(ok.eventId).toBeTruthy();
    f.desk.recordDecision({ ...decision, evidenceIds: [obs.result.id], sources: [page.result.id] });
    // Inconnue, ou événement non web du run : refus codé.
    for (const sources of [["inconnue"], [obs.result.id]]) {
      expect(() => f.desk.recordTest(claim([obs.result.id], { sources }))).toThrowError(
        expect.objectContaining({ code: "mission.sourceUnknown" }),
      );
      expect(() => f.desk.recordDecision({ ...decision, sources })).toThrowError(
        expect.objectContaining({ code: "mission.sourceUnknown" }),
      );
    }
  });
  it("détecte l'exposition des outils web par session.started", () => {
    const f = fixture();
    f.call("bash", {}, "ok");
    expect(f.desk.context().research.triggers).toEqual([]);
    f.recorder.emit({
      kind: "session.started",
      sessionId: "s",
      model: "m",
      tools: [SEARCH_WEB_TOOL],
    });
    expect(f.desk.context().research.triggers).toEqual([{ code: "research.noSearch" }]);
  });
});
