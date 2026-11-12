import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const dialog = await load("../web/lib/dialog.js");
const lists = await load("../web/lib/lists.js");
const types = await load("../web/wm/types.js");
const {
  parseDialog,
  parseDownload,
  splitUrl,
  validateFile,
  uploadErrorMessage,
  createDialogQueue,
  createDialogHost,
  startDownload,
  xhrUpload,
  formatBytes,
} = dialog;

describe("parseDialog", () => {
  it("pick : éléments bornés, doublons et entrées invalides écartés", () => {
    const d = parseDialog({
      id: "d1",
      kind: "pick",
      title: "Projet",
      multi: true,
      items: [
        { id: "a", label: "Alpha", detail: "premier" },
        { id: "a", label: "Doublon" },
        { id: "", label: "vide" },
        "x",
        { id: "b", label: "Be\u0000ta" },
      ],
    });
    expect(d.kind).toBe("pick");
    expect(d.multi).toBe(true);
    expect(d.items.map((i: { id: string }) => i.id)).toEqual(["a", "b"]);
    expect(d.items[1].label).toBe("Be ta");
  });

  it("input secret : la valeur reçue n'est jamais préremplie", () => {
    const secret = parseDialog({
      id: "d2",
      kind: "input",
      title: "T",
      label: "Clé",
      secret: true,
      value: "sk-ne-pas-garder",
    });
    expect(secret.value).toBe("");
    const clear = parseDialog({
      id: "d3",
      kind: "input",
      title: "T",
      label: "L",
      secret: false,
      value: "x",
    });
    expect(clear.value).toBe("x");
  });

  it("confirm : danger strictement booléen, retours à la ligne gardés", () => {
    expect(
      parseDialog({ id: "c", kind: "confirm", title: "T", text: "a\nb", danger: "oui" }),
    ).toMatchObject({ danger: false, text: "a\nb" });
    expect(
      parseDialog({ id: "c", kind: "confirm", title: "T", text: "x", danger: true }).danger,
    ).toBe(true);
  });

  it("file : extensions valides en minuscules, liste vide refusée, taille par défaut", () => {
    const d = parseDialog({ id: "f", kind: "file", title: "T", accept: [".PDF", "pdf", ".json"] });
    expect(d.accept).toEqual([".pdf", ".json"]);
    expect(d.maxBytes).toBe(5 * 1024 * 1024);
    expect(
      parseDialog({ id: "f", kind: "file", title: "T", accept: ["pdf"], maxBytes: 10 }),
    ).toBeNull();
    expect(
      parseDialog({ id: "f", kind: "file", title: "T", accept: [".pdf"], maxBytes: 1234 }).maxBytes,
    ).toBe(1234);
  });

  it("refuse les identifiants invalides et les kinds inconnus", () => {
    expect(parseDialog({ id: "a b", kind: "confirm" })).toBeNull();
    expect(parseDialog({ id: "ok", kind: "bizarre" })).toBeNull();
    expect(parseDialog(null)).toBeNull();
    expect(parseDialog({ id: "ok", kind: "pick", items: "non" })).toBeNull();
  });
});

describe("liens externes", () => {
  it("décompose une URL http(s) et met le domaine à part", () => {
    expect(splitUrl("https://exemple.fr:8443/a/b?c=1")).toEqual({
      href: "https://exemple.fr:8443/a/b?c=1",
      scheme: "https://",
      host: "exemple.fr:8443",
      rest: "/a/b?c=1",
    });
  });
  it("refuse tout autre schéma, les identifiants intégrés et les contrôles", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "ftp://exemple.fr/",
      "https://confiance.fr@evil.example/",
      "https://exemple.fr/\u0000",
      "https://exemple.fr/ a",
      "",
      "pas une url",
    ]) {
      expect(splitUrl(bad), bad).toBeNull();
    }
  });
});

