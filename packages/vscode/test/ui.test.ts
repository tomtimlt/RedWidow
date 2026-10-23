import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EXEGOL_EXEC_TOOL } from "@warband/core";
import { describe, expect, it } from "vitest";

interface UiApi {
  listboxKey(s: { active: number }, key: string, o: { disabled?: boolean }[]): { active: number };
  filterModels<T extends { label: string; value: string | null; description: string }>(
    m: T[],
    q: string,
  ): T[];
  placePopover(
    a: { left: number; top: number; bottom: number },
    s: { width: number; height: number },
    v: { width: number; height: number },
    margin?: number,
  ): { x: number; y: number; side: string; maxHeight: number; width: number };
  effortPct(i: number, n: number): number;
  tabTarget(count: number, current: number, shift: boolean): number;
  bodyClasses(
    v: { busy: boolean; approvals: unknown[]; readonly: unknown },
    e: { hidden: boolean; reducedMotion: boolean },
  ): string[];
  activityLabel(v: { busy: boolean; approvals: unknown[]; items: unknown[] }): string;
  EXEC_TOOL: string;
  historyBadge(entry: { current: boolean }, running: boolean): string | null;
  monitorRows(view: unknown): MonitorRow[];
  inputRecall(
    state: { index: number; draft: string; entries: string[]; current: string },
    key: string,
    cursor: { line: number; lines: number },
  ): { index: number; draft: string; value: string } | null;
  syncRecallEntries(local: string[], viewUsers: string[]): string[];
  mentionSpan(value: string, cursor: number): { query: string; start: number } | null;
  hashSpan(value: string, cursor: number): { query: string; start: number } | null;
  filterTerminals(
    items: { token: string; label?: string; hint?: string }[],
    query: string,
  ): { token: string }[];
  safeTerminals(items: unknown): { token: string; label: string; hint: string }[];
  filterContainers(items: { name: string; state?: string }[], query: string): { name: string }[];
  safeContainers(items: unknown): { name: string; state: string }[];
  bypassView(
    push: unknown,
    previous: unknown,
    userOff: boolean,
    now: number,
  ): {
    checked: boolean;
    state: string;
    text: string;
    badge: { word: string; time: string } | null;
    until: string | null;
  };
}

interface MonitorRow {
  id: number;
  toolUseId: string;
  container: string;
  command: string;
  output: string;
  truncated: boolean;
  pending: boolean;
  status: string;
  tone: string;
}
// Le paquet est « type: module » : ui.js est évalué comme script sans `module`, il se publie donc sur globalThis (comme dans la webview).
createRequire(import.meta.url)("../media/ui.js");
const ui = (globalThis as unknown as { WarbandUI: UiApi }).WarbandUI;

const opts = (...disabled: boolean[]) => disabled.map((d) => ({ disabled: d }));

describe("listboxKey : navigation clavier", () => {
  it("flèches : saute les options désactivées et boucle", () => {
    const o = opts(false, true, false, false);
    expect(ui.listboxKey({ active: 0 }, "ArrowDown", o).active).toBe(2);
    expect(ui.listboxKey({ active: 3 }, "ArrowDown", o).active).toBe(0);
    expect(ui.listboxKey({ active: 0 }, "ArrowUp", o).active).toBe(3);
    expect(ui.listboxKey({ active: 2 }, "ArrowUp", o).active).toBe(0);
  });
  it("depuis « aucune » : bas = première, haut = dernière activable", () => {
    const o = opts(true, false, false, true);
    expect(ui.listboxKey({ active: -1 }, "ArrowDown", o).active).toBe(1);
    expect(ui.listboxKey({ active: -1 }, "ArrowUp", o).active).toBe(2);
  });
  it("Début / Fin ignorent les désactivées", () => {
    const o = opts(true, false, false, true);
    expect(ui.listboxKey({ active: 2 }, "Home", o).active).toBe(1);
    expect(ui.listboxKey({ active: 1 }, "End", o).active).toBe(2);
  });
  it("liste vide ou entièrement désactivée : aucune option active", () => {
    expect(ui.listboxKey({ active: 0 }, "ArrowDown", []).active).toBe(-1);
    expect(ui.listboxKey({ active: 1 }, "End", opts(true, true)).active).toBe(-1);
  });
  it("autre touche : état conservé ; actif devenu désactivé : ramené à aucun", () => {
    expect(ui.listboxKey({ active: 1 }, "a", opts(false, false)).active).toBe(1);
    expect(ui.listboxKey({ active: 1 }, "a", opts(false, true)).active).toBe(-1);
  });
});

