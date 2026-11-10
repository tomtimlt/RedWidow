import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createProject, importProgramDraft, setActiveProject } from "@warband/core";
import { describe, expect, it } from "vitest";
import { loadCockpitView, parseCockpitMessage } from "../src/logic/cockpit.js";
import { programHtml } from "../src/logic/html.js";
import {
  buildProgramView,
  citationUrl,
  parseProgramMessage,
  programDraftPrompt,
  programDraftSettings,
  startProgramDraft,
  validProgramUrl,
} from "../src/logic/program-controls.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const here = dirname(fileURLToPath(import.meta.url));

it("fiche : rétablit une position bornée sans conserver le contenu de la fiche", () => {
  class Node {
    children: Node[] = [];
    scrollTop = 0;
    className = "";
    textContent = "";
    append(...nodes: Node[]) {
      this.children.push(...nodes);
    }
    get firstChild() {
      return this.children[0];
    }
    removeChild(node: Node) {
      this.children = this.children.filter((item) => item !== node);
    }
    addEventListener() {}
  }
  const mount = (saved: unknown) => {
    const main = new Node();
    let hide = () => {};
    let receive: (event: { data: unknown }) => void = () => {};
    let state: unknown;
    runInNewContext(readFileSync(join(here, "..", "media", "program.js"), "utf8"), {
      acquireVsCodeApi: () => ({
        postMessage() {},
        getState: () => saved,
        setState: (s: unknown) => {
          state = s;
        },
      }),
      document: {
        getElementById: (id: string) => (id === "main" ? main : null),
        createElement: () => new Node(),
      },
      window: {
        addEventListener: (type: string, fn: typeof receive) => {
          if (type === "message") receive = fn;
          if (type === "pagehide") hide = () => fn({ data: null });
        },
      },
    });
    return {
      main,
      post: () => receive({ data: { type: "view", view: { state: "none", haltedHosts: [] } } }),
      hide: () => {
        hide();
        return state;
      },
    };
  };
  const first = mount(null);
  first.post();
  first.main.scrollTop = 210;
  expect(first.hide()).toEqual({ top: 210 });
  const restored = mount(first.hide());
  restored.post();
  expect(restored.main.scrollTop).toBe(210);
  const invalid = mount({ top: 210, secret: "ne pas restaurer" });
  invalid.post();
  expect(invalid.main.scrollTop).toBe(0);
});

const cited = <T>(value: T, url = "https://example.com/program") => ({
  value,
  quote: "Scope: *.example.com",
  url,
  retrievedAt: "2026-11-07T10:00:00Z",
  verified: true,
});

