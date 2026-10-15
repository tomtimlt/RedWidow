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

export interface GoodInspectOptions {
  network?: "none" | "bridge";
  memoryG?: number;
  cpus?: number;
}

/** `inspect` conforme au bac à sable durci du run `runId`. */
export const goodInspect = (runId: string, id = FAKE_SANDBOX_ID, opts: GoodInspectOptions = {}) => {
  const network = opts.network ?? "none";
  const memoryG = opts.memoryG ?? 2;
  const cpus = opts.cpus ?? 2;
  const memBytes = memoryG * 1024 ** 3;
  return {
    Id: id,
    State: { Running: true },
    Config: {
      User: "65534:65534",
      Labels: { "io.john-studio.sandbox": runId },
      Env: [`HOME=/home/john`],
    },
    Mounts: [],
    NetworkSettings: {
      Networks: { [network]: {} },
      PortBindings: null,
      PublishAllPorts: false,
      ExtraHosts: null,
    },
    HostConfig: {
      Privileged: false,
      CapAdd: null,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Binds: null,
      Devices: [],
      NetworkMode: network,
      PortBindings: null,
      PublishAllPorts: false,
      ExtraHosts: null,
      PidMode: "",
      IpcMode: "private",
      UTSMode: "",
      UsernsMode: "",
      CgroupnsMode: "private",
      DeviceRequests: null,
      PidsLimit: 512,
      Memory: memBytes,
      MemorySwap: memBytes,
      NanoCpus: cpus * 1e9,
    },
  };
};

export interface FakeSandboxControl {
  /** Résultat de `container inspect` (relu à chaque appel). */
  container?: unknown;
  /** `image inspect` échoue (image absente). */
  imageMissing?: boolean;
  /** `run` échoue avec ce message sur stderr. */
  runFails?: string;
  /** `run` ne se termine jamais (annulation en cours de création). */
  runHangs?: boolean;
  /** Sortie de `run` (défaut : `FAKE_SANDBOX_ID`). */
  runOutput?: string;
  /** Un `exec` dont l'argv contient ce mot échoue (code 1). */
  execFailsOn?: string;
  restartFails?: boolean;
  /** Durée du `restart` (ms) : éprouve qu'il survit à l'annulation de l'appelant. */
  restartDelayMs?: number;
  rmFails?: boolean;
  /** Un `rm` dont l argv contient ce mot échoue. */
  rmFailsOn?: string;
  /** Texte écrit tel quel sur stdout par `exec` (défaut : `exec-ok`), avant un éventuel blocage. */
  execStdout?: string;
  /** Texte écrit tel quel sur stderr par `exec`. */
  execStderr?: string;
  /** Sortie de `ps` (une ligne par identifiant). */
  psOut?: string[];
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
  if (c.runHangs) { setInterval(() => {}, 1000); await new Promise(() => {}); }
  out(c.runOutput ?? ${JSON.stringify(FAKE_SANDBOX_ID)});
} else if (a === "container" && b === "inspect") {
  out(JSON.stringify(c.container));
} else if (a === "exec") {
  if (c.execFailsOn && argv.includes(c.execFailsOn)) fail("exec failed");
  if (c.execStdout !== undefined) process.stdout.write(c.execStdout);
  if (c.execStderr !== undefined) process.stderr.write(c.execStderr);
  if (argv.includes("hang")) setInterval(() => {}, 1000);
  else if (c.execStdout === undefined) out("exec-ok");
} else if (a === "ps") {
  for (const l of c.psOut ?? []) out(l);
} else if (a === "restart") {
  if (c.restartDelayMs) await new Promise((r) => setTimeout(r, c.restartDelayMs));
  if (c.restartFails) fail("cannot restart");
  out(argv[argv.length - 1]);
} else if (a === "rm") {
  if (c.rmFails) fail("cannot remove");
  if (c.rmFailsOn && argv.includes(c.rmFailsOn)) fail("cannot remove");
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
