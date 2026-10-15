#!/usr/bin/env node
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createOpencodeRunner,
  dockerToolset as opencodeDockerToolset,
  sandboxToolset as opencodeSandboxToolset,
} from "@john-studio/agent-opencode";
import { createSdkRunner, dockerToolset, sandboxToolset } from "@john-studio/agent-sdk";
import {
  type AgentRunner,
  type AuthMode,
  activeSandboxId,
  buildGraph,
  createApprovalGate,
  createDockerClient,
  createRecorder,
  createSandbox,
  createSandboxContext,
  defaultConfigDir,
  type EngineEvent,
  evaluatePolicy,
  loadPolicy,
  openJournal,
  pruneSandboxes,
  REPO_POLICY_PATH,
  readJournal,
  removeAllSandboxes,
  resolveBinary,
  safeEnv,
  splitRuns,
  trustPolicy,
} from "@john-studio/core";
import { renderGraphHtml } from "@john-studio/export-html";
import { formatError, formatReason } from "@john-studio/messages";
import { Command, InvalidArgumentError } from "commander";
import { createTerminalAsker } from "./ask.js";
import { colorEnabled, describeAuthIntent, formatEvent, formatRunList } from "./format.js";
import { appendUserRule } from "./policy-store.js";
import {
  assertSandboxNetworkAllowed,
  MAX_SANDBOX_TIMEOUT_SEC,
  resolveSandboxOptions,
} from "./sandbox-options.js";
import { stripControl } from "./sanitize.js";

/** Libellé de la politique intégrée (`LoadedPolicy.source` vaut `null`). */
const BUILTIN_SOURCE = "intégrée";

const parseNumberArg = (value: string) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError("nombre positif attendu");
  return n;
};

const parseAuthArg = (value: string): AuthMode => {
  if (value !== "auto" && value !== "subscription" && value !== "api-key") {
    throw new InvalidArgumentError("auto, subscription ou api-key attendu");
  }
  return value;
};

const AGENTS = ["claude", "opencode"] as const;
type AgentName = (typeof AGENTS)[number];

const parseAgentArg = (value: string): AgentName => {
  if (!(AGENTS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError("claude ou opencode attendu");
  }
  return value as AgentName;
};

const parseSandboxTimeoutArg = (value: string) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_SANDBOX_TIMEOUT_SEC)
    throw new InvalidArgumentError(`entier entre 1 et ${MAX_SANDBOX_TIMEOUT_SEC} attendu`);
  return n;
};

const parseSandboxCpusArg = (value: string) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 8)
    throw new InvalidArgumentError("entier entre 1 et 8 attendu");
  return n;
};

const parseListArg = (value: string) =>
  value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

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
  .description("Orchestration de conteneurs Docker via un agent (Claude Agent SDK ou OpenCode).")
  .version("0.1.0");

