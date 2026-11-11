import { t } from "@warband/messages";
import { isConversationId } from "./history.js";

/**
 * Reprise d'une conversation d'un autre projet (ADR 0049) : après confirmation, le projet change, puis la
 * conversation est rouverte EN LECTURE SEULE dans la fenêtre du projet. Aucune reprise automatique.
 */
export const PENDING_OPEN_KEY = "warband.history.pendingOpen";
/** Au-delà, la demande est périmée : l'utilisateur n'a plus ce contexte en tête. */
export const PENDING_OPEN_TTL_MS = 5 * 60_000;

export interface PendingStore {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void;
}
export interface PendingOpen {
  id: string;
  projectId: string;
  at: number;
}

/** Entrée non fiable (état global partagé) : forme et identifiants revalidés. */
export function parsePendingOpen(raw: unknown): PendingOpen | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, projectId, at } = raw as Record<string, unknown>;
  if (!isConversationId(id) || !isConversationId(projectId)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { id, projectId, at };
}

export type PendingOutcome = "opened" | "expired" | "other-project" | "none";

/**
 * Ouvre la conversation mémorisée si elle est récente et si son projet est le projet actif, puis
 * efface la clé. Une demande destinée à un autre projet est laissée (sa fenêtre la consommera ou elle
 * expirera) ; une demande périmée ou illisible est effacée.
 */
export async function consumePendingOpen(
  store: PendingStore,
  activeProjectId: string | null,
  open: (conversationId: string) => Promise<void>,
  now = Date.now(),
): Promise<PendingOutcome> {
  const raw = store.get(PENDING_OPEN_KEY);
  if (raw === undefined) return "none";
  const pending = parsePendingOpen(raw);
  if (
    !pending ||
    now - pending.at > PENDING_OPEN_TTL_MS ||
    pending.at - now > PENDING_OPEN_TTL_MS
  ) {
    await store.update(PENDING_OPEN_KEY, undefined);
    return "expired";
  }
  if (activeProjectId === null || pending.projectId !== activeProjectId) return "other-project";
  await store.update(PENDING_OPEN_KEY, undefined);
  await open(pending.id);
  return "opened";
}

export interface CrossProjectResumeDeps {
  conversation: { id: string; projectKey: string; projectLabel: string };
  activeProjectId: string | null;
  /** Le projet de la conversation existe encore dans la liste des projets. */
  projectKnown: boolean;
  /** Avertissement modal avec une action ; true si l'utilisateur la choisit. */
  confirm(text: string, action: string): Promise<boolean>;
  /** Avertissement modal sans action possible. */
  inform(text: string): Promise<void>;
  store: PendingStore;
  /**
   * Même chemin que l'activation depuis le Studio. `beforeOpen` s'exécute juste avant l'ouverture du dossier.
   * Renvoie true si le projet a bien été activé.
   */
  switchProject(projectId: string, beforeOpen: () => Promise<void>): Promise<boolean>;
  now?: () => number;
}
export type CrossProjectResumeResult =
  | "same-project"
  | "refused"
  | "cancelled"
  | "switched"
  | "failed";

export async function resumeFromOtherProject(
  deps: CrossProjectResumeDeps,
): Promise<CrossProjectResumeResult> {
  const { conversation } = deps;
  if (conversation.projectKey === (deps.activeProjectId ?? "none")) return "same-project";
  // « Sans projet » ou projet disparu : aucun changement de projet ne la rendrait reprenable.
  if (conversation.projectKey === "none" || !deps.projectKnown) {
    await deps.inform(
      t`Cette conversation (« ${conversation.projectLabel} ») ne peut pas être reprise dans le projet actif. Créez une nouvelle conversation.`,
    );
    return "refused";
  }
  const text = t`Cette conversation appartient au projet « ${conversation.projectLabel} ». Changer de projet pour la reprendre ?`;
  if (!(await deps.confirm(text, t("Changer de projet")))) return "cancelled";
  const selected = await deps.switchProject(conversation.projectKey, async () => {
    await deps.store.update(PENDING_OPEN_KEY, {
      id: conversation.id,
      projectId: conversation.projectKey,
      at: (deps.now ?? Date.now)(),
    });
  });
  if (!selected) {
    await deps.store.update(PENDING_OPEN_KEY, undefined);
    return "failed";
  }
  return "switched";
}
