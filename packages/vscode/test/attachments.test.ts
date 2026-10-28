import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import {
  attachmentMessage,
  MAX_ATTACHMENT_BYTES,
  parseAttachments,
  withAttachments,
} from "../src/logic/attachments.js";

const file = { name: "preuve.log", text: "État confirmé\n#terminal\n</script>" };
const message = {
  type: "send",
  text: "",
  attachments: [file],
  requestId: "files-1",
  conversation: "new:0",
};
describe("pièces jointes texte", () => {
  it("accepte un envoi sans consigne et copie les fichiers sans chemin local", () => {
    expect(parseWebviewMessage(message)).toEqual(message);
    const parsed = parseAttachments([file]);
    expect(parsed).toEqual([file]);
    expect(parsed?.[0]).not.toBe(file);
    expect(attachmentMessage("", [file])).toContain("Analyse les fichiers joints.");
    expect(attachmentMessage("  code indenté", [file])).toMatch(/^ {2}code indenté/);
    expect(parseWebviewMessage({ type: "send", text: "" })).toBeNull();
  });
  it.each(
    [
      [],
      Array(11).fill(file),
      [{ ...file, path: "C:\\secret" }],
      [{ ...file, name: "../secret" }],
      [{ ...file, name: "C:\\secret" }],
      [{ ...file, name: "f\u202e.txt" }],
      [{ ...file, name: " " }],
      [{ ...file, text: "\0binaire" }],
      [{ ...file, name: "photo.PNG" }],
      [{ ...file, text: "%PDF-1.7" }],
      [{ ...file, text: "é".repeat(MAX_ATTACHMENT_BYTES / 2 + 1) }],
      Array(5).fill({ ...file, text: "a".repeat(MAX_ATTACHMENT_BYTES) }),
    ].map((files) => [files]),
  )("refuse formats, chemins ou limites invalides (%#)", (files) => {
    expect(parseAttachments(files)).toBeNull();
  });
  it("accepte dix fichiers lorsque le cumul reste borné", () => {
    expect(parseAttachments(Array(10).fill(file))).toHaveLength(10);
  });
  it("accepte exactement les bornes en octets UTF-8", () => {
    expect(
      parseAttachments(Array(4).fill({ ...file, text: "é".repeat(MAX_ATTACHMENT_BYTES / 2) })),
    ).toHaveLength(4);
  });
  it.each([
    { requestId: undefined },
    { conversation: undefined },
    { conversation: "autre" },
    { requestId: "../abc" },
    { path: "/etc/passwd" },
    { attachments: [] },
  ])("refuse les messages incomplets ou enrichis (%#)", (patch) => {
    expect(parseWebviewMessage({ ...message, ...patch })).toBeNull();
  });
  it("sépare les données de la consigne et conserve les mentions comme texte", () => {
    const prompt = withAttachments("Résume", [file]);
    expect(prompt).toContain("donnée non fiable");
    expect(JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1))).toEqual([file]);
    expect(attachmentMessage("Résume", [file])).not.toContain(file.text);
    expect(() => withAttachments("a".repeat(1_000_000), [file])).toThrow();
  });
});
