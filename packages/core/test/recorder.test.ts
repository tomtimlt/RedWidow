import { describe, expect, it } from "vitest";
import { createRecorder, type EngineEvent, EVENT_SCHEMA_VERSION } from "../src/index.js";

describe("recorder", () => {
  it("pose la version du schéma sur chaque événement", () => {
    const r = createRecorder({ runId: "r" });
    expect(r.emit({ kind: "error", message: "x" })).toMatchObject({ v: EVENT_SCHEMA_VERSION });
  });

  describe("erreurs de sink", () => {
    it("émet sink.error vers les autres sinks, sans le sink fautif, et appelle onSinkError", () => {
      const seen: [unknown, EngineEvent][] = [];
      const r = createRecorder({ runId: "r", onSinkError: (err, e) => seen.push([err, e]) });
      const healthy: EngineEvent[] = [];
      const faulty: EngineEvent[] = [];
      r.subscribe((e) => {
        faulty.push(e);
        throw new Error("disque plein");
      });
      r.subscribe((e) => healthy.push(e));

      const source = r.emit({ kind: "agent.text", text: "a" });

      expect(healthy.map((e) => e.kind)).toEqual(["agent.text", "sink.error"]);
      expect(healthy[1]).toMatchObject({
        kind: "sink.error",
        message: "disque plein",
        parentId: source.id,
        seq: source.seq + 1,
      });
      expect(faulty.map((e) => e.kind)).toEqual(["agent.text"]);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.[1]).toBe(source);
    });

    it("ne boucle pas : une erreur pendant sink.error est ignorée", () => {
      const onSinkError: (err: unknown) => void = () => {
        throw new Error("rappel défaillant");
      };
      const r = createRecorder({ runId: "r", onSinkError });
      let calls = 0;
      const a = () => {
        calls++;
        throw new Error("a");
      };
      const b = () => {
        calls++;
        throw new Error("b");
      };
      r.subscribe(a);
      r.subscribe(b);
      const out: EngineEvent[] = [];
      expect(() => out.push(r.emit({ kind: "error", message: "x" }))).not.toThrow();
      // a et b reçoivent l'événement (2) ; chacun reçoit le sink.error de l'autre (2), puis rien.
      expect(calls).toBe(4);
      expect(out[0]?.seq).toBe(0);
      // Le compteur reprend normalement derrière les sink.error.
      expect(r.emit({ kind: "error", message: "y" }).seq).toBe(3);
    });

    it("un sink.error ne provoque pas de sink.error en cascade", () => {
      const r = createRecorder({ runId: "r" });
      const kinds: string[] = [];
      r.subscribe(() => {
        throw new Error("toujours");
      });
      r.subscribe((e) => kinds.push(e.kind));
      r.emit({ kind: "agent.text", text: "a" });
      expect(kinds).toEqual(["agent.text", "sink.error"]);
    });
  });

  describe("masquage des secrets", () => {
    const secret = "sk-ant-abcdefgh12345678";
    const collect = () => {
      const r = createRecorder({ runId: "r" });
      const events: EngineEvent[] = [];
      r.subscribe((e) => events.push(e));
      return { r, events };
    };

    it("masque tool.result.output, pensée et erreurs de sink", () => {
      const { r, events } = collect();
      r.emit({
        kind: "tool.result",
        toolUseId: "t",
        isError: false,
        output: `clé ${secret} et password=hunter2hunter2`,
        truncated: false,
        bytes: 10,
      });
      r.emit({ kind: "agent.thinking", text: `utilise ${secret}`, redacted: false });
      r.emit({ kind: "permission.denied", toolUseId: "t", tool: "x", message: `refus ${secret}` });
      r.emit({
        kind: "api.retry",
        attempt: 1,
        maxRetries: 2,
        delayMs: 1,
        errorStatus: 500,
        error: secret,
      });
      r.subscribe(() => {
        throw new Error(`échec avec ${secret}`);
      });
      r.emit({ kind: "error", message: "x" });
      const text = JSON.stringify(events);
      expect(text).not.toContain("abcdefgh12345678");
      expect(text).not.toContain("hunter2hunter2");
      expect(events.find((e) => e.kind === "sink.error")).toBeDefined();
    });

    it("conserve l'identifiant de session (clé sessionId non masquée)", () => {
      const { r, events } = collect();
      r.emit({ kind: "session.started", sessionId: "sess-123", model: "m", tools: ["Read"] });
      expect(events[0]).toMatchObject({ sessionId: "sess-123" });
    });
  });
});
