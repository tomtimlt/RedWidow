import { AGENT_PROFILES, MCP_CATALOG } from "@warband/core";
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import {
  applyCapabilityToggle,
  type CapabilitySettings,
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
describe("bascule des capacités du chat", () => {
  it("isole les méthodes et respecte leur disponibilité machine", () => {
    const caps = { ...base(), skills: [skill] };
    const autre = emptySelection();
    const on = applyCapabilityToggle(caps, autre, { kind: "skill", id: skill, enabled: true });
    expect(on?.selection.profile).toBe(skill);
    expect(on?.writes).toEqual([]);
    const off = applyCapabilityToggle(caps, on!.selection, {
      kind: "skill",
      id: skill,
      enabled: false,
    });
    expect(off?.selection.profile).toBeNull();
    expect(off?.writes).toEqual([]);
    expect(caps.skills).toEqual([skill]);
    expect(autre).toEqual(emptySelection());
    expect(
      applyCapabilityToggle(base(), autre, { kind: "skill", id: skill, enabled: true }),
    ).toBeNull();
  });

  it("conserve l’activation machine des connecteurs et de la recherche", () => {
    for (const [toggle, key, value] of [
      [{ kind: "integration", id: mcp, enabled: true }, "chat.integrations", [mcp]],
      [{ kind: "burp", enabled: true }, "chat.integrations", ["burp"]],
      [{ kind: "webSearch", enabled: true }, "chat.webSearch", true],
    ] as const) {
      expect(applyCapabilityToggle(base(), emptySelection(), toggle)?.writes).toEqual([
        { key, value },
      ]);
    }
  });

  it("refuse un cinquième connecteur dans une conversation", () => {
    const ids = MCP_CATALOG.slice(0, 5).map((m) => m.id);
    const selection = { ...emptySelection(), integrations: ids.slice(0, 4) };
    expect(
      applyCapabilityToggle({ ...base(), integrations: ids }, selection, {
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