describe("interface de la fiche : messages et rendu", () => {
  it("n'accepte que des messages sans empreinte ni URL", () => {
    expect(parseProgramMessage({ type: "validate" })).toEqual({ type: "validate" });
    expect(parseProgramMessage({ type: "validate", digest: "a".repeat(64) })).toBeNull();
    expect(parseProgramMessage({ type: "resume", host: "a.example.com" })).toEqual({
      type: "resume",
      host: "a.example.com",
    });
    expect(parseProgramMessage({ type: "resume", host: "a b" })).toBeNull();
    expect(parseProgramMessage({ type: "openCitation", field: "pace" })).toEqual({
      type: "openCitation",
      field: "pace",
    });
    expect(parseProgramMessage({ type: "openCitation", field: "url", url: "http://x" })).toBeNull();
    expect(parseProgramMessage({ type: "openCitation", url: "https://x" })).toBeNull();
    expect(parseProgramMessage(null)).toBeNull();
  });

  it("les actions de la fiche vide sont validées côté hôte et ne portent aucune donnée", () => {
    expect(parseProgramMessage({ type: "askAgent" })).toBeNull();
    expect(parseProgramMessage({ type: "askAgent", url: "https://example.test/p" })).toEqual({
      type: "askAgent",
      url: "https://example.test/p",
    });
    expect(
      parseProgramMessage({ type: "askAgent", url: "https://example.test/p", digest: "x" }),
    ).toBeNull();
    expect(parseProgramMessage({ type: "importFile" })).toEqual({ type: "importFile" });
    expect(parseProgramMessage({ type: "askAgent", text: "rédige" })).toBeNull();
    expect(parseProgramMessage({ type: "importFile", path: "/etc/passwd" })).toBeNull();
    expect(parseProgramMessage({ type: "importFile", content: "{}" })).toBeNull();
    const script = readFileSync(join(here, "..", "media", "program.js"), "utf8");
    expect(script).toContain('type: "askAgent"');
    expect(script).toContain('type: "importFile"');
    expect(script).not.toContain("program import");
  });

  it("la consigne à l'agent lit la page avec read_url, appelle program_draft et ne valide rien", () => {
    const prompt = programDraftPrompt("https://example.test/p");
    expect(prompt).toContain("https://example.test/p");
    expect(prompt).toContain("read_url");
    expect(prompt).toContain("program_draft");
    expect(prompt).toContain("Ne valide rien");
  });

  it("refuse les adresses invalides ou porteuses d'identifiants et de contrôles", () => {
    expect(validProgramUrl("https://example.test/p")).toBe(true);
    expect(validProgramUrl("http://example.test")).toBe(true);
    for (const url of [
      "",
      "file:///etc/passwd",
      "https://user:secret@example.test",
      "https://example.test/\n",
      `https://example.test/${"a".repeat(2048)}`,
    ]) {
      expect(parseProgramMessage({ type: "askAgent", url })).toBeNull();
    }
  });

  it("crée une conversation dédiée avec profil, web et adresse, sans modifier les réglages", async () => {
    const base = {
      capabilities: {
        providers: ["opencode"],
        skills: ["general"],
        integrations: [],
        webSearch: false,
      },
      model: "test",
    };
    const settings = programDraftSettings(base);
    expect(settings.capabilities).toEqual({
      providers: ["opencode"],
      skills: ["general", "bug-bounty"],
      integrations: [],
      webSearch: true,
    });
    expect(base.capabilities.skills).toEqual(["general"]);
    expect(base.capabilities.webSearch).toBe(false);
    const calls: unknown[] = [];
    expect(
      await startProgramDraft("https://example.test/p", {
        nextId: () => "new-id",
        create: (id) => {
          calls.push(["create", id, settings]);
          return {
            setSelection: (selection) => calls.push(["selection", selection]),
            send: async (prompt) => {
              calls.push(["send", prompt]);
              return true;
            },
          };
        },
        open: (id) => calls.push(["open", id]),
      }),
    ).toBe(true);
    expect(calls[0]).toEqual(["create", "new-id", settings]);
    expect(calls[1]).toEqual([
      "selection",
      { profile: "bug-bounty", integrations: [], burp: false, webSearch: true },
    ]);
    expect(calls[2]).toEqual(["open", "new-id"]);
    expect(calls[3]).toEqual(["send", expect.stringContaining("https://example.test/p")]);
  });

  it("l'URL de citation vient de la vue de l'hôte et doit être en http(s)", () => {
    const view = (url: string) =>
      buildProgramView(
        {
          state: "draft",
          digest: "a".repeat(64),
          draft: {
            version: 1,
            inScope: cited(["a.example.com"], url),
            outOfScope: cited([]),
            pace: cited({ preset: "normal" as const }),
          },
        },
        [],
      );
    expect(citationUrl(view("https://example.com/p"), "inScope")).toBe("https://example.com/p");
    expect(citationUrl(view("javascript:alert(1)"), "inScope")).toBeNull();
    expect(citationUrl(view("file:///etc/passwd"), "inScope")).toBeNull();
    expect(citationUrl(view("pas une url"), "inScope")).toBeNull();
    expect(citationUrl(view("https://example.com"), "userAgentSuffix")).toBeNull();
  });

  it("la page : CSP stricte, aucun innerHTML ni envoi d'empreinte dans le script", () => {
    const html = programHtml({
      nonce: "abc123",
      cspSource: "https://x.vscode-cdn.net",
      scriptUri: "https://x.vscode-cdn.net/media/program.js",
      styleUri: "https://x.vscode-cdn.net/media/chat.css",
      locale: "en",
    });
    expect(html).toContain("default-src 'none'; script-src 'nonce-abc123'");
    expect(html).toContain("Program sheet");
    expect(html).toContain("media/program.js");
    const script = readFileSync(join(here, "..", "media", "program.js"), "utf8");
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(script).not.toMatch(/postMessage\(\{[^}]*digest/);
  });

  it("le menu projet et le cockpit ouvrent la page ; messages studio et cockpit validés", () => {
    expect(parseStudioMessage({ type: "openProgram" })).toEqual({ type: "openProgram" });
    expect(parseStudioMessage({ type: "openProgram", x: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "openProgram" })).toEqual({ type: "openProgram" });
    expect(parseCockpitMessage({ type: "openProgram", x: 1 })).toBeNull();
    expect(readFileSync(join(here, "..", "media", "studio.js"), "utf8")).toContain(
      'type: "openProgram"',
    );
    expect(readFileSync(join(here, "..", "media", "cockpit.js"), "utf8")).toContain(
      'type: "openProgram"',
    );
  });

  it("le cockpit expose l'état de la fiche du projet actif", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-pctl-cockpit-"));
    const project = await createProject(dir, { name: "p", workspace: dir });
    await setActiveProject(dir, project.id);
    await importProgramDraft(
      dir,
      project.id,
      JSON.stringify({
        version: 1,
        inScope: cited(["*.example.com"]),
        outOfScope: cited([]),
        pace: cited({ preset: "normal" }),
      }),
    );
    const view = await loadCockpitView({
      configDir: dir,
      resolveBin: () => "/usr/bin/docker",
      createDocker: () => ({ listLabelPrefix: async () => [] }),
    });
    expect(view.program).toEqual({ state: "draft", halted: 0 });
  });
});