describe("filterModels", () => {
  const models = [
    { value: "modele-a", label: "Modèle A", description: "Rapide" },
    { value: "autre", label: "Autre", description: "Pensif .*(" },
    { value: null, label: "Défaut", description: "" },
  ];
  it("sous-chaîne insensible à la casse sur libellé, valeur et description", () => {
    expect(ui.filterModels(models, "MODÈLE").map((m) => m.label)).toEqual(["Modèle A"]);
    expect(ui.filterModels(models, "autre").map((m) => m.label)).toEqual(["Autre"]);
    expect(ui.filterModels(models, "rapide")).toHaveLength(1);
    expect(ui.filterModels(models, "  ")).toHaveLength(3);
  });
  it("jamais de RegExp : « .*( » est littéral", () => {
    expect(ui.filterModels(models, ".*(").map((m) => m.label)).toEqual(["Autre"]);
    expect(ui.filterModels(models, "(")).toHaveLength(1);
    expect(ui.filterModels(models, "[")).toHaveLength(0);
  });
});

describe("placePopover", () => {
  const vp = { width: 800, height: 600 };
  it("au-dessus de l'ancre par défaut", () => {
    const p = ui.placePopover(
      { left: 100, top: 500, bottom: 528 },
      { width: 300, height: 200 },
      vp,
    );
    expect(p.side).toBe("above");
    expect(p.y + 200).toBeLessThanOrEqual(500);
    expect(p.x).toBe(100);
  });
  it("bascule dessous si la place manque au-dessus", () => {
    const p = ui.placePopover({ left: 10, top: 40, bottom: 68 }, { width: 300, height: 200 }, vp);
    expect(p.side).toBe("below");
    expect(p.y).toBeGreaterThanOrEqual(68);
  });
  it("recale aux deux bords horizontaux", () => {
    const right = ui.placePopover(
      { left: 700, top: 500, bottom: 528 },
      { width: 300, height: 100 },
      vp,
    );
    expect(right.x + 300).toBeLessThanOrEqual(792);
    const left = ui.placePopover(
      { left: -50, top: 500, bottom: 528 },
      { width: 300, height: 100 },
      vp,
    );
    expect(left.x).toBe(8);
  });
  it("viewport de 280 px plus étroit que le popover : largeur réduite, jamais hors écran", () => {
    const p = ui.placePopover(
      { left: 200, top: 400, bottom: 428 },
      { width: 560, height: 300 },
      { width: 280, height: 500 },
    );
    expect(p.width).toBe(264);
    expect(p.x).toBe(8);
    expect(p.x + p.width).toBeLessThanOrEqual(272);
  });
  it("trop haut des deux côtés : côté le plus spacieux, hauteur plafonnée", () => {
    const p = ui.placePopover(
      { left: 8, top: 300, bottom: 328 },
      { width: 300, height: 900 },
      { width: 400, height: 600 },
    );
    expect(p.maxHeight).toBeLessThan(900);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y + Math.min(900, p.maxHeight)).toBeLessThanOrEqual(592);
  });
});

describe("autres utilitaires", () => {
  it("effortPct", () => {
    expect(ui.effortPct(0, 6)).toBe(0);
    expect(ui.effortPct(5, 6)).toBe(100);
    expect(ui.effortPct(1, 6)).toBe(20);
    expect(ui.effortPct(3, 1)).toBe(0);
  });
  it("tabTarget cycle dans les deux sens", () => {
    expect(ui.tabTarget(3, 2, false)).toBe(0);
    expect(ui.tabTarget(3, 0, true)).toBe(2);
    expect(ui.tabTarget(3, -1, false)).toBe(0);
    expect(ui.tabTarget(3, -1, true)).toBe(2);
    expect(ui.tabTarget(0, 0, false)).toBe(-1);
  });
});

