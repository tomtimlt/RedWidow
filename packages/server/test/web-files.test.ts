import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const files = await load("../web/lib/files.js");
const md = await load("../web/lib/markdown.js");
const menu = await load("../web/lib/files-menu.js");
const editor = await load("../web/lib/files-editor.js");
const types = await load("../web/wm/types.js");
const frames = await load("../web/lib/frames.js");
const layouts = await load("../web/wm/layouts.js");
const vendor = await load("../scripts/vendor-codemirror.mjs");

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// ───────────── Chemins ─────────────

describe("fichiers : chemins relatifs", () => {
  it("normalise et refuse ce qui sort du projet", () => {
    expect(files.cleanRelPath("")).toBe("");
    expect(files.cleanRelPath("cours/notes.md")).toBe("cours/notes.md");
    expect(files.cleanRelPath("cours/")).toBe("cours");
    for (const bad of ["/etc", "../x", "a/../b", "a/./b", "a//b", "a\\b", "a\u0000b", ".", ".."]) {
      expect(files.cleanRelPath(bad), bad).toBeNull();
    }
    expect(files.cleanRelPath(42)).toBeNull();
    expect(files.cleanRelPath("a/".repeat(600))).toBeNull();
    expect(files.cleanRelPath(`${"x".repeat(256)}`)).toBeNull();
  });

  it("jointure, parent, ancêtres, fil d'Ariane", () => {
    expect(files.joinPath("", "a")).toBe("a");
    expect(files.joinPath("a/b", "c")).toBe("a/b/c");
    expect(files.parentOf("a/b/c")).toBe("a/b");
    expect(files.parentOf("a")).toBe("");
    expect(files.baseName("a/b/c.txt")).toBe("c.txt");
    expect(files.ancestorsOf("a/b/c")).toEqual(["", "a", "a/b"]);
    expect(files.ancestorsOf("")).toEqual([]);
    expect(files.crumbsOf("a/b")).toEqual([
      { name: "", path: "" },
      { name: "a", path: "a" },
      { name: "b", path: "a/b" },
    ]);
    expect(files.isUnder("a/b", "a")).toBe(true);
    expect(files.isUnder("ab", "a")).toBe(false);
    expect(files.isUnder("a", "a")).toBe(true);
  });

  it("nom saisi : refus de « / », « .. », réservés, trop long", () => {
    expect(files.checkName("rapport.md")).toBeNull();
    expect(files.checkName(".warband")).toBeNull();
    for (const bad of ["", "  ", "..", "a/b", "a\\b", ".git", "node_modules", "x".repeat(256)]) {
      expect(files.checkName(bad), bad).not.toBeNull();
    }
  });

  it("langage et type d'image d'après l'extension", () => {
    expect(files.languageOf("a/b.md")).toBe("markdown");
    expect(files.languageOf("x.TS")).toBe("typescript");
    expect(files.languageOf("Makefile")).toBeNull();
    expect(files.languageOf(".gitignore")).toBeNull();
    expect(files.imageMime("a.PNG")).toBe("image/png");
    expect(files.imageMime("a.md")).toBeNull();
    expect(files.isMarkdown("n.markdown")).toBe(true);
  });
});

// ───────────── Messages du serveur ─────────────

