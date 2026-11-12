import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CodedError, ValidationError } from "@warband/core";
import { formatError } from "@warband/messages";
import { afterAll, describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import {
  type CockpitContainerView,
  containerMentions,
  controlListedContainer,
  imageRefs,
  linkedProjectStatus,
  linkedTerminalChoices,
  listCockpitImages,
  loadCockpitView,
  moveActiveProject,
  parseCockpitMessage,
  planEditorShell,
  prepareTerminal,
  setPrimary,
  sortContainers,
  terminalLaunch,
  type WorkspaceRun,
} from "../src/logic/cockpit.js";
import { chatHtml, cockpitHtml, makeNonce } from "../src/logic/html.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const htmlOpts = {
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/cockpit.js",
  styleUri: "https://x.vscode-cdn.net/media/chat.css",
};

describe("planEditorShell", () => {
  const containers = [
    { name: "exegol-htb1", state: "running" as const },
    { name: "exegol-lab", state: "stopped" as const },
  ];

  it("liste vide ou token inconnu : skip", () => {
    expect(planEditorShell("htb1", [], [])).toEqual({ action: "skip" });
    expect(planEditorShell("missing", containers, [])).toEqual({ action: "skip" });
  });

  it("court ambigu : skip", () => {
    expect(
      planEditorShell(
        "htb1",
        [
          { name: "exegol-htb1", state: "running" },
          { name: "htb1", state: "stopped" },
        ],
        [],
      ),
    ).toEqual({ action: "skip" });
  });

  it("arrêté : skip", () => {
    expect(planEditorShell("lab", containers, [])).toEqual({ action: "skip" });
  });

  it("nom court résolu : premier titre sans suffixe", () => {
    expect(planEditorShell("htb1", containers, [])).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "RedWidow : exegol-htb1",
    });
  });

  it("deuxième shell : suffixe (2)", () => {
    expect(planEditorShell("htb1", containers, ["Warband : exegol-htb1"])).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "RedWidow : exegol-htb1 (2)",
    });
  });

  it("trou d'indice : réutilise le plus petit libre", () => {
    expect(
      planEditorShell("htb1", containers, ["Warband : exegol-htb1", "Warband : exegol-htb1 (3)"]),
    ).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "RedWidow : exegol-htb1 (2)",
    });
  });

  it("nom avec point : titre exact uniquement", () => {
    const dotted = [{ name: "my.box", state: "running" as const }];
    expect(planEditorShell("my.box", dotted, ["Warband : my.box"])).toEqual({
      action: "launch",
      name: "my.box",
      title: "RedWidow : my.box (2)",
    });
    expect(planEditorShell("my.box", dotted, ["Warband : my.box (2)"])).toEqual({
      action: "launch",
      name: "my.box",
      title: "RedWidow : my.box",
    });
  });

  it("cinquième demande : reveal du dernier titre suivi", () => {
    const open = [
      "Warband : exegol-htb1",
      "Warband : exegol-htb1 (2)",
      "Warband : exegol-htb1 (3)",
      "Warband : exegol-htb1 (4)",
    ];
    expect(planEditorShell("htb1", containers, open)).toEqual({
      action: "reveal",
      title: "Warband : exegol-htb1 (4)",
    });
    expect(
      planEditorShell("htb1", containers, [
        ...open,
        "Warband : autre",
        "Warband : exegol-htb1 (2)",
      ]),
    ).toEqual({
      action: "reveal",
      title: "Warband : exegol-htb1 (2)",
    });
  });

  it("anciens et nouveaux shells partagent les indices et la limite", () => {
    const open = ["Warband : exegol-htb1", "RedWidow : exegol-htb1 (3)"];
    expect(planEditorShell("htb1", containers, open)).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "RedWidow : exegol-htb1 (2)",
    });
    expect(
      planEditorShell("htb1", containers, [
        ...open,
        "RedWidow : exegol-htb1 (2)",
        "Warband : exegol-htb1 (4)",
      ]),
    ).toEqual({ action: "reveal", title: "Warband : exegol-htb1 (4)" });
  });

  it("un titre à indice identique compte chaque terminal physique vers la limite", () => {
    expect(
      planEditorShell("htb1", containers, [
        "Warband : exegol-htb1",
        "RedWidow : exegol-htb1",
        "Warband : exegol-htb1 (2)",
        "RedWidow : exegol-htb1 (2)",
      ]),
    ).toEqual({ action: "reveal", title: "RedWidow : exegol-htb1 (2)" });
  });

  it("ignore les faux préfixes et les titres d'un autre conteneur", () => {
    expect(
      planEditorShell("htb1", containers, [
        "Warband bis : exegol-htb1",
        "RedWidow bis : exegol-htb1 (2)",
        "RedWidow : exegol-htb1-autre (3)",
        "Autre RedWidow : exegol-htb1 (4)",
        "RedWidow : exegol-htb1 (5)",
      ]),
    ).toEqual({ action: "launch", name: "exegol-htb1", title: "RedWidow : exegol-htb1" });
  });
});

describe("terminalLaunch", () => {
  const docker = "/usr/bin/docker";

  it("argv exact pour un conteneur valide", () => {
    expect(terminalLaunch("my-box", docker)).toEqual({
      shellPath: docker,
      shellArgs: [
        "exec",
        "--interactive",
        "--tty",
        "--workdir",
        "/workspace",
        "my-box",
        "/bin/bash",
      ],
    });
  });

  it.each(["-u", "--privileged", "--user", "-v", "--mount"])(
    "refuse un opérande conteneur %j",
    (name) => {
      expect(() => terminalLaunch(name, docker)).toThrow(ValidationError);
    },
  );
});

