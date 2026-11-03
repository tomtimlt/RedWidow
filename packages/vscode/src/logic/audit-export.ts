import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { open, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type AuditStore, type AuditView, listEvidence } from "@warband/core";
import { auditLabel, type Locale, uiText } from "@warband/messages";
import { ZipFile } from "yazl";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Aperçu autonome borné : aucune sortie non fiable ne devient du HTML ou du JavaScript. */
export function auditHtml(name: string, view: AuditView, locale: Locale): string {
  const t = (key: string) => uiText(locale, key),
    nonce = randomBytes(18).toString("hex");
  const tests = view.tests
    .map(
      (test) =>
        `<article><h3>${escapeHtml(test.objective)}</h3><p>${escapeHtml(test.target)} · ${escapeHtml(test.method)}</p><p><b>${escapeHtml(t(test.reviewed ? "Revu par l’opérateur" : "À qualifier"))}</b> · ${escapeHtml(auditLabel(test.execution, locale))} · ${escapeHtml(auditLabel(test.conclusion, locale))}</p><p>${escapeHtml(test.testContext)} · ${escapeHtml(test.startedAt)} → ${escapeHtml(test.ts)} · ${escapeHtml(auditLabel(test.author, locale))}</p><pre>${escapeHtml(test.observed)}</pre><small>${escapeHtml(test.evidenceIds.join(", "))}</small></article>`,
    )
    .join("");
  const rows = view.records
    .map(
      (row) =>
        `<details data-actor="${row.actor}"><summary>${escapeHtml(row.ts)} · ${escapeHtml(row.actor)} · ${escapeHtml(row.data.kind ?? row.kind)} · ${escapeHtml(row.source ?? row.runId ?? "")}</summary><p>ID : ${row.id}</p><pre>${escapeHtml(JSON.stringify(row.data, null, 2))}</pre></details>`,
    )
    .join("");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><title>${escapeHtml(name)} — Audit</title><style nonce="${nonce}">body{font:15px system-ui;margin:32px auto;max-width:1100px;padding:0 20px;color:#17202a}header,article,details{border:1px solid #ccd2d8;border-radius:10px;padding:16px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f8;padding:12px}small{overflow-wrap:anywhere}input,select{padding:8px;margin:8px}details[hidden]{display:none}.warning{border-left:5px solid #bb6500;padding:12px;background:#fff5e8}@media print{input,select{display:none}}</style></head><body><header><h1>${escapeHtml(name)} — Audit</h1><p>${escapeHtml(t("Une exécution enregistrée ne constitue pas un contrôle validé."))}</p><p>${escapeHtml(t("Les journaux JSONL contiennent les traces conservées. Cet HTML est un aperçu borné."))}</p><p>${escapeHtml(t("Les captures manuelles sont périodiques et bornées ; les outils externes ne sont pas enregistrés."))}</p>${view.health.incomplete ? `<p class="warning">${escapeHtml(t("Collecte incomplète : consulter les interruptions et les limites dans manifest.json."))}</p>` : ""}</header><h2>${escapeHtml(t("Registre des contrôles"))}</h2>${tests || `<p>${escapeHtml(t("Aucun contrôle enregistré."))}</p>`}<h2>${escapeHtml(t("Journal de mission"))}</h2><label>${escapeHtml(t("Filtrer"))} <input id="filter" type="search"></label><select id="actor"><option value="">${escapeHtml(t("Tous les acteurs"))}</option><option value="agent">Agent</option><option value="operator">${escapeHtml(t("Opérateur"))}</option><option value="system">${escapeHtml(t("Système"))}</option></select><section id="records">${rows}</section><script nonce="${nonce}">const filter=document.getElementById('filter'),actor=document.getElementById('actor');function apply(){const q=filter.value.toLowerCase();for(const row of document.querySelectorAll('#records details'))row.hidden=!!actor.value&&row.dataset.actor!==actor.value||!row.textContent.toLowerCase().includes(q)}filter.addEventListener('input',apply);actor.addEventListener('change',apply);</script></body></html>`;
}

/** Export local sur une coupe en octets, sans suspendre ni réexécuter la mission. */
export async function exportAuditBundle(options: {
  store: AuditStore;
  projectId: string;
  projectName: string;
  destination: string;
  locale: Locale;
  beforeCommit(): Promise<void>;
}): Promise<{ sha256: string; files: number }> {
  const { store, projectId, destination, locale } = options;
  await store.flush(projectId);
  const configRoot = await realpath(store.configDir),
    parent = await realpath(dirname(destination));
  const rel = relative(configRoot, parent);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
    throw Error(uiText(locale, "Le dossier d’audit ne peut pas être écrasé par son export."));
  const files = await store.files(projectId),
    view = await store.view(projectId);
  const capturedAt = new Date().toISOString();
  const manifest: Record<string, unknown> = {
    version: 1,
    projectId,
    projectName: options.projectName,
    capturedAt,
    health: view.health,
    scope: "managed-project-actions",
    collection: {
      automatic: true,
      chatIncluded: false,
      manual: "periodic bounded snapshots, not exhaustive command instrumentation",
      htmlRecords: view.records.length,
      htmlLimited: view.viewLimited,
      testRegistryLimited: view.viewLimited,
      independentTimestamp: false,
      cryptographicSignature: false,
      retention: "no automatic deletion",
    },
    files: [],
  };
  const entries: { name: string; size: number; sha256: string }[] = [];
  for (const file of files) {
    const hash = createHash("sha256");
    if (file.size) {
      const handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      for await (const part of handle.createReadStream({ start: 0, end: file.size - 1 }))
        hash.update(part);
    }
    entries.push({ name: `journals/${file.name}`, size: file.size, sha256: hash.digest("hex") });
  }
  const evidence = await listEvidence(store.configDir, projectId);
  const buffers = [
    { name: "index.html", data: Buffer.from(auditHtml(options.projectName, view, locale)) },
    {
      name: "tests.json",
      data: Buffer.from(JSON.stringify({ limited: view.viewLimited, tests: view.tests }, null, 2)),
    },
    { name: "evidence.json", data: Buffer.from(JSON.stringify(evidence, null, 2)) },
  ];
  for (const file of buffers)
    entries.push({ name: file.name, size: file.data.length, sha256: digest(file.data) });
  manifest.files = entries;
  // Les types de yazl 2 omettent son héritage EventEmitter.
  const archive = new ZipFile() as ZipFile & EventEmitter,
    temporary = join(parent, `.venator-audit-${randomUUID()}.tmp`);
  const inputs = new Set<Readable>();
  archive.on("error", (error: Error) => (archive.outputStream as Readable).destroy(error));
  const writing = pipeline(
    archive.outputStream,
    createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
  );
  // Les erreurs de flux ne doivent pas devenir des promesses rejetées sans observateur.
  void writing.catch(() => undefined);
  try {
    for (const file of files) {
      if (file.size) {
        const handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const stream = handle.createReadStream({ start: 0, end: file.size - 1 });
        inputs.add(stream);
        stream.once("close", () => inputs.delete(stream));
        stream.on("error", (error) => (archive.outputStream as Readable).destroy(error));
        archive.addReadStream(stream, `journals/${file.name}`, { size: file.size, mode: 0o600 });
      } else archive.addBuffer(Buffer.alloc(0), `journals/${file.name}`);
    }
    for (const file of buffers) archive.addBuffer(file.data, file.name, { mode: 0o600 });
    archive.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), "manifest.json", {
      mode: 0o600,
    });
    archive.end();
    await writing;
    await options.beforeCommit();
    await rename(temporary, destination);
    const hash = createHash("sha256");
    for await (const part of createReadStream(destination)) hash.update(part);
    return { sha256: hash.digest("hex"), files: files.length + buffers.length + 1 };
  } catch (error) {
    for (const stream of inputs) stream.destroy();
    (archive.outputStream as import("node:stream").Readable).destroy();
    await writing.catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}
