import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createProject } from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { AccountStore } from "../src/bridge/accounts.js";
import { createAuditFile } from "../src/bridge/audit.js";
import { MissionHub } from "../src/bridge/hub.js";
import {
  approval,
  fakeProjectHalts,
  type Msg,
  setup,
  shellOf,
  TOKEN,
  useStorage,
} from "./bridge-helpers.js";

const ctx = useStorage();

/** Un chat avec un message envoyé (le moteur existe) et une demande en attente. */
async function chatWithApproval(t: ReturnType<typeof setup>, id = "a") {
  const chat = t.connect();
  chat.say("chat", "f1", { type: "ready" });
  chat.say("chat", "f1", { type: "send", text: "bonjour" });
  await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
  t.engine()?.handlers.onApproval?.(approval(id));
  return chat;
}

describe("arrêt d'urgence global", () => {
  it("halt : diffusé, posé sur les projets, toute autorisation suivante est refusée ; resume rétablit", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const other = shellOf(t);
    await chatWithApproval(t, "a");
    t.engine()?.handlers.onApproval?.(approval("b"));

    shell.say("shell", "shell", { type: "halt" });
    await vi.waitFor(() => expect(other.of("shell", "halt").at(-1)?.msg.active).toBe(true));
    expect(shell.of("shell", "halt").at(-1)?.msg.since).toEqual(expect.any(String));
    expect([...t.halted].sort()).toEqual(["p1", "p2"]);

    shell.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "once" });
    shell.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "always" });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.engine()?.answers).toEqual([]);

    // Un refus reste possible pendant l'arrêt.
    shell.say("shell", "f1", { type: "approve", toolUseId: "b", choice: "deny" });
    await vi.waitFor(() => expect(t.engine()?.answers).toEqual([["b", "deny", undefined]]));

    shell.say("shell", "shell", { type: "resume" });
    await vi.waitFor(() => expect(other.of("shell", "halt").at(-1)?.msg.active).toBe(false));
    expect(t.halted.size).toBe(0);
    shell.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "once" });
    await vi.waitFor(() => expect(t.engine()?.answers).toContainEqual(["a", "allow", undefined]));
  });

  it("état à la connexion ; persistant (un nouveau hub reste à l'arrêt) ; date conservée", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    expect(shell.of("shell", "halt")[0]?.msg).toEqual({ type: "halt", active: false, since: null });
    shell.say("shell", "shell", { type: "halt" });
    await vi.waitFor(() => expect(shell.of("shell", "halt").at(-1)?.msg.active).toBe(true));
    const since = shell.of("shell", "halt").at(-1)?.msg.since;
    shell.say("shell", "shell", { type: "halt" });
    await new Promise((r) => setTimeout(r, 20));
    expect(shell.of("shell", "halt").at(-1)?.msg.since).toBe(since);
    t.hub.dispose();

    const t2 = setup(ctx);
    const fresh = shellOf(t2);
    expect(fresh.of("shell", "halt")[0]?.msg).toEqual({ type: "halt", active: true, since });
  });

  it("le Bypass est coupé par l'arrêt et ne peut plus être activé pendant sa durée", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "setBypass", active: true, durationMinutes: null });
    await vi.waitFor(() => expect(shell.of("shell", "bypass").at(-1)?.msg.active).toBe(true));
    shell.say("shell", "shell", { type: "halt" });
    await vi.waitFor(() => expect(shell.of("shell", "bypass").at(-1)?.msg.active).toBe(false));
    const before = t.bridge.stats().ignored;
    shell.say("shell", "shell", { type: "setBypass", active: true, durationMinutes: 10 });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
    expect(shell.of("shell", "bypass").at(-1)?.msg.active).toBe(false);
    // Le chat ne le contourne pas non plus.
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    chat.say("chat", "f1", { type: "setBypass", enabled: true, durationMs: 600000 });
    await new Promise((r) => setTimeout(r, 20));
    expect(chat.of("chat", "bypass").at(-1)?.msg.on).toBeFalsy();
    expect(chat.of("chat", "bypass").at(-1)?.msg.armed).toBeFalsy();
  });

  it("arrêt actif : l'arrêt est posé sur le projet visé avant le premier start ; écriture en échec : aucun start ; resume le lève", async () => {
    const ids = ["p1"];
    const halted = new Set<string>();
    let fail = false;
    const order: string[] = [];
    const halts = {
      ids: async () => ids,
      isHalted: (id: string) => halted.has(id),
      set: async (id: string) => {
        if (fail) throw new Error("disque plein");
        halted.add(id);
        order.push(`set:${id}`);
      },
      clear: async (id: string) => void halted.delete(id),
    };
    const t = setup(ctx, { projectHalts: halts });
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "halt" });
    await vi.waitFor(() => expect(t.hub.halted()).toBe(true));
    // Projet créé après l'arrêt.
    ids.push("p-new");
    fail = true;
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    chat.say("chat", "f1", { type: "send", text: "bonjour" });
    await new Promise((r) => setTimeout(r, 50));
    expect(t.engine()).toBeUndefined();
    expect(halted.has("p-new")).toBe(false);
    fail = false;
    chat.say("chat", "f1", { type: "send", text: "encore" });
    await vi.waitFor(() => expect(t.engine()).toBeDefined());
    expect(halted.has("p-new")).toBe(true);
    expect(order.at(-1)).toBe("set:p-new");
    shell.say("shell", "shell", { type: "resume" });
    await vi.waitFor(() => expect(halted.size).toBe(0));
  });

  it("halt et resume avec une clé en trop sont ignorés", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "halt", force: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.hub.halted()).toBe(false);
    expect(t.bridge.stats().ignored).toBe(1);
  });
});

