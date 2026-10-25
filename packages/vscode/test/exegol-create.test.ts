import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExegolCreateArgv,
  parseExegolCapabilities,
  prepareExegolCreate,
} from "../src/logic/exegol-create.js";

const modern =
  parseExegolCapabilities(`--log --no-log --log-method --network --workspace --vpn --desktop --no-desktop --desktop-config
--gui --no-gui --exegol-resources --no-exegol-resources --my-resources --no-my-resources`);
const legacy =
  parseExegolCapabilities(`--log --log-method --network --workspace --vpn --desktop --desktop-config
--disable-X11 --disable-exegol-resources --disable-my-resources`);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("création Exegol", () => {
  it("construit les options modernes avec VPN NAT et bureau localhost", () => {
    const workspace = join(tmpdir(), "a b;$x");
    const vpn = join(tmpdir(), "vpn.ovpn");
    expect(
      buildExegolCreateArgv(
        {
          name: "audit",
          image: "full",
          workspacePath: workspace,
          vpnPath: vpn,
          desktop: true,
          gui: false,
          exegolResources: false,
          myResources: true,
        },
        modern,
      ),
    ).toEqual([
      "start",
      "audit",
      "full",
      "--workspace",
      workspace,
      "--network",
      "nat",
      "--vpn",
      vpn,
      "--desktop",
      "--desktop-config",
      "http:127.0.0.1:6080",
      "--no-gui",
      "--no-exegol-resources",
      "--my-resources",
      "--log",
      "--log-method",
      "script",
    ]);
  });
  it("force le refus du bureau malgré un défaut global activé et refuse les anciennes CLI", () => {
    expect(buildExegolCreateArgv({ name: "audit", desktop: false }, modern)).toEqual([
      "start",
      "audit",
      "--network",
      "nat",
      "--no-desktop",
      "--log",
      "--log-method",
      "script",
    ]);
    expect(() => buildExegolCreateArgv({ name: "audit", desktop: false }, legacy)).toThrow(
      "Mettez Exegol à jour",
    );
  });
  it("adapte les refus à la CLI historique", () => {
    expect(
      buildExegolCreateArgv(
        { name: "audit", gui: false, exegolResources: false, myResources: false },
        legacy,
      ),
    ).toEqual([
      "start",
      "audit",
      "--network",
      "nat",
      "--disable-X11",
      "--disable-exegol-resources",
      "--disable-my-resources",
      "--log",
      "--log-method",
      "script",
    ]);
    expect(
      buildExegolCreateArgv(
        { name: "audit", gui: true, exegolResources: true, myResources: true },
        legacy,
      ),
    ).toEqual(["start", "audit", "--network", "nat", "--log", "--log-method", "script"]);
  });
  it("active les logs par défaut et refuse toute option de journalisation non prise en charge", () => {
    expect(
      buildExegolCreateArgv({ name: "audit" }, parseExegolCapabilities("--network --log")),
    ).toEqual(["start", "audit", "--network", "nat", "--log"]);
    expect(buildExegolCreateArgv({ name: "audit", log: true }, modern)).toContain("--log");
    expect(buildExegolCreateArgv({ name: "audit", log: false }, modern)).toEqual([
      "start",
      "audit",
      "--network",
      "nat",
      "--no-log",
    ]);
    expect(() =>
      buildExegolCreateArgv({ name: "audit" }, parseExegolCapabilities("--network")),
    ).toThrow("--log");
    expect(() => buildExegolCreateArgv({ name: "audit", log: false }, legacy)).toThrow(
      "désactiver explicitement les logs",
    );
  });
  it("refuse les options non annoncées et les valeurs dangereuses", () => {
    for (const name of ["--privileged", "a b", "a;sh", "x".repeat(129), "x\n"]) {
      expect(() => buildExegolCreateArgv({ name }, modern)).toThrow();
    }
    expect(() => buildExegolCreateArgv({ name: "audit", image: "--help" }, modern)).toThrow();
    expect(() =>
      buildExegolCreateArgv({ name: "audit", workspacePath: "relative" }, modern),
    ).toThrow();
    expect(() =>
      buildExegolCreateArgv({ name: "audit", gui: false }, parseExegolCapabilities("--network")),
    ).toThrow("ne prend pas en charge");
    expect(() =>
      buildExegolCreateArgv({ name: "audit", desktop: true, desktopPort: 65536 }, modern),
    ).toThrow("Port");
    expect(() =>
      buildExegolCreateArgv({ name: "audit", desktop: true, network: "disabled" }, modern),
    ).toThrow("réseau actif");
    for (const network of ["host", "disabled"] as const) {
      expect(() =>
        buildExegolCreateArgv({ name: "audit", vpnPath: "/tmp/vpn.ovpn", network }, modern),
      ).toThrow("NAT");
    }
  });
  it("vérifie les fichiers hôte et ne transmet aucun chemin au processus de découverte", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-exegol-"));
    dirs.push(dir);
    const vpn = join(dir, "client.ovpn");
    await writeFile(vpn, "secret non lu");
    const run = vi
      .fn()
      .mockResolvedValue({ code: 0, stdout: ["--network --workspace --vpn --log"] });
    const deps = { resolveBin: () => "/usr/bin/exegol", run };
    expect(
      await prepareExegolCreate({ name: "audit", workspacePath: dir, vpnPath: vpn }, deps),
    ).toEqual({
      shellPath: "/usr/bin/exegol",
      shellArgs: ["start", "audit", "--workspace", dir, "--network", "nat", "--vpn", vpn, "--log"],
    });
    expect(run.mock.calls[0]?.[0]).toEqual(["/usr/bin/exegol", "start", "--help"]);
    const vpnDir = join(dir, "vpn");
    await mkdir(vpnDir);
    await expect(
      prepareExegolCreate({ name: "audit", vpnPath: vpnDir }, deps),
    ).resolves.toBeDefined();
    const invalid = join(dir, "secret.txt");
    await writeFile(invalid, "secret");
    await expect(prepareExegolCreate({ name: "audit", vpnPath: invalid }, deps)).rejects.toThrow(
      ".ovpn",
    );
    await expect(prepareExegolCreate({ name: "audit", workspacePath: vpn }, deps)).rejects.toThrow(
      "répertoire",
    );
    await expect(
      prepareExegolCreate({ name: "audit", vpnPath: join(dir, "absent.conf") }, deps),
    ).rejects.toThrow("inaccessible");
  });
  it("échoue clairement sans binaire ou aide exploitable", async () => {
    await expect(
      prepareExegolCreate({ name: "audit" }, { resolveBin: () => null }),
    ).rejects.toThrow("PATH");
    await expect(
      prepareExegolCreate(
        { name: "audit" },
        {
          resolveBin: () => "/bin/exegol",
          run: vi.fn().mockResolvedValue({ code: 1, stdout: [] }),
        },
      ),
    ).rejects.toThrow("vérifier les options");
  });
});
