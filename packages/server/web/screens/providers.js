// Écran Fournisseurs : jetons par fournisseur, réserve de clés (ordre, activation manuelle, retrait) et fil
// des bascules automatiques. JAMAIS aucune valeur de clé n'est reçue, rendue ni conservée : le serveur ne
// renvoie que des identifiants, des libellés et des états ; un champ de saisie est vidé dès l'envoi.
import {
  actionButton,
  badge,
  confirmButton,
  el,
  emptyState,
  field,
  formatDate,
  formatTime,
  isRecord,
  safeText,
  screenRoot,
  secretInput,
  statusLine,
  syncOnline,
  textInput,
} from "./common.js";

export const POOL_PROVIDERS = ["claude", "openai", "opencode"];
export const PROVIDER_LABELS = { claude: "Claude", openai: "OpenAI", opencode: "OpenCode" };
/** Types de jeton par fournisseur (miroir de `TOKEN_KINDS`). */
export const TOKEN_KINDS = { claude: ["api-key", "subscription"], openai: ["api-key"] };
const KIND_LABELS = { "api-key": "clé d'API", subscription: "abonnement" };
const STATE_LABELS = { ok: "valide", exhausted: "épuisée", invalid: "invalide" };
const STATE_TONES = { ok: "ok", exhausted: "warn", invalid: "err" };
const REASON_LABELS = {
  quota: "quota atteint",
  rateLimit: "limite de débit",
  auth: "authentification refusée",
};
const PHASE_LABELS = {
  switched: "bascule",
  confirmed: "confirmée",
  failed: "échec",
  exhausted: "réserve épuisée",
};
const PHASE_TONES = { switched: "steel", confirmed: "ok", failed: "err", exhausted: "err" };
export const MAX_FEED = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Message `tokens` → [{ provider, kind, present }]. Le serveur envoie `present`. */
export function parseTokens(msg) {
  if (!isRecord(msg) || !Array.isArray(msg.items)) return [];
  const out = [];
  for (const it of msg.items) {
    if (!isRecord(it) || !Object.hasOwn(TOKEN_KINDS, it.provider)) continue;
    const present = it.present === true;
    const kinds = TOKEN_KINDS[it.provider];
    out.push({
      provider: it.provider,
      present,
      kind: present && kinds.includes(it.kind) ? it.kind : null,
    });
  }
  return out;
}

/** Message `pool` → { provider, active, keys:[{ id, label, state, retryAt }] } ou `null`. */
export function parsePool(msg) {
  if (!isRecord(msg) || !POOL_PROVIDERS.includes(msg.provider) || !Array.isArray(msg.keys))
    return null;
  const keys = [];
  for (const k of msg.keys.slice(0, 32)) {
    if (!isRecord(k) || typeof k.id !== "string" || !UUID.test(k.id)) continue;
    keys.push({
      id: k.id,
      label: safeText(k.label, 40),
      state: Object.hasOwn(STATE_LABELS, k.state) ? k.state : "ok",
      retryAt: typeof k.retryAt === "number" && Number.isFinite(k.retryAt) ? k.retryAt : null,
    });
  }
  const active =
    typeof msg.active === "string" && keys.some((k) => k.id === msg.active) ? msg.active : null;
  return { provider: msg.provider, active, keys };
}

/** Message `poolEvent` → entrée du fil de bascule, ou `null`. Libellés seulement, jamais une valeur. */
export function parsePoolEvent(msg, now = Date.now()) {
  if (!isRecord(msg) || !POOL_PROVIDERS.includes(msg.provider)) return null;
  const phase = Object.hasOwn(PHASE_LABELS, msg.phase) ? msg.phase : null;
  if (phase === null) return null;
  return {
    at: now,
    provider: msg.provider,
    from: typeof msg.from === "string" ? safeText(msg.from, 40) : null,
    to: typeof msg.to === "string" ? safeText(msg.to, 40) : null,
    reason: Object.hasOwn(REASON_LABELS, msg.reason) ? msg.reason : null,
    phase,
  };
}

/** Phrase d'une entrée du fil. */
export function describeEvent(e) {
  const name = PROVIDER_LABELS[e.provider];
  const why = e.reason ? ` (${REASON_LABELS[e.reason]})` : "";
  const from = e.from ? `« ${e.from} »` : "la clé active";
  const to = e.to ? `« ${e.to} »` : "aucune clé disponible";
  if (e.phase === "switched") return `${name} : bascule de ${from} vers ${to}${why}.`;
  if (e.phase === "confirmed") return `${name} : la clé ${to} répond, la mission a repris.`;
  if (e.phase === "failed") return `${name} : la clé ${from} a échoué aussi${why}.`;
  return `${name} : toutes les clés sont épuisées${why}. Arrêt de la mission.`;
}

