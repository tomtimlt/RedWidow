import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  isRememberable,
  type Policy,
  READ_URL_TOOL,
  SEARCH_WEB_TOOL,
  webArgumentGuard,
  webToolSpecs,
} from "../src/index.js";
import type { WebDependencies, WebResponse } from "../src/web/network.js";

const read = (url: string, policy: Policy = DEFAULT_POLICY) =>
  evaluatePolicy(policy, READ_URL_TOOL, { url });
const search = (query: string, policy: Policy = DEFAULT_POLICY) =>
  evaluatePolicy(policy, SEARCH_WEB_TOOL, { query });

describe("politique des outils web (ADR 0039)", () => {
  it("search_web est autorisé par défaut", () => {
    expect(search("CVE-2024-1234 solr rce").decision).toBe("allow");
  });

  it.each([
    "https://nvd.nist.gov/vuln/detail/CVE-2024-1234",
    "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
    "https://docs.github.com/en/rest",
    "https://arxiv.org/abs/2401.00001",
    "https://www.exploit-db.com/exploits/12345",
    "https://portswigger.net/web-security/sql-injection",
  ])("read_url vers %s est autorisé (web.reference_source)", (url) => {
    const v = read(url);
    expect(v.decision).toBe("allow");
    expect(v.reason.code).toBe("web.reference_source");
  });

  it.each([
    "https://example.com/page",
    "https://nvd.nist.gov.evil.tld/x",
    "https://evilnvd.nist.gov/x",
    "https://evil.tld/nvd.nist.gov",
    "https://github.com.evil.tld/",
    "http://nvd.nist.gov/vuln",
    "https://nvd.nist.gov:8443/vuln",
    "https://user:pw@nvd.nist.gov/",
    "https://myuser.github.io/",
    "pas une url",
  ])("read_url vers %s reste ask", (url) => {
    expect(read(url).decision).toBe("ask");
  });

  it("un deny de la politique ou du dépôt reste prioritaire", () => {
    const deny: Policy = {
      default: "ask",
      rules: [{ tool: "mcp__web__*", decision: "deny" }],
    };
    expect(read("https://nvd.nist.gov/x", deny).decision).toBe("deny");
    expect(search("solr", deny).decision).toBe("deny");
    const denyRead: Policy = {
      ...DEFAULT_POLICY,
      rules: [...DEFAULT_POLICY.rules, { tool: READ_URL_TOOL, decision: "deny" }],
    };
    expect(read("https://nvd.nist.gov/x", denyRead).decision).toBe("deny");
    const denySearch: Policy = {
      ...DEFAULT_POLICY,
      rules: [...DEFAULT_POLICY.rules, { tool: SEARCH_WEB_TOOL, decision: "deny" }],
    };
    expect(search("solr", denySearch).decision).toBe("deny");
  });

  it("une règle ask explicite n'est pas promue", () => {
    const ask: Policy = { default: "ask", rules: [{ tool: READ_URL_TOOL, decision: "ask" }] };
    expect(read("https://nvd.nist.gov/x", ask).decision).toBe("ask");
  });
});

describe("garde d'arguments web", () => {
  const sensitive = [
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "password=hunter2hunter2",
    "valeur [REDACTED] interne",
    "admin 192.168.1.10 login",
    "10.0.0.5",
    "127.0.0.1",
    "fe80::1",
  ];

  it.each(sensitive)("search_web « %s » repasse en ask non mémorisable", (query) => {
    expect(webArgumentGuard(SEARCH_WEB_TOOL, { query })).not.toBeNull();
    const v = search(query);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("web.query_sensitive");
    expect(isRememberable({ toolUseId: "t", tool: SEARCH_WEB_TOOL, input: { query } }, v)).toBe(
      false,
    );
  });

  it.each([
    "https://nvd.nist.gov/vuln?q=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "https://nvd.nist.gov/x?token=abcdef123456",
    "https://nvd.nist.gov/x?q=%67hp_abcdefghijklmnopqrstuvwxyz0123456789",
    "https://github.com/10.0.0.5/repo",
    "https://nvd.nist.gov/x?host=192.168.0.1",
    "https://intranet.github.com.corp/",
  ])("read_url %s : ask non mémorisable même vers une référence", (url) => {
    const v = read(url);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("web.query_sensitive");
    expect(isRememberable({ toolUseId: "t", tool: READ_URL_TOOL, input: { url } }, v)).toBe(false);
  });

  it("une requête ordinaire et une IP publique passent", () => {
    expect(
      webArgumentGuard(SEARCH_WEB_TOOL, { query: "Solr 8.11 PHP ModSecurity CRS bypass 8.8.8.8" }),
    ).toBeNull();
    expect(webArgumentGuard("Read", { query: "10.0.0.5" })).toBeNull();
  });

  it("la gate redemande à chaque appel et ne mémorise pas la réponse", async () => {
    let asked = 0;
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder: createRecorder(),
      ask: async () => {
        asked++;
        return { decision: "allow", remember: "session" };
      },
    });
    const signal = new AbortController().signal;
    const input = { query: "scan 10.0.0.5" };
    for (const id of ["a", "b"]) {
      const out = await gate.decide({ toolUseId: id, tool: SEARCH_WEB_TOOL, input }, signal);
      expect(out.decision).toBe("allow");
    }
    expect(asked).toBe(2);
  });
});

