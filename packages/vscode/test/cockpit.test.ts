import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CodedError, ValidationError } from "@warband/core";
import { formatError } from "@warband/messages";
import { describe, expect, it } from "vitest";
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
      title: "Venator Ops : exegol-htb1",
    });
  });

  it("deuxième shell : suffixe (2)", () => {
    expect(planEditorShell("htb1", containers, ["Warband : exegol-htb1"])).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "Venator Ops : exegol-htb1 (2)",
    });
  });

  it("trou d'indice : réutilise le plus petit libre", () => {
    expect(
      planEditorShell("htb1", containers, ["Warband : exegol-htb1", "Warband : exegol-htb1 (3)"]),
    ).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "Venator Ops : exegol-htb1 (2)",
    });
  });

  it("nom avec point : titre exact uniquement", () => {
    const dotted = [{ name: "my.box", state: "running" as const }];
    expect(planEditorShell("my.box", dotted, ["Warband : my.box"])).toEqual({
      action: "launch",
      name: "my.box",
      title: "Venator Ops : my.box (2)",
    });
    expect(planEditorShell("my.box", dotted, ["Warband : my.box (2)"])).toEqual({
      action: "launch",
      name: "my.box",
      title: "Venator Ops : my.box",
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
    const open = ["Warband : exegol-htb1", "Venator Ops : exegol-htb1 (3)"];
    expect(planEditorShell("htb1", containers, open)).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "Venator Ops : exegol-htb1 (2)",
    });
    expect(
      planEditorShell("htb1", containers, [
        ...open,
        "Venator Ops : exegol-htb1 (2)",
        "Warband : exegol-htb1 (4)",
      ]),
    ).toEqual({ action: "reveal", title: "Warband : exegol-htb1 (4)" });
  });

  it("un titre à indice identique compte chaque terminal physique vers la limite", () => {
    expect(
      planEditorShell("htb1", containers, [
        "Warband : exegol-htb1",
        "Venator Ops : exegol-htb1",
        "Warband : exegol-htb1 (2)",
        "Venator Ops : exegol-htb1 (2)",
      ]),
    ).toEqual({ action: "reveal", title: "Venator Ops : exegol-htb1 (2)" });
  });

  it("ignore les faux préfixes et les titres d'un autre conteneur", () => {
    expect(
      planEditorShell("htb1", containers, [
        "Warband bis : exegol-htb1",
        "Venator Ops bis : exegol-htb1 (2)",
        "Venator Ops : exegol-htb1-autre (3)",
        "Autre Venator Ops : exegol-htb1 (4)",
        "Venator Ops : exegol-htb1 (5)",
      ]),
    ).toEqual({ action: "launch", name: "exegol-htb1", title: "Venator Ops : exegol-htb1" });
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
    expect(parseCockpitMessage({ type: "pickSource" })).toEqual({ type: "pickSource" });
    expect(parseCockpitMessage({ type: "createExegol", name: "htb1" })).toEqual({
      type: "createExegol",
      name: "htb1",
    });
  });

  it("le message Kali parsé égale image, name et source", () => {
    const image = "kalilinux/kali-rolling:latest";
    const name = "lab";
    const source = "/home/me/lab";
    expect(parseCockpitMessage({ type: "createKali", image, name, source })).toEqual({
      type: "createKali",
      image,
      name,
      source,
    });
  });

  it("refuse clés en trop, types chat et formes invalides", () => {
    expect(parseCockpitMessage({ type: "refresh", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "send", text: "x" })).toBeNull();
    expect(parseCockpitMessage({ type: "ready" })).toBeNull();
    expect(parseCockpitMessage({ type: "link", name: "" })).toBeNull();
    expect(parseCockpitMessage({ type: "start", name: "a", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "stop" })).toBeNull();
    expect(parseCockpitMessage({ type: "create" })).toBeNull();
    expect(parseCockpitMessage({ type: "create", name: "htb1" })).toBeNull();
    expect(parseCockpitMessage({ type: "listImages", extra: true })).toBeNull();
    expect(parseCockpitMessage({ type: "pickSource", source: "/tmp" })).toBeNull();
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
    expect(
      parseCockpitMessage({ type: "createExegol", name: "htb1", image: "kali:latest" }),
    ).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "htb1", source: "/tmp" })).toEqual({
      type: "createExegol",
      name: "htb1",
      source: "/tmp",
    });
    expect(parseCockpitMessage({ type: "createExegol" })).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "" })).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "-bad" })).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "a".repeat(65) })).toBeNull();
    expect(parseCockpitMessage({ type: "createExegol", name: "a".repeat(64) })).toEqual({
      type: "createExegol",
      name: "a".repeat(64),
    });
  });

  it("refuse un Kali incomplet, une image hors motif ou une source illisible", () => {
    const ok = { type: "createKali", image: "kali:latest", name: "lab", source: "/tmp/lab" };
    expect(parseCockpitMessage({ ...ok, extra: 1 })).toBeNull();
    expect(
      parseCockpitMessage({ type: "createKali", image: "kali:latest", name: "lab" }),
    ).toBeNull();
    expect(parseCockpitMessage({ ...ok, image: "" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, name: "" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, source: "" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, image: "-kali" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, image: "a".repeat(257) })).toBeNull();
    expect(parseCockpitMessage({ ...ok, image: "a".repeat(256) })).toEqual({
      ...ok,
      image: "a".repeat(256),
    });
    expect(parseCockpitMessage({ ...ok, source: "a\nb" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, source: "a\0b" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, source: "a\rb" })).toBeNull();
    expect(parseCockpitMessage({ ...ok, source: "a".repeat(4096) })).toEqual({
      ...ok,
      source: "a".repeat(4096),
    });
    expect(parseCockpitMessage({ ...ok, source: "a".repeat(4097) })).toBeNull();
  });
});

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

  it("kali : lien seulement s'il tourne et a un workspace", async () => {
    const view = await loadCockpitView({
      resolveBin: (n) => (n === "docker" ? "/d/docker" : null),
      readProj: async () => null,
      createDocker: () => ({
        listLabelPrefix: async () => [
          {
            state: "running" as const,
            name: "kali-up",
            image: "kalilinux/kali-rolling",
            workspace: "/host/kali",
            family: "kali" as const,
          },
          {
            state: "stopped" as const,
            name: "kali-off",
            image: "kalilinux/kali-rolling",
            workspace: "/host/kali",
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
      createDocker: () => ({ listLabelPrefix: async () => rows }),
    };
    const none = await loadCockpitView({ ...deps, readProj: async () => projectFile([]) });
    expect(none.linkedBanner).toBeNull();
    expect(none.linked).toBe("none");
    expect(none.containers.find((c) => c.name === "a")?.canLink).toBe(true);
    const many = await loadCockpitView({
      ...deps,
      readProj: async () => projectFile(["a", "c"]),
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
    expect(scripts).toHaveLength(2);
    expect(scripts[0]?.[1]).toContain("media/icons.js");
    for (const script of scripts) expect(script[1]).toContain('nonce="abc123_-XYZ"');
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
  });

  it("nonce aléatoire", () => {
    expect(makeNonce()).not.toBe(makeNonce());
  });

  it("chatHtml charge les icônes avant ses deux scripts", () => {
    const chat = chatHtml({
      ...htmlOpts,
      uiUri: "https://x.vscode-cdn.net/media/ui.js",
      scriptUri: "https://x.vscode-cdn.net/media/chat.js",
    });
    expect([...chat.matchAll(/<script/g)]).toHaveLength(3);
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
    expect(js).toContain('type: "pickSource"');
    expect(js).not.toContain('type: "create"');
    expect(js).toContain("Aucun conteneur.");
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
    image: "free",
    source: "/workspace/lab",
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
