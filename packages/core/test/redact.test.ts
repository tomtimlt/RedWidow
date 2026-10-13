import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRecorder,
  createRedactor,
  openJournal,
  REDACTED,
  secretsFromEnv,
} from "../src/index.js";

const redact = createRedactor();

describe("createRedactor", () => {
  it.each([
    "sk-ant-api03-abcdefghijklmnop",
    "sk-abcdefghijklmnopqrstuvwxyz123456",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuv",
    "glpat-abcdefghijklmnopqrst",
    "AKIAABCDEFGHIJKLMNOP",
    "xoxb-1234567890-abcdefghij",
    "eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4",
    "Bearer abcdefghijklmnop.qrst",
  ])("masque %s", (secret) => {
    const out = redact({ text: `valeur ${secret} fin` });
    expect(out.text).not.toContain(secret);
    expect(out.text).toContain(REDACTED);
  });

  it("masque les clés privées, URL avec identifiants et paires clé=valeur", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
    expect(redact(key)).toBe(REDACTED);
    expect(redact("git clone https://bob:hunter2@host/r.git")).toBe(
      `git clone https://bob:${REDACTED}@host/r.git`,
    );
    expect(redact("password=hunter2 user=bob")).toBe(`password=${REDACTED} user=bob`);
    expect(redact('API_TOKEN: "abc def"')).toBe(`API_TOKEN: ${REDACTED}`);
  });

  it("masque la valeur des clés sensibles et toutes celles d'un objet env", () => {
    const out = redact({
      kind: "tool.requested",
      input: { image: "nginx", env: { MODE: "prod", DB: "postgres://x" }, apiKey: "abc" },
    });
    expect(out.input).toEqual({
      image: "nginx",
      env: { MODE: REDACTED, DB: REDACTED },
      apiKey: REDACTED,
    });
  });

  it("masque les --env / -e d'un argv, sous toutes leurs formes", () => {
    const out = redact({
      argv: [
        "docker",
        "run",
        "--env",
        "A=1",
        "-e",
        "B=2",
        "--env=C=3",
        "--publish",
        "80:80",
        "nginx",
      ],
    });
    expect(out.argv).toEqual([
      "docker",
      "run",
      "--env",
      `A=${REDACTED}`,
      "-e",
      `B=${REDACTED}`,
      `--env=C=${REDACTED}`,
      "--publish",
      "80:80",
      "nginx",
    ]);
  });

  it("masque les valeurs littérales fournies, plus longues d'abord", () => {
    const r = createRedactor({ values: ["supersecretvalue", "supersecretvalue-long"] });
    expect(r("a supersecretvalue-long b")).toBe(`a ${REDACTED} b`);
    expect(r("tiny")).toBe("tiny");
  });

  it("ne touche ni aux nombres, ni aux booléens, ni au texte ordinaire", () => {
    const payload = {
      kind: "process.exited",
      code: 0,
      durationMs: 12,
      isError: false,
      line: "hello",
    };
    expect(redact(payload)).toEqual(payload);
  });

  it("secretsFromEnv ne retient que les variables sensibles assez longues", () => {
    expect(
      secretsFromEnv({ ANTHROPIC_API_KEY: "sk-ant-longvalue", PATH: "/usr/bin", TOKEN: "short" }),
    ).toEqual(["sk-ant-longvalue"]);
  });
});

describe("recorder + journal", () => {
  it("n'écrit aucun secret dans le journal ni dans les événements diffusés", async () => {
    const secret = "sk-ant-api03-ZZZZZZZZZZZZZZZZ";
    const dir = await mkdtemp(join(tmpdir(), "john-redact-"));
    const journal = await openJournal(join(dir, "j.jsonl"));
    const recorder = createRecorder();
    const seen: string[] = [];
    recorder.subscribe(journal.sink);
    recorder.subscribe((e) => seen.push(JSON.stringify(e)));

    const started = recorder.emit({ kind: "run.started", prompt: `clé ${secret}`, cwd: "/w" });
    recorder.emit(
      {
        kind: "tool.requested",
        toolUseId: "t",
        tool: "mcp__docker__run",
        input: { image: "pg", env: { POSTGRES_PASSWORD: "hunter2" } },
      },
      started.id,
    );
    recorder.emit({ kind: "process.started", argv: ["docker", "run", "-e", "K=hunter2"], pid: 1 });
    recorder.emit({
      kind: "process.output",
      stream: "stdout",
      line: `Authorization: Bearer ${secret}`,
    });
    await journal.close();

    const written = await readFile(join(dir, "j.jsonl"), "utf8");
    for (const text of [written, seen.join("\n")]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain("hunter2");
      expect(text).toContain(REDACTED);
    }
    expect(started).toMatchObject({ prompt: `clé ${REDACTED}` });
  });

  it("masque les valeurs de process.env au moment de la création du recorder", () => {
    process.env.JOHN_TEST_API_KEY = "valeur-secrete-unique-42";
    try {
      const recorder = createRecorder();
      const e = recorder.emit({ kind: "agent.text", text: "x valeur-secrete-unique-42 y" });
      expect(e).toMatchObject({ text: `x ${REDACTED} y` });
    } finally {
      delete process.env.JOHN_TEST_API_KEY;
    }
  });

  it("redact: false désactive le masquage", () => {
    const e = createRecorder({ redact: false }).emit({ kind: "agent.text", text: "password=abc" });
    expect(e).toMatchObject({ text: "password=abc" });
  });
});
