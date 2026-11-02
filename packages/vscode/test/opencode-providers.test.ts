import { describe, expect, it } from "vitest";
import { parseOpencodeProviders } from "../src/logic/opencode-providers.js";
import { parseToEngine } from "../src/logic/protocol.js";
import { resolveSettings } from "../src/logic/settings.js";

const fixture = () => ({
  "venator-local": {
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: "http://127.0.0.1:11434/v1" },
    models: { "modele-utilisateur": { name: "Local", tool_call: true } },
  },
});

describe("fournisseurs OpenCode explicites", () => {
  it("accepte un endpoint local ou HTTPS sans secret et conserve les modèles déclarés", () => {
    const providers = fixture();
    expect(parseOpencodeProviders(providers)).toEqual(providers);
    providers["venator-local"].options.baseURL = "https://model.example/v1";
    expect(
      resolveSettings((key) => (key === "opencodeProviders" ? providers : undefined))
        .opencodeProviders,
    ).toEqual(providers);
  });
  it.each([
    "https://user:secret@model.example/v1",
    "https://model.example/v1?key=secret",
    "https://model.example/v1#secret",
    "file:///tmp/model",
    "{env:ENDPOINT}",
    "https://model.example/{file:secret}",
  ])("refuse la destination %s", (baseURL) => {
    const providers = fixture();
    providers["venator-local"].options.baseURL = baseURL;
    expect(parseOpencodeProviders(providers)).toBeNull();
  });
  it.each([
    (p: Record<string, unknown>) => {
      p.google = p["venator-local"];
    },
    (p: Record<string, unknown>) => {
      (p["venator-local"] as Record<string, unknown>).npm = "paquet-arbitraire";
    },
    (p: Record<string, unknown>) => {
      (p["venator-local"] as Record<string, unknown>).apiKey = "secret";
    },
    (p: Record<string, unknown>) => {
      (p["venator-local"] as Record<string, unknown>).permission = { "*": "allow" };
    },
    (p: Record<string, unknown>) => {
      (p["venator-local"] as Record<string, unknown>).models = {
        m: { provider: { npm: "arbitraire" } },
      };
    },
    (p: Record<string, unknown>) => {
      (p["venator-local"] as Record<string, unknown>).models = {
        m: { limit: { context: -1, output: 1 } },
      };
    },
  ])("refuse les surcharges hors contrat %#", (mutate) => {
    const providers = fixture();
    mutate(providers);
    expect(parseOpencodeProviders(providers)).toBeNull();
    expect(() =>
      resolveSettings((key) => (key === "opencodeProviders" ? providers : undefined)),
    ).toThrow();
  });
  it("valide l'IPC du catalogue et du tour et refuse un autre moteur", () => {
    const opencodeProviders = fixture();
    for (const type of ["models", "start"]) {
      const message = { v: 1, type, cwd: "/tmp", provider: "opencode", opencodeProviders };
      expect(parseToEngine(message).ok).toBe(true);
      expect(parseToEngine({ ...message, provider: "openai" }).ok).toBe(false);
      expect(parseToEngine({ ...message, opencodeProviders: { google: {} } }).ok).toBe(false);
    }
  });
  it("borne le nombre et la taille des modèles", () => {
    const providers = fixture();
    const many = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`m${i}`, {}]));
    expect(
      parseOpencodeProviders({ "venator-many": { ...providers["venator-local"], models: many } }),
    ).toBeNull();
    expect(
      parseOpencodeProviders({
        "venator-large": { ...providers["venator-local"], models: { ["a".repeat(257)]: {} } },
      }),
    ).toBeNull();
  });
});

it.each(["modèle unicode", "modele avec espace", "x".repeat(195)])(
  "refuse un ID incompatible avec le sélecteur : %s",
  (id) => {
    const provider = fixture()["venator-local"];
    expect(
      parseOpencodeProviders({ "venator-local": { ...provider, models: { [id]: {} } } }),
    ).toBeNull();
  },
);