describe("Bypass global", () => {
  it("illimité accepté et diffusé ; appliqué aux cadres existants et futurs ; coupé par off", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    shell.say("shell", "shell", { type: "setBypass", active: true, durationMinutes: null });
    await vi.waitFor(() =>
      expect(shell.of("shell", "bypass").at(-1)?.msg).toEqual({
        type: "bypass",
        active: true,
        until: null,
      }),
    );
    expect(chat.of("chat", "bypass").at(-1)?.msg).toMatchObject({ armed: true, expiresAt: null });
    // Cadre créé après coup.
    const late = t.connect();
    late.say("chat", "f2", { type: "ready" });
    expect(late.of("chat", "bypass").at(-1)?.msg).toMatchObject({ armed: true });
    shell.say("shell", "shell", { type: "setBypass", active: false, durationMinutes: null });
    await vi.waitFor(() => expect(shell.of("shell", "bypass").at(-1)?.msg.active).toBe(false));
    expect(chat.of("chat", "bypass").at(-1)?.msg).toMatchObject({ on: false, armed: false });
    expect(t.audit.map((e) => e.kind)).toEqual(["bypass.on", "bypass.off"]);
  });

  it("durée bornée : 48 h acceptées, 0, 2881 ou non entière refusées", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    for (const durationMinutes of [0, 2881, 1.5, "10", -5])
      shell.say("shell", "shell", { type: "setBypass", active: true, durationMinutes });
    shell.say("shell", "shell", { type: "setBypass", active: true });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(6));
    shell.say("shell", "shell", { type: "setBypass", active: true, durationMinutes: 2880 });
    await vi.waitFor(() => {
      const last = shell.of("shell", "bypass").at(-1)?.msg;
      expect(last?.active).toBe(true);
      expect(typeof last?.until).toBe("number");
    });
  });
});

describe("configuration : réglages", () => {
  it("patch valide persisté et diffusé ; null supprime ; clé inconnue et valeur invalide refusées", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const other = shellOf(t);
    shell.say("shell", "shell", {
      type: "settingsSet",
      patch: { maxTurns: 12, profile: "mentor" },
    });
    await vi.waitFor(() =>
      expect(other.of("shell", "settings").at(-1)?.msg.values).toEqual({
        maxTurns: 12,
        profile: "mentor",
        defaultProvider: "claude",
        defaultModel: null,
      }),
    );
    shell.say("shell", "shell", { type: "settingsSet", patch: { profile: null } });
    await vi.waitFor(() =>
      expect(other.of("shell", "settings").at(-1)?.msg.values).toEqual({
        maxTurns: 12,
        defaultProvider: "claude",
        defaultModel: null,
      }),
    );
    const before = t.bridge.stats().ignored;
    shell.say("shell", "shell", { type: "settingsSet", patch: { "warband.evil": 1 } });
    shell.say("shell", "shell", { type: "settingsSet", patch: { maxTurns: -3 } });
    shell.say("shell", "shell", { type: "settingsSet", patch: { profile: "inconnu" } });
    shell.say("shell", "shell", { type: "settingsSet", patch: { "chat.skills": ["Pas Valide"] } });
    shell.say("shell", "shell", { type: "settingsSet", patch: {} });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 5));
    expect(shell.of("shell", "configError")).toHaveLength(3);
    shell.say("shell", "shell", { type: "settingsGet" });
    await vi.waitFor(() =>
      expect(shell.of("shell", "settings").at(-1)?.msg.values).toEqual({
        maxTurns: 12,
        defaultProvider: "claude",
        defaultModel: null,
      }),
    );
  });
});

