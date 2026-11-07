import { AGENT_PROFILES, MCP_CATALOG } from "@warband/core";
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import {
  applyCapabilityToggle,
  type CapabilitySettings,
  capabilitySettings,
  emptySelection,
  parseCapabilityToggle,
} from "../src/logic/chat-capabilities.js";

const skill = Object.keys(AGENT_PROFILES)[0] as string;
const mcp = MCP_CATALOG[0]?.id as string;
const base = (): CapabilitySettings => ({
  providers: ["claude"],
  skills: [],
  integrations: [],
  webSearch: false,
});
/** Rejoue les écritures comme le fait l'hôte : le réglage `chat.*` est relu ensuite. */
const persist = (
  caps: CapabilitySettings,
  writes: { key: string; value: unknown }[],
): CapabilitySettings => {
  const store = new Map(writes.map((w) => [w.key, w.value]));
  return capabilitySettings((key) => {
    if (store.has(key)) return store.get(key);
    const k = key.replace("chat.", "") as keyof CapabilitySettings;
    return caps[k];
  });
};

describe("bascule des capacités du chat", () => {
  it("active puis désactive un skill et persiste dans chat.skills", () => {
    const on = applyCapabilityToggle(base(), emptySelection(), {
      kind: "skill",
      id: skill,
      enabled: true,
    });
    expect(on?.selection.profile).toBe(skill);
    expect(on?.writes).toEqual([{ key: "chat.skills", value: [skill] }]);
    const caps = persist(base(), on?.writes ?? []);
    expect(caps.skills).toEqual([skill]);
    const off = applyCapabilityToggle(caps, on?.selection ?? emptySelection(), {
      kind: "skill",
      id: skill,
      enabled: false,
    });
    expect(off?.selection.profile).toBeNull();
    expect(persist(caps, off?.writes ?? []).skills).toEqual([]);
  });

  it("active puis désactive un connecteur MCP et Burp dans chat.integrations", () => {
    let caps = base();
    let selection = emptySelection();
    for (const toggle of [
      { kind: "integration", id: mcp, enabled: true },
      { kind: "burp", enabled: true },
    ] as const) {
      const r = applyCapabilityToggle(caps, selection, toggle);
      caps = persist(caps, r?.writes ?? []);
      selection = r?.selection ?? selection;
    }
    expect(caps.integrations).toEqual([mcp, "burp"]);
    expect(selection).toMatchObject({ integrations: [mcp], burp: true });
    for (const toggle of [
      { kind: "integration", id: mcp, enabled: false },
      { kind: "burp", enabled: false },
    ] as const) {
      const r = applyCapabilityToggle(caps, selection, toggle);
      caps = persist(caps, r?.writes ?? []);
      selection = r?.selection ?? selection;
    }
    expect(caps.integrations).toEqual([]);
    expect(selection).toMatchObject({ integrations: [], burp: false });
  });

  it("active puis désactive la recherche web dans chat.webSearch, sans écriture inutile", () => {
    const on = applyCapabilityToggle(base(), emptySelection(), {
      kind: "webSearch",
      enabled: true,
    });
    expect(on?.writes).toEqual([{ key: "chat.webSearch", value: true }]);
    expect(persist(base(), on?.writes ?? []).webSearch).toBe(true);
    const off = applyCapabilityToggle(
      { ...base(), webSearch: true },
      on?.selection ?? emptySelection(),
      {
        kind: "webSearch",
        enabled: false,
      },
    );
    expect(off?.writes).toEqual([{ key: "chat.webSearch", value: false }]);
    expect(off?.selection.webSearch).toBe(false);
    expect(
      applyCapabilityToggle(base(), emptySelection(), { kind: "webSearch", enabled: false })
        ?.writes,
    ).toEqual([]);
  });

  it("refuse un cinquième connecteur dans une conversation", () => {
    const ids = MCP_CATALOG.slice(0, 5).map((m) => m.id);
    const selection = { ...emptySelection(), integrations: ids.slice(0, 4) };
    expect(
      applyCapabilityToggle(base(), selection, {
        kind: "integration",
        id: ids[4] as string,
        enabled: true,
      }),
    ).toBeNull();
  });

  it("valide le message webview : type, identifiant connu, booléen", () => {
    expect(
      parseWebviewMessage({ type: "setCapability", kind: "skill", id: skill, enabled: true }),
    ).toEqual({ type: "setCapability", toggle: { kind: "skill", id: skill, enabled: true } });
    expect(parseWebviewMessage({ type: "setCapability", kind: "burp", enabled: false })).toEqual({
      type: "setCapability",
      toggle: { kind: "burp", enabled: false },
    });
    for (const raw of [
      { type: "setCapability", kind: "skill", id: "inconnu", enabled: true },
      { type: "setCapability", kind: "integration", id: skill, enabled: true },
      { type: "setCapability", kind: "skill", id: skill, enabled: "true" },
      { type: "setCapability", kind: "skill", id: skill },
      { type: "setCapability", kind: "skill", enabled: true },
      { type: "setCapability", kind: "provider", id: "claude", enabled: true },
      { type: "setCapability", kind: "burp", id: "burp", enabled: true },
      { type: "setCapability", kind: "webSearch", enabled: true, token: "secret" },
      { type: "setCapability", enabled: true },
    ])
      expect(parseWebviewMessage(raw)).toBeNull();
    expect(parseCapabilityToggle(null)).toBeNull();
    expect(parseCapabilityToggle([])).toBeNull();
  });
});