describe("prepareTerminal", () => {
  const docker = "/usr/bin/docker";
  const mkdirOf = (name: string) => ["exec", "-u", "root", name, "mkdir", "-p", "/workspace"];

  const recording = (
    code = 0,
    stderr: readonly string[] = [],
  ): {
    run: WorkspaceRun;
    calls: string[][];
  } => {
    const calls: string[][] = [];
    return {
      calls,
      run: async (argv) => {
        calls.push([...argv]);
        return { code, stderr };
      },
    };
  };

  it("crée /workspace avec le nom réel, puis le shell inchangé", async () => {
    const { run, calls } = recording();
    const launched = await prepareTerminal("frosty_margulis", docker, ["/bin/bash"], run);
    expect(calls).toEqual([mkdirOf("frosty_margulis")]);
    const argv = calls[0] ?? [];
    expect(argv).not.toContain("--workdir");
    expect(argv).not.toContain("--privileged");
    expect(argv).not.toContain("--network");
    expect(argv).not.toContain("--volume");
    expect(argv).not.toContain("--mount");
    expect(argv).not.toContain("-v");
    expect(launched).toEqual(terminalLaunch("frosty_margulis", docker));
  });

  it("n'exécute pas un nom refusé", async () => {
    const { run, calls } = recording();
    await expect(prepareTerminal("--privileged", docker, ["/bin/bash"], run)).rejects.toThrow(
      ValidationError,
    );
    expect(calls).toEqual([]);
  });

  it("mkdir en échec : docker.failed avec la sortie, pas de shell", async () => {
    const { run } = recording(1, ["mkdir: Permission denied"]);
    const error = await prepareTerminal("frosty_margulis", docker, ["/bin/bash"], run).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(CodedError);
    if (!(error instanceof CodedError)) return;
    expect(error.code).toBe("docker.failed");
    expect(error.params).toMatchObject({
      command: "exec",
      exitCode: 1,
      stderr: "mkdir: Permission denied",
    });
    expect(formatError(error)).toBe("docker exec a échoué (code 1) : mkdir: Permission denied");
  });

  it("mkdir en échec avec stderr vide : repli sur stdout", async () => {
    const run: WorkspaceRun = async () => ({ code: 1, stderr: [], stdout: ["erreur sur stdout"] });
    const error = await prepareTerminal("frosty_margulis", docker, ["/bin/bash"], run).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).params).toMatchObject({ stderr: "erreur sur stdout" });
  });

  it("mkdir : un partage Docker Desktop refusé garde docker.pathNotShared", async () => {
    const run: WorkspaceRun = async () => ({
      code: 1,
      stderr: [
        "docker: Error response from daemon: Mounts denied: The path /tmp/x is not shared from the host and is not known to Docker.",
      ],
    });
    const error = await prepareTerminal("frosty_margulis", docker, ["/bin/bash"], run).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe("docker.pathNotShared");
  });

  it("docker absent : pas d'exec", async () => {
    const { run, calls } = recording();
    await expect(
      prepareTerminal("frosty_margulis", null, ["/bin/bash"], run),
    ).rejects.toMatchObject({ code: "process.notFound" });
    expect(calls).toEqual([]);
  });
});

