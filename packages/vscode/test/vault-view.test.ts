import { newKeyId, type Vault } from "@warband/core";
import { describe, expect, it } from "vitest";
import { vaultView } from "../src/logic/vault-view.js";

const SENTINEL = "sk-SENTINELLE-ne-doit-jamais-sortir-123456";
const ADDED = "2026-11-16T10:00:00.000Z";

describe("vue du coffre pour la webview", () => {
  const vault: Vault = {
    keys: [
      { id: newKeyId(), value: SENTINEL, addedAt: ADDED, state: "active" },
      {
        id: newKeyId(),
        label: "perso",
        value: `${SENTINEL}-2`,
        addedAt: ADDED,
        state: "exhausted",
        cooldownUntil: "2026-11-16T13:00:00.000Z",
      },
      { id: newKeyId(), value: `${SENTINEL}-3`, addedAt: ADDED, state: "invalid" },
    ],
  };

  it("ne contient aucune valeur : la sentinelle est absente du JSON, et aucun champ value", () => {
    const view = vaultView(vault);
    expect(JSON.stringify(view)).not.toContain("SENTINELLE");
    for (const entry of view) expect(Object.keys(entry)).not.toContain("value");
  });

  it("rang, libellé, empreinte, état et délai", () => {
    const view = vaultView(vault);
    expect(view.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(view[0]).not.toHaveProperty("label");
    expect(view[1]).toMatchObject({
      label: "perso",
      state: "exhausted",
      cooldownUntil: "2026-11-16T13:00:00.000Z",
    });
    expect(view[2]?.state).toBe("invalid");
    for (const entry of view) expect(entry.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});
