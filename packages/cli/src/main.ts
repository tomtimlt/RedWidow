#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSdkRunner, dockerToolset } from "@john-studio/agent-sdk";
import {
  buildGraph,
  createApprovalGate,
  createDockerClient,
  createRecorder,
  defaultConfigDir,
  type EngineEvent,
  evaluatePolicy,
  loadPolicy,
  openJournal,
  REPO_POLICY_PATH,
  readJournal,
  splitRuns,
  trustPolicy,
} from "@john-studio/core";
import { renderGraphHtml } from "@john-studio/export-html";
import { Command, InvalidArgumentError } from "commander";
import { createTerminalAsker } from "./ask.js";
import { colorEnabled, formatEvent, formatRunList } from "./format.js";

const parseIntArg = (value: string) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("entier positif attendu");
  return n;
};

function printer(verbose: boolean) {
  const color = colorEnabled(process.stdout);
  return (e: EngineEvent) => {
    const line = formatEvent(e, { color, verbose });
    if (line !== null) process.stdout.write(`${line}\n`);
  };
}

const program = new Command()
  .name("john")
  .description("Orchestration de conteneurs Docker via le Claude Agent SDK.")
  .version("0.1.0");

program
  .command("run")
  .description("Lancer l'agent sur une consigne.")
  .argument("<prompt...>", "consigne pour l'agent")
  .option("-p, --policy <file>", "fichier de politique JSON")
  .option("-j, --journal <file>", "chemin du journal JSONL")
  .option("-m, --model <model>", "modèle Claude")
  .option("--max-turns <n>", "nombre maximal de tours", parseIntArg)
  .option("--docker <bin>", "binaire docker des outils MCP", "docker")
  .option("--no-docker-tools", "ne pas exposer les outils Docker structurés à l'agent")
  .option(
    "--allow-bash",
    "exposer l'outil natif Bash (désactivé par défaut ; reste soumis à la politique)",
  )
  .option("--non-interactive", "refuser les cas « ask » au lieu de demander")
  .option("-v, --verbose", "afficher la sortie des processus")
  .action(async (words: string[], opts) => {
    const cwd = process.cwd();
    const { policy, source, warning } = await loadPolicy({ explicit: opts.policy, cwd });
    const recorder = createRecorder();
    const journalPath = resolve(
      cwd,
      opts.journal ?? join(".john-studio", "runs", `${recorder.runId}.jsonl`),
    );
    const journal = await openJournal(journalPath);
    recorder.subscribe(journal.sink);
    recorder.subscribe(printer(Boolean(opts.verbose)));

    const interactive = !opts.nonInteractive && process.stdin.isTTY === true;
    const gate = createApprovalGate({
      policy,
      recorder,
      workspace: { cwd },
      ...(interactive && { ask: createTerminalAsker() }),
    });

    const abort = new AbortController();
    const onSigint = () => abort.abort(new Error("interrompu (SIGINT)"));
    process.once("SIGINT", onSigint);
    process.stderr.write(`politique : ${source} · journal : ${journalPath}\n`);
    if (warning) process.stderr.write(`attention : ${warning}\n`);

    try {
      const runner = createSdkRunner({
        toolsets: opts.dockerTools === false ? [] : [dockerToolset({ binary: opts.docker })],
        bash: Boolean(opts.allowBash),
      });
      const summary = await runner.run(
        {
          prompt: words.join(" "),
          cwd,
          ...(opts.model && { model: opts.model }),
          ...(opts.maxTurns && { maxTurns: opts.maxTurns }),
        },
        { recorder, gate, signal: abort.signal },
      );
      if (summary.result) process.stdout.write(`\n${summary.result}\n`);
      process.exitCode = summary.status === "success" ? 0 : 1;
    } finally {
      process.off("SIGINT", onSigint);
      await journal.close();
    }
  });

const policyCmd = program.command("policy").description("Inspecter la politique d'approbation.");

policyCmd
  .command("check")
  .description("Évaluer une commande contre la politique (sans l'exécuter).")
  .argument("<command...>", "commande shell, ou entrée JSON avec --tool")
  .option("-p, --policy <file>", "fichier de politique JSON")
  .option("-t, --tool <name>", "outil SDK", "Bash")
  .action(async (words: string[], opts) => {
    const cwd = process.cwd();
    const { policy } = await loadPolicy({ explicit: opts.policy, cwd });
    const text = words.join(" ");
    const input =
      opts.tool === "Bash" ? { command: text } : (JSON.parse(text) as Record<string, unknown>);
    const verdict = evaluatePolicy(policy, opts.tool, input, { cwd });
    process.stdout.write(`${verdict.decision}\t${verdict.reason}\n`);
    process.exitCode = verdict.decision === "allow" ? 0 : verdict.decision === "ask" ? 2 : 3;
  });

