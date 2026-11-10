import { join } from "node:path";
import { CodedError } from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { ModelProbeError } from "../src/logic/model-load-error.js";
import { probeProviderConnection } from "../src/logic/provider-connection.js";

describe("sondage explicite d'un fournisseur", () => {
  it("sonde le catalogue avec les identifiants de la session, sans start ni prompt", async () => {
    const kill = vi.fn();
    const models = vi.fn(async () => [{ value: "catalogue/choix", displayName: "Choix" }]);
    const create = vi.fn((_auth, handlers) => {
      handlers.onProviders([{ id: "catalogue", name: "Catalogue", connected: true }]);
      return { models, kill };
    });
    const getToken = vi.fn(async () => ({ mode: "auto" as const }));
    const result = await probeProviderConnection("oc-catalogue", {
      settings: { providerCatalog: [{ id: "catalogue", name: "Catalogue", connected: false }] },
      cwd: "/projet",
      env: { XDG_DATA_HOME: "/cache-externe" },
      getToken,
      create,
    });
    expect(getToken).toHaveBeenCalledWith("opencode");
    expect(models).toHaveBeenCalledWith({
      cwd: "/projet",
      provider: "opencode",
      auth: "auto",
      timeoutMs: 45000,
    });
    expect(result).toEqual({
      models: 1,
      connected: true,
      sourceFile: join("/cache-externe", "opencode", "auth.json"),
    });
    expect(kill).toHaveBeenCalledOnce();
  });

  it("ne démarre rien pour un fournisseur inconnu et masque une erreur avant de la retourner", async () => {
    const secret = "cle-factice-a-ne-pas-exposer";
    const kill = vi.fn();
    const create = vi.fn(() => ({
      models: async () => {
        throw new ModelProbeError({ code: "provider.error", params: { message: secret } });
      },
      kill,
    }));
    const deps = {
      settings: {},
      cwd: "/projet",
      create,
      getToken: async () => ({
        mode: "api-key" as const,
        auth: { name: "OPENAI_API_KEY" as const, value: secret },
      }),
    };
    await expect(probeProviderConnection("absent", deps)).rejects.toBeInstanceOf(CodedError);
    expect(create).not.toHaveBeenCalled();
    try {
      await probeProviderConnection("openai", deps);
      throw new Error("Le sondage devait échouer");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProbeError);
      expect(JSON.stringify((error as ModelProbeError).reason)).not.toContain(secret);
      expect((error as ModelProbeError).reason.params?.message).toBe("[REDACTED]");
    }
    expect(kill).toHaveBeenCalledOnce();
  });
});