describe("états -> classes de body", () => {
  const idle = { busy: false, approvals: [], readonly: null, items: [] };
  const env = { hidden: false, reducedMotion: false };
  it("repos : aucune classe", () => expect(ui.bodyClasses(idle, env)).toEqual([]));
  it("run actif", () => expect(ui.bodyClasses({ ...idle, busy: true }, env)).toEqual(["running"]));
  it("approbation en attente : figé", () => {
    const v = { ...idle, busy: true, approvals: [{}] };
    expect(ui.bodyClasses(v, env)).toEqual(["running", "waiting"]);
  });
  it("vue cachée et mouvement réduit s'ajoutent", () => {
    expect(ui.bodyClasses({ ...idle, busy: true }, { hidden: true, reducedMotion: true })).toEqual([
      "running",
      "paused",
      "reduce-motion",
    ]);
  });
  it("lecture seule : jamais running", () => {
    expect(ui.bodyClasses({ ...idle, busy: true, readonly: { title: "x" } }, env)).toEqual([
      "readonly",
    ]);
  });
});

describe("libellé du thinking", () => {
  const base = { busy: true, approvals: [], items: [] as unknown[] };
  it("repos : vide", () => expect(ui.activityLabel({ ...base, busy: false })).toBe(""));
  it("réflexion par défaut", () => expect(ui.activityLabel(base)).toBe("Réflexion"));
  it("dernier outil en attente", () => {
    const items = [
      { kind: "tool", status: "pending", label: "Lecture" },
      { kind: "tool", status: "ok", label: "Glob" },
      { kind: "tool", status: "pending", label: "Commande" },
    ];
    expect(ui.activityLabel({ ...base, items })).toBe("Outil : Commande");
  });
  it("approbation en attente : prioritaire", () => {
    expect(ui.activityLabel({ ...base, approvals: [{}] })).toBe("En attente de votre accord");
  });
});

describe("historique et outil Exegol", () => {
  it("EXEC_TOOL = constante du cœur", () => {
    expect(ui.EXEC_TOOL).toBe(EXEGOL_EXEC_TOOL);
  });
  it("badge d'historique : « en cours » seulement pour la courante qui tourne", () => {
    expect(ui.historyBadge({ current: true }, true)).toBe("en cours");
    expect(ui.historyBadge({ current: true }, false)).toBe("actuelle");
    expect(ui.historyBadge({ current: false }, true)).toBeNull();
    expect(ui.historyBadge({ current: false }, false)).toBeNull();
  });
});

