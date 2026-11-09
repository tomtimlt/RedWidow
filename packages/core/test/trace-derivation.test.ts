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