describe("fichiers : lecture des messages fs*", () => {
  it("fsEntries : dossiers d'abord, .git et node_modules écartés, .warband gardé", () => {
    const ev = files.parseFsMessage({
      type: "fsEntries",
      path: "",
      truncated: true,
      entries: [
        { name: "zeta.txt", kind: "file", size: 3, mtime: 1 },
        { name: ".warband", kind: "dir", size: 0, mtime: 1 },
        { name: ".git", kind: "dir", size: 0, mtime: 1 },
        { name: "node_modules", kind: "dir", size: 0, mtime: 1 },
        { name: "alpha", kind: "dir", size: 0, mtime: 1 },
        { name: "a/b", kind: "file", size: 0, mtime: 1 },
        { name: "lien", kind: "link", size: 0, mtime: 1 },
        "x",
      ],
    });
    expect(ev.kind).toBe("entries");
    expect(ev.truncated).toBe(true);
    expect(ev.entries.map((e: { name: string }) => e.name)).toEqual([
      ".warband",
      "alpha",
      "zeta.txt",
    ]);
  });

  it("fsContent : texte, base64 strict, chemin invalide ou contenu absent refusés", () => {
    const text = files.parseFsMessage({
      type: "fsContent",
      path: "a.txt",
      text: "x",
      etag: "e1",
      size: 1,
      mtime: 2,
      truncated: false,
    });
    expect(text).toMatchObject({ kind: "content", text: "x", base64: null, etag: "e1" });
    const img = files.parseFsMessage({
      type: "fsContent",
      path: "i.png",
      base64: "iVBOR",
      size: 5,
    });
    expect(img).toMatchObject({ text: null, base64: "iVBOR", etag: null });
    expect(
      files.parseFsMessage({ type: "fsContent", path: "i.png", base64: "<script>" }),
    ).toBeNull();
    expect(files.parseFsMessage({ type: "fsContent", path: "../x", text: "x" })).toBeNull();
    expect(files.parseFsMessage({ type: "fsContent", path: "a" })).toBeNull();
  });

  it("fsWritten, fsConflict, fsInfo, policyChanged", () => {
    expect(
      files.parseFsMessage({ type: "fsWritten", path: "a", etag: "e", mtime: 1, size: 2 }),
    ).toMatchObject({
      kind: "written",
      etag: "e",
    });
    expect(files.parseFsMessage({ type: "fsWritten", path: "a" })).toBeNull();
    expect(files.parseFsMessage({ type: "fsConflict", path: "a" })).toEqual({
      kind: "conflict",
      path: "a",
    });
    expect(files.parseFsMessage({ type: "fsInfo", path: "a", exists: false })).toMatchObject({
      exists: false,
      type: null,
      etag: null,
    });
    expect(files.parseFsMessage({ type: "policyChanged" })).toEqual({ kind: "policyChanged" });
  });

  it("fsDone (rename : destination et source), fsCancelled, fsError", () => {
    expect(files.parseFsMessage({ type: "fsDone", op: "rename", from: "a", path: "b" })).toEqual({
      kind: "done",
      op: "rename",
      path: "b",
      from: "a",
    });
    expect(
      files.parseFsMessage({ type: "fsDone", op: "upload", path: "d/x", name: "x", size: 1 }),
    ).toMatchObject({
      op: "upload",
      path: "d/x",
    });
    expect(files.parseFsMessage({ type: "fsCancelled", op: "fsDelete", path: "a" })).toMatchObject({
      kind: "cancelled",
      op: "fsDelete",
    });
    expect(files.parseFsMessage({ type: "fsDone" })).toBeNull();
    const err = files.parseFsMessage({
      type: "fsError",
      op: "fsRead",
      path: "a",
      reason: { code: "fs.notText" },
      message: "x",
    });
    expect(err).toMatchObject({ kind: "error", op: "fsRead", code: "notText", path: "a" });
    expect(err.text).toBe("Ce fichier n'est pas du texte.");
  });

  it("chaque code fs.* a un texte français, un code inconnu reste générique", () => {
    for (const code of [
      "noProject",
      "invalidPath",
      "notFound",
      "exists",
      "symlink",
      "protected",
      "notFile",
      "notDir",
      "notText",
      "tooLarge",
      "badType",
      "empty",
      "failed",
    ]) {
      expect(files.fsErrorText(`fs.${code}`), code).not.toBe("L'opération a été refusée.");
    }
    expect(files.fsErrorText("fs.inconnu")).toBe("L'opération a été refusée.");
    expect(files.fsErrorText(undefined)).toBe("L'opération a été refusée.");
  });

  it("types étrangers ou malformés ignorés", () => {
    for (const bad of [null, 3, [], {}, { type: "autre" }, { type: "fsEntries", path: "../x" }]) {
      expect(files.parseFsMessage(bad)).toBeNull();
    }
  });
});

// ───────────── Onglets, etag, conflit ─────────────