describe("configuration : jetons", () => {
  it("tokenSet puis tokens : présence et type, jamais la valeur ; coffre à jour ; sessions prévenues", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const other = shellOf(t);
    const value = "sk-ant-nouveau-jeton-tres-secret";
    shell.say("shell", "shell", { type: "tokenSet", provider: "openai", kind: "api-key", value });
    await vi.waitFor(() =>
      expect(other.of("shell", "tokens").at(-1)?.msg.items).toEqual([
        { provider: "claude", kind: "api-key", present: true },
        { provider: "openai", kind: "api-key", present: true },
      ]),
    );
    shell.say("shell", "shell", { type: "tokens" });
    await vi.waitFor(() => expect(shell.of("shell", "tokens").length).toBeGreaterThan(1));
    expect(await ctx.storage.secrets.get("provider.openai.token")).toBe(value);
    for (const s of [shell, other]) {
      const all = JSON.stringify(s.sent);
      expect(all).not.toContain(value);
      expect(all).not.toContain(TOKEN);
    }
    expect(JSON.stringify(t.audit)).not.toContain(value);
    expect(t.audit).toContainEqual({ kind: "token.set", provider: "openai" });

    shell.say("shell", "shell", { type: "tokenDelete", provider: "openai" });
    await vi.waitFor(() =>
      expect(other.of("shell", "tokens").at(-1)?.msg.items).toEqual([
        { provider: "claude", kind: "api-key", present: true },
        { provider: "openai", kind: null, present: false },
      ]),
    );
    expect(await ctx.storage.secrets.get("provider.openai.token")).toBeUndefined();
  });

  it("jeton invalide refusé : fournisseur ou type inconnu, valeur vide, espaces, abonnement OpenAI", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const bad = [
      { provider: "evil", kind: "api-key", value: "abc" },
      { provider: "claude", kind: "autre", value: "abc" },
      { provider: "claude", kind: "api-key", value: "" },
      { provider: "claude", kind: "api-key", value: "a b" },
      { provider: "claude", kind: "api-key", value: "a\nb" },
      { provider: "openai", kind: "subscription", value: "abc" },
      { provider: "claude", kind: "api-key", value: "x".repeat(8193) },
    ];
    for (const m of bad) shell.say("shell", "shell", { type: "tokenSet", ...m });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(bad.length));
    expect(await ctx.storage.secrets.get("provider.claude.token")).toBe(TOKEN);
  });
});

