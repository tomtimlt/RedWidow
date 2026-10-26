import { appendFinding, deleteFinding, updateFinding } from "../../src/exegol/findings.js";

// Chaque processus charge sa propre copie compilée des mutations du cœur.
const request = JSON.parse(process.argv[2] ?? "{}");
const options = request.hold
  ? {
      beforeCommit: async () => {
        process.send?.({ kind: "locked" });
        await new Promise((resolve) => process.once("message", () => resolve()));
      },
    }
  : {};
process.send?.({ kind: "ready" });
try {
  let result;
  if (request.action === "append") {
    result = await appendFinding(request.dir, request.project, request.input, options);
  } else if (request.action === "update") {
    result = await updateFinding(request.dir, request.project, request.id, request.patch, options);
  } else {
    result = await deleteFinding(request.dir, request.project, request.id, options);
  }
  process.send?.({ kind: "done", result });
} catch (error) {
  process.send?.({ kind: "done", error: error.code ?? String(error) });
} finally {
  process.disconnect?.();
}
