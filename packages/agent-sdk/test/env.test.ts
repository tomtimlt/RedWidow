import { describe, expect, it } from "vitest";
import { envWithout } from "../src/runner.js";

describe("envWithout", () => {
  it("retire les variables sans tenir compte de la casse", () => {
    expect(
      envWithout({ anthropic_api_key: "k", ANTHROPIC_API_KEY: "k", Path: "/bin" }, [
        "ANTHROPIC_API_KEY",
      ]),
    ).toEqual({ Path: "/bin" });
  });
});
