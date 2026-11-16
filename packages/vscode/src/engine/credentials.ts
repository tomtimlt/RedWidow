import {
  effectiveServerEnv,
  type OpencodeRunnerOptions,
  zenKeyFromAuthContent,
} from "@warband/agent-opencode";
import { sdkEffectiveEnv } from "@warband/agent-sdk";
import type { StartParams } from "../logic/protocol.js";

/**
 * Identifiants transmis au SDK et au serveur OpenCode (ADR 0056). Module sans effet de bord : le
 * moteur (`main.ts`) construit ses runners avec ces fonctions, et les tests les appellent telles quelles.
 */

type Provider = NonNullable<StartParams["provider"]>;

/**
 * Options OpenCode qui décident des identifiants du serveur : partagées par la construction du runner
 * et par la lecture de la clé effective, pour qu'elles ne divergent jamais. Pour une clé du coffre d'un
 * fournisseur OpenCode configuré, SEULE cette variable passe au serveur (`passEnv`) ; `safeEnv` est inchangé.
 */
export function opencodeCredentialOptions(
  provider: Provider,
  vault: StartParams["vault"],
): Pick<OpencodeRunnerOptions, "isolateConfig" | "provider" | "passEnv" | "zenKeyEnv"> {
  const zen = provider === "opencode" && vault?.provider === "opencode";
  return {
    isolateConfig: true,
    ...(provider === "openai" && { provider: "openai" }),
    // OpenCode Zen : la clé passe par `OPENCODE_AUTH_CONTENT` (`zenKeyEnv`), jamais par une variable `*_API_KEY`.
    ...(zen && vault !== undefined && { zenKeyEnv: vault.name }),
    ...(provider === "opencode" && !zen && vault !== undefined && { passEnv: [vault.name] }),
  };
}

/**
 * Configuration des fournisseurs OpenCode : pour le fournisseur du coffre, le NOM de la variable est
 * déclaré (`env`) afin qu'OpenCode la lise ; la valeur n'est jamais écrite dans la configuration.
 */
export function opencodeProviderConfig(
  providers: NonNullable<StartParams["opencodeProviders"]>,
  vault: StartParams["vault"],
): Record<string, unknown> {
  const own = vault === undefined ? undefined : providers[vault.provider];
  if (vault === undefined || own === undefined) return providers;
  return { ...providers, [vault.provider]: { ...own, env: [vault.name] } };
}

/**
 * Clé d'API effective (ADR 0056, décision 4) : lue dans l'environnement FINAL transmis au SDK
 * (`sdkEffectiveEnv`) ou au serveur OpenCode (`effectiveServerEnv`), et non dans ce que l'hôte croit
 * avoir envoyé. `undefined` : aucune clé (abonnement, authentification propre à OpenCode).
 */
export async function effectiveKey(
  params: StartParams,
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<{ provider: string; value: string } | undefined> {
  const provider = params.provider ?? "claude";
  if (provider === "claude") {
    const value = sdkEffectiveEnv(params.auth ?? "auto", processEnv).ANTHROPIC_API_KEY;
    return value ? { provider: "claude", value } : undefined;
  }
  const env = await effectiveServerEnv(
    { ...opencodeCredentialOptions(provider, params.vault), processEnv },
    params.auth,
  );
  if (provider === "opencode" && params.vault?.provider === "opencode") {
    // Zen : la clé effective est celle de `OPENCODE_AUTH_CONTENT` dans l'environnement final du serveur.
    const value = zenKeyFromAuthContent(env.OPENCODE_AUTH_CONTENT);
    return value ? { provider: "opencode", value } : undefined;
  }
  const name = params.vault?.name ?? (provider === "openai" ? "OPENAI_API_KEY" : undefined);
  const value = name === undefined ? undefined : env[name];
  return value ? { provider: params.vault?.provider ?? provider, value } : undefined;
}
