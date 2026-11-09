import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { HTTP_REQUEST_TOOL, hostOfTarget, programTargets } from "../program/scope.js";
import type { Recorder } from "../recorder.js";

/** Mémoire indicative des hôtes visés ; elle n’accorde aucune permission. */
export function createProjectTargets(file?: () => string | undefined) {
  const memory = new Map<string, Set<string>>();
  const hosts = () => {
    const path = file?.();
    let known = memory.get(path ?? "session");
    if (!known) {
      known = new Set<string>();
      if (path) {
        try {
          const text = statSync(path).size <= 65536 ? readFileSync(path, "utf8") : "null";
          const values: unknown = text.length <= 65536 ? JSON.parse(text) : null;
          if (Array.isArray(values))
            for (const value of values.slice(-1024))
              if (typeof value === "string" && hostOfTarget(value) === value) known.add(value);
        } catch {
          /* L’historique indicatif ne bloque pas les outils. */
        }
      }
      memory.set(path ?? "session", known);
    }
    return { path, known };
  };
  const remember = (values: readonly string[]) => {
    const { path, known } = hosts();
    for (const host of values) known.add(host);
    while (known.size > 1024) known.delete(known.values().next().value as string);
    if (path) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(temporary, JSON.stringify([...known]), { mode: 0o600, flag: "wx" });
        renameSync(temporary, path);
      } catch {
        /* Aucune autorisation ne dépend de cette persistance. */
      } finally {
        try {
          rmSync(temporary, { force: true });
        } catch {
          /* Nettoyage au mieux. */
        }
      }
    }
  };
  let unsubscribe: (() => void) | undefined;
  return {
    has: (host: string) => hosts().known.has(host),
    attach(recorder: Recorder) {
      unsubscribe?.();
      const pending = new Map<string, string[]>();
      unsubscribe = recorder.subscribe((event) => {
        if (
          event.kind === "tool.requested" &&
          (event.tool === HTTP_REQUEST_TOOL ||
            /^mcp__(?:exegol|kali)__(?:exec|task_start|execute_command)$/.test(event.tool))
        ) {
          pending.set(event.toolUseId, programTargets(event.tool, event.input)?.hosts ?? []);
          if (pending.size > 1024) pending.delete(pending.keys().next().value as string);
        } else if (event.kind === "approval.decided") {
          const targets = pending.get(event.toolUseId);
          pending.delete(event.toolUseId);
          if (event.decision === "allow" && targets?.length) remember(targets);
        }
      });
    },
  };
}

/** Services de relais connus ; on extrait leur destination, jamais un hôte arbitraire du texte. */
export function relayDestinations(value: string): string[] {
  const url = new URL(value);
  const hostname = url.hostname.replace(/\.$/, "");
  if (
    !/^(?:r\.jina\.ai|corsproxy\.io|api\.allorigins\.win|cors\.isomorphic-git\.org|cors-anywhere\.herokuapp\.com|api\.codetabs\.com|thingproxy\.freeboard\.io|translate\.google\.[a-z.]+|[a-z0-9-]+\.translate\.goog)$/i.test(
      hostname,
    )
  )
    return [];
  let nested = `${url.pathname} ${[...url.searchParams.values()].join(" ")}`;
  for (let i = 0; i < 2; i++) {
    try {
      nested = decodeURIComponent(nested);
    } catch {
      break;
    }
  }
  const targets = [...nested.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => hostOfTarget(match[0]))
    .filter((host): host is string => host !== null);
  if (hostname.endsWith(".translate.goog"))
    targets.push(
      hostname
        .slice(0, -".translate.goog".length)
        .replace(/--/g, "_")
        .replace(/-/g, ".")
        .replace(/_/g, "-"),
    );
  return targets;
}
