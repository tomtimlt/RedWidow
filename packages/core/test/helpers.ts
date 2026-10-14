import { realpathSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Faux docker portable : script Node `.mjs` lancé via `process.execPath` + `argsPrefix`
 * (sans shell ni bit d'exécution). Journalise son argv (un appel par ligne, `|` entre arguments).
 */
export async function fakeDocker(): Promise<{
  bin: string;
  argsPrefix: string[];
  calls: () => Promise<string[]>;
}> {
  const dir = await mkdtemp(join(realpathSync.native(tmpdir()), "john-fake-docker-"));
  const script = join(dir, "docker.mjs");
  const log = join(dir, "calls.log");
  await writeFile(
    script,
    `import { appendFileSync } from "node:fs";
const [, , ...argv] = process.argv;
appendFileSync(${JSON.stringify(log)}, argv.join("|") + "|\\n");
const out = (s) => process.stdout.write(s + "\\n");
const err = (s) => process.stderr.write(s + "\\n");
switch (argv[0]) {
  case "ps": out('{"ID":"1","Names":"web","Image":"nginx","State":"running","Status":"Up","Ports":""}'); break;
  case "images": out('{"ID":"i1","Repository":"nginx","Tag":"latest","Size":"10MB"}'); break;
  case "logs": out("out-line"); err("err-line"); break;
  case "inspect": out('[{"Id":"abc"}]'); break;
  case "run": out("cid123"); break;
  case "start": case "stop": case "rm":
    if (argv[1] === "nope") { err("no such container"); process.exit(1); }
    out(argv[1]);
    break;
}
`,
  );
  return {
    bin: process.execPath,
    argsPrefix: [script],
    calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
  };
}

export const FAKE_SANDBOX_ID = "a".repeat(64);

/** `inspect` conforme au bac à sable durci du run `runId`. */
export const goodInspect = (runId: string, id = FAKE_SANDBOX_ID) => ({
  Id: id,
  State: { Running: true },
  Config: { User: "65534:65534", Labels: { "io.john-studio.sandbox": runId } },
  Mounts: [],
  HostConfig: {
    Privileged: false,
    CapAdd: null,
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    Binds: null,
    Devices: [],
    NetworkMode: "none",
    PidMode: "",
    IpcMode: "private",
    UTSMode: "",
    UsernsMode: "",
  },
});

export interface FakeSandboxControl {
  /** Résultat de `container inspect` (relu à chaque appel). */
  container?: unknown;
  /** `image inspect` échoue (image absente). */
  imageMissing?: boolean;
  /** `run` échoue avec ce message sur stderr. */
  runFails?: string;
  /** Sortie de `run` (défaut : `FAKE_SANDBOX_ID`). */
  runOutput?: string;
  /** Un `exec` dont l'argv contient ce mot échoue (code 1). */
  execFailsOn?: string;
  restartFails?: boolean;
  /** Durée du `restart` (ms) : éprouve qu'il survit à l'annulation de l'appelant. */
  restartDelayMs?: number;
  rmFails?: boolean;
}

/**
 * Faux docker pour le bac à sable : comme `fakeDocker`, avec un fichier de contrôle
 * relu à chaque appel (altérer `inspect`, faire échouer une étape). Un `exec` dont
 * l'argv contient `hang` ne se termine jamais (test des délais).
 */
export async function fakeSandboxDocker(): Promise<{
  bin: string;
  argsPrefix: string[];
  calls: () => Promise<string[]>;
  control: (c: FakeSandboxControl) => Promise<void>;
}> {
  const dir = await mkdtemp(join(realpathSync.native(tmpdir()), "john-fake-sbx-"));
  const script = join(dir, "docker.mjs");
  const log = join(dir, "calls.log");
  const ctl = join(dir, "ctl.json");
  await writeFile(ctl, "{}");
  await writeFile(
    script,
    `import { appendFileSync, readFileSync } from "node:fs";
const [, , ...argv] = process.argv;
appendFileSync(${JSON.stringify(log)}, argv.join("|") + "|\\n");
const c = JSON.parse(readFileSync(${JSON.stringify(ctl)}, "utf8"));
const out = (s) => process.stdout.write(s + "\\n");
const fail = (s) => { process.stderr.write(s + "\\n"); process.exit(1); };
const [a, b] = argv;
if (a === "image" && b === "inspect") {
  if (c.imageMissing) fail("Error: No such image: " + argv[2]);
  out(JSON.stringify([{ Id: "sha256:img", RepoDigests: ["alpine@sha256:digest"] }]));
} else if (a === "run") {
  if (c.runFails) fail(c.runFails);
  out(c.runOutput ?? ${JSON.stringify(FAKE_SANDBOX_ID)});
} else if (a === "container" && b === "inspect") {
  out(JSON.stringify(c.container));
} else if (a === "exec") {
  if (c.execFailsOn && argv.includes(c.execFailsOn)) fail("exec failed");
  if (argv.includes("hang")) setInterval(() => {}, 1000);
  else out("exec-ok");
} else if (a === "restart") {
  if (c.restartDelayMs) await new Promise((r) => setTimeout(r, c.restartDelayMs));
  if (c.restartFails) fail("cannot restart");
  out(argv[argv.length - 1]);
} else if (a === "rm") {
  if (c.rmFails) fail("cannot remove");
  out(argv[argv.length - 1]);
}
`,
  );
  return {
    bin: process.execPath,
    argsPrefix: [script],
    calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
    control: (c) => writeFile(ctl, JSON.stringify(c)),
  };
}
