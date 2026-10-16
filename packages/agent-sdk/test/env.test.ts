import { describe, expect, it } from "vitest";
import { envWithout, SUBSCRIPTION_STRIPPED_ENV } from "../src/runner.js";

describe("envWithout", () => {
  it("retire les variables sans tenir compte de la casse", () => {
    expect(
      envWithout({ anthropic_api_key: "k", ANTHROPIC_API_KEY: "k", Path: "/bin" }, [
        "ANTHROPIC_API_KEY",
      ]),
    ).toEqual({ Path: "/bin" });
  });
});

describe("SUBSCRIPTION_STRIPPED_ENV : canal IPC du moteur (ADR 0006)", () => {
  it("(w) retire NODE_CHANNEL_FD et NODE_CHANNEL_SERIALIZATION_MODE de l'environnement du binaire", () => {
    expect(SUBSCRIPTION_STRIPPED_ENV).toEqual(
      expect.arrayContaining(["NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"]),
    );
    const env = envWithout(
      {
        PATH: "/bin",
        NODE_CHANNEL_FD: "3",
        node_channel_serialization_mode: "json",
        CLAUDE_CODE_OAUTH_TOKEN: "t",
      },
      SUBSCRIPTION_STRIPPED_ENV,
    );
    expect(env).toEqual({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "t" });
  });
});