describe("durcissements de la revue (ADR 0039)", () => {
  it("normalise la casse et le point final de l'hôte", () => {
    expect(read("HTTPS://NVD.NIST.GOV./x").decision).toBe("allow");
  });

  it.each([
    "https://xn--nvd-nist-gov-9a.example/x",
    "https://xn--vd-nist-gov.nist.gov.evil.tld/",
    "https://[::1]/",
    "https://8.8.8.8/",
  ])("%s n'est pas promu", (url) => {
    expect(read(url).decision).toBe("ask");
  });

  it("default deny sans règle reste deny", () => {
    const strict: Policy = { default: "deny", rules: [] };
    expect(read("https://nvd.nist.gov/x", strict).decision).toBe("deny");
    expect(search("solr", strict).decision).toBe("deny");
  });

  it("une règle allow de dépôt sur read_url avec secret dans l'URL repasse en ask", () => {
    const allow: Policy = { default: "ask", rules: [{ tool: READ_URL_TOOL, decision: "allow" }] };
    const v = read("https://example.com/x?token=abcdef123456", allow);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("web.query_sensitive");
  });

  it("l'IP privée précédée d'un point est détectée", () => {
    const v = read("https://github.com/x.10.0.0.5");
    expect(v.reason.code).toBe("web.query_sensitive");
  });

  it("sous Bypass, web.query_sensitive est approuvé sans mémorisation", async () => {
    const bypass = createBypassSwitch({ now: () => 0 });
    bypass.enable(60_000);
    let asked = 0;
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder: createRecorder(),
      ask: async () => {
        asked++;
        return { decision: "deny" };
      },
      bypass,
      now: () => 0,
    });
    const signal = new AbortController().signal;
    const input = { query: "scan 10.0.0.5" };
    for (const id of ["a", "b"]) {
      const out = await gate.decide({ toolUseId: id, tool: SEARCH_WEB_TOOL, input }, signal);
      expect(out.decision).toBe("allow");
      expect(out.source).toBe("bypass");
      expect(out.reason.code).toBe("approval.bypassed");
      expect(out.reason.cause?.code).toBe("web.query_sensitive");
    }
    expect(asked).toBe(0);
  });
});

describe("redirections de read_url depuis une source de référence", () => {
  const html = (text: string, status = 200, headers: Record<string, string> = {}): WebResponse => ({
    status,
    headers: { "content-type": "text/html", ...headers },
    body: (async function* () {
      yield Buffer.from(text);
    })(),
  });
  const run = (location: string, url = "https://nvd.nist.gov/x") => {
    const seen: string[] = [];
    const deps: WebDependencies = {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      transport: async (u) => {
        seen.push(u.href);
        return seen.length === 1
          ? html("", 302, { location })
          : html("<html><body><main>ok</main></body></html>");
      },
    };
    const tool = webToolSpecs(deps).find((t) => t.name === "read_url");
    return {
      seen,
      call: () => tool?.run({ url }, { parentId: null, correlation: undefined, signal: undefined }),
    };
  };

  it("refuse un saut hors liste avec web.redirectOffList", async () => {
    const r = run("https://evil.example/leak");
    await expect(r.call()).rejects.toMatchObject({
      code: "web.redirectOffList",
      params: { host: "evil.example" },
    });
    expect(r.seen).toHaveLength(1);
  });

  it("accepte une redirection interne à la liste", async () => {
    const r = run("https://github.com/advisories/x");
    await expect(r.call()).resolves.toContain("ok");
  });

  it("ne restreint pas une URL hors liste (approuvée par l'utilisateur)", async () => {
    const r = run("https://other.example/y", "https://example.com/x");
    await expect(r.call()).resolves.toContain("ok");
  });
});
