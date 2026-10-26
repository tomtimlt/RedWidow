import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFinding,
  createProject,
  type FindingPatch,
  projectFindingsPath,
  readFindings,
  setActiveProject,
  USER_PROJECT_FILE,
  updateFinding,
} from "@warband/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSelectedFinding, FindingDeleteChangedError } from "../src/logic/finding-delete.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const dirs: string[] = [];
const projectId = "11111111-1111-4111-8111-111111111111";
const message = { type: "deleteFinding", projectId, id: "finding-a" };
const barrier = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("message de suppression", () => {
  it("n'accepte que le projet UUID et l'identifiant exact", () => {
    expect(parseStudioMessage(message)).toEqual(message);
    expect(parseStudioMessage({ ...message, id: "a".repeat(200) })).toEqual({
      ...message,
      id: "a".repeat(200),
    });
    for (const raw of [
      { ...message, projectId: "../projet" },
      { ...message, projectId: projectId.replace("4111", "1111") },
      { type: "deleteFinding", projectId },
      { ...message, label: "Libellé injecté" },
      { ...message, path: "/tmp/findings.json" },
      Object.assign(Object.create({ id: "finding-a" }), {
        type: "deleteFinding",
        projectId,
        extra: true,
      }),
      { ...message, id: 12 },
      ...["", " ", "a".repeat(201), "a\0", "a\n", "a\t", "a\x7f", "a\x85"].map((id) => ({
        ...message,
        id,
      })),
    ]) {
      expect(parseStudioMessage(raw)).toBeNull();
    }
  });
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "warband-finding-delete-ui-"));
  dirs.push(dir);
  const project = await createProject(dir, { name: "Mission réelle", workspace: dir });
  const target = await appendFinding(dir, project.id, {
    kind: "host",
    state: "confirmed",
    label: "Cible réelle",
  });
  const child = await appendFinding(dir, project.id, {
    kind: "site",
    state: "hypothesis",
    label: "Descendant conservé",
    from: [target.id],
  });
  return { dir, project, target, child, path: projectFindingsPath(dir, project.id) };
}

it("une annulation native ne modifie aucun fichier", async () => {
  const { dir, project, target, path } = await fixture();
  const before = await readFile(path, "utf8");
  const version = await stat(path, { bigint: true });
  const projectVersion = await stat(join(dir, USER_PROJECT_FILE), { bigint: true });
  const confirm = vi.fn(async () => false);
  expect(
    await deleteSelectedFinding(dir, project.id, target.id, { confirm, isCurrent: () => true }),
  ).toEqual({ status: "cancelled" });
  expect(confirm).toHaveBeenCalledWith({
    projectName: "Mission réelle",
    finding: target,
    dependentCount: 1,
  });
  expect(await readFile(path, "utf8")).toBe(before);
  expect((await stat(path, { bigint: true })).mtimeNs).toBe(version.mtimeNs);
  expect((await stat(join(dir, USER_PROJECT_FILE), { bigint: true })).mtimeNs).toBe(
    projectVersion.mtimeNs,
  );
});

