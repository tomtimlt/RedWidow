import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const term = await load("../web/lib/term.js");
const lists = await load("../web/lib/lists.js");
const types = await load("../web/wm/types.js");
const layouts = await load("../web/wm/layouts.js");
const vendor = await load("../scripts/vendor-xterm.mjs");

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

describe("terminal : saisie bornée", () => {
  it("une saisie courte reste en un morceau", () => {
    expect(term.chunkInput("ls -la\r").chunks).toEqual(["ls -la\r"]);
    expect(term.chunkInput("").chunks).toEqual([]);
  });

  it("découpe à 64 Kio d'octets UTF-8 sans couper un caractère", () => {
    const data = "é".repeat(100_000); // 200 000 octets
    const { chunks } = term.chunkInput(data);
    expect(chunks.length).toBe(4);
    for (const c of chunks) expect(term.utf8Size(c)).toBeLessThanOrEqual(term.MAX_INPUT_BYTES);
    expect(chunks.join("")).toBe(data);
    // Paires de substitution (4 octets) : jamais séparées.
    const emoji = "𝄞".repeat(40_000);
    const out = term.chunkInput(emoji).chunks;
    expect(out.join("")).toBe(emoji);
    for (const c of out) expect(term.utf8Size(c)).toBeLessThanOrEqual(term.MAX_INPUT_BYTES);
  });

  it("refuse un collage de plus de 1 Mio", () => {
    const res = term.chunkInput("a".repeat(term.MAX_PASTE_BYTES + 1));
    expect(res.refused).toBe(true);
    expect(res.chunks).toEqual([]);
  });

  it("taille : entiers dans les bornes du serveur", () => {
    expect(term.clampSize(80.7, 24.2)).toEqual({ cols: 80, rows: 24 });
    expect(term.clampSize(9999, 9999)).toEqual({ cols: term.MAX_COLS, rows: term.MAX_ROWS });
    expect(term.clampSize(0, -3)).toEqual({ cols: 1, rows: 1 });
    expect(term.clampSize(Number.NaN, 24)).toBeNull();
  });

  it("messages du serveur : forme exacte ou ignorés", () => {
    expect(term.parseTermEvent({ type: "output", data: "x" })).toEqual({
      type: "output",
      data: "x",
    });
    expect(term.parseTermEvent({ type: "output", data: 3 })).toBeNull();
    expect(term.parseTermEvent({ type: "exit", code: 2 })).toEqual({ type: "exit", code: 2 });
    expect(term.parseTermEvent({ type: "exit" })).toEqual({ type: "exit", code: null });
    expect(term.parseTermEvent({ type: "error", code: "terminal.limit" })).toEqual({
      type: "error",
      code: "terminal.limit",
    });
    expect(term.parseTermEvent({ type: "autre" })).toBeNull();
    expect(term.parseTermEvent(null)).toBeNull();
  });

  it("chaque code d'erreur du serveur a un libellé français", () => {
    for (const code of [
      "docker.unavailable",
      "terminal.invalidContainer",
      "terminal.notManaged",
      "terminal.notRunning",
      "terminal.limit",
      "terminal.inputTooLarge",
      "terminal.failed",
    ]) {
      expect(term.termReason(code)).not.toMatch(/^terminal\./);
      expect(term.termReason(code).length).toBeGreaterThan(10);
    }
  });
});

