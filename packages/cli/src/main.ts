#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
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
  activeProject,
  approveCampaign,
  approveEngagement,
  approveProgram,
  buildGraph,
  type CampaignStatus,
  CodedError,
  campaignOverview,
  clearHalt,
  clearPaceHalt,
  createApprovalGate,
  createCampaignPort,
  createDockerClient,
  createPaceRegistry,
  createRecorder,
  createWebProgram,
  defaultConfigDir,
  type EngagementStatus,
  type EngineEvent,
  evaluatePolicy,
  importCampaignDraft,
  importEngagementDraft,
  importProgramDraft,
  isHalted,
  link as linkProject,
  loadPolicy,
  openJournal,
  type ProgramStatus,
  REPO_POLICY_PATH,
  readCampaign,
  readEngagement,
  readEngagementSync,
  readJournal,
  readProgram,
  readProgramSync,
  readProjects,
  readTeardownSync,
  resolveBinary,
  type SupervisionLevel,
  safeEnv,
  setHalt,
  splitRuns,
  status,
  suspendCampaign,
  suspendEngagement,
  suspendProgram,
  trustPolicy,
  writeProgramDraft,
} from "@warband/core";
import { renderGraphHtml } from "@warband/export-html";
import { formatError, formatReason, isLocale } from "@warband/messages";
import { Command, InvalidArgumentError } from "commander";
import { createTerminalAsker } from "./ask.js";
import { colorEnabled, describeAuthIntent, formatEvent, formatRunList } from "./format.js";
import { languageFromArgs, type Translator } from "./locale.js";
import { appendUserRule } from "./policy-store.js";
import { parseSupervisionArg } from "./supervision-arg.js";

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
  .option(
    "--supervision <niveau>",
    t(
      "encadrement du moteur : light, standard (défaut) ou strict (relances plus fréquentes)",
      "engine supervision: light, standard (default) or strict (more frequent reminders)",
    ),
    (value: string) => parseSupervisionArg(value, t),
    "standard",
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
    // Projet actif au lancement (ADR 0040) : sans projet, ou fichier illisible, la fiche n'a aucun effet.
    let activeId: string | null = null;
    try {
      const file = await readProjects(configDir);
      activeId = (file ? activeProject(file) : null)?.id ?? null;
    } catch {
      // Projets illisibles : pas de périmètre appliqué.
    }
    const programProvider = (): ProgramStatus =>
      activeId === null ? { state: "none" } : readProgramSync(configDir, activeId);
    // Écriture du brouillon par l'outil `program_draft` : n'approuve rien (approbation = CLI seule).
    const programDraft = (text: string): Promise<ProgramStatus> =>
      writeProgramDraft(configDir, activeId, text);
    // Fiche d'engagement et arrêt d'urgence (ADR 0041) : lecture seule pour l'agent (`mission_context`).
    const engagementProvider = (): EngagementStatus =>
      activeId === null ? { state: "none" } : readEngagementSync(configDir, activeId);
    const haltedProvider = (): boolean => activeId !== null && isHalted(configDir, activeId);
    const webProgram = createWebProgram({
      program: programProvider,
      registry: createPaceRegistry({ configDir, projectId: () => activeId }),
    });
    const gate = createApprovalGate({
      policy,
      recorder,
      program: programProvider,
      // Engagement et arrêt d'urgence (ADR 0041) : relus à chaque décision de la gate.
      engagement: () => ({ status: engagementProvider(), halted: haltedProvider() }),
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
                opencodeWebToolset(webProgram),
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
                webToolset(webProgram),
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
        {
          recorder,
          gate,
          signal: abort.signal,
          supervision: opts.supervision as SupervisionLevel,
          program: programProvider,
          programDraft,
          engagement: engagementProvider,
          halted: haltedProvider,
          campaign: createCampaignPort(configDir, () => activeId),
        },
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

const programCmd = program
  .command("program")
  .description(
    t(
      "Fiche programme du projet (périmètre, suffixe User-Agent, rythme) : validation par empreinte.",
      "Project program sheet (scope, User-Agent suffix, pace): hash-based approval.",
    ),
  );

/** Projet visé : `--project`, sinon le projet actif. Aucun projet → `project.absent`. */
async function programProjectId(opts: { project?: string }): Promise<string> {
  if (opts.project !== undefined) return opts.project;
  const file = await readProjects(defaultConfigDir());
  const active = file ? activeProject(file) : null;
  if (!active) throw new CodedError("project.absent");
  return active.id;
}

const PROJECT_OPTION = [
  "--project <id>",
  t("identifiant du projet (défaut : actif)", "project id (default: active)"),
] as const;

/** Champs de la fiche dont la citation n'a pas été recoupée par le moteur. */
const unverifiedFields = (status: ProgramStatus): string[] => {
  const sheet = status.draft;
  if (!sheet) return [];
  const fields = {
    inScope: sheet.inScope,
    outOfScope: sheet.outOfScope,
    pace: sheet.pace,
  } as const;
  return [
    ...Object.entries(fields)
      .filter(([, c]) => !c.verified)
      .map(([k]) => k),
    ...(sheet.userAgentSuffix && !sheet.userAgentSuffix.verified ? ["userAgentSuffix"] : []),
  ];
};

function printProgramStatus(status: ProgramStatus): void {
  process.stderr.write(
    t(
      `état : ${status.state}${status.digest ? ` · empreinte ${status.digest}` : ""}\n`,
      `state: ${status.state}${status.digest ? ` · hash ${status.digest}` : ""}\n`,
    ),
  );
  if (status.approvedDigest !== undefined)
    process.stderr.write(
      t(
        `approuvée : ${status.approvedAt} · empreinte ${status.approvedDigest}\n`,
        `approved: ${status.approvedAt} · hash ${status.approvedDigest}\n`,
      ),
    );
  if (status.suspendedAt !== undefined)
    process.stderr.write(
      t(`suspendue : ${status.suspendedAt}\n`, `suspended: ${status.suspendedAt}\n`),
    );
  if (status.problem) process.stderr.write(`${formatReason(status.problem, locale)}\n`);
  const unverified = unverifiedFields(status);
  if (unverified.length > 0)
    process.stderr.write(
      t(
        `citations non recoupées : ${unverified.join(", ")}\n`,
        `unverified citations: ${unverified.join(", ")}\n`,
      ),
    );
  if (status.state !== "approved")
    process.stderr.write(
      t(
        "fiche non appliquée (non approuvée à l'empreinte courante)\n",
        "sheet not applied (not approved at the current hash)\n",
      ),
    );
}

programCmd
  .command("show")
  .description(
    t("Afficher la fiche du projet et son état.", "Show the project sheet and its state."),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const status = await readProgram(defaultConfigDir(), await programProjectId(opts));
    printProgramStatus(status);
    if (status.draft) process.stdout.write(`${JSON.stringify(status.draft, null, 2)}\n`);
  });

programCmd
  .command("import")
  .description(
    t(
      "Importer un brouillon de fiche (n'approuve rien : approbation avec « program approve »).",
      "Import a draft sheet (approves nothing: use 'program approve').",
    ),
  )
  .argument("<file>", t("fichier JSON du brouillon", "draft JSON file"))
  .option(...PROJECT_OPTION)
  .action(async (file: string, opts) => {
    const text = await readFile(resolve(process.cwd(), file), "utf8");
    const status = await importProgramDraft(defaultConfigDir(), await programProjectId(opts), text);
    printProgramStatus(status);
  });

programCmd
  .command("approve")
  .description(
    t(
      "Approuver le brouillon courant (son contenu, identifié par son empreinte).",
      "Approve the current draft (its content, identified by its hash).",
    ),
  )
  .option(
    "--digest <empreinte>",
    t(
      "empreinte du brouillon relue avec « program show » (obligatoire)",
      "draft hash read with 'program show' (required)",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const status = await approveProgram(
      defaultConfigDir(),
      await programProjectId(opts),
      opts.digest,
    );
    printProgramStatus(status);
  });

programCmd
  .command("resume")
  .description(
    t(
      "Reprendre un hôte arrêté par le contrôleur de rythme (débit relancé à la moitié du plafond).",
      "Resume a host halted by the pace controller (restarts at half the ceiling).",
    ),
  )
  .argument("<hôte>", t("hôte arrêté", "halted host"))
  .option(...PROJECT_OPTION)
  .action(async (host: string, opts) => {
    const resumed = clearPaceHalt(defaultConfigDir(), await programProjectId(opts), host);
    process.stdout.write(
      resumed
        ? t(`hôte ${host} repris\n`, `host ${host} resumed\n`)
        : t(`hôte ${host} : non arrêté\n`, `host ${host}: not halted\n`),
    );
  });

programCmd
  .command("suspend")
  .description(
    t(
      "Suspendre la fiche (retour au profil généraliste, fiche conservée).",
      "Suspend the sheet (back to the generalist profile, sheet kept).",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const status = await suspendProgram(defaultConfigDir(), await programProjectId(opts));
    printProgramStatus(status);
  });

// Fiche d'engagement red team (ADR 0041) et arrêt d'urgence : gestes humains, jamais un outil d'agent.
const engagementCmd = program
  .command("engagement")
  .description(
    t(
      "Fiche d'engagement red team du projet (autorisation, périmètre, règles) : validation par empreinte, et arrêt d'urgence.",
      "Project red team engagement sheet (authorization, scope, rules): hash-based approval, and emergency halt.",
    ),
  );

/** Champs de la fiche d'engagement dont la citation n'a pas été recoupée par le moteur. */
const unverifiedEngagementFields = (status: EngagementStatus): string[] => {
  const sheet = status.draft;
  if (!sheet) return [];
  const { version: _version, ...fields } = sheet;
  return Object.entries(fields)
    .filter(([, c]) => !c.verified)
    .map(([k]) => k);
};

function printEngagementStatus(status: EngagementStatus, halted: boolean): void {
  process.stderr.write(
    t(
      `état : ${status.state}${status.digest ? ` · empreinte ${status.digest}` : ""}\n`,
      `state: ${status.state}${status.digest ? ` · hash ${status.digest}` : ""}\n`,
    ),
  );
  if (status.approvedDigest !== undefined)
    process.stderr.write(
      t(
        `approuvée : ${status.approvedAt} · empreinte ${status.approvedDigest}\n`,
        `approved: ${status.approvedAt} · hash ${status.approvedDigest}\n`,
      ),
    );
  if (status.suspendedAt !== undefined)
    process.stderr.write(
      t(`suspendue : ${status.suspendedAt}\n`, `suspended: ${status.suspendedAt}\n`),
    );
  if (status.problem) process.stderr.write(`${formatReason(status.problem, locale)}\n`);
  const unverified = unverifiedEngagementFields(status);
  if (unverified.length > 0)
    process.stderr.write(
      t(
        `citations non recoupées : ${unverified.join(", ")}\n`,
        `unverified citations: ${unverified.join(", ")}\n`,
      ),
    );
  if (status.state !== "approved")
    process.stderr.write(
      t(
        "fiche non appliquée (non approuvée à l'empreinte courante)\n",
        "sheet not applied (not approved at the current hash)\n",
      ),
    );
  if (halted)
    process.stderr.write(
      t(
        "ARRÊT D'URGENCE ACTIF (reprise : « engagement resume »)\n",
        "EMERGENCY HALT ACTIVE (resume with 'engagement resume')\n",
      ),
    );
}

engagementCmd
  .command("show")
  .description(
    t(
      "Afficher la fiche d'engagement du projet, son état et l'arrêt d'urgence.",
      "Show the project engagement sheet, its state and the emergency halt.",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const id = await programProjectId(opts);
    const status = await readEngagement(defaultConfigDir(), id);
    printEngagementStatus(status, isHalted(defaultConfigDir(), id));
    if (status.draft) process.stdout.write(`${JSON.stringify(status.draft, null, 2)}\n`);
  });

engagementCmd
  .command("import")
  .description(
    t(
      "Importer un brouillon de fiche d'engagement (n'approuve rien : approbation avec « engagement approve »).",
      "Import a draft engagement sheet (approves nothing: use 'engagement approve').",
    ),
  )
  .argument("<file>", t("fichier JSON du brouillon", "draft JSON file"))
  .option(...PROJECT_OPTION)
  .action(async (file: string, opts) => {
    const text = await readFile(resolve(process.cwd(), file), "utf8");
    const id = await programProjectId(opts);
    const status = await importEngagementDraft(defaultConfigDir(), id, text);
    printEngagementStatus(status, isHalted(defaultConfigDir(), id));
  });

engagementCmd
  .command("approve")
  .description(
    t(
      "Approuver le brouillon courant (son contenu, identifié par son empreinte).",
      "Approve the current draft (its content, identified by its hash).",
    ),
  )
  .option(
    "--digest <empreinte>",
    t(
      "empreinte du brouillon relue avec « engagement show » (obligatoire)",
      "draft hash read with 'engagement show' (required)",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const id = await programProjectId(opts);
    const status = await approveEngagement(defaultConfigDir(), id, opts.digest);
    printEngagementStatus(status, isHalted(defaultConfigDir(), id));
  });

engagementCmd
  .command("suspend")
  .description(
    t(
      "Suspendre la fiche d'engagement (fiche conservée, non appliquée).",
      "Suspend the engagement sheet (sheet kept, not applied).",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const id = await programProjectId(opts);
    const status = await suspendEngagement(defaultConfigDir(), id);
    printEngagementStatus(status, isHalted(defaultConfigDir(), id));
  });

engagementCmd
  .command("halt")
  .description(
    t(
      "ARRÊT D'URGENCE : poser l'interrupteur du projet (levé seulement par « engagement resume »).",
      "EMERGENCY HALT: set the project switch (lifted only by 'engagement resume').",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const halt = await setHalt(defaultConfigDir(), await programProjectId(opts));
    process.stdout.write(
      t(`arrêt d'urgence posé (${halt.haltedAt})\n`, `emergency halt set (${halt.haltedAt})\n`),
    );
  });

engagementCmd
  .command("resume")
  .description(
    t(
      "Lever l'arrêt d'urgence du projet (geste humain).",
      "Lift the project emergency halt (human gesture).",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const lifted = await clearHalt(defaultConfigDir(), await programProjectId(opts));
    process.stdout.write(
      lifted
        ? t("arrêt d'urgence levé\n", "emergency halt lifted\n")
        : t("aucun arrêt d'urgence posé\n", "no emergency halt set\n"),
    );
  });

// Plan de campagne red team (ADR 0041) : gestes humains (import, approbation, suspension), jamais un outil d'agent.
const campaignCmd = program
  .command("campaign")
  .description(
    t(
      "Plan de campagne red team du projet (objectifs, étapes ATT&CK, démontage) : validation par empreinte.",
      "Project red team campaign plan (objectives, ATT&CK steps, teardown): hash-based approval.",
    ),
  );

function printCampaignStatus(status: CampaignStatus): void {
  process.stderr.write(
    t(
      `état : ${status.state}${status.digest ? ` · empreinte ${status.digest}` : ""}\n`,
      `state: ${status.state}${status.digest ? ` · hash ${status.digest}` : ""}\n`,
    ),
  );
  if (status.approvedDigest !== undefined)
    process.stderr.write(
      t(
        `approuvé : ${status.approvedAt} · empreinte ${status.approvedDigest}\n`,
        `approved: ${status.approvedAt} · hash ${status.approvedDigest}\n`,
      ),
    );
  if (status.suspendedAt !== undefined)
    process.stderr.write(
      t(`suspendu : ${status.suspendedAt}\n`, `suspended: ${status.suspendedAt}\n`),
    );
  if (status.problem) process.stderr.write(`${formatReason(status.problem, locale)}\n`);
  if (status.state !== "approved")
    process.stderr.write(
      t(
        "plan non appliqué (non approuvé à l'empreinte courante) : record_step est refusé\n",
        "plan not applied (not approved at the current hash): record_step is refused\n",
      ),
    );
}

campaignCmd
  .command("show")
  .description(
    t(
      "Afficher le plan de campagne du projet, son état, l'avancement des étapes et le démontage.",
      "Show the project campaign plan, its state, step progress and teardown.",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const id = await programProjectId(opts);
    const status = await readCampaign(defaultConfigDir(), id);
    printCampaignStatus(status);
    const overview = campaignOverview(defaultConfigDir(), id);
    if (overview.plan !== null)
      process.stderr.write(
        t(
          `avancement : ${overview.executedCount}/${overview.steps.length} étapes (${overview.executedPercent} %)\n`,
          `progress: ${overview.executedCount}/${overview.steps.length} steps (${overview.executedPercent}%)\n`,
        ),
      );
    const teardown = readTeardownSync(defaultConfigDir(), id);
    if (teardown.items.length > 0)
      process.stderr.write(
        t(
          `démontage : ${teardown.items.length - teardown.remaining}/${teardown.items.length} faits${teardown.canClose ? "" : " (clôture bloquée)"}\n`,
          `teardown: ${teardown.items.length - teardown.remaining}/${teardown.items.length} done${teardown.canClose ? "" : " (closure blocked)"}\n`,
        ),
      );
    if (status.draft) process.stdout.write(`${JSON.stringify(status.draft, null, 2)}\n`);
  });

campaignCmd
  .command("import")
  .description(
    t(
      "Importer un brouillon de plan de campagne (n'approuve rien : approbation avec « campaign approve »).",
      "Import a draft campaign plan (approves nothing: use 'campaign approve').",
    ),
  )
  .argument("<file>", t("fichier JSON du brouillon", "draft JSON file"))
  .option(...PROJECT_OPTION)
  .action(async (file: string, opts) => {
    const text = await readFile(resolve(process.cwd(), file), "utf8");
    const id = await programProjectId(opts);
    printCampaignStatus(await importCampaignDraft(defaultConfigDir(), id, text));
  });

campaignCmd
  .command("approve")
  .description(
    t(
      "Approuver le brouillon courant (son contenu, identifié par son empreinte).",
      "Approve the current draft (its content, identified by its hash).",
    ),
  )
  .option(
    "--digest <empreinte>",
    t(
      "empreinte du brouillon relue avec « campaign show » (obligatoire)",
      "draft hash read with 'campaign show' (required)",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const id = await programProjectId(opts);
    printCampaignStatus(await approveCampaign(defaultConfigDir(), id, opts.digest));
  });

campaignCmd
  .command("suspend")
  .description(
    t(
      "Suspendre le plan de campagne (plan conservé, non appliqué).",
      "Suspend the campaign plan (plan kept, not applied).",
    ),
  )
  .option(...PROJECT_OPTION)
  .action(async (opts) => {
    const id = await programProjectId(opts);
    printCampaignStatus(await suspendCampaign(defaultConfigDir(), id));
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

for (const command of [
  program,
  ...program.commands,
  ...policyCmd.commands,
  ...programCmd.commands,
  ...engagementCmd.commands,
  ...campaignCmd.commands,
]) {
  command.helpOption("-h, --help", t("afficher l’aide", "display help"));
}

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`warband : ${formatError(err, locale)}\n`);
  process.exitCode = 1;
});
