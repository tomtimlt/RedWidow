import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAttackFlow } from "../src/attack-flow.js";
import type { Finding } from "../src/exegol/findings.js";

const date = new Date("2026-10-30T12:00:00.000Z");
const findings: Finding[] = [
  { id: "host", kind: "host", state: "confirmed", label: "Serveur" },
  {
    id: "first",
    kind: "step",
    state: "confirmed",
    label: "Reconnaissance",
    tactic: "TA0007",
    technique: "T1046",
    from: ["host"],
  },
  {
    id: "second",
    kind: "step",
    state: "confirmed",
    label: "Exécution",
    from: ["first", "secret"],
    pathFrom: ["first", "secret"],
  },
  { id: "secret", kind: "credential", state: "confirmed", label: "secret ultra privé" },
  { id: "loot", kind: "loot", state: "confirmed", label: "données secrètes" },
  {
    id: "maybe",
    kind: "step",
    state: "hypothesis",
    label: "Hypothèse",
    from: ["first"],
    pathFrom: ["first"],
  },
  { id: "failed", kind: "step", state: "failed", label: "Échec" },
];
const bundle = () => buildAttackFlow({ id: "project", name: "Mission" }, findings, date);

describe("export Attack Flow", () => {
  it("conserve seulement les actions confirmées, actifs et chemin retenu", () => {
    const result = bundle();
    const actions = result.objects.filter((o) => o.type === "attack-action");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      tactic_id: "TA0007",
      technique_id: "T1046",
      effect_refs: [actions[1]?.id],
    });
    expect(result.objects.filter((o) => o.type === "attack-asset")).toHaveLength(1);
    expect(result.objects.find((o) => o.type === "attack-flow")).toMatchObject({
      start_refs: [actions[0]?.id],
      x_warband_omitted: { findings: 4 },
    });
    expect(JSON.stringify(result)).not.toContain("secret ultra privé");
    expect(JSON.stringify(result)).not.toContain("données secrètes");
    const ids = new Set(result.objects.map((o) => o.id));
    for (const object of result.objects) {
      expect(object.id).toMatch(
        /^[a-z-]+--[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      for (const key of ["effect_refs", "asset_refs", "start_refs"]) {
        for (const ref of (object[key] ?? []) as string[]) expect(ids.has(ref)).toBe(true);
      }
      if (object.created_by_ref) expect(ids.has(object.created_by_ref as string)).toBe(true);
    }
  });

  it("ne transforme pas from en effet et refuse un flux vide", () => {
    const result = buildAttackFlow(
      { id: "p", name: "p" },
      findings.map((f) => ({ ...f, pathFrom: [] })),
      date,
    );
    expect(
      result.objects.filter((o) => o.type === "attack-action").every((o) => !o.effect_refs),
    ).toBe(true);
    expect(() => buildAttackFlow({ id: "p", name: "p" }, [], date)).toThrow(
      "attack-flow.no-confirmed-steps",
    );
  });

  it("omet les liens invalides et masque les secrets dans les libellés exportés", () => {
    const result = buildAttackFlow(
      { id: "p", name: "password=private-value" },
      [
        {
          id: "one",
          kind: "step",
          state: "confirmed",
          label: "token=private-token",
          from: [],
          pathFrom: ["missing"],
        },
        {
          id: "two",
          kind: "step",
          state: "confirmed",
          label: "suite",
          from: ["one"],
          pathFrom: ["missing"],
        },
      ],
      date,
    );
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(
      result.objects.filter((o) => o.type === "attack-action").every((o) => !o.effect_refs),
    ).toBe(true);
  });

  it("refuse les identifiants ambigus et les cycles sans entrée observée", () => {
    const step: Finding = { id: "s", kind: "step", state: "confirmed", label: "test" };
    expect(() => buildAttackFlow({ id: "p", name: "p" }, [step, step], date)).toThrow(
      "attack-flow.duplicate-finding-id",
    );
    expect(() =>
      buildAttackFlow(
        { id: "p", name: "p" },
        [
          { ...step, id: "a", from: ["b"], pathFrom: ["b"] },
          { ...step, id: "b", from: ["a"], pathFrom: ["a"] },
        ],
        date,
      ),
    ).toThrow("attack-flow.no-start-action");
  });

  const python = spawnSync("python", ["-c", "import jsonschema, referencing"], {
    encoding: "utf8",
  });
  it.skipIf(python.status !== 0)(
    "valide réellement les SDO avec le schéma officiel et ses références STIX",
    () => {
      const schema = JSON.parse(
        readFileSync(new URL("fixtures/attack-flow-schema-2.0.0.json", import.meta.url), "utf8"),
      );
      const stix = JSON.parse(
        readFileSync(new URL("fixtures/attack-flow-schema-stix.json", import.meta.url), "utf8"),
      );
      const directory = mkdtempSync(join(tmpdir(), "warband-attack-flow-"));
      const input = join(directory, "input.json");
      writeFileSync(input, JSON.stringify({ schema, stix, bundle: bundle() }));
      const result = spawnSync(
        "python",
        [
          "-c",
          `
import json, sys
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
payload = json.load(open(sys.argv[1]))
registry = Registry()
for schema in payload['stix'].values():
    registry = registry.with_resource(schema['$id'], Resource.from_contents(schema))
validator = Draft202012Validator(payload['schema'], registry=registry, format_checker=FormatChecker())
for obj in payload['bundle']['objects']:
    if obj['type'].startswith('attack-'):
        validator.validate(obj)
`,
          input,
        ],
        {
          timeout: 15000,
          encoding: "utf8",
        },
      );
      rmSync(directory, { recursive: true, force: true });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    },
  );
});
