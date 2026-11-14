/**
 * Opérations longues du cockpit web : toute page « occupée » reçoit TOUJOURS une réponse `operation`
 * (début réel, ou erreur immédiate), jamais un silence qui la laisserait figée sur « Préparation… ».
 */
import { readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExegol, type ExegolPort, invalidField, OutputTail } from "../src/bridge/cockpit.js";
import type { ViewBackends } from "../src/bridge/views.js";
import {
  emptyBackends,
  type FakeSocket,
  type Msg,
  nthDialog,
  replyDialog,
  setup,
  shellOf,
  useStorage,
} from "./bridge-helpers.js";
import { fakeDocker } from "./docker-fake.js";

const ctx = useStorage();

async function cockpitOf(t: ReturnType<typeof setup>) {
  const s = shellOf(t);
  s.say("cockpit", "ck", { type: "ready" });
  await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
  return s;
}

const operations = (s: FakeSocket) => s.of("cockpit", "operation").map((e) => e.msg);
const lastOperation = (s: FakeSocket): Msg | undefined => operations(s).at(-1);

function backend(over: Partial<ViewBackends["cockpit"]> = {}): ViewBackends {
  return emptyBackends({
    cockpit: {
      ...emptyBackends().cockpit,
      load: async () => ({ type: "view", containers: [] }) as never,
      ...over,
    },
  });
}