describe("fichiers", () => {
  const rules = { accept: [".pdf"], maxBytes: 1000 };
  it("contrôle local : type, vide, taille", () => {
    expect(validateFile({ name: "a.PDF", size: 10 }, rules)).toEqual({ ok: true });
    expect(validateFile({ name: "a.exe", size: 10 }, rules)).toMatchObject({
      ok: false,
      code: "badType",
    });
    expect(validateFile({ name: "pdf", size: 10 }, rules)).toMatchObject({
      ok: false,
      code: "badType",
    });
    expect(validateFile({ name: "a.pdf", size: 0 }, rules)).toMatchObject({
      ok: false,
      code: "empty",
    });
    const big = validateFile({ name: "a.pdf", size: 1001 }, rules);
    expect(big).toMatchObject({ ok: false, code: "tooBig" });
    expect(big.message).toContain("Taille maximale");
  });
  it("messages d'erreur du serveur", () => {
    expect(uploadErrorMessage(413, rules)).toContain("trop volumineux");
    expect(uploadErrorMessage(415, rules)).toContain(".pdf");
    expect(uploadErrorMessage(403, rules)).toContain("refusé");
    expect(uploadErrorMessage(401, rules)).toContain("Session expirée");
    expect(uploadErrorMessage(500, rules)).toContain("500");
  });
  it("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 Mio");
  });
  it("xhrUpload : corps = fichier, nom percent-encodé, type octet-stream", async () => {
    const calls: unknown[] = [];
    class FakeXhr {
      upload: { onprogress?: (e: unknown) => void } = {};
      status = 200;
      responseText = '{"id":"up_1","name":"a","size":3}';
      onload?: () => void;
      open(m: string, u: string) {
        calls.push(["open", m, u]);
      }
      setRequestHeader(k: string, v: string) {
        calls.push(["h", k, v]);
      }
      send(body: unknown) {
        calls.push(["send", body]);
        queueMicrotask(() => this.onload?.());
      }
      abort() {}
    }
    const file = { name: "rapport é.pdf", size: 3 };
    const up = xhrUpload(file, "d1", () => {}, FakeXhr);
    expect(await up.done).toEqual({ status: 200, body: { id: "up_1", name: "a", size: 3 } });
    expect(calls).toContainEqual(["open", "POST", "/api/upload?dialog=d1"]);
    expect(calls).toContainEqual(["h", "Content-Type", "application/octet-stream"]);
    expect(calls).toContainEqual(["h", "X-Filename", "rapport%20%C3%A9.pdf"]);
    expect(calls).toContainEqual(["send", file]);
  });
});

describe("téléchargement", () => {
  it("parseDownload : identifiant strict, nom sans séparateur", () => {
    expect(parseDownload({ id: "dl_abc", filename: "../a/b.json" })).toEqual({
      id: "dl_abc",
      filename: ".._a_b.json",
    });
    expect(parseDownload({ id: "../x", filename: "a" })).toBeNull();
    expect(parseDownload({ id: "dl_1", filename: ".." })?.filename).toBe("export");
  });
  it("startDownload crée un lien de même origine, le clique puis le retire", () => {
    const made: Record<string, unknown>[] = [];
    const doc = {
      createElement: () => {
        const a = {
          click: vi.fn(),
          remove: vi.fn(),
        } as Record<string, unknown>;
        made.push(a);
        return a;
      },
      body: { append: vi.fn() },
    };
    expect(startDownload(doc, { id: "dl_9", filename: "kill chain.json" })).toBe(true);
    const a = made[0] as Record<string, unknown> & { click: () => void; remove: () => void };
    expect(a.href).toBe("/api/download/dl_9");
    expect(a.download).toBe("kill chain.json");
    expect(a.click).toHaveBeenCalledOnce();
    expect(a.remove).toHaveBeenCalledOnce();
    expect(startDownload(doc, { id: "!", filename: "a" })).toBe(false);
  });
});

describe("file d'attente", () => {
  const d = (id: string) => ({ id, kind: "confirm" });
  it("un seul visible, les autres derrière, un identifiant une seule fois", () => {
    const q = createDialogQueue();
    expect(q.add(d("a"))).toBe(true);
    expect(q.add(d("b"))).toBe(true);
    expect(q.add(d("a"))).toBe(false);
    expect(q.current().id).toBe("a");
    expect(q.waiting()).toBe(1);
    expect(q.remove("a")).toBe(true);
    expect(q.current().id).toBe("b");
    expect(q.waiting()).toBe(0);
    expect(q.remove("zzz")).toBe(false);
    q.clear();
    expect(q.current()).toBeNull();
  });
  it("borne la file", () => {
    const q = createDialogQueue();
    for (let i = 0; i < 40; i += 1) q.add(d(`d${i}`));
    expect(q.size()).toBe(32);
  });
});

