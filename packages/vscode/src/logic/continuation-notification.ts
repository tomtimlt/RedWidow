import type { EngineEvent } from "@warband/core";
import { t } from "@warband/messages";

/** La notification native retrouve le chat qui a produit l'événement. */
export async function notifyWaitingHuman(
  event: EngineEvent | null,
  show: (message: string, action: string) => PromiseLike<string | undefined>,
  reveal: () => PromiseLike<void>,
): Promise<void> {
  if (event?.kind !== "continuation.waitingHuman") return;
  const action = t("Ouvrir le chat");
  const selected = await show(
    t("RedWidow attend une action de votre part : {reasons}", {
      reasons: event.reasons.join(" ; "),
    }),
    action,
  );
  if (selected === action) await reveal();
}
