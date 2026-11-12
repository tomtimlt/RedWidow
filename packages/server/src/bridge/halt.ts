/**
 * Arrêt d'urgence global (ADR 0041 pour la sémantique, ADR 0052 pour le serveur). Un seul interrupteur
 * pour tous les cadres : l'état est persisté (un redémarrage ne le lève pas, échec fermé) et posé aussi
 * sur chaque projet connu, car le moteur relit l'arrêt du projet actif à chaque décision de la gate.
 * Seul un geste humain (`shell/resume`) le lève ; le Bypass ne le contourne jamais.
 */
import { clearHalt, isHalted, readProjects, setHalt } from "@warband/core";
import type { ServerStorage } from "../storage/index.js";

export const HALT_KEY = "halt";

/** Accès aux arrêts par projet (injectable pour les tests). */
export interface ProjectHalts {
  ids(): Promise<string[]>;
  isHalted(projectId: string): boolean;
  set(projectId: string): Promise<void>;
  clear(projectId: string): Promise<void>;
}

export function coreProjectHalts(configDir: string): ProjectHalts {
  return {
    ids: async () => (await readProjects(configDir))?.projects.map((p) => p.id) ?? [],
    isHalted: (id) => isHalted(configDir, id),
    set: async (id) => void (await setHalt(configDir, id)),
    clear: async (id) => void (await clearHalt(configDir, id)),
  };
}

export interface HaltState {
  active: boolean;
  since: string | null;
}

interface Stored {
  since: string;
  /** Projets dont l'arrêt a été posé par ce geste global (et non par la page engagement) : seuls ceux-là sont levés. */
  projects: string[];
}

export class EmergencyHalt {
  constructor(
    private readonly storage: ServerStorage,
    private readonly projects: ProjectHalts,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private stored(): Stored | null {
    const raw = this.storage.state.get(HALT_KEY);
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    // Un état présent mais illisible vaut arrêt actif (échec fermé).
    return {
      since: typeof r.since === "string" ? r.since : "",
      projects: Array.isArray(r.projects)
        ? r.projects.filter((p): p is string => typeof p === "string")
        : [],
    };
  }

  active(): boolean {
    return this.stored() !== null;
  }

  state(): HaltState {
    const s = this.stored();
    return { active: s !== null, since: s === null ? null : s.since };
  }

  /** Pose l'arrêt (idempotent : la date d'origine est conservée). */
  async halt(): Promise<HaltState> {
    const existing = this.stored();
    const since = existing?.since || this.now().toISOString();
    const mine = new Set(existing?.projects ?? []);
    // L'état global est écrit d'abord : même si un projet échoue, plus rien n'est approuvé.
    this.storage.state.set(HALT_KEY, { since, projects: [...mine] });
    for (const id of await this.projects.ids().catch(() => [] as string[])) {
      if (!this.projects.isHalted(id)) mine.add(id);
      await this.projects.set(id).catch(() => undefined);
    }
    this.storage.state.set(HALT_KEY, { since, projects: [...mine] });
    return this.state();
  }

  /** Lève l'arrêt global et les arrêts de projet qu'il avait posés. */
  async resume(): Promise<HaltState> {
    const existing = this.stored();
    if (existing !== null) {
      for (const id of existing.projects) await this.projects.clear(id).catch(() => undefined);
      this.storage.state.set(HALT_KEY, undefined);
    }
    return this.state();
  }
}
