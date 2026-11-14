/**
 * API Fichiers du serveur web (ADR 0055, « API Fichiers ») : explorer et éditer les fichiers du projet actif
 * (notes, preuves, cours, `.warband/policy.json`…), l'équivalent de l'explorateur et de l'éditeur de VS Code.
 *
 * - Le client ne donne jamais un chemin hôte : seulement un chemin relatif à la racine du projet actif,
 *   revalidé à chaque opération par `files-guard.ts` (aucun lien symbolique suivi, jamais hors du projet,
 *   jamais `.git` ni `node_modules`).
 * - Toute réponse va au seul socket émetteur (sauf `policyChanged`, diffusé : l'état de la politique change
 *   pour tous). Mémoire et E-S bornées : la taille est lue (`fstat`) avant tout contenu.
 * - Écriture atomique (fichier temporaire voisin puis `rename`), sans écrasement silencieux (`etag`).
 * - `.warband/policy.json` : écriture permise ; l'empreinte change, donc l'approbation précédente cesse de
 *   valoir (`loadPolicy`). Rien n'est jamais approuvé ici : seule la modale humaine d'approbation le fait.
 * - Audit : `fs.write`, `fs.delete`, `fs.deleteAsRoot`, `fs.rename`, `fs.upload` avec le chemin relatif, jamais le
 *   contenu.
 * - Fichiers créés en root par les outils du conteneur : la suppression normale échoue (droits) ; seule une
 *   seconde confirmation humaine dédiée permet de les supprimer en root DANS le conteneur démarré (`rootfs.ts`).
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  activeProject,
  appendFinding,
  CodedError,
  createEvidence,
  EVIDENCE_MAX_TEXT_BYTES,
  type ReasonCode,
  readProjects,
} from "@warband/core";
import { formatError, t } from "@warband/messages";
import type { DockerApi } from "../docker/api.js";
import { listManaged } from "../docker/containers.js";
import { MAX_DOWNLOAD_TOTAL } from "../downloads.js";
import { MAX_UPLOAD_BYTES, normalizeAccept, sanitizeFilename } from "../uploads.js";
import {
  checkNewName,
  etagOf,
  mtimeOf,
  POLICY_REL,
  resolveTarget,
  type Target,
  validSegment,
} from "./files-guard.js";
import { FS_MAX_BASE64, FS_MAX_TEXT, type FsControl } from "./files-messages.js";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";
import { mentionRoot } from "./mentions.js";
import { removeAsContainerRoot } from "./rootfs.js";
import { isLinked, locate } from "./workspaces.js";

/** Entrées renvoyées au plus par un listage, et entrées lues au plus pour les trier. */
export const FS_LIST_LIMIT = 1000;
export const FS_SCAN_LIMIT = 5000;
/** Plafond d'un téléchargement : celui du magasin de téléchargements (mémoire, ADR 0055 point 6). */
export const FS_MAX_DOWNLOAD = MAX_DOWNLOAD_TOTAL;
/** Plafond d'un téléversement vers le projet. */
export const FS_MAX_UPLOAD = MAX_UPLOAD_BYTES;
/** Extensions proposées au téléversement (liste du dialogue, ≤ 50) : recontrôlées à la prise du fichier. */
export const FS_UPLOAD_ACCEPT = [
  "txt",
  "md",
  "json",
  "csv",
  "log",
  "xml",
  "html",
  "yaml",
  "yml",
  "toml",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "zip",
  "gz",
  "tar",
  "pcap",
  "pcapng",
  "xlsx",
  "docx",
  "pptx",
  "odt",
  "ods",
  "ini",
  "conf",
  "cfg",
  "py",
  "js",
  "ts",
  "sh",
  "ps1",
  "c",
  "h",
  "go",
  "rs",
  "java",
  "sql",
  "bin",
  "dat",
  "key",
  "pem",
  "crt",
  "ovpn",
  "gnmap",
  "nessus",
  "7z",
] as const;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const SNIFF = 8192;
const CHUNK = 64 * 1024;

const MIME: Readonly<Record<string, string>> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