describe("parseCockpitMessage", () => {
  it("accepte les messages prévus", () => {
    expect(parseCockpitMessage({ type: "refresh" })).toEqual({ type: "refresh" });
    expect(parseCockpitMessage({ type: "link", name: "c1" })).toEqual({ type: "link", name: "c1" });
    expect(parseCockpitMessage({ type: "openWorkspace" })).toEqual({ type: "openWorkspace" });
    expect(parseCockpitMessage({ type: "terminal" })).toEqual({ type: "terminal" });
    expect(parseCockpitMessage({ type: "setPrimary", name: "exegol-htb1" })).toEqual({
      type: "setPrimary",
      name: "exegol-htb1",
    });
    expect(parseCockpitMessage({ type: "start", name: "exegol-htb1" })).toEqual({
      type: "start",
      name: "exegol-htb1",
    });
    expect(parseCockpitMessage({ type: "stop", name: "exegol-htb1" })).toEqual({
      type: "stop",
      name: "exegol-htb1",
    });
    expect(parseCockpitMessage({ type: "listImages" })).toEqual({ type: "listImages" });
    expect(parseCockpitMessage({ type: "pickSharedFolder" })).toEqual({
      type: "pickSharedFolder",
    });
    expect(
      parseCockpitMessage({ type: "createExegol", name: "htb1", shareMode: "project" }),
    ).toEqual({ type: "createExegol", name: "htb1", shareMode: "project" });
  });

  it("activateProject : id de projet seul, sans clé en trop", () => {
    const projectId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(parseCockpitMessage({ type: "activateProject", projectId })).toEqual({
      type: "activateProject",
      projectId,
    });
    expect(parseCockpitMessage({ type: "activateProject" })).toBeNull();
    expect(parseCockpitMessage({ type: "activateProject", projectId: "p1" })).toBeNull();
    expect(parseCockpitMessage({ type: "activateProject", projectId, path: "/etc" })).toBeNull();
  });

  it("moveProject et dismissMountIssue : type seul, toute clé en trop est rejetée", () => {
    for (const type of ["moveProject", "dismissMountIssue"]) {
      expect(parseCockpitMessage({ type })).toEqual({ type });
      expect(parseCockpitMessage({ type, path: "/tmp" })).toBeNull();
      expect(parseCockpitMessage({ type, projectId: "x" })).toBeNull();
    }
  });

  it("shareMode est obligatoire et fermé sur les deux créations", () => {
    const kali = { type: "createKali", image: "kali:latest", name: "lab" };
    const exegol = { type: "createExegol", name: "lab" };
    for (const base of [kali, exegol]) {
      expect(parseCockpitMessage(base)).toBeNull();
      expect(parseCockpitMessage({ ...base, shareMode: "other" })).toBeNull();
      expect(parseCockpitMessage({ ...base, shareMode: "" })).toBeNull();
      expect(parseCockpitMessage({ ...base, shareMode: true })).toBeNull();
      for (const shareMode of ["project", "multi"])
        expect(parseCockpitMessage({ ...base, shareMode })).toEqual({ ...base, shareMode });
    }
  });

  it("mode projet : toute source envoyée par la webview est refusée", () => {
    const kali = { type: "createKali", image: "kali:latest", name: "lab", shareMode: "project" };
    const exegol = { type: "createExegol", name: "lab", shareMode: "project" };
    for (const base of [kali, exegol])
      for (const source of ["/etc", "", "/home/me/lab"])
        expect(parseCockpitMessage({ ...base, source })).toBeNull();
  });

  it("le message Kali parsé égale image, name et shareMode, sans source", () => {
    const image = "kalilinux/kali-rolling:latest";
    const name = "lab";
    const source = "/home/me/lab";
    expect(
      parseCockpitMessage({ type: "createKali", image, name, source, shareMode: "multi" }),
    ).toEqual({ type: "createKali", image, name, shareMode: "multi" });
  });

  it("refuse clés en trop, types chat et formes invalides", () => {
    expect(parseCockpitMessage({ type: "refresh", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "send", text: "x" })).toBeNull();
    expect(parseCockpitMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseCockpitMessage({ type: "rendered", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "link", name: "" })).toBeNull();
    expect(parseCockpitMessage({ type: "start", name: "a", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "stop" })).toBeNull();
    expect(parseCockpitMessage({ type: "create" })).toBeNull();
    expect(parseCockpitMessage({ type: "create", name: "htb1" })).toBeNull();
    expect(parseCockpitMessage({ type: "listImages", extra: true })).toBeNull();
    expect(parseCockpitMessage({ type: "pickSharedFolder", source: "/tmp" })).toBeNull();
    expect(parseCockpitMessage({ type: "setPrimary", name: "a", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "setPrimary", name: "" })).toBeNull();
    expect(parseCockpitMessage({ type: "setPrimary", name: "a".repeat(257) })).toBeNull();
    expect(parseCockpitMessage({ type: "setPrimary", name: "a".repeat(256) })).toEqual({
      type: "setPrimary",
      name: "a".repeat(256),
    });
    // Le choix du terminal vient toujours de l'extension, jamais de la webview.
    expect(parseCockpitMessage({ type: "terminal", name: "a" })).toBeNull();
    expect(parseWebviewMessage({ type: "start", name: "a" })).toBeNull();
    expect(parseWebviewMessage({ type: "create" })).toBeNull();
    expect(parseWebviewMessage({ type: "refresh" })).toBeNull();
    expect(parseWebviewMessage({ type: "link", name: "c" })).toBeNull();
    expect(
      parseWebviewMessage({
        type: "createKali",
        image: "kali:latest",
        name: "lab",
        source: "/tmp",
      }),
    ).toBeNull();
  });

  it("le message Exegol n'a que name", () => {
    const share = { shareMode: "multi" };
    expect(
      parseCockpitMessage({ type: "createExegol", name: "htb1", image: "kali:latest", ...share }),
    ).toBeNull();
    // Un `source` texte de la webview est toléré en mode multi mais jamais retransmis (ADR 0050).
    expect(
      parseCockpitMessage({ type: "createExegol", name: "htb1", source: "/tmp", ...share }),
    ).toEqual({ type: "createExegol", name: "htb1", ...share });
    expect(parseCockpitMessage({ type: "createExegol", ...share })).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "", ...share })).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "-bad", ...share })).toBeNull();
    expect(
      parseCockpitMessage({ type: "createExegol", name: "a".repeat(65), ...share }),
    ).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "a".repeat(64), ...share })).toEqual({
      type: "createExegol",
      name: "a".repeat(64),
      ...share,
    });
  });

  it("refuse un Kali incomplet ou une image hors motif, et ignore tout `source` de la webview", () => {
    const ok = { type: "createKali", image: "kali:latest", name: "lab", shareMode: "multi" };
    expect(parseCockpitMessage({ ...ok, extra: 1 })).toBeNull();
    expect(parseCockpitMessage(ok)).toEqual(ok);
    expect(parseCockpitMessage({ ...ok, image: "" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, name: "" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, image: "-kali" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, image: "a".repeat(257) })).toBeNull();
    expect(parseCockpitMessage({ ...ok, image: "a".repeat(256) })).toEqual({
      ...ok,
      image: "a".repeat(256),
    });
    // Le chemin texte n'est jamais retransmis : le dossier partagé vient du sélecteur de l'hôte.
    expect(parseCockpitMessage({ ...ok, source: "/etc" })).toEqual(ok);
    expect(parseCockpitMessage({ ...ok, source: "" })).toEqual(ok);
    expect(parseCockpitMessage({ ...ok, shareMode: "project", source: "" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, source: "a\nb" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, source: "a\0b" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, source: "a".repeat(4097) })).toBeNull();
  });
});