program
  .command("run")
  .description("Lancer l'agent sur une consigne.")
  .argument("<prompt...>", "consigne pour l'agent")
  .option("-p, --policy <file>", "fichier de politique JSON")
  .option("-j, --journal <file>", "chemin du journal JSONL")
  .option(
    "-a, --agent <agent>",
    "moteur d'agent : claude (Claude Agent SDK) ou opencode",
    parseAgentArg,
    "claude",
  )
  .option("-m, --model <model>", "modèle (claude) ou fournisseur/modèle (opencode)")
  .option("--opencode-bin <path>", "binaire opencode (défaut : opencode, cherché dans PATH)")
  .option(
    "--opencode-url <url>",
    "serveur OpenCode existant (OPENCODE_SERVER_PASSWORD pour son mot de passe)",
  )
  .option(
    "--pass-env <noms>",
    "variables d'environnement transmises au serveur OpenCode lancé (clés des fournisseurs), séparées par des virgules",
    parseListArg,
  )
  .option("--max-turns <n>", "nombre maximal de tours", parseIntArg)
  .option("--docker <bin>", "binaire docker des outils MCP", "docker")
  .option("--no-docker-tools", "ne pas exposer les outils Docker structurés à l'agent")
  .option(
    "--allow-bash",
    "exposer l'outil natif Bash (désactivé par défaut ; reste soumis à la politique)",
  )
  .option(
    "--sandbox",
    "activer le bac à sable Docker du run (outil mcp__sandbox__exec ; utilisateur non privilégié)",
  )
  .option(
    "--sandbox-image <image>",
    "image locale du bac à sable (obligatoire avec --sandbox, jamais téléchargée, de préférence épinglée par digest)",
  )
  .option("--sandbox-network <mode>", "réseau du bac à sable : none (défaut) ou bridge")
  .option("--sandbox-memory <taille>", "mémoire du bac à sable : 1g à 8g (défaut 2g)")
  .option(
    "--sandbox-cpus <n>",
    "CPU du bac à sable : entier de 1 à 8 (défaut 2)",
    parseSandboxCpusArg,
  )
  .option(
    "--sandbox-timeout <s>",
    `délai maximal d'une exécution du bac à sable, en secondes (défaut 600, maximum ${MAX_SANDBOX_TIMEOUT_SEC})`,
    parseSandboxTimeoutArg,
  )
  .option("--non-interactive", "refuser les cas « ask » au lieu de demander")
  .option(
    "--approval-timeout <s>",
    "refuser une approbation restée sans réponse après ce délai (secondes)",
    parseNumberArg,
  )
  .option(
    "--auth <mode>",
    "identifiants : auto (environnement tel quel), subscription (abonnement, clés API écartées) ou api-key",
    parseAuthArg,
    "auto",
  )
  .option("--resume <id>", "reprendre une session existante")
  .option("--max-budget-usd <n>", "plafond de dépense du run, en dollars", parseNumberArg)
  .option("--system-prompt <texte>", "texte ajouté au prompt système")
  .option("-v, --verbose", "afficher la sortie des processus")
  .action(async (words: string[], opts) => {
    // Options du bac à sable validées avant tout effet de bord (journal, politique).
    const sandboxOpts = resolveSandboxOptions(opts);
    const cwd = process.cwd();
    const { policy, source, warning } = await loadPolicy({ explicit: opts.policy, cwd });
    const recorder = createRecorder();
    const sandboxCtx = sandboxOpts
      ? createSandboxContext({
          recorder,
          binary: opts.docker,
          maxTimeoutSec: sandboxOpts.timeoutSec,
        })
      : undefined;
    const journalPath = resolve(
      cwd,
      opts.journal ?? join(".john-studio", "runs", `${recorder.runId}.jsonl`),
    );
    const journal = await openJournal(journalPath);
    recorder.subscribe(journal.sink);
    recorder.subscribe(printer(Boolean(opts.verbose)));

    const interactive = !opts.nonInteractive && process.stdin.isTTY === true;
    const configDir = defaultConfigDir();
    const gate = createApprovalGate({
      policy,
      recorder,
      // Sous win32, Bash n'est analysable que si c'est réellement Git Bash : c'est le cas de Claude
      // (qui l'exige) ; le bash d'OpenCode peut être cmd ou PowerShell, donc rien n'est déclaré.
      workspace: { cwd, ...(opts.agent !== "opencode" && { posixShell: true }) },
      ...(interactive && {
        ask: createTerminalAsker(process.stdin, process.stderr, sandboxOpts?.network),
      }),
      ...(opts.approvalTimeout && { timeoutMs: Math.round(opts.approvalTimeout * 1000) }),
      // Identifiant fourni par le registre (ADR 0003 D), jamais par l'entrée d'un outil.
      ...(sandboxCtx && { sandboxContainerId: () => activeSandboxId(sandboxCtx) }),
      persistRule: async (rule) => {
        const path = await appendUserRule(configDir, rule, policy);
        process.stderr.write(`règle ajoutée à la politique utilisateur : ${path}\n`);
      },
    });

    const abort = new AbortController();
    // Premier SIGINT : annulation propre ; second : sortie immédiate (le filet « exit » du cœur tue les groupes).
    // Le gestionnaire reste en place jusqu'à la fin du nettoyage : un Ctrl-C pendant le `finally`
    // passe aussi par `process.exit` (donc par l'événement « exit » et le filet synchrone).
    let cleaning = false;
    const onSigint = () => {
      if (abort.signal.aborted || cleaning) process.exit(130);
      abort.abort(new Error("interrompu (SIGINT)"));
    };
    const onTerm = () => process.exit(143);
    const onHup = () => process.exit(129);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onTerm);
    process.on("SIGHUP", onHup);
    process.stderr.write(`politique : ${source ?? BUILTIN_SOURCE} · journal : ${journalPath}\n`);
    process.stderr.write(
      opts.agent === "opencode"
        ? "authentification : gérée par OpenCode (« opencode auth login » ou variables du fournisseur, voir --pass-env)\n"
        : `authentification : ${describeAuthIntent(opts.auth)}\n`,
    );
    if (warning) process.stderr.write(`attention : ${formatReason(warning)}\n`);

    try {
      if (sandboxCtx && sandboxOpts) {
        assertSandboxNetworkAllowed(opts.agent, sandboxOpts.network);
        await createSandbox(sandboxCtx, {
          image: sandboxOpts.image,
          network: sandboxOpts.network,
          memory: sandboxOpts.memory,
          cpus: sandboxOpts.cpus,
          signal: abort.signal,
        });
        process.stderr.write(
          `bac à sable : ${sandboxOpts.image} (${sandboxOpts.network === "bridge" ? "réseau activé" : "réseau coupé"})\n`,
        );
      }
      const runner: AgentRunner =
        opts.agent === "opencode"
          ? createOpencodeRunner({
              toolsets: [
                ...(opts.dockerTools === false
                  ? []
                  : [opencodeDockerToolset({ binary: opts.docker })]),
                ...(sandboxCtx ? [opencodeSandboxToolset({ context: sandboxCtx })] : []),
              ],
              bash: Boolean(opts.allowBash),
              ...(opts.opencodeBin && { binary: opts.opencodeBin }),
              ...(opts.opencodeUrl && { baseUrl: opts.opencodeUrl }),
              ...(process.env.OPENCODE_SERVER_PASSWORD && {
                serverPassword: process.env.OPENCODE_SERVER_PASSWORD,
              }),
              ...(opts.passEnv && { passEnv: opts.passEnv as string[] }),
            })
          : createSdkRunner({
              toolsets: [
                ...(opts.dockerTools === false ? [] : [dockerToolset({ binary: opts.docker })]),
                ...(sandboxCtx ? [sandboxToolset({ context: sandboxCtx })] : []),
              ],
              bash: Boolean(opts.allowBash),
            });
      const summary = await runner.run(
        {
          prompt: words.join(" "),
          cwd,
          ...(opts.model && { model: opts.model }),
          ...(opts.maxTurns && { maxTurns: opts.maxTurns }),
          auth: opts.auth as AuthMode,
          ...(opts.resume && { resume: opts.resume }),
          ...(opts.maxBudgetUsd && { maxBudgetUsd: opts.maxBudgetUsd }),
          ...(opts.systemPrompt && { systemPrompt: opts.systemPrompt }),
        },
        { recorder, gate, signal: abort.signal },
      );
      if (summary.result) process.stdout.write(`\n${summary.result}\n`);
      if (summary.sessionId) {
        process.stderr.write(
          `session : ${summary.sessionId} (reprise : --resume ${summary.sessionId})\n`,
        );
      }
      process.exitCode = summary.status === "success" ? 0 : 1;
    } finally {
      cleaning = true;
      // Conteneur supprimé en fin de run, sur Ctrl-C et sur erreur, avant la fermeture du journal
      // (pour y consigner `sandbox.stopped`). Un second Ctrl-C passe par le filet de sortie synchrone.
      try {
        if (sandboxCtx)
          await removeAllSandboxes(sandboxCtx, abort.signal.aborted ? "abort" : "runEnd");
        await journal.close();
      } finally {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onTerm);
        process.off("SIGHUP", onHup);
      }
    }
  });

