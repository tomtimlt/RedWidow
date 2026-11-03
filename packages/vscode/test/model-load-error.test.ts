import { CodedError } from "@warband/core";
import { expect, it } from "vitest";
import { ModelProbeError, modelLoadFailure } from "../src/logic/model-load-error.js";

it("distingue le démarrage, l'intégrité, la configuration et le délai du catalogue", () => {
  for (const code of [
    "opencode.serverTimeout",
    "opencode.unsafeConfig",
    "extension.binaryMismatch",
    "ipc.startTimeout",
  ] as const) {
    expect(modelLoadFailure(new CodedError(code))).toContain(`[${code}]`);
    expect(modelLoadFailure(new ModelProbeError({ code }))).toContain(`[${code}]`);
  }
});

it("conserve le code de sortie Windows sans afficher les sorties brutes du serveur", () => {
  const message = modelLoadFailure(
    new ModelProbeError({
      code: "opencode.serverFailed",
      params: { detail: "code -1073741795 oc_sk_test-secret https://login.invalid/secret" },
    }),
  );
  expect(message).toContain("-1073741795");
  expect(message).not.toMatch(/oc_sk_|login.invalid|secret/);
});

it("n'affiche que le statut HTTP structuré, sans corps ni adresse", () => {
  const message = modelLoadFailure(
    new CodedError("opencode.httpFailed", { status: 401, operation: "secret" }),
  );
  expect(message).toContain("HTTP 401");
  expect(message).not.toContain("secret");
});

it("n'expose pas les messages inconnus ou les paramètres malformés", () => {
  for (const error of [
    new Error("oc_sk_test-secret"),
    new ModelProbeError({ code: "error.unknown", message: "oc_sk_test-secret" }),
    new CodedError("opencode.httpFailed", { status: "oc_sk_test-secret" }),
    new CodedError("opencode.serverFailed", { detail: "oc_sk_test-secret" }),
  ])
    expect(modelLoadFailure(error)).not.toContain("oc_sk_test-secret");
});

it("dirige vers le canal Sortie avec la marque publique", () => {
  expect(modelLoadFailure(new CodedError("ipc.engineExited", { code: 9 }))).toBe(
    "Le moteur de chargement des modèles s'est arrêté (code de sortie 9). Consultez Sortie → RedWidow. [ipc.engineExited]",
  );
  expect(modelLoadFailure(new CodedError("opencode.unsafeConfig"))).toContain(
    "protections de RedWidow",
  );
});
