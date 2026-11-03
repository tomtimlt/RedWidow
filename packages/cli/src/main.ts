#!/usr/bin/env node
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createOpencodeRunner,
  dockerToolset as opencodeDockerToolset,
  webToolset as opencodeWebToolset,
} from "@warband/agent-opencode";
import { createSdkRunner, dockerToolset, webToolset } from "@warband/agent-sdk";
import {
  type AgentRunner,
  type AuthMode,
  buildGraph,
  createApprovalGate,
  createDockerClient,
  createRecorder,
  defaultConfigDir,
  type EngineEvent,
  evaluatePolicy,
  link as linkProject,
  loadPolicy,
  openJournal,
  REPO_POLICY_PATH,
  readJournal,
  resolveBinary,
  safeEnv,
  splitRuns,
  status,
  trustPolicy,
} from "@warband/core";
import { renderGraphHtml } from "@warband/export-html";
import { formatError, formatReason, isLocale } from "@warband/messages";
import { Command, InvalidArgumentError } from "commander";
import { createTerminalAsker } from "./ask.js";
import { colorEnabled, describeAuthIntent, formatEvent, formatRunList } from "./format.js";
import { languageFromArgs, type Translator } from "./locale.js";
import { appendUserRule } from "./policy-store.js";

const locale = languageFromArgs(process.argv.slice(2));
const t: Translator = (fr, en) => (locale === "en" ? en : fr);
const BUILTIN_SOURCE = t("intégrée", "built-in");

const parseNumberArg = (value: string) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new InvalidArgumentError(t("nombre positif attendu", "positive number expected"));
  return n;
};

const parseAuthArg = (value: string): AuthMode => {
  if (value !== "auto" && value !== "subscription" && value !== "api-key") {
    throw new InvalidArgumentError(
      t("auto, subscription ou api-key attendu", "expected auto, subscription or api-key"),
    );
  }
  return value;
};

const AGENTS = ["claude", "opencode"] as const;
type AgentName = (typeof AGENTS)[number];

const parseAgentArg = (value: string): AgentName => {
  if (!(AGENTS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(t("claude ou opencode attendu", "expected claude or opencode"));
  }
  return value as AgentName;
};

const parseListArg = (value: string) =>
  value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

const parseIntArg = (value: string) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0)
    throw new InvalidArgumentError(t("entier positif attendu", "positive integer expected"));
  return n;
};

function printer(verbose: boolean) {
  const color = colorEnabled(process.stdout);
  return (e: EngineEvent) => {
    const line = formatEvent(e, { color, verbose, locale });
    if (line !== null) process.stdout.write(`${line}\n`);
  };
}

const program = new Command()
  .name("warband")
  .description(
    t(
      "Orchestration de conteneurs Docker via un agent (Claude Agent SDK ou OpenCode).",
      "Orchestrate Docker containers with an agent (Claude Agent SDK or OpenCode).",
    ),
  )
  .version("0.1.0", "-V, --version", t("afficher la version", "output the version number"))
  .option(
    "--lang <fr|en>",
    t("langue de l’interface : fr ou en", "interface language: fr or en"),
    (value: string) => {
      if (!isLocale(value))
        throw new InvalidArgumentError(t("fr ou en attendu", "expected fr or en"));
      return value;
    },
    "en",
  )
  .helpOption("-h, --help", t("afficher l’aide", "display help"))
  .addHelpCommand(
    "help [command]",
    t("afficher l’aide d’une commande", "display help for a command"),
  );

