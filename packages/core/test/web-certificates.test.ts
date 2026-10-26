import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as httpsServer } from "node:https";
import { type AddressInfo, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { webCertificateAuthorities } from "../src/web/certificates.js";
import { webTransport } from "../src/web/network.js";

describe("autorités de confiance des outils web", () => {
  it("fusionne les autorités Node et système en conservant les certificats supplémentaires", () => {
    const getCACertificates = vi.fn((source: "default" | "system") =>
      source === "default" ? ["Node", "extra", "commun"] : ["système", "commun"],
    );
    expect(webCertificateAuthorities({ getCACertificates })).toEqual([
      "Node",
      "extra",
      "commun",
      "système",
    ]);
    expect(getCACertificates.mock.calls).toEqual([["default"], ["system"]]);
  });
  it("garde les valeurs strictes par défaut si l’API ou le magasin sont indisponibles", () => {
    expect(webCertificateAuthorities({})).toBeUndefined();
    expect(webCertificateAuthorities({ getCACertificates: () => [] })).toBeUndefined();
    expect(
      webCertificateAuthorities({
        getCACertificates: () => {
          throw new Error("magasin indisponible");
        },
      }),
    ).toBeUndefined();
  });
});

// OpenSSL génère une autorité éphémère : aucun certificat n’est installé sur
// l’hôte, aucune clé n’est versionnée. Les requêtes restent sur loopback.
describe.skipIf(process.platform === "win32")(
  "validation HTTPS réelle, directe et via proxy",
  () => {
    let root: string;
    let ca: string;
    let key: string;
    let cert: string;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "warband-web-tls-"));
      const openssl = (args: string[]) => promisify(execFile)("openssl", args, { cwd: root });
      await openssl([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        "ca.key",
        "-out",
        "ca.pem",
        "-days",
        "1",
        "-subj",
        "/CN=Warband ephemeral test CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ]);
      await openssl([
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        "server.key",
        "-out",
        "server.csr",
        "-subj",
        "/CN=public.example",
        "-addext",
        "subjectAltName=DNS:public.example,IP:127.0.0.1",
      ]);
      await openssl([
        "x509",
        "-req",
        "-in",
        "server.csr",
        "-CA",
        "ca.pem",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        "server.pem",
        "-days",
        "1",
        "-copy_extensions",
        "copy",
      ]);
      [ca, key, cert] = await Promise.all([
        readFile(join(root, "ca.pem"), "utf8"),
        readFile(join(root, "server.key"), "utf8"),
        readFile(join(root, "server.pem"), "utf8"),
      ]);
    });
    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    it("accepte une autorité système ajoutée et rejette toujours les certificats inconnus ou le mauvais nom", async () => {
      vi.stubEnv("NO_PROXY", "*");
      const server = httpsServer({ key, cert }, (_req, response) => response.end("ok"));
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const init = { method: "GET" as const, signal: AbortSignal.timeout(5000) };
      const trusted = webCertificateAuthorities({
        getCACertificates: (source) => (source === "system" ? [ca] : []),
      });
      try {
        // Le nom public est conservé en Host/SNI, l’adresse du test reste locale.
        const result = await webTransport(
          new URL(`https://public.example:${port}`),
          "127.0.0.1",
          init,
          trusted,
        );
        try {
          expect(result.status).toBe(200);
          const chunks: Uint8Array[] = [];
          for await (const chunk of result.body) chunks.push(chunk);
          expect(Buffer.concat(chunks).toString()).toBe("ok");
        } finally {
          await result.close?.();
        }
        await expect(
          webTransport(new URL(`https://public.example:${port}`), "127.0.0.1", init, []),
        ).rejects.toBeDefined();
        await expect(
          webTransport(new URL(`https://wrong.example:${port}`), "127.0.0.1", init, trusted),
        ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        vi.unstubAllEnvs();
      }
    });

    it("valide aussi le certificat du proxy HTTPS avant le tunnel vers le site", async () => {
      const target = httpsServer({ key, cert }, (_req, response) => response.end("via proxy"));
      const proxy = httpsServer({ key, cert });
      proxy.on("connect", (request, socket, head) => {
        const targetPort = Number(request.url?.split(":").at(-1));
        const upstream = connect(targetPort, "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        socket.on("close", () => upstream.destroy());
      });
      target.listen(0, "127.0.0.1");
      proxy.listen(0, "127.0.0.1");
      await Promise.all([once(target, "listening"), once(proxy, "listening")]);
      vi.stubEnv("HTTPS_PROXY", `https://127.0.0.1:${(proxy.address() as AddressInfo).port}`);
      vi.stubEnv("NO_PROXY", "");
      try {
        const url = new URL(`https://public.example:${(target.address() as AddressInfo).port}`);
        const init = { method: "GET" as const, signal: AbortSignal.timeout(5000) };
        const result = await webTransport(url, "127.0.0.1", init, [ca]);
        try {
          expect(result.status).toBe(200);
          for await (const _chunk of result.body) {
            /* Le corps doit être consommé avant fermeture. */
          }
        } finally {
          await result.close?.();
        }
        await expect(webTransport(url, "127.0.0.1", init, [])).rejects.toBeDefined();
      } finally {
        proxy.closeAllConnections();
        target.closeAllConnections();
        await Promise.all([
          new Promise<void>((resolve) => proxy.close(() => resolve())),
          new Promise<void>((resolve) => target.close(() => resolve())),
        ]);
        vi.unstubAllEnvs();
      }
    });
  },
);