const tempRoot = mkdtempSync(join(tmpdir(), "cockpit-view-"));
const shareRoot = join(tempRoot, "share");
const outsideRoot = join(tempRoot, "outside");
const linkToOutside = join(shareRoot, "vers-dehors");
const linkToInside = join(tempRoot, "vers-dedans");
mkdirSync(join(shareRoot, "proj"), { recursive: true });
mkdirSync(join(shareRoot, "autre"));
mkdirSync(outsideRoot);
symlinkSync(outsideRoot, linkToOutside);
symlinkSync(join(shareRoot, "proj"), linkToInside);
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

const projectFile = (
  containers: readonly string[],
  workspace = "/host/ws",
  active = true,
  primary?: string,
) => ({
  activeId: active ? "p1" : null,
  projects: [
    { id: "p1", name: "a", workspace, containers, ...(primary !== undefined && { primary }) },
  ],
});

describe("loadCockpitView", () => {
  const rows = [
    { state: "stopped" as const, name: "b", image: "i:2", family: "exegol" as const },
    {
      state: "running" as const,
      name: "a",
      image: "i:1",
      workspace: "/host/ws",
      family: "exegol" as const,
    },
    { state: "running" as const, name: "c", image: "i:3", family: "exegol" as const },
  ];

  it("docker absent : message dédié, pas d'erreur projet", async () => {
    const view = await loadCockpitView({
      resolveBin: () => null,
      readProj: async () => null,
    });
    expect(view.empty).toBe("docker");
    expect(view.error).toBeUndefined();
    expect(view.linked).toBe("na");
  });

  it("project.absent : non lié sans erreur", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => null,
      createDocker: () => ({ listLabelPrefix: async () => rows }),
    });
    expect(view.linked).toBe("none");
    expect(view.error).toBeUndefined();
    expect(view.linkedBanner).toBeNull();
  });

  it("démon en échec : erreur formatée, liste vide", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => null,
      createDocker: () => ({
        listLabelPrefix: async () => {
          throw new CodedError("docker.failed", { binary: "docker", command: "ps", exitCode: 1 });
        },
      }),
    });
    expect(view.error).toBeTruthy();
    expect(view.containers).toEqual([]);
    expect(view.daemon).toBe("unreachable");
  });

  it("conteneur lié, arrêté, sans montage et liste triée", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : n === "exegol" ? "/d/exegol" : null),
      readProj: async () => projectFile(["a"]),
      createDocker: () => ({ listLabelPrefix: async () => rows }),
    });
    expect(view.linked).toBe("running");
    expect(view.linkedBanner?.name).toBe("a");
    expect(view.containers.map((c) => c.name)).toEqual(["a", "c", "b"]);
    expect(view.containers.map((c) => c.short)).toEqual(["a", "c", "b"]);
    expect(view.linkedBanner?.short).toBe("a");
    const stopped = view.containers.find((c) => c.name === "b");
    expect(stopped?.canLink).toBe(false);
    expect(stopped?.linkTitle).toBe("Conteneur arrêté");
    expect(stopped?.family).toBe("exegol");
    const noWs = view.containers.find((c) => c.name === "c");
    expect(noWs?.linkTitle).toBe("Sans montage /workspace");
    expect(noWs?.canLink).toBe(false);
    expect(noWs?.family).toBe("exegol");
    const linked = view.containers.find((c) => c.name === "a");
    expect(linked?.linked).toBe(true);
    expect(linked?.canLink).toBe(false);
    expect(linked?.family).toBe("exegol");
  });

  it("kali : lien seulement s'il tourne, a un workspace et voit le projet actif", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => projectFile([], join(shareRoot, "proj")),
      createDocker: () => ({
        listLabelPrefix: async () => [
          {
            state: "running" as const,
            name: "kali-up",
            image: "kalilinux/kali-rolling",
            workspace: shareRoot,
            family: "kali" as const,
          },
          {
            state: "stopped" as const,
            name: "kali-off",
            image: "kalilinux/kali-rolling",
            workspace: shareRoot,
            family: "kali" as const,
          },
          {
            state: "running" as const,
            name: "kali-nows",
            image: "kalilinux/kali-rolling",
            family: "kali" as const,
          },
        ],
      }),
    });
    const up = view.containers.find((c) => c.name === "kali-up");
    expect(up?.family).toBe("kali");
    expect(up?.canLink).toBe(true);
    expect(up?.linkTitle).toBeUndefined();
    const off = view.containers.find((c) => c.name === "kali-off");
    expect(off?.canLink).toBe(false);
    expect(off?.linkTitle).toBe("Conteneur arrêté");
    const nows = view.containers.find((c) => c.name === "kali-nows");
    expect(nows?.canLink).toBe(false);
    expect(nows?.linkTitle).toBe("Sans montage /workspace");
  });

  it("project.invalid : indicateur sans liste", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => {
        throw new CodedError("project.invalid", { reason: "json" });
      },
    });
    expect(view.projectInvalid).toBe(true);
    expect(view.containers).toEqual([]);
  });

  it("zéro ou plusieurs noms : pas de bannière, les noms présents sont liés", async () => {
    const deps = {
      resolveBin: (n: string) => (n === "docker" ? "/d/docker" : null),
      createDocker: () => ({
        listLabelPrefix: async () =>
          rows.map((r) => (r.name === "a" ? { ...r, workspace: shareRoot } : r)),
      }),
    };
    const ws = join(shareRoot, "proj");
    const none = await loadCockpitView({ ...deps, readProj: async () => projectFile([], ws) });
    expect(none.linkedBanner).toBeNull();
    expect(none.linked).toBe("none");
    expect(none.containers.find((c) => c.name === "a")?.canLink).toBe(true);
    const many = await loadCockpitView({
      ...deps,
      readProj: async () => projectFile(["a", "c"], ws),
    });
    expect(many.linkedBanner).toBeNull();
    expect(many.linked).toBe("none");
    expect(many.containers.find((c) => c.name === "a")).toMatchObject({
      linked: true,
      canLink: false,
    });
    expect(many.containers.find((c) => c.name === "c")).toMatchObject({
      linked: true,
      canLink: false,
    });
    expect(many.containers.find((c) => c.name === "b")?.linked).toBe(false);
  });

  it("un Kali déjà dans l'allowlist reste non liable", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => projectFile(["kali-box"], "/host/proj"),
      createDocker: () => ({
        listLabelPrefix: async () => [
          {
            state: "running" as const,
            name: "kali-box",
            image: "kalilinux/kali-rolling",
            workspace: "/host/kali",
            family: "kali" as const,
          },
        ],
      }),
    });
    const kali = view.containers.find((c) => c.name === "kali-box");
    expect(kali).toMatchObject({ linked: true, canLink: false });
    expect(view.linkedBanner).toMatchObject({
      name: "kali-box",
      workspace: "/host/proj",
      state: "running",
    });
  });

  it("un montage relatif ne se lie pas", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => projectFile([]),
      createDocker: () => ({
        listLabelPrefix: async () => [
          {
            state: "running" as const,
            name: "box",
            image: "i",
            workspace: "rel/ws",
            family: "exegol" as const,
          },
        ],
      }),
    });
    expect(view.containers[0]).toMatchObject({
      canLink: false,
      linkTitle: "Sans montage /workspace",
    });
  });

  it("un seul conteneur lié : jamais de primary même si posé", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => projectFile(["a"], "/host/ws", true, "a"),
      createDocker: () => ({ listLabelPrefix: async () => rows }),
    });
    expect(view.containers.find((c) => c.name === "a")?.primary).toBe(false);
  });

  it("deux conteneurs liés et un primary posé : la ligne primary seule l'indique, et la bannière le suit (corrige le bug)", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => projectFile(["a", "c"], "/host/ws", true, "c"),
      createDocker: () => ({ listLabelPrefix: async () => rows }),
    });
    expect(view.containers.find((c) => c.name === "a")?.primary).toBe(false);
    expect(view.containers.find((c) => c.name === "c")?.primary).toBe(true);
    expect(view.containers.find((c) => c.name === "b")?.primary).toBe(false);
    // Avant le correctif, `linkedBanner` restait `null` ici (il ne regardait que l'unique).
    expect(view.linkedBanner).toMatchObject({ name: "c", state: "running" });
    expect(view.linked).toBe("running");
  });
});