policyCmd
  .command("show")
  .description("Afficher la politique effective.")
  .option("-p, --policy <file>", "fichier de politique JSON")
  .action(async (opts) => {
    const { policy, source, warning } = await loadPolicy({
      explicit: opts.policy,
      cwd: process.cwd(),
    });
    process.stderr.write(`source : ${source}\n`);
    if (warning) process.stderr.write(`attention : ${warning}\n`);
    process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
  });

policyCmd
  .command("trust")
  .description("Approuver la politique du dépôt (son contenu actuel, identifié par son empreinte).")
  .argument("[file]", "fichier de politique", REPO_POLICY_PATH)
  .action(async (file: string) => {
    const path = resolve(process.cwd(), file);
    const { policy, digest } = await trustPolicy(path, defaultConfigDir());
    process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
    process.stderr.write(`approuvée : ${path} [sha256 ${digest}]\n`);
  });

program
  .command("journal")
  .description("Relire un journal JSONL (liste les runs s'il y en a plusieurs).")
  .argument("<file>", "journal JSONL")
  .option("-r, --run <id>", "afficher seulement ce run")
  .option("-v, --verbose", "afficher la sortie des processus")
  .action(async (file: string, opts) => {
    const { events, issues } = await readJournal(file);
    const runs = splitRuns(events);
    if (opts.run !== undefined && !runs.has(opts.run)) {
      throw new InvalidArgumentError(`run inconnu : ${opts.run}`);
    }
    if (opts.run === undefined && runs.size > 1) {
      for (const line of formatRunList(runs)) process.stdout.write(`${line}\n`);
      process.stderr.write(`${runs.size} runs : choisissez-en un avec --run <id>\n`);
    } else {
      const shown = opts.run === undefined ? events : (runs.get(opts.run) ?? []);
      shown.forEach(printer(Boolean(opts.verbose)));
    }
    for (const issue of issues)
      process.stderr.write(`ligne ${issue.line} ignorée : ${issue.error}\n`);
  });

program
  .command("graph")
  .description("Exporter le graphe d'événements d'un run d'un journal (le dernier par défaut).")
  .argument("<file>", "journal JSONL")
  .option("-o, --out <file>", "fichier de sortie (stdout par défaut)")
  .option("-f, --format <format>", "html | json", "html")
  .option("-r, --run <id>", "run à représenter (défaut : le dernier du journal)")
  .action(async (file: string, opts) => {
    if (opts.format !== "html" && opts.format !== "json") {
      throw new InvalidArgumentError(`format inconnu : ${opts.format}`);
    }
    const { events } = await readJournal(file);
    const graph = buildGraph(events, opts.run === undefined ? {} : { runId: opts.run });
    if (opts.run !== undefined && graph.runId === null) {
      throw new InvalidArgumentError(`run inconnu : ${opts.run}`);
    }
    if (opts.run === undefined && graph.runs.length > 1) {
      process.stderr.write(
        `${graph.runs.length} runs dans le journal : affichage du dernier (${graph.runId}), --run <id> pour un autre\n`,
      );
    }
    const body =
      opts.format === "json" ? `${JSON.stringify(graph, null, 2)}\n` : renderGraphHtml(graph);
    if (opts.out) {
      await writeFile(opts.out, body, "utf8");
      process.stderr.write(`écrit : ${opts.out}\n`);
    } else {
      process.stdout.write(body);
    }
  });

program
  .command("ps")
  .description("Lister les conteneurs.")
  .option("-a, --all", "inclure les conteneurs arrêtés")
  .option("--docker <bin>", "binaire docker", "docker")
  .action(async (opts) => {
    const recorder = createRecorder();
    const docker = createDockerClient({ recorder, binary: opts.docker });
    const containers = await docker.ps({ all: Boolean(opts.all) });
    for (const c of containers) {
      process.stdout.write(`${c.id}\t${c.name}\t${c.image}\t${c.state}\t${c.status}\n`);
    }
  });

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`john : ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
