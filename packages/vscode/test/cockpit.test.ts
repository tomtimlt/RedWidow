import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CodedError, ValidationError } from "@warband/core";
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import {
  containerMentions,
  controlListedContainer,
  loadCockpitView,
  parseCockpitMessage,
  planEditorShell,
  sortContainers,
  terminalLaunch,
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
      title: "Warband : exegol-htb1",
    });
  });

  it("deuxième shell : suffixe (2)", () => {
    expect(planEditorShell("htb1", containers, ["Warband : exegol-htb1"])).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "Warband : exegol-htb1 (2)",
    });
  });

  it("trou d'indice : réutilise le plus petit libre", () => {
    expect(
      planEditorShell("htb1", containers, ["Warband : exegol-htb1", "Warband : exegol-htb1 (3)"]),
    ).toEqual({
      action: "launch",
      name: "exegol-htb1",
      title: "Warband : exegol-htb1 (2)",
    });
  });

  it("nom avec point : titre exact uniquement", () => {
    const dotted = [{ name: "my.box", state: "running" as const }];
    expect(planEditorShell("my.box", dotted, ["Warband : my.box"])).toEqual({
      action: "launch",
      name: "my.box",
      title: "Warband : my.box (2)",
    });
    expect(planEditorShell("my.box", dotted, ["Warband : my.box (2)"])).toEqual({
      action: "launch",
      name: "my.box",
      title: "Warband : my.box",
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

describe("parseCockpitMessage", () => {
  it("accepte les messages prévus", () => {
    expect(parseCockpitMessage({ type: "refresh" })).toEqual({ type: "refresh" });
    expect(parseCockpitMessage({ type: "link", name: "c1" })).toEqual({ type: "link", name: "c1" });
    expect(parseCockpitMessage({ type: "openWorkspace" })).toEqual({ type: "openWorkspace" });
    expect(parseCockpitMessage({ type: "terminal" })).toEqual({ type: "terminal" });
    expect(parseCockpitMessage({ type: "start", name: "exegol-htb1" })).toEqual({
      type: "start",
      name: "exegol-htb1",
    });
    expect(parseCockpitMessage({ type: "stop", name: "exegol-htb1" })).toEqual({
      type: "stop",
      name: "exegol-htb1",
    });
    expect(parseCockpitMessage({ type: "create" })).toEqual({ type: "create" });
  });

  it("refuse clés en trop, types chat et formes invalides", () => {
    expect(parseCockpitMessage({ type: "refresh", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "send", text: "x" })).toBeNull();
    expect(parseCockpitMessage({ type: "ready" })).toBeNull();
    expect(parseCockpitMessage({ type: "link", name: "" })).toBeNull();
    expect(parseCockpitMessage({ type: "start", name: "a", extra: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "stop" })).toBeNull();
    expect(parseCockpitMessage({ type: "create", name: "htb1" })).toBeNull();
    expect(parseWebviewMessage({ type: "start", name: "a" })).toBeNull();
    expect(parseWebviewMessage({ type: "create" })).toBeNull();
    expect(parseWebviewMessage({ type: "refresh" })).toBeNull();
    expect(parseWebviewMessage({ type: "link", name: "c" })).toBeNull();
  });
});

describe("loadCockpitView", () => {
  const rows = [
    { state: "stopped" as const, name: "b", image: "i:2" },
    { state: "running" as const, name: "a", image: "i:1", workspace: "/host/ws" },
    { state: "running" as const, name: "c", image: "i:3" },
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
      readProj: async () => ({ container: "a", workspace: "/host/ws" }),
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
    const noWs = view.containers.find((c) => c.name === "c");
    expect(noWs?.linkTitle).toBe("Sans montage /workspace");
    const linked = view.containers.find((c) => c.name === "a");
    expect(linked?.linked).toBe(true);
    expect(linked?.canLink).toBe(false);
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
});

describe("controlListedContainer", () => {
  const row = { state: "stopped" as const, name: "exegol-htb1", image: "i" };

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
      { state: "stopped", name: "z", image: "i" },
      { state: "running", name: "b", image: "i" },
      { state: "running", name: "a", image: "i" },
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["a", "b", "z"]);
  });
});

describe("cockpitHtml : CSP", () => {
  const html = cockpitHtml(htmlOpts);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

  it("politique identique au chat (un script)", () => {
    expect(csp).toBe(
      "default-src 'none'; script-src 'nonce-abc123_-XYZ'; style-src https://x.vscode-cdn.net; img-src https://x.vscode-cdn.net",
    );
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[1]).toContain('nonce="abc123_-XYZ"');
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
  });

  it("nonce aléatoire", () => {
    expect(makeNonce()).not.toBe(makeNonce());
  });

  it("chatHtml inchangé (deux scripts)", () => {
    const chat = chatHtml({
      ...htmlOpts,
      uiUri: "https://x.vscode-cdn.net/media/ui.js",
      scriptUri: "https://x.vscode-cdn.net/media/chat.js",
    });
    expect([...chat.matchAll(/<script/g)]).toHaveLength(2);
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
    expect(js).toContain('type: "start"');
    expect(js).toContain('type: "stop"');
    expect(js).toContain('type: "create"');
    expect(js).toContain("row.short");
  });
});
