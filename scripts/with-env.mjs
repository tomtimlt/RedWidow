#!/usr/bin/env node
// Lance une commande avec des variables d'environnement ajoutées, de façon portable
// (remplace le préfixe POSIX `KEY=VAL cmd`, sans dépendance).
// Usage : node scripts/with-env.mjs KEY=VAL [KEY2=VAL2 ...] -- commande [args...]
import { spawn } from "node:child_process";

const usage = "usage : node scripts/with-env.mjs KEY=VAL [KEY2=VAL2 ...] -- commande [args...]";
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === argv.length - 1) {
  console.error(`with-env : « -- » suivi d'une commande est obligatoire\n${usage}`);
  process.exit(2);
}

const extra = {};
for (const pair of argv.slice(0, sep)) {
  const eq = pair.indexOf("=");
  if (eq <= 0 || pair.includes("\0")) {
    console.error(`with-env : affectation invalide « ${pair.split("=")[0]} »\n${usage}`);
    process.exit(2);
  }
  extra[pair.slice(0, eq)] = pair.slice(eq + 1);
}

const [command, ...args] = argv.slice(sep + 1);
// `shell: true` sous Windows : les commandes `.cmd` (pnpm, vitest) l'exigent ; les arguments
// viennent de la ligne de commande de l'appelant, jamais d'une source externe.
const child = spawn(command, args, {
  stdio: "inherit",
  env: { ...process.env, ...extra },
  shell: process.platform === "win32" && !/\.exe$/i.test(command),
});

// Relaie les signaux reçus à l'enfant.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));

child.on("error", (error) => {
  console.error(`with-env : ${error.message}`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  if (signal) {
    // Propage le signal : on se tue avec le même (repli : 128 + numéro).
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
