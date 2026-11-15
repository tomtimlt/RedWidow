import { createHash } from "node:crypto";

/** Marqueur envoyé à la place du bloc `<mission_context>` quand il n'a pas changé depuis le dernier tour. */
export const MISSION_CONTEXT_UNCHANGED = '<mission_context unchanged="true"/>';

/**
 * Suivi du dernier bloc `<mission_context>` envoyé dans une session. L'empreinte (sha256) reste en
 * mémoire dans l'instance du run : jamais écrite dans un fichier, donc absente après une reprise de
 * session ou un nouveau run (le premier tour renvoie alors le bloc complet).
 */
export interface MissionContextDelta {
  /** `true` si ce bloc est identique au dernier envoyé ; sinon l'empreinte est mémorisée. */
  unchanged(block: string): boolean;
}

export function createMissionContextDelta(): MissionContextDelta {
  let last: string | undefined;
  return {
    unchanged(block) {
      const digest = createHash("sha256").update(block).digest("hex");
      if (digest === last) return true;
      last = digest;
      return false;
    },
  };
}
