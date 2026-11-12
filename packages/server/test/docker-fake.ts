import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDockerApi } from "../src/docker/api.js";

export interface FakeContainer {
  id: string;
  name: string;
  image: string;
  running: boolean;
  labels?: Record<string, string>;
}

export const SELF_ID = "abcdef012345";

export const FIXTURES: FakeContainer[] = [
  {
    id: "a".repeat(64),
    name: "kali1",
    image: "redwidow-kali:local",
    running: true,
    labels: { "io.warband.runtime": "kali" },
  },
  {
    id: "b".repeat(64),
    name: "exegol-web",
    image: "nwodtuhs/exegol:free",
    running: true,
    labels: { "org.exegol.version": "6" },
  },
  { id: "c".repeat(64), name: "kali-off", image: "kalilinux/kali-rolling", running: false },
  { id: "d".repeat(64), name: "nginx", image: "nginx:latest", running: true },
  {
    id: `${SELF_ID}${"0".repeat(52)}`,
    name: "redwidow-server",
    image: "kali-based-server",
    running: true,
    labels: { "io.warband.runtime": "kali" },
  },
];

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Faux démon Docker sur socket Unix : create/start/hijack/resize/json et containers. */
export async function fakeDocker(containers: FakeContainer[] = FIXTURES) {
  const dir = await mkdtemp(join(tmpdir(), "rw-docker-"));
  const socketPath = join(dir, "docker.sock");
  const calls: Call[] = [];
  const streams: Socket[] = [];
  const written: string[] = [];
  const ctl = { exitCode: 0, created: [] as unknown[] };

  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((ok) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const t = Buffer.concat(chunks).toString();
        try {
          ok(t ? JSON.parse(t) : undefined);
        } catch {
          ok(undefined);
        }
      });
    });

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url ?? "";
    const method = req.method ?? "";
    calls.push({ method, path: url, body });
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    if (method === "GET" && url.startsWith("/containers/json"))
      return send(
        200,
        containers.map((c) => ({
          Id: c.id,
          Names: [`/${c.name}`],
          Image: c.image,
          State: c.running ? "running" : "exited",
          Labels: c.labels ?? {},
        })),
      );
    const m = /^\/containers\/([^/]+)\/json$/.exec(url);
    if (method === "GET" && m) {
      const ref = decodeURIComponent(m[1] as string);
      const c = containers.find((x) => x.name === ref || x.id === ref || x.id.startsWith(ref));
      if (!c) return send(404, { message: "no such container" });
      return send(200, {
        Id: c.id,
        Name: `/${c.name}`,
        State: { Running: c.running },
        Config: { Image: c.image, Labels: c.labels ?? {} },
      });
    }
    if (method === "POST" && /^\/containers\/[^/]+\/exec$/.test(url))
      return send(201, { Id: "exec1" });
    if (method === "POST" && /^\/exec\/exec1\/resize/.test(url)) return send(200);
    if (method === "GET" && url === "/exec/exec1/json")
      return send(200, { Running: false, ExitCode: ctl.exitCode });
    if (method === "POST" && url.startsWith("/containers/create")) {
      ctl.created.push({ url, body });
      return send(201, { Id: "e".repeat(64) });
    }
    if (method === "POST" && /^\/containers\/[^/]+\/(start|stop)/.test(url)) return send(204);
    send(404, { message: "inconnu" });
  });
  server.on("upgrade", (req, socket: Socket) => {
    calls.push({ method: req.method ?? "", path: req.url ?? "", body: undefined });
    socket.write("HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
    streams.push(socket);
    // Écho du TTY : ce qui est tapé revient en sortie.
    socket.on("data", (d) => {
      written.push(d.toString());
      socket.write(d);
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((ok) => server.listen(socketPath, ok));

  return {
    socketPath,
    api: createDockerApi({ socketPath, timeoutMs: 2000 }),
    calls,
    streams,
    written,
    ctl,
    find: (method: string, re: RegExp) =>
      calls.filter((c) => c.method === method && re.test(c.path)),
    async close() {
      for (const s of streams) s.destroy();
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Horloge manuelle : `advance` exécute les minuteries échues. */
export function manualClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => now,
    after(ms: number, fn: () => void) {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.live = false;
        due.fn();
      }
      now = end;
      timers = timers.filter((t) => t.live);
    },
  };
}