describe("loadCockpitView : projets d'un conteneur et compatibilité (ADR 0052)", () => {
  const deps = (
    registry: { activeId: string | null; projects: ReturnType<typeof projectFile>["projects"] },
    workspace: string | undefined,
    state: "running" | "stopped" = "running",
  ) => ({
    resolveBin: (n: string) => (n === "docker" ? "/d/docker" : null),
    readProj: async () => registry,
    createDocker: () => ({
      listLabelPrefix: async () => [
        {
          state,
          name: "box",
          image: "i",
          family: "kali" as const,
          ...(workspace !== undefined && { workspace }),
        },
      ],
    }),
  });
  const entry = (id: string, name: string, workspace: string) => ({
    id,
    name,
    workspace,
    containers: [] as string[],
  });

  it("liste les projets enregistrés dans le partage et marque le projet actif", async () => {
    const view = await loadCockpitView(
      deps(
        {
          activeId: "p2",
          projects: [
            entry("p1", "un", join(shareRoot, "proj")),
            entry("p2", "deux", join(shareRoot, "autre")),
            entry("p3", "dehors", outsideRoot),
          ],
        },
        shareRoot,
      ),
    );
    expect(view.containers[0]).toMatchObject({
      compatible: true,
      canLink: true,
      projects: [
        { id: "p1", name: "un", active: false },
        { id: "p2", name: "deux", active: true },
      ],
    });
  });

  it("un projet hors du partage rend le conteneur incompatible : Lier désactivé et expliqué", async () => {
    const view = await loadCockpitView(
      deps({ activeId: "p3", projects: [entry("p3", "dehors", outsideRoot)] }, shareRoot),
    );
    expect(view.containers[0]).toMatchObject({
      compatible: false,
      canLink: false,
      linkTitle: "Ce conteneur ne voit pas le dossier du projet.",
      projects: [],
    });
  });

  it("sans projet actif : incompatible, Lier désactivé, projets tout de même listés", async () => {
    const view = await loadCockpitView(
      deps({ activeId: null, projects: [entry("p1", "un", join(shareRoot, "proj"))] }, shareRoot),
    );
    expect(view.containers[0]).toMatchObject({
      compatible: false,
      canLink: false,
      linkTitle: "Aucun projet actif.",
      projects: [{ id: "p1", name: "un", active: false }],
    });
  });

  it("un lien symbolique sortant du partage ne compte pas comme dans le partage", async () => {
    const view = await loadCockpitView(
      deps({ activeId: "p4", projects: [entry("p4", "lien", linkToOutside)] }, shareRoot),
    );
    // Le lien est résolu vers sa cible réelle, hors du partage.
    expect(view.containers[0]).toMatchObject({ compatible: false, canLink: false, projects: [] });
  });

  it("un lien symbolique vers l'intérieur du partage reste compatible (chemins réels)", async () => {
    const view = await loadCockpitView(
      deps({ activeId: "p5", projects: [entry("p5", "lien", linkToInside)] }, shareRoot),
    );
    expect(view.containers[0]).toMatchObject({ compatible: true, canLink: true });
  });

  it("sans montage ou arrêté : aucun projet, jamais lié", async () => {
    const registry = { activeId: "p1", projects: [entry("p1", "un", join(shareRoot, "proj"))] };
    const noMount = await loadCockpitView(deps(registry, undefined));
    expect(noMount.containers[0]).toMatchObject({ compatible: false, projects: [] });
    expect(noMount.containers[0]?.linkTitle).toBe("Sans montage /workspace");
    const stopped = await loadCockpitView(deps(registry, shareRoot, "stopped"));
    expect(stopped.containers[0]).toMatchObject({ compatible: true, canLink: false });
    expect(stopped.containers[0]?.linkTitle).toBe("Conteneur arrêté");
  });
});

