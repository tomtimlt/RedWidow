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
  /** Montages (`Source` hôte, `Destination` conteneur), comme `Mounts` de l'API Engine. */
  mounts?: { Source: string; Destination: string }[];
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

/** Image locale du faux démon (`RepoTags` et taille en octets). */
export interface FakeImage {
  tags: string[];
  size: number;
}

/** Images présentes par défaut : celle de Kali du serveur et Exegol `free` (les tests de création n'installent rien). */
export const DEFAULT_IMAGES: FakeImage[] = [
  { tags: ["warband/kali:complete-1"], size: 5_000_000_000 },
  { tags: ["nwodtuhs/exegol:free"], size: 12_000_000_000 },
];

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Faux démon Docker sur socket Unix : create/start/hijack/resize/json et containers. */
export async function fakeDocker(
  fixtures: FakeContainer[] = FIXTURES,
  initialImages: FakeImage[] = DEFAULT_IMAGES,
) {
  // Copie : un conteneur créé pendant un test ne doit pas polluer les fixtures partagées.
  const containers = fixtures.map((c) => ({ ...c }));
  const dir = await mkdtemp(join(tmpdir(), "rw-docker-"));
  const socketPath = join(dir, "docker.sock");
  const calls: Call[] = [];
  const streams: Socket[] = [];
  const written: string[] = [];
  const images = initialImages.map((i) => ({ ...i, tags: [...i.tags] }));
  /**
   * `pull` : comportement de `POST /images/create` : `ok` (flux JSON par couches), `http429` (statut 429),
   * `stream429` (erreur `toomanyrequests` dans le flux), `streamError` (texte de `pullError`), `hang` (flux ouvert,
   * jamais terminé : annulation).
   */
  const ctl = {
    exitCode: 0,
    created: [] as unknown[],
    pull: "ok" as "ok" | "http429" | "stream429" | "streamError" | "hang",
    pullError: "",
  };

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
          Mounts: c.mounts ?? [],
        })),
      );
    if (method === "GET" && url === "/images/json")
      return send(
        200,
        images.map((i, n) => ({ Id: `sha256:${n}`, RepoTags: i.tags, Size: i.size })),
      );
    if (method === "DELETE" && url.startsWith("/images/")) {
      const ref = decodeURIComponent(url.slice(8));
      const at = images.findIndex((i) => i.tags.includes(ref));
      if (at === -1) return send(404, { message: "no such image" });
      images.splice(at, 1);
      return send(200, [{ Untagged: ref }]);
    }
    if (method === "POST" && url.startsWith("/images/create")) {
      const ref = decodeURIComponent(/[?&]fromImage=([^&]+)/.exec(url)?.[1] ?? "");
      if (ctl.pull === "http429") return send(429, { message: "toomanyrequests" });
      res.writeHead(200, { "Content-Type": "application/json" });
      const row = (r: unknown) => res.write(`${JSON.stringify(r)}\n`);
      row({ status: `Pulling from ${ref.split(":")[0]}`, id: ref.split(":")[1] ?? "latest" });
      if (ctl.pull === "stream429") {
        row({ error: "toomanyrequests: You have reached your unauthenticated pull rate limit." });
        return void res.end();
      }
      if (ctl.pull === "streamError") {
        row({ error: ctl.pullError });
        return void res.end();
      }
      row({ status: "Downloading", id: "layer1", progressDetail: { current: 10, total: 100 } });
      if (ctl.pull === "hang") return; // flux laissé ouvert : le client doit l'abandonner
      row({ status: "Downloading", id: "layer1", progressDetail: { current: 100, total: 100 } });
      row({ status: "Pull complete", id: "layer1" });
      images.push({ tags: [ref.includes(":") ? ref : `${ref}:latest`], size: 1_000_000 });
      row({ status: `Status: Downloaded newer image for ${ref}` });
      return void res.end();
    }
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
        Mounts: c.mounts ?? [],
      });
    }
    if (method === "POST" && /^\/containers\/[^/]+\/exec$/.test(url))
      return send(201, { Id: "exec1" });
    if (method === "POST" && /^\/exec\/exec1\/resize/.test(url)) return send(200);
    if (method === "GET" && url === "/exec/exec1/json")
      return send(200, { Running: false, ExitCode: ctl.exitCode });
    if (method === "POST" && url.startsWith("/containers/create")) {
      const name = decodeURIComponent(/[?&]name=([^&]+)/.exec(url)?.[1] ?? "");
      if (containers.some((c) => c.name === name)) return send(409, { message: "nom déjà pris" });
      ctl.created.push({ url, body });
      const b = (body ?? {}) as {
        Image?: string;
        Labels?: Record<string, string>;
        HostConfig?: { Binds?: string[] };
      };
      const binds = (b.HostConfig?.Binds ?? []).map((x) => {
        const [Source = "", Destination = ""] = x.split(":");
        return { Source, Destination };
      });
      containers.push({
        id: "e".repeat(64 - containers.length.toString().length) + containers.length,
        name,
        image: b.Image ?? "",
        running: false,
        labels: b.Labels ?? {},
        mounts: binds,
      });
      return send(201, { Id: containers.at(-1)?.id });
    }
    const act = /^\/containers\/([^/]+)\/(start|stop)/.exec(url);
    if (method === "POST" && act) {
      const c = containers.find((x) => x.id === decodeURIComponent(act[1] as string));
      if (c) c.running = act[2] === "start";
      return send(204);
    }
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
    images,
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