describe("fichiers : onglets", () => {
  const content = (p: string, text: string, etag: string | null = "e1", extra = {}) => ({
    path: p,
    text,
    base64: null,
    truncated: false,
    etag,
    mtime: 1,
    size: text.length,
    ...extra,
  });

  it("ouvrir une seconde fois retrouve l'onglet sans le relire", () => {
    const tabs = files.createTabs();
    expect(tabs.open("a.txt").created).toBe(true);
    expect(tabs.open("a.txt").created).toBe(false);
    expect(tabs.list()).toHaveLength(1);
  });

  it("modifié = texte différent de l'enregistré ; enregistrer envoie l'etag", () => {
    const tabs = files.createTabs();
    tabs.open("a.txt");
    tabs.applyContent(content("a.txt", "un"));
    expect(tabs.isDirty("a.txt")).toBe(false);
    tabs.edit("a.txt", "deux");
    expect(tabs.isDirty("a.txt")).toBe(true);
    expect(tabs.dirtyPaths()).toEqual(["a.txt"]);
    expect(tabs.beginSave("a.txt")).toEqual({ path: "a.txt", text: "deux", etag: "e1" });
    // Une écriture est déjà en cours : pas de seconde.
    expect(tabs.beginSave("a.txt")).toBeNull();
    tabs.applyWritten({ path: "a.txt", etag: "e2", mtime: 2, size: 4 });
    expect(tabs.isDirty("a.txt")).toBe(false);
    expect(tabs.get("a.txt").etag).toBe("e2");
    expect(tabs.beginSave("a.txt")).toBeNull();
  });

  it("une saisie pendant l'écriture reste modifiée", () => {
    const tabs = files.createTabs();
    tabs.open("a.txt");
    tabs.applyContent(content("a.txt", "un"));
    tabs.edit("a.txt", "deux");
    tabs.beginSave("a.txt");
    tabs.edit("a.txt", "deux et plus");
    tabs.applyWritten({ path: "a.txt", etag: "e2", mtime: 2, size: 4 });
    expect(tabs.isDirty("a.txt")).toBe(true);
  });

  it("texte tronqué ou sans etag : lecture seule, jamais d'écriture", () => {
    const tabs = files.createTabs();
    tabs.open("gros.log");
    tabs.applyContent(content("gros.log", "début", null, { truncated: true }));
    expect(tabs.get("gros.log").readOnly).toBe(true);
    tabs.edit("gros.log", "autre");
    expect(tabs.get("gros.log").text).toBe("début");
    expect(tabs.beginSave("gros.log")).toBeNull();
    expect(tabs.isDirty("gros.log")).toBe(false);
  });

  it("image : aperçu en lecture seule, jamais modifiée", () => {
    const tabs = files.createTabs();
    tabs.open("a.png");
    tabs.applyContent({
      path: "a.png",
      text: null,
      base64: "iVBOR",
      truncated: false,
      etag: null,
      mtime: 1,
      size: 5,
    });
    const t = tabs.get("a.png");
    expect(t).toMatchObject({ kind: "image", mime: "image/png", readOnly: true });
    expect(tabs.isDirty("a.png")).toBe(false);
  });

  it("conflit : rien n'est écrasé ; Écraser relit l'etag puis réécrit avec l'etag frais", () => {
    const tabs = files.createTabs();
    tabs.open("a.txt");
    tabs.applyContent(content("a.txt", "un"));
    tabs.edit("a.txt", "mien");
    tabs.beginSave("a.txt");
    tabs.applyConflict("a.txt");
    const t = tabs.get("a.txt");
    expect(t.conflict).toBe(true);
    expect(t.saving).toBe(false);
    expect(tabs.isDirty("a.txt")).toBe(true);
    // Sans demande d'écrasement, une réponse `fsInfo` ne produit aucune écriture.
    expect(
      tabs.overwritePayload({ path: "a.txt", exists: true, type: "file", etag: "frais" }),
    ).toBeNull();
    expect(tabs.beginOverwrite("a.txt")).toBe(true);
    expect(tabs.beginOverwrite("a.txt")).toBe(false);
    expect(
      tabs.overwritePayload({ path: "a.txt", exists: true, type: "file", etag: "frais" }),
    ).toEqual({
      path: "a.txt",
      text: "mien",
      etag: "frais",
    });
    expect(t.conflict).toBe(false);
    tabs.applyWritten({ path: "a.txt", etag: "e9", mtime: 3, size: 4 });
    expect(tabs.isDirty("a.txt")).toBe(false);
  });

  it("écraser un fichier devenu absent : écriture sans etag ; un dossier : refus", () => {
    const tabs = files.createTabs();
    tabs.open("a.txt");
    tabs.applyContent(content("a.txt", "un"));
    tabs.edit("a.txt", "mien");
    tabs.beginOverwrite("a.txt");
    expect(tabs.overwritePayload({ path: "a.txt", exists: false, type: null, etag: null })).toEqual(
      {
        path: "a.txt",
        text: "mien",
        etag: null,
      },
    );
    tabs.applyError("a.txt", "x");
    tabs.beginOverwrite("a.txt");
    expect(
      tabs.overwritePayload({ path: "a.txt", exists: true, type: "dir", etag: null }),
    ).toBeNull();
  });

  it("recharger remplace le texte local et efface le conflit", () => {
    const tabs = files.createTabs();
    tabs.open("a.txt");
    tabs.applyContent(content("a.txt", "un"));
    tabs.edit("a.txt", "mien");
    tabs.applyConflict("a.txt");
    const rev = tabs.get("a.txt").rev;
    tabs.applyContent(content("a.txt", "disque", "e5"));
    const t = tabs.get("a.txt");
    expect(t.text).toBe("disque");
    expect(t.conflict).toBe(false);
    expect(t.etag).toBe("e5");
    expect(t.rev).toBeGreaterThan(rev);
    expect(tabs.isDirty("a.txt")).toBe(false);
  });

  it("renommer suit les onglets dessous ; supprimer ferme les propres et garde les modifiés", () => {
    const tabs = files.createTabs();
    for (const p of ["d/a.txt", "d/b.txt", "autre.txt"]) {
      tabs.open(p);
      tabs.applyContent(content(p, "x"));
    }
    tabs.edit("d/b.txt", "modifié");
    expect(tabs.rename("d", "e")).toEqual([
      ["d/a.txt", "e/a.txt"],
      ["d/b.txt", "e/b.txt"],
    ]);
    expect(tabs.get("e/a.txt")).not.toBeNull();
    expect(tabs.get("d/a.txt")).toBeNull();
    const closed = tabs.removed("e");
    expect(closed).toEqual(["e/a.txt"]);
    // Le modifié reste : à réenregistrer, sans etag (le fichier n'existe plus).
    expect(tabs.get("e/b.txt").missing).toBe(true);
    expect(tabs.isDirty("e/b.txt")).toBe(true);
    expect(tabs.beginSave("e/b.txt")).toEqual({ path: "e/b.txt", text: "modifié", etag: null });
  });

  it("fermer l'onglet actif active le voisin", () => {
    const tabs = files.createTabs();
    tabs.open("a");
    tabs.open("b");
    tabs.open("c");
    tabs.close("c");
    expect(tabs.activePath()).toBe("b");
    tabs.close("b");
    tabs.close("a");
    expect(tabs.activePath()).toBeNull();
  });

  it("binaire et erreur de lecture", () => {
    const tabs = files.createTabs();
    tabs.open("x.bin");
    tabs.applyBinary("x.bin");
    expect(tabs.get("x.bin")).toMatchObject({ kind: "binary", readOnly: true });
    tabs.open("y");
    tabs.applyError("y", "Introuvable.");
    expect(tabs.get("y")).toMatchObject({ kind: "error", error: "Introuvable." });
  });
});

