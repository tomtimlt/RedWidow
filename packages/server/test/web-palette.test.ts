import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const pal = await load("../web/lib/palette.js");
const sc = await load("../web/lib/shortcuts.js");
const frames = await load("../web/lib/frames.js");
const types = await load("../web/wm/types.js");

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("palette : recherche floue", () => {
  it("sous-suite, accents et casse ignorés", () => {
    expect(pal.fuzzyMatch("reg", "Réglages")).not.toBeNull();
    expect(pal.fuzzyMatch("rgl", "Réglages")).not.toBeNull();
    expect(pal.fuzzyMatch("zzz", "Réglages")).toBeNull();
    expect(pal.fuzzyMatch("MIS", "mission m1")?.indices).toEqual([0, 1, 2]);
  });

  it("préfixe et début de mot passent devant une sous-suite éparse", () => {
    const items = [
      { title: "Tuiler toutes les fenêtres", group: "Tuiler" },
      { title: "Ouvrir les sessions", group: "Ouvrir" },
      { title: "Ouvrir le studio", group: "Ouvrir" },
    ];
    const r = pal.rank(items, "stu");
    expect(r[0].item.title).toBe("Ouvrir le studio");
    expect(pal.rank(items, "ouv").map((x: { item: { title: string } }) => x.item.title)).toEqual([
      "Ouvrir les sessions",
      "Ouvrir le studio",
    ]);
  });

  it("plusieurs mots : tous doivent correspondre (titre ou mots-clés)", () => {
    const items = [{ title: "Basculer vers « Recon »", group: "Espace", keywords: "disposition" }];
    expect(pal.rank(items, "recon bascul")).toHaveLength(1);
    expect(pal.rank(items, "recon dispo")).toHaveLength(1);
    expect(pal.rank(items, "recon zzz")).toHaveLength(0);
  });

  it("requête vide : ordre d'origine, rien d'écarté", () => {
    const items = [{ title: "b" }, { title: "a" }];
    expect(pal.rank(items, "  ").map((x: { item: { title: string } }) => x.item.title)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("palette : commandes", () => {
  const sent: string[] = [];
  const ctx = (over = {}) => ({
    windows: [
      { key: "chat:m1", title: "Mission m1", minimized: false },
      { key: "native:journal", title: "Journal", minimized: true },
    ],
    activeKey: "chat:m1",
    spaces: [{ name: "Recon" }, { name: "Exploitation" }],
    spaceName: "Recon",
    phone: false,
    known: [{ kind: "mission", id: "m1" }],
    screens: types.NATIVE_SCREENS,
    fixed: [{ kind: "cockpit", id: "main", title: "Cockpit", shortcutText: "Alt J K" }],
    spec: (kind: string, id: string) =>
      kind === "native" ? types.nativeSpec(id) : types.iframeSpec(kind, id),
    actions: {
      open: (s: { key: string }) => sent.push(`open ${s.key}`),
      newMission: () => sent.push("newMission"),
      focus: (k: string) => sent.push(`focus ${k}`),
      tile: (k: string, t: string) => sent.push(`tile ${k} ${t}`),
      tileAll: () => sent.push("tileAll"),
      applySpace: (n: string) => sent.push(`apply ${n}`),
      saveSpace: (n: string) => sent.push(`save ${n}`),
      saveSpaceAs: (n: string) => sent.push(`saveAs ${n}`),
      deleteSpace: (n: string) => sent.push(`delete ${n}`),
      halt: () => sent.push("halt"),
    },
    ...over,
  });

  it("nouvelle mission, cockpit, kill chain et rapport d'une mission ouverte", () => {
    sent.length = 0;
    const withMission = ctx({
      windows: [
        { key: "chat:m-abc123", title: "Mission m-abc123", type: "mission", frame: "m-abc123" },
      ],
    });
    const commands = pal.buildCommands(withMission);
    const byId = (id: string) => commands.find((c: { id: string }) => c.id === id);
    byId("new-mission").run();
    byId("open:cockpit:main").run();
    byId("open:graph:m-abc123").run();
    byId("open:report:m-abc123").run();
    expect(sent).toEqual([
      "newMission",
      "open cockpit:main",
      "open killchain:m-abc123",
      "open viewer:m-abc123",
    ]);
    expect(byId("new-mission").shortcut).toBe("Alt+J N");
    expect(byId("open:cockpit:main").shortcutText).toBe("Alt J K");
  });

  it("couvre : ouvrir, focaliser, espaces, tuiler, arrêt d'urgence", () => {
    const ids = pal.buildCommands(ctx()).map((c: { id: string }) => c.id);
    expect(ids).toContain("open:native:settings");
    expect(ids).toContain("open:cockpit:main");
    expect(ids).toContain("open:mission:m1");
    expect(ids).toContain("open-id:program");
    expect(ids).toContain("focus:chat:m1");
    expect(ids).toContain("space:apply:Recon");
    expect(ids).toContain("space:save");
    expect(ids).toContain("space:delete:Exploitation");
    expect(ids).toContain("tile:left");
    expect(ids).toContain("tile:all");
    expect(ids).toContain("halt");
  });

  it("aucune commande n'émet approbation, Bypass ni révélation de secret", () => {
    const commands = pal.buildCommands(ctx());
    for (const c of commands) {
      expect(c.id).not.toMatch(/approve|bypass|reveal|secret/i);
      expect(c.title).not.toMatch(/approuver|bypass|révéler/i);
    }
    // Exécution de chaque commande (y compris sous-listes et saisies) : seules les actions du contexte
    // sont appelées, et aucune n'est du type approbation.
    for (const c of commands) {
      const result = c.run();
      if (result?.next) for (const sub of result.next.items) sub.run();
      if (result?.prompt) result.prompt.submit("Test");
    }
    expect(sent.length).toBeGreaterThan(5);
    for (const line of sent) expect(line).not.toMatch(/approve|bypass|reveal/i);
    // Le texte source ne contient aucune de ces émissions.
    for (const file of ["../web/lib/palette.js", "../web/lib/shortcuts.js"]) {
      const text = source(file);
      expect(text).not.toMatch(
        /setBypass|accountReveal|["']approve["']|innerHTML|insertAdjacentHTML/,
      );
    }
  });

  it("espaces et tuiles absents au téléphone", () => {
    const ids = pal.buildCommands(ctx({ phone: true })).map((c: { id: string }) => c.id);
    expect(ids.some((id: string) => id.startsWith("space:"))).toBe(false);
    expect(ids.some((id: string) => id.startsWith("tile:"))).toBe(false);
    expect(ids).toContain("halt");
  });

  it("suppression d'un espace : confirmation obligatoire", () => {
    sent.length = 0;
    const del = pal.buildCommands(ctx()).find((c: { id: string }) => c.id === "space:delete:Recon");
    const result = del.run();
    expect(sent).toEqual([]);
    expect(result.next.items.map((i: { id: string }) => i.id)).toEqual(["confirm", "cancel"]);
    result.next.items[1].run();
    expect(sent).toEqual([]);
    result.next.items[0].run();
    expect(sent).toEqual(["delete Recon"]);
  });

  it("ouvrir par identifiant : identifiant invalide refusé", () => {
    sent.length = 0;
    const cmd = pal.buildCommands(ctx()).find((c: { id: string }) => c.id === "open-id:program");
    const { prompt } = cmd.run();
    expect(prompt.submit("../x")).toMatch(/refusé/);
    expect(prompt.submit("a b")).toMatch(/refusé/);
    expect(sent).toEqual([]);
    expect(prompt.submit("p1")).toBeUndefined();
    expect(sent).toEqual(["open program:p1"]);
  });
});

describe("raccourcis", () => {
  const ev = (over: Record<string, unknown>) => ({
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    key: "",
    code: "",
    getModifierState: () => false,
    ...over,
  });

  it("reconnaît la liste fermée, par code (clavier français compris)", () => {
    expect(sc.shortcutOf(ev({ key: "k" }))).toBe("Ctrl+K");
    expect(sc.shortcutOf(ev({ key: "K", shiftKey: true }))).toBe("Ctrl+Shift+K");
    expect(sc.shortcutOf(ev({ altKey: true, code: "ArrowLeft", key: "ArrowLeft" }))).toBe(
      "Ctrl+Alt+ArrowLeft",
    );
    expect(sc.shortcutOf(ev({ altKey: true, code: "Digit3", key: '"' }))).toBe("Ctrl+Alt+3");
    expect(sc.shortcutOf(ev({ altKey: true, code: "Backquote", key: "`" }))).toBe("Ctrl+Alt+`");
    expect(sc.shortcutOf(ev({ altKey: true, code: "KeyT", key: "t" }))).toBe("Ctrl+Alt+T");
    expect(sc.shortcutOf(ev({ altKey: true, code: "KeyA", key: "a" }))).toBe("Ctrl+Alt+A");
  });

  it("ignore le reste : AltGr, Méta, Ctrl+W, Ctrl+Alt+Suppr, sans Ctrl", () => {
    expect(sc.shortcutOf(ev({ key: "w" }))).toBeNull();
    expect(sc.shortcutOf(ev({ ctrlKey: false, key: "k" }))).toBeNull();
    expect(sc.shortcutOf(ev({ metaKey: true, key: "k" }))).toBeNull();
    expect(sc.shortcutOf(ev({ altKey: true, code: "KeyW", key: "w" }))).toBeNull();
    expect(sc.shortcutOf(ev({ altKey: true, code: "Digit0", key: "0" }))).toBeNull();
    expect(
      sc.shortcutOf(ev({ altKey: true, code: "KeyT", key: "t", getModifierState: () => true })),
    ).toBeNull();
    expect(sc.shortcutOf(ev({ altKey: true, shiftKey: true, code: "KeyT" }))).toBeNull();
  });

  it("tout raccourci reconnu est dans la liste relayée par les ponts", () => {
    for (const id of [
      "Ctrl+K",
      "Ctrl+Shift+K",
      "Ctrl+Alt+ArrowUp",
      "Ctrl+Alt+9",
      "Ctrl+Alt+`",
      "Ctrl+Alt+T",
      "Ctrl+Alt+A",
    ]) {
      expect(frames.RELAYED_KEYS).toContain(id);
    }
  });

  it("Alt+J puis N, K, S, T ou F : accord à deux frappes, liste fermée", () => {
    let t = 0;
    const chord = sc.createChord(() => t);
    const key = (code: string, over: Record<string, unknown> = {}) => ({
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      code,
      getModifierState: () => false,
      ...over,
    });
    // Sans Alt+J, les lettres restent à la page.
    expect(chord.feed(key("KeyN"))).toEqual({ id: null, consume: false });
    for (const [code, id] of [
      ["KeyN", "Alt+J N"],
      ["KeyK", "Alt+J K"],
      ["KeyS", "Alt+J S"],
      ["KeyT", "Alt+J T"],
      ["KeyF", "Alt+J F"],
    ] as [string, string][]) {
      expect(chord.feed(key("KeyJ", { altKey: true }))).toEqual({ id: null, consume: true });
      // Les touches de modification seules ne désarment pas.
      expect(chord.feed(key("AltLeft", { altKey: true })).consume).toBe(false);
      expect(chord.feed(key(code))).toEqual({ id, consume: true });
      expect(frames.RELAYED_KEYS).toContain(id);
    }
    // Hors liste, trop tard, Ctrl ou AltGr : rien n'est retenu.
    chord.feed(key("KeyJ", { altKey: true }));
    expect(chord.feed(key("KeyX"))).toEqual({ id: null, consume: false });
    expect(chord.feed(key("KeyN"))).toEqual({ id: null, consume: false });
    chord.feed(key("KeyJ", { altKey: true }));
    t += sc.CHORD_MS + 1;
    expect(chord.feed(key("KeyN"))).toEqual({ id: null, consume: false });
    chord.feed(key("KeyJ", { altKey: true }));
    expect(chord.feed(key("KeyN", { ctrlKey: true })).consume).toBe(false);
    expect(chord.feed(key("KeyN"))).toEqual({ id: null, consume: false });
    expect(chord.feed(key("KeyJ", { altKey: true, getModifierState: () => true })).consume).toBe(
      false,
    );
  });

  it("les accords déclenchent nouvelle mission, cockpit, studio, terminal (jamais d'approbation)", () => {
    const calls: string[] = [];
    const a = {
      palette: () => calls.push("palette"),
      terminalFocused: () => false,
      tile: () => {},
      maximize: () => {},
      lower: () => {},
      space: () => {},
      cycle: () => {},
      terminal: () => calls.push("terminal"),
      approvals: () => calls.push("approvals"),
      newMission: () => calls.push("newMission"),
      cockpit: () => calls.push("cockpit"),
      studio: () => calls.push("studio"),
      files: () => calls.push("files"),
    };
    for (const id of ["Alt+J N", "Alt+J K", "Alt+J S", "Alt+J T", "Alt+J F"]) {
      expect(sc.runShortcut(id, a, "frame")).toBe(true);
    }
    expect(calls).toEqual(["newMission", "cockpit", "studio", "terminal", "files"]);
  });

  const actions = () => {
    const calls: string[] = [];
    let terminal = false;
    const a = {
      palette: () => calls.push("palette"),
      terminalFocused: () => terminal,
      tile: (k: string) => calls.push(`tile ${k}`),
      maximize: () => calls.push("max"),
      lower: () => calls.push("lower"),
      space: (i: number) => calls.push(`space ${i}`),
      cycle: () => calls.push("cycle"),
      terminal: () => calls.push("terminal"),
      approvals: () => calls.push("approvals"),
    };
    return { a, calls, setTerminal: (v: boolean) => (terminal = v) };
  };

  it("Ctrl+K reste au terminal focalisé ; Ctrl+Maj+K ouvre la palette partout", () => {
    const { a, calls, setTerminal } = actions();
    expect(sc.runShortcut("Ctrl+K", a)).toBe(true);
    expect(calls).toEqual(["palette"]);
    setTerminal(true);
    expect(sc.runShortcut("Ctrl+K", a)).toBe(false);
    expect(calls).toEqual(["palette"]);
    expect(sc.runShortcut("Ctrl+Shift+K", a)).toBe(true);
    expect(calls).toEqual(["palette", "palette"]);
  });

  it("chaque raccourci déclenche son action (et seulement elle)", () => {
    const { a, calls } = actions();
    const table: [string, string][] = [
      ["Ctrl+Alt+ArrowLeft", "tile left"],
      ["Ctrl+Alt+ArrowRight", "tile right"],
      ["Ctrl+Alt+ArrowUp", "max"],
      ["Ctrl+Alt+ArrowDown", "lower"],
      ["Ctrl+Alt+1", "space 0"],
      ["Ctrl+Alt+9", "space 8"],
      ["Ctrl+Alt+`", "cycle"],
      ["Ctrl+Alt+T", "terminal"],
      ["Ctrl+Alt+A", "approvals"],
    ];
    for (const [id, expected] of table) {
      calls.length = 0;
      expect(sc.runShortcut(id, a)).toBe(true);
      expect(calls).toEqual([expected]);
    }
    expect(sc.runShortcut("Ctrl+Alt+Q", a)).toBe(false);
  });
});