export interface FilesDeps {
  ctx: BridgeContext;
  configDir: string;
  /** Racine des projets du serveur : le dossier du projet actif doit s'y trouver (chemins réels). */
  containersRoot: string;
  locale(): "fr" | "en";
  /** Client de l'API Engine : suppression en root dans le conteneur lié (après confirmation humaine). */
  docker: DockerApi;
  /** Identifiants du conteneur du serveur : jamais ciblé. */
  selfIds?: readonly string[];
  /** Suppression de l'arbre (injectable : tests, pour simuler des fichiers d'un autre uid). Défaut : `rm`/`unlink`. */
  removeTree?(path: string, recursive: boolean): Promise<void>;
  /** Diffusion à toutes les coquilles (seulement `policyChanged`). */
  toShell(msg: Record<string, unknown>): void;
}

interface Scope {
  root: string;
  projectId: string;
  /** Dossier partagé du projet et chemin du projet dans ce dossier (`<dossier>/<projet>`, ADR 0056). */
  folder: string;
  projectPath: string;
  /** Conteneurs que la fiche du projet nomme. */
  containers: readonly string[];
}

/** Refus de droits : fichiers d'un autre uid (root, créés par le conteneur). */
const isPermissionError = (error: unknown): boolean =>
  ["EACCES", "EPERM", "ENOTEMPTY"].includes(
    (error as NodeJS.ErrnoException | undefined)?.code ?? "",
  );

/** Erreur système → code stable (jamais le texte de l'erreur, qui contiendrait un chemin hôte). */
function codeOf(error: unknown): { code: ReasonCode; params?: Record<string, string | number> } {
  if (error instanceof CodedError)
    return { code: error.code, ...(error.params && { params: { ...error.params } }) };
  switch ((error as NodeJS.ErrnoException | undefined)?.code) {
    case "ENOENT":
      return { code: "fs.notFound" };
    case "EEXIST":
    case "ENOTEMPTY":
      return { code: "fs.exists" };
    case "EACCES":
    case "EPERM":
      return { code: "fs.permission" };
    case "ELOOP":
    case "EMLINK":
      return { code: "fs.symlink" };
    case "EISDIR":
      return { code: "fs.notFile" };
    case "ENOTDIR":
      return { code: "fs.notDir" };
    default:
      return { code: "fs.failed" };
  }
}

/** `touchesPolicy` : l'opération concerne le fichier de politique ou un dossier qui le contient. */
const touchesPolicy = (rel: string): boolean =>
  rel === POLICY_REL || POLICY_REL.startsWith(`${rel}/`);

const pathOf = (c: FsControl): string | undefined =>
  "path" in c ? c.path : "dir" in c ? c.dir : "from" in c ? c.from : undefined;

export class FilesHost {
  private disposed = false;
  /** Écritures, renommages et suppressions sont sérialisés : l'`etag` ne se compare jamais à un état en mouvance. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: FilesDeps) {}

  dispose(): void {
    this.disposed = true;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private send(to: Sink, msg: Record<string, unknown>): void {
    to.send("shell", "shell", msg);
  }

  private audit(entry: Record<string, unknown>): void {
    this.deps.ctx.audit(entry);
  }

  /** Projet actif et racine réelle de son dossier (sous la racine des conteneurs du serveur). */
  private async scope(): Promise<Scope> {
    const file = await readProjects(this.deps.configDir).catch(() => null);
    const project = file === null ? null : activeProject(file);
    if (project === null) throw new CodedError("fs.noProject");
    // Projet « à lier » (hors d'un dossier partagé de conteneur, ADR 0056) : pas d'accès aux fichiers.
    if (!isLinked(project, this.deps.containersRoot)) throw new CodedError("project.unlinked");
    const root = await mentionRoot(project.workspace, this.deps.containersRoot);
    if (root === null) throw new CodedError("fs.noProject");
    const where = locate(project.workspace, this.deps.containersRoot);
    if (where === null) throw new CodedError("project.unlinked");
    return {
      root,
      projectId: project.id,
      folder: where.folder,
      projectPath: where.project,
      containers: project.containers,
    };
  }

  /** Après une attente humaine : le projet actif doit être resté le même. */
  private async sameScope(before: Scope): Promise<Scope> {
    const now = await this.scope();
    if (now.root !== before.root || now.projectId !== before.projectId)
      throw new CodedError("fs.noProject");
    return now;
  }

  private fail(to: Sink, op: string, path: string | undefined, error: unknown): void {
    const { code, params } = codeOf(error);
    const reason = { code, ...(params && { params }) };
    this.send(to, {
      type: "fsError",
      op,
      ...(path !== undefined && path.length <= 1024 && { path }),
      reason,
      message: formatError(new CodedError(code, params), this.deps.locale()),
    });
  }