/** Nouvel ordre après un déplacement d'un cran ; `null` si le déplacement est impossible. */
export function moveKey(order, id, delta) {
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return null;
  const next = [...order];
  next[i] = order[j];
  next[j] = id;
  return next;
}

/** Libellé de la prochaine tentative d'une clé épuisée. */
export const retryLabel = (retryAt) =>
  retryAt === null ? "nouvel essai : date inconnue" : `nouvel essai ${formatDate(retryAt)}`;

/** Vérifie une valeur de clé avant envoi : message d'erreur ou `null` (la valeur n'est jamais copiée). */
export function checkSecret(value) {
  if (value === "") return "Collez la clé dans le champ.";
  if (/\s/.test(value)) return "La clé ne doit contenir aucun espace ni retour à la ligne.";
  return null;
}

/** Libellé d'une clé de réserve : 1 à 40 caractères, sans contrôle ni espace en bordure. */
export function checkLabel(raw) {
  const label = typeof raw === "string" ? raw.trim() : "";
  if (label === "") return "Donnez un libellé à la clé (pour la reconnaître).";
  if (label.length > 40) return "Libellé trop long (40 caractères au plus).";
  for (const ch of label)
    if ((ch.codePointAt(0) ?? 0) < 32) return "Libellé : pas de caractère de contrôle.";
  return null;
}

/**
 * @param {Document} doc
 * @param {{ send(msg: object): boolean, onNotify?(text: string, tone: string): void, onFeed?(text: string, tone: string): void }} deps
 */
