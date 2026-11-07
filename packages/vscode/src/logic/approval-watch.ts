/**
 * Suivi global des approbations en attente (toutes sessions de chat). Logique pure, sans `vscode` :
 * l'hôte pousse la liste des demandes de chaque chat (`sync`) et reçoit le compteur, le chat qui
 * attend depuis le plus longtemps, puis une notification unique par nouvelle demande.
 * Ne décide rien : la réponse reste à la gate et à l'humain.
 */

export interface ApprovalWatchState {
  /** Nombre total de demandes en attente, tous chats confondus. */
  count: number;
  /** Chat dont la demande est la plus ancienne ; `null` à zéro. */
  oldest: string | null;
}

export interface ApprovalWatchDeps {
  /** Le chat est-il visible (vue latérale ouverte, onglet d'éditeur visible) ? */
  isVisible(chatId: string): boolean;
  /** Appelé seulement quand le compteur ou le chat le plus ancien change. */
  onChange(state: ApprovalWatchState): void;
  /** Une seule fois par demande, si son chat n'est pas visible à son arrivée. */
  notify(chatId: string, state: ApprovalWatchState): void;
}

export function createApprovalWatch(deps: ApprovalWatchDeps) {
  /** Chat → (demande → rang d'arrivée global). L'ordre d'insertion conserve l'ordre d'arrivée. */
  const chats = new Map<string, Map<string, number>>();
  let rank = 0;
  let last: ApprovalWatchState = { count: 0, oldest: null };

  const snapshot = (): ApprovalWatchState => {
    let count = 0;
    let oldest: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [chatId, pending] of chats) {
      count += pending.size;
      for (const seq of pending.values()) {
        if (seq < best) {
          best = seq;
          oldest = chatId;
        }
      }
    }
    return { count, oldest };
  };

  return {
    /** Remplace les demandes en attente d'un chat par celles de sa vue courante. */
    sync(chatId: string, ids: readonly string[]): void {
      const previous = chats.get(chatId);
      const next = new Map<string, number>();
      const fresh: string[] = [];
      for (const id of ids) {
        if (next.has(id)) continue;
        const known = previous?.get(id);
        if (known === undefined) {
          next.set(id, rank++);
          fresh.push(id);
        } else next.set(id, known);
      }
      if (next.size === 0) chats.delete(chatId);
      else chats.set(chatId, next);
      const state = snapshot();
      const changed = state.count !== last.count || state.oldest !== last.oldest;
      last = state;
      if (changed) deps.onChange(state);
      // Une notification par demande, sans répétition ; aucune si le chat est sous les yeux.
      if (fresh.length > 0 && !deps.isVisible(chatId)) {
        for (const _id of fresh) deps.notify(chatId, state);
      }
    },
    /** Chat fermé : ses demandes disparaissent du compteur. */
    drop(chatId: string): void {
      if (chats.has(chatId)) this.sync(chatId, []);
    },
    state(): ApprovalWatchState {
      return last;
    },
  };
}
