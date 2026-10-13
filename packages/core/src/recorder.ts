import { randomUUID } from "node:crypto";
import type { EngineEvent, EventPayload } from "./events.js";

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
}

/**
 * Horodate, numérote et diffuse les événements. Une erreur levée par un sink
 * n'interrompt ni le moteur ni les autres sinks.
 */
export function createRecorder(options: RecorderOptions = {}): Recorder {
  const runId = options.runId ?? randomUUID();
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const sinks = new Set<EventSink>();
  let seq = 0;

  return {
    runId,
    emit(payload, parentId = null) {
      const event = {
        id: newId(),
        seq: seq++,
        ts: now().toISOString(),
        runId,
        parentId,
        ...payload,
      } as EngineEvent;
      for (const sink of sinks) {
        try {
          sink(event);
        } catch {
          // Un sink défaillant ne doit pas casser le run.
        }
      }
      return event;
    },
    subscribe(sink) {
      sinks.add(sink);
      return () => sinks.delete(sink);
    },
  };
}
