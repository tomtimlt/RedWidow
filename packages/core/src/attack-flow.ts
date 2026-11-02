import { randomUUID } from "node:crypto";
import { type Finding, MITRE_TACTICS, TECHNIQUE_PATTERN } from "./exegol/findings.js";
import { createRedactor, secretsFromEnv } from "./redact.js";

export interface AttackFlowObject {
  type: string;
  id: string;
  [key: string]: unknown;
}

export interface AttackFlowBundle {
  type: "bundle";
  id: string;
  objects: AttackFlowObject[];
}

const EXTENSION = "extension-definition--fb9c968a-745b-4ade-9b25-c324172197f4";
// Définition officielle Attack Flow 2.0.0 (licence Apache-2.0).
const OFFICIAL: AttackFlowObject[] = [
  {
    type: "extension-definition",
    id: "extension-definition--fb9c968a-745b-4ade-9b25-c324172197f4",
    spec_version: "2.1",
    name: "Attack Flow",
    description: "Extends STIX 2.1 with features to create Attack Flows.",
    created: "2022-08-02T19:34:35.143Z",
    modified: "2022-08-02T19:34:35.143Z",
    created_by_ref: "identity--d673f8cb-c168-42da-8ed4-0cb26725f86c",
    schema:
      "https://center-for-threat-informed-defense.github.io/attack-flow/stix/attack-flow-schema-2.0.0.json",
    version: "2.0.0",
    extension_types: ["new-sdo"],
    external_references: [
      {
        source_name: "Documentation",
        description: "Documentation for Attack Flow",
        url: "https://center-for-threat-informed-defense.github.io/attack-flow",
      },
      {
        source_name: "GitHub",
        description: "Source code repository for Attack Flow",
        url: "https://github.com/center-for-threat-informed-defense/attack-flow",
      },
    ],
  },
  {
    type: "identity",
    spec_version: "2.1",
    id: "identity--d673f8cb-c168-42da-8ed4-0cb26725f86c",
    created_by_ref: "identity--d673f8cb-c168-42da-8ed4-0cb26725f86c",
    created: "2022-08-02T19:34:35.143Z",
    modified: "2022-08-02T19:34:35.143Z",
    name: "MITRE Center for Threat-Informed Defense",
    identity_class: "organization",
  },
];

/** Exporte uniquement les étapes marquées confirmées et les liens du chemin retenu.
 * Les annotations from seules ne prouvent aucune succession d'actions.
 * Un export sans étape confirmée est impossible : start_refs doit être non vide.
 */
export function buildAttackFlow(
  project: { id: string; name: string },
  findings: Finding[],
  date: Date,
): AttackFlowBundle {
  const timestamp = date.toISOString();
  const steps = findings.filter((f) => f.kind === "step" && f.state === "confirmed");
  if (!steps.length) throw new Error("attack-flow.no-confirmed-steps");
  if (new Set(findings.map((f) => f.id)).size !== findings.length)
    throw new Error("attack-flow.duplicate-finding-id");
  const excluded = findings.filter((f) => f.kind === "credential" || f.kind === "loot");
  const redact = createRedactor({ values: [...secretsFromEnv(), ...excluded.map((f) => f.label)] });
  const creator = `identity--${randomUUID()}`;
  const common = {
    spec_version: "2.1",
    created: timestamp,
    modified: timestamp,
    created_by_ref: creator,
  };
  const custom = { ...common, extensions: { [EXTENSION]: { extension_type: "new-sdo" } } };
  const actions = new Map(
    steps.map((f) => [
      f.id,
      {
        ...custom,
        type: "attack-action",
        id: `attack-action--${randomUUID()}`,
        name: redact(f.label),
        ...(f.tactic && MITRE_TACTICS.includes(f.tactic) ? { tactic_id: f.tactic } : {}),
        ...(f.technique && TECHNIQUE_PATTERN.test(f.technique)
          ? { technique_id: f.technique }
          : {}),
      } as AttackFlowObject,
    ]),
  );
  const assets = new Map<string, AttackFlowObject>();
  const targets = new Set<string>();
  let omittedLinks = 0;
  for (const step of steps) {
    const action = actions.get(step.id);
    if (!action) continue;
    for (const parent of new Set(step.pathFrom ?? [])) {
      const previous = actions.get(parent);
      if (!previous || !step.from?.includes(parent) || parent === step.id) {
        omittedLinks++;
        continue;
      }
      previous.effect_refs ??= [];
      const refs = previous.effect_refs as string[];
      refs.push(action.id);
      targets.add(action.id);
    }
    for (const parent of new Set(step.from ?? [])) {
      const finding = findings.find((f) => f.id === parent);
      if (finding?.state === "confirmed" && (finding.kind === "host" || finding.kind === "site")) {
        if (!assets.has(parent))
          assets.set(parent, {
            ...custom,
            type: "attack-asset",
            id: `attack-asset--${randomUUID()}`,
            name: redact(finding.label),
          });
        const asset = assets.get(parent);
        if (asset) {
          action.asset_refs ??= [];
          (action.asset_refs as string[]).push(asset.id);
        }
      } else if (!step.pathFrom?.includes(parent)) omittedLinks++;
    }
  }
  const starts = [...actions.values()].filter((a) => !targets.has(a.id)).map((a) => a.id);
  // Un cycle ne permet pas de déduire un point de départ observé.
  if (!starts.length) throw new Error("attack-flow.no-start-action");
  const omitted = findings.length - actions.size - assets.size;
  const flow: AttackFlowObject = {
    ...custom,
    type: "attack-flow",
    id: `attack-flow--${randomUUID()}`,
    name: redact(project.name),
    scope: "other",
    start_refs: starts,
    description:
      "Étapes marquées confirmées uniquement ; liens causaux limités au chemin retenu. Les hypothèses, échecs, credentials et loot sont omis.",
    x_warband_omitted: { findings: omitted, links: omittedLinks },
  };
  return {
    type: "bundle",
    id: `bundle--${randomUUID()}`,
    objects: [
      ...structuredClone(OFFICIAL),
      { ...common, type: "identity", id: creator, name: "Venator Ops", identity_class: "system" },
      flow,
      ...actions.values(),
      ...assets.values(),
    ],
  };
}

export const exportAttackFlow = buildAttackFlow;