  /**
   * Message déjà validé par `parseFsControl`. Répond toujours à `from` seul ; un refus donne `fsError`
   * (code stable, jamais un chemin hôte). `false` seulement si le serveur est arrêté.
   */
  async handle(c: FsControl, from: Sink): Promise<boolean> {
    if (this.disposed) return false;
    try {
      await this.run(c, from);
    } catch (error) {
      this.fail(from, c.type, pathOf(c), error);
    }
    return true;
  }

  private async run(c: FsControl, from: Sink): Promise<void> {
    const scope = await this.scope();
    switch (c.type) {
      case "fsList":
        return this.list(scope, c.path, from);
      case "fsStat":
        return this.stat(scope, c.path, from);
      case "fsRead":
        return this.read(scope, c.path, c.as, from);
      case "fsWrite":
        return this.write(scope, c, from);
      case "fsMkdir":
        return this.mkdir(scope, c.path, from);
      case "fsRename":
        return this.rename(scope, c.from, c.to, from);
      case "fsDelete":
        return this.delete(scope, c.path, from);
      case "fsUpload":
        return this.upload(scope, c.dir, from);
      case "fsDownload":
        return this.download(scope, c.path, from);
      case "fsCaptureEvidence":
        return this.captureEvidence(scope, c.path, from);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------------------------

  private async list({ root }: Scope, path: string, from: Sink): Promise<void> {
    const target = await resolveTarget(root, path, { allowRoot: true, mustExist: true });
    if (!target.st?.isDirectory()) throw new CodedError("fs.notDir");
    const found: { name: string; kind: "file" | "dir" }[] = [];
    let scanned = 0;
    let truncated = false;
    const dir = await opendir(target.abs);
    try {
      for await (const entry of dir) {
        if (++scanned > FS_SCAN_LIMIT) {
          truncated = true;
          break;
        }
        const name = entry.name;
        // Cachés au client : `.git`, `node_modules`, noms invalides et tout ce qui n'est pas fichier ou dossier.
        if (!validSegment(name) || name === ".git" || name === "node_modules") continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) found.push({ name, kind: "dir" });
        else if (entry.isFile()) found.push({ name, kind: "file" });
      }
    } finally {
      await dir.close().catch(() => undefined);
    }
    found.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
    if (found.length > FS_LIST_LIMIT) truncated = true;
    const entries: { name: string; kind: "file" | "dir"; size: number; mtime: number }[] = [];
    for (const e of found.slice(0, FS_LIST_LIMIT)) {
      try {
        const st = await lstat(join(target.abs, e.name));
        if (st.isSymbolicLink()) continue;
        entries.push({ ...e, size: e.kind === "dir" ? 0 : st.size, mtime: mtimeOf(st) });
      } catch {
        // Disparu entre-temps : absent de la liste.
      }
    }
    this.send(from, { type: "fsEntries", path: target.rel, entries, truncated });
  }

  private async stat({ root }: Scope, path: string, from: Sink): Promise<void> {
    const target = await resolveTarget(root, path, { allowRoot: true });
    const st = target.st;
    if (st === null) return this.send(from, { type: "fsInfo", path: target.rel, exists: false });
    this.send(from, {
      type: "fsInfo",
      path: target.rel,
      exists: true,
      kind: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other",
      size: st.isDirectory() ? 0 : st.size,
      mtime: mtimeOf(st),
      etag: st.isFile() ? etagOf(st) : null,
    });
  }

  /** Ouvre sans suivre de lien symbolique ; un fichier remplacé par un lien entre-temps donne `ELOOP`. */
  private openFile(target: Target): Promise<FileHandle> {
    return open(target.abs, constants.O_RDONLY | NOFOLLOW);
  }

  private async read(
    { root }: Scope,
    path: string,
    as: "text" | "base64",
    from: Sink,
  ): Promise<void> {
    const target = await resolveTarget(root, path, { mustExist: true });
    if (!target.st?.isFile()) throw new CodedError("fs.notFile");
    const fh = await this.openFile(target);
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw new CodedError("fs.notFile");
      if (as === "base64") {
        if (st.size > FS_MAX_BASE64) throw new CodedError("fs.tooLarge", { max: FS_MAX_BASE64 });
        const buf = await readExactly(fh, st.size);
        return this.send(from, {
          type: "fsContent",
          path: target.rel,
          mtime: mtimeOf(st),
          etag: etagOf(st),
          size: st.size,
          truncated: false,
          base64: buf.toString("base64"),
        });
      }
      const truncated = st.size > FS_MAX_TEXT;
      const buf = await readExactly(fh, Math.min(st.size, FS_MAX_TEXT));
      const text = decodeText(buf, truncated);
      // Une lecture tronquée est en lecture seule : sans `etag`, aucune écriture ne peut la renvoyer.
      this.send(from, {
        type: "fsContent",
        path: target.rel,
        mtime: mtimeOf(st),
        etag: truncated ? null : etagOf(st),
        size: st.size,
        truncated,
        text,
      });
    } finally {
      await fh.close().catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Écriture
  // -------------------------------------------------------------------------------------------

  private write(
    scope: Scope,
    c: Extract<FsControl, { type: "fsWrite" }>,
    from: Sink,
  ): Promise<void> {
    return this.serialize(async () => {
      const bytes = Buffer.from(c.text, "utf8");
      if (bytes.length > FS_MAX_TEXT) throw new CodedError("fs.tooLarge", { max: FS_MAX_TEXT });
      const target = await resolveTarget(scope.root, c.path);
      if (target.st !== null && !target.st.isFile()) throw new CodedError("fs.notFile");
      if (!matches(target.st, c.etag))
        return this.send(from, { type: "fsConflict", path: target.rel });
      const temp = join(dirname(target.abs), `.fs-${randomUUID()}.tmp`);
      const mode = target.st === null ? 0o644 : target.st.mode & 0o777;
      let fh: FileHandle | undefined;
      try {
        fh = await open(temp, "wx", mode);
        await fh.writeFile(bytes);
        await fh.chmod(mode);
        await fh.sync();
        await fh.close();
        fh = undefined;
        // Dernier contrôle avant le `rename` : un changement concurrent n'est jamais écrasé.
        const now = await lstat(target.abs).catch(() => null);
        if (now?.isSymbolicLink()) throw new CodedError("fs.symlink");
        if (!matches(now, c.etag)) {
          await rm(temp, { force: true });
          return this.send(from, { type: "fsConflict", path: target.rel });
        }
        await rename(temp, target.abs);
      } catch (error) {
        await fh?.close().catch(() => undefined);
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
      const st = await lstat(target.abs);
      this.audit({
        kind: "fs.write",
        project: scope.projectId,
        path: target.rel,
        size: bytes.length,
      });
      this.send(from, {
        type: "fsWritten",
        path: target.rel,
        mtime: mtimeOf(st),
        etag: etagOf(st),
        size: st.size,
      });
      if (touchesPolicy(target.rel)) this.deps.toShell({ type: "policyChanged" });
    });
  }

  private async mkdir({ root }: Scope, path: string, from: Sink): Promise<void> {
    const target = await resolveTarget(root, path);
    if (target.st !== null) throw new CodedError("fs.exists");
    await mkdir(target.abs, { mode: 0o755 });
    this.send(from, { type: "fsDone", op: "mkdir", path: target.rel });
  }

  private rename(scope: Scope, fromPath: string, toPath: string, to: Sink): Promise<void> {
    return this.serialize(async () => {
      const source = await resolveTarget(scope.root, fromPath, { mustExist: true });
      const dest = await resolveTarget(scope.root, toPath);
      if (dest.st !== null) throw new CodedError("fs.exists");
      // Un dossier ne se déplace pas dans lui-même.
      if (dest.rel === source.rel || dest.rel.startsWith(`${source.rel}/`))
        throw new CodedError("fs.invalidPath");
      try {
        await rename(source.abs, dest.abs);
      } catch (error) {
        // Dossier ou parent d'un autre uid (root) : pas de passage en root pour un déplacement.
        if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw new CodedError("fs.rootOwned");
        throw error;
      }
      this.audit({ kind: "fs.rename", project: scope.projectId, from: source.rel, to: dest.rel });
      this.send(to, { type: "fsDone", op: "rename", from: source.rel, path: dest.rel });
      if (touchesPolicy(source.rel) || touchesPolicy(dest.rel))
        this.deps.toShell({ type: "policyChanged" });
    });
  }

  private async delete(scope: Scope, path: string, from: Sink): Promise<void> {
    const first = await resolveTarget(scope.root, path, { mustExist: true });
    const dir = first.st?.isDirectory() === true;
    const accepted = await this.deps.ctx.ui.confirm(
      {
        title: t("Supprimer du projet"),
        text: dir
          ? t`Supprimer le dossier « ${first.rel} » et tout son contenu ? Cette action est irréversible.`
          : t`Supprimer le fichier « ${first.rel} » ? Cette action est irréversible.`,
        danger: true,
      },
      from,
    );
    if (!accepted) return this.send(from, { type: "fsCancelled", op: "fsDelete", path: first.rel });
    const rootOwned = await this.serialize(async () => {
      // Après l'attente humaine : même projet, et la cible doit être restée la même.
      const again = await this.sameScope(scope);
      const target = await this.sameTarget(again, path, first, dir);
      try {
        await (this.deps.removeTree ?? defaultRemove)(target.abs, dir);
      } catch (error) {
        if (!isPermissionError(error)) throw error;
        return true;
      }
      this.finishDelete(scope, target.rel, dir, from);
      return false;
    });
    if (rootOwned) await this.deleteAsRoot(scope, path, first, dir, from);
  }

  /** Cible revalidée après une attente humaine : mêmes inode et nature qu'à la première lecture. */
  private async sameTarget(scope: Scope, path: string, first: Target, dir: boolean) {
    const target = await resolveTarget(scope.root, path, { mustExist: true });
    if (target.st?.ino !== first.st?.ino || target.st?.isDirectory() !== dir)
      throw new CodedError("fs.notFound");
    return target;
  }

  private finishDelete(scope: Scope, rel: string, dir: boolean, from: Sink): void {
    this.audit({ kind: "fs.delete", project: scope.projectId, path: rel, dir });
    this.send(from, { type: "fsDone", op: "delete", path: rel });
    if (touchesPolicy(rel)) this.deps.toShell({ type: "policyChanged" });
  }

  /** Conteneur géré, lié à ce dossier partagé : (le démarré d'abord, puis ceux que la fiche nomme). */
  private async containerOf(scope: Scope): Promise<{ name: string; running: boolean } | null> {
    const rows = await listManaged(
      this.deps.docker,
      this.deps.selfIds ?? [],
      this.deps.containersRoot,
    ).catch(() => []);
    const mine = rows.filter((c) => c.folder === scope.folder);
    const rank = (c: { name: string; running: boolean }) =>
      (c.running ? 0 : 2) + (scope.containers.includes(c.name) ? 0 : 1);
    const best = [...mine].sort((a, b) => rank(a) - rank(b))[0];
    return best === undefined ? null : { name: best.name, running: best.running };
  }

  /**
   * La suppression normale a été refusée (fichiers d'un autre uid, créés en root par le conteneur). Conteneur
   * démarré ET seconde confirmation humaine dédiée : suppression en root dans le conteneur. Sinon, message clair
   * (`fs.rootOwned`) et rien n'est supprimé.
   */
  private async deleteAsRoot(
    scope: Scope,
    path: string,
    first: Target,
    dir: boolean,
    from: Sink,
  ): Promise<void> {
    const container = await this.containerOf(scope);
    if (container === null) throw new CodedError("fs.rootOwned");
    const params = { container: container.name };
    if (!container.running) throw new CodedError("fs.rootOwned", params);
    const accepted = await this.deps.ctx.ui.confirm(
      {
        title: t("Supprimer en tant que root"),
        text: t`Ces fichiers appartiennent à root (créés par le conteneur). Les supprimer en tant que root dans le conteneur ${container.name} ?`,
        danger: true,
      },
      from,
    );
    if (!accepted) throw new CodedError("fs.rootOwned", params);
    await this.serialize(async () => {
      const again = await this.sameScope(scope);
      const target = await this.sameTarget(again, path, first, dir);
      const relPath = `${again.projectPath}/${target.rel}`;
      await removeAsContainerRoot({
        docker: this.deps.docker,
        container: container.name,
        relPath,
        ...(this.deps.selfIds && { selfIds: this.deps.selfIds }),
      });
      this.audit({ kind: "fs.deleteAsRoot", container: container.name, relPath });
      this.finishDelete(scope, target.rel, dir, from);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Échanges avec le navigateur
  // -------------------------------------------------------------------------------------------

  private async upload(scope: Scope, dirPath: string, from: Sink): Promise<void> {
    const dest = await resolveTarget(scope.root, dirPath, { allowRoot: true, mustExist: true });
    if (!dest.st?.isDirectory()) throw new CodedError("fs.notDir");
    const accept = normalizeAccept(FS_UPLOAD_ACCEPT) ?? [];
    const id = await this.deps.ctx.ui.file(
      { title: t("Téléverser un fichier dans le projet"), accept, maxBytes: FS_MAX_UPLOAD },
      from,
    );
    if (id === null)
      return this.send(from, { type: "fsCancelled", op: "fsUpload", path: dest.rel });
    const taken = this.deps.ctx.uploads.take(id);
    if (taken === undefined) throw new CodedError("fs.failed");
    try {
      if (taken.size > FS_MAX_UPLOAD) throw new CodedError("fs.tooLarge", { max: FS_MAX_UPLOAD });
      const name = checkNewName(sanitizeFilename(taken.name));
      if (!accept.includes(extname(name).toLowerCase())) throw new CodedError("fs.badType");
      const again = await this.sameScope(scope);
      const dir = await resolveTarget(again.root, dirPath, { allowRoot: true, mustExist: true });
      if (!dir.st?.isDirectory()) throw new CodedError("fs.notDir");
      const rel = dir.rel === "" ? name : `${dir.rel}/${name}`;
      const first = await resolveTarget(again.root, rel);
      if (first.st !== null) {
        if (!first.st.isFile()) throw new CodedError("fs.notFile");
        const ok = await this.deps.ctx.ui.confirm(
          {
            title: t("Remplacer le fichier existant"),
            text: t`« ${first.rel} » existe déjà : le remplacer ?`,
            danger: true,
          },
          from,
        );
        if (!ok) return this.send(from, { type: "fsCancelled", op: "fsUpload", path: first.rel });
      }
      await this.serialize(async () => {
        const last = await this.sameScope(scope);
        const target = await resolveTarget(last.root, rel);
        if (target.st !== null && !target.st.isFile()) throw new CodedError("fs.notFile");
        // Remplacement seulement si l'humain l'a confirmé pour CETTE version du fichier.
        if (target.st !== null && first.st === null) throw new CodedError("fs.exists");
        const temp = join(dirname(target.abs), `.fs-${randomUUID()}.tmp`);
        try {
          await copyFile(taken.path, temp, constants.COPYFILE_EXCL);
          // Le téléversement est en 0600 sous les données : le fichier du projet garde son mode (ou 0644).
          await chmod(temp, target.st === null ? 0o644 : target.st.mode & 0o777);
          if (first.st === null) {
            // Création : `link` échoue si le nom existe (aucun écrasement possible).
            await link(temp, target.abs);
            await rm(temp, { force: true });
          } else await rename(temp, target.abs);
        } catch (error) {
          await rm(temp, { force: true }).catch(() => undefined);
          throw error;
        }
        const st = await lstat(target.abs);
        this.audit({
          kind: "fs.upload",
          project: scope.projectId,
          path: target.rel,
          size: st.size,
        });
        this.send(from, {
          type: "fsDone",
          op: "upload",
          path: target.rel,
          name: basename(target.abs),
          size: st.size,
        });
        if (touchesPolicy(target.rel)) this.deps.toShell({ type: "policyChanged" });
      });
    } finally {
      await taken.release();
    }
  }

  private async download({ root }: Scope, path: string, from: Sink): Promise<void> {
    const target = await resolveTarget(root, path, { mustExist: true });
    if (!target.st?.isFile()) throw new CodedError("fs.notFile");
    const fh = await this.openFile(target);
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw new CodedError("fs.notFile");
      if (st.size > FS_MAX_DOWNLOAD) throw new CodedError("fs.tooLarge", { max: FS_MAX_DOWNLOAD });
      const size = st.size;
      async function* chunks(): AsyncGenerator<Buffer> {
        try {
          let left = size;
          while (left > 0) {
            const buf = Buffer.alloc(Math.min(CHUNK, left));
            const { bytesRead } = await fh.read(buf, 0, buf.length, null);
            if (bytesRead === 0) break;
            left -= bytesRead;
            yield buf.subarray(0, bytesRead);
          }
        } finally {
          await fh.close().catch(() => undefined);
        }
      }
      const name = basename(target.abs);
      const offered = await this.deps.ctx.downloads.offer({
        filename: name,
        mime: MIME[extname(name).toLowerCase()] ?? "application/octet-stream",
        body: chunks(),
        to: from,
      });
      if (offered === null) throw new CodedError("fs.tooLarge", { max: FS_MAX_DOWNLOAD });
      this.send(from, { type: "fsDone", op: "download", path: target.rel });
    } finally {
      // Le flux ferme déjà le descripteur à sa fin ; ici, refus avant lecture ou erreur : fermeture sûre (idempotente).
      await fh.close().catch(() => undefined);
    }
  }

  /**
   * Preuve d'un fichier du projet : le texte entier (≤ 16 Kio) devient une preuve du projet actif, rattachée
   * à une nouvelle trouvaille « hypothèse » comme la capture d'éditeur de l'extension. Titre demandé à
   * l'humain ; le cœur masque les secrets avant de stocker.
   */
  private async captureEvidence(scope: Scope, path: string, from: Sink): Promise<void> {
    const target = await resolveTarget(scope.root, path, { mustExist: true });
    if (!target.st?.isFile()) throw new CodedError("fs.notFile");
    const fh = await this.openFile(target);
    let text: string;
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw new CodedError("fs.notFile");
      if (st.size > EVIDENCE_MAX_TEXT_BYTES)
        throw new CodedError("fs.tooLarge", { max: EVIDENCE_MAX_TEXT_BYTES });
      text = decodeText(await readExactly(fh, st.size), false);
    } finally {
      await fh.close().catch(() => undefined);
    }
    if (text.trim() === "") throw new CodedError("fs.empty");
    const label = await this.deps.ctx.ui.input(
      {
        title: t("Titre de la preuve"),
        label: t("Titre (200 caractères maximum)"),
        value: basename(target.abs).slice(0, 200),
      },
      from,
    );
    if (label === null || label.trim() === "" || label.trim().length > 200)
      return this.send(from, { type: "fsCancelled", op: "fsCaptureEvidence", path: target.rel });
    const again = await this.sameScope(scope);
    const lines = text.split("\n").length;
    const evidence = await createEvidence(this.deps.configDir, again.projectId, {
      label: label.trim(),
      text,
      source: { kind: "editor", reference: target.rel, startLine: 1, endLine: lines },
    });
    await appendFinding(this.deps.configDir, again.projectId, {
      kind: "step",
      state: "hypothesis",
      label: label.trim(),
      evidenceIds: [evidence.id],
    });
    this.send(from, { type: "fsDone", op: "evidence", path: target.rel, evidenceId: evidence.id });
  }
}

/** Suppression par défaut : récursive pour un dossier, sans suivre aucun lien. */
async function defaultRemove(path: string, recursive: boolean): Promise<void> {
  if (recursive) await rm(path, { recursive: true });
  else await unlink(path);
}

/** `etag` attendu : `null` pour une création (le fichier ne doit pas exister), sinon la version lue. */
function matches(st: { mtimeMs: number; size: number } | null, etag: string | null): boolean {
  if (st === null) return etag === null;
  return etag !== null && etagOf(st) === etag;
}

/** Lit `size` octets au plus (fin de fichier atteinte plus tôt : ce qui existe). */
async function readExactly(fh: FileHandle, size: number): Promise<Buffer> {
  const buf = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const { bytesRead } = await fh.read(buf, off, size - off, off);
    if (bytesRead === 0) break;
    off += bytesRead;
  }
  return off === size ? buf : buf.subarray(0, off);
}

/** UTF-8 strict (BOM conservé). Un NUL ou une séquence invalide : fichier binaire. */
function decodeText(buf: Buffer, truncated: boolean): string {
  if (buf.subarray(0, SNIFF).includes(0)) throw new CodedError("fs.notText");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  // Lecture tronquée : la coupure peut tomber au milieu d'un caractère (jusqu'à 3 octets).
  for (let cut = 0; cut <= (truncated ? 3 : 0); cut++) {
    try {
      return decoder.decode(buf.subarray(0, buf.length - cut));
    } catch {
      // essai suivant
    }
  }
  throw new CodedError("fs.notText");
}
