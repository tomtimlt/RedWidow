import type { MissionDesk } from "./mission-desk.js";
/** Ajoute une relance sans rendre illisible un résultat JSON. Jamais une autorisation. */
export function appendDeskNote(output: string, desk: MissionDesk | undefined): string {
  const note = desk?.pendingNudge();
  if (!note) return output;
  const text = `Note du bureau : ${note}`;
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return JSON.stringify({ ...parsed, bureauNote: text });
  } catch {
    /* Sortie texte. */
  }
  return `${output}\n\n${text}`;
}