describe("monitorRows (lot P4) : lecture seule, une ligne par appel Exegol", () => {
  const exec = (
    id: number,
    toolUseId: string,
    argv: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    kind: "tool",
    toolUseId,
    tool: EXEGOL_EXEC_TOOL,
    label: "Exegol",
    summary: "",
    input: JSON.stringify({ container: "web", argv }),
    status: "pending",
    ...extra,
  });

  it("ne garde que les appels d'exec Exegol", () => {
    const rows = ui.monitorRows({
      items: [
        { id: 1, kind: "tool", tool: "Bash", toolUseId: "b", input: "ls", status: "ok" },
        { id: 2, kind: "agent", text: "bonjour" },
        { id: 3, kind: "notice", level: "info", text: "x" },
        exec(4, "e", ["nmap", "-sV", "10.0.0.1"]),
      ],
      approvals: [],
    });
    expect(rows.map((r) => r.id)).toEqual([4]);
  });

  it("garde un outil préfixé mcp__kali__ et lit le conteneur dans le JSON", () => {
    const input = JSON.stringify({ container: "kali-box", target: "10.0.0.1", ports: "80" });
    const rows = ui.monitorRows({
      items: [
        { id: 1, kind: "tool", tool: "Bash", toolUseId: "b", input: "ls", status: "ok" },
        { id: 2, kind: "tool", tool: "mcp__kalix__nmap_scan", toolUseId: "x", input, status: "ok" },
        {
          id: 3,
          kind: "tool",
          tool: "mcp__kali__nmap_scan",
          toolUseId: "k",
          input,
          status: "pending",
        },
        {
          id: 4,
          kind: "tool",
          tool: "mcp__kali__execute_command",
          toolUseId: "e",
          input: "id",
          status: "pending",
        },
      ],
      approvals: [],
    });
    expect(rows.map((r) => r.id)).toEqual([3, 4]);
    expect(rows[0]?.container).toBe("kali-box");
    expect(rows[0]?.command).toBe(JSON.stringify({ target: "10.0.0.1", ports: "80" }));
    expect(rows[1]?.container).toBe("");
    expect(rows[1]?.command).toBe("id");
  });

  it("commande et conteneur ; argument avec espace ou vide entre guillemets", () => {
    const [row] = ui.monitorRows({
      items: [exec(1, "e", ["echo", "deux mots", ""])],
      approvals: [],
    });
    expect(row?.container).toBe("web");
    expect(row?.command).toBe('echo "deux mots" ""');
  });

  it("entrée non JSON (tronquée) : affichée telle quelle, conteneur vide", () => {
    const [row] = ui.monitorRows({
      items: [exec(1, "e", ["x"], { input: '{"container":"we' })],
      approvals: [],
    });
    expect(row?.container).toBe("");
    expect(row?.command).toBe('{"container":"we');
  });

  it("statut : en attente, approuvé, refusé, erreur, d'après ce que porte la vue", () => {
    const rows = ui.monitorRows({
      items: [
        exec(1, "attente", ["a"]),
        exec(2, "lance", ["b"], { decision: "allow" }),
        exec(3, "fini", ["c"], { status: "ok", decision: "allow" }),
        exec(4, "refuse", ["d"], { status: "denied", decision: "deny" }),
        exec(5, "casse", ["e"], { status: "error", decision: "allow" }),
      ],
      approvals: [{ toolUseId: "attente" }],
    });
    expect(rows.map((r) => [r.status, r.tone])).toEqual([
      ["en attente", "wait"],
      ["approuvé", "ok"],
      ["approuvé", "ok"],
      ["refusé", "err"],
      ["erreur", "err"],
    ]);
  });

  it("autorisation en attente : ligne signalée (renvoi au chat), sans autre décision", () => {
    const rows = ui.monitorRows({
      items: [exec(1, "p", ["a"]), exec(2, "q", ["b"], { status: "ok", decision: "allow" })],
      approvals: [{ toolUseId: "p" }],
    });
    expect(rows.map((r) => r.pending)).toEqual([true, false]);
  });

  it("sortie et troncature reprises telles que la vue les porte ; aucune durée ni volumétrie", () => {
    const [row] = ui.monitorRows({
      items: [exec(1, "e", ["a"], { status: "ok", output: "ligne", truncated: true })],
      approvals: [],
    });
    expect(row?.output).toBe("ligne");
    expect(row?.truncated).toBe(true);
    for (const key of ["duration", "durationMs", "bytes", "lines", "requests"]) {
      expect(Object.keys(row ?? {})).not.toContain(key);
    }
  });

  it("plafond : les 200 appels les plus récents", () => {
    const items = Array.from({ length: 250 }, (_, i) => exec(i + 1, `t${i}`, [`c${i}`]));
    const rows = ui.monitorRows({ items, approvals: [] });
    expect(rows).toHaveLength(200);
    expect(rows[0]?.id).toBe(51);
    expect(rows.at(-1)?.id).toBe(250);
  });

  it("vue absente ou incomplète : aucune ligne, sans erreur", () => {
    expect(ui.monitorRows(null)).toEqual([]);
    expect(ui.monitorRows({})).toEqual([]);
    expect(ui.monitorRows({ items: "x", approvals: 3 })).toEqual([]);
  });
});

