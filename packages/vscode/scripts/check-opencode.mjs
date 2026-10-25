// Vérifie le vrai binaire de la plateforme sans compte, session ni inférence.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createOpencodeRunner } from "../../agent-opencode/dist/index.js";
import { safeEnv } from "../../core/dist/index.js";

const platform = process.platform === "win32" ? "windows" : "linux";
const require = createRequire(import.meta.url);
const native = dirname(require.resolve(`opencode-${platform}-x64-baseline/package.json`));
const binary = join(native, "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
const root = await mkdtemp(join(tmpdir(), "warband-opencode-catalog-"));
const env = {
  ...safeEnv(process.env),
  HOME: root,
  USERPROFILE: root,
  APPDATA: join(root, "appdata"),
  LOCALAPPDATA: join(root, "localappdata"),
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
};
for (const key of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]) {
  if (process.env[key]) env[key] = process.env[key];
}
try {
  const runner = createOpencodeRunner({ binary, processEnv: env });
  const models = await runner.listModels({ cwd: root, signal: AbortSignal.timeout(45_000) });
  assert.ok(models.length > 0, "Le catalogue du binaire OpenCode est vide.");
  console.log(
    `OpenCode natif ${process.platform} : ${models.length} modèles, aucune session ni inférence.`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
