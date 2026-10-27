import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (/\.(?:[cm]?js)$/.test(path)) {
      const result2 = spawnSync(process.execPath, ["--check", path], { stdio: "inherit" });
      if (result2.status !== 0) process.exit(result2.status ?? 1);
    }
  }
}
await check(".");
const result = spawnSync(process.execPath, ["test/demo.test.mjs"], { stdio: "inherit" });
process.exit(result.status ?? 1);
