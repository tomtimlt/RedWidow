import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeChatExports } from "../src/logic/chat-export-files.js";

it("exporte dans le projet et refuse un dossier exports symbolique", async () => {
  const root = await mkdtemp(join(tmpdir(), "fil-export-"));
  const id = "12345678-1234-4123-8123-123456789abc";
  try {
    const project = join(root, "project"),
      outside = join(root, "outside");
    await mkdir(project);
    await mkdir(outside);
    await symlink(outside, join(project, "exports"), "junction");
    await expect(
      writeChatExports(project, id, { markdown: "md", jsonl: "jsonl" }, async () => {}),
    ).rejects.toThrow();
    await rm(join(project, "exports"));
    await writeChatExports(project, id, { markdown: "md", jsonl: "jsonl" }, async () => {});
    expect(await readFile(join(project, "exports", `fil-${id}.md`), "utf8")).toBe("md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