describe("bypassView (lot B1, ADR 0006) : cinq états, échec fermé, pas de minuteur", () => {
  const NOW = Date.UTC(2026, 9, 16, 9, 0, 0);
  const off = { type: "bypass", on: false, armed: false, expiresAt: null };
  const armed = { type: "bypass", on: false, armed: true, expiresAt: null };
  const on = (ms: number) => ({ type: "bypass", on: true, armed: false, expiresAt: NOW + ms });
  const hm = (t: number) =>
    new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  it("off : aucun texte, aucun badge", () => {
    const v = ui.bypassView(off, null, false, NOW);
    expect(v).toEqual({ checked: false, state: "off", text: "", badge: null, until: null });
  });
  it("armé : texte unique, interrupteur coché, pas de badge", () => {
    const v = ui.bypassView(armed, off, false, NOW);
    expect(v.state).toBe("pending");
    expect(v.checked).toBe(true);
    expect(v.text).toBe("En attente : actif dès que l'agent le confirme.");
    expect(v.badge).toBeNull();
  });
  it("actif : heure absolue, reste arrondi à la minute supérieure, badge", () => {
    const v = ui.bypassView(on(118 * 60_000), armed, false, NOW);
    expect(v.state).toBe("on");
    expect(v.checked).toBe(true);
    expect(v.until).toBe(hm(NOW + 118 * 60_000));
    expect(v.text).toBe(`Actif jusqu'à ${hm(NOW + 118 * 60_000)} (reste 1 h 58).`);
    expect(v.badge).toEqual({ word: "BYPASS", time: hm(NOW + 118 * 60_000) });
  });
  it("reste : une milliseconde au-delà de la minute compte pour la minute suivante", () => {
    const v = ui.bypassView(on(118 * 60_000 + 1), off, false, NOW);
    expect(v.text).toContain("(reste 1 h 59).");
  });
  it("reste recalculé à chaque appel, sans état : même message, autre « now »", () => {
    const push = on(60 * 60_000);
    expect(ui.bypassView(push, null, false, NOW).text).toContain("(reste 1 h 00).");
    expect(ui.bypassView(push, null, false, NOW + 30 * 60_000).text).toContain("(reste 30 min).");
  });
  it("retombée depuis « armé » sans demande : « dropped »", () => {
    const v = ui.bypassView(off, armed, false, NOW);
    expect(v).toEqual({
      checked: false,
      state: "dropped",
      text: "Bypass désactivé avant confirmation.",
      badge: null,
      until: null,
    });
  });
  it("retombée depuis « actif » sans demande : « ended »", () => {
    const v = ui.bypassView(off, on(60_000), false, NOW);
    expect(v.state).toBe("ended");
    expect(v.text).toBe("Bypass terminé.");
    expect(v.checked).toBe(false);
    expect(v.badge).toBeNull();
  });
  it("arrêt demandé par l'utilisateur ou reset : pas d'avis de retombée", () => {
    expect(ui.bypassView(off, armed, true, NOW)).toMatchObject({ state: "off", text: "" });
    expect(ui.bypassView(off, on(60_000), true, NOW)).toMatchObject({ state: "off", text: "" });
  });
  it("on:true sans expiresAt fini = « off » (échec fermé), y compris après un message valide", () => {
    for (const bad of [
      { type: "bypass", on: true, armed: false },
      { type: "bypass", on: true, armed: false, expiresAt: null },
      { type: "bypass", on: true, armed: false, expiresAt: Number.NaN },
      { type: "bypass", on: true, armed: false, expiresAt: "2026-10-16" },
      { type: "bypass", on: true, armed: true, expiresAt: Number.POSITIVE_INFINITY },
    ]) {
      expect(ui.bypassView(bad, null, false, NOW)).toMatchObject({ state: "off", checked: false });
    }
    // Un message mal formé qui succède à « actif » compte comme une retombée.
    expect(ui.bypassView({ ...on(60_000), expiresAt: null }, on(60_000), false, NOW).state).toBe(
      "ended",
    );
  });
  it("message mal formé (champ manquant, type ou valeur fausse) = « off »", () => {
    for (const bad of [
      null,
      undefined,
      "bypass",
      {},
      { type: "other", on: false, armed: false, expiresAt: null },
      { type: "bypass", on: "oui", armed: false, expiresAt: null },
      { type: "bypass", on: false, expiresAt: null },
      { type: "bypass", on: false, armed: 1, expiresAt: null },
    ]) {
      expect(ui.bypassView(bad, null, false, NOW), JSON.stringify(bad)).toMatchObject({
        state: "off",
        checked: false,
        text: "",
      });
    }
  });
  it("rappel des consignes : haut sur la première ligne, bas sur la dernière, brouillon conservé", () => {
    const entries = ["un", "deux"];
    const up = ui.inputRecall({ index: -1, draft: "", entries, current: "brouillon" }, "up", {
      line: 0,
      lines: 2,
    });
    expect(up).toEqual({ index: 0, draft: "brouillon", value: "deux" });
    const older = ui.inputRecall(
      { index: up?.index ?? -1, draft: up?.draft ?? "", entries, current: up?.value ?? "" },
      "up",
      { line: 0, lines: 1 },
    );
    expect(older).toEqual({ index: 1, draft: "brouillon", value: "un" });
    const stuck = ui.inputRecall({ index: 1, draft: "brouillon", entries, current: "un" }, "up", {
      line: 0,
      lines: 1,
    });
    expect(stuck).toEqual({ index: 1, draft: "brouillon", value: "un" });
    const mid = ui.inputRecall({ index: -1, draft: "", entries, current: "a\nb" }, "up", {
      line: 1,
      lines: 2,
    });
    expect(mid).toBeNull();
    const back = ui.inputRecall(
      { index: 0, draft: "brouillon", entries, current: "deux" },
      "down",
      { line: 0, lines: 1 },
    );
    expect(back).toEqual({ index: -1, draft: "brouillon", value: "brouillon" });
    const stay = ui.inputRecall(
      { index: -1, draft: "brouillon", entries, current: "brouillon" },
      "down",
      { line: 0, lines: 1 },
    );
    expect(stay).toBeNull();
  });
  it("menu @ : span au curseur, filtre, noms refusés écartés", () => {
    expect(ui.mentionSpan("nmap @ht", 8)).toEqual({ query: "ht", start: 5 });
    expect(ui.mentionSpan("nmap @htb1 suite", 16)).toBeNull();
    expect(ui.mentionSpan("a @", 3)).toEqual({ query: "", start: 2 });
    expect(ui.hashSpan("vois #ht", 8)).toEqual({ query: "ht", start: 5 });
    expect(ui.hashSpan("vois #htb1 suite", 16)).toBeNull();
    expect(ui.hashSpan("nmap @htb1", 10)).toBeNull();
    expect(
      ui.filterTerminals([{ token: "htb1" }, { token: "lab" }], "ht").map((it) => it.token),
    ).toEqual(["htb1"]);
    const sessions = [
      { token: "htb1", label: "htb1", hint: "nmap -sV 10.10.10.1" },
      { token: "htb1-2", label: "htb1", hint: "curl -I http://10.10.10.1" },
    ];
    expect(ui.filterTerminals(sessions, "htb").map((it) => it.token)).toEqual(["htb1", "htb1-2"]);
    expect(ui.safeTerminals([{ token: "htb1" }, { token: "../x" }, { name: "lab" }])).toEqual([
      { token: "htb1", label: "htb1", hint: "" },
    ]);
    const items = [
      { name: "htb1", state: "running" },
      { name: "lab", state: "stopped" },
    ];
    expect(ui.filterContainers(items, "ht").map((it) => it.name)).toEqual(["htb1"]);
    expect(ui.filterContainers(items, "").map((it) => it.name)).toEqual(["htb1", "lab"]);
    expect(
      ui.safeContainers([
        { name: "htb1", state: "running" },
        { name: "../x", state: "running" },
        { name: "lab", state: "nope" },
        { name: "ok", state: "stopped", extra: 1 },
      ]),
    ).toEqual([
      { name: "htb1", state: "running" },
      { name: "ok", state: "stopped" },
    ]);
  });
  it("syncRecallEntries garde l'écho en attente et remplace si la conversation change", () => {
    expect(ui.syncRecallEntries(["a"], [])).toEqual([]);
    expect(ui.syncRecallEntries(["a"], ["a"])).toEqual(["a"]);
    expect(ui.syncRecallEntries(["a", "b"], ["a"])).toEqual(["a", "b"]);
    expect(ui.syncRecallEntries(["a"], ["b"])).toEqual(["b"]);
    expect(ui.syncRecallEntries(["a"], ["a", "c"])).toEqual(["a", "c"]);
  });
  it("aucun minuteur ni horloge implicite : le temps vient de l'argument now", () => {
    const src = readFileSync(fileURLToPath(new URL("../media/ui.js", import.meta.url)), "utf8");
    const body = src.slice(src.indexOf("function bypassEffective"), src.indexOf("const api = {"));
    expect(body).not.toMatch(/Date\.now|setInterval|setTimeout|requestAnimationFrame/);
  });
});
