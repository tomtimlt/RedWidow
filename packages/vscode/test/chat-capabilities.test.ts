import { MCP_CATALOG } from "@warband/core";
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import {
  allowedSelection,
  capabilitySettings,
  emptySelection,
  parseChatSelection,
  providerChoices,
  selectedSettings,
} from "../src/logic/chat-capabilities.js";
import { parseToEngine } from "../src/logic/protocol.js";
import { type ChatSettings, parseConfiguredIntegrations } from "../src/logic/settings.js";
import { parseStudioMessage } from "../src/logic/studio.js";

describe("ressources du chat : configuration, activation et choix distincts", () => {
  const config: ChatSettings = {
    providerCatalog: [{ id: "google", name: "Google Gemini", connected: true }],
    capabilities: {
      providers: ["claude", "google"],
      skills: ["mentor"],
      integrations: ["playwright", "burp"],
      webSearch: true,
    },
    integrations: [
      { id: "playwright", port: 9877, transport: "http", path: "/mcp" },
      { id: "semgrep", port: 9878, transport: "sse", path: "/sse" },
    ],
    burp: { port: 9876, transport: "sse" },
    profile: "htb",
  };
  it("les nouvelles conversations n’attachent aucun connecteur ni méthode configurée", () => {
    expect(selectedSettings(config, emptySelection())).toMatchObject({
      integrations: [],
      webSearch: false,
    });
    expect(selectedSettings(config, emptySelection())).not.toHaveProperty("burp");
    expect(selectedSettings(config, emptySelection())).not.toHaveProperty("profile");
  });
  it("l’hôte intersecte chaque choix avec les activations et la configuration actuelle", () => {
    const chosen = {
      profile: "mentor",
      integrations: ["playwright", "semgrep"],
      burp: true,
      webSearch: true,
    };
    expect(allowedSelection(config, chosen)).toEqual({ ...chosen, integrations: ["playwright"] });
    const actual = selectedSettings(config, chosen);
    expect(actual.integrations?.map((m) => m.id)).toEqual(["playwright"]);
    expect(actual.profile).toBe("mentor");
    const disabled = {
      ...config,
      capabilities: { providers: [], skills: [], integrations: [], webSearch: false },
    };
    expect(allowedSelection(disabled, chosen)).toEqual(emptySelection());
    expect(config.integrations).toHaveLength(2);
    expect(config.burp).toBeDefined();
  });
  it("les fournisseurs désactivés et inconnus ne deviennent pas des routes", () => {
    expect(providerChoices(config).map((p) => [p.id, p.backend, p.prefix])).toEqual([
      ["claude", "claude", undefined],
      ["google", "opencode", "google/"],
    ]);
    expect(
      providerChoices({ ...config, capabilities: capabilitySettings(() => ["unknown"]) }),
    ).toEqual([]);
    expect(capabilitySettings(() => undefined).skills).toContain("htb");
    expect(capabilitySettings(() => "invalid").providers).toEqual([]);
  });
  it("refuse les sélections forgées, doublons, champs supplémentaires et messages secrets", () => {
    for (const raw of [
      null,
      {},
      { ...emptySelection(), token: "secret" },
      { ...emptySelection(), profile: "forged" },
      { ...emptySelection(), integrations: ["playwright", "playwright"] },
      { ...emptySelection(), integrations: MCP_CATALOG.slice(0, 5).map((m) => m.id) },
    ])
      expect(parseChatSelection(raw)).toBeNull();
    expect(parseWebviewMessage({ type: "setSelection", selection: emptySelection() })).toEqual({
      type: "setSelection",
      selection: emptySelection(),
    });
    expect(
      parseWebviewMessage({ type: "selectProvider", id: "google", apiKey: "secret" }),
    ).toBeNull();
    expect(
      parseStudioMessage({ type: "configureProvider", id: "google", key: "secret" }),
    ).toBeNull();
    expect(
      parseStudioMessage({ type: "setCapability", kind: "web", id: "search", enabled: true }),
    ).toEqual({ type: "setCapability", kind: "web", id: "search", enabled: true });
  });
  it("conserve tous les connecteurs configurés, tout en bornant le démarrage à quatre", () => {
    const configured = MCP_CATALOG.map((m, i) => ({
      id: m.id,
      port: 9900 + i,
      transport: "http",
      path: "/mcp",
    }));
    expect(parseConfiguredIntegrations(configured)).toHaveLength(MCP_CATALOG.length);
    expect(parseConfiguredIntegrations([...configured, configured[0]])).toBeNull();
    expect(
      parseToEngine({ v: 1, type: "start", cwd: "/workspace", integrations: configured }),
    ).toMatchObject({ ok: false });
    expect(
      parseToEngine({ v: 1, type: "start", cwd: "/workspace", webSearch: false }),
    ).toMatchObject({ ok: true });
    expect(
      parseToEngine({ v: 1, type: "start", cwd: "/workspace", webSearch: "false" }),
    ).toMatchObject({ ok: false });
  });
});

it("rétablit OpenCode et route tous les fournisseurs découverts", () => {
  const settings = {
    capabilities: capabilitySettings(() => undefined),
    providerCatalog: [
      { id: "opencode", name: "OpenCode Zen", connected: true },
      { id: "github-copilot", name: "GitHub Copilot", connected: false },
      { id: "deepseek", name: "DeepSeek", connected: false },
    ],
  };
  expect(providerChoices(settings).some((p) => p.id === "opencode" && !p.prefix)).toBe(true);
  expect(providerChoices(settings, false).find((p) => p.id === "oc-github-copilot")).toMatchObject({
    backend: "opencode",
    runtimeId: "github-copilot",
    prefix: "github-copilot/",
    connected: false,
  });
  expect(providerChoices(settings, false).find((p) => p.id === "oc-opencode")).toMatchObject({
    prefix: "opencode/",
  });
});
