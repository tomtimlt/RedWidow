import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DockerImageProgress,
  ensureWarbandKaliImage,
  pullDockerImage,
  WARBAND_KALI_DOCKERFILE,
} from "../src/docker/image-progress.js";
import { createRecorder } from "../src/recorder.js";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/process/run.js", () => ({ runProcess: mocks.run }));
vi.mock("../src/process/resolve.js", () => ({ resolveBinary: () => "/docker" }));
const recorder = createRecorder({ runId: "pull" });
let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  mocks.run.mockReset();
});
async function serve(write: (response: ServerResponse) => void) {
  const socket = join(
    tmpdir(),
    `warband-pull-${process.pid}-${Math.random().toString(16).slice(2)}.sock`,
  );
  server = createServer((request, response) => {
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/images/create?fromImage=kalilinux%2Fkali-rolling%3Alatest");
    write(response);
  });
  await new Promise<void>((resolve) => server?.listen(socket, resolve));
  return `unix://${socket}`;
}
const image = "kalilinux/kali-rolling:latest";
const done = '{"status":"Status: Downloaded newer image"}\n';

describe.skipIf(process.platform === "win32")("pull Docker JSON", () => {
  it("reconstitue les fragments, sépare extraction et téléchargement et calcule le débit", async () => {
    const endpoint = await serve((response) => {
      response.write('{"id":"abc","status":"Down');
      setTimeout(() => {
        response.write('loading","progressDetail":{"current":10,"total":100}}\n');
        setTimeout(() => {
          response.end(
            '{"id":"abc","status":"Downloading","progressDetail":{"current":30,"total":100}}\n{"id":"abc","status":"Extracting","progressDetail":{"current":5,"total":100}}\n' +
              done,
          );
        }, 15);
      }, 5);
    });
    const updates: DockerImageProgress[] = [];
    await pullDockerImage(image, { recorder, endpoint, onProgress: (p) => updates.push(p) });
    expect(updates[0]?.layers[0]).toMatchObject({ phase: "download", current: 10, total: 100 });
    expect(updates[1]?.layers[0]?.speedBytesPerSecond).toBeGreaterThan(0);
    expect(updates[2]?.layers[0]).toMatchObject({ phase: "extract", current: 5 });
    expect(updates[2]?.layers[0]?.speedBytesPerSecond).toBeUndefined();
    expect(updates.at(-1)?.complete).toBe(true);
  });
  it.each([
    "{oops}\n",
    '{"errorDetail":{"message":"failed"}}\n',
    '{"status":"Downloading"}\n',
    `${"x".repeat(65537)}\n`,
  ])("refuse un flux invalide ou inachevé", async (body) => {
    const endpoint = await serve((response) => response.end(body));
    await expect(pullDockerImage(image, { recorder, endpoint })).rejects.toBeDefined();
  });
  it("interrompt un démon qui ne transmet plus de données", async () => {
    const endpoint = await serve((response) => {
      response.write('{"status":"Downloading"}\n');
    });
    await expect(
      pullDockerImage(image, { recorder, endpoint, inactivityTimeoutMs: 15 }),
    ).rejects.toMatchObject({ code: "docker.failed" });
  });
  it("refuse une erreur HTTP", async () => {
    const endpoint = await serve((response) => {
      response.statusCode = 500;
      response.end();
    });
    await expect(pullDockerImage(image, { recorder, endpoint })).rejects.toMatchObject({
      code: "docker.failed",
    });
  });
  it("annule le flux et ne construit aucune image ensuite", async () => {
    const controller = new AbortController();
    const endpoint = await serve((response) => {
      response.write('{"status":"Downloading"}\n');
      controller.abort();
    });
    mocks.run.mockResolvedValue({ code: 1, stdout: [], stderr: [] });
    await expect(
      ensureWarbandKaliImage({ recorder, endpoint, signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("construit la recette locale après le pull avec stdin et journal borné", async () => {
    const endpoint = await serve((response) => response.end(done));
    mocks.run
      .mockResolvedValueOnce({ code: 1, stdout: [], stderr: [] })
      .mockResolvedValueOnce({ code: 0, stdout: [], stderr: [] });
    expect(await ensureWarbandKaliImage({ recorder, endpoint })).toBe("warband/kali:complete-1");
    expect(mocks.run.mock.calls[1]).toEqual([
      [
        "/docker",
        "build",
        "--progress",
        "plain",
        "--pull=false",
        "-t",
        "warband/kali:complete-1",
        "-",
      ],
      expect.objectContaining({
        stdin: WARBAND_KALI_DOCKERFILE,
        maxJournaledLines: 2000,
        maxLineLength: 4096,
      }),
    ]);
  });
});
it("la recette autonome correspond à la recette intégrée", async () => {
  expect(
    await readFile(new URL("../../../containers/kali/Dockerfile", import.meta.url), "utf8"),
  ).toBe(WARBAND_KALI_DOCKERFILE);
});
it("conserve le contexte distant dans la CLI sans métriques", async () => {
  mocks.run.mockResolvedValue({ code: 0, stdout: [], stderr: [] });
  const updates: DockerImageProgress[] = [];
  await pullDockerImage(image, {
    recorder,
    endpoint: "ssh://remote",
    onProgress: (p) => updates.push(p),
  });
  expect(mocks.run.mock.calls[0]?.[0]).toEqual(["/docker", "pull", image]);
  expect(updates).toEqual([
    { stage: "pull", status: "cli", layers: [], complete: false },
    { stage: "pull", status: "complete", layers: [], complete: true },
  ]);
});
it("réutilise une image locale et ne lance ni pull ni build", async () => {
  mocks.run.mockResolvedValue({ code: 0, stdout: [], stderr: [] });
  expect(await ensureWarbandKaliImage({ recorder })).toBe("warband/kali:complete-1");
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.run.mock.calls[0]?.[0]).toEqual([
    "/docker",
    "image",
    "inspect",
    "warband/kali:complete-1",
  ]);
});
it("respecte DOCKER_CONTEXT avant DOCKER_HOST", async () => {
  vi.stubEnv("DOCKER_CONTEXT", "selected");
  vi.stubEnv("DOCKER_HOST", "unix:///incorrect.sock");
  mocks.run
    .mockResolvedValueOnce({ code: 0, stdout: ['{"Host":"ssh://selected"}'], stderr: [] })
    .mockResolvedValueOnce({ code: 0, stdout: [], stderr: [] });
  try {
    await pullDockerImage(image, { recorder });
    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      "/docker",
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker}}",
    ]);
    expect(mocks.run.mock.calls[1]?.[0]).toEqual(["/docker", "pull", image]);
  } finally {
    vi.unstubAllEnvs();
  }
});
it("une annulation préalable empêche tout processus", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    ensureWarbandKaliImage({ recorder, signal: controller.signal }),
  ).rejects.toBeDefined();
  expect(mocks.run).not.toHaveBeenCalled();
});
