import { deskToolSpecs } from "@warband/core";
import { expect, it, vi } from "vitest";

vi.mock("../src/skill-sources.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/skill-sources.js")>();
  return {
    SKILL_SOURCES: {
      ...original.SKILL_SOURCES,
      debugging: { ...original.SKILL_SOURCES.debugging, text: `é${"🧪".repeat(10000)}` },
    },
  };
});

it("borne le texte upstream en octets UTF-8 avant sérialisation, sans casser Unicode ni le JSON", async () => {
  const tool = deskToolSpecs()[0];
  if (!tool) throw new Error("load_skill absent");
  const output = await tool.run(
    { profile: "out-of-box", source: "upstream" },
    { parentId: null, correlation: undefined, signal: undefined },
  );
  const loaded = JSON.parse(output);
  expect(loaded.upstream).toMatchObject({ loaded: true, truncated: true, bytes: 40002 });
  expect(Buffer.byteLength(loaded.upstream.text, "utf8")).toBe(15998);
  expect(loaded.upstream.text).toBe(`é${"🧪".repeat(3999)}`);
  expect(JSON.parse(JSON.stringify(loaded))).toEqual(loaded);
});
