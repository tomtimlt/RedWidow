import { CodedError, type ErrorInfo } from "@warband/core";
import { t } from "@warband/messages";
import { PRODUCT_NAME } from "./brand.js";

/** Garde le diagnostic IPC sans prendre le message brut comme texte d'interface. */
export class ModelProbeError extends Error {
  constructor(readonly reason: ErrorInfo) {
    super(reason.code);
  }
}

/** Liste fermée : ni sortie du binaire, ni URL, ni identifiant de connexion affiché. */
export function modelLoadFailure(error: unknown): string {
  const reason =
    error instanceof ModelProbeError ? error.reason : error instanceof CodedError ? error : null;
  switch (reason?.code) {
    case "opencode.serverFailed": {
      const exit = /^code (-?\d+)\b/.exec(String(reason.params?.detail ?? ""))?.[1];
      return t`OpenCode n'a pas pu démarrer${exit ? t` (code de sortie ${exit})` : ""}. Vérifiez le binaire embarqué et les blocages de sécurité du système. [opencode.serverFailed]`;
    }
    case "opencode.serverTimeout":
      return t("Le démarrage du serveur OpenCode a dépassé son délai. [opencode.serverTimeout]");
    case "ipc.startTimeout":
      return t("Le moteur n'a pas renvoyé le catalogue dans le délai imparti. [ipc.startTimeout]");
    case "ipc.engineExited": {
      const code = reason.params?.code;
      const exit =
        typeof code === "number" && Number.isSafeInteger(code) ? t` (code de sortie ${code})` : "";
      return t`Le moteur de chargement des modèles s'est arrêté${exit}. Consultez Sortie → ${PRODUCT_NAME}. [ipc.engineExited]`;
    }
    case "opencode.unsafeConfig":
      return t`La configuration OpenCode contient des permissions, plugins ou hooks incompatibles avec les protections de ${PRODUCT_NAME}. [opencode.unsafeConfig]`;
    case "extension.binaryMismatch":
      return t(
        "L'intégrité du binaire embarqué n'est pas conforme. Réinstallez le VSIX officiel. [extension.binaryMismatch]",
      );
    case "process.notFound":
      return t(
        "Le binaire nécessaire au chargement des modèles est introuvable. Réinstallez le VSIX officiel. [process.notFound]",
      );
    case "auth.missingApiKey":
    case "provider.authFailed":
      return t(
        "La connexion au fournisseur est absente ou refusée. Reconnectez le fournisseur puis actualisez la liste.",
      );
    case "opencode.httpFailed": {
      const status = reason.params?.status;
      const suffix =
        typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
          ? ` (HTTP ${status})`
          : "";
      return t`Le serveur OpenCode n'a pas pu fournir le catalogue${suffix}. [opencode.httpFailed]`;
    }
    default:
      return t(
        "Impossible de charger les modèles. Réessayez ou vérifiez la connexion au fournisseur.",
      );
  }
}
