import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRecorder,
  createSandbox,
  createSandboxContext,
  execInSandbox,
  removeAllSandboxes,
  type SandboxContext,
} from "../src/index.js";

const dockerTests = process.env.JOHN_DOCKER_TESTS === "1";
const image = process.env.JOHN_SANDBOX_IMAGE;

describe.skipIf(!dockerTests)("bac à sable docker (intégration réelle)", () => {
  beforeAll(() => {
    if (image === undefined || image.trim() === "") {
      throw new Error("JOHN_SANDBOX_IMAGE est requis lorsque JOHN_DOCKER_TESTS=1");
    }
  });

  describe("réseau bridge", () => {
    let ctx: SandboxContext;
    let containerId: string;

    beforeAll(async () => {
      ctx = createSandboxContext({
        recorder: createRecorder({ runId: "live-bridge" }),
      });
      containerId = await createSandbox(ctx, { image: image as string, network: "bridge" });
    });

    afterAll(async () => {
      await removeAllSandboxes(ctx);
      ctx.registry.drain();
    });

    it("exécute sous un utilisateur non root", async () => {
      const result = await execInSandbox(ctx, containerId, { argv: ["id", "-u"] });
      expect(result.code).toBe(0);
      const uid = result.stdout.join("").trim();
      expect(uid).not.toBe("0");
    });

    it("n'a pas de capacités effectives", async () => {
      const result = await execInSandbox(ctx, containerId, {
        argv: ["sh", "-c", "grep '^CapEff:' /proc/self/status"],
      });
      expect(result.code).toBe(0);
      const line = result.stdout.join("").trim();
      expect(line).toMatch(/^CapEff:\s+0+$/);
    });

    it("atteint un site public en HTTPS", async () => {
      const result = await execInSandbox(ctx, containerId, {
        argv: ["curl", "-fsS", "--max-time", "20", "https://example.com"],
        timeoutSec: 30,
      });
      expect(result.code).toBe(0);
    });
  });

  describe("réseau none", () => {
    let ctx: SandboxContext;
    let containerId: string;

    beforeAll(async () => {
      ctx = createSandboxContext({
        recorder: createRecorder({ runId: "live-none" }),
      });
      containerId = await createSandbox(ctx, { image: image as string, network: "none" });
    });

    afterAll(async () => {
      await removeAllSandboxes(ctx);
      ctx.registry.drain();
    });

    it("ne peut pas joindre Internet en HTTPS", async () => {
      const result = await execInSandbox(ctx, containerId, {
        argv: ["curl", "-fsS", "--max-time", "10", "https://example.com"],
        timeoutSec: 20,
      });
      expect(result.code).not.toBe(0);
    });
  });
});
