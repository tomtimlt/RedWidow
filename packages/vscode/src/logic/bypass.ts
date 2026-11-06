import { BYPASS_DEFAULT_MS, type BypassState, createBypassSwitch } from "@warband/core";

/**
 * Bypass des approbations, côté hôte (ADR 0006, lots 2 et 2b). L'état vit en mémoire, par chat :
 * jamais persisté (ni `globalState`, ni `workspaceState`, ni réglage, ni variable d'environnement).
 * Module pur : l'horloge et les minuteurs sont injectés, `vscode` n'est pas importé ici.
 *
 * Trois états affichés : « actif » (`on`) seulement avec un accusé du moteur conforme au dernier
 * `seq` envoyé ; « armé » (`armed`) quand l'état est demandé mais pas (encore) effectif, par exemple
 * sans moteur ; « off » sinon. Sans accusé sous `BYPASS_ACK_TIMEOUT_MS`, l'interrupteur se désactive.
 */

/** Délai d'accusé du moteur : au-delà, l'hôte se remet à « off » (échec fermé). */
export const BYPASS_ACK_TIMEOUT_MS = 5000;

/** Message poussé aux surfaces : la webview ne décide jamais de l'état, elle l'affiche. */
export interface BypassPush {
  type: "bypass";
  /** Actif, avec accusé conforme. */
  on: boolean;
  /** Demandé mais non effectif (pas de moteur, accusé en attente). */
  armed: boolean;
  expiresAt: number | null;
}

