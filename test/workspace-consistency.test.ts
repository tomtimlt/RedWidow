import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde la cohérence entre les paquets et leur câblage (tsconfig, paths, alias).
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f: string) => readFileSync(join(root, f), "utf8");
const json = (f: string) => JSON.parse(read(f)) as Record<string, unknown>;

type Pkg = { dir: string; name: string; workspaceDeps: string[] };

const packages: Pkg[] = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const manifest = json(`packages/${d.name}/package.json`) as {
      name: string;
      dependencies?: Record<string, string>;
    };
    const workspaceDeps = Object.entries(manifest.dependencies ?? {})
      .filter(([, v]) => v.startsWith("workspace:"))
      .map(([n]) => n);
    return { dir: d.name, name: manifest.name, workspaceDeps };
  })
  .sort((a, b) => a.dir.localeCompare(b.dir));

const missing = (expected: string[], actual: string[]) =>
  expected.filter((e) => !actual.includes(e));

describe("cohérence des paquets du workspace", () => {
  it("trouve des paquets", () => {
    expect(packages.length).toBeGreaterThan(0);
  });

  it("tsconfig.json racine référence chaque paquet", () => {
    const refs = (json("tsconfig.json") as { references: { path: string }[] }).references.map(
      (r) => r.path,
    );
    const absents = missing(
      packages.map((p) => `packages/${p.dir}`),
      refs,
    );
    expect(absents, `absent de tsconfig.json (references) : ${absents.join(", ")}`).toEqual([]);
  });

  it("tsconfig.test.json déclare un paths par paquet", () => {
    const paths = Object.keys(
      (json("tsconfig.test.json") as { compilerOptions: { paths: Record<string, string[]> } })
        .compilerOptions.paths,
    );
    const absents = missing(
      packages.map((p) => p.name),
      paths,
    );
    expect(absents, `absent de tsconfig.test.json (paths) : ${absents.join(", ")}`).toEqual([]);
  });

  it("vitest.config.ts déclare un alias par paquet", () => {
    const config = read("vitest.config.ts");
    const absents = packages.map((p) => p.name).filter((n) => !config.includes(`"${n}"`));
    expect(absents, `absent de vitest.config.ts (alias) : ${absents.join(", ")}`).toEqual([]);
  });

  for (const p of packages) {
    it(`${p.name} : dépendances workspace:* = references du tsconfig`, () => {
      const tsconfig = json(`packages/${p.dir}/tsconfig.json`) as {
        references?: { path: string }[];
      };
      const refs = (tsconfig.references ?? []).map((r) => r.path);
      const attendues = p.workspaceDeps.map((n) => {
        const dep = packages.find((q) => q.name === n);
        return dep ? `../${dep.dir}` : `<paquet inconnu ${n}>`;
      });
      const sansReference = missing(attendues, refs);
      const sansDependance = missing(refs, attendues);
      expect(
        sansReference,
        `${p.name} : dépendance workspace:* sans references dans packages/${p.dir}/tsconfig.json : ${sansReference.join(", ")}`,
      ).toEqual([]);
      expect(
        sansDependance,
        `${p.name} : references dans packages/${p.dir}/tsconfig.json sans dépendance workspace:* : ${sansDependance.join(", ")}`,
      ).toEqual([]);
    });
  }
});
