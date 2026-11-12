import { describe, expect, it } from "vitest";
import { deskToolSpecs } from "../src/agent-desk.js";
import { DEFAULT_POLICY, evaluatePolicy } from "../src/approval/policy.js";
import { CREDENTIAL_TOOL, type CredentialStore, credentialInputSchema } from "../src/credential.js";
import { createMissionDesk } from "../src/mission-desk.js";
import { createRecorder } from "../src/recorder.js";
import { createSecretMasker, REDACTED } from "../src/redact.js";

const SECRET = "tok_0123456789abcdefSECRET";

describe("masqueur de secrets appris", () => {
  it("masque la valeur et ses variantes encodées, ignore les valeurs trop courtes", () => {
    const masker = createSecretMasker();
    expect(masker.add("abc")).toBe(false);
    expect(masker.add("a/b c&d=e+valeur")).toBe(true);
    const out = masker.redact({
      kind: "agent.text",
      text: `brut a/b c&d=e+valeur, url ${encodeURIComponent("a/b c&d=e+valeur")}, b64 ${Buffer.from("a/b c&d=e+valeur").toString("base64")}, abc`,
    });
    expect(JSON.stringify(out)).not.toContain("valeur");
    expect(out.text).toContain(`, abc`);
    expect(out.kind).toBe("agent.text");
  });

  it("ne réécrit pas les champs structurels et ne fait rien tant que rien n'est appris", () => {
    const masker = createSecretMasker();
    const event = { kind: "tool.requested", toolUseId: "agent_secret_id", input: { a: 1 } };
    expect(masker.redact(event)).toEqual(event);
    masker.add("agent_secret_id");
    expect(masker.redact(event)).toEqual(event);
    expect(masker.redact({ kind: "x", text: "agent_secret_id" })).toEqual({
      kind: "x",
      text: REDACTED,
    });
  });
});

describe("recorder : addSecret", () => {
  const collect = () => {
    const recorder = createRecorder({ redact: false });
    const events: unknown[] = [];
    recorder.subscribe((e) => events.push(e));
    return { recorder, events };
  };

  it("masque à partir de l'appel, sans toucher à ce qui a déjà été émis", () => {
    const { recorder, events } = collect();
    recorder.emit({ kind: "agent.text", text: `avant ${SECRET}` });
    recorder.addSecret(SECRET);
    recorder.emit({ kind: "agent.text", text: `après ${SECRET}` });
    expect(JSON.stringify(events[0])).toContain(SECRET);
    expect(JSON.stringify(events[1])).not.toContain(SECRET);
    expect(JSON.stringify(events[1])).toContain(REDACTED);
  });

  it("apprend le secret de l'entrée d'un appel store_credential avant de l'enregistrer", () => {
    const { recorder, events } = collect();
    recorder.emit({
      kind: "tool.requested",
      toolUseId: "t1",
      tool: CREDENTIAL_TOOL,
      input: { label: "A", secret: SECRET, kind: "token", note: `dans une autre clé ${SECRET}` },
    });
    recorder.emit({ kind: "agent.thinking", text: `le jeton ${SECRET}`, redacted: false });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("n'apprend rien d'un autre outil", () => {
    const { recorder, events } = collect();
    recorder.emit({
      kind: "tool.requested",
      toolUseId: "t1",
      tool: "mcp__desk__record_decision",
      input: { secret: SECRET },
    });
    expect(JSON.stringify(events)).toContain(SECRET);
  });

  it("s'ajoute au masqueur fourni sans l'affaiblir", () => {
    const recorder = createRecorder({
      redact: (value) => JSON.parse(JSON.stringify(value).replaceAll("existant-12345", REDACTED)),
    });
    const events: unknown[] = [];
    recorder.subscribe((e) => events.push(e));
    recorder.addSecret(SECRET);
    recorder.emit({ kind: "agent.text", text: `existant-12345 ${SECRET}` });
    expect(JSON.stringify(events)).not.toContain("existant-12345");
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});

describe("bureau : outil store_credential", () => {
  const input = { label: "ADMIN", login: "root", secret: SECRET, kind: "token" } as const;
  const desk = (store?: CredentialStore) => {
    const recorder = createRecorder({ redact: false });
    const events: unknown[] = [];
    recorder.subscribe((e) => events.push(e));
    return {
      events,
      recorder,
      desk: createMissionDesk({ recorder, ...(store && { storeCredential: store }) }),
    };
  };

  it("n'existe que si l'hôte offre le stockage", () => {
    expect(deskToolSpecs(desk().desk).map((s) => s.name)).not.toContain("store_credential");
    expect(deskToolSpecs().map((s) => s.name)).not.toContain("store_credential");
    const spec = deskToolSpecs(desk(async () => ({ ok: true })).desk).find(
      (s) => s.name === "store_credential",
    );
    expect(spec?.readOnly).toBe(false);
  });

  it("ne renvoie que {ok, id}, même si l'hôte répond davantage", async () => {
    const seen: unknown[] = [];
    const { desk: d } = desk(async (i) => {
      seen.push(i);
      return { ok: true, id: "acc-1", secret: i.secret } as never;
    });
    const spec = deskToolSpecs(d).find((s) => s.name === "store_credential");
    const out = await spec?.run(input, {
      parentId: null,
      correlation: undefined,
      signal: undefined,
    });
    expect(JSON.parse(out ?? "")).toEqual({ ok: true, id: "acc-1" });
    expect(out).not.toContain(SECRET);
    expect(seen).toEqual([input]);
  });

  it("refus de l'hôte : {ok:false} sans id ; apprend le secret au recorder", async () => {
    const { desk: d, recorder, events } = desk(async () => ({ ok: false, id: "ignoré" }));
    expect(await d.storeCredential(input)).toEqual({ ok: false });
    recorder.emit({ kind: "agent.text", text: SECRET });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("valide l'entrée : libellé hors format, type inconnu, clé en trop, NUL", () => {
    expect(credentialInputSchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { ...input, label: "minuscule" },
      { ...input, kind: "autre" },
      { ...input, extra: 1 },
      { ...input, secret: "a\0b" },
      { ...input, secret: "" },
    ])
      expect(credentialInputSchema.safeParse(bad).success).toBe(false);
  });

  it("la politique par défaut demande toujours (jamais allow)", () => {
    const verdict = evaluatePolicy(DEFAULT_POLICY, CREDENTIAL_TOOL, { ...input });
    expect(verdict.decision).toBe("ask");
  });
});