/** Version d'un binaire (`--version`), ou `null` s'il ne répond pas. */
function binaryVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(path, ["--version"], { env: safeEnv(), timeout: 5000 }, (error, stdout) =>
      resolve(error ? null : stdout.trim().split("\n")[0] || null),
    );
  });
}

program
  .command("agents")
  .description("Lister les moteurs d'agent disponibles (--agent) et l'état de leur binaire.")
  .option("--opencode-bin <path>", "binaire opencode", "opencode")
  .action(async (opts) => {
    process.stdout.write("claude\tClaude Agent SDK (intégré, binaire fourni par le SDK)\n");
    const found = resolveBinary(opts.opencodeBin);
    if (found === null) {
      process.stdout.write(
        `opencode\tbinaire introuvable : ${opts.opencodeBin} (installez-le : https://opencode.ai/docs/ ou --opencode-bin)\n`,
      );
      return;
    }
    const version = await binaryVersion(found);
    process.stdout.write(
      `opencode\tbinaire trouvé : ${found}${version ? ` (version ${version})` : ""}\n`,
    );
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
    process.stdout.write(`${verdict.decision}\t${formatReason(verdict.reason)}\n`);
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
    process.stderr.write(`source : ${source ?? BUILTIN_SOURCE}\n`);
    if (warning) process.stderr.write(`attention : ${formatReason(warning)}\n`);
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
      process.stderr.write(`ligne ${issue.line} ignorée : ${formatReason(issue.error)}\n`);
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
  .command("sandbox")
  .description("Gérer les bacs à sable Docker.")
  .command("prune")
  .description(
    "Supprimer les conteneurs portant le label des bacs à sable (orphelins d'un run interrompu).",
  )
  .option("--docker <bin>", "binaire docker", "docker")
  .option("--yes", "supprimer réellement (sinon, liste seulement)")
  .action(async (opts) => {
    const ctx = createSandboxContext({ recorder: createRecorder(), binary: opts.docker });
    const { found, removed, failed } = await pruneSandboxes(ctx, { remove: Boolean(opts.yes) });
    for (const c of found) process.stdout.write(`${c.id}\t${stripControl(c.name)}\n`);
    if (!opts.yes) {
      process.stderr.write(
        `${found.length} conteneur(s) à supprimer : relancer avec --yes pour les supprimer\n`,
      );
      return;
    }
    process.stderr.write(`${removed.length} conteneur(s) supprimé(s)\n`);
    if (failed.length > 0) {
      process.stderr.write(`échec de suppression : ${failed.join(", ")}\n`);
      process.exitCode = 1;
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
  process.stderr.write(`john : ${formatError(err)}\n`);
  process.exitCode = 1;
});