describe("configuration : comptes de test", () => {
  const add = { programme: "ACME", label: "ADMIN", login: "root", secret: "s3cr3t-Valeur!" };

  it("accountAdd, accounts sans secret, reveal au seul demandeur, audit sans valeur, remove", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const other = shellOf(t);
    shell.say("shell", "shell", { type: "accountAdd", ...add });
    await vi.waitFor(() => expect(other.of("shell", "accounts")).toHaveLength(1));
    const items = (other.of("shell", "accounts")[0]?.msg.items ?? []) as Msg[];
    const meta = items[0];
    expect(meta).toMatchObject({
      programme: "ACME",
      label: "ADMIN",
      login: "root",
      createdBy: "human",
    });
    expect(meta?.createdAt).toEqual(expect.any(String));
    expect(JSON.stringify(other.sent)).not.toContain(add.secret);
    // Le secret est dans le coffre, pas dans l'état.
    expect(await ctx.storage.secrets.get(`account.${meta?.id}`)).toBe(add.secret);
    expect(JSON.stringify(ctx.storage.state.get("accounts"))).not.toContain(add.secret);

    shell.say("shell", "shell", { type: "accountReveal", id: meta?.id });
    await vi.waitFor(() =>
      expect(shell.of("shell", "accountSecret")).toEqual([
        expect.objectContaining({
          msg: { type: "accountSecret", id: meta?.id, value: add.secret },
        }),
      ]),
    );
    expect(other.of("shell", "accountSecret")).toHaveLength(0);
    expect(JSON.stringify(other.sent)).not.toContain(add.secret);
    expect(t.audit).toContainEqual({ kind: "account.reveal", id: meta?.id });
    expect(JSON.stringify(t.audit)).not.toContain(add.secret);

    shell.say("shell", "shell", { type: "accountRemove", id: meta?.id });
    await vi.waitFor(() => expect(other.of("shell", "accounts").at(-1)?.msg.items).toEqual([]));
    expect(await ctx.storage.secrets.get(`account.${meta?.id}`)).toBeUndefined();
  });

  it("accountAdd sans secret, libellé invalide, doublon : refusés", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const { secret: _s, ...noSecret } = add;
    shell.say("shell", "shell", { type: "accountAdd", ...noSecret });
    shell.say("shell", "shell", { type: "accountAdd", ...add, secret: "" });
    shell.say("shell", "shell", { type: "accountAdd", ...add, label: "minuscule" });
    shell.say("shell", "shell", { type: "accountReveal", id: "pas-un-uuid" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(4));
    shell.say("shell", "shell", { type: "accountAdd", ...add });
    await vi.waitFor(() => expect(shell.of("shell", "accounts")).toHaveLength(1));
    shell.say("shell", "shell", { type: "accountAdd", ...add });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(1));
    // Révéler un compte inconnu : refusé, aucun secret.
    shell.say("shell", "shell", {
      type: "accountReveal",
      id: "00000000-0000-4000-8000-000000000000",
    });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(2));
    expect(shell.of("shell", "accountSecret")).toHaveLength(0);
  });

  it("AccountStore.testAccountsFor : comptes du projet actif (id ou nom), forme du cœur", async () => {
    const store = new AccountStore(ctx.storage);
    await store.add({ programme: "Acme", label: "ADMIN", login: "root", secret: "pw-1" });
    await store.add({ programme: "autre", label: "USER", login: "bob", secret: "pw-2" });
    expect(await store.testAccountsFor(null)).toEqual([]);
    expect(await store.testAccountsFor({ id: "p1", name: "acme" })).toEqual([
      { label: "ADMIN", host: "", identifier: "root", secret: "pw-1", kind: "password" },
    ]);
  });

  it("le hub passe les comptes du projet actif au moteur", async () => {
    const configDir = join(ctx.dir, "config");
    await mkdir(configDir, { recursive: true });
    await createProject(configDir, { name: "Acme", workspace: ctx.dir });
    await new AccountStore(ctx.storage).add({
      programme: "Acme",
      label: "ADMIN",
      login: "root",
      secret: "pw-1",
    });
    const t = setup(ctx);
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    chat.say("chat", "f1", { type: "send", text: "bonjour" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    expect(t.engine()?.startParams?.testAccounts).toEqual([
      { label: "ADMIN", host: "", identifier: "root", secret: "pw-1", kind: "password" },
    ]);
  });
});

