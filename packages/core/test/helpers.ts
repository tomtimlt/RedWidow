import { realpathSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCKER_LABEL_PREFIX_INSPECT_FORMAT } from "../src/docker/client.js";

export const FAKE_EXEGOL_LABEL_LEAK = "org.exegol.metadata.passwd";
export const FAKE_EXEGOL_DESK_URL = "https://desk.exegol.local/secret-session";

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
const labelFmt = ${JSON.stringify(DOCKER_LABEL_PREFIX_INSPECT_FORMAT)};
const leak = ${JSON.stringify(FAKE_EXEGOL_LABEL_LEAK)};
const desk = ${JSON.stringify(FAKE_EXEGOL_DESK_URL)};
const [cmd, arg1] = argv;
if (cmd === "ps" && argv.includes("--quiet") && argv.includes("--all")) {
  for (const id of ["keep-ws", "keep-nows", "skip-nolabel", "keep-stopped"]) out(id);
} else if (cmd === "inspect" && arg1 === "--format") {
  const fmt = argv[2];
  if (fmt === labelFmt) {
    for (const id of argv.slice(3)) {
      if (id === "skip-nolabel") continue;
      if (id === "keep-ws") {
        out(JSON.stringify({ state: "running", name: "/with-ws", image: "img:1", workspace: "/host/ws" }));
      } else if (id === "keep-nows") {
        out(JSON.stringify({ state: "running", name: "/no-ws", image: "img:2" }));
      } else if (id === "keep-stopped") {
        out(JSON.stringify({ state: "stopped", name: "/paused", image: "img:3" }));
      }
    }
  } else {
    out(JSON.stringify({ label: leak, url: desk }));
  }
} else switch (cmd) {
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
