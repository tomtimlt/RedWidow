// Écran Conteneurs : liste des conteneurs gérés par warband (Kali, Exegol), démarrage, arrêt et création
// d'un Kali. Le serveur diffuse `containers` après chaque changement ; un refus arrive en `containerError`
// avec un code de raison seulement (jamais le message brut du démon).
import {
  actionButton,
  badge,
  el,
  emptyState,
  field,
  isRecord,
  reasonText,
  row,
  safeText,
  screenRoot,
  statusLine,
  syncOnline,
  table,
  textInput,
} from "./common.js";

/** Nom ou identifiant de conteneur accepté par le serveur (miroir de `CONTAINER_REF`). */
export const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const KINDS = ["kali", "exegol", "autre"];
/** Au-delà, une opération sans réponse du serveur redevient possible. */
export const BUSY_MS = 15000;

/** Message `containers` → éléments lisibles (entrées illisibles écartées). */
export function parseContainers(msg) {
  if (!isRecord(msg) || !Array.isArray(msg.items)) return [];
  const out = [];
  for (const it of msg.items.slice(0, 500)) {
    if (!isRecord(it) || typeof it.id !== "string" || it.id === "") continue;
    out.push({
      id: it.id,
      name: safeText(it.name, 128) || it.id.slice(0, 12),
      image: safeText(it.image, 200),
      state: it.state === "running" ? "running" : "stopped",
      kind: KINDS.includes(it.kind) ? it.kind : "autre",
      project: typeof it.project === "string" ? safeText(it.project, 64) : "",
    });
  }
  return out;
}

/** Vérifie le nom saisi pour un nouveau Kali : message d'erreur ou `null`. */
export function checkContainerName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return "Donnez un nom au conteneur.";
  if (!CONTAINER_NAME.test(name))
    return "Nom refusé : lettres, chiffres, « _ », « . » et « - », sans tiret initial (128 caractères au plus).";
  return null;
}

const COLUMNS = [
  { key: "name", label: "Nom", className: "col-main" },
  { key: "kind", label: "Type" },
  { key: "state", label: "État" },
  { key: "image", label: "Image", className: "col-mono" },
  { key: "project", label: "Projet" },
  { key: "act", label: "Action", className: "col-act" },
];

/**
 * @param {Document} doc
 * @param {{ send(msg: object): boolean, setTimer?: Function, clearTimer?: Function }} deps
 */
export function createContainersScreen(
  doc,
  { send, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) },
) {
  const root = screenRoot(doc, "containers", "Conteneurs");
  let items = [];
  let online = false;
  let loaded = false;
  /** Identifiants dont une opération est en cours : { id → minuterie }. */
  const busy = new Map();
  let creating = null;

  const bar = el(doc, "div", "scr-toolbar");
  const nameInput = textInput(doc, { placeholder: "kali-recon", maxLength: 128 });
  const create = actionButton(doc, "Créer un Kali", "scr-btn-primary", () => {
    const problem = checkContainerName(nameInput.value);
    if (problem !== null) {
      status.set(problem, "err");
      return;
    }
    if (creating !== null) return;
    if (!send({ type: "containerCreate", kind: "kali", name: nameInput.value.trim() })) {
      status.set("Hors ligne : la création n'a pas été transmise.", "err");
      return;
    }
    status.set("Création demandée, patientez…", "mute");
    creating = setTimer(() => {
      creating = null;
      create.dataset.lock = "";
      syncOnline(root, online);
    }, BUSY_MS);
    create.dataset.lock = "1";
    syncOnline(root, online);
  });
  const refresh = actionButton(doc, "Actualiser", "", () => send({ type: "containersList" }));
  bar.append(
    field(doc, "Nouveau conteneur Kali", nameInput, "Image Kali locale de RedWidow."),
    create,
    refresh,
  );
  const status = statusLine(doc);

  const body = el(doc, "div", "scr-body");
  root.append(bar, status.node, body);

  const releaseCreate = () => {
    if (creating !== null) clearTimer(creating);
    creating = null;
    create.dataset.lock = "";
  };

  const release = (id) => {
    const handle = busy.get(id);
    if (handle !== undefined) clearTimer(handle);
    busy.delete(id);
  };

  function render() {
    body.textContent = "";
    if (!loaded) {
      body.append(emptyState(doc, "Chargement…", "Lecture des conteneurs auprès du serveur."));
    } else if (items.length === 0) {
      body.append(
        emptyState(
          doc,
          "Aucun conteneur géré.",
          "Créez un conteneur Kali avec le champ ci-dessus. Un conteneur Exegol se crée avec sa propre commande, puis apparaît ici.",
        ),
      );
    } else {
      const t = table(doc, COLUMNS, "Conteneurs gérés");
      for (const c of items) {
        const running = c.state === "running";
        const act = actionButton(
          doc,
          running ? "Arrêter" : "Démarrer",
          running ? "" : "scr-btn-primary",
          () => {
            if (busy.has(c.id)) return;
            if (!send({ type: running ? "containerStop" : "containerStart", id: c.id })) {
              status.set("Hors ligne : l'opération n'a pas été transmise.", "err");
              return;
            }
            busy.set(
              c.id,
              setTimer(() => {
                busy.delete(c.id);
                render();
              }, BUSY_MS),
            );
            render();
          },
        );
        act.setAttribute("aria-label", `${running ? "Arrêter" : "Démarrer"} ${c.name}`);
        if (busy.has(c.id)) act.dataset.lock = "1";
        t.tbody.append(
          row(doc, COLUMNS, [
            c.name,
            badge(
              doc,
              c.kind,
              c.kind === "kali" ? "crimson" : c.kind === "exegol" ? "steel" : "mute",
            ),
            badge(doc, running ? "en cours" : "arrêté", running ? "ok" : "mute"),
            c.image || "—",
            c.project || "—",
            act,
          ]),
        );
      }
      body.append(t.wrap);
    }
    syncOnline(root, online);
  }
  render();

  return {
    root,
    onMessage(msg) {
      if (msg.type === "containers") {
        items = parseContainers(msg);
        loaded = true;
        for (const id of [...busy.keys()]) release(id);
        releaseCreate();
        status.set("", "mute");
        render();
      } else if (msg.type === "containerError") {
        // Une erreur lève le verrou de l'opération sans savoir laquelle : tout redevient possible.
        for (const id of [...busy.keys()]) release(id);
        releaseCreate();
        status.set(reasonText(msg.code), "err");
        render();
      }
    },
    /** Demande la liste (ouverture de la fenêtre, connexion). */
    refresh: () => send({ type: "containersList" }),
    setOnline(value) {
      online = value;
      syncOnline(root, online);
    },
  };
}