/** Horloge et minuteurs injectés (tests : horloge factice). */
export interface BypassClock {
  now(): number;
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

/** Envoie au moteur un état (`null` = inactif) ; renvoie le `seq` attribué par le contrôleur. */
export type BypassSend = (state: BypassState | null) => number;

/** Lien vers le moteur courant, renvoyé par `attach`. */
export interface BypassEngineLink {
  /** Accusé du moteur. Ignoré si le lien est libéré ou remplacé, ou si `seq` n'est pas le dernier envoyé. */
  acked(seq: number, state: BypassState | null): void;
  /** Le moteur a disparu : l'état n'est plus « actif ». */
  release(): void;
}

export interface BypassHostOptions {
  clock: BypassClock;
  /** Appelée à chaque changement visible (activation, accusé, désactivation, expiration). */
  onChange(push: BypassPush): void;
}

export interface BypassHost {
  /**
   * Demande d'interrupteur. `enabled: true` n'est accepté que si la vue demandeuse est visible ;
   * `enabled: false` est toujours accepté. Renvoie `false` si la demande est refusée.
   */
  request(enabled: boolean, viewVisible: boolean): boolean;
  /** Remise à « off » sans demande de l'utilisateur (`reset`, changement de dossiers). */
  reset(): void;
  /**
   * Lie un moteur. L'état lui est envoyé tout de suite, puis à chaque changement.
   * Chaque session a son lien : en ajouter un ne retire pas les autres (ADR 0008).
   */
  attach(send: BypassSend): BypassEngineLink;
  /** État affiché, relu à l'horloge. */
  snapshot(): BypassPush;
  /** Temps restant en ms, `null` si l'interrupteur est éteint. */
  remainingMs(): number | null;
  /** Annule les minuteurs. */
  dispose(): void;
}

/** Un moteur attaché : dernier `seq`, dernier état envoyé, accusé reçu pour ce `seq`. */
interface Attachment {
  send: BypassSend;
  seq: number;
  /** Dernier état envoyé ; `undefined` tant que rien n'a été envoyé. */
  sent: BypassState | null | undefined;
  confirmed: boolean;
  ackTimer: unknown;
}

const offPush = (): BypassPush => ({ type: "bypass", on: false, armed: false, expiresAt: null });

/** Même état (bornes égales), `null` compris. */
function same(a: BypassState | null | undefined, b: BypassState | null | undefined): boolean {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return a.since === b.since && a.expiresAt === b.expiresAt;
}

/** Hôte du Bypass : une instance par chat, branchée sur l'interrupteur du cœur. */
export function createBypassHost({ clock, onChange }: BypassHostOptions): BypassHost {
  const switchState = createBypassSwitch({ now: clock.now });
  let expiryTimer: unknown = null;
  const links = new Set<Attachment>();
  let lastPushed = JSON.stringify(offPush());

  const cancel = (handle: unknown) => {
    if (handle !== null) clock.cancel(handle);
  };

  /** État demandé, relu à l'horloge (`null` = éteint ou expiré). */
  const desired = (): BypassState | null => switchState.current(clock.now());

  const view = (): BypassPush => {
    const state = desired();
    if (state === null) return offPush();
    if (links.size === 0) return { type: "bypass", on: false, armed: true, expiresAt: null };
    const all = [...links].every((link) => link.confirmed && same(link.sent, state));
    if (all) return { type: "bypass", on: true, armed: false, expiresAt: state.expiresAt };
    return { type: "bypass", on: false, armed: true, expiresAt: null };
  };

  /** Envoie un état au moteur attaché, puis arme l'accusé si l'état est actif. */
  const sendTo = (link: Attachment, state: BypassState | null): void => {
    cancel(link.ackTimer);
    link.ackTimer = null;
    link.sent = state === null ? null : { since: state.since, expiresAt: state.expiresAt };
    link.confirmed = false;
    link.seq = link.send(state);
    if (state !== null) {
      link.ackTimer = clock.schedule(() => onAckTimeout(link), BYPASS_ACK_TIMEOUT_MS);
    }
  };

  /** Relit l'état, réarme l'échéance, envoie au moteur si l'état a changé, pousse si l'affichage a changé. */
  const sync = (): void => {
    cancel(expiryTimer);
    expiryTimer = null;
    const state = desired();
    if (state !== null) {
      expiryTimer = clock.schedule(sync, Math.max(0, state.expiresAt - clock.now()));
    }
    for (const link of links) {
      if (!same(link.sent, state)) sendTo(link, state);
    }
    const push = view();
    const key = JSON.stringify(push);
    if (key !== lastPushed) {
      lastPushed = key;
      onChange(push);
    }
  };

  /** Sans accusé conforme à temps : désactivation (échec fermé, aucune nouvelle activation automatique). */
  const onAckTimeout = (link: Attachment): void => {
    if (!links.has(link) || link.confirmed) return;
    link.ackTimer = null;
    switchState.disable();
    sync();
  };

  return {
    request(enabled, viewVisible) {
      if (enabled) {
        if (!viewVisible) return false;
        // Durée fixée par l'hôte : la webview ne fournit jamais de durée.
        switchState.enable(BYPASS_DEFAULT_MS);
      } else {
        switchState.disable();
      }
      sync();
      return true;
    },
    reset() {
      switchState.disable();
      sync();
    },
    attach(send) {
      const link: Attachment = { send, seq: 0, sent: undefined, confirmed: false, ackTimer: null };
      links.add(link);
      sync();
      return {
        acked(seq, state) {
          if (!links.has(link) || seq !== link.seq || link.sent === undefined) return;
          cancel(link.ackTimer);
          link.ackTimer = null;
          if (same(state, link.sent)) {
            if (!link.confirmed) {
              link.confirmed = true;
              sync();
            }
            return;
          }
          // Accusé non conforme au dernier envoi (même après confirmation) : échec fermé, tous les liens.
          switchState.disable();
          sync();
        },
        release() {
          if (!links.has(link)) return;
          cancel(link.ackTimer);
          link.ackTimer = null;
          links.delete(link);
          sync();
        },
      };
    },
    snapshot: view,
    remainingMs() {
      const state = desired();
      return state === null ? null : Math.max(0, state.expiresAt - clock.now());
    },
    dispose() {
      cancel(expiryTimer);
      expiryTimer = null;
      for (const link of links) cancel(link.ackTimer);
      links.clear();
    },
  };
}

/** Temps restant lisible pour la barre d'état : arrondi à la minute supérieure. */
export function formatRemaining(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${String(rest).padStart(2, "0")}` : `${rest} min`;
}