program
  .command("run")
  .description(t("Lancer l'agent sur une consigne.", "Run the agent with a prompt."))
  .argument("<prompt...>", t("consigne pour l'agent", "agent prompt"))
  .option("-p, --policy <file>", t("fichier de politique JSON", "JSON policy file"))
  .option("-j, --journal <file>", t("chemin du journal JSONL", "JSONL journal path"))
  .option(
    "-a, --agent <agent>",
    t(
      "moteur d'agent : claude (Claude Agent SDK) ou opencode",
      "agent engine: claude (Claude Agent SDK) or opencode",
    ),
    parseAgentArg,
    "claude",
  )
  .option(
    "-m, --model <model>",
    t(
      "modèle (claude) ou fournisseur/modèle (opencode)",
      "model (claude) or provider/model (opencode)",
    ),
  )
  .option(
    "--opencode-bin <path>",
    t(
      "binaire opencode (défaut : opencode, cherché dans PATH)",
      "opencode binary (default: opencode, searched in PATH)",
    ),
  )
  .option(
    "--opencode-url <url>",
    t(
      "serveur OpenCode existant (OPENCODE_SERVER_PASSWORD pour son mot de passe)",
      "existing OpenCode server (OPENCODE_SERVER_PASSWORD for its password)",
    ),
  )
  .option(
    t("--pass-env <noms>", "--pass-env <names>"),
    t(
      "variables d'environnement transmises au serveur OpenCode lancé (clés des fournisseurs), séparées par des virgules",
      "comma-separated environment variables passed to the launched OpenCode server (provider keys)",
    ),
    parseListArg,
  )
  .option("--max-turns <n>", t("nombre maximal de tours", "maximum number of turns"), parseIntArg)
  .option(
    "--docker <bin>",
    t("binaire docker des outils MCP", "docker binary for MCP tools"),
    "docker",
  )
  .option(
    "--no-docker-tools",
    t(
      "ne pas exposer les outils Docker structurés à l'agent",
      "do not expose structured Docker tools to the agent",
    ),
  )
  .option(
    "--allow-bash",
    t(
      "exposer l'outil natif Bash (désactivé par défaut ; reste soumis à la politique)",
      "expose native Bash tool (disabled by default; still subject to policy)",
    ),
  )
  .option(
    "--non-interactive",
    t("refuser les cas « ask » au lieu de demander", "deny 'ask' cases without prompting"),
  )
  .option(
    "--approval-timeout <s>",
    t(
      "refuser une approbation restée sans réponse après ce délai (secondes)",
      "deny unanswered approval after this delay (seconds)",
    ),
    parseNumberArg,
  )
  .option(
    "--auth <mode>",
    t(
      "identifiants : auto (environnement tel quel), subscription (abonnement, clés API écartées) ou api-key",
      "credentials: auto (current environment), subscription (subscription, API keys excluded) or api-key",
    ),
    parseAuthArg,
    "auto",
  )
  .option("--resume <id>", t("reprendre une session existante", "resume an existing session"))
  .option(
    "--max-budget-usd <n>",
    t("plafond de dépense du run, en dollars", "run spending limit, in dollars"),
    parseNumberArg,
  )
  .option(
    t("--system-prompt <texte>", "--system-prompt <text>"),
    t("texte ajouté au prompt système", "text appended to the system prompt"),
  )
  .option("-v, --verbose", t("afficher la sortie des processus", "show process output"))
  .action(async (words: string[], opts) => {
    const cwd = process.cwd();
    const { policy, source, warning } = await loadPolicy({ explicit: opts.policy, cwd });
    const recorder = createRecorder();
    const journalPath = resolve(
      cwd,
      opts.journal ?? join(".warband", "runs", `${recorder.runId}.jsonl`),
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
      ...(interactive && { ask: createTerminalAsker(process.stdin, process.stderr, locale) }),
      ...(opts.approvalTimeout && { timeoutMs: Math.round(opts.approvalTimeout * 1000) }),
      persistRule: async (rule) => {
        const path = await appendUserRule(configDir, rule, policy);
        process.stderr.write(
          t(
            `règle ajoutée à la politique utilisateur : ${path}\n`,
            `rule added to user policy: ${path}\n`,
          ),
        );
      },
    });

    const abort = new AbortController();
    // Premier SIGINT : annulation propre ; second : sortie immédiate (le filet « exit » du cœur tue les groupes).
    // Le gestionnaire reste en place jusqu'à la fin du nettoyage : un Ctrl-C pendant le `finally`
    // passe aussi par `process.exit` (donc par l'événement « exit » et le filet synchrone).
    let cleaning = false;
    const onSigint = () => {
      if (abort.signal.aborted || cleaning) process.exit(130);
      abort.abort(new Error(t("interrompu (SIGINT)", "interrupted (SIGINT)")));
    };
    const onTerm = () => process.exit(143);
    const onHup = () => process.exit(129);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onTerm);
    process.on("SIGHUP", onHup);
    process.stderr.write(
      t(
        `politique : ${source ?? BUILTIN_SOURCE} · journal : ${journalPath}\n`,
        `policy: ${source ?? BUILTIN_SOURCE} · journal: ${journalPath}\n`,
      ),
    );
    process.stderr.write(
      opts.agent === "opencode"
        ? t(
            "authentification : gérée par OpenCode (« opencode auth login » ou variables du fournisseur, voir --pass-env)\n",
            "authentication: managed by OpenCode ('opencode auth login' or provider variables, see --pass-env)\n",
          )
        : t(
            `authentification : ${describeAuthIntent(opts.auth, process.env, locale)}\n`,
            `authentication: ${describeAuthIntent(opts.auth, process.env, locale)}\n`,
          ),
    );
    if (warning)
      process.stderr.write(
        t(
          `attention : ${formatReason(warning, locale)}\n`,
          `warning: ${formatReason(warning, locale)}\n`,
        ),
      );

    try {
      const runner: AgentRunner =
        opts.agent === "opencode"
          ? createOpencodeRunner({
              toolsets: [
                opencodeWebToolset(),
                ...(opts.dockerTools === false
                  ? []
                  : [opencodeDockerToolset({ binary: opts.docker })]),
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
                webToolset(),
                ...(opts.dockerTools === false ? [] : [dockerToolset({ binary: opts.docker })]),
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
          t(
            `session : ${summary.sessionId} (reprise : --resume ${summary.sessionId})\n`,
            `session: ${summary.sessionId} (resume: --resume ${summary.sessionId})\n`,
          ),
        );
      }
      process.exitCode = summary.status === "success" ? 0 : 1;
    } finally {
      cleaning = true;
      try {
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
  .description(
    t(
      "Lister les moteurs d'agent disponibles (--agent) et l'état de leur binaire.",
      "List available agent engines (--agent) and binary status.",
    ),
  )
  .option("--opencode-bin <path>", t("binaire opencode", "opencode binary"), "opencode")
  .action(async (opts) => {
    process.stdout.write(
      t(
        "claude\tClaude Agent SDK (intégré, binaire fourni par le SDK)\n",
        "claude\tClaude Agent SDK (built-in, binary supplied by SDK)\n",
      ),
    );
    const found = resolveBinary(opts.opencodeBin);
    if (found === null) {
      process.stdout.write(
        t(
          `opencode\tbinaire introuvable : ${opts.opencodeBin} (installez-le : https://opencode.ai/docs/ ou --opencode-bin)\n`,
          `opencode\tbinary not found: ${opts.opencodeBin} (install: https://opencode.ai/docs/ or --opencode-bin)\n`,
        ),
      );
      return;
    }
    const version = await binaryVersion(found);
    process.stdout.write(
      t(
        `opencode\tbinaire trouvé : ${found}${version ? ` (version ${version})` : ""}\n`,
        `opencode\tbinary found: ${found}${version ? ` (version ${version})` : ""}\n`,
      ),
    );
  });

const policyCmd = program
  .command("policy")
  .description(t("Inspecter la politique d'approbation.", "Inspect approval policy."));

policyCmd
  .command("check")
  .description(
    t(
      "Évaluer une commande contre la politique (sans l'exécuter).",
      "Evaluate a command against policy (without executing it).",
    ),
  )
  .argument(
    "<command...>",
    t("commande shell, ou entrée JSON avec --tool", "shell command, or JSON input with --tool"),
  )
  .option("-p, --policy <file>", t("fichier de politique JSON", "JSON policy file"))
  .option("-t, --tool <name>", t("outil SDK", "SDK tool"), "Bash")
  .action(async (words: string[], opts) => {
    const cwd = process.cwd();
    const { policy } = await loadPolicy({ explicit: opts.policy, cwd });
    const text = words.join(" ");
    const input =
      opts.tool === "Bash" ? { command: text } : (JSON.parse(text) as Record<string, unknown>);
    const verdict = evaluatePolicy(policy, opts.tool, input, { cwd });
    process.stdout.write(`${verdict.decision}\t${formatReason(verdict.reason, locale)}\n`);
    process.exitCode = verdict.decision === "allow" ? 0 : verdict.decision === "ask" ? 2 : 3;
  });

policyCmd
  .command("show")
  .description(t("Afficher la politique effective.", "Show effective policy."))
  .option("-p, --policy <file>", t("fichier de politique JSON", "JSON policy file"))
  .action(async (opts) => {
    const { policy, source, warning } = await loadPolicy({
      explicit: opts.policy,
      cwd: process.cwd(),
    });
    process.stderr.write(
      t(`source : ${source ?? BUILTIN_SOURCE}\n`, `source: ${source ?? BUILTIN_SOURCE}\n`),
    );
    if (warning)
      process.stderr.write(
        t(
          `attention : ${formatReason(warning, locale)}\n`,
          `warning: ${formatReason(warning, locale)}\n`,
        ),
      );
    process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
  });

policyCmd
  .command("trust")
  .description(
    t(
      "Approuver la politique du dépôt (son contenu actuel, identifié par son empreinte).",
      "Trust repository policy (current content, identified by its hash).",
    ),
  )
  .argument("[file]", t("fichier de politique", "policy file"), REPO_POLICY_PATH)
  .action(async (file: string) => {
    const path = resolve(process.cwd(), file);
    const { policy, digest } = await trustPolicy(path, defaultConfigDir());
    process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
    process.stderr.write(
      t(`approuvée : ${path} [sha256 ${digest}]\n`, `trusted: ${path} [sha256 ${digest}]\n`),
    );
  });

program
  .command("journal")
  .description(
    t(
      "Relire un journal JSONL (liste les runs s'il y en a plusieurs).",
      "Read a JSONL journal (list runs when there are several).",
    ),
  )
  .argument("<file>", t("journal JSONL", "JSONL journal"))
  .option("-r, --run <id>", t("afficher seulement ce run", "show only this run"))
  .option("-v, --verbose", t("afficher la sortie des processus", "show process output"))
  .action(async (file: string, opts) => {
    const { events, issues } = await readJournal(file);
    const runs = splitRuns(events);
    if (opts.run !== undefined && !runs.has(opts.run)) {
      throw new InvalidArgumentError(t(`run inconnu : ${opts.run}`, `unknown run: ${opts.run}`));
    }
    if (opts.run === undefined && runs.size > 1) {
      for (const line of formatRunList(runs, locale)) process.stdout.write(`${line}\n`);
      process.stderr.write(
        t(
          `${runs.size} runs : choisissez-en un avec --run <id>\n`,
          `${runs.size} runs: choose one with --run <id>\n`,
        ),
      );
    } else {
      const shown = opts.run === undefined ? events : (runs.get(opts.run) ?? []);
      shown.forEach(printer(Boolean(opts.verbose)));
    }
    for (const issue of issues)
      process.stderr.write(
        t(
          `ligne ${issue.line} ignorée : ${formatReason(issue.error, locale)}\n`,
          `line ${issue.line} ignored: ${formatReason(issue.error, locale)}\n`,
        ),
      );
  });

program
  .command("graph")
  .description(
    t(
      "Exporter le graphe d'événements d'un run d'un journal (le dernier par défaut).",
      "Export the event graph of a journal run (last run by default).",
    ),
  )
  .argument("<file>", t("journal JSONL", "JSONL journal"))
  .option(
    "-o, --out <file>",
    t("fichier de sortie (stdout par défaut)", "output file (stdout by default)"),
  )
  .option("-f, --format <format>", "html | json", "html")
  .option(
    "-r, --run <id>",
    t(
      "run à représenter (défaut : le dernier du journal)",
      "run to display (default: last in journal)",
    ),
  )
  .action(async (file: string, opts) => {
    if (opts.format !== "html" && opts.format !== "json") {
      throw new InvalidArgumentError(
        t(`format inconnu : ${opts.format}`, `unknown format: ${opts.format}`),
      );
    }
    const { events } = await readJournal(file);
    const graph = buildGraph(events, opts.run === undefined ? {} : { runId: opts.run });
    if (opts.run !== undefined && graph.runId === null) {
      throw new InvalidArgumentError(t(`run inconnu : ${opts.run}`, `unknown run: ${opts.run}`));
    }
    if (opts.run === undefined && graph.runs.length > 1) {
      process.stderr.write(
        t(
          `${graph.runs.length} runs dans le journal : affichage du dernier (${graph.runId}), --run <id> pour un autre\n`,
          `${graph.runs.length} runs in journal: showing the last (${graph.runId}), use --run <id> for another\n`,
        ),
      );
    }
    const body =
      opts.format === "json"
        ? `${JSON.stringify(graph, null, 2)}\n`
        : renderGraphHtml(graph, { locale });
    if (opts.out) {
      await writeFile(opts.out, body, "utf8");
      process.stderr.write(t(`écrit : ${opts.out}\n`, `written: ${opts.out}\n`));
    } else {
      process.stdout.write(body);
    }
  });

program
  .command("ps")
  .description(t("Lister les conteneurs.", "List containers."))
  .option("-a, --all", t("inclure les conteneurs arrêtés", "include stopped containers"))
  .option("--docker <bin>", t("binaire docker", "docker binary"), "docker")
  .action(async (opts) => {
    const recorder = createRecorder();
    const docker = createDockerClient({ recorder, binary: opts.docker });
    const containers = await docker.ps({ all: Boolean(opts.all) });
    for (const c of containers) {
      process.stdout.write(`${c.id}\t${c.name}\t${c.image}\t${c.state}\t${c.status}\n`);
    }
  });

program
  .command("link")
  .description(
    t(
      "Lier le projet actif à un conteneur Exegol déjà en cours.",
      "Link the active project to an Exegol container already running.",
    ),
  )
  .argument(t("<nom>", "<name>"), t("nom du conteneur", "container name"))
  .option("--docker <bin>", t("binaire docker", "docker binary"), "docker")
  .action(async (name: string, opts) => {
    const recorder = createRecorder();
    const docker = createDockerClient({ recorder, binary: opts.docker });
    await linkProject(defaultConfigDir(), name, docker);
    process.stdout.write(t(`lié : ${name}\n`, `linked: ${name}\n`));
  });

program
  .command("status")
  .description(
    t(
      "Afficher l'état du conteneur lié au projet actif.",
      "Show the status of the container linked to the active project.",
    ),
  )
  .option("--docker <bin>", t("binaire docker", "docker binary"), "docker")
  .action(async (opts) => {
    const recorder = createRecorder();
    const docker = createDockerClient({ recorder, binary: opts.docker });
    const s = await status(defaultConfigDir(), docker);
    const container = s.container ?? t("(aucun conteneur unique)", "(no unique container)");
    const state = s.state ?? "";
    process.stdout.write(`${container}\t${state}\t${s.image ?? ""}\t${s.workspace}\n`);
  });

for (const command of [program, ...program.commands, ...policyCmd.commands]) {
  command.helpOption("-h, --help", t("afficher l’aide", "display help"));
}

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`warband : ${formatError(err, locale)}\n`);
  process.exitCode = 1;
});
