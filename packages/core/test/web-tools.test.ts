import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { webNetworkError } from "../src/web/errors.js";
import {
  isPublicAddress,
  requestWeb,
  type WebDependencies,
  type WebResponse,
  webTransport,
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
  it.each(["GET", "POST"] as const)(
    "transmet %s par un proxy HTTP sans CONNECT en gardant l'IP épinglée et le Host d'origine",
    async (method) => {
      const received: { url: string | undefined; host: string | undefined; body: string }[] = [];
      let tunnels = 0;
      const proxy = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        received.push({ url: request.url, host: request.headers.host, body });
        if (request.url?.endsWith("/private")) {
          response.writeHead(302, { location: "http://127.0.0.1/secret" });
        } else response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
      });
      proxy.on("connect", (_request, socket) => {
        tunnels++;
        socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
      });
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`);
      vi.stubEnv("NO_PROXY", "");
      const init = {
        method,
        signal: AbortSignal.timeout(3000),
        ...(method === "POST" && { body: '{"query":"test"}' }),
      };
      try {
        expect(
          await requestWeb("http://public.invalid:8080/page?q=test", init, { lookup }),
        ).toMatchObject({ text: "ok" });
        expect(received).toEqual([
          {
            url: "http://8.8.8.8:8080/page?q=test",
            host: "public.invalid:8080",
            body: method === "POST" ? '{"query":"test"}' : "",
          },
        ]);
        await expect(
          requestWeb("http://public.invalid/private", init, { lookup }),
        ).rejects.toMatchObject({ code: "web.invalidUrl" });
        expect(received).toHaveLength(2);
        expect(tunnels).toBe(0);
      } finally {
        proxy.closeAllConnections();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
        vi.unstubAllEnvs();
      }
    },
  );
  it("ferme les vrais corps HTTP non lus sans erreur non gérée et conserve le diagnostic", async () => {
    vi.stubEnv("NO_PROXY", "*");
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/ok", "content-type": "text/plain" });
        response.end("redirection");
      } else if (request.url === "/limited") {
        response.writeHead(429, { "content-type": "text/plain" });
        response.end("quota");
      } else if (request.url === "/binary") {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end("binary");
      } else {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://public.example:${(server.address() as AddressInfo).port}`;
    // La résolution publique reste contrôlée dans requestWeb ; seul le
    // transport de ce test route le serveur local, sans accès réseau extérieur.
    const deps: WebDependencies = {
      lookup,
      transport: (url, _address, init) => webTransport(url, "127.0.0.1", init),
    };
    try {
      for (const [path, code] of [
        ["/limited", "web.rateLimited"],
        ["/binary", "web.unsupportedType"],
      ])
        await expect(
          requestWeb(root + path, { method: "GET", signal: AbortSignal.timeout(2000) }, deps),
        ).rejects.toMatchObject({ code });
      expect(
        await requestWeb(
          root + "/redirect",
          { method: "GET", signal: AbortSignal.timeout(2000) },
          deps,
        ),
      ).toMatchObject({ text: "ok" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });
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
      [response("", 429), "web.rateLimited"],
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
  it.each([
    ["ENOTFOUND", "web.dnsFailed"],
    ["EAI_AGAIN", "web.dnsFailed"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "web.tlsFailed"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "web.tlsFailed"],
    ["UND_ERR_CONNECT_TIMEOUT", "web.timeout"],
    ["ECONNRESET", "web.connectionFailed"],
    ["UND_ERR_ABORTED", "web.connectionFailed"],
    ["ENETUNREACH", "web.connectionFailed"],
  ])("rend un diagnostic réseau sûr pour %s", async (code, expected) => {
    const raw = Object.assign(new Error("proxy https://login:secret@proxy.invalid?token=private"), {
      code,
    });
    const tool = webToolSpecs({
      lookup,
      transport: async () => {
        throw new TypeError("fetch failed", { cause: raw });
      },
    })[0];
    const error = await tool?.run({ query: "test" }, context).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: expected });
    expect(JSON.stringify(error)).not.toMatch(/login|secret|private|proxy.invalid/);
  });

  it("reconnaît les erreurs agrégées, borne les cycles et ne déduit rien d’un message brut", () => {
    expect(
      webNetworkError(
        new AggregateError([Object.assign(new Error("secret"), { code: "ECONNREFUSED" })]),
      ).code,
    ).toBe("web.connectionFailed");
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(webNetworkError(cyclic).code).toBe("web.unavailable");
    expect(webNetworkError(new Error("ENOTFOUND token=secret")).code).toBe("web.unavailable");
    expect(webNetworkError(new Error("secret"), true)).toMatchObject({
      code: "web.timeout",
      params: { seconds: 25 },
    });
  });

  it("préserve l’annulation demandée par l’utilisateur", async () => {
    const abort = new AbortController();
    const stop = new Error("arrêt demandé");
    abort.abort(stop);
    const tool = webToolSpecs({ lookup, transport: vi.fn() })[0];
    await expect(tool?.run({ query: "test" }, { ...context, signal: abort.signal })).rejects.toBe(
      stop,
    );
  });
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
