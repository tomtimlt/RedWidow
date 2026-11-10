import { expect, it } from "vitest";
import { createRecorder } from "../src/recorder.js";
import { analyzeTrace } from "../src/trace/analyze.js";

it("mesure trois chemins dérivés et deux génériques sans utiliser les sorties futures", () => {
  const r = createRecorder();
  const events = [
    r.emit({
      kind: "tool.result",
      toolUseId: "initial",
      isError: false,
      truncated: false,
      bytes: 30,
      output: "Routes : /orders /checkout /profile",
    }),
    ...["/orders", "/checkout", "/profile", "/.env", "/robots.txt"].map((path, i) =>
      r.emit({
        kind: "tool.requested",
        toolUseId: `http-${i}`,
        tool: "mcp__web__http_request",
        input: { method: "GET", url: `https://example.test${path}` },
      }),
    ),
    r.emit({
      kind: "tool.result",
      toolUseId: "later",
      isError: false,
      truncated: false,
      bytes: 10,
      output: "Routes : /.env /robots.txt",
    }),
  ];
  const report = analyzeTrace(events);
  expect(report.web.derivation).toMatchObject({ derived: 3, generic: 2, percent: 60 });
  expect(report.web.derivation.genericPaths).toEqual([
    { path: "/.env", calls: 1 },
    { path: "/robots.txt", calls: 1 },
  ]);
  expect(report.web.derivation.techniqueFamilies.length).toBeGreaterThan(1);
});

it("ignore les racines et reconnaît un nom de fichier déjà observé", () => {
  const r = createRecorder();
  const events = [
    r.emit({
      kind: "tool.result",
      toolUseId: "page",
      isError: false,
      truncated: false,
      bytes: 10,
      output: "Script console.js",
    }),
    ...[
      "https://a.test/",
      "https://b.test/?scan=1",
      "https://a.test/assets/console.js",
      "https://a.test/unknown.js",
    ].map((url, i) =>
      r.emit({
        kind: "tool.requested",
        toolUseId: `req-${i}`,
        tool: "mcp__web__http_request",
        input: { url },
      }),
    ),
  ];
  const report = analyzeTrace(events);
  expect(report.web.derivation).toMatchObject({ derived: 1, generic: 1, percent: 50 });
  expect(report.web.derivation.genericPaths).toEqual([{ path: "/unknown.js", calls: 1 }]);
});

it("exclut trois sondes génériques distinctes de premier niveau, mais garde les sondes isolées", () => {
  const r = createRecorder();
  const events = [
    r.emit({
      kind: "tool.result",
      toolUseId: "page",
      isError: false,
      truncated: false,
      bytes: 7,
      output: "/orders",
    }),
    ...[
      "/isolated",
      "/orders",
      "/admin",
      "/backup",
      "/config",
      "/api/unknown",
      "/repeat",
      "/repeat",
      "/repeat",
    ].map((path, i) =>
      r.emit({
        kind: "tool.requested",
        toolUseId: `req-${i}`,
        tool: "mcp__web__http_request",
        input: { url: `https://example.test${path}` },
      }),
    ),
  ];
  const report = analyzeTrace(events);
  expect(report.web.derivation).toMatchObject({ derived: 1, generic: 5, percent: 17 });
  expect(report.web.derivation.genericPaths).toEqual(
    expect.arrayContaining([
      { path: "/isolated", calls: 1 },
      { path: "/api/unknown", calls: 1 },
      { path: "/repeat", calls: 3 },
    ]),
  );
  expect(report.web.derivation.genericPaths.map((entry) => entry.path)).not.toContain("/admin");
});
