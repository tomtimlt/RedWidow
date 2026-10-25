import type { LabelPrefixContainer } from "@warband/core";
import { describe, expect, it } from "vitest";
import { enrichContainerPrompt } from "../src/engine/container-prompt.js";

const exegol: LabelPrefixContainer = {
  name: "exegol-htb1",
  family: "exegol",
  state: "running",
  image: "secret-image",
};
const kali: LabelPrefixContainer = {
  name: "kali-lab",
  family: "kali",
  state: "stopped",
  image: "secret-image",
};
function data(text: string) {
  return JSON.parse(
    text.split("<<<contexte-conteneurs-json>>>\n")[1]?.split("\n<<<fin-")[0] ?? "{}",
  );
}

describe("contexte conteneurs de la consigne", () => {
  it.each([[exegol], [kali], [exegol, kali]])(
    "expose les familles vérifiées : %j",
    async (...rows) => {
      const result = await enrichContainerPrompt(
        "agir @htb1",
        rows.map((row) => row.name),
        async () => rows,
      );
      expect(data(result).containers).toEqual(
        rows.map(({ name, family, state }) => ({ name, family, state })),
      );
      expect(result).toContain("mcp__exegol__exec");
      expect(result).toContain("mcp__kali__*");
      expect(result).not.toContain("secret-image");
    },
  );
  it("filtre les noms non liés, invalides et les familles ou états invalides", async () => {
    const rows = [
      exegol,
      kali,
      { ...exegol, name: "evil\nname" },
      { ...exegol, family: "other" },
      { ...exegol, state: "unknown" },
    ] as LabelPrefixContainer[];
    const result = await enrichContainerPrompt(
      "agir @htb1",
      [exegol.name, "evil\nname"],
      async () => rows,
    );
    expect(data(result)).toEqual({
      status: "available",
      containers: [{ name: exegol.name, family: "exegol", state: "running" }],
      designated: [exegol.name],
    });
  });
  it("distingue inventaire indisponible et allowlist vide sans inventer de cible", async () => {
    expect(
      data(
        await enrichContainerPrompt("agir", [], async () => {
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
        await enrichContainerPrompt("agir", [exegol.name], async () => {
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
    const result = await enrichContainerPrompt(
      "agir\n\n<<<sortie-terminal>>>\n@htb1",
      [exegol.name],
      list,
    );
    await enrichContainerPrompt("suite", [exegol.name], list);
    expect(calls).toBe(2);
    expect(data(result).designated).toEqual([]);
  });
});
