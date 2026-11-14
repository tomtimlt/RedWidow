import type { EngineController } from "@warband/vscode/logic/controller";
import { describe, expect, it, vi } from "vitest";
import { framePrefsKey, parseChatDefaults } from "../src/bridge/defaults.js";
import { tokenSecretKey } from "../src/bridge/deps.js";
import { poolSecretKey, poolStateKey } from "../src/bridge/rotation.js";
import { fakeController, type Msg, setup, shellOf, useStorage } from "./bridge-helpers.js";

const ctx = useStorage();
const MODEL = "provider/test-model";

/** Contrôleur factice dont le catalogue est celui du test. */
const withModels =
  (values: string[]) =>
  (options: Parameters<typeof fakeController>[0]): EngineController => {
    const { ctl } = fakeController(options);
    return {
      ...ctl,
      models: async () => values.map((value) => ({ value, displayName: value })),
    } as EngineController;
  };

/** Retire le jeton Claude posé par `useStorage` : seul le serveur configuré par le test a des clés. */
async function noClaude() {
  await ctx.storage.secrets.delete(tokenSecretKey("claude"));
}

async function opencodeKey() {
  await ctx.storage.secrets.set(tokenSecretKey("opencode"), "cle-opencode-de-test");
}

function chat(t: ReturnType<typeof setup>, frame = "c1") {
  const s = shellOf(t);
  s.say("chat", frame, { type: "ready" });
  return s;
}

const lastView = (s: ReturnType<typeof shellOf>): Msg =>
  (s.of("chat", "view").at(-1)?.msg.view ?? {}) as Msg;
const controls = (s: ReturnType<typeof shellOf>) => (lastView(s).controls ?? {}) as Msg;

describe("parseChatDefaults", () => {
  it("accepte un fournisseur connu et un modèle borné", () => {
    expect(
      parseChatDefaults({ REDWIDOW_DEFAULT_PROVIDER: " OpenCode ", REDWIDOW_DEFAULT_MODEL: MODEL }),
    ).toEqual({ provider: "opencode", model: MODEL });
  });
  it("ignore les valeurs invalides", () => {
    expect(
      parseChatDefaults({
        REDWIDOW_DEFAULT_PROVIDER: "inconnu",
        REDWIDOW_DEFAULT_MODEL: `a${"\u0007"}b`,
      }),
    ).toEqual({});
    expect(parseChatDefaults({ REDWIDOW_DEFAULT_MODEL: "x".repeat(201) })).toEqual({});
    expect(parseChatDefaults({ REDWIDOW_DEFAULT_MODEL: "  " })).toEqual({});
  });
});

