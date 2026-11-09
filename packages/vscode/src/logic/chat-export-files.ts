import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isRunId } from "./history.js";

/** Publication locale : répertoire réel vérifié, fichiers temporaires exclusifs, jamais de suivi de lien final. */
export async function writeChatExports(
  workspace: string,
  runId: string,
  content: { markdown: string; jsonl: string },
  beforeCommit: () => Promise<unknown>,
) {
  if (!isRunId(runId)) throw Error("Identifiant de run invalide.");
  const root = await realpath(workspace);
  const directory = join(root, "exports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const identity = lstatSync(directory);
  if (!identity.isDirectory() || realpathSync(directory) !== directory)
    throw Error("Le dossier exports doit être un répertoire réel du projet.");
  const check = () => {
    const current = lstatSync(directory);
    if (
      !current.isDirectory() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      realpathSync(directory) !== directory
    )
      throw Error("Le dossier exports a changé pendant l’export.");
  };
  for (const [extension, text] of [
    ["md", content.markdown],
    ["jsonl", content.jsonl],
  ] as const) {
    await beforeCommit();
    check();
    const temporary = join(directory, `.fil-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      check();
      writeFileSync(fd, text);
      closeSync(fd);
      fd = undefined;
      check();
      renameSync(temporary, join(directory, `fil-${runId}.${extension}`));
    } finally {
      if (fd !== undefined) closeSync(fd);
      check();
      rmSync(temporary, { force: true });
    }
  }
}
