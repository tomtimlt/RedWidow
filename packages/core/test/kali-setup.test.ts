import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createRecorder, prepareKaliContainer } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(
  mode:
    | "present"
    | "absent"
    | "apt-fail"
    | "foreign"
    | "stopped"
    | "not-kali"
    | "bad-health"
    | "slow-start"
    | "install-fail"
    | "verify-fail"
    | "invalid-health"
    | "nmap-fail",
) {
  const dir = await mkdtemp(join(tmpdir(), "warband-kali-setup-"));
  dirs.push(dir);
  const log = join(dir, "log");
  const script = join(dir, "docker.mjs");
  await writeFile(
    script,
    `
import {appendFileSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2), mode=${JSON.stringify(mode)}, marker=${JSON.stringify(join(dir, "installed"))};
appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args[0]==='ps'){console.log('id');process.exit(0);}
if(args[0]==='inspect'){
 console.log(JSON.stringify({state:mode==='stopped'?'stopped':'running',name:'/kali-box',image:mode==='foreign'?'exegol':'kali:test',...(mode==='foreign'?{exegol:true}:{runtimeKali:true})}));process.exit(0);
}
if(args[0]==='exec'&&args[1]==='-u'){
 const command=args.slice(4);
 if(command[0]==='sh'){
  if(command[2].includes('/etc/os-release'))process.exit(mode==='not-kali'?1:0);
  process.exit(mode==='present'||mode==='nmap-fail'||mode==='bad-health'||mode==='slow-start'||mode==='invalid-health'||(mode!=='verify-fail'&&existsSync(marker))?0:42);
 }
 if(command.includes('update'))process.exit(mode==='apt-fail'?100:0);
 if(command[0]==='python3'&&mode==='nmap-fail')process.exit(46);
 if(command.includes('install')){if(mode==='install-fail')process.exit(100);writeFileSync(marker,'yes');process.exit(0);}
}
if(mode==='slow-start'&&args[0]==='exec'&&args[1]==='--interactive'){
 const counter=marker+'.health';
 const count=existsSync(counter)?Number(readFileSync(counter,'utf8')):0;
 writeFileSync(counter,String(count+1));
 if(count<2)process.exit(2);
}
console.log(mode==='invalid-health'?'not JSON':JSON.stringify({status:mode==='bad-health'?'unhealthy':'healthy'}));
`,
  );
  return {
    run: () =>
      prepareKaliContainer("kali-box", {
        recorder: createRecorder(),
        binary: process.execPath,
        argsPrefix: [script],
      }),
    calls: async (): Promise<string[][]> =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
  };
}

it("ne réinstalle pas les binaires déjà présents et vérifie la santé", async () => {
  const f = await fixture("present");
  await f.run();
  const calls = await f.calls();
  expect(calls.some((a) => a.includes("apt-get"))).toBe(false);
  expect(calls.some((a) => a.includes("python3"))).toBe(true);
});

it("vérifie Nmap avant d’annoncer Kali prêt et signale un échec d’exécution", async () => {
  const f = await fixture("nmap-fail");
  await expect(f.run()).rejects.toMatchObject({ code: "kali.nmapUnavailable" });
  const calls = await f.calls();
  expect(calls.some((args) => args.includes("apt-get"))).toBe(false);
  expect(calls.some((args) => args.includes("--interactive"))).toBe(false);
});

it("attend un serveur déjà installé qui met du temps à démarrer", async () => {
  const f = await fixture("slow-start");
  await f.run();
  const calls = await f.calls();
  expect(calls.some((a) => a.includes("apt-get"))).toBe(false);
  expect(calls.some((a) => a.includes("kali-server-mcp") && a.includes("--detach"))).toBe(true);
  expect(calls.filter((a) => a.includes("--interactive")).length).toBeGreaterThanOrEqual(4);
});

it("installe les prérequis manquants puis vérifie de nouveau les binaires et la santé", async () => {
  const f = await fixture("absent");
  await f.run();
  const calls = await f.calls();
  expect(calls.filter((a) => a.includes("apt-get")).map((a) => a.slice(4))).toEqual([
    ["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "update"],
    [
      "env",
      "DEBIAN_FRONTEND=noninteractive",
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "python3",
      "mcp-kali-server",
    ],
  ]);
  expect(calls.filter((a) => a[4] === "sh" && !a[6]?.includes("/etc/os-release"))).toHaveLength(2);
});

it("arrête la préparation si apt échoue, sans lancer l'API", async () => {
  const f = await fixture("apt-fail");
  await expect(f.run()).rejects.toMatchObject({
    code: "kali.unavailable",
    params: { stage: "installing" },
  });
  expect((await f.calls()).some((a) => a.includes("install") || a.includes("python3"))).toBe(false);
});

it.each(["foreign", "stopped"] as const)(
  "refuse %s avant toute exécution dans le conteneur",
  async (mode) => {
    const f = await fixture(mode);
    await expect(f.run()).rejects.toMatchObject({
      code: mode === "foreign" ? "exegol.containerDenied" : "project.notRunning",
    });
    expect((await f.calls()).some((a) => a[0] === "exec")).toBe(false);
  },
);

it("ne lance pas apt sur une image qui n'est pas Kali", async () => {
  const f = await fixture("not-kali");
  await expect(f.run()).rejects.toMatchObject({
    code: "kali.unavailable",
    params: { stage: "checking" },
  });
  expect((await f.calls()).some((a) => a.includes("apt-get"))).toBe(false);
});

it("refuse une réponse santé non saine", async () => {
  const f = await fixture("bad-health");
  await expect(f.run()).rejects.toMatchObject({
    code: "kali.unavailable",
    params: { stage: "starting" },
  });
});

it("une seconde préparation après installation ne réinstalle rien", async () => {
  const f = await fixture("absent");
  await f.run();
  await f.run();
  expect((await f.calls()).filter((a) => a.includes("apt-get"))).toHaveLength(2);
});

it("ne lance pas le serveur après un échec d'installation ou des binaires encore absents", async () => {
  for (const mode of ["install-fail", "verify-fail"] as const) {
    const f = await fixture(mode);
    await expect(f.run()).rejects.toMatchObject({
      code: "kali.unavailable",
      params: { stage: "installing", ...(mode === "verify-fail" && { reason: "prereqCheck" }) },
    });
    expect((await f.calls()).some((a) => a.includes("python3"))).toBe(true);
    expect((await f.calls()).some((a) => a.includes("--interactive"))).toBe(false);
  }
});

it("une santé non JSON produit un échec de préparation explicite", async () => {
  const f = await fixture("invalid-health");
  await expect(f.run()).rejects.toMatchObject({
    code: "kali.unavailable",
    params: { stage: "starting", reason: "serverHealth" },
  });
});
