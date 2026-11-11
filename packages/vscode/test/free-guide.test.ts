import { describe, expect, it } from "vitest";
import { FREE_GUIDE_LINKS, isFreeGuideKey } from "../src/logic/free-guide.js";
import { parseStudioMessage } from "../src/logic/studio.js";

describe("guide gratuit", () => {
  it("n'expose que des liens https fixes", () => {
    for (const url of Object.values(FREE_GUIDE_LINKS))
      expect(url.startsWith("https://")).toBe(true);
  });
  it("accepte seulement une clé de la liste", () => {
    expect(parseStudioMessage({ type: "openFreeGuideLink", key: "zen" })).toEqual({
      type: "openFreeGuideLink",
      key: "zen",
    });
    expect(parseStudioMessage({ type: "openFreeGuideLink", key: "inconnue" })).toBeNull();
    expect(parseStudioMessage({ type: "openFreeGuideLink", key: "toString" })).toBeNull();
    expect(
      parseStudioMessage({ type: "openFreeGuideLink", key: "https://exemple.test/" }),
    ).toBeNull();
    expect(
      parseStudioMessage({ type: "openFreeGuideLink", key: "zen", url: "https://exemple.test/" }),
    ).toBeNull();
    expect(isFreeGuideKey("copilot")).toBe(true);
  });
});
