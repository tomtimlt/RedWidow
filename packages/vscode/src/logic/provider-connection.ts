import {
  CodedError,
  createRedactor,
  errorInfo,
  opencodeAuthFile,
  type ProviderOption,
  secretsFromEnv,
} from "@warband/core";
import { providerChoices } from "./chat-capabilities.js";
import type { EngineAuth, EngineController, EngineHandlers } from "./controller.js";
import type { Provider } from "./effort.js";
import { ModelProbeError } from "./model-load-error.js";
import type { TokenChoice } from "./session.js";
import type { ChatSettings } from "./settings.js";

export interface ProviderConnectionResult {
  models: number;
  /** Déclaration du catalogue, distincte d'une génération réussie. */
  connected: boolean | null;
  sourceFile?: string;
}

/** Sondage explicite du catalogue : aucune consigne, aucun outil et aucun changement de réglage. */
export async function probeProviderConnection(
  id: string,
  deps: {
    settings: ChatSettings;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    getToken(provider: Provider): Promise<TokenChoice | undefined>;
    create(
      auth: EngineAuth | undefined,
      handlers: EngineHandlers,
    ): Pick<EngineController, "models" | "kill">;
  },
): Promise<ProviderConnectionResult> {
  const provider = providerChoices(deps.settings, false).find((p) => p.id === id);
  if (!provider)
    throw new CodedError("ipc.invalidMessage", { field: "provider", reason: "unknown" });
  const token = await deps.getToken(provider.backend);
  if (!token) throw new CodedError("provider.authFailed", { provider: provider.label });
  const redact = createRedactor({
    values: [...secretsFromEnv(deps.env ?? process.env), ...(token.auth ? [token.auth.value] : [])],
  });
  let catalog: ProviderOption[] = [];
  const probe = deps.create(token.auth, {
    onProviders: (value) => {
      catalog = value;
    },
  });
  try {
    const models = await probe.models({
      cwd: deps.cwd,
      provider: provider.backend,
      auth: token.mode,
      ...(deps.settings.opencodeProviders && {
        opencodeProviders: deps.settings.opencodeProviders,
      }),
      timeoutMs: 45000,
    });
    const entry = catalog.find((p) => p.id === (provider.runtimeId ?? provider.id));
    return {
      models: models.filter((m) => !provider.prefix || m.value.startsWith(provider.prefix)).length,
      connected: entry?.connected ?? null,
      ...(provider.backend !== "claude" &&
        token.mode !== "api-key" && {
          sourceFile: opencodeAuthFile(deps.env),
        }),
    };
  } catch (error) {
    throw new ModelProbeError(
      redact(error instanceof ModelProbeError ? error.reason : errorInfo(error)),
    );
  } finally {
    probe.kill();
  }
}