describe("linkedProjectStatus", () => {
  const row = {
    state: "running" as const,
    name: "a",
    image: "i:1",
    workspace: "/host/autre",
    family: "exegol" as const,
  };

  it("null sans projet actif ou si le fichier est invalide", async () => {
    expect(await linkedProjectStatus({ readProj: async () => null })).toBeNull();
    expect(
      await linkedProjectStatus({
        readProj: async () => projectFile(["a"], "/host/ws", false),
      }),
    ).toBeNull();
    expect(
      await linkedProjectStatus({
        readProj: async () => {
          throw new CodedError("project.invalid", { reason: "json" });
        },
      }),
    ).toBeNull();
  });

  it("un seul nom décrit la ligne ; zéro ou plusieurs n'en choisissent pas", async () => {
    const one = await linkedProjectStatus({
      readProj: async () => projectFile(["a"], "/host/ws"),
      createDocker: () => ({ listLabelPrefix: async () => [row] }),
    });
    expect(one).toEqual({
      workspace: "/host/ws",
      container: "a",
      image: "i:1",
      state: "running",
    });
    const gone = await linkedProjectStatus({
      readProj: async () => projectFile(["absent"]),
      createDocker: () => ({ listLabelPrefix: async () => [] }),
    });
    expect(gone).toEqual({
      workspace: "/host/ws",
      container: "absent",
      image: null,
      state: "absent",
    });
    let called = false;
    const many = await linkedProjectStatus({
      readProj: async () => projectFile(["a", "b"], "/proj"),
      createDocker: () => ({
        listLabelPrefix: async () => {
          called = true;
          return [];
        },
      }),
    });
    expect(many).toEqual({ workspace: "/proj", container: null, image: null, state: null });
    expect(called).toBe(false);
  });

  it("primary choisit le conteneur affiché sur un projet à plusieurs conteneurs", async () => {
    const other = { ...row, name: "b", image: "i:2", state: "stopped" as const };
    const chosen = await linkedProjectStatus({
      readProj: async () => projectFile(["a", "b"], "/proj", true, "b"),
      createDocker: () => ({ listLabelPrefix: async () => [row, other] }),
    });
    expect(chosen).toEqual({
      workspace: "/proj",
      container: "b",
      image: "i:2",
      state: "stopped",
    });
  });
});

describe("setPrimary", () => {
  it("lit le projet actif puis délègue à setPrimaryContainer avant de recharger la vue", async () => {
    const calls: [string, string, string | null][] = [];
    const view = await setPrimary("b", {
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => projectFile(["a", "b"], "/host/ws", true, "a"),
      createDocker: () => ({ listLabelPrefix: async () => [] }),
      setPrimaryContainerFn: async (configDir, projectId, name) => {
        calls.push([configDir, projectId, name]);
      },
    });
    expect(calls).toEqual([[expect.any(String), "p1", "b"]]);
    expect(view.type).toBe("view");
  });

  it("aucun projet actif : project.absent, pas d'appel", async () => {
    const calls: unknown[] = [];
    await expect(
      setPrimary("b", {
        readProj: async () => projectFile(["a", "b"], "/host/ws", false),
        setPrimaryContainerFn: async () => {
          calls.push(1);
        },
      }),
    ).rejects.toMatchObject({ code: "project.absent" });
    expect(calls).toEqual([]);
  });
});

describe("linkedTerminalChoices", () => {
  const row = (
    name: string,
    linked: boolean,
    state: "running" | "stopped",
    primary = false,
  ): CockpitContainerView => ({
    name,
    short: name,
    image: "i",
    state,
    family: "exegol",
    linked,
    primary,
    canLink: false,
    projects: [],
    compatible: false,
  });

  it("exclut les lignes non liées ou arrêtées", () => {
    expect(
      linkedTerminalChoices([
        row("a", false, "running"),
        row("b", true, "stopped"),
        row("c", false, "stopped"),
      ]),
    ).toEqual([]);
  });

  it("un seul conteneur lié et en cours : une entrée", () => {
    expect(linkedTerminalChoices([row("a", false, "running"), row("b", true, "running")])).toEqual([
      { name: "b", short: "b", primary: false },
    ]);
  });

  it("le primary passe en tête", () => {
    expect(
      linkedTerminalChoices([
        row("a", true, "running"),
        row("b", true, "running", true),
        row("c", true, "running"),
      ]),
    ).toEqual([
      { name: "b", short: "b", primary: true },
      { name: "a", short: "a", primary: false },
      { name: "c", short: "c", primary: false },
    ]);
  });

  it("sans primary : l'ordre de sortContainers (déjà appliqué) est conservé", () => {
    expect(linkedTerminalChoices([row("a", true, "running"), row("c", true, "running")])).toEqual([
      { name: "a", short: "a", primary: false },
      { name: "c", short: "c", primary: false },
    ]);
  });

  it("aucun conteneur lié en cours : liste vide", () => {
    expect(linkedTerminalChoices([row("a", true, "stopped")])).toEqual([]);
  });
});

