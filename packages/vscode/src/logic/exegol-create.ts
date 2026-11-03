import { stat } from "node:fs/promises";
import { extname, isAbsolute, normalize } from "node:path";
import { createRecorder, resolveBinary, runProcess } from "@warband/core";
import { t } from "@warband/messages";

export interface ExegolCreateOptions {
  name: string;
  image?: string;
  workspacePath?: string;
  vpnPath?: string;
  network?: "nat" | "host" | "disabled";
  desktop?: boolean;
  desktopPort?: number;
  gui?: boolean;
  log?: boolean;
  exegolResources?: boolean;
  myResources?: boolean;
}

export interface ExegolCapabilities {
  flags: ReadonlySet<string>;
}

/** Seuls les noms d'options effectivement annoncés par la CLI sont retenus. */
export function parseExegolCapabilities(help: string): ExegolCapabilities {
  return { flags: new Set(help.match(/--[A-Za-z][A-Za-z0-9-]*/g) ?? []) };
}

function token(value: string, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    throw new Error(
      t`${label} Exegol invalide (128 caractères alphanumériques, point, tiret ou underscore maximum).`,
    );
  }
  return value;
}

function hostPath(value: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new Error(t("Le chemin hôte doit être absolu et sans caractère de contrôle."));
  }
  return normalize(value);
}

/** Produit uniquement des arguments structurés, jamais une commande shell. */
export function buildExegolCreateArgv(
  options: ExegolCreateOptions,
  capabilities: ExegolCapabilities,
): string[] {
  const argv = ["start", token(options.name, t("Nom"))];
  if (options.image !== undefined && options.image !== "")
    argv.push(token(options.image, t("Tag image")));
  const add = (flag: string, ...values: string[]) => {
    if (!capabilities.flags.has(flag))
      throw new Error(t`Cette version d’Exegol ne prend pas en charge ${flag}.`);
    argv.push(flag, ...values);
  };
  const network = options.network ?? "nat";
  if (!["nat", "host", "disabled"].includes(network)) throw new Error(t("Réseau Exegol invalide."));
  if (options.vpnPath && network !== "nat") throw new Error(t("Le VPN nécessite le réseau NAT."));
  if (options.desktop && network === "disabled")
    throw new Error(t("Le bureau nécessite un réseau actif."));
  if (options.workspacePath) add("--workspace", hostPath(options.workspacePath));
  add("--network", network);
  if (options.vpnPath) add("--vpn", hostPath(options.vpnPath));
  if (options.desktop !== undefined && typeof options.desktop !== "boolean") {
    throw new Error(t("Option de bureau Exegol invalide."));
  }
  if (options.desktop === false) {
    if (!capabilities.flags.has("--no-desktop")) {
      throw new Error(
        t(
          "Cette version d’Exegol ne permet pas de désactiver explicitement le bureau. Mettez Exegol à jour pour garantir l’absence d’exposition du bureau.",
        ),
      );
    }
    add("--no-desktop");
  }
  if (options.desktop) {
    const port = options.desktopPort ?? 6080;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(t("Port du bureau invalide (1 à 65535)."));
    add("--desktop");
    add("--desktop-config", `http:127.0.0.1:${port}`);
  }
  // Sources officielles : Exegol 6.0.2 et 5.1.9, GenericParameters.py.
  const toggle = (
    value: boolean | undefined,
    positive: string,
    negative: string,
    legacy: string,
  ) => {
    if (value === undefined) return;
    if (typeof value !== "boolean") throw new Error(t("Option de partage Exegol invalide."));
    if (value) {
      if (capabilities.flags.has(positive)) add(positive);
      else if (!capabilities.flags.has(legacy))
        throw new Error(t`Cette version d’Exegol ne permet pas de configurer ${positive}.`);
      // Les versions historiques n'ont que le refus ; le partage est activé par défaut.
    } else if (capabilities.flags.has(negative)) add(negative);
    else add(legacy);
  };
  toggle(options.gui, "--gui", "--no-gui", "--disable-X11");
  toggle(
    options.exegolResources,
    "--exegol-resources",
    "--no-exegol-resources",
    "--disable-exegol-resources",
  );
  toggle(options.myResources, "--my-resources", "--no-my-resources", "--disable-my-resources");
  const log = options.log ?? true;
  if (typeof log !== "boolean") throw new Error(t("Option de journalisation Exegol invalide."));
  if (log) {
    add("--log");
    if (capabilities.flags.has("--log-method")) add("--log-method", "script");
  } else if (capabilities.flags.has("--no-log")) {
    add("--no-log");
  } else {
    throw new Error(
      t(
        "Cette version d’Exegol ne permet pas de désactiver explicitement les logs. Mettez Exegol à jour.",
      ),
    );
  }
  return argv;
}

export interface ExegolCreateDependencies {
  resolveBin?: typeof resolveBinary;
  run?: typeof runProcess;
  statPath?: typeof stat;
}

/** Vérifie les chemins sans lire les configurations VPN puis prépare un terminal interactif. */
export async function prepareExegolCreate(
  options: ExegolCreateOptions,
  deps: ExegolCreateDependencies = {},
): Promise<{ shellPath: string; shellArgs: string[] }> {
  const shellPath = (deps.resolveBin ?? resolveBinary)("exegol");
  if (!shellPath) throw new Error(t("Exegol est introuvable dans le PATH."));
  const statPath = deps.statPath ?? stat;
  for (const [kind, path] of [
    ["workspace", options.workspacePath],
    ["vpn", options.vpnPath],
  ] as const) {
    if (!path) continue;
    const nativePath = hostPath(path);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await statPath(nativePath);
    } catch {
      throw new Error(
        kind === "vpn"
          ? t("Le chemin VPN est inaccessible.")
          : t("Le dossier de travail est inaccessible."),
      );
    }
    if (kind === "workspace" && !info.isDirectory())
      throw new Error(t("Le dossier de travail doit être un répertoire."));
    if (
      kind === "vpn" &&
      !info.isDirectory() &&
      !(info.isFile() && [".ovpn", ".conf"].includes(extname(nativePath).toLowerCase()))
    ) {
      throw new Error(t("Sélectionnez un fichier VPN .ovpn ou .conf, ou un répertoire."));
    }
  }
  const result = await (deps.run ?? runProcess)([shellPath, "start", "--help"], {
    recorder: createRecorder(),
    parentId: null,
    timeoutMs: 15_000,
    maxCapturedLines: 2000,
  });
  if (result.code !== 0)
    throw new Error(t("Impossible de vérifier les options de cette version d’Exegol."));
  return {
    shellPath,
    shellArgs: buildExegolCreateArgv(options, parseExegolCapabilities(result.stdout.join("\n"))),
  };
}
