// Gestionnaire de fenêtres : le DOM du bureau. Chaque fenêtre est un `div` de la coquille dont le contenu
// est une `iframe` de même origine (hôte de cadres) ou un écran natif. La géométrie vient de
// `geometry.js`, l'empilement et la veille de `stack.js` ; ce module ne fait que poser des éléments et
// brancher le pointeur. La position passe par le CSSOM (`el.style.left = …`), jamais par un attribut
// `style` du HTML. Aucune donnée reçue n'est insérée en HTML : tout passe par `textContent`.
import {
  cascadeFractions,
  clampRect,
  dropZone,
  resizeRect,
  snapRect,
  tileFractions,
  toFractions,
  toPixels,
} from "./geometry.js";
import { BUDGET_DESKTOP, BUDGET_PHONE, createStack } from "./stack.js";

const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
/** Durée des animations de tuile et de maximisation (≤ 150 ms). */
const ANIM_MS = 130;
const EMPTY_TEXT = "Aucune fenêtre ouverte. Utilisez « Ouvrir » dans le dock.";
const WAIT_TEXT = "Cet écran arrive dans une prochaine version.";

const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {HTMLElement} options.root élément du bureau (`#desktop`)
 * @param {object} options.frames hôte de cadres (`createFrameHost`)
 * @param {Record<string, { mount(body: HTMLElement): void }>} [options.natives] écrans natifs par nom
 * @param {(snapshot: object[]) => void} [options.onChange] liste des fenêtres modifiée (dock)
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 */
export function createDesktop({
  doc,
  root,
  frames,
  natives = {},
  onChange = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
}) {
  const stack = createStack();
  const windows = new Map();
  let mode = "desktop";
  let opened = 0;
  let lastSignature = "";
  let drag = null;

  const veil = el(doc, "div", "wm-veil");
  veil.hidden = true;
  const preview = el(doc, "div", "wm-preview");
  preview.hidden = true;
  const empty = el(doc, "p", "wm-empty", EMPTY_TEXT);
  root.append(empty, preview, veil);

  const deskSize = () => ({ w: root.clientWidth, h: root.clientHeight });
  const budget = () => (mode === "stack" ? BUDGET_PHONE : BUDGET_DESKTOP);
  const isVisible = (rec) => !rec.minimized && (mode !== "stack" || rec.key === stack.top());

  const pxRect = (win, desk) =>
    mode === "stack" || win.rec.maximized
      ? { x: 0, y: 0, w: desk.w, h: desk.h }
      : clampRect(toPixels(win.rect, desk), desk);

  const place = (win, rect) => {
    win.px = rect;
    win.el.style.left = `${rect.x}px`;
    win.el.style.top = `${rect.y}px`;
    win.el.style.width = `${rect.w}px`;
    win.el.style.height = `${rect.h}px`;
  };

  /** Anime le prochain changement de géométrie (≤ 150 ms), sauf pendant un glisser. */
  const animate = (win) => {
    win.el.classList.add("wm-anim");
    clearTimeout(win.animTimer);
    win.animTimer = setTimer(() => win.el.classList.remove("wm-anim"), ANIM_MS + 20);
  };

  const snapshot = () => {
    const top = stack.top();
    return stack.order().map((key) => {
      const win = windows.get(key);
      return {
        key,
        title: win.spec.title,
        kind: win.spec.kind,
        minimized: win.rec.minimized,
        maximized: win.rec.maximized,
        focused: key === top && isVisible(win.rec),
        visible: isVisible(win.rec),
        alive: win.rec.iframe ? win.rec.alive : null,
      };
    });
  };

  const notify = () => {
    const snap = snapshot();
    const signature = JSON.stringify(snap);
    if (signature === lastSignature) return;
    lastSignature = signature;
    onChange(snap);
  };

  const applyAll = () => {
    const desk = deskSize();
    const order = stack.order();
    const top = stack.top();
    let visibleCount = 0;
    order.forEach((key, index) => {
      const win = windows.get(key);
      const visible = isVisible(win.rec);
      win.el.hidden = !visible;
      win.el.style.zIndex = String(10 + index);
      win.el.classList.toggle("is-focused", visible && key === top);
      win.el.classList.toggle("is-max", win.rec.maximized || mode === "stack");
      if (!visible) return;
      visibleCount += 1;
      if (desk.w > 0 && desk.h > 0 && drag?.win !== win) place(win, pxRect(win, desk));
    });
    empty.hidden = visibleCount > 0;
  };

  /** Réveille une page déchargée (restauration) : elle renvoie `ready` et reprend son état. */
  const wake = (win) => {
    const entry = win.entry;
    if (entry?.unloaded) {
      frames.reload(entry);
      stack.setAlive(win.spec.key, true);
    }
  };

  /** Applique la géométrie, décharge au besoin les minimisées les plus anciennes, prévient le dock. */
  const reconcile = () => {
    applyAll();
    for (const key of stack.evictions(budget(), isVisible)) {
      const win = windows.get(key);
      if (!win?.entry) continue;
      frames.unload(win.entry);
      stack.setAlive(key, false);
    }
    notify();
  };

  const focus = (key) => {
    const win = windows.get(key);
    if (!win) return;
    const wasHidden = !isVisible(win.rec);
    stack.focus(key);
    wake(win);
    if (wasHidden) {
      win.el.classList.remove("wm-pop");
      void win.el.offsetWidth;
      win.el.classList.add("wm-pop");
    }
    reconcile();
  };

  const minimize = (key) => {
    const win = windows.get(key);
    if (!win) return;
    stack.minimize(key);
    reconcile();
  };

  const setMaximized = (key, value) => {
    const win = windows.get(key);
    if (!win || mode === "stack") return;
    animate(win);
    stack.setMaximized(key, value);
    stack.focus(key);
    reconcile();
  };

  const tile = (key, kind) => {
    const win = windows.get(key);
    const fractions = tileFractions(kind);
    if (!win || !fractions || mode === "stack") return;
    if (kind === "full") {
      setMaximized(key, true);
      return;
    }
    animate(win);
    stack.setMaximized(key, false);
    win.rect = fractions;
    stack.focus(key);
    reconcile();
  };

  const close = (key) => {
    const win = windows.get(key);
    if (!win) return;
    if (win.entry) frames.close(win.entry.view, win.entry.frame);
    clearTimeout(win.animTimer);
    win.el.remove();
    windows.delete(key);
    stack.close(key);
    reconcile();
  };

  // ───────────── Glisser et redimensionner ─────────────

  const endDrag = (commit) => {
    if (!drag) return;
    const { win, finish } = drag;
    drag = null;
    veil.hidden = true;
    preview.hidden = true;
    doc.body.classList.remove("wm-dragging");
    finish();
    if (commit.tile) tile(win.spec.key, commit.tile);
    else if (commit.rect) win.rect = toFractions(commit.rect, deskSize());
    reconcile();
  };

  const othersRects = (win) => {
    const rects = [];
    for (const other of windows.values()) {
      if (other !== win && isVisible(other.rec) && other.px) rects.push(other.px);
    }
    return rects;
  };

  const beginGesture = (win, event, onMove, onUp) => {
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    veil.hidden = false;
    doc.body.classList.add("wm-dragging");
    const move = (e) => {
      if (e.pointerId === event.pointerId) onMove(e);
    };
    const up = (e) => {
      if (e.pointerId === event.pointerId) onUp(e, e.type === "pointercancel");
    };
    const key = (e) => {
      if (e.key === "Escape") onUp(e, true);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    doc.addEventListener("keydown", key);
    drag = {
      win,
      finish() {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", up);
        doc.removeEventListener("keydown", key);
        target.releasePointerCapture?.(event.pointerId);
      },
    };
  };

  const startMove = (win, event) => {
    if (mode === "stack" || event.button !== 0 || drag) return;
    if (event.target.closest("button")) return;
    const desk = deskSize();
    const bounds = root.getBoundingClientRect();
    focus(win.spec.key);
    let start = win.px ?? pxRect(win, desk);
    let origin = { x: event.clientX, y: event.clientY };
    let current = start;
    let zone = null;
    let moved = false;
    // Une fenêtre maximisée n'est restaurée qu'au premier vrai mouvement (un double-clic ne la touche pas).
    let pendingRestore = win.rec.maximized;
    beginGesture(
      win,
      event,
      (e) => {
        if (pendingRestore) {
          if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 4) return;
          pendingRestore = false;
          const restored = clampRect(toPixels(win.rect, desk), desk);
          const ratio = desk.w > 0 ? (origin.x - bounds.left) / desk.w : 0.5;
          start = {
            ...restored,
            x: Math.round(origin.x - bounds.left - ratio * restored.w),
            y: Math.max(0, Math.round(origin.y - bounds.top - 17)),
          };
          origin = { x: e.clientX, y: e.clientY };
          stack.setMaximized(win.spec.key, false);
          applyAll();
        }
        moved = true;
        const raw = {
          ...start,
          x: start.x + e.clientX - origin.x,
          y: start.y + e.clientY - origin.y,
        };
        current = clampRect(snapRect(raw, othersRects(win), desk), desk);
        place(win, current);
        zone = dropZone({ x: e.clientX - bounds.left, y: e.clientY - bounds.top }, desk);
        if (zone === null) preview.hidden = true;
        else {
          const r = toPixels(tileFractions(zone), desk);
          preview.style.left = `${r.x}px`;
          preview.style.top = `${r.y}px`;
          preview.style.width = `${r.w}px`;
          preview.style.height = `${r.h}px`;
          preview.hidden = false;
        }
      },
      (_e, cancelled) => {
        if (!moved) endDrag({});
        else if (cancelled) {
          endDrag({ rect: start });
          place(win, start);
        } else endDrag(zone === null ? { rect: current } : { tile: zone });
      },
    );
  };

  const startResize = (win, handle, event) => {
    if (mode === "stack" || event.button !== 0 || drag || win.rec.maximized) return;
    event.preventDefault();
    const desk = deskSize();
    focus(win.spec.key);
    const start = win.px ?? pxRect(win, desk);
    const origin = { x: event.clientX, y: event.clientY };
    let current = start;
    beginGesture(
      win,
      event,
      (e) => {
        current = resizeRect(start, handle, e.clientX - origin.x, e.clientY - origin.y, desk);
        place(win, current);
      },
      (_e, cancelled) => {
        if (cancelled) {
          endDrag({ rect: start });
          place(win, start);
        } else endDrag({ rect: current });
      },
    );
  };

  // ───────────── Construction d'une fenêtre ─────────────

  const build = (spec) => {
    const node = el(doc, "section", `wm-win wm-${spec.kind}`);
    node.dataset.key = spec.key;
    node.dataset.type = spec.type;
    node.setAttribute("aria-label", spec.title);

    const header = el(doc, "header", "wm-title");
    const name = el(doc, "span", "wm-name", spec.title);
    const buttons = el(doc, "div", "wm-btns");
    const mk = (cls, label, glyph, onClick) => {
      const b = el(doc, "button", `wm-btn ${cls}`, glyph);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.addEventListener("click", onClick);
      return b;
    };
    buttons.append(
      mk("wm-min", "Minimiser", "−", () => minimize(spec.key)),
      mk("wm-max", "Maximiser ou restaurer", "□", () =>
        setMaximized(spec.key, !windows.get(spec.key).rec.maximized),
      ),
      mk("wm-close", "Fermer", "×", () => close(spec.key)),
    );
    header.append(name, buttons);

    const body = el(doc, "div", "wm-body");
    const errorBox = el(doc, "div", "wm-error");
    errorBox.hidden = true;
    errorBox.setAttribute("role", "alert");
    const errorText = el(doc, "p", "", "La vue n'a pas pu se charger.");
    const reload = el(doc, "button", "appr-btn appr-once wm-reload", "Recharger");
    reload.type = "button";
    errorBox.append(errorText, reload);

    node.append(header, body, errorBox);
    for (const handle of HANDLES) {
      const grip = el(doc, "span", `wm-grip wm-grip-${handle}`);
      grip.addEventListener("pointerdown", (e) => startResize(windows.get(spec.key), handle, e));
      node.append(grip);
    }
    return { node, header, body, errorBox, reload };
  };

  const open = (spec) => {
    const { rec, created } = stack.open({ key: spec.key, iframe: spec.kind === "iframe" });
    if (!created) {
      focus(spec.key);
      return windows.get(spec.key) ?? null;
    }
    const parts = build(spec);
    const win = {
      spec,
      rec,
      el: parts.node,
      body: parts.body,
      errorBox: parts.errorBox,
      entry: null,
      rect: cascadeFractions(opened),
      px: null,
      animTimer: null,
    };
    opened += 1;
    windows.set(spec.key, win);
    // Identité unique : l'enregistrement d'empilement est posé avant tout contenu.
    if (spec.kind === "iframe") {
      const entry = frames.open(spec.view, spec.frame, spec.mode ?? undefined, parts.body);
      if (!entry) {
        windows.delete(spec.key);
        stack.close(spec.key);
        return null;
      }
      win.entry = entry;
      entry.iframe.addEventListener("load", () => {
        if (!entry.unloaded) win.errorBox.hidden = true;
      });
      parts.reload.addEventListener("click", () => {
        win.errorBox.hidden = true;
        frames.reload(entry);
      });
    } else {
      const native = natives[spec.name];
      if (native) native.mount(parts.body);
      else {
        const wait = el(doc, "div", "wm-wait");
        wait.append(el(doc, "h2", "", spec.title), el(doc, "p", "empty", WAIT_TEXT));
        parts.body.append(wait);
      }
    }
    parts.node.addEventListener("pointerdown", () => focus(spec.key), true);
    parts.header.addEventListener("pointerdown", (e) => startMove(win, e));
    parts.header.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      setMaximized(spec.key, !win.rec.maximized);
    });
    root.insertBefore(parts.node, empty);
    stack.focus(spec.key);
    reconcile();
    return win;
  };

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => applyAll()).observe(root);

  return {
    open,
    focus,
    minimize,
    close,
    tile,
    maximize: (key) => setMaximized(key, true),
    restore: (key) => {
      const win = windows.get(key);
      if (!win) return;
      if (win.rec.maximized) setMaximized(key, false);
      else focus(key);
    },
    /** « Fenêtre suivante » : la moins récemment focalisée passe devant. */
    cycle() {
      const key = stack.cycleTarget();
      if (key !== null) focus(key);
    },
    has: (key) => windows.has(key),
    /** Mode « pile » (téléphone) ou « bureau » ; change l'affichage, jamais la disposition mémorisée. */
    setMode(next) {
      if (next === mode) return;
      mode = next;
      reconcile();
    },
    mode: () => mode,
    /** Fenêtre visible au premier plan (clé), ou `null`. */
    activeKey: () => {
      const top = stack.top();
      return top !== null && isVisible(stack.get(top)) ? top : null;
    },
    /** Le chargement de l'iframe a échoué : cadre d'erreur dans sa fenêtre. */
    setError(key, failed) {
      const win = windows.get(key);
      if (win) win.errorBox.hidden = !failed;
    },
    snapshot,
    /** Ramène toutes les fenêtres dans le bureau (après un redimensionnement du navigateur). */
    refit: applyAll,
  };
}
