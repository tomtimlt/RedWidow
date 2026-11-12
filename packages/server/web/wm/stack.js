// Empilement, focus et veille des fenêtres (pur, sans DOM). Chaque fenêtre porte un numéro de focus
// croissant : l'ordre d'empilement (arrière → avant) en découle. Une fenêtre à iframe garde sa page
// « vivante » dans un budget ; au-delà, la minimisée la moins récemment focalisée est déchargée.
// Une fenêtre visible n'est jamais proposée au déchargement.

/** Iframes vivantes au bureau / au téléphone. */
export const BUDGET_DESKTOP = 8;
export const BUDGET_PHONE = 3;

export function createStack() {
  const recs = new Map();
  let seq = 0;

  const byAge = () => [...recs.values()].sort((a, b) => a.seq - b.seq);

  return {
    /**
     * Ouvre une fenêtre d'identité `key`, ou renvoie l'existante (`created: false`) : une seule instance
     * par identité. La nouvelle passe au premier plan.
     */
    open({ key, iframe }) {
      const existing = recs.get(key);
      if (existing) return { rec: existing, created: false };
      seq += 1;
      const rec = {
        key,
        iframe: iframe === true,
        minimized: false,
        maximized: false,
        alive: iframe === true,
        seq,
      };
      recs.set(key, rec);
      return { rec, created: true };
    },
    get: (key) => recs.get(key) ?? null,
    has: (key) => recs.has(key),
    size: () => recs.size,
    /** Clés dans l'ordre d'ouverture-focus, de l'arrière vers l'avant. */
    order: () => byAge().map((r) => r.key),
    /** Fenêtre au premier plan parmi les non minimisées, ou `null`. */
    top() {
      let best = null;
      for (const rec of recs.values()) {
        if (!rec.minimized && (best === null || rec.seq > best.seq)) best = rec;
      }
      return best?.key ?? null;
    },
    /** Premier plan ; restaure si minimisée. */
    focus(key) {
      const rec = recs.get(key);
      if (!rec) return null;
      seq += 1;
      rec.seq = seq;
      rec.minimized = false;
      return rec;
    },
    minimize(key) {
      const rec = recs.get(key);
      if (rec) rec.minimized = true;
      return rec ?? null;
    },
    setMaximized(key, value) {
      const rec = recs.get(key);
      if (rec) rec.maximized = value === true;
      return rec ?? null;
    },
    setAlive(key, value) {
      const rec = recs.get(key);
      if (rec?.iframe) rec.alive = value === true;
      return rec ?? null;
    },
    close(key) {
      return recs.delete(key);
    },
    /** Fenêtre à focaliser pour « fenêtre suivante » : la moins récemment focalisée. */
    cycleTarget() {
      return byAge()[0]?.key ?? null;
    },
    aliveCount() {
      let n = 0;
      for (const rec of recs.values()) if (rec.iframe && rec.alive) n += 1;
      return n;
    },
    /**
     * Clés d'iframes à décharger pour revenir sous `budget` pages vivantes. Seules sont candidates les
     * fenêtres vivantes que `isVisible(rec)` refuse ; on commence par la moins récemment focalisée.
     */
    evictions(budget, isVisible) {
      const alive = byAge().filter((r) => r.iframe && r.alive);
      let excess = alive.length - budget;
      const out = [];
      for (const rec of alive) {
        if (excess <= 0) break;
        if (isVisible(rec)) continue;
        out.push(rec.key);
        excess -= 1;
      }
      return out;
    },
  };
}
