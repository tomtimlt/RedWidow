import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding } from "@warband/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import { MAX_ATTACHMENT_BYTES, parseAttachments } from "../src/logic/attachments.js";
import {
  killchainSummary,
  lastToolOutput,
  listMentionFiles,
  MENTION_MAX_RESULTS,
  mentionGlob,
  mentionPathAllowed,
  resolveMentionFile,
  truncateUtf8,
} from "../src/logic/mentions.js";

let root: string;
let outside: string;
const PROGRAM = "projects/11111111-1111-4111-8111-111111111111/program.json";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "warband-mention-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "warband-outside-")));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "projects/11111111-1111-4111-8111-111111111111"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, PROGRAM), "{}");
  writeFileSync(join(root, "gros.txt"), "x".repeat(MAX_ATTACHMENT_BYTES + 1));
  writeFileSync(join(root, "limite.txt"), "x".repeat(MAX_ATTACHMENT_BYTES));
  writeFileSync(join(root, "binaire.txt"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  writeFileSync(join(root, "image.png"), "texte");
  writeFileSync(join(outside, "secret.txt"), "secret");
  try {
    symlinkSync(join(outside, "secret.txt"), join(root, "lien.txt"));
  } catch {
    // Lien symbolique indisponible (droits Windows) : le test correspondant se contente de l'absence.
  }
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("@fichier : chemins", () => {
  it("lit un fichier de l'espace de travail, chemin relatif ou absolu", async () => {
    const abs = await resolveMentionFile(join(root, "src/a.ts"), [root]);
    expect(abs).toEqual({ ok: true, attachment: { name: "a.ts", text: "export const a = 1;\n" } });
    expect(await resolveMentionFile("src/a.ts", [root])).toEqual(abs);
  });
  it("refuse `..` et les chemins hors espace de travail, à la lecture", async () => {
    expect(await resolveMentionFile("../etc/passwd", [root])).toEqual({
      ok: false,
      reason: "path",
    });
    expect(await resolveMentionFile(join(root, "src/../../x"), [root])).toEqual({
      ok: false,
      reason: "path",
    });
    expect(await resolveMentionFile(join(outside, "secret.txt"), [root])).toEqual({
      ok: false,
      reason: "path",
    });
    expect(await resolveMentionFile("/etc/passwd", [root])).toEqual({ ok: false, reason: "path" });
  });
  it("refuse un lien symbolique qui sort de l'espace de travail", async () => {
    const result = await resolveMentionFile("lien.txt", [root]);
    expect(result.ok).toBe(false);
  });
  it("refuse un chemin sensible, même dans l'espace de travail", async () => {
    expect(await resolveMentionFile(PROGRAM, [root])).toEqual({ ok: false, reason: "path" });
    const ssh = join(homedir(), ".ssh", "id_rsa");
    expect(mentionPathAllowed(ssh, [homedir()])).toBe(false);
    expect(await resolveMentionFile(ssh, [homedir()])).toEqual({ ok: false, reason: "path" });
  });
  it("refuse sans espace de travail et les valeurs invalides", async () => {
    expect(await resolveMentionFile("src/a.ts", [])).toEqual({ ok: false, reason: "path" });
    expect(await resolveMentionFile("", [root])).toEqual({ ok: false, reason: "invalid" });
    expect(await resolveMentionFile("a\0b", [root])).toEqual({ ok: false, reason: "path" });
  });
});

describe("@fichier : plafonds et formats", () => {
  it("accepte exactement 64 Kio et refuse au-delà", async () => {
    const ok = await resolveMentionFile("limite.txt", [root]);
    expect(ok.ok).toBe(true);
    expect(await resolveMentionFile("gros.txt", [root])).toEqual({ ok: false, reason: "size" });
  });
  it("refuse binaire et extensions d'image", async () => {
    expect(await resolveMentionFile("binaire.txt", [root])).toEqual({
      ok: false,
      reason: "binary",
    });
    expect(await resolveMentionFile("image.png", [root])).toEqual({ ok: false, reason: "binary" });
    expect(await resolveMentionFile("introuvable.txt", [root])).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});

describe("@fichier : liste", () => {
  it("écarte chemins sensibles et hors espace de travail, borne et dédoublonne", () => {
    const listed = listMentionFiles(
      [
        join(root, "src/a.ts"),
        join(root, "src/a.ts"),
        join(root, PROGRAM),
        join(outside, "secret.txt"),
        "relatif.ts",
      ],
      [root],
    );
    expect(listed).toEqual([{ path: join(root, "src/a.ts"), label: "src/a.ts" }]);
    const many = Array.from({ length: 50 }, () => join(root, "src/a.ts"));
    expect(listMentionFiles(many, [root])).toHaveLength(1);
    expect(MENTION_MAX_RESULTS).toBe(20);
  });
  it("le motif de recherche n'injecte aucun métacaractère de glob", () => {
    expect(mentionGlob("a{b,c}*")).toBe("**/*[aA][bB][cC]*");
    expect(mentionGlob("Src\\x")).toBe("**/*[sS][rR][cC]/[xX]*");
    expect(mentionGlob("")).toBe("**/**");
  });
});

const finding = (over: Partial<Finding>): Finding => ({
  id: "f1",
  kind: "host",
  label: "10.10.11.42",
  state: "confirmed",
  ...over,
});

describe("@killchain", () => {
  it("résume kind, libellé, état et liens", () => {
    const result = killchainSummary([
      finding({}),
      finding({ id: "f2", kind: "credential", label: "admin", state: "hypothesis", from: ["f1"] }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.name).toBe("killchain.txt");
    expect(result.attachment.text).toContain("- [hôte] 10.10.11.42 (confirmé)");
    expect(result.attachment.text).toContain("- [identifiant] admin (hypothèse) ← 10.10.11.42");
  });
  it("sans note : indisponible ; trop long : plafonné aux 64 Kio", () => {
    expect(killchainSummary([])).toEqual({ ok: false, reason: "empty" });
    const big = Array.from({ length: 2000 }, (_, i) =>
      finding({ id: `n${i}`, label: "é".repeat(100) }),
    );
    const result = killchainSummary(big);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.byteLength(result.attachment.text)).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES);
    expect(result.attachment.text.endsWith("…")).toBe(true);
    expect(parseAttachments([result.attachment])).not.toBeNull();
  });
});

describe("@sortie", () => {
  it("prend la dernière sortie d'outil non vide", () => {
    const result = lastToolOutput([
      { kind: "tool", label: "Bash", output: "ancienne" },
      { kind: "agent" },
      { kind: "tool", label: "Commande", output: "22/tcp open ssh" },
      { kind: "tool", label: "Vide", output: "  " },
      { kind: "notice" },
    ]);
    expect(result).toEqual({
      ok: true,
      attachment: { name: "sortie.txt", text: "Commande :\n22/tcp open ssh" },
    });
  });
  it("sans sortie : indisponible ; sortie énorme : plafonnée", () => {
    expect(lastToolOutput([{ kind: "user" }, { kind: "tool", label: "x" }])).toEqual({
      ok: false,
      reason: "empty",
    });
    const result = lastToolOutput([{ kind: "tool", label: "t", output: "é".repeat(100_000) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.byteLength(result.attachment.text)).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES);
  });
  it("truncateUtf8 ne coupe pas un caractère", () => {
    expect(truncateUtf8("ééé", 5)).toEqual({ text: "éé", truncated: true });
    expect(truncateUtf8("abc", 5)).toEqual({ text: "abc", truncated: false });
  });
});

describe("messages de mention de la webview", () => {
  it("mentionQuery : texte borné, aucun autre champ", () => {
    expect(parseWebviewMessage({ type: "mentionQuery", query: "src/a" })).toEqual({
      type: "mentionQuery",
      query: "src/a",
    });
    expect(parseWebviewMessage({ type: "mentionQuery", query: "x".repeat(121) })).toBeNull();
    expect(parseWebviewMessage({ type: "mentionQuery", query: 1 })).toBeNull();
    expect(parseWebviewMessage({ type: "mentionQuery", query: "", extra: 1 })).toBeNull();
  });
  it("mentionAttach : fichier avec chemin, spéciales sans chemin", () => {
    expect(
      parseWebviewMessage({ type: "mentionAttach", requestId: "m-1", kind: "file", path: "a.ts" }),
    ).toEqual({ type: "mentionAttach", requestId: "m-1", kind: "file", path: "a.ts" });
    expect(
      parseWebviewMessage({ type: "mentionAttach", requestId: "m-1", kind: "sortie" }),
    ).toEqual({ type: "mentionAttach", requestId: "m-1", kind: "sortie" });
    for (const bad of [
      { requestId: "m-1", kind: "file" },
      { requestId: "m-1", kind: "killchain", path: "/etc/passwd" },
      { requestId: "../x", kind: "sortie" },
      { requestId: "m-1", kind: "autre" },
      { requestId: "m-1", kind: "file", path: "a", text: "x" },
    ])
      expect(parseWebviewMessage({ type: "mentionAttach", ...bad })).toBeNull();
  });
});
