import { describe, expect, it, vi } from "vitest";
import {
  isPublicAddress,
  requestWeb,
  type WebDependencies,
  type WebResponse,
  webUrl,
} from "../src/web/network.js";
import { pageContent, searchContent, webToolSpecs } from "../src/web/tools.js";

const context = { parentId: null, correlation: undefined, signal: undefined };
function response(
  text: string,
  status = 200,
  headers: Record<string, string> = { "content-type": "text/html" },
): WebResponse {
  return {
    status,
    headers,
    body: (async function* () {
      yield Buffer.from(text);
    })(),
  };
}
const lookup = async () => [{ address: "8.8.8.8", family: 4 }];

describe("destinations des outils web", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.169.254",
    "100.100.100.200",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])("refuse l’adresse non publique %s", (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "accepte l’adresse publique %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/a",
    "http://user:pass@example.com",
    "http://2130706433",
    "http://127.1",
    "https://[::ffff:127.0.0.1]/",
    "n’importe quoi",
  ])("refuse URL/protocole trompeur %s", (url) => expect(() => webUrl(url)).toThrow());
  it("refuse un nom résolu vers une IP privée, même avec une IP publique dans la réponse DNS", async () => {
    const transport = vi.fn();
    await expect(
      requestWeb(
        "https://metadata.example",
        { method: "GET", signal: AbortSignal.timeout(1000) },
        {
          transport,
          lookup: async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "169.254.169.254", family: 4 },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "web.invalidUrl" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("épingle l’adresse validée et recontrôle les redirections sans requête privée", async () => {
    const close = vi.fn(async () => {});
    const transport = vi.fn(async (_url, address) => {
      expect(address).toBe("8.8.8.8");
      return { ...response("", 302, { location: "http://127.0.0.1/private" }), close };
    });
    await expect(
      requestWeb(
        "https://example.com",
        { method: "GET", signal: AbortSignal.timeout(1000) },
        { lookup, transport },
      ),
    ).rejects.toMatchObject({ code: "web.invalidUrl" });
    expect(transport).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it("suit un lien relatif public et refuse une boucle de redirection bornée", async () => {
    const transport = vi.fn(async (url: URL) =>
      url.pathname === "/" ? response("", 302, { location: "/page" }) : response("bonjour"),
    );
    const result = await requestWeb(
      "https://example.com",
      { method: "GET", signal: AbortSignal.timeout(1000) },
      { lookup, transport },
    );
    expect(result.url).toBe("https://example.com/page");
    expect(result.text).toBe("bonjour");
    const loop = vi.fn(async () => response("", 302, { location: "/loop" }));
    await expect(
      requestWeb(
        "https://example.com",
        { method: "GET", signal: AbortSignal.timeout(1000) },
        { lookup, transport: loop },
      ),
    ).rejects.toMatchObject({ code: "web.unavailable" });
    expect(loop).toHaveBeenCalledTimes(6);
  });
  it("respecte l’annulation pendant DNS et ne lance aucune requête tardive", async () => {
    const abort = new AbortController();
    let release!: (value: { address: string; family: number }[]) => void;
    const waiting = new Promise<{ address: string; family: number }[]>((resolve) => {
      release = resolve;
    });
    const transport = vi.fn();
    const pending = requestWeb(
      "https://example.com",
      { method: "GET", signal: abort.signal },
      { lookup: () => waiting, transport },
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    release([{ address: "8.8.8.8", family: 4 }]);
    await Promise.resolve();
    expect(transport).not.toHaveBeenCalled();
  });
  it("borne la lecture, refuse les binaires et ferme la réponse même en erreur", async () => {
    for (const [reply, code] of [
      [response("x".repeat(1024 * 1024 + 1)), "web.tooLarge"],
      [response("bin", 200, { "content-type": "application/octet-stream" }), "web.unsupportedType"],
      [response("", 429), "web.unavailable"],
    ] as const) {
      const close = vi.fn(async () => {});
      await expect(
        requestWeb(
          "https://example.com",
          { method: "GET", signal: AbortSignal.timeout(1000) },
          { lookup, transport: async () => ({ ...reply, close }) },
        ),
      ).rejects.toMatchObject({ code });
      expect(close).toHaveBeenCalledOnce();
    }
  });
});

describe("lecture et recherche communes aux moteurs", () => {
  it("extrait le contenu, les entités et les liens sans script ni navigation", () => {
    const html =
      '<html><head><title>Doc &amp; outils</title></head><body><nav>MENU</nav><article><h1>Outil</h1><p>Version &lt;2&gt;</p><script>secret()</script><a href="/release">Release</a><a href="javascript:bad()">non</a><a href="/release">doublon</a></article></body></html>';
    const page = pageContent(html, "https://example.com/docs");
    expect(page.title).toBe("Doc & outils");
    expect(page.text).toContain("Version <2>");
    expect(page.text).not.toContain("secret()");
    expect(page.text).not.toContain("MENU");
    expect(page.links).toEqual([{ title: "Release", url: "https://example.com/release" }]);
    expect(
      pageContent(`<article>${"x".repeat(20_000)}</article>`, "https://example.com").truncated,
    ).toBe(true);
  });
  it("traite JSON et SSE Exa, sans accepter erreurs ou mauvais identifiant", () => {
    const data = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "Title: Exemple\nURL: https://example.com" }] },
    };
    expect(searchContent(JSON.stringify(data))).toContain("https://example.com");
    expect(searchContent(`event: message\ndata: ${JSON.stringify(data)}\n\n`)).toContain(
      "https://example.com",
    );
    for (const bad of [
      { ...data, id: 2 },
      { id: 1, result: { isError: true, content: [] } },
      { id: 1, error: { message: "privé" } },
    ])
      expect(() => searchContent(JSON.stringify(bad))).toThrow();
  });
  it("expose seulement recherche/lecture, valide les champs et transmet la requête bornée", async () => {
    const transport = vi.fn(async (_url: URL, _address: string, init) => {
      const body = JSON.parse(init.body ?? "{}");
      expect(body.params.arguments.query).toBe("outils GitHub");
      expect(body.params.arguments.numResults).toBe(3);
      return response(
        JSON.stringify({
          id: 1,
          result: {
            content: [
              { type: "text", text: "Title: Test\nURL: https://github.com/example/project" },
            ],
          },
        }),
        200,
        { "content-type": "application/json" },
      );
    });
    const specs = webToolSpecs({ lookup, transport } as WebDependencies);
    expect(specs.map((spec) => spec.name)).toEqual(["search_web", "read_url"]);
    expect(specs.every((spec) => spec.readOnly)).toBe(true);
    const search = specs[0];
    if (!search) throw new Error("absent");
    const result = JSON.parse(
      await search.run({ query: "outils GitHub", max_results: 3 }, context),
    );
    expect(result.provider).toBe("Exa");
    expect(result.text).toContain("github.com");
    expect(Date.parse(result.retrievedAt)).not.toBeNaN();
    const before = transport.mock.calls.length;
    for (const input of [
      { query: "" },
      { query: "x", max_results: 9 },
      { query: "x", headers: { Authorization: "secret" } },
    ])
      await expect(search.run(input, context)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(before);
  });
  it("conserve l’URL finale et les dates dans le résultat de lecture", async () => {
    const read = webToolSpecs({
      lookup,
      transport: async () =>
        response("# README\n```python\n    print('indentation')\n```", 200, {
          "content-type": "text/plain",
        }),
    })[1];
    if (!read) throw new Error("absent");
    const result = JSON.parse(
      await read.run({ url: "https://github.com/example/project" }, context),
    );
    expect(result.url).toBe("https://github.com/example/project");
    expect(result.text).toContain("\n    print('indentation')\n");
    expect(result.truncated).toBe(false);
  });
});
