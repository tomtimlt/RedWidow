import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const containers = await load("../web/screens/containers.js");
const providers = await load("../web/screens/providers.js");
const accounts = await load("../web/screens/accounts.js");
const findings = await load("../web/screens/findings.js");
const journal = await load("../web/screens/journal.js");
const settings = await load("../web/screens/settings.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

describe("règles de forme des écrans natifs", () => {
  const dir = fileURLToPath(new URL("../web/screens/", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  const SOURCE_FILES = [
    ...files.map((f) => `${dir}${f}`),
    fileURLToPath(new URL("../web/shell.js", import.meta.url)),
  ];

  it("couvre bien les six écrans du lot", () => {
    for (const name of ["containers", "providers", "accounts", "findings", "journal", "settings"])
      expect(files).toContain(`${name}.js`);
  });

  for (const forbidden of [
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "document.write",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "console.",
    '"style"',
    ".style.cssText",
  ]) {
    it(`aucun « ${forbidden} » dans les écrans ni la coquille`, () => {
      for (const file of SOURCE_FILES) {
        const text = readFileSync(file, "utf8")
          // Les commentaires peuvent citer ces mots ; le code non.
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        // La coquille garde un `sessionStorage` documenté pour le lien profond (lot 1) : seul cas toléré.
        if (forbidden === "sessionStorage" && file.endsWith("shell.js")) continue;
        expect(text.includes(forbidden), `${file} contient ${forbidden}`).toBe(false);
      }
    });
  }

  it("les écrans n'écrivent aucun style en ligne (pas de `.style`)", () => {
    for (const file of SOURCE_FILES.filter((f) => f.includes("/screens/"))) {
      const text = readFileSync(file, "utf8");
      expect(/\.style\b/.test(text), file).toBe(false);
    }
  });
});

describe("Conteneurs", () => {
  it("lit la liste, écarte les entrées illisibles, borne les types", () => {
    const items = containers.parseContainers({
      items: [
        { id: "a1", name: "kali-1", image: "img", state: "running", kind: "kali", project: "p" },
        { id: "", name: "x" },
        "x",
        { id: "b2", name: "ex", image: "i", state: "zzz", kind: "inconnu" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ state: "running", kind: "kali", project: "p" });
    expect(items[1]).toMatchObject({ state: "stopped", kind: "autre", project: "" });
    expect(containers.parseContainers(null)).toEqual([]);
  });

  it("contrôle le nom d'un nouveau Kali comme le serveur", () => {
    expect(containers.checkContainerName("kali-recon")).toBeNull();
    for (const bad of ["", "  ", "-x", "a b", "a/b", "x".repeat(129), 3])
      expect(containers.checkContainerName(bad)).not.toBeNull();
  });
});

describe("Fournisseurs", () => {
  it("lit les jetons sans jamais de valeur", () => {
    const items = providers.parseTokens({
      items: [
        { provider: "claude", present: true, kind: "api-key", value: "sk-secret" },
        { provider: "openai", present: false, kind: "api-key" },
        { provider: "autre", present: true },
      ],
    });
    expect(items).toEqual([
      { provider: "claude", present: true, kind: "api-key" },
      { provider: "openai", present: false, kind: null },
    ]);
    expect(JSON.stringify(items)).not.toContain("sk-secret");
  });

  it("lit une réserve : ordre conservé, actif valide, aucune valeur retenue", () => {
    const pool = providers.parsePool({
      provider: "claude",
      active: UUID_B,
      keys: [
        {
          id: UUID_A,
          label: "Principale",
          state: "exhausted",
          retryAt: 1700000000000,
          value: "sk-x",
        },
        { id: UUID_B, label: "Secours", state: "ok", retryAt: null },
        { id: "pas-un-uuid", label: "x", state: "ok" },
      ],
    });
    expect(pool.keys.map((k: { id: string }) => k.id)).toEqual([UUID_A, UUID_B]);
    expect(pool.active).toBe(UUID_B);
    expect(pool.keys[0]).toEqual({
      id: UUID_A,
      label: "Principale",
      state: "exhausted",
      retryAt: 1700000000000,
    });
    expect(JSON.stringify(pool)).not.toContain("sk-x");
    expect(providers.parsePool({ provider: "claude", active: UUID_C, keys: [] }).active).toBeNull();
    expect(providers.parsePool({ provider: "autre", keys: [] })).toBeNull();
  });

  it("déplace une clé d'un cran, refuse hors bornes", () => {
    const order = [UUID_A, UUID_B, UUID_C];
    expect(providers.moveKey(order, UUID_B, -1)).toEqual([UUID_B, UUID_A, UUID_C]);
    expect(providers.moveKey(order, UUID_B, 1)).toEqual([UUID_A, UUID_C, UUID_B]);
    expect(providers.moveKey(order, UUID_A, -1)).toBeNull();
    expect(providers.moveKey(order, UUID_C, 1)).toBeNull();
    expect(providers.moveKey(order, "inconnu", 1)).toBeNull();
    expect(order).toEqual([UUID_A, UUID_B, UUID_C]);
  });

  it("décrit une bascule et l'épuisement du fil, avec les libellés seulement", () => {
    const e = providers.parsePoolEvent(
      { provider: "claude", from: "Principale", to: "Secours", reason: "quota", phase: "switched" },
      1,
    );
    expect(providers.describeEvent(e)).toBe(
      "Claude : bascule de « Principale » vers « Secours » (quota atteint).",
    );
    const done = providers.parsePoolEvent(
      { provider: "openai", from: "A", to: null, reason: "rateLimit", phase: "exhausted" },
      2,
    );
    expect(providers.describeEvent(done)).toContain("toutes les clés sont épuisées");
    expect(providers.parsePoolEvent({ provider: "claude", phase: "inconnue" })).toBeNull();
    expect(providers.parsePoolEvent({ provider: "x", phase: "switched" })).toBeNull();
  });

  it("refuse une clé vide ou contenant un espace, un libellé vide ou trop long", () => {
    expect(providers.checkSecret("")).not.toBeNull();
    expect(providers.checkSecret("a b")).not.toBeNull();
    expect(providers.checkSecret("a\nb")).not.toBeNull();
    expect(providers.checkSecret("sk-ok")).toBeNull();
    expect(providers.checkLabel("")).not.toBeNull();
    expect(providers.checkLabel("x".repeat(41))).not.toBeNull();
    expect(providers.checkLabel("clé équipe")).toBeNull();
  });
});

describe("Comptes de test", () => {
  it("lit les comptes, auteur et date, sans jamais de mot de passe", () => {
    const items = accounts.parseAccounts({
      items: [
        {
          id: UUID_A,
          programme: "Acme",
          label: "USER_A",
          login: "alice@example.test",
          createdBy: "agent",
          createdAt: "2026-01-02T03:04:05Z",
          secret: "hunter2",
          value: "hunter2",
        },
        {
          id: UUID_B,
          programme: "Acme",
          label: "ADMIN",
          login: "root",
          createdBy: "human",
          date: 5,
        },
        { id: "x" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ createdBy: "agent", date: "2026-01-02T03:04:05Z" });
    expect(items[1].createdBy).toBe("human");
    expect(JSON.stringify(items)).not.toContain("hunter2");
    expect(accounts.programmesOf(items)).toEqual(["Acme"]);
  });

  it("contrôle le formulaire d'ajout (libellé en majuscules, secret obligatoire)", () => {
    const ok = { programme: "Acme", label: "USER_A", login: "alice", secret: "pw" };
    expect(accounts.checkAccount(ok)).toBeNull();
    expect(accounts.checkAccount({ ...ok, label: "user" })).not.toBeNull();
    expect(accounts.checkAccount({ ...ok, programme: " " })).not.toBeNull();
    expect(accounts.checkAccount({ ...ok, login: "" })).not.toBeNull();
    expect(accounts.checkAccount({ ...ok, secret: "" })).not.toBeNull();
  });

  describe("révélation de 30 secondes", () => {
    const node = () => ({ textContent: "" });

    it("la valeur n'est posée que sur demande, puis effacée après 30 s", () => {
      vi.useFakeTimers();
      const changed = vi.fn();
      const r = accounts.createRevealer({ onChange: changed });
      const cell = node();
      // Réponse non demandée : refusée, rien n'est posé.
      expect(r.reveal(UUID_A, cell, "hunter2")).toBe(false);
      expect(cell.textContent).toBe("");
      r.expect(UUID_A);
      expect(r.reveal(UUID_A, cell, "hunter2", 0)).toBe(true);
      expect(cell.textContent).toBe("hunter2");
      expect(r.isShown(UUID_A)).toBe(true);
      vi.advanceTimersByTime(29000);
      expect(cell.textContent).toBe("hunter2");
      expect(r.remainingMs(UUID_A, 29000)).toBe(1000);
      vi.advanceTimersByTime(1000);
      expect(cell.textContent).toBe("");
      expect(r.isShown(UUID_A)).toBe(false);
      expect(r.size()).toBe(0);
      // Une seconde réponse pour le même id n'est plus acceptée.
      expect(r.reveal(UUID_A, cell, "hunter2")).toBe(false);
      expect(changed).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("masquer, perdre la connexion ou fermer efface aussitôt", () => {
      vi.useFakeTimers();
      const r = accounts.createRevealer();
      const a = node();
      const b = node();
      r.expect(UUID_A);
      r.reveal(UUID_A, a, "un");
      r.expect(UUID_B);
      r.reveal(UUID_B, b, "deux");
      r.hide(UUID_A);
      expect(a.textContent).toBe("");
      expect(b.textContent).toBe("deux");
      r.clearAll();
      expect(b.textContent).toBe("");
      expect(r.size()).toBe(0);
      // Une demande en attente est aussi annulée.
      r.expect(UUID_C);
      r.clearAll();
      expect(r.isPending(UUID_C)).toBe(false);
      vi.useRealTimers();
    });

    it("une demande sans réponse expire", () => {
      vi.useFakeTimers();
      const r = accounts.createRevealer();
      r.expect(UUID_A);
      vi.advanceTimersByTime(accounts.PENDING_MS + 1);
      expect(r.reveal(UUID_A, node(), "tard")).toBe(false);
      vi.useRealTimers();
    });
  });
});

describe("Trouvailles", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    id: "f1",
    project: UUID_A,
    kind: "host",
    label: "10.0.0.5",
    state: "confirmed",
    tactic: "TA0001",
    technique: "T1190",
    from: ["x"],
    evidence: [{ id: "e1", label: "scan" }],
    ...over,
  });

  it("construit le lien d'export du serveur, sans Markdown côté navigateur", () => {
    expect(findings.reportUrl(UUID_A)).toBe(`/api/report?project=${UUID_A}&locale=fr`);
    expect(findings.reportUrl(UUID_A, "en")).toBe(`/api/report?project=${UUID_A}&locale=en`);
    expect(findings.reportUrl("../x")).toBeNull();
    expect(findings.reportUrl(null)).toBeNull();
  });

  it("lit la liste sans inventer de gravité", () => {
    const parsed = findings.parseFindings({
      project: null,
      items: [
        raw(),
        raw({ id: "", label: "x" }),
        raw({ project: "pas-un-uuid" }),
        raw({ kind: "?", state: "?" }),
      ],
    });
    expect(parsed.project).toBeNull();
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).not.toHaveProperty("severity");
    expect(parsed.items[1]).toMatchObject({ kind: "step", state: "hypothesis" });
  });

  it("fusionne : un projet remplace ses lignes, null remplace tout", () => {
    const a = findings.parseFindings({
      project: null,
      items: [raw({ id: "a" }), raw({ id: "b", project: UUID_B })],
    }).items;
    const afterDelete = findings.mergeFindings(a, { project: UUID_A, items: [] });
    expect(afterDelete.map((i: { id: string }) => i.id)).toEqual(["b"]);
    expect(findings.mergeFindings(a, { project: null, items: [] })).toEqual([]);
    expect(findings.projectsOf(a)).toEqual([UUID_A, UUID_B]);
  });

  it("lit le détail : preuves en texte brut, bornées, marquées tronquées", () => {
    const detail = findings.parseFinding({
      finding: {
        ...raw(),
        pathFrom: ["a"],
        evidenceDetails: [
          {
            id: "e1",
            label: "scan",
            capturedAt: "2026-01-01T00:00:00Z",
            source: { kind: "tool", reference: "nmap" },
            text: `<img src=x onerror=alert(1)>${"a".repeat(30000)}`,
            truncated: true,
          },
        ],
      },
    });
    expect(detail.evidenceDetails[0].text.startsWith("<img src=x")).toBe(true);
    expect(detail.evidenceDetails[0].text.length).toBe(findings.MAX_EVIDENCE_TEXT);
    expect(detail.evidenceDetails[0].truncated).toBe(true);
    expect(findings.parseFinding({ finding: 3 })).toBeNull();
  });
});

describe("Journal", () => {
  it("n'accepte qu'un identifiant de run valide", () => {
    expect(journal.cleanRunId(" run_1-a ")).toBe("run_1-a");
    for (const bad of ["", "a b", "../x", "x".repeat(65), 3, null])
      expect(journal.cleanRunId(bad)).toBeNull();
  });

  it("retient les derniers runs, sans doublon, bornés", () => {
    let list: string[] = [];
    for (let i = 0; i < 15; i += 1) list = journal.pushRecent(list, `r${i}`);
    expect(list).toHaveLength(journal.MAX_RECENT);
    expect(list[0]).toBe("r14");
    expect(journal.pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });
});

describe("Réglages", () => {
  it("Bypass : illimité par défaut, durées fermées, désactivation sans durée", () => {
    expect(settings.bypassMessage(true, "")).toEqual({
      type: "setBypass",
      active: true,
      durationMinutes: null,
    });
    expect(settings.bypassMessage(true, null)).toEqual({
      type: "setBypass",
      active: true,
      durationMinutes: null,
    });
    for (const [label, minutes] of [
      ["1 h", 60],
      ["8 h", 480],
      ["24 h", 1440],
      ["48 h", 2880],
    ] as const)
      expect(settings.bypassMessage(true, String(minutes)), label).toEqual({
        type: "setBypass",
        active: true,
        durationMinutes: minutes,
      });
    expect(settings.bypassMessage(true, "7")).toBeNull();
    expect(settings.bypassMessage(true, "99999")).toBeNull();
    expect(settings.bypassMessage(false, "60")).toEqual({
      type: "setBypass",
      active: false,
      durationMinutes: null,
    });
    expect(settings.BYPASS_DURATIONS[0]).toEqual({ label: "Illimité", minutes: null });
    expect(settings.BYPASS_CONFIRM_TEXT).toContain("responsable");
  });

  it("notifications : la permission ne se demande que lorsqu'elle est « default »", () => {
    expect(settings.notificationState(null).canAsk).toBe(false);
    expect(settings.notificationState({ permission: "default" }).canAsk).toBe(true);
    expect(settings.notificationState({ permission: "granted" })).toMatchObject({
      canAsk: false,
      tone: "ok",
    });
    expect(settings.notificationState({ permission: "denied" })).toMatchObject({
      canAsk: false,
      tone: "err",
    });
  });

  it("patch de réglages : seulement ce qui change, un modèle vidé redevient par défaut", () => {
    const before = { profile: "mentor", model: "abc", "burp.enabled": true };
    expect(
      settings.settingsPatch(before, {
        profile: "mentor",
        model: "abc",
        "burp.enabled": true,
        "chat.webSearch": false,
      }),
    ).toEqual({});
    expect(
      settings.settingsPatch(before, {
        profile: "htb",
        model: "",
        "burp.enabled": false,
        "chat.webSearch": true,
      }),
    ).toEqual({ profile: "htb", model: null, "burp.enabled": false, "chat.webSearch": true });
  });
});
