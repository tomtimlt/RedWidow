import { randomUUID } from "node:crypto";
import { CREDENTIAL_TOOL } from "./credential.js";
import { type EngineEvent, EVENT_SCHEMA_VERSION, type EventPayload } from "./events.js";
import { createRedactor, createSecretMasker, type Redactor, secretsFromEnv } from "./redact.js";

/** Consommateur d'événements (journal, UI, collecteur de tests…). */
export type EventSink = (event: EngineEvent) => void;

export interface Recorder {
  readonly runId: string;
  emit(payload: EventPayload, parentId?: string | null): EngineEvent;
  subscribe(sink: EventSink): () => void;
  /**
   * Flux asynchrone des événements émis À PARTIR de cet appel (l'abonnement est
   * immédiat, pas au premier `next()`), avec tampon non borné. Se termine,
   * après avoir rendu les événements déjà tamponnés, sur `abort` du signal ou
   * sur `close()`.
   */
  stream(signal?: AbortSignal): AsyncIterable<EngineEvent>;
  /** Termine tous les flux (présents et futurs). N'empêche ni `emit` ni les sinks. */
  close(): void;
  /**
   * Apprend un secret à masquer dans tout événement émis À PARTIR de cet appel (valeur et variantes
   * encodées). S'ajoute au masquage existant sans le remplacer ; sans effet sous 6 caractères.
   * Le recorder l'applique aussi de lui-même à l'entrée d'un appel `store_credential` avant de l'enregistrer.
   */
  addSecret(value: string): void;
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
  const learned = createSecretMasker();
  const sinks = new Set<EventSink>();
  /** Arrêts des flux ouverts par `stream()`. */
  const streams = new Set<() => void>();
  let closed = false;
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

  const build = (payload: EventPayload, parentId: string | null): EngineEvent => {
    // Le secret d'un identifiant à enregistrer est appris AVANT de masquer sa propre entrée.
    if (payload.kind === "tool.requested" && payload.tool === CREDENTIAL_TOOL) {
      const secret = (payload.input as { secret?: unknown } | undefined)?.secret;
      if (typeof secret === "string") learned.add(secret);
    }
    return {
      v: EVENT_SCHEMA_VERSION,
      id: newId(),
      seq: seq++,
      ts: now().toISOString(),
      runId,
      parentId,
      ...learned.redact(redact(payload)),
    } as EngineEvent;
  };

  return {
    runId,
    addSecret(value) {
      learned.add(value);
    },
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
    stream(signal) {
      const buffer: EngineEvent[] = [];
      let ended = closed || signal?.aborted === true;
      let wake: (() => void) | null = null;
      const sink: EventSink = (event) => {
        buffer.push(event);
        wake?.();
      };
      const end = () => {
        ended = true;
        sinks.delete(sink);
        streams.delete(end);
        signal?.removeEventListener("abort", end);
        wake?.();
      };
      if (!ended) {
        sinks.add(sink);
        streams.add(end);
        signal?.addEventListener("abort", end, { once: true });
      }
      return {
        [Symbol.asyncIterator]: () => ({
          async next(): Promise<IteratorResult<EngineEvent>> {
            while (buffer.length === 0 && !ended) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              wake = null;
            }
            const event = buffer.shift();
            return event === undefined
              ? { done: true, value: undefined }
              : { done: false, value: event };
          },
          async return(): Promise<IteratorResult<EngineEvent>> {
            end();
            buffer.length = 0;
            return { done: true, value: undefined };
          },
        }),
      };
    },
    close() {
      closed = true;
      for (const end of [...streams]) end();
    },
  };
}