describe("cockpit : une réponse `operation` pour tout geste", () => {
  let docker: Awaited<ReturnType<typeof fakeDocker>>;
  beforeEach(async () => {
    docker = await fakeDocker([]);
  });
  afterEach(async () => {
    ctx.hub?.dispose();
    await ctx.hub?.settled();
    await docker.close();
  });

  /** Exegol factice dont la CLI ne s'arrête que sur signal (comme une invite qui bloque). */
  const blocking = (over: Partial<ExegolPort> = {}) => {
    const state = {
      aborted: false,
      runs: 0,
      onOutput: undefined as ((c: Buffer) => void) | undefined,
    };
    const port: ExegolPort = {
      installed: () => true,
      eulaAccepted: async () => true,
      acceptEula: async () => 0,
      prepare: async (o) => ({ shellPath: "/usr/bin/exegol", shellArgs: ["start", o.name] }),
      run: (_path, _argv, signal, onOutput) =>
        new Promise((done) => {
          state.runs++;
          state.onOutput = onOutput;
          signal.addEventListener(
            "abort",
            () => {
              state.aborted = true;
              done(null);
            },
            { once: true },
          );
        }),
      pollMs: 10,
      ...over,
    };
    return { port, state };
  };

  it("geste pendant une opération : réponse immédiate cockpit.busy, l'opération en cours n'est pas touchée", async () => {
    const e = blocking();
    const lines: string[] = [];
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      backends: backend(),
      serverLog: (l) => void lines.push(l),
    });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(e.state.runs).toBe(1));

    for (const gesture of [
      { type: "createKali", image: "kali", name: "autre" },
      { type: "createExegol", name: "autre" },
      { type: "start", name: "exegol-web" },
      { type: "stop", name: "exegol-web" },
      { type: "remove", name: "exegol-web" },
    ]) {
      const before = operations(s).length;
      s.say("cockpit", "ck", gesture);
      await vi.waitFor(() => expect(operations(s).length).toBeGreaterThan(before));
      expect(lastOperation(s)).toMatchObject({
        busy: false,
        code: "cockpit.busy",
        error: expect.stringMatching(
          /^Une opération est déjà en cours : .+ \(depuis \d+ min\)\. Attendez ou annulez-la\.$/,
        ),
      });
    }
    // L'opération d'origine continue : CLI non arrêtée, aucune nouvelle CLI, aucune annulation.
    expect(e.state.aborted).toBe(false);
    expect(e.state.runs).toBe(1);
    expect(lines.join("\n")).not.toContain("annulée");
    s.say("cockpit", "ck", { type: "cancelOperation" });
    await vi.waitFor(() => expect(e.state.aborted).toBe(true));
  });

  it("message invalide : operation {busy:false, error, code, field} ; type inconnu : ignoré", async () => {
    const t = setup(ctx, { docker: docker.api, backends: backend() });
    const s = await cockpitOf(t);
    const cases: [Record<string, unknown>, string][] = [
      [{ type: "createExegol", name: "web", desktopPort: 70000 }, "desktopPort"],
      [{ type: "createExegol", name: "mauvais nom" }, "name"],
      [{ type: "createExegol", name: "web", inconnu: true }, "inconnu"],
      [{ type: "createKali", name: "web" }, "image"],
      [{ type: "start", name: "" }, "name"],
    ];
    for (const [message, field] of cases) {
      const before = operations(s).length;
      s.say("cockpit", "ck", message);
      await vi.waitFor(() => expect(operations(s).length).toBeGreaterThan(before));
      expect(lastOperation(s)).toMatchObject({
        busy: false,
        stage: "",
        code: "cockpit.invalidMessage",
        field,
        error: expect.stringContaining(field),
      });
      expect(invalidField(message)).toBe(field);
    }
    const before = t.bridge.stats().ignored;
    s.say("cockpit", "ck", { type: "inconnu" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
  });

  it("page qui se reconnecte pendant une opération : état busy:true réel ; une fois finie : busy:false", async () => {
    const e = blocking();
    const t = setup(ctx, { docker: docker.api, exegol: e.port, backends: backend() });
    const s = await cockpitOf(t);
    // Rien en cours : `ready` répond busy:false et envoie le dossier partagé automatique.
    expect(lastOperation(s)).toMatchObject({ busy: false });
    expect(s.of("cockpit", "pickedSharedFolder")[0]?.msg).toMatchObject({
      path: expect.stringContaining("automatique"),
    });
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(e.state.runs).toBe(1));
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({
        busy: true,
        stage: expect.stringContaining("Exegol"),
      }),
    );

    const reloaded = t.connect();
    reloaded.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(reloaded.of("cockpit", "operation")).toHaveLength(1));
    expect(lastOperation(reloaded)).toMatchObject({
      busy: true,
      stage: expect.any(String),
      layers: [],
      startedAt: expect.any(Number),
    });
    reloaded.say("cockpit", "ck", { type: "refresh" });
    await vi.waitFor(() => expect(reloaded.of("cockpit", "operation")).toHaveLength(2));
    expect(lastOperation(reloaded)).toMatchObject({ busy: true });

    s.say("cockpit", "ck", { type: "cancelOperation" });
    await vi.waitFor(() => expect(lastOperation(reloaded)).toMatchObject({ busy: false }));
    reloaded.say("cockpit", "ck", { type: "refresh" });
    await vi.waitFor(() => expect(reloaded.of("cockpit", "operation").length).toBeGreaterThan(3));
    expect(lastOperation(reloaded)).toMatchObject({ busy: false });
  });

  it("cancelOperation : processus arrêté puis busy:false ; sans opération : busy:false immédiat", async () => {
    const e = blocking();
    const t = setup(ctx, { docker: docker.api, exegol: e.port, backends: backend() });
    const s = await cockpitOf(t);
    const before = operations(s).length;
    s.say("cockpit", "ck", { type: "cancelOperation" });
    await vi.waitFor(() => expect(operations(s).length).toBeGreaterThan(before));
    expect(lastOperation(s)).toMatchObject({ busy: false, stage: "" });
    expect(lastOperation(s)?.error).toBeUndefined();

    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(e.state.runs).toBe(1));
    s.say("cockpit", "ck", { type: "cancelOperation" });
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false, stage: "" }));
    expect(e.state.aborted).toBe(true);
    expect(lastOperation(s)?.error).toBeUndefined();
    // Dossier tout juste créé, vide et sans conteneur : retiré.
    expect(await readdir(ctx.storage.paths.containers)).toEqual([]);
    // Le cockpit est libre : un nouveau geste est accepté.
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(e.state.runs).toBe(2));
    s.say("cockpit", "ck", { type: "cancelOperation" });
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
  });

  it("CLI bloquée sur une invite : arrêt après le garde-fou, message avec la fin de sortie masquée et bornée", async () => {
    const e = blocking({ stallMs: 80 });
    const lines: string[] = [];
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      backends: backend(),
      serverLog: (l) => void lines.push(l),
    });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(e.state.onOutput).toBeDefined());
    const padding = "x".repeat(5000);
    e.state.onOutput?.(
      Buffer.from(
        `${padding}\n\u001b[1mActivate your subscription now? [Y/n]\u001b[0m\nuse token=sk-ant-api03-SECRETSECRETSECRET1234\n`,
      ),
    );
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({ busy: false, code: "exegol.stalled" }),
    );
    const error = String(lastOperation(s)?.error);
    expect(error).toContain("Exegol attend une réponse interactive");
    expect(error).toContain("[Y/n]");
    expect(error).not.toContain("SECRETSECRET");
    expect(error).not.toContain("\u001b");
    expect(error.length).toBeLessThan(2048 + 400);
    // La CLI est arrêtée par le signal du serveur.
    expect(e.state.aborted).toBe(true);
    expect(await readdir(ctx.storage.paths.containers)).toEqual([]);
    expect(lines.join("\n")).not.toContain("SECRETSECRET");
    expect(lines.some((l) => l.includes("erreur createExegol web (exegol.stalled"))).toBe(true);
  });

  it("une sortie régulière rafraîchit le garde-fou (téléchargement) : aucun arrêt", async () => {
    const e = blocking({ stallMs: 120 });
    const t = setup(ctx, { docker: docker.api, exegol: e.port, backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(e.state.onOutput).toBeDefined());
    for (let i = 0; i < 8; i++) {
      e.state.onOutput?.(Buffer.from(`Pulling layer ${i}\n`));
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(e.state.aborted).toBe(false);
    expect(lastOperation(s)).toMatchObject({ busy: true });
    s.say("cockpit", "ck", { type: "cancelOperation" });
    await vi.waitFor(() => expect(e.state.aborted).toBe(true));
  });

  it("contrat Exegol refusé : rien n'est lancé, busy:false + message ; jamais accepté à la place de l'humain", async () => {
    const accepted: string[] = [];
    const e = blocking({
      eulaAccepted: async () => false,
      acceptEula: async () => (accepted.push("accept"), 0),
    });
    const t = setup(ctx, { docker: docker.api, exegol: e.port, backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    // Lien du contrat (ouverture facultative), puis confirmation : refus des deux.
    replyDialog(s, await nthDialog(s, 1), false);
    const d = await nthDialog(s, 2);
    expect(d.kind).toBe("confirm");
    // Pendant l'attente de l'humain, la page voit une étape explicite.
    expect(lastOperation(s)).toMatchObject({
      busy: true,
      stage: expect.stringContaining("contrat"),
    });
    replyDialog(s, d, false);
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({ busy: false, code: "exegol.eulaRequired" }),
    );
    expect(String(lastOperation(s)?.error)).toContain("contrat");
    expect(accepted).toEqual([]);
    expect(e.state.runs).toBe(0);
    expect(await readdir(ctx.storage.paths.containers).catch(() => [])).toEqual([]);
  });

  it("start et stop : la page « occupée » reçoit busy:true puis busy:false (même sans erreur)", async () => {
    const calls: string[] = [];
    const t = setup(ctx, {
      docker: docker.api,
      backends: backend({ control: async (a, n) => void calls.push(`${a}:${n}`) }),
    });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "start", name: "exegol-web" });
    await vi.waitFor(() => expect(calls).toEqual(["start:exegol-web"]));
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false, stage: "" }));
    expect(operations(s).some((o) => o.busy === true)).toBe(true);
    expect(lastOperation(s)?.error).toBeUndefined();

    ctx.hub?.dispose();
    const failing = setup(ctx, {
      docker: docker.api,
      backends: backend({
        control: async () => {
          throw new Error("détail interne /var/lib/secret");
        },
      }),
    });
    const s2 = await cockpitOf(failing);
    s2.say("cockpit", "ck", { type: "stop", name: "exegol-web" });
    await vi.waitFor(() =>
      expect(lastOperation(s2)).toMatchObject({ busy: false, code: "view.failed" }),
    );
    expect(String(lastOperation(s2)?.error)).not.toContain("/var/lib");
  });

  it("journal serveur : début, fin et erreur par opération, sans secret ni chemin", async () => {
    const lines: string[] = [];
    const e = blocking({ run: async () => 1 });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      backends: backend(),
      serverLog: (l) => void lines.push(l),
    });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ code: "exegol.createFailed" }));
    expect(lines[0]).toBe("cockpit : début createExegol web");
    expect(lines[1]).toMatch(/^cockpit : erreur createExegol web \(exegol\.createFailed, \d+ s\)$/);
    expect(lines.join("\n")).not.toContain(ctx.dir);
  });

  it("createExegol : la CLI s'arrête avec un motif → sortie d'Exegol dans l'erreur et le journal", async () => {
    const lines: string[] = [];
    const e = blocking({
      run: async (_bin, _argv, _signal, onOutput) => {
        onOutput?.(Buffer.from("[!] Licence introuvable : lancez exegol activate\n"));
        return 1;
      },
    });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      backends: backend(),
      serverLog: (l) => void lines.push(l),
    });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ code: "exegol.createFailed" }));
    expect(String(lastOperation(s)?.error)).toContain("Licence introuvable");
    expect(String(lastOperation(s)?.error)).toContain("code 1");
    expect(lines[1]).toMatch(
      /^cockpit : erreur createExegol web \(exegol\.createFailed, \d+ s\) : .*Licence introuvable/,
    );
  });
});

describe("OutputTail", () => {
  it("retire ANSI et contrôles, masque les secrets, borne à 2 Kio", () => {
    const tail = new OutputTail();
    tail.push(
      Buffer.from(
        `${"a".repeat(4000)}\r\n\u001b[31mrouge\u001b[0m password=hunter2hunter2\u0007\n`,
      ),
    );
    const out = tail.shown();
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out).toContain("rouge");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
  });
});

describe.skipIf(process.platform === "win32")("CLI Exegol par défaut : entrée de refus", () => {
  it("une invite [Y/n] reçoit « n » (jamais une acceptation) et la sortie est transmise", async () => {
    const chunks: string[] = [];
    const code = await defaultExegol().run(
      "/bin/sh",
      ["-c", 'read a; if [ "$a" = n ]; then echo refus; else echo accepte; fi'],
      new AbortController().signal,
      (c) => void chunks.push(c.toString()),
    );
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("refus");
  });
});