describe("controlListedContainer", () => {
  const row = {
    state: "stopped" as const,
    name: "exegol-htb1",
    image: "i",
    family: "exegol" as const,
  };

  it("démarre le nom réel de la liste, pas un préfixe collé", async () => {
    const calls: string[] = [];
    await controlListedContainer("start", "htb1", {
      createDocker: () => ({
        listLabelPrefix: async () => [row],
        start: async (name) => void calls.push(name),
        stop: async () => {
          throw new Error("stop");
        },
      }),
    });
    expect(calls).toEqual(["exegol-htb1"]);
  });

  it("démarre un Kali arrêté par le nom de la liste", async () => {
    const calls: string[] = [];
    await controlListedContainer("start", "kali-box", {
      createDocker: () => ({
        listLabelPrefix: async () => [
          {
            state: "stopped" as const,
            name: "kali-box",
            image: "kalilinux/kali-rolling",
            family: "kali" as const,
          },
        ],
        start: async (name) => void calls.push(name),
        stop: async () => {
          throw new Error("stop");
        },
      }),
    });
    expect(calls).toEqual(["kali-box"]);
  });

  it("refuse un nom absent et n'appelle pas docker", async () => {
    await expect(
      controlListedContainer("start", "htb1", {
        createDocker: () => ({
          listLabelPrefix: async () => [],
          start: async () => {
            throw new Error("start");
          },
          stop: async () => {
            throw new Error("stop");
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "exegol.containerDenied" });
  });

  it("n'arrête pas un conteneur déjà arrêté", async () => {
    let stopped = false;
    await controlListedContainer("stop", "exegol-htb1", {
      createDocker: () => ({
        listLabelPrefix: async () => [row],
        start: async () => {
          throw new Error("start");
        },
        stop: async () => {
          stopped = true;
        },
      }),
    });
    expect(stopped).toBe(false);
  });
});

describe("containerMentions", () => {
  it("publie le nom court et omet un court ambigu", () => {
    expect(
      containerMentions([
        { name: "exegol-htb1", state: "running" },
        { name: "exegol-lab", state: "stopped" },
        { name: "htb1", state: "stopped" },
      ]),
    ).toEqual([{ name: "lab", state: "stopped" }]);
  });
});

describe("sortContainers", () => {
  it("en cours puis arrêté, puis nom", () => {
    const sorted = sortContainers([
      { state: "stopped", name: "z", image: "i", family: "exegol" },
      { state: "running", name: "b", image: "i", family: "kali" },
      { state: "running", name: "a", image: "i", family: "exegol" },
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["a", "b", "z"]);
  });
});

describe("cockpitHtml : CSP", () => {
  const html = cockpitHtml(htmlOpts);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

  it("politique identique au chat, icônes et application sous nonce", () => {
    expect(csp).toBe(
      "default-src 'none'; script-src 'nonce-abc123_-XYZ'; style-src https://x.vscode-cdn.net; img-src https://x.vscode-cdn.net; font-src https://x.vscode-cdn.net",
    );
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(3);
    expect(scripts[0]?.[1]).toContain("media/i18n.js");
    expect(scripts[1]?.[1]).toContain("media/icons.js");
    for (const script of scripts) expect(script[1]).toContain('nonce="abc123_-XYZ"');
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
  });

  it("nonce aléatoire", () => {
    expect(makeNonce()).not.toBe(makeNonce());
  });

  it("chatHtml charge icônes et araignée avant le chat", () => {
    const chat = chatHtml({
      ...htmlOpts,
      uiUri: "https://x.vscode-cdn.net/media/ui.js",
      scriptUri: "https://x.vscode-cdn.net/media/chat.js",
    });
    expect([...chat.matchAll(/<script/g)]).toHaveLength(5);
    expect(chat.indexOf("media/icons.js")).toBeLessThan(chat.indexOf("media/ui.js"));
  });
});

describe("cockpit.js", () => {
  const js = read("../media/cockpit.js");
  it("liste noire DOM / horloge", () => {
    for (const bad of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "eval(",
      "new Function",
      "requestAnimationFrame",
      "setInterval",
    ]) {
      expect(js, bad).not.toContain(bad);
    }
    expect(js).toContain("textContent");
    expect(js).toContain("row.family");
    expect(js).toContain('type: "start"');
    expect(js).toContain('type: "stop"');
    expect(js).toContain('type: "createExegol"');
    expect(js).toContain('type: "createKali"');
    expect(js).toContain('type: "listImages"');
    expect(js).toContain('type: "openWorkspace"');
    expect(js).toContain('type: "pickSharedFolder"');
    expect(js).not.toContain("msg.projectWorkspace");
    expect(js).not.toContain('type: "create"');
    expect(js).toContain("Aucun conteneur pour l’instant");
    expect(js).toContain("row.short");
  });

  it("bouton Principal : message setPrimary, jamais mémorisé côté webview", () => {
    expect(js).toContain('type: "setPrimary"');
    expect(js).toContain("row.primary");
    expect(js).toContain("Principal");
    expect(js).not.toContain("globalState");
  });
});

describe("extension.ts : choix du terminal", () => {
  it("n'appelle jamais setPrimaryContainer (import absent du fichier)", () => {
    const src = read("../src/extension/extension.ts");
    expect(src).not.toContain("setPrimaryContainer");
  });
});

describe("imageRefs", () => {
  it("prend repository:tag, sinon l'id, dédoublonne et trie", () => {
    expect(
      imageRefs([
        { id: "bbb", repository: "<none>", tag: "latest" },
        { id: "aaa", repository: "kali", tag: "<none>" },
        { id: "ccc", repository: "kalilinux/kali-rolling", tag: "latest" },
        { id: "ddd", repository: "kalilinux/kali-rolling", tag: "latest" },
        { id: "eee", repository: "alpine", tag: "3" },
      ]),
    ).toEqual(["aaa", "alpine:3", "bbb", "kalilinux/kali-rolling:latest"]);
  });

  it("passe par images() du client injecté", async () => {
    const refs = await listCockpitImages({
      createDocker: () => ({
        images: async () => [{ id: "id1", repository: "kali", tag: "latest", size: "1" }],
      }),
    });
    expect(refs).toEqual([
      "warband/kali:complete-1",
      "kalilinux/kali-rolling:latest",
      "kali:latest",
    ]);
  });
});

it("création Exegol : options fermées, aucun chemin VPN provenant de la webview", () => {
  const options = {
    type: "createExegol",
    name: "lab",
    shareMode: "project",
    image: "free",
    vpn: true,
    desktop: true,
    desktopPort: 6080,
    network: "nat",
    shareResources: true,
    shareMyResources: false,
  };
  expect(parseCockpitMessage(options)).toEqual(options);
  for (const extra of [
    { vpnPath: "/secret" },
    { desktopPort: 0 },
    { desktopPort: 65536 },
    { desktopPort: 1.5 },
    { vpn: "true" },
    { network: "--privileged" },
    { image: "--force" },
    { image: "a;b" },
    { shareResources: 1 },
  ])
    expect(parseCockpitMessage({ ...options, ...extra })).toBeNull();
  expect(parseCockpitMessage({ type: "pickVpn" })).toEqual({ type: "pickVpn" });
  expect(parseCockpitMessage({ type: "pickVpn", path: "/etc" })).toBeNull();
  expect(parseCockpitMessage({ type: "cancelOperation" })).toEqual({ type: "cancelOperation" });
  expect(parseCockpitMessage({ type: "remove", name: "exegol-lab" })).toEqual({
    type: "remove",
    name: "exegol-lab",
  });
  expect(parseCockpitMessage({ type: "remove", name: "exegol-lab", force: true })).toBeNull();
});

describe("moveActiveProject", () => {
  // Chemins réels : le contrôle de partage passe par `realpath`.
  const base = mkdtempSync(join(tmpdir(), "wb-move-"));
  mkdirSync(join(base, "a", "mission"), { recursive: true });
  mkdirSync(join(base, "b", "mission"), { recursive: true });
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const project = {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    name: "mission",
    workspace: join(base, "a", "mission"),
    containers: ["kali-voit", "kali-perdu", "kali-absent"],
  };
  const file = { activeId: project.id, projects: [project] };
  const harness = (over: Record<string, unknown> = {}) => {
    const calls: string[] = [];
    const deps = {
      configDir: "/cfg",
      readProj: async () => file,
      confirm: async () => {
        calls.push("confirm");
        return true;
      },
      pickParent: async () => {
        calls.push("pick");
        return "/srv/b";
      },
      move: async (_dir: string, id: string, parent: unknown) => {
        calls.push(`move:${id}:${String(parent)}`);
        return { ...project, workspace: join(base, "b", "mission") };
      },
      dissociate: async (_dir: string, _id: string, name: string) => {
        calls.push(`dissociate:${name}`);
      },
      listContainers: async () => [
        { name: "kali-voit", workspace: join(base, "b") },
        { name: "kali-perdu", workspace: join(base, "a") },
      ],
      ...over,
    };
    return { calls, deps: deps as unknown as Parameters<typeof moveActiveProject>[0] };
  };

  it("pas de déplacement sans confirmation, ni sélecteur", async () => {
    const h = harness({ confirm: async () => false });
    expect(await moveActiveProject(h.deps)).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("l'annulation du sélecteur ne déplace rien", async () => {
    const h = harness({ pickParent: async () => undefined });
    expect(await moveActiveProject(h.deps)).toBeNull();
    expect(h.calls).toEqual(["confirm"]);
  });

  it("déplace après confirmation puis délie les conteneurs qui ne voient plus le projet", async () => {
    const h = harness();
    expect(await moveActiveProject(h.deps)).toEqual({ workspace: join(base, "b", "mission") });
    expect(h.calls).toEqual([
      "confirm",
      "pick",
      `move:${project.id}:/srv/b`,
      "dissociate:kali-perdu",
    ]);
  });

  it("sans projet actif : project.absent, sans confirmation", async () => {
    const h = harness({ readProj: async () => ({ activeId: null, projects: [] }) });
    await expect(moveActiveProject(h.deps)).rejects.toMatchObject({ code: "project.absent" });
    expect(h.calls).toEqual([]);
  });

  it("Docker muet : le déplacement reste valide et les liaisons sont conservées", async () => {
    const h = harness({
      listContainers: async () => {
        throw new Error("docker");
      },
    });
    expect(await moveActiveProject(h.deps)).toEqual({ workspace: join(base, "b", "mission") });
    expect(h.calls.some((c) => c.startsWith("dissociate"))).toBe(false);
  });
});
