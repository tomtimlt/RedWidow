import type { EngineEvent, ModelOption } from "@warband/core";
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import type { ChatView } from "../src/logic/chat.js";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "../src/logic/controller.js";
import type { StartParams } from "../src/logic/protocol.js";
import { createChatSession } from "../src/logic/session.js";

const ev = (e: Record<string, unknown>) => e as unknown as EngineEvent;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Moteur factice qui note le jeton reçu à chaque démarrage : le test joue le moteur. */
function harness(opts: { requireProvider: boolean }) {
  let token: string | undefined;
  let view!: ChatView;
  const starts: { params: StartParams; auth: string | undefined; id: number }[] = [];
  const prompts: string[] = [];
  const disposed: number[] = [];
  let handlers: EngineHandlers = {};
  let launched = 0;
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e.mjs",
    engineArgs: [],
    readSettings: () => ({}),
    getToken: async () =>
      token === undefined
        ? undefined
        : { auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: token }, mode: "subscription" },
    confirmAlways: async () => false,
    onView: (v) => {
      view = v;
    },
    requireProvider: opts.requireProvider,
    sdkVersion: "1.0.0",
    createController: (o: EngineControllerOptions): EngineController => {
      // La sonde des modèles prend aussi un numéro : seuls les moteurs qui reçoivent `start()` comptent.
      const id = ++launched;
      const auth = o.auth?.value;
      return {
        start: async (params) => {
          handlers = o.handlers ?? {};
          starts.push({ params, auth, id });
        },
        models: async () => [] as ModelOption[],
        prompt: (text) => void prompts.push(`${id}:${text}`),
        answer: () => undefined,
        abort: () => undefined,
        dispose: () => void disposed.push(id),
        kill: () => void disposed.push(id),
        bypass: () => 1,
        exited: Promise.resolve(),
      };
    },
  });
  return {
    session,
    starts,
    prompts,
    disposed,
    view: () => view,
    setToken: (value: string | undefined) => {
      token = value;
    },
    endTurn: () => handlers.onEnded?.({ sessionId: "S1" } as never),
    sessionStarted: () => handlers.onEvent?.(ev({ kind: "session.started", sessionId: "S1" })),
  };
}

describe("chat sans fournisseur", () => {
  it("sans jeton : la vue est grisée et aucun moteur ne démarre", async () => {
    const h = harness({ requireProvider: true });
    await flush();
    expect(h.view().noProvider).toBe(true);
    await h.session.send("bonjour");
    expect(h.starts).toHaveLength(0);
    expect(h.prompts).toHaveLength(0);
    // Aucune bulle utilisateur : seulement l'avis d'erreur.
    expect(h.view().items.some((i) => i.kind === "user")).toBe(false);
    expect(h.view().items.at(-1)).toMatchObject({ kind: "notice" });
  });

  it("avec un jeton déjà présent : le chat n'est pas grisé", async () => {
    const h = harness({ requireProvider: true });
    h.setToken("A");
    await h.session.authChanged();
    expect(h.view().noProvider).toBe(false);
  });

  it("jeton ajouté : authChanged dégrise le chat et le message suivant démarre avec le jeton", async () => {
    const h = harness({ requireProvider: true });
    await flush();
    expect(h.view().noProvider).toBe(true);
    h.setToken("sk-nouveau");
    await h.session.authChanged();
    expect(h.view().noProvider).toBe(false);
    await h.session.send("bonjour");
    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]?.auth).toBe("sk-nouveau");
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toMatch(/:bonjour$/);
  });

  it("jeton effacé : le chat se grise de nouveau", async () => {
    const h = harness({ requireProvider: true });
    h.setToken("A");
    await h.session.authChanged();
    expect(h.view().noProvider).toBe(false);
    h.setToken(undefined);
    await h.session.authChanged();
    expect(h.view().noProvider).toBe(true);
  });

  it("sans requireProvider : comportement historique, jamais grisé", async () => {
    const h = harness({ requireProvider: false });
    await flush();
    expect(h.view()?.noProvider ?? false).toBe(false);
    await h.session.send("bonjour");
    expect(h.starts).toHaveLength(1);
  });
});

describe("jeton appliqué sans redémarrage", () => {
  it("moteur inactif : remplacé tout de suite, le suivant relit le nouveau jeton, même session", async () => {
    const h = harness({ requireProvider: true });
    h.setToken("ancien");
    await h.session.authChanged();
    await h.session.send("un");
    h.sessionStarted();
    h.endTurn();
    expect(h.starts[0]?.auth).toBe("ancien");

    h.setToken("nouveau");
    await h.session.authChanged();
    // L'ancien moteur est arrêté sans attendre le message suivant.
    expect(h.disposed).toContain(h.starts[0]?.id);

    await h.session.send("deux");
    expect(h.starts).toHaveLength(2);
    expect(h.starts[1]?.auth).toBe("nouveau");
    expect(h.starts[1]?.params).toMatchObject({ resume: "S1" });
  });

  it("jeton changé pendant un tour : le tour finit, le message suivant utilise le nouveau jeton", async () => {
    const h = harness({ requireProvider: true });
    h.setToken("ancien");
    await h.session.authChanged();
    await h.session.send("un");
    h.sessionStarted();
    // Tour en cours : le moteur n'est pas touché.
    h.setToken("nouveau");
    await h.session.authChanged();
    expect(h.disposed).toHaveLength(0);

    h.endTurn();
    await h.session.send("deux");
    expect(h.starts).toHaveLength(2);
    expect(h.starts[1]?.auth).toBe("nouveau");
  });

  it("jeton inchangé : le moteur est conservé d'un message à l'autre", async () => {
    const h = harness({ requireProvider: true });
    h.setToken("A");
    await h.session.authChanged();
    await h.session.send("un");
    h.sessionStarted();
    h.endTurn();
    await h.session.send("deux");
    expect(h.starts).toHaveLength(1);
  });
});

describe("message addProvider de la webview", () => {
  it("accepté sans champ, refusé avec un champ en trop", () => {
    expect(parseWebviewMessage({ type: "addProvider" })).toEqual({ type: "addProvider" });
    expect(parseWebviewMessage({ type: "addProvider", token: "sk-x" })).toBeNull();
    expect(parseWebviewMessage({ type: "addProvider", command: "workbench.action" })).toBeNull();
  });
});