// ───── Hôte de dialogues sur un DOM minimal : aucune réponse sans geste ─────

class FakeNode {
  children: FakeNode[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  value = "";
  checked = false;
  type = "";
  tag: string;
  dataset: Record<string, string> = {};
  isConnected = true;
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(tag: string) {
    this.tag = tag;
  }
  append(...n: FakeNode[]) {
    this.children.push(...n);
  }
  replaceChildren(...n: FakeNode[]) {
    this.children = n;
  }
  setAttribute() {}
  focus() {}
  contains() {
    return true;
  }
  getClientRects() {
    return [1];
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    for (const fn of this.listeners.get(type) ?? [])
      fn({ target: this, preventDefault() {}, ...event });
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
  querySelector(sel: string) {
    return (
      this.all().find(
        (n) => sel.startsWith(".") && n.className.split(" ").includes(sel.slice(1)),
      ) ?? null
    );
  }
  querySelectorAll() {
    return this.all().filter((n) => n.tag === "button" || n.tag === "input");
  }
}

function fakeHost(send = vi.fn(() => true)) {
  const body = new FakeNode("body") as FakeNode & { classList: unknown };
  const doc = {
    body,
    activeElement: null,
    createElement: (tag: string) => new FakeNode(tag),
    addEventListener() {},
  };
  const host = createDialogHost({ doc, send });
  const overlay = body.children[0] as FakeNode;
  const buttons = (label: string) =>
    overlay.all().filter((n) => n.tag === "button" && n.textContent.startsWith(label));
  return { host, send, overlay, buttons };
}

const PICK = {
  id: "p1",
  kind: "pick",
  title: "Choisir",
  multi: false,
  items: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ],
};

describe("hôte de dialogues", () => {
  it("n'envoie jamais de réponse à l'affichage, à la fermeture, à la coupure ni au renvoi", () => {
    const { host, send, overlay } = fakeHost();
    host.show(PICK);
    expect(host.isOpen()).toBe(true);
    expect(overlay.hidden).toBe(false);
    host.show({ id: "c1", kind: "confirm", title: "T", text: "x", danger: true });
    expect(host.size()).toBe(2);
    host.show(PICK); // renvoi du même identifiant : ignoré
    expect(host.size()).toBe(2);
    host.close("p1"); // dialogClosed : sans réponse
    host.clear(); // coupure : sans réponse
    expect(host.isOpen()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("une réponse naît d'un clic : choix simple, puis annulation = null", () => {
    const { host, send, buttons } = fakeHost();
    host.show(PICK);
    host.show({ id: "c1", kind: "confirm", title: "T", text: "x", danger: false });
    buttons("")
      .find((b) => b.children.some((c) => c.all().some((n) => n.textContent === "Beta")))
      ?.fire("click");
    expect(send).toHaveBeenCalledExactlyOnceWith("p1", "b");
    // Le suivant (confirm) est affiché ; Annuler → null.
    buttons("Annuler")[0]?.fire("click");
    expect(send).toHaveBeenLastCalledWith("c1", null);
    expect(host.isOpen()).toBe(false);
  });

  it("confirm danger : Confirmer répond true seulement au clic", () => {
    const { host, send, buttons } = fakeHost();
    host.show({ id: "c2", kind: "confirm", title: "T", text: "x", danger: true });
    expect(send).not.toHaveBeenCalled();
    buttons("Confirmer")[0]?.fire("click");
    expect(send).toHaveBeenCalledExactlyOnceWith("c2", true);
  });

  it("hors ligne : le dialogue reste ouvert, rien n'est conservé", () => {
    const send = vi.fn(() => false);
    const { host, buttons } = fakeHost(send);
    host.show({ id: "c3", kind: "confirm", title: "T", text: "x", danger: false });
    buttons("Confirmer")[0]?.fire("click");
    expect(send).toHaveBeenCalledOnce();
    expect(host.isOpen()).toBe(true);
  });

  it("input secret : valeur envoyée puis champ vidé", () => {
    const { host, send, overlay, buttons } = fakeHost();
    host.show({ id: "i1", kind: "input", title: "Clé", label: "Clé", secret: true });
    const field = overlay.all().find((n) => n.tag === "input") as FakeNode;
    expect(field.type).toBe("password");
    field.value = "sk-secret";
    field.fire("input");
    buttons("Valider")[0]?.fire("click");
    expect(send).toHaveBeenCalledExactlyOnceWith("i1", "sk-secret");
    expect(field.value).toBe("");
  });

  it("external refusé : aucune URL affichée, Fermer répond false", () => {
    const { host, send, overlay, buttons } = fakeHost();
    host.show({ id: "e1", kind: "external", url: "javascript:alert(1)", label: "x" });
    expect(overlay.all().some((n) => n.textContent.includes("javascript"))).toBe(false);
    expect(buttons("Ouvrir")).toHaveLength(0);
    buttons("Fermer")[0]?.fire("click");
    expect(send).toHaveBeenCalledExactlyOnceWith("e1", false);
  });

  it("external : Ouvrir appelle l'ouverture de l'URL affichée et répond selon le résultat", () => {
    const body = new FakeNode("body");
    const doc = {
      body,
      activeElement: null,
      createElement: (tag: string) => new FakeNode(tag),
      addEventListener() {},
    };
    const send = vi.fn(() => true);
    const openUrl = vi.fn(() => true);
    const host = createDialogHost({ doc, send, openUrl });
    host.show({ id: "e2", kind: "external", url: "https://exemple.fr/x", label: "Doc" });
    const open = (body.children[0] as FakeNode).all().find((n) => n.textContent === "Ouvrir");
    expect(send).not.toHaveBeenCalled();
    open?.fire("click");
    expect(openUrl).toHaveBeenCalledWith("https://exemple.fr/x");
    expect(send).toHaveBeenCalledExactlyOnceWith("e2", true);
  });

  it("aucune minuterie ni réponse en dehors d'un gestionnaire d'événement (source)", () => {
    const text = readFileSync(new URL("../web/lib/dialog.js", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const word of [
      "setTimeout",
      "setInterval",
      "requestAnimationFrame",
      "innerHTML",
      "localStorage",
      "sessionStorage",
      ".style",
      "console.",
    ]) {
      expect(text.includes(word), word).toBe(false);
    }
    // `send` n'est appelé que dans `answer`.
    expect(text.match(/(?<!\.)\bsend\(/g)).toHaveLength(1);
  });
});

describe("apparence et fenêtres demandées par le serveur", () => {
  it("parseAppearance : valeurs valides seulement", () => {
    expect(
      lists.parseAppearance({
        values: { locale: "en", palette: "widow", terminalPrompt: "compact", model: "x" },
      }),
    ).toEqual({ locale: "en", palette: "widow", terminalPrompt: "compact" });
    expect(
      lists.parseAppearance({ values: { locale: "de", palette: "<x>", terminalPrompt: 3 } }),
    ).toEqual({ locale: null, palette: null, terminalPrompt: null });
    expect(lists.parseAppearance({})).toEqual({
      locale: null,
      palette: null,
      terminalPrompt: null,
    });
  });

  it("openWindow : killchain → graphe de la mission, cockpit → main, reste refusé", () => {
    expect(types.specFromOpenWindow({ view: "killchain", frame: "m-abc123" })).toMatchObject({
      key: "killchain:m-abc123",
      view: "killchain",
      frame: "m-abc123",
    });
    expect(types.specFromOpenWindow({ view: "cockpit", frame: "cockpit" })).toMatchObject({
      key: "cockpit:main",
    });
    expect(types.specFromOpenWindow({ view: "program", frame: "p1" })?.key).toBe("program:p1");
    expect(types.specFromOpenWindow({ view: "engagement", frame: "e1" })?.key).toBe(
      "engagement:e1",
    );
    expect(types.specFromOpenWindow({ view: "studio", frame: "main" })).toBeNull();
    expect(types.specFromOpenWindow({ view: "killchain", frame: "../x" })).toBeNull();
    expect(types.specFromOpenWindow(null)).toBeNull();
  });
});
