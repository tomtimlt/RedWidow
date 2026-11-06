/** Images transmises uniquement au tour courant ; aucune lecture de chemin n'est effectuée. */
export interface PromptImage {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
}
export type AgentPrompt = string | { text: string; images: PromptImage[] };
export const MAX_PROMPT_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_BYTES = 12 * 1024 * 1024;

/** Valide forme, base64 canonique, signature et limites avant tout transport. */
export function parsePromptImages(raw: unknown): PromptImage[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PROMPT_IMAGES) return null;
  let total = 0;
  const images: PromptImage[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const image = value as Record<string, unknown>;
    if (
      Object.keys(image).length !== 3 ||
      !Object.keys(image).every((key) => ["name", "mimeType", "data"].includes(key))
    )
      return null;
    if (
      typeof image.name !== "string" ||
      !image.name.trim() ||
      image.name.length > 180 ||
      /[\\/\p{Cc}\p{Cf}]/u.test(image.name)
    )
      return null;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(String(image.mimeType)))
      return null;
    if (
      typeof image.data !== "string" ||
      image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      image.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
    )
      return null;
    const bytes = Buffer.from(image.data, "base64");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== image.data)
      return null;
    total += bytes.length;
    if (total > MAX_IMAGES_BYTES) return null;
    const valid =
      image.mimeType === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : image.mimeType === "image/jpeg"
          ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          : image.mimeType === "image/gif"
            ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
            : bytes.length >= 12 &&
              bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
              bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!valid) return null;
    images.push(image as unknown as PromptImage);
  }
  return images;
}
