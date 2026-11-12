#!/usr/bin/env node
import { createInterface } from "node:readline";
import { CodedError, errorInfo } from "@warband/core";
import { formatReason } from "@warband/messages";
import { loadPasswordHash } from "./auth/password.js";
import { runSetPassword, type SetPasswordIo } from "./auth/set-password.js";
import { ConfigError, loadConfig, resolveDataDir } from "./config.js";
import { createServer } from "./http.js";
import { openStorage } from "./storage/index.js";

async function serve(): Promise<void> {
  const config = loadConfig(process.env);
  // Sans empreinte valide, le serveur ne démarre pas (authentification fermée par défaut).
  const passwordHash = await loadPasswordHash(config.dataDir, process.env);
  // Clé maître absente ou fausse : démarrage refusé avant toute écoute.
  const storage = await openStorage(config.dataDir, process.env);
  const server = createServer(config, { passwordHash, storage });
  server.listen(config.port, config.host, () => {
    // Ligne de démarrage : adresse et dossier seulement, aucun secret.
    console.log(
      `redwidow-server : écoute sur http://${config.host}:${config.port} (données : ${config.dataDir})`,
    );
  });
  const stop = () => {
    const quit = () => process.exit(0);
    server.close(() => void storage.state.flush().then(quit, quit));
    server.closeAllConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

/** Lecture d'une ligne en terminal sans écho (mode brut). */
function readHidden(prompt: string): Promise<string> {
  return new Promise((ok, ko) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => ok(value));
        if (ch === "\u0003") return done(() => ko(new Error("interrompu")));
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** Une ligne de l'entrée standard (sans le saut de ligne final). */
function readLine(): Promise<string> {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin });
    let line: string | undefined;
    rl.once("line", (l) => {
      line = l;
      rl.close();
    });
    rl.once("close", () => ok(line ?? ""));
  });
}

async function setPassword(args: readonly string[]): Promise<void> {
  const io: SetPasswordIo = {
    readHidden,
    readLine,
    isTTY: process.stdin.isTTY === true,
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  };
  await runSetPassword(
    {
      dataDir: resolveDataDir(process.env),
      stdin: args.includes("--stdin"),
      print: args.includes("--print"),
    },
    io,
  );
}

const command = process.argv[2] ?? "serve";
try {
  if (command === "serve") await serve();
  else if (command === "set-password") await setPassword(process.argv.slice(3));
  else {
    console.error(
      `redwidow-server : sous-commande inconnue « ${command} » (attendu : serve, set-password)`,
    );
    process.exit(2);
  }
} catch (err) {
  // Seuls les codes et les messages du catalogue sont affichés : jamais de secret.
  const message =
    err instanceof ConfigError
      ? err.message
      : err instanceof CodedError
        ? formatReason(errorInfo(err))
        : "échec du démarrage";
  console.error(`redwidow-server : ${message}`);
  process.exit(1);
}
