import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseStudioMessage } from "../src/logic/studio.js";
import { createStudioDockerCache } from "../src/logic/studio-docker-cache.js";

describe("cache Docker réservé à l'affichage des réglages", () => {
  it("poste avant une sonde de cinq secondes, limite les sondes et ignore les autres actions", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return "état";
      });
      const cache = createStudioDockerCache(load);
      const send = vi.fn(async () => true);
      const update = vi.fn();
      await cache.present("projet", 1, false, send, update);
      expect(load).not.toHaveBeenCalled();
      send.mockClear();
      const start = Date.now();
      await cache.present("projet", 1, true, send, update);
      expect(Date.now() - start).toBeLessThan(100);
      expect(send).toHaveBeenCalledWith({ value: undefined, pending: false, failed: false });
      expect(load).toHaveBeenCalledTimes(1);
      await cache.present("projet", 1, false, send, update);
      await cache.present("projet", 1, true, send, update);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(cache.snapshot().value).toBe("état");
      await cache.present("projet", 1, true, send, update);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000);
      await cache.present("projet", 1, true, send, update);
      expect(load).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("écarte la réponse d'un ancien projet ou d'une ancienne génération", async () => {
    const finish: ((value: string) => void)[] = [];
    const cache = createStudioDockerCache(
      () => new Promise<string>((resolve) => finish.push(resolve)),
    );
    const send = async () => true;
    await cache.present("a", 1, true, send, () => {});
    await cache.present("b", 2, true, send, () => {});
    finish[0]?.("ancien");
    await vi.waitFor(() => expect(cache.snapshot().pending).toBe(true));
    expect(cache.snapshot().value).toBeUndefined();
    finish[1]?.("nouveau");
    await vi.waitFor(() => expect(cache.snapshot().value).toBe("nouveau"));
    cache.select("b", 3);
    expect(cache.snapshot().value).toBeUndefined();
  });

  it("valide strictement les accusés et conserve les cinq panneaux", () => {
    for (const type of ["ready", "rendered"]) {
      expect(parseStudioMessage({ type })).toEqual({ type });
      expect(parseStudioMessage({ type, extra: true })).toBeNull();
    }
    const source = readFileSync(new URL("../src/extension/extension.ts", import.meta.url), "utf8");
    for (const name of ["cockpit", "studio", "killchain", "monitor", "engagement"]) {
      const start = source.indexOf(`"warband.${name}",`);
      expect(start).toBeGreaterThan(0);
      expect(source.slice(start, start + 500)).toContain("retainContextWhenHidden: true");
    }
    expect(source).toContain("if (!panel || !studioReady) return;");
    expect(source).toContain("if (!panel || !killchainReady) return;");
    expect(source).toContain("if (alive && cockpitReady)");
    expect(source).toContain("await studioDocker.present(");
    expect(source).toContain(
      'refreshDocker && (requestedPage === "project" || requestedPage === "containers")',
    );
  });

  it("programme et engagement actualisent les métadonnées du Cockpit sans sonde Docker", () => {
    const source = readFileSync(new URL("../src/extension/extension.ts", import.meta.url), "utf8");
    const metadata = source.slice(
      source.indexOf("const refreshCockpitMetadata"),
      source.indexOf("const openProgram"),
    );
    expect(metadata).toContain("programLine(");
    expect(metadata).toContain("engagementLine(");
    expect(metadata).not.toContain("loadCockpitView");
    for (const [start, end] of [
      ["const openProgram", "const openEngagement"],
      ["const openEngagement", "const openMonitor"],
    ] as const) {
      const section = source.slice(source.indexOf(start), source.indexOf(end));
      expect(section).toContain("refreshCockpitMetadata(projectId)");
      expect(section).not.toContain("loadCockpitView");
    }
  });
});
