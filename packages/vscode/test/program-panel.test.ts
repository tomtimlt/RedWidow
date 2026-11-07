import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProject, importProgramDraft, setActiveProject } from "@warband/core";
import { describe, expect, it } from "vitest";
import { loadCockpitView, parseCockpitMessage } from "../src/logic/cockpit.js";
import { programHtml } from "../src/logic/html.js";
import {
  buildProgramView,
  citationUrl,
  parseProgramMessage,
  programDraftPrompt,
} from "../src/logic/program-controls.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const here = dirname(fileURLToPath(import.meta.url));

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
    expect(parseProgramMessage({ type: "askAgent" })).toEqual({ type: "askAgent" });
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
    const prompt = programDraftPrompt();
    expect(prompt).toContain("read_url");
    expect(prompt).toContain("program_draft");
    expect(prompt).toContain("Ne valide rien");
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
