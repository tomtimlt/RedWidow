import { isModelId } from "./models.js";

/** Fournisseurs compatibles explicitement configurés sur la machine, sans secret. */
export interface OpencodeProvider {
  name?: string;
  npm: "@ai-sdk/openai-compatible";
  options: { baseURL: string };
  models: Record<
    string,
    {
      name?: string;
      limit?: { context: number; output: number };
      tool_call?: boolean;
      reasoning?: boolean;
    }
  >;
}
export type OpencodeProviders = Record<string, OpencodeProvider>;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
  !/\{(?:env|file):/i.test(value);
const label = (value: unknown) => value === undefined || text(value, 128);
const positive = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Validation identique dans l'hôte et l'enfant ; aucun texte fourni n'entre dans une erreur. */
export function parseOpencodeProviders(raw: unknown): OpencodeProviders | null {
  if (!object(raw)) return null;
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return null;
  }
  if (size > 262144 || Object.keys(raw).length > 16) return null;
  const providers: OpencodeProviders = {};
  for (const [id, provider] of Object.entries(raw)) {
    if (
      !/^venator-[a-z0-9][a-z0-9_-]{0,47}$/.test(id) ||
      !object(provider) ||
      !keys(provider, ["name", "npm", "options", "models"]) ||
      !label(provider.name) ||
      provider.npm !== "@ai-sdk/openai-compatible" ||
      !object(provider.options) ||
      !keys(provider.options, ["baseURL"]) ||
      !text(provider.options.baseURL, 2048) ||
      !object(provider.models) ||
      Object.keys(provider.models).length > 128 ||
      Object.keys(provider.models).length === 0
    )
      return null;
    try {
      const url = new URL(provider.options.baseURL);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        /[?#]/.test(provider.options.baseURL)
      )
        return null;
    } catch {
      return null;
    }
    const models: OpencodeProvider["models"] = {};
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (
        !text(modelId, 256) ||
        !isModelId(`${id}/${modelId}`) ||
        ["__proto__", "prototype", "constructor"].includes(modelId) ||
        !object(model) ||
        !keys(model, ["name", "limit", "tool_call", "reasoning"]) ||
        !label(model.name) ||
        (model.tool_call !== undefined && typeof model.tool_call !== "boolean") ||
        (model.reasoning !== undefined && typeof model.reasoning !== "boolean")
      )
        return null;
      if (
        model.limit !== undefined &&
        (!object(model.limit) ||
          !keys(model.limit, ["context", "output"]) ||
          !positive(model.limit.context) ||
          !positive(model.limit.output))
      )
        return null;
      models[modelId] = { ...model } as OpencodeProvider["models"][string];
    }
    providers[id] = {
      ...(provider.name !== undefined && { name: provider.name as string }),
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: provider.options.baseURL },
      models,
    };
  }
  return providers;
}