export function createProvidersScreen(doc, { send, onNotify = () => {}, onFeed = () => {} }) {
  const root = screenRoot(doc, "providers", "Fournisseurs");
  let online = false;
  let tokens = [];
  let tokensLoaded = false;
  const pools = new Map();
  /** Fil des bascules (le plus récent en premier). */
  let feed = [];

  // ── Jetons ──
  const tokenSection = el(doc, "section", "scr-section");
  tokenSection.append(el(doc, "h2", "scr-h2", "Jetons"));
  tokenSection.append(
    el(
      doc,
      "p",
      "scr-note",
      "Le jeton sert quand aucune réserve n'est configurée. Il est chiffré côté serveur et ne s'affiche jamais.",
    ),
  );
  const tokenList = el(doc, "div", "scr-cards");
  const tokenStatus = statusLine(doc);
  const tProvider = el(doc, "select", "scr-input");
  for (const p of Object.keys(TOKEN_KINDS)) {
    const o = el(doc, "option", "", PROVIDER_LABELS[p]);
    o.value = p;
    tProvider.append(o);
  }
  const tKind = el(doc, "select", "scr-input");
  const fillKinds = () => {
    tKind.textContent = "";
    for (const k of TOKEN_KINDS[tProvider.value]) {
      const o = el(doc, "option", "", KIND_LABELS[k]);
      o.value = k;
      tKind.append(o);
    }
  };
  fillKinds();
  tProvider.addEventListener("change", fillKinds);
  const tValue = secretInput(doc, "Collez le jeton");
  const tSave = actionButton(doc, "Enregistrer le jeton", "scr-btn-primary", () => {
    const problem = checkSecret(tValue.value);
    if (problem !== null) {
      tokenStatus.set(problem, "err");
      return;
    }
    const ok = send({
      type: "tokenSet",
      provider: tProvider.value,
      kind: tKind.value,
      value: tValue.value,
    });
    // Vidé dans tous les cas : la valeur ne reste pas dans la page.
    tValue.value = "";
    tokenStatus.set(
      ok ? "Jeton transmis." : "Hors ligne : le jeton n'a pas été transmis.",
      ok ? "ok" : "err",
    );
  });
  const tokenForm = el(doc, "div", "scr-form");
  tokenForm.append(
    field(doc, "Fournisseur", tProvider),
    field(doc, "Type", tKind),
    field(doc, "Jeton", tValue),
    tSave,
  );
  tokenSection.append(tokenList, tokenForm, tokenStatus.node);

  // ── Réserve ──
  const poolSection = el(doc, "section", "scr-section");
  poolSection.append(el(doc, "h2", "scr-h2", "Réserve de clés"));
  poolSection.append(
    el(
      doc,
      "p",
      "scr-note",
      "Quand la clé active atteint sa limite, RedWidow bascule sur la suivante dans l'ordre ci-dessous et relance la mission. Les clés ne s'affichent jamais.",
    ),
  );
  const poolBody = el(doc, "div", "scr-pools");
  poolSection.append(poolBody);

  // ── Fil des bascules ──
  const feedSection = el(doc, "section", "scr-section");
  feedSection.append(el(doc, "h2", "scr-h2", "Fil des bascules"));
  const feedBody = el(doc, "ol", "scr-feed");
  feedBody.setAttribute("aria-live", "polite");
  const feedEmpty = emptyState(
    doc,
    "Aucune bascule depuis l'ouverture de cette page.",
    "Les bascules automatiques de clés apparaîtront ici, avec leur cause (quota, limite de débit, authentification).",
  );
  feedSection.append(feedEmpty, feedBody);

  root.append(tokenSection, poolSection, feedSection);

  function renderTokens() {
    tokenList.textContent = "";
    if (!tokensLoaded) {
      tokenList.append(emptyState(doc, "Chargement…", "Lecture des jetons auprès du serveur."));
      return;
    }
    for (const t of tokens) {
      const card = el(doc, "div", "scr-card");
      card.append(el(doc, "strong", "scr-card-title", PROVIDER_LABELS[t.provider]));
      card.append(
        t.present
          ? badge(doc, t.kind ? KIND_LABELS[t.kind] : "présent", "ok")
          : badge(doc, "absent", "mute"),
      );
      if (t.present) {
        card.append(
          confirmButton(doc, {
            label: "Supprimer",
            question: `Supprimer le jeton ${PROVIDER_LABELS[t.provider]} ?`,
            confirmLabel: "Supprimer",
            onConfirm: () => {
              if (!send({ type: "tokenDelete", provider: t.provider }))
                tokenStatus.set("Hors ligne : la suppression n'a pas été transmise.", "err");
            },
          }),
        );
      }
      tokenList.append(card);
    }
    syncOnline(root, online);
  }

  function renderPool(provider) {
    const section = poolBody.querySelector(`[data-provider="${provider}"]`);
    if (section === null) return;
    const pool = pools.get(provider) ?? { active: null, keys: [] };
    section.textContent = "";
    const head = el(doc, "div", "scr-pool-head");
    head.append(el(doc, "h3", "scr-h3", PROVIDER_LABELS[provider]));
    head.append(
      pool.keys.length === 0
        ? badge(doc, "aucune clé", "mute")
        : badge(doc, `${pool.keys.length} clé${pool.keys.length > 1 ? "s" : ""}`, "steel"),
    );
    section.append(head);
    if (pool.keys.length === 0) {
      section.append(
        el(
          doc,
          "p",
          "scr-note",
          "Réserve vide : le jeton du fournisseur est utilisé seul. Ajoutez au moins deux clés pour activer la bascule.",
        ),
      );
    } else {
      const list = el(doc, "ol", "scr-keys");
      const order = pool.keys.map((k) => k.id);
      pool.keys.forEach((k, index) => {
        const li = el(doc, "li", `scr-key${k.id === pool.active ? " is-active" : ""}`);
        li.append(el(doc, "span", "scr-key-rank", String(index + 1)));
        li.append(el(doc, "span", "scr-key-label", k.label));
        const meta = el(doc, "span", "scr-key-meta");
        if (k.id === pool.active) meta.append(badge(doc, "active", "crimson"));
        meta.append(badge(doc, STATE_LABELS[k.state], STATE_TONES[k.state]));
        if (k.state === "exhausted")
          meta.append(el(doc, "span", "scr-hint", retryLabel(k.retryAt)));
        li.append(meta);
        const acts = el(doc, "span", "scr-key-acts");
        const up = actionButton(doc, "Monter", "scr-btn-icon", () => {
          const next = moveKey(order, k.id, -1);
          if (next !== null) send({ type: "poolReorder", provider, order: next });
        });
        up.setAttribute("aria-label", `Monter ${k.label}`);
        up.disabled = index === 0;
        const down = actionButton(doc, "Descendre", "scr-btn-icon", () => {
          const next = moveKey(order, k.id, 1);
          if (next !== null) send({ type: "poolReorder", provider, order: next });
        });
        down.setAttribute("aria-label", `Descendre ${k.label}`);
        up.dataset.edge = index === 0 ? "1" : "";
        down.dataset.edge = index === order.length - 1 ? "1" : "";
        acts.append(up, down);
        if (k.id !== pool.active) {
          const use = actionButton(doc, "Activer", "", () =>
            send({ type: "poolActivate", provider, id: k.id }),
          );
          use.setAttribute("aria-label", `Activer ${k.label}`);
          acts.append(use);
        }
        acts.append(
          confirmButton(doc, {
            label: "Retirer",
            question: `Retirer « ${k.label} » ?`,
            confirmLabel: "Retirer",
            onConfirm: () => send({ type: "poolRemove", provider, id: k.id }),
          }),
        );
        li.append(acts);
        list.append(li);
      });
      section.append(list);
    }
    // Ajout.
    const label = textInput(doc, { placeholder: "libellé (ex. clé équipe)", maxLength: 40 });
    const value = secretInput(doc, "Collez la clé");
    const status = statusLine(doc);
    const add = actionButton(doc, "Ajouter à la réserve", "scr-btn-primary", () => {
      const problem = checkLabel(label.value) ?? checkSecret(value.value);
      if (problem !== null) {
        status.set(problem, "err");
        return;
      }
      const ok = send({ type: "poolAdd", provider, label: label.value.trim(), value: value.value });
      value.value = "";
      if (ok) label.value = "";
      status.set(
        ok ? "Clé transmise." : "Hors ligne : la clé n'a pas été transmise.",
        ok ? "ok" : "err",
      );
    });
    const form = el(doc, "div", "scr-form");
    form.append(field(doc, "Libellé", label), field(doc, "Clé", value), add);
    section.append(form, status.node);
    syncOnline(root, online);
    // Les boutons de bord (Monter en tête, Descendre en queue) restent inactifs.
    for (const b of section.querySelectorAll('[data-edge="1"]')) b.disabled = true;
  }

  for (const provider of POOL_PROVIDERS) {
    const section = el(doc, "div", "scr-pool");
    section.dataset.provider = provider;
    poolBody.append(section);
  }

  function renderFeed() {
    feedBody.textContent = "";
    feedEmpty.hidden = feed.length > 0;
    for (const e of feed) {
      const li = el(doc, "li", `scr-feed-item tone-${PHASE_TONES[e.phase]}`);
      li.append(
        el(doc, "time", "scr-feed-time", formatTime(e.at)),
        badge(doc, PHASE_LABELS[e.phase], PHASE_TONES[e.phase]),
        el(doc, "span", "scr-feed-text", describeEvent(e)),
      );
      feedBody.append(li);
    }
  }

  renderTokens();
  for (const p of POOL_PROVIDERS) renderPool(p);
  renderFeed();

  return {
    root,
    onMessage(msg) {
      if (msg.type === "tokens") {
        tokens = parseTokens(msg);
        tokensLoaded = true;
        renderTokens();
      } else if (msg.type === "pool") {
        const pool = parsePool(msg);
        if (pool === null) return;
        pools.set(pool.provider, pool);
        renderPool(pool.provider);
      } else if (msg.type === "poolEvent") {
        const entry = parsePoolEvent(msg);
        if (entry === null) return;
        feed = [entry, ...feed].slice(0, MAX_FEED);
        renderFeed();
        const text = describeEvent(entry);
        onFeed(text, PHASE_TONES[entry.phase]);
        if (entry.phase === "switched") onNotify(text, "steel");
        else if (entry.phase === "failed") onNotify(text, "err");
      } else if (msg.type === "poolExhausted") {
        if (!POOL_PROVIDERS.includes(msg.provider)) return;
        const when =
          typeof msg.nextRetryAt === "number"
            ? `, prochain essai ${formatDate(msg.nextRetryAt)}`
            : "";
        onNotify(
          `Réserve ${PROVIDER_LABELS[msg.provider]} épuisée${when}. La mission est arrêtée.`,
          "err",
        );
      } else if (
        msg.type === "configError" &&
        [
          "tokenSet",
          "tokenDelete",
          "poolAdd",
          "poolRemove",
          "poolReorder",
          "poolActivate",
        ].includes(msg.op)
      ) {
        tokenStatus.set(
          "Le serveur a refusé l'opération (clé en double, limite atteinte ou valeur invalide).",
          "err",
        );
        onNotify("Fournisseurs : opération refusée par le serveur.", "err");
      }
    },
    refresh() {
      send({ type: "tokens" });
      send({ type: "poolList" });
    },
    setOnline(value) {
      online = value;
      syncOnline(root, online);
      for (const b of root.querySelectorAll('[data-edge="1"]')) b.disabled = true;
    },
  };
}
