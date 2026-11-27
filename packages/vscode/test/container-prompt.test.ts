import type { LabelPrefixContainer } from "@warband/core";
import { describe, expect, it } from "vitest";
import { enrichContainerPrompt } from "../src/engine/container-prompt.js";

/** Projet réel et montages : un conteneur le voit si l'un de ses montages le contient (ADR 0054). */
const WS = "/racine/projets/mission";
const sees = [{ source: "/racine/projets", target: "/workspace/projets", readonly: false }];
const blind = [{ source: "/ailleurs", target: "/workspace", readonly: false }];

const exegol: LabelPrefixContainer = {
  name: "exegol-htb1",
  family: "exegol",
  state: "running",
  image: "secret-image",
  mounts: sees,
};
const kali: LabelPrefixContainer = {
  name: "kali-lab",
  family: "kali",
  state: "running",
  image: "secret-image",
  mounts: sees,
};
function data(text: string) {
  return JSON.parse(
    text.split("<<<contexte-conteneurs-json>>>\n")[1]?.split("\n<<<fin-")[0] ?? "{}",
  );
}

describe("contexte conteneurs de la consigne", () => {
  it.each([[exegol], [kali], [exegol, kali]])(
    "expose les familles vérifiées qui voient le projet : %j",
    async (...rows) => {
      const result = await enrichContainerPrompt("agir @htb1", WS, async () => rows);
      expect(data(result).containers).toEqual(
        rows.map(({ name, family, state }) => ({
          name,
          family,
          state,
          workspaceStatus: "unverified",
        })),
      );
      expect(result).toContain("mcp__exegol__exec");
      expect(result).toContain("mcp__kali__*");
      expect(result).not.toContain("secret-image");
    },
  );
  it("deux conteneurs voient le projet : les deux sont listés ; celui qui ne le voit pas, absent", async () => {
    const rows = [exegol, kali, { ...kali, name: "kali-aveugle", mounts: blind }];
    const result = await enrichContainerPrompt("agir", WS, async () => rows);
    expect(data(result).containers.map((c: { name: string }) => c.name)).toEqual([
      exegol.name,
      kali.name,
    ]);
  });
  it("filtre les conteneurs arrêtés, les noms invalides et les familles invalides", async () => {
    const rows = [
      exegol,
      { ...kali, state: "stopped" },
      { ...exegol, name: "evil\nname" },
      { ...exegol, family: "other" },
      { ...exegol, state: "unknown" },
    ] as LabelPrefixContainer[];
    const result = await enrichContainerPrompt("agir @htb1", WS, async () => rows);
    expect(data(result)).toEqual({
      status: "available",
      containers: [
        { name: exegol.name, family: "exegol", state: "running", workspaceStatus: "unverified" },
      ],
      designated: [exegol.name],
    });
  });
  it("distingue inventaire indisponible et absence de projet sans inventer de cible", async () => {
    expect(
      data(
        await enrichContainerPrompt("agir", undefined, async () => {
          throw Error("lecture inutile");
        }),
      ),
    ).toEqual({
      status: "available",
      containers: [],
      designated: [],
    });
    expect(
      data(
        await enrichContainerPrompt("agir", WS, async () => {
          throw Error("docker");
        }),
      ),
    ).toEqual({ status: "unavailable", containers: [], designated: [] });
  });
  it("relit Docker à chaque consigne et ignore les mentions du contexte terminal", async () => {
    let calls = 0;
    const list = async () => {
      calls++;
      return [exegol];
    };
    const result = await enrichContainerPrompt("agir\n\n<<<sortie-terminal>>>\n@htb1", WS, list);
    await enrichContainerPrompt("suite", WS, list);
    expect(calls).toBe(2);
    expect(data(result).designated).toEqual([]);
  });
});

it("donne le montage réel sans exposer de labels ou inventer un montage", async () => {
  const out = await enrichContainerPrompt(
    "inventaire",
    "/mission",
    async () => [
      { name: kali.name, family: "kali", state: "running", image: "x", workspace: "/mission" },
    ],
    new Map([[kali.name, "/redwidow/Workspace/projet"]]),
  );
  expect(data(out).containers[0]).toMatchObject({
    projectWorkspace: "/redwidow/Workspace/projet",
    hostWorkspace: "/mission",
    containerWorkspace: "/workspace",
  });
});