it("refuse le projet étranger avant confirmation et sans modifier les trouvailles", async () => {
  const { dir, project, target, path } = await fixture();
  const other = await createProject(dir, { name: "Autre", workspace: dir });
  const before = await readFile(path, "utf8");
  const confirm = vi.fn(async () => true);
  await expect(
    deleteSelectedFinding(dir, other.id, target.id, { confirm, isCurrent: () => true }),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect(confirm).not.toHaveBeenCalled();
  expect(await readFile(path, "utf8")).toBe(before);
  expect(await readFindings(dir, project.id)).toHaveLength(2);
});

it("refuse une cible absente et un projet invalide avant confirmation", async () => {
  const { dir, project } = await fixture();
  const confirm = vi.fn(async () => true);
  await expect(
    deleteSelectedFinding(dir, project.id, "absente", { confirm, isCurrent: () => true }),
  ).rejects.toMatchObject({ code: "finding.notFound" });
  await expect(
    deleteSelectedFinding(dir, "../projet", "absente", { confirm, isCurrent: () => true }),
  ).rejects.toMatchObject({ code: "project.invalid" });
  expect(confirm).not.toHaveBeenCalled();
});

it.each([false, true])(
  "refuse un changement de projet, aller-retour : %s",
  async (returnToFirst) => {
    const { dir, project, target, path } = await fixture();
    const other = await createProject(dir, { name: "Autre", workspace: dir });
    const before = await readFile(path, "utf8");
    await expect(
      deleteSelectedFinding(dir, project.id, target.id, {
        isCurrent: () => true,
        confirm: async () => {
          await setActiveProject(dir, other.id);
          if (returnToFirst) await setActiveProject(dir, project.id);
          return true;
        },
      }),
    ).rejects.toBeInstanceOf(FindingDeleteChangedError);
    expect(await readFile(path, "utf8")).toBe(before);
  },
);

it("refuse une génération périmée même si le projet affiché revient à son état initial", async () => {
  const { dir, project, target, path } = await fixture();
  const before = await readFile(path, "utf8");
  let generation = 0;
  const initial = generation;
  await expect(
    deleteSelectedFinding(dir, project.id, target.id, {
      isCurrent: () => generation === initial,
      confirm: async () => {
        generation += 2;
        return true;
      },
    }),
  ).rejects.toBeInstanceOf(FindingDeleteChangedError);
  expect(await readFile(path, "utf8")).toBe(before);
});

it.each<FindingPatch>([
  { label: "Libellé changé" },
  { kind: "credential" },
  { state: "failed" },
  { tactic: "TA0001", technique: "T1001" },
])("refuse une cible modifiée pendant la confirmation : %j", async (patch) => {
  const { dir, project, target } = await fixture();
  await expect(
    deleteSelectedFinding(dir, project.id, target.id, {
      isCurrent: () => true,
      confirm: async () => {
        await updateFinding(dir, project.id, target.id, patch);
        return true;
      },
    }),
  ).rejects.toBeInstanceOf(FindingDeleteChangedError);
  expect(await readFindings(dir, project.id)).toHaveLength(2);
  expect((await readFindings(dir, project.id))[0]).toMatchObject(patch);
});

it("refuse des dépendances modifiées pendant la confirmation", async () => {
  const { dir, project, target, child } = await fixture();
  await expect(
    deleteSelectedFinding(dir, project.id, target.id, {
      isCurrent: () => true,
      confirm: async () => {
        await updateFinding(dir, project.id, child.id, { from: [] });
        return true;
      },
    }),
  ).rejects.toBeInstanceOf(FindingDeleteChangedError);
  expect(await readFindings(dir, project.id)).toHaveLength(2);
});

it.each(["finding", "project"] as const)(
  "revalide après l'attente du verrou lorsque %s change",
  async (change) => {
    const { dir, project, target } = await fixture();
    const other = await createProject(dir, { name: "Autre", workspace: dir });
    const locked = barrier();
    const release = barrier();
    const blocker = updateFinding(
      dir,
      project.id,
      target.id,
      change === "finding" ? { label: "Nouvelle cible" } : {},
      {
        beforeCommit: async () => {
          locked.resolve();
          await release.promise;
        },
      },
    );
    await locked.promise;
    let confirmed = false;
    let projectChange: Promise<void> | undefined;
    const deletion = deleteSelectedFinding(dir, project.id, target.id, {
      confirm: async () => {
        confirmed = true;
        return true;
      },
      isCurrent: () => {
        if (confirmed) {
          confirmed = false;
          // Libère l'autre mutation après le dernier contrôle hors verrou.
          projectChange =
            change === "project" ? setActiveProject(dir, other.id) : Promise.resolve();
          void projectChange.then(() => release.resolve());
        }
        return true;
      },
    });
    try {
      await expect(deletion).rejects.toBeInstanceOf(FindingDeleteChangedError);
    } finally {
      release.resolve();
      await blocker;
      await projectChange;
    }
    expect(await readFindings(dir, project.id)).toHaveLength(2);
  },
);

it("la fermeture du panneau annule la suppression malgré une confirmation tardive", async () => {
  const { dir, project, target, path } = await fixture();
  const before = await readFile(path, "utf8");
  const controller = new AbortController();
  expect(
    await deleteSelectedFinding(dir, project.id, target.id, {
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted,
      confirm: async () => {
        controller.abort();
        return true;
      },
    }),
  ).toEqual({ status: "cancelled" });
  expect(await readFile(path, "utf8")).toBe(before);
});

it("supprime la cible confirmée et conserve ses descendants en détachant leurs liens", async () => {
  const { dir, project, target, child } = await fixture();
  expect(
    await deleteSelectedFinding(dir, project.id, target.id, {
      confirm: async () => true,
      isCurrent: () => true,
    }),
  ).toEqual({ status: "deleted", removed: target, detachedFrom: [child.id] });
  const { from: _from, ...detached } = child;
  expect(await readFindings(dir, project.id)).toEqual([detached]);
});

it("une lecture invalide échoue sans demander confirmation ni réparer le fichier", async () => {
  const { dir, project, target, path } = await fixture();
  await writeFile(path, "invalide");
  const confirm = vi.fn(async () => true);
  await expect(
    deleteSelectedFinding(dir, project.id, target.id, { confirm, isCurrent: () => true }),
  ).rejects.toMatchObject({ code: "project.invalid" });
  expect(confirm).not.toHaveBeenCalled();
  expect(await readFile(path, "utf8")).toBe("invalide");
});
