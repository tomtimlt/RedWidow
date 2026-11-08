import {
  createOutputCapture,
  MOUNT_NOTE,
  OUTPUT_MAX_LINES,
  streamText,
} from "../docker/output-capture.js";

/** Taille historique au-delà de laquelle une réponse n'était plus renvoyée telle quelle. */
const SHORT_RESPONSE_CHARS = 16_384;

const lineCount = (text: string) => (text === "" ? 0 : text.split("\n").length);

/**
 * Réponse d'un outil Kali pour le modèle. Une réponse courte reste telle quelle. Une réponse
 * longue est sauvegardée (stdout.txt, stderr.txt sous `outputs/warband-exec-<id>/`) et rendue en
 * JSON valide : stdout et stderr en extrait tête + marqueur + queue, avec tailles et chemins.
 * Une réponse non analysable (coupée, autre forme) devient un texte explicite, jamais un JSON
 * tronqué présenté comme valide.
 */
export function renderKaliResponse(raw: string, outputRoot: string | undefined): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const body =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  const stdout = typeof body?.stdout === "string" ? body.stdout : undefined;
  const stderr = typeof body?.stderr === "string" ? body.stderr : "";
  if (body !== undefined && stdout !== undefined) {
    const short =
      raw.length <= SHORT_RESPONSE_CHARS &&
      lineCount(stdout) <= OUTPUT_MAX_LINES &&
      lineCount(stderr) <= OUTPUT_MAX_LINES;
    if (short) return raw;
    const capture = createOutputCapture(outputRoot);
    capture.write("stdout", stdout);
    capture.write("stderr", stderr);
    const out = capture.finish();
    const saved = out.stdout.file !== undefined || out.stderr.file !== undefined;
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === "stdout" || key === "stderr") continue;
      if ((JSON.stringify(value) ?? "").length <= 4096) extra[key] = value;
    }
    return JSON.stringify({
      ...extra,
      stdout: streamText(out.stdout),
      stderr: streamText(out.stderr),
      stdout_bytes: out.stdout.bytes,
      stderr_bytes: out.stderr.bytes,
      stdout_lines: out.stdout.lines,
      stderr_lines: out.stderr.lines,
      ...(saved && {
        output_files: {
          ...(out.stdout.file && { stdout: out.stdout.file }),
          ...(out.stderr.file && { stderr: out.stderr.file }),
        },
        note: MOUNT_NOTE,
      }),
    });
  }
  if (raw.length <= SHORT_RESPONSE_CHARS && lineCount(raw) <= OUTPUT_MAX_LINES) return raw;
  // Réponse volumineuse non analysable (coupée au plafond de transport, ou autre forme).
  const capture = createOutputCapture(outputRoot);
  capture.write("stdout", raw);
  const out = capture.finish();
  const view = out.stdout;
  const text = view.file
    ? `… ${raw.length} caractères ; corps complet : ${view.file} ; à relire avec read_output`
    : "… corps non sauvegardé (aucun dossier de projet disponible)";
  const reason =
    body === undefined
      ? "réponse non analysable : JSON invalide ou coupé au plafond de transport"
      : "réponse JSON sans champ stdout";
  return [
    reason,
    `${raw.length} caractères au total, extrait du début puis de la fin :`,
    raw.slice(0, 2000),
    text,
    raw.slice(-2000),
    ...(view.file ? [MOUNT_NOTE] : []),
  ].join("\n");
}
