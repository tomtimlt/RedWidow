import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, readProjects, removeContainerAssociations } from "../src/project.js";

describe("nettoyage global des associations de conteneur", () => {
  it("préserve projets, actif, workspace, primary distinct et trouvailles", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "warband-associations-"));
    await createProject(configDir, { containers: ["kali-1"], name: "Un", workspace: "/tmp/un" });
    await createProject(configDir, {
      containers: ["kali-1"],
      name: "Deux",
      workspace: "/tmp/deux",
    });
    const file = await readProjects(configDir);
    if (file === null) throw new Error("projets absents");
    const projects = file.projects.map((p, i) => ({
      ...p,
      containers: ["supprime", "garde"],
      primary: i === 0 ? "supprime" : "garde",
    }));
    await writeFile(join(configDir, "project.json"), JSON.stringify({ ...file, projects }));
    await writeFile(join(configDir, "findings.json"), "trouvailles préservées");
    await removeContainerAssociations(configDir, "supprime");
    expect(await readProjects(configDir)).toEqual({
      ...file,
      projects: projects.map(({ primary, ...p }) => ({
        ...p,
        containers: ["garde"],
        ...(primary === "garde" && { primary }),
      })),
    });
    expect(await readFile(join(configDir, "findings.json"), "utf8")).toBe("trouvailles préservées");
    const before = await readFile(join(configDir, "project.json"), "utf8");
    await removeContainerAssociations(configDir, "supprime");
    expect(await readFile(join(configDir, "project.json"), "utf8")).toBe(before);
  });
  it("fichier absent : aucun effet ; fichier invalide : refus sans écriture", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "warband-associations-"));
    await removeContainerAssociations(configDir, "supprime");
    await writeFile(join(configDir, "project.json"), "invalide");
    await expect(removeContainerAssociations(configDir, "supprime")).rejects.toThrow();
    expect(await readFile(join(configDir, "project.json"), "utf8")).toBe("invalide");
  });
});
