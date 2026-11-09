import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isAuditEvidencePath } from "./audit-schema.js";
import { OUTPUT_MAX_BYTES } from "./docker/output-capture.js";

export function evidenceWorkspace(
  workspace: string,
): { original: string; root: string; dev: bigint; ino: bigint } | null {
  try {
    const root = realpathSync(workspace);
    const stat = lstatSync(root, { bigint: true });
    return stat.isDirectory() ? { original: workspace, root, dev: stat.dev, ino: stat.ino } : null;
  } catch {
    return null;
  }
}

/** Lit une preuve locale sans suivre de lien et rejette tout changement pendant la lecture. */
export function missionEvidenceFile(
  workspace: NonNullable<ReturnType<typeof evidenceWorkspace>>,
  path: string,
  runStart: number,
): { path: string; sha256: string } | null {
  if (!isAuditEvidencePath(path)) return null;
  const parts = path.split("/");
  let fd: number | undefined;
  try {
    const { root } = workspace;
    const rootValid = () => {
      const stat = lstatSync(root, { bigint: true });
      return (
        stat.isDirectory() &&
        stat.dev === workspace.dev &&
        stat.ino === workspace.ino &&
        realpathSync(workspace.original) === root
      );
    };
    if (!rootValid()) return null;
    let current = root;
    const parents: { path: string; dev: bigint; ino: bigint; ctimeNs: bigint }[] = [];
    for (const part of parts) {
      current = join(current, part);
      const stat = lstatSync(current, { bigint: true });
      if (stat.isSymbolicLink()) return null;
      parents.push({ path: current, dev: stat.dev, ino: stat.ino, ctimeNs: stat.ctimeNs });
    }
    const resolved = realpathSync(current);
    const rel = relative(root, resolved);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel) || rel !== parts.join(sep))
      return null;
    fd = openSync(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd, { bigint: true });
    if (
      !before.isFile() ||
      before.size > BigInt(OUTPUT_MAX_BYTES) ||
      before.birthtimeMs < BigInt(runStart) ||
      before.mtimeMs < BigInt(runStart)
    )
      return null;
    const pathValid = () => {
      if (!rootValid() || realpathSync(current) !== resolved) return false;
      for (const parent of parents) {
        const stat = lstatSync(parent.path, { bigint: true });
        if (
          stat.isSymbolicLink() ||
          stat.dev !== parent.dev ||
          stat.ino !== parent.ino ||
          stat.ctimeNs !== parent.ctimeNs
        )
          return false;
      }
      const stat = lstatSync(current, { bigint: true });
      return stat.isFile() && stat.dev === before.dev && stat.ino === before.ino;
    };
    if (!pathValid()) return null;
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      total += n;
      if (total > OUTPUT_MAX_BYTES) return null;
      hash.update(buffer.subarray(0, n));
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      !pathValid() ||
      total !== Number(after.size) ||
      realpathSync(current) !== resolved
    )
      return null;
    return { path, sha256: hash.digest("hex") };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