describe("configuration : identifiants enregistrés par l'agent", () => {
  const request = {
    label: "TOKEN1",
    login: "",
    secret: "tok_0123456789abcdefSECRET",
    kind: "token",
  } as const;

  async function started(programmeProject = true) {
    const configDir = join(ctx.dir, "config");
    await mkdir(configDir, { recursive: true });
    if (programmeProject) await createProject(configDir, { name: "Acme", workspace: ctx.dir });
    const t = setup(ctx);
    const shell = shellOf(t);
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    chat.say("chat", "f1", { type: "send", text: "bonjour" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    return { t, shell };
  }

  it("le moteur reçoit la capacité ; la demande crée un compte createdBy agent, secret au coffre", async () => {
    const { t, shell } = await started();
    expect(t.engine()?.startParams).toMatchObject({ credentialStore: true });
    const result = await t.engine()?.handlers.onCredential?.({ ...request });
    expect(result?.ok).toBe(true);
    const [meta] = new AccountStore(ctx.storage).list();
    expect(meta).toMatchObject({
      label: "TOKEN1",
      createdBy: "agent",
      kind: "token",
      programme: expect.any(String),
    });
    expect(result?.id).toBe(meta?.id);
    // Secret dans le coffre ; ni dans l'état, ni dans la diffusion, ni dans l'audit, ni dans la réponse.
    expect(await ctx.storage.secrets.get(`account.${meta?.id}`)).toBe(request.secret);
    expect(JSON.stringify(ctx.storage.state.get("accounts"))).not.toContain(request.secret);
    expect(JSON.stringify(result)).not.toContain(request.secret);
    await vi.waitFor(() => expect(shell.of("shell", "accounts").length).toBeGreaterThan(0));
    expect(JSON.stringify(shell.sent)).not.toContain(request.secret);
    expect(t.audit).toContainEqual({
      kind: "account.add",
      id: meta?.id,
      programme: meta?.programme,
      label: "TOKEN1",
      createdBy: "agent",
    });
    expect(JSON.stringify(t.audit)).not.toContain(request.secret);
  });

  it("le compte est passé au moteur suivant (jeton sans login : libellé comme identifiant)", async () => {
    const { t } = await started();
    await t.engine()?.handlers.onCredential?.({ ...request });
    const accounts = await new AccountStore(ctx.storage).testAccountsFor({
      id: new AccountStore(ctx.storage).list()[0]?.programme ?? "",
      name: "Acme",
    });
    expect(accounts).toEqual([
      { label: "TOKEN1", host: "", identifier: "TOKEN1", secret: request.secret, kind: "password" },
    ]);
  });

  it("libellé déjà pris : refus, rien n'est stocké en double", async () => {
    const { t } = await started();
    expect((await t.engine()?.handlers.onCredential?.({ ...request }))?.ok).toBe(true);
    expect(await t.engine()?.handlers.onCredential?.({ ...request })).toEqual({ ok: false });
    expect(new AccountStore(ctx.storage).list()).toHaveLength(1);
  });

  it("sans projet actif ni programme : refus ; avec un programme explicite : accepté", async () => {
    const { t } = await started(false);
    expect(await t.engine()?.handlers.onCredential?.({ ...request })).toEqual({ ok: false });
    expect(new AccountStore(ctx.storage).list()).toHaveLength(0);
    expect((await t.engine()?.handlers.onCredential?.({ ...request, programme: "X" }))?.ok).toBe(
      true,
    );
  });

  it("AccountStore.testAccountsFor : un compte invalide n'écarte pas les autres ; cookie sans login admis", async () => {
    const store = new AccountStore(ctx.storage);
    await store.add({ programme: "p1", label: "OK", login: "root", secret: "pw-1" });
    await store.add({ programme: "p1", label: "BAD!", login: "x", secret: "pw-2" });
    await store.add(
      { programme: "p1", label: "COOK", login: "", secret: "c=1", kind: "cookie" },
      "agent",
    );
    expect((await store.testAccountsFor({ id: "p1", name: "n" })).map((a) => a.label)).toEqual([
      "OK",
      "COOK",
    ]);
  });
});

describe("journal d'audit", () => {
  it("fichier JSONL : champs suspects retirés", async () => {
    const file = join(ctx.dir, "audit.jsonl");
    const audit = createAuditFile(file, () => new Date("2026-01-01T00:00:00Z"));
    audit({ kind: "account.reveal", id: "x", value: "SECRET", secret: "S2", token: "T" });
    await audit.flush();
    expect((await readFile(file, "utf8")).trim()).toBe(
      '{"ts":"2026-01-01T00:00:00.000Z","kind":"account.reveal","id":"x"}',
    );
  });
});

describe("unsubscribe / dispose", () => {
  it("un hub arrêté ne traite plus de contrôle", async () => {
    const hub = new MissionHub({ storage: ctx.storage, projectHalts: fakeProjectHalts().halts });
    hub.dispose();
    expect(await hub.control({ type: "halt" }, { send: () => undefined })).toBe(false);
  });
});
