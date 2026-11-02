#!/usr/bin/env node
// Génération explicite après pnpm build : aucun chargement de fichier au runtime de l’agent.
// Usage : node scripts/sync-agent-skills.mjs [--check]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AGENT_PROFILES, renderProfileSkillArtifact } from "../packages/core/dist/index.js";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check") || args.length > 1) {
  console.error("Usage : node scripts/sync-agent-skills.mjs [--check]");
  process.exitCode = 1;
} else {
  const check = args.includes("--check");
  for (const profile of Object.keys(AGENT_PROFILES)) {
    const directory = new URL(`../packages/vscode/media/skills/${profile}/`, import.meta.url);
    const path = new URL("SKILL.md", directory);
    const expected = renderProfileSkillArtifact(profile);
    if (check) {
      let actual;
      try {
        actual = await readFile(path, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (actual !== expected) {
        console.error(`Profil désynchronisé : ${fileURLToPath(path)}`);
        process.exitCode = 1;
      }
    } else {
      await mkdir(directory, { recursive: true });
      await writeFile(path, expected, "utf8");
    }
  }
}
