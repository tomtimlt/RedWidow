// Liens officiels du guide « gratuit » : l'hôte seul connaît les adresses, la webview envoie une clé.
export const FREE_GUIDE_LINKS = {
  zen: "https://opencode.ai/docs/zen/",
  copilot: "https://education.github.com/pack",
  gemini: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/models?q=free",
} as const;

export type FreeGuideKey = keyof typeof FREE_GUIDE_LINKS;

export function isFreeGuideKey(value: unknown): value is FreeGuideKey {
  return typeof value === "string" && Object.hasOwn(FREE_GUIDE_LINKS, value);
}