function makeSession(online = true) {
  const sent: Record<string, unknown>[] = [];
  const out: string[] = [];
  const states: string[] = [];
  const notes: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let replays = 0;
  let up = online;
  const session = term.createTermSession({
    send: (m: Record<string, unknown>) => {
      if (!up) return false;
      sent.push(m);
      return true;
    },
    onOutput: (d: string) => out.push(d),
    onReplay: () => {
      replays += 1;
    },
    onState: (s: string) => states.push(s),
    onNotice: (t: string) => notes.push(t),
    setTimer: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  return {
    session,
    sent,
    out,
    states,
    notes,
    timers,
    replays: () => replays,
    setUp: (v: boolean) => {
      up = v;
    },
  };
}

describe("terminal : session", () => {
  it("ouvre avec la taille mesurée, puis passe en direct à `opened`", () => {
    const t = makeSession();
    expect(t.session.open("kali-1", 100, 30)).toBe(true);
    expect(t.sent[0]).toEqual({ type: "open", container: "kali-1", cols: 100, rows: 30 });
    expect(t.session.state()).toBe("connecting");
    t.session.handle({ type: "opened", container: "kali-1" });
    expect(t.session.state()).toBe("live");
    t.session.handle({ type: "output", data: "hello" });
    expect(t.out).toEqual(["hello"]);
  });

  it("hors ligne : l'ouverture échoue sans rien mettre en file", () => {
    const t = makeSession(false);
    expect(t.session.open("kali-1", 80, 24)).toBe(false);
    expect(t.session.state()).toBe("failed");
    expect(t.sent).toEqual([]);
  });

  it("`resize` n'est émis qu'au changement de taille", () => {
    const t = makeSession();
    t.session.open("k", 80, 24);
    t.session.handle({ type: "opened", container: "k" });
    expect(t.session.resize(80, 24)).toBe(false);
    expect(t.session.resize(120, 40)).toBe(true);
    expect(t.session.resize(120, 40)).toBe(false);
    expect(t.sent.at(-1)).toEqual({ type: "resize", cols: 120, rows: 40 });
    expect(t.session.resize(Number.NaN, 5)).toBe(false);
  });

  it("`input` : découpé en messages de 64 Kio au plus, refusé au-delà de 1 Mio", () => {
    const t = makeSession();
    t.session.open("k", 80, 24);
    t.session.handle({ type: "opened", container: "k" });
    t.sent.length = 0;
    expect(t.session.input("é".repeat(100_000))).toBe(true);
    expect(t.sent.length).toBe(4);
    for (const m of t.sent) {
      expect(m.type).toBe("input");
      expect(Buffer.byteLength(m.data as string)).toBeLessThanOrEqual(64 * 1024);
    }
    t.sent.length = 0;
    expect(t.session.input("a".repeat(2 * 1024 * 1024))).toBe(false);
    expect(t.sent).toEqual([]);
    expect(t.notes.length).toBe(1);
  });

  it("aucune saisie n'est envoyée hors de l'état « direct »", () => {
    const t = makeSession();
    expect(t.session.input("x")).toBe(false);
    t.session.open("k", 80, 24);
    expect(t.session.input("x")).toBe(false);
    expect(t.sent.filter((m) => m.type === "input")).toEqual([]);
  });

  it("`close` envoie un seul message à une session active, aucun sinon", () => {
    const t = makeSession();
    t.session.close();
    expect(t.sent).toEqual([]);
    t.session.open("k", 80, 24);
    t.session.handle({ type: "opened", container: "k" });
    t.session.close();
    expect(t.sent.filter((m) => m.type === "close")).toHaveLength(1);
    expect(t.session.active()).toBe(false);
  });

  it("fin du shell : état `ended` avec le code, plus active", () => {
    const t = makeSession();
    t.session.open("k", 80, 24);
    t.session.handle({ type: "opened", container: "k" });
    t.session.handle({ type: "exit", code: 130 });
    expect(t.session.state()).toBe("ended");
    expect(t.session.info().code).toBe(130);
    expect(t.session.active()).toBe(false);
  });

  it("erreur à l'ouverture : `failed` avec le code ; en direct : `lost`", () => {
    const a = makeSession();
    a.session.open("k", 80, 24);
    a.session.handle({ type: "error", code: "terminal.notRunning" });
    expect(a.session.state()).toBe("failed");
    expect(a.session.info().reason).toBe("terminal.notRunning");

    const b = makeSession();
    b.session.open("k", 80, 24);
    b.session.handle({ type: "opened", container: "k" });
    b.session.handle({ type: "error", code: "terminal.failed" });
    expect(b.session.state()).toBe("lost");

    // Saisie trop grosse : non bloquant, la session continue.
    const c = makeSession();
    c.session.open("k", 80, 24);
    c.session.handle({ type: "opened", container: "k" });
    c.session.handle({ type: "error", code: "terminal.inputTooLarge" });
    expect(c.session.state()).toBe("live");
    expect(c.notes.length).toBe(1);
  });

  it("reconnexion : `ready`, la sortie conservée est rejouée sur un écran vidé", () => {
    const t = makeSession();
    t.session.open("k", 80, 24);
    t.session.handle({ type: "opened", container: "k" });
    t.session.reconnect();
    expect(t.sent.at(-1)).toEqual({ type: "ready" });
    expect(t.session.state()).toBe("resuming");
    t.session.handle({ type: "opened", container: "k" });
    expect(t.replays()).toBe(1);
    expect(t.session.state()).toBe("live");
  });

  it("reconnexion sans `opened` : « session perdue » après le délai", () => {
    const t = makeSession();
    t.session.open("k", 80, 24);
    t.session.handle({ type: "opened", container: "k" });
    t.session.reconnect();
    expect(t.timers.at(-1)?.ms).toBe(term.RESUME_TIMEOUT_MS);
    t.timers.at(-1)?.fn();
    expect(t.session.state()).toBe("lost");
  });

  it("reconnexion : rien à faire pour une session inactive", () => {
    const t = makeSession();
    t.session.reconnect();
    expect(t.sent).toEqual([]);
    t.session.open("k", 80, 24);
    t.session.handle({ type: "opened", container: "k" });
    t.session.handle({ type: "exit", code: 0 });
    t.session.reconnect();
    expect(t.sent.filter((m) => m.type === "ready")).toEqual([]);
  });
});

describe("terminal : fenêtres et espaces", () => {
  it("identifiant de session conforme au motif des cadres", () => {
    expect(types.newTerminalId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(types.newTerminalId()).not.toBe(types.newTerminalId());
  });

  it("spécification : clé par session, type `terminal`", () => {
    const spec = types.terminalSpec("t-abc");
    expect(spec).toMatchObject({
      key: "term:t-abc",
      type: "terminal",
      kind: "native",
      frame: "t-abc",
    });
    expect(types.terminalSpec("../x")).toBeNull();
    expect(types.nativeSpec("terminal")).toBeNull();
  });

  it("l'espace de travail enregistre un terminal en vue `term` et le restaure vide", () => {
    const spec = types.terminalSpec("t-abc");
    const saved = layouts.serialize([
      {
        key: spec.key,
        spec,
        rect: { x: 0, y: 0, w: 0.5, h: 1 },
        maximized: false,
        minimized: false,
      },
    ]);
    expect(saved.windows).toEqual([{ id: "t-abc", view: "term", x: 0, y: 0, w: 0.5, h: 1 }]);
    expect(layouts.validateLayout(saved)).not.toBeNull();
    const plan = layouts.planApply(saved, [], () => false);
    expect(plan.windows[0].spec.key).toBe("term:t-abc");
  });

  it("un terminal actif est minimisé, jamais fermé, par un espace de travail", () => {
    const spec = types.terminalSpec("t-abc");
    const layout = { windows: [], spaces: [{ id: "main", name: "Vide" }] };
    const plan = layouts.planApply(
      layout,
      [spec.key, "native:journal"],
      (k: string) => k === spec.key,
    );
    expect(plan.minimize).toEqual([spec.key]);
    expect(plan.close).toEqual(["native:journal"]);
  });
});

describe("listes du serveur", () => {
  it("missions : entrées illisibles écartées, états bornés", () => {
    const items = lists.parseMissions({
      items: [
        {
          id: "m1",
          title: "Recon\u0000 acme",
          project: "p1",
          updatedAt: "2026-01-01T00:00:00Z",
          live: true,
          state: "running",
        },
        { id: "../x", title: "mauvais" },
        { id: "m2", title: "x", state: "inconnu" },
        null,
      ],
    });
    expect(items.map((m: { id: string }) => m.id)).toEqual(["m1", "m2"]);
    expect(items[0].title).toBe("Recon  acme");
    expect(items[1].state).toBe("idle");
  });

  it("runs, projets et audit", () => {
    expect(
      lists.parseRuns({
        items: [{ id: "r1", kind: "terminal", project: null, startedAt: "x", size: 12 }],
      })[0],
    ).toMatchObject({ kind: "terminal", size: 12 });
    expect(lists.parseRuns({ items: [{ id: "r1", kind: "bizarre", size: -3 }] })[0]).toMatchObject({
      kind: "mission",
      size: 0,
    });
    expect(
      lists.parseProjects({
        items: [
          { id: "p1", name: "Acme" },
          { id: "", name: "x" },
        ],
      }),
    ).toEqual([{ id: "p1", name: "Acme" }]);
    const audit = lists.parseAudit({
      items: [{ at: "2026-01-01", kind: "terminal.open", frame: "t-1", obj: { a: 1 } }],
    });
    expect(audit[0]).toEqual({ at: "2026-01-01", kind: "terminal.open", detail: "frame=t-1" });
  });

  it("pastille du dock : seulement en cours ou en attente", () => {
    const map = lists.activityMap([
      { id: "a", state: "running" },
      { id: "b", state: "waiting" },
      { id: "c", state: "idle" },
      { id: "d", state: "stopped" },
    ]);
    expect([...map.entries()]).toEqual([
      ["chat:a", "running"],
      ["chat:b", "waiting"],
    ]);
  });

  it("taille lisible", () => {
    expect(lists.formatSize(512)).toBe("512 o");
    expect(lists.formatSize(2048)).toBe("2.0 Kio");
    expect(lists.formatSize(3 * 1024 * 1024)).toBe("3.0 Mio");
  });
});

describe("xterm vendorisé (CSP)", () => {
  const SRC = `a=n.mainDocument.createElement("style"),b=this._document.createElement("style"),c=this._document.createElement("style")`;

  it("le correctif remplace chaque `<style>` créé par script", () => {
    const { code, count } = vendor.patchXterm(SRC);
    expect(count).toBe(3);
    expect(code).not.toContain('createElement("style")');
    expect(code).toContain("__rwStyle(n.mainDocument)");
    expect(code).toContain("adoptedStyleSheets");
  });

  it("l'attribut style écrit par xterm passe par le CSSOM", () => {
    const src = '_addStyle(t,e){t.setAttribute("style",`${t.getAttribute("style")||""}${e};`)}';
    const { code, attrCount } = vendor.patchXterm(src);
    expect(attrCount).toBe(1);
    expect(code).not.toContain('setAttribute("style"');
    expect(code).toContain('t.style.cssText=(t.style.cssText||"")+e+";"');
  });

  it("un nombre inattendu de sites fait échouer la copie (xterm a changé)", () => {
    expect(vendor.patchXterm("rien").attrCount).not.toBe(vendor.EXPECTED_ATTR_SITES);
    expect(vendor.EXPECTED_ATTR_SITES).toBe(1);
    expect(vendor.patchXterm("rien").count).not.toBe(vendor.EXPECTED_STYLE_SITES);
    expect(vendor.EXPECTED_STYLE_SITES).toBe(3);
  });

  it("les fichiers commités correspondent à une copie fraîche (sinon : pnpm vendor:xterm)", () => {
    const dir = path("../web/vendor/");
    const built = vendor.buildVendor();
    for (const [name, content] of Object.entries(built)) {
      expect(existsSync(`${dir}${name}`), name).toBe(true);
      expect(readFileSync(`${dir}${name}`, "utf8") === content, name).toBe(true);
    }
    const shipped = readFileSync(`${dir}xterm.js`, "utf8");
    expect(shipped).toContain("Fichier généré");
    expect(shipped).not.toContain('createElement("style")');
    expect(readFileSync(`${dir}LICENSE-xterm.txt`, "utf8")).toContain("Copyright");
  });
});