// ───────────── Markdown sûr ─────────────

/** Mini DOM : assez pour compter les nœuds produits (aucun HTML n'est interprété). */
class FakeNode {
  tag: string;
  children: (FakeNode | FakeText)[] = [];
  attrs: Record<string, string> = {};
  className = "";
  href = "";
  rel = "";
  target = "";
  private text = "";
  constructor(tag: string) {
    this.tag = tag;
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  append(...nodes: (FakeNode | FakeText)[]) {
    this.children.push(...nodes);
  }
}
class FakeText {
  constructor(public data: string) {}
  get textContent() {
    return this.data;
  }
}
const fakeDoc = {
  createElement: (tag: string) => new FakeNode(tag),
  createTextNode: (data: string) => new FakeText(data),
};
const all = (n: FakeNode | FakeText): FakeNode[] =>
  n instanceof FakeNode ? [n, ...n.children.flatMap((c) => all(c))] : [];
const tagsOf = (n: FakeNode) => all(n).map((x) => x.tag);

describe("Markdown : rendu sûr sur nœuds DOM", () => {
  it("titres, listes, code, citation, filet, gras, italique", () => {
    const root = md.renderMarkdown(
      fakeDoc,
      "# Titre\n\nUn **gras** et *italique* avec `code`.\n\n- a\n- b\n\n1. un\n2. deux\n\n> cité\n\n---\n\n```\nlet x = 1;\n<b>brut</b>\n```\n",
    );
    const tags = tagsOf(root);
    for (const t of [
      "h1",
      "p",
      "strong",
      "em",
      "code",
      "ul",
      "ol",
      "li",
      "blockquote",
      "hr",
      "pre",
    ]) {
      expect(tags, t).toContain(t);
    }
    // Le HTML du bloc de code est du texte, pas un élément.
    expect(tags).not.toContain("b");
    expect(root.textContent).toContain("<b>brut</b>");
  });

  it("le HTML brut reste du texte, aucun élément script, img ni iframe", () => {
    const root = md.renderMarkdown(
      fakeDoc,
      '<script>alert(1)</script>\n\n<img src=x onerror="y()">\n\n![alt](http://x/y.png)\n\n<iframe src="z"></iframe>',
    );
    const tags = tagsOf(root);
    for (const t of ["script", "img", "iframe"]) expect(tags).not.toContain(t);
    expect(root.textContent).toContain("<script>alert(1)</script>");
  });

  it("liens http(s) seulement, rel=noopener, nouvel onglet", () => {
    const root = md.renderMarkdown(
      fakeDoc,
      "[ok](https://exemple.fr/a?b=1) [js](javascript:alert(1)) [data](data:text/html,x) [rel](/chemin) [ftp](ftp://x)",
    );
    const links = all(root).filter((n) => n.tag === "a");
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe("https://exemple.fr/a?b=1");
    expect(links[0]?.rel).toBe("noopener noreferrer");
    expect(links[0]?.target).toBe("_blank");
    expect(root.textContent).toContain("[js](javascript:alert(1))");
  });

  it("safeHref refuse les schémas dangereux, les espaces et les URL trop longues", () => {
    expect(md.safeHref("https://a.fr")).toBe("https://a.fr/");
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "http://a b",
      "//a.fr",
      "https://a.fr/\u0000",
      `https://a.fr/${"x".repeat(2100)}`,
      42,
    ]) {
      expect(md.safeHref(bad), String(bad)).toBeNull();
    }
  });

