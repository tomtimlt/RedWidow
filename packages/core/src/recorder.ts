import { randomUUID } from "node:crypto";
import { type EngineEvent, EVENT_SCHEMA_VERSION, type EventPayload } from "./events.js";
import { createRedactor, type Redactor, secretsFromEnv } from "./redact.js";

/** Consommateur d'événements (journal, UI, collecteur de tests…). */
export type EventSink = (event: EngineEvent) => void;

export interface Recorder {
  readonly runId: string;
  emit(payload: EventPayload, parentId?: string | null): EngineEvent;
  subscribe(sink: EventSink): () => void;
}

export interface RecorderOptions {
  runId?: string;
  now?: () => Date;
  newId?: () => string;
  /**
   * Masque les secrets de chaque charge utile avant diffusion aux sinks.
   * Par défaut : motifs usuels + valeurs des variables sensibles de `process.env`.
   * `false` désactive le masquage (tests uniquement).
   */
  redact?: Redactor | false;
  /**
   * Appelé quand un sink lève une exception (en plus de l'événement `sink.error`
   * diffusé aux autres sinks). Ne doit pas lever ; s'il le fait, c'est ignoré.
   */
  onSinkError?: (error: unknown, event: EngineEvent) => void;
}

/**
 * Horodate, numérote, masque les secrets et diffuse les événements. Une erreur
 * levée par un sink n'interrompt ni le moteur ni les autres sinks : elle est
 * signalée par un événement `sink.error` (diffusé aux autres sinks seulement)
 * et par `options.onSinkError`. Une erreur survenue pendant le traitement d'un
 * `sink.error` n'en génère pas d'autre (pas de récursion).
 */
export function createRecorder(options: RecorderOptions = {}): Recorder {
  const runId = options.runId ?? randomUUID();
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const redact: Redactor =
    options.redact === false
      ? (value) => value
      : (options.redact ?? createRedactor({ values: secretsFromEnv(process.env) }));
  const sinks = new Set<EventSink>();
  let seq = 0;

  const notify = (error: unknown, event: EngineEvent) => {
    try {
      options.onSinkError?.(error, event);
    } catch {
      // Le rappel d'observation ne doit pas casser le run non plus.
    }
  };

  /** Diffuse `event` ; renvoie les sinks fautifs avec leur erreur. */
  const deliver = (event: EngineEvent, except?: ReadonlySet<EventSink>) => {
    const failed: { sink: EventSink; error: unknown }[] = [];
    for (const sink of [...sinks]) {
      if (except?.has(sink)) continue;
      try {
        sink(event);
      } catch (error) {
        failed.push({ sink, error });
      }
    }
    return failed;
  };

  const build = (payload: EventPayload, parentId: string | null): EngineEvent =>
    ({
      v: EVENT_SCHEMA_VERSION,
      id: newId(),
      seq: seq++,
      ts: now().toISOString(),
      runId,
      parentId,
      ...redact(payload),
    }) as EngineEvent;

  return {
    runId,
    emit(payload, parentId = null) {
      const event = build(payload, parentId);
      const failed = deliver(event);
      if (event.kind === "sink.error") {
        // Pas de sink.error en cascade : on se contente d'observer.
        for (const { error } of failed) notify(error, event);
        return event;
      }
      for (const { sink, error } of failed) {
        notify(error, event);
        const message = error instanceof Error ? error.message : String(error);
        const report = build({ kind: "sink.error", message }, event.id);
        for (const again of deliver(report, new Set([sink]))) notify(again.error, report);
      }
      return event;
    },
    subscribe(sink) {
      sinks.add(sink);
      return () => sinks.delete(sink);
    },
  };
}