describe("défauts d'un nouveau chat", () => {
  it("clé OpenCode seule : OpenCode sélectionné et chat connecté dès le premier affichage", async () => {
    await noClaude();
    await opencodeKey();
    const t = setup(ctx, { createController: withModels([MODEL]) });
    const s = chat(t);
    await vi.waitFor(() => expect(lastView(s).conversation).toBeDefined());
    expect(controls(s).provider).toBe("opencode");
    expect(lastView(s).noProvider).toBeFalsy();
    await new Promise((ok) => setTimeout(ok, 50));
    expect(lastView(s).noProvider).toBeFalsy();
  });

  it("clé de la réserve OpenCode : même résultat", async () => {
    await noClaude();
    ctx.storage.state.set(poolStateKey("opencode"), {
      order: ["k1"],
      active: "k1",
      keys: { k1: { label: "a", state: "ok", since: 0, retryAt: null } },
    });
    await ctx.storage.secrets.set(poolSecretKey("opencode", "k1"), "cle-reserve-de-test");
    const t = setup(ctx, { createController: withModels([MODEL]) });
    const s = chat(t);
    await vi.waitFor(() => expect(controls(s).provider).toBe("opencode"));
    expect(lastView(s).noProvider).toBeFalsy();
  });

  it("sans aucune clé : comportement habituel (Claude, message de connexion)", async () => {
    await noClaude();
    const t = setup(ctx, { createController: withModels([MODEL]) });
    const s = chat(t);
    await vi.waitFor(() => expect(lastView(s).noProvider).toBe(true));
    expect(controls(s).provider).toBe("claude");
    expect(ctx.storage.state.get(framePrefsKey("c1"))).toBeUndefined();
  });

  it("modèle par défaut annoncé par le fournisseur : appliqué", async () => {
    await noClaude();
    await opencodeKey();
    const t = setup(ctx, {
      createController: withModels(["provider/autre", MODEL]),
      defaults: { model: MODEL },
    });
    const s = chat(t);
    await vi.waitFor(() => expect(controls(s).model).toBe(MODEL));
    expect(t.audit).toContainEqual({ kind: "chat.defaultModel", frame: "c1", applied: true });
  });

  it("modèle par défaut absent du catalogue : ignoré, audité, sans erreur", async () => {
    await noClaude();
    await opencodeKey();
    const t = setup(ctx, {
      createController: withModels(["provider/autre"]),
      defaults: { model: MODEL },
    });
    const s = chat(t);
    await vi.waitFor(() =>
      expect(t.audit).toContainEqual({
        kind: "chat.defaultModel",
        frame: "c1",
        applied: false,
        reason: "unavailable",
      }),
    );
    expect(controls(s).model).toBeNull();
    expect(lastView(s).noProvider).toBeFalsy();
    expect(s.of("chat", "view").every((v) => v.msg.type === "view")).toBe(true);
  });

  it("un chat dont l'utilisateur a choisi son modèle le garde", async () => {
    await noClaude();
    await opencodeKey();
    ctx.storage.state.set(framePrefsKey("c1"), {
      model: "provider/autre",
      effort: null,
      variant: null,
      provider: "opencode",
      supervision: "standard",
    });
    const t = setup(ctx, {
      createController: withModels(["provider/autre", MODEL]),
      defaults: { model: MODEL },
    });
    const s = chat(t);
    await vi.waitFor(() => expect(controls(s).modelsStatus).toBe("ready"));
    await new Promise((ok) => setTimeout(ok, 50));
    expect(controls(s).model).toBe("provider/autre");
  });

  it("un chat qui avait choisi Claude le garde", async () => {
    await opencodeKey();
    ctx.storage.state.set(framePrefsKey("c1"), {
      model: null,
      effort: null,
      variant: null,
      provider: "claude",
      supervision: "standard",
    });
    const t = setup(ctx, { createController: withModels([MODEL]) });
    const s = chat(t);
    await vi.waitFor(() => expect(lastView(s).conversation).toBeDefined());
    expect(controls(s).provider).toBe("claude");
  });

  it("l'utilisateur peut changer de modèle ensuite : son choix prime", async () => {
    await noClaude();
    await opencodeKey();
    const t = setup(ctx, {
      createController: withModels(["provider/autre", MODEL]),
      defaults: { model: MODEL },
    });
    const s = chat(t);
    await vi.waitFor(() => expect(controls(s).model).toBe(MODEL));
    s.say("chat", "c1", { type: "setModel", model: "provider/autre" });
    await vi.waitFor(() => expect(controls(s).model).toBe("provider/autre"));
    await new Promise((ok) => setTimeout(ok, 50));
    expect(controls(s).model).toBe("provider/autre");
  });

  it("deux fournisseurs avec jeton : le défaut explicite gagne", async () => {
    await opencodeKey();
    // Claude a déjà un jeton (useStorage) : sans réglage, OpenCode passe d'abord ; explicite : Claude.
    const explicit = setup(ctx, {
      createController: withModels([MODEL]),
      defaults: { provider: "claude" },
    });
    const s = chat(explicit);
    await vi.waitFor(() => expect(lastView(s).conversation).toBeDefined());
    expect(controls(s).provider).toBe("claude");
  });

  it("deux fournisseurs avec jeton sans réglage : OpenCode d'abord", async () => {
    await opencodeKey();
    const t = setup(ctx, { createController: withModels([MODEL]) });
    const s = chat(t);
    await vi.waitFor(() => expect(controls(s).provider).toBe("opencode"));
  });

  it("settings expose les défauts effectifs, sans secret", async () => {
    await noClaude();
    await opencodeKey();
    const t = setup(ctx, { defaults: { model: MODEL } });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "settingsGet" });
    await vi.waitFor(() => expect(s.of("shell", "settings").length).toBeGreaterThan(0));
    const values = s.of("shell", "settings").at(-1)?.msg.values as Msg;
    expect(values.defaultProvider).toBe("opencode");
    expect(values.defaultModel).toBe(MODEL);
    expect(JSON.stringify(s.sent)).not.toContain("cle-opencode-de-test");
  });

  it("settings : sans clé ni réglage, défauts nuls", async () => {
    await noClaude();
    const t = setup(ctx);
    const s = shellOf(t);
    s.say("shell", "shell", { type: "settingsGet" });
    await vi.waitFor(() => expect(s.of("shell", "settings").length).toBeGreaterThan(0));
    const values = s.of("shell", "settings").at(-1)?.msg.values as Msg;
    expect(values.defaultProvider).toBeNull();
    expect(values.defaultModel).toBeNull();
  });
});