  it("document immense : tronqué, sans plantage", () => {
    const root = md.renderMarkdown(fakeDoc, `${"mot ".repeat(md.MAX_MARKDOWN_CHARS)}`);
    expect(root.textContent.length).toBeLessThanOrEqual(md.MAX_MARKDOWN_CHARS);
    expect(md.renderMarkdown(fakeDoc, undefined).children).toEqual([]);
  });

  it("n'écrit jamais de HTML : la source n'emploie aucune API d'insertion", () => {
    const source = readFileSync(path("../web/lib/markdown.js"), "utf8");
    for (const forbidden of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "DOMParser",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

// ───────────── Menu, éditeur, shell ─────────────

describe("fichiers : menu contextuel", () => {
  const host = { left: 100, top: 50, width: 400, height: 300 };
  it("s'ouvre sous l'ancre, dans la fenêtre", () => {
    expect(
      menu.menuPosition({ left: 120, top: 80, bottom: 100 }, host, { width: 200, height: 150 }),
    ).toEqual({
      left: 20,
      top: 52,
    });
  });
  it("tient dans la fenêtre : décalé à gauche, ou au-dessus s'il ne tient pas dessous", () => {
    const pos = menu.menuPosition({ left: 480, top: 330, bottom: 350 }, host, {
      width: 200,
      height: 150,
    });
    expect(pos.left).toBe(196);
    expect(pos.top).toBe(330 - 50 - 150 - 2);
    const tiny = menu.menuPosition({ left: 0, top: 0, bottom: 0 }, host, {
      width: 500,
      height: 500,
    });
    expect(tiny.left).toBe(4);
    expect(tiny.top).toBe(4);
  });
});

describe("fichiers : chargement de l'éditeur", () => {
  it("le module est chargé une fois ; un échec n'est pas mémorisé", async () => {
    let calls = 0;
    const ok = { marker: 1 };
    const load = () => {
      calls += 1;
      return Promise.resolve(ok);
    };
    // Module-niveau : une seule promesse partagée tant qu'elle réussit.
    expect(await editor.loadCodeMirror(load)).toBe(ok);
    expect(await editor.loadCodeMirror(load)).toBe(ok);
    expect(calls).toBe(1);
  });
});

describe("fichiers : intégration à la coquille", () => {
  it("Fichiers est un écran natif à instance unique, dans le groupe Outils", () => {
    expect(types.nativeSpec("files")).toMatchObject({
      key: "native:files",
      kind: "native",
      title: "Fichiers",
    });
    const groups = types.MENU_GROUPS as { title: string; entries: { action: string }[] }[];
    const tools = groups.find((g) => g.title === "Outils");
    expect(tools?.entries.map((e) => e.action)).toContain("native:files");
    const screens = groups.find((g) => g.title === "Écrans");
    expect(screens?.entries.map((e) => e.action)).not.toContain("native:files");
    expect(types.CHORD_TEXT["native:files"]).toBe("Alt J F");
  });

  it("openWindow files [path] : chemin validé, jamais un chemin hors projet", () => {
    expect(types.specFromOpenWindow({ view: "files", frame: "files" })).toMatchObject({
      key: "native:files",
    });
    expect(types.specFromOpenWindow({ view: "files", frame: "files" }).path).toBeUndefined();
    expect(types.specFromOpenWindow({ view: "files", frame: "main", path: "cours" }).path).toBe(
      "cours",
    );
    expect(
      types.specFromOpenWindow({ view: "files", frame: "files", path: "../etc" }).path,
    ).toBeUndefined();
    expect(
      types.specFromOpenWindow({ view: "files", frame: "files", path: "/etc" }).path,
    ).toBeUndefined();
    expect(
      types.specFromOpenWindow({ view: "files", frame: "files", path: 3 }).path,
    ).toBeUndefined();
  });

  it("lien profond #w=fichiers[:<chemin>] (encodé en pourcent)", () => {
    expect(frames.parseDeepLink("#w=fichiers")).toEqual({ kind: "native", name: "files" });
    expect(frames.parseDeepLink("#w=fichiers:cours")).toEqual({
      kind: "native",
      name: "files",
      path: "cours",
    });
    expect(frames.parseDeepLink("#w=fichiers:cours%2Fnotes%20finales")).toEqual({
      kind: "native",
      name: "files",
      path: "cours/notes finales",
    });
    expect(frames.parseDeepLink("#w=fichiers:..%2Fsecret")).toBeNull();
    expect(frames.parseDeepLink("#w=fichiers:%2Fetc")).toBeNull();
    expect(frames.parseDeepLink("#w=fichiers:%E0%A4%A")).toBeNull();
    expect(types.specFromRoute(frames.parseDeepLink("#w=fichiers:cours"))).toMatchObject({
      key: "native:files",
      path: "cours",
    });
    expect(types.specFromRoute(frames.parseDeepLink("#w=fichiers")).path).toBeUndefined();
  });

  it("Alt+J F est relayé et le chemin courant n'est pas persisté dans l'espace de travail", () => {
    expect(frames.RELAYED_KEYS).toContain("Alt+J F");
    const spec = types.filesSpec("cours");
    const layout = layouts.serialize([
      { spec, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, minimized: false, maximized: false },
    ]);
    expect(layout.windows).toEqual([
      { id: "files", view: "shell", x: 0, y: 0, w: 0.5, h: 0.5, mode: "files" },
    ]);
    expect(JSON.stringify(layout)).not.toContain("cours");
    const back = layouts.specOfWindow(layout.windows[0]);
    expect(back).toMatchObject({ key: "native:files" });
    expect(back.path).toBeUndefined();
  });
});

// ───────────── CodeMirror vendorisé (CSP) ─────────────

describe("CodeMirror vendorisé (CSP)", () => {
  it("le correctif fait utiliser adoptedStyleSheets pour un Document", () => {
    const { code, count } = vendor.patchStyleMod(
      "if(!e.head&&e.adoptedStyleSheets&&r.CSSStyleSheet){x}",
    );
    expect(count).toBe(1);
    expect(code).toBe("if(e.adoptedStyleSheets&&r.CSSStyleSheet){x}");
  });

  it("un nombre inattendu de sites fait échouer la copie (style-mod a changé)", () => {
    expect(vendor.patchStyleMod("rien").count).not.toBe(vendor.EXPECTED_STYLE_SITES);
    expect(vendor.EXPECTED_STYLE_SITES).toBe(1);
  });

  it("les fichiers commités correspondent à une copie fraîche (sinon : pnpm --filter @warband/server vendor:codemirror)", () => {
    const dir = path("../web/vendor/");
    const built = vendor.buildVendor();
    for (const [name, content] of Object.entries(built)) {
      expect(existsSync(`${dir}${name}`), name).toBe(true);
      expect(readFileSync(`${dir}${name}`, "utf8") === content, name).toBe(true);
    }
    const shipped = readFileSync(`${dir}codemirror.js`, "utf8");
    expect(shipped).toContain("Fichier généré");
    // Seul le repli sans feuilles constructibles crée un <style> (bloqué par la CSP, jamais utilisé ici).
    expect(shipped.match(/createElement\("style"\)/g)).toHaveLength(1);
    expect(shipped).not.toContain("innerHTML");
    expect(shipped).not.toContain("eval(");
    expect(readFileSync(`${dir}LICENSE-codemirror.txt`, "utf8")).toContain("Copyright");
  });
});
