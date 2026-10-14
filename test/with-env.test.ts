import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/with-env.mjs", import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

describe("scripts/with-env.mjs", () => {
  it("pose les variables et lance la commande", () => {
    const r = run(
      "FOO=1",
      "BAR=a=b",
      "--",
      process.execPath,
      "-e",
      "console.log(process.env.FOO, process.env.BAR)",
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("1 a=b");
  });

  it("propage le code de sortie de la commande", () => {
    const r = run(
      "FOO=1",
      "--",
      process.execPath,
      "-e",
      "process.exit(process.env.FOO === '1' ? 3 : 0)",
    );
    expect(r.status).toBe(3);
  });

  it("exige « -- » suivi d'une commande", () => {
    expect(run("FOO=1", process.execPath, "-e", "0").status).toBe(2);
    expect(run("FOO=1", "--").status).toBe(2);
    expect(run().status).toBe(2);
  });

  it("refuse une affectation invalide", () => {
    expect(run("=1", "--", process.execPath, "-e", "0").status).toBe(2);
    expect(run("SANS_EGAL", "--", process.execPath, "-e", "0").status).toBe(2);
  });
});
