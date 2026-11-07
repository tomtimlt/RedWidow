import { readFile } from "node:fs/promises";
import {
  AGENT_PROFILES,
  type AgentProfile,
  deskInstructions,
  deskToolSpecs,
  isAgentProfile,
  normalizeSkillSearch,
  renderProfileSkill,
  renderProfileSkillArtifact,
} from "@warband/core";
import { expect, it } from "vitest";

const profiles = Object.keys(AGENT_PROFILES).filter(isAgentProfile);
const context = { parentId: null, correlation: undefined, signal: undefined };
async function load(profile: AgentProfile, section?: string, source?: "profile" | "upstream") {
  const tool = deskToolSpecs()[0];
  if (!tool) throw new Error("load_skill absent");
  return JSON.parse(await tool.run({ profile, section, source }, context));
}

it.each(profiles)(
  "injecte la méthode complète de %s dans le prompt et garde load_skill disponible",
  async (profile) => {
    const selected = AGENT_PROFILES[profile];
    const prompt = deskInstructions(profile);
    expect(prompt).toContain(selected.text);
    for (const section of selected.sections) expect(prompt).toContain(section.text);
    expect(prompt).toContain("ne pas la recharger");
    const detail = renderProfileSkill(profile);
    expect(detail.sectionFound).toBe(true);
    expect(detail.sections).toEqual(selected.sections.map(({ id, title }) => ({ id, title })));
    for (const section of selected.sections) expect(detail.instructions).toContain(section.text);
    const loaded = await load(profile);
    expect(loaded.instructions).toBe(detail.instructions);
    expect(loaded.source).toBe("profile");
    expect(loaded.upstream).toMatchObject({ text: "", loaded: false, truncated: false, bytes: 0 });
    expect(loaded.upstream.source).toContain("https://github.com/");
    expect(loaded.upstream.reason).toContain('source: "upstream"');
  },
);

it.each(profiles)("respecte les budgets de caractères du profil %s", (profile) => {
  expect(AGENT_PROFILES[profile].text.length).toBeLessThanOrEqual(1200);
  expect(deskInstructions(profile).length).toBeLessThanOrEqual(12000);
  const detail = renderProfileSkill(profile).instructions;
  expect(detail.length).toBeGreaterThanOrEqual(4000);
  expect(detail.length).toBeLessThanOrEqual(9000);
});

it.each(profiles)(
  "un identifiant exact normalisé sélectionne une seule section de %s",
  async (profile) => {
    const selected = AGENT_PROFILES[profile];
    for (const section of selected.sections) {
      const query =
        section.id === "deroulement"
          ? " DÉROULEMENT "
          : section.id === "cloture"
            ? " CLÔTURE "
            : section.id.toUpperCase();
      const rendered = renderProfileSkill(profile, query);
      expect(rendered.sectionFound).toBe(true);
      expect(rendered.instructions).toContain(section.text);
      for (const other of selected.sections)
        if (other.id !== section.id) expect(rendered.instructions).not.toContain(other.text);
      const loaded = await load(profile, query);
      expect(loaded.instructions).toBe(rendered.instructions);
      expect(loaded.sections).toEqual(selected.sections.map(({ id, title }) => ({ id, title })));
    }
  },
);

it("filtre identifiants, titres, mots-clés et contenu indépendamment des accents et de la casse", () => {
  const selected = AGENT_PROFILES.mentor;
  const section = selected.sections[2];
  if (!section) throw new Error("Section de déroulement absente");
  for (const query of [section.title, section.keywords[0], section.text.slice(0, 45)]) {
    if (!query) throw new Error("Exemple de recherche absent");
    const normalized = normalizeSkillSearch(query).toUpperCase();
    const rendered = renderProfileSkill("mentor", normalized);
    expect(rendered.sectionFound).toBe(true);
    expect(rendered.instructions).toContain(section.text);
    const expected = selected.sections.filter((entry) =>
      [entry.id, entry.title, ...entry.keywords, entry.text].some((text) =>
        normalizeSkillSearch(text).includes(normalizeSkillSearch(query)),
      ),
    );
    for (const entry of selected.sections)
      expect(rendered.instructions.includes(entry.text)).toBe(expected.includes(entry));
  }
  expect(normalizeSkillSearch("  DÉROULEMENT\u00a0  Ａ  ")).toBe("deroulement a");
  expect(renderProfileSkill("mentor", "DÉROULEMENT").instructions).toContain(section.text);
});

it("une absence de correspondance conserve l’index sans charger le document entier", async () => {
  for (const query of ["zzzz-aucune-correspondance-zzzz", "   "]) {
    const rendered = renderProfileSkill("htb", query);
    expect(rendered.sectionFound).toBe(false);
    expect(rendered.instructions).toContain("Aucune section ne correspond");
    expect(rendered.sections.map(({ id }) => id)).toEqual(
      AGENT_PROFILES.htb.sections.map(({ id }) => id),
    );
    for (const entry of AGENT_PROFILES.htb.sections)
      expect(rendered.instructions).not.toContain(entry.text);
    const loaded = await load("htb", query);
    expect(loaded.sectionFound).toBe(false);
    expect(loaded.instructions).toBe(rendered.instructions);
    expect(loaded.upstream.text).toBe("");
  }
});

it("lit la source upstream seulement sur demande explicite et ne remplace pas un filtre vide", async () => {
  const loaded = await load("out-of-box", undefined, "upstream");
  expect(loaded.instructions).toBe(AGENT_PROFILES["out-of-box"].text);
  expect(loaded.upstream).toMatchObject({ loaded: true, license: "MIT" });
  expect(loaded.upstream.text).toContain("Systematic Debugging");
  const filtered = await load("out-of-box", "ROOT CAUSE", "upstream");
  expect(filtered.sectionFound).toBe(true);
  expect(filtered.upstream.text).toContain("Root Cause");
  expect(filtered.upstream.text.length).toBeLessThan(loaded.upstream.text.length);
  const missing = await load("out-of-box", "zzzz-absent-zzzz", "upstream");
  expect(missing.sectionFound).toBe(false);
  expect(missing.upstream).toMatchObject({ text: "", loaded: true, bytes: 0 });
  expect(missing.upstream.reason).toContain("Aucun paragraphe");
});

it("refuse une source inconnue ou les anciennes options hors contrat", async () => {
  const tool = deskToolSpecs()[0];
  if (!tool) throw new Error("load_skill absent");
  for (const input of [
    { profile: "mentor", source: "all" },
    { profile: "mentor", includeReference: true },
    { profile: "mentor", section: "" },
    { profile: "inconnu" },
  ])
    await expect(tool.run(input, context)).rejects.toThrow();
});

it.each(profiles)(
  "le SKILL.md de %s conserve le même corps et la licence de sa source",
  async (profile) => {
    const artifact = await readFile(
      new URL(`../../vscode/media/skills/${profile}/SKILL.md`, import.meta.url),
      "utf8",
    );
    expect(artifact).toBe(renderProfileSkillArtifact(profile));
    const loaded = await load(profile);
    const bodyStart = artifact.indexOf("\n---\n\n") + "\n---\n\n".length;
    const bodyEnd = artifact.indexOf("\n\nLe contrat commun Warband", bodyStart);
    expect(artifact.slice(bodyStart, bodyEnd)).toBe(loaded.instructions);
    expect(artifact).toContain(`license: ${loaded.upstream.license}`);
    expect(artifact).toContain(`Source de méthode : ${loaded.upstream.source}`);
  },
);
