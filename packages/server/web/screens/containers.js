// Écran Conteneurs : tout se fait ici (ADR 0056, 0057). Bandeau d'état de Docker et d'Exegol, installation des
// images Kali et Exegol avec progression par couches, conteneurs (démarrer, arrêter, terminal, fichiers),
// projets groupés par conteneur. Le serveur est l'autorité : l'écran n'accepte aucun contrat, ne supprime
// rien et n'installe rien sans un clic humain. Les refus arrivent en codes (`containerError`, `imageError`,
// `projectError`), traduits par `lib/reasons.js`. Aucune donnée reçue n'est insérée en HTML.
import {
  checkContainerName,
  checkProjectName,
  formatBytes,
  formatSpeed,
  groupProjects,
  installAvailability,
  layerPercent,
  MAX_LAYERS,
  overallPercent,
  parseContainers,
  parseImageProgress,
  parseImages,
  parseProjectList,
  projectCount,
} from "../lib/containers-model.js";
import { reasonText } from "../lib/reasons.js";
import {
  actionButton,
  badge,
  confirmButton,
  el,
  emptyState,
  field,
  row,
  safeText,
  screenRoot,
  statusLine,
  syncOnline,
  table,
  textInput,
} from "./common.js";

export { CONTAINER_NAME, checkContainerName, parseContainers } from "../lib/containers-model.js";
/** Au-delà, une opération sans réponse du serveur redevient possible. */
export const BUSY_MS = 15000;

const COLUMNS = [
  { key: "name", label: "Nom", className: "col-main" },
  { key: "kind", label: "Type" },
  { key: "state", label: "État" },
  { key: "image", label: "Image", className: "col-mono" },
  { key: "folder", label: "Dossier partagé", className: "col-mono" },
  { key: "projects", label: "Projets" },
  { key: "act", label: "Actions", className: "col-act" },
];

/**
 * @param {Document} doc
 * @param {{ send(msg: object): boolean, onOpenWindow?(msg: object): void, onOpenStudio?(): void,
 *   setTimer?: Function, clearTimer?: Function }} deps
 */
export function createContainersScreen(
  doc,
  {
    send,
    onOpenWindow = () => {},
    onOpenStudio = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h),
  },
) {
  const root = screenRoot(doc, "containers", "Conteneurs");
  let online = false;
  let loaded = false;
  let items = [];
  let projects = [];
  /** `null` tant que `images` n'est pas arrivé. */
  let images = null;
  /** Dernière progression reçue (en cours ou terminée) ; `null` hors ligne ou au départ. */
  let progress = null;
  /** Étiquette Exegol demandée par ce clic (la progression ne la porte pas). */
  let progressTag = "";
  /** Demande d'installation partie, progression pas encore reçue. */
  let pendingInstall = null;
  let installError = "";
  let eulaNote = false;
  /** Identifiants de conteneurs dont une opération est en cours : { id → minuterie }. */
  const busy = new Map();
  let creating = null;
  let projectPending = null;
  let projectTarget = "";

  // ── Squelette : bandeau, images, conteneurs, projets ──
  const top = el(doc, "div", "scr-toolbar");
  const refresh = actionButton(doc, "Actualiser", "", () => refreshAll());
  top.append(refresh);
  const globalStatus = statusLine(doc);
  const stateBox = el(doc, "section", "scr-section ctn-state");
  const imagesBox = el(doc, "section", "scr-section ctn-images");
  const containersBox = el(doc, "section", "scr-section ctn-containers");
  const projectsBox = el(doc, "section", "scr-section ctn-projects");
  root.append(top, globalStatus.node, stateBox, imagesBox, containersBox, projectsBox);

  const refreshAll = () => {
    send({ type: "containersList" });
    send({ type: "imagesStatus" });
    send({ type: "projectsList" });
  };

  // Progression : le panneau est reconstruit à chaque message, son en-tête (bouton Annuler) reste stable.
  const progHead = el(doc, "div", "ctn-prog-head");
  const progTitle = el(doc, "p", "scr-strong");
  const progCancel = actionButton(doc, "Annuler", "", () => {
    if (progress === null || progress.id === "") return;
    if (!send({ type: "imageCancel", id: progress.id })) {
      globalStatus.set("Hors ligne : l'annulation n'a pas été transmise.", "err");
      return;
    }
    globalStatus.set("Annulation demandée…", "mute");
  });
  progHead.append(progTitle, progCancel);
  const progBody = el(doc, "div", "ctn-prog-body");
  const progPanel = el(doc, "div", "ctn-prog");
  progPanel.setAttribute("role", "group");
  progPanel.setAttribute("aria-label", "Installation d'image");
  progPanel.hidden = true;
  progPanel.append(progHead, progBody);

  const imageName = () =>
    progress?.kind === "kali"
      ? "l'image Kali"
      : `l'image Exegol${progressTag !== "" ? ` « ${progressTag} »` : ""}`;

  function meter(percent, label) {
    const bar = el(doc, "progress", "ctn-bar");
    bar.max = 100;
    if (percent !== null) bar.value = percent;
    bar.setAttribute("aria-label", label);
    return bar;
  }

  function renderProgress() {
    const a = installAvailability({ online, images, progress, pending: pendingInstall !== null });
    progBody.textContent = "";
    if (progress === null && installError === "" && pendingInstall === null) {
      progPanel.hidden = true;
      return;
    }
    progPanel.hidden = false;
    progCancel.hidden = !(progress?.busy === true);
    progCancel.dataset.lock = a.cancel ? "" : "1";
    if (progress === null) {
      progTitle.textContent = pendingInstall !== null ? "Installation demandée…" : "Installation";
      if (installError !== "") progBody.append(el(doc, "p", "scr-status tone-err", installError));
      syncOnline(root, online);
      return;
    }
    const p = progress;
    progTitle.textContent = p.busy
      ? `Installation de ${imageName()} en cours`
      : p.done
        ? `Installation de ${imageName()} terminée`
        : p.cancelled
          ? "Installation annulée"
          : "Installation interrompue";
    if (p.stage !== "") progBody.append(el(doc, "p", "ctn-stage", p.stage));
    if (p.message !== "") progBody.append(el(doc, "p", "scr-hint", p.message));
    if (p.error !== "" || p.code !== "") {
      progBody.append(
        el(
          doc,
          "p",
          "scr-status tone-err",
          p.code !== "" && !p.code.startsWith("container.") ? reasonText(p.code) : p.error,
        ),
      );
    } else if (p.cancelled) {
      progBody.append(el(doc, "p", "scr-status tone-mute", "L'installation a été annulée."));
    } else if (p.done) {
      progBody.append(el(doc, "p", "scr-status tone-ok", "L'image est installée."));
    }
    if (p.busy) {
      const percent = overallPercent(p.layers);
      progBody.append(
        meter(percent, p.phase === "build" ? "Construction" : "Progression du téléchargement"),
      );
      if (percent !== null) progBody.append(el(doc, "p", "scr-hint", `${percent} % téléchargé`));
      const shown = p.layers.slice(0, MAX_LAYERS);
      if (shown.length > 0) {
        const list = el(doc, "ul", "ctn-layers");
        for (const l of shown) {
          const li = el(doc, "li", "ctn-layer");
          const pct = layerPercent(l);
          li.append(el(doc, "span", "ctn-layer-id", l.id.slice(0, 12)));
          li.append(meter(pct, `Couche ${l.id.slice(0, 12)}`));
          const info = [l.status, pct !== null ? `${pct} %` : "", formatSpeed(l.speed)]
            .filter(Boolean)
            .join(" · ");
          li.append(el(doc, "span", "scr-hint", info));
          list.append(li);
        }
        progBody.append(list);
        if (p.layers.length > shown.length) {
          progBody.append(
            el(doc, "p", "scr-hint", `… et ${p.layers.length - shown.length} autres couches.`),
          );
        }
      }
    }
    syncOnline(root, online);
  }

  // ── Bandeau d'état ──
  function stateItem(label, ok, okText, koText, action) {
    const li = el(doc, "li", "ctn-state-item");
    li.append(badge(doc, label, ok === null ? "mute" : ok ? "ok" : "err"));
    li.append(
      el(doc, "span", "scr-hint", ok === null ? "Lecture en cours…" : ok ? okText : koText),
    );
    if (action && ok === false) li.append(action);
    return li;
  }

  function renderState() {
    stateBox.textContent = "";
    stateBox.append(el(doc, "h2", "scr-h2", "État de Docker et d'Exegol"));
    const list = el(doc, "ul", "ctn-state-list");
    const d = images?.docker;
    const x = images?.exegol;
    list.append(
      stateItem(
        "Docker présent",
        d ? d.present : null,
        "Le client docker est installé sur le serveur.",
        "Le client docker est introuvable sur le serveur : Kali ne peut pas être construit.",
      ),
      stateItem(
        "Démon joignable",
        d ? d.daemon : null,
        "Le démon Docker répond.",
        "Le démon Docker ne répond pas : vérifiez que son socket est monté dans le serveur.",
      ),
      stateItem(
        "Exegol présent",
        x ? x.cli : null,
        "La commande exegol est installée sur le serveur.",
        "La commande exegol est absente du serveur : Exegol n'est pas installable.",
      ),
    );
    const eula = actionButton(doc, "Lire et accepter le contrat Exegol", "scr-btn-primary", () =>
      askEula(),
    );
    list.append(
      stateItem(
        "Contrat Exegol accepté",
        x ? (x.cli ? x.eulaAccepted : null) : null,
        "Le contrat d'utilisation d'Exegol est accepté sur ce serveur.",
        "Sans contrat accepté, Exegol ne s'installe pas et ne se crée pas.",
        eula,
      ),
    );
    stateBox.append(list);
    if (eulaNote) {
      stateBox.append(
        el(
          doc,
          "p",
          "scr-hint",
          "Une fenêtre de confirmation s'est ouverte : lisez le contrat puis répondez-y. Rien n'est accepté sans votre réponse.",
        ),
      );
    }
    controls.push([eula, () => installAvailability(avail()).exegolEula]);
  }

  const controls = [];
  const avail = () => ({
    online,
    images,
    progress,
    pending: pendingInstall !== null,
  });
  /** Applique l'état des boutons dépendant de l'installation (un seul à la fois, hors ligne : rien). */
  function applyControls() {
    for (const [node, enabled] of controls) {
      node.dataset.lock = enabled() ? "" : "1";
    }
    syncOnline(root, online);
  }

  function askEula() {
    if (!send({ type: "exegolEula" })) {
      globalStatus.set("Hors ligne : la demande n'a pas été transmise.", "err");
      return;
    }
    eulaNote = true;
    renderState();
    applyControls();
  }

  function install(request, tag) {
    if (pendingInstall !== null || progress?.busy === true) return;
    if (!send(request)) {
      globalStatus.set("Hors ligne : l'installation n'a pas été transmise.", "err");
      return;
    }
    installError = "";
    progress = null;
    progressTag = tag;
    pendingInstall = setTimer(() => {
      pendingInstall = null;
      renderProgress();
      applyControls();
    }, BUSY_MS);
    renderProgress();
    applyControls();
  }

  const releaseInstall = () => {
    if (pendingInstall !== null) clearTimer(pendingInstall);
    pendingInstall = null;
  };

  // ── Images ──
  function renderImages() {
    imagesBox.textContent = "";
    imagesBox.append(el(doc, "h2", "scr-h2", "Images"));
    imagesBox.append(
      el(
        doc,
        "p",
        "scr-note",
        "Les images se téléchargent depuis cette page, sans terminal. Un seul téléchargement à la fois ; il pèse de plusieurs Go à plusieurs dizaines de Go.",
      ),
    );
    imagesBox.append(progPanel);
    if (images === null) {
      imagesBox.append(emptyState(doc, "Chargement…", "Lecture de l'état des images."));
      return;
    }
    const cards = el(doc, "div", "ctn-cards");
    // Kali
    const kali = el(doc, "article", "ctn-card");
    kali.append(el(doc, "h3", "scr-h3", "Kali Linux"));
    const kState = el(doc, "p", "scr-state");
    kState.append(
      badge(
        doc,
        images.kali.installed ? "installée" : "absente",
        images.kali.installed ? "ok" : "warn",
      ),
    );
    kali.append(kState);
    kali.append(
      el(
        doc,
        "p",
        "scr-hint",
        `${images.kali.image || "image Kali"}${images.kali.installed && images.kali.size !== undefined ? ` · ${formatBytes(images.kali.size)}` : ""}`,
      ),
    );
    const kActions = el(doc, "div", "scr-actions");
    const kInstall = actionButton(doc, "Installer l'image Kali", "scr-btn-primary", () =>
      install({ type: "imageInstall", kind: "kali" }, ""),
    );
    kInstall.hidden = images.kali.installed;
    controls.push([kInstall, () => installAvailability(avail()).kaliInstall]);
    const rebuild = confirmButton(doc, {
      label: "Reconstruire",
      question: "Reconstruire l'image Kali ? Le téléchargement et la construction sont longs.",
      confirmLabel: "Reconstruire",
      onConfirm: () => install({ type: "imageInstall", kind: "kali", rebuild: true }, ""),
    });
    rebuild.hidden = !images.kali.installed;
    for (const b of rebuild.querySelectorAll("button[data-act]")) {
      controls.push([b, () => installAvailability(avail()).kaliRebuild]);
    }
    kActions.append(kInstall, rebuild);
    kali.append(kActions);
    cards.append(kali);
    // Exegol
    const exegol = el(doc, "article", "ctn-card");
    exegol.append(el(doc, "h3", "scr-h3", "Exegol"));
    if (!images.exegol.cli) {
      exegol.append(
        el(doc, "p", "scr-hint", "La commande exegol est absente du serveur : rien à installer."),
      );
    } else if (!images.exegol.eulaAccepted) {
      exegol.append(
        el(
          doc,
          "p",
          "scr-hint",
          "Le contrat d'utilisation d'Exegol doit être accepté avant tout téléchargement.",
        ),
      );
      const eula = actionButton(doc, "Lire et accepter le contrat Exegol", "scr-btn-primary", () =>
        askEula(),
      );
      controls.push([eula, () => installAvailability(avail()).exegolEula]);
      exegol.append(eula);
    }
    const tags = [
      ...new Set([...images.exegol.available, ...images.exegol.installed.map((t) => t.tag)]),
    ];
    if (images.exegol.cli && tags.length > 0) {
      const list = el(doc, "ul", "ctn-tags");
      for (const tag of tags) {
        const have = images.exegol.installed.find((t) => t.tag === tag);
        const li = el(doc, "li", "ctn-tag");
        li.append(el(doc, "span", "ctn-tag-name", tag));
        li.append(
          badge(
            doc,
            have
              ? `installée${have.size !== undefined ? ` · ${formatBytes(have.size)}` : ""}`
              : "non installée",
            have ? "ok" : "mute",
          ),
        );
        if (!have) {
          const btn = actionButton(doc, "Installer", "", () =>
            install({ type: "imageInstall", kind: "exegol", tag }, tag),
          );
          btn.setAttribute("aria-label", `Installer l'image Exegol ${tag}`);
          controls.push([btn, () => installAvailability(avail()).exegolInstall]);
          li.append(btn);
        }
        list.append(li);
      }
      exegol.append(list);
    }
    cards.append(exegol);
    imagesBox.append(cards);
  }

  // ── Conteneurs ──
  const nameInput = textInput(doc, { placeholder: "kali-recon", maxLength: 128 });
  const createBtn = actionButton(doc, "Créer un Kali", "scr-btn-primary", () => {
    const problem = checkContainerName(nameInput.value);
    if (problem !== null) {
      globalStatus.set(problem, "err");
      return;
    }
    if (creating !== null) return;
    if (!send({ type: "containerCreate", kind: "kali", name: nameInput.value.trim() })) {
      globalStatus.set("Hors ligne : la création n'a pas été transmise.", "err");
      return;
    }
    globalStatus.set(
      images?.kali.installed === false
        ? "Création demandée : l'image Kali sera installée d'abord, suivez la progression plus haut."
        : "Création demandée, patientez…",
      "mute",
    );
    creating = setTimer(() => {
      creating = null;
      createBtn.dataset.lock = "";
      syncOnline(root, online);
    }, BUSY_MS);
    createBtn.dataset.lock = "1";
    syncOnline(root, online);
  });
  const createForm = el(doc, "div", "scr-form ctn-create");
  createForm.append(
    field(
      doc,
      "Nom du nouveau conteneur Kali",
      nameInput,
      "Le dossier partagé est créé automatiquement, à partir du nom : containers/<nom>.",
    ),
    createBtn,
  );
  const exegolHint = el(doc, "p", "scr-hint ctn-exegol-hint");
  exegolHint.append(
    "Un conteneur Exegol se crée depuis le Cockpit (VPN, bureau, options). ",
    actionButton(doc, "Ouvrir le Cockpit", "", () => onOpenWindow({ view: "cockpit" })),
  );

  const releaseCreate = () => {
    if (creating !== null) clearTimer(creating);
    creating = null;
    createBtn.dataset.lock = "";
  };
  const release = (id) => {
    const handle = busy.get(id);
    if (handle !== undefined) clearTimer(handle);
    busy.delete(id);
  };

  function renderContainers() {
    containersBox.textContent = "";
    containersBox.append(el(doc, "h2", "scr-h2", "Conteneurs"));
    containersBox.append(createForm, exegolHint);
    if (images !== null && !images.kali.installed) {
      containersBox.append(
        el(
          doc,
          "p",
          "scr-note",
          "L'image Kali n'est pas installée : installez-la dans la section Images, ou créez directement un conteneur (l'installation se fera d'abord).",
        ),
      );
    }
    if (!loaded) {
      containersBox.append(
        emptyState(doc, "Chargement…", "Lecture des conteneurs auprès du serveur."),
      );
      return;
    }
    if (items.length === 0) {
      containersBox.append(
        emptyState(
          doc,
          "Aucun conteneur géré.",
          "Créez un conteneur Kali avec le champ ci-dessus. Son dossier partagé est créé tout seul. Un conteneur Exegol se crée depuis le Cockpit.",
        ),
      );
      return;
    }
    const grouped = groupProjects(projects, items);
    const t = table(doc, COLUMNS, "Conteneurs gérés");
    for (const c of items) {
      const running = c.state === "running";
      const startStop = actionButton(
        doc,
        running ? "Arrêter" : "Démarrer",
        running ? "" : "scr-btn-primary",
        () => {
          if (busy.has(c.id)) return;
          if (!send({ type: running ? "containerStop" : "containerStart", id: c.id })) {
            globalStatus.set("Hors ligne : l'opération n'a pas été transmise.", "err");
            return;
          }
          busy.set(
            c.id,
            setTimer(() => {
              busy.delete(c.id);
              renderContainers();
            }, BUSY_MS),
          );
          renderContainers();
        },
      );
      startStop.setAttribute("aria-label", `${running ? "Arrêter" : "Démarrer"} ${c.name}`);
      if (busy.has(c.id)) startStop.dataset.lock = "1";
      const term = actionButton(doc, "Terminal", "", () =>
        onOpenWindow({ view: "term", container: c.name }),
      );
      term.setAttribute("aria-label", `Ouvrir un terminal dans ${c.name}`);
      if (!running) {
        term.dataset.lock = "1";
        term.title = "Démarrez le conteneur pour ouvrir un terminal.";
      }
      const filesBtn = actionButton(doc, "Fichiers", "", () => onOpenWindow({ view: "files" }));
      filesBtn.setAttribute("aria-label", `Voir les fichiers (${c.name})`);
      const newProject = actionButton(doc, "Nouveau projet", "", () => {
        projectTarget = c.name;
        renderProjects();
        const input = projectsBox.querySelector(".ctn-project-name");
        if (input) {
          input.focus();
          input.scrollIntoView?.({ block: "nearest" });
        }
      });
      newProject.setAttribute("aria-label", `Nouveau projet dans ${c.name}`);
      const acts = el(doc, "div", "scr-actions ctn-acts");
      acts.append(startStop, term, filesBtn, newProject);
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
          c.folder !== "" ? `containers/${c.folder}` : "—",
          String(projectCount(c, grouped)),
          acts,
        ]),
      );
    }
    containersBox.append(t.wrap);
  }

  // ── Projets ──
  const projectName = textInput(doc, { placeholder: "mon-projet", maxLength: 80 });
  projectName.classList.add("ctn-project-name");
  const projectSelect = el(doc, "select", "scr-input ctn-project-container");
  projectSelect.addEventListener("change", () => {
    projectTarget = projectSelect.value;
  });
  const projectBtn = actionButton(doc, "Créer le projet", "scr-btn-primary", () => {
    const problem = checkProjectName(projectName.value);
    if (problem !== null) {
      globalStatus.set(problem, "err");
      return;
    }
    if (projectSelect.value === "") {
      globalStatus.set("Choisissez le conteneur du projet.", "err");
      return;
    }
    if (projectPending !== null) return;
    if (
      !send({
        type: "projectCreate",
        name: projectName.value.trim(),
        container: projectSelect.value,
      })
    ) {
      globalStatus.set("Hors ligne : la création n'a pas été transmise.", "err");
      return;
    }
    globalStatus.set("Création du projet demandée…", "mute");
    projectPending = setTimer(() => {
      projectPending = null;
      projectBtn.dataset.lock = "";
      syncOnline(root, online);
    }, BUSY_MS);
    projectBtn.dataset.lock = "1";
    syncOnline(root, online);
  });
  const projectForm = el(doc, "div", "scr-form ctn-project-form");
  projectForm.append(
    field(doc, "Conteneur du projet", projectSelect),
    field(doc, "Nom du projet", projectName, "Le projet vit dans le dossier partagé du conteneur."),
    projectBtn,
  );
  const releaseProject = () => {
    if (projectPending !== null) clearTimer(projectPending);
    projectPending = null;
    projectBtn.dataset.lock = "";
  };

  function projectRow(p, toLink) {
    const li = el(doc, "li", `ctn-project${toLink ? " is-unlinked" : ""}`);
    li.append(el(doc, "span", "ctn-project-name-text", p.name));
    if (toLink) {
      li.append(badge(doc, "à lier", "warn"));
      const link = actionButton(doc, "Lier à un conteneur", "scr-btn-primary", () => {
        globalStatus.set(
          "Ouverture de Projets et réglages : activez ce projet, une fenêtre vous fera choisir son conteneur. Rien n'est déplacé sans votre réponse.",
          "mute",
        );
        onOpenStudio();
      });
      link.setAttribute("aria-label", `Lier ${p.name} à un conteneur`);
      li.append(link);
    }
    return li;
  }

  function renderProjects() {
    projectsBox.textContent = "";
    projectsBox.append(el(doc, "h2", "scr-h2", "Projets"));
    if (loaded && items.length === 0) {
      projectsBox.append(
        emptyState(
          doc,
          "Créez d'abord un conteneur : un projet vit toujours dans un conteneur.",
          "Créez un conteneur Kali ci-dessus (ou un Exegol depuis le Cockpit), puis ajoutez-y vos projets.",
        ),
      );
    } else {
      projectSelect.textContent = "";
      const placeholder = el(doc, "option", "", "Choisir un conteneur");
      placeholder.value = "";
      projectSelect.append(placeholder);
      for (const c of items) {
        const o = el(doc, "option", "", c.name);
        o.value = c.name;
        projectSelect.append(o);
      }
      projectSelect.value = items.some((c) => c.name === projectTarget) ? projectTarget : "";
      projectsBox.append(projectForm);
    }
    const grouped = groupProjects(projects, items);
    if (grouped.toLink.length > 0) {
      const box = el(doc, "div", "ctn-tolink");
      box.append(
        el(doc, "h3", "scr-h3", `Projets à lier (${grouped.toLink.length})`),
        el(
          doc,
          "p",
          "scr-note",
          "Ces projets existent hors de tout conteneur. Les lier les déplace dans le dossier partagé d'un conteneur : une fenêtre vous demandera de choisir, rien ne bouge sans votre réponse.",
        ),
      );
      const list = el(doc, "ul", "ctn-project-list");
      for (const p of grouped.toLink) list.append(projectRow(p, true));
      box.append(list);
      projectsBox.append(box);
    }
    for (const g of grouped.groups) {
      const box = el(doc, "div", "ctn-group");
      box.append(el(doc, "h3", "scr-h3", `Dans ${g.container}`));
      const list = el(doc, "ul", "ctn-project-list");
      for (const p of g.items) list.append(projectRow(p, false));
      box.append(list);
      projectsBox.append(box);
    }
    if (loaded && items.length > 0 && projects.length === 0) {
      projectsBox.append(
        emptyState(doc, "Aucun projet.", "Choisissez un conteneur et donnez un nom au projet."),
      );
    }
  }

  function renderAll() {
    controls.length = 0;
    renderState();
    renderImages();
    renderContainers();
    renderProjects();
    renderProgress();
    applyControls();
  }
  renderAll();

  return {
    root,
    onMessage(msg) {
      switch (msg.type) {
        case "containers":
          items = parseContainers(msg);
          loaded = true;
          for (const id of [...busy.keys()]) release(id);
          if (creating !== null) nameInput.value = "";
          releaseCreate();
          globalStatus.set("", "mute");
          renderAll();
          break;
        case "containerError":
          // Une erreur lève le verrou de l'opération sans savoir laquelle : tout redevient possible.
          for (const id of [...busy.keys()]) release(id);
          releaseCreate();
          globalStatus.set(reasonText(msg.code), "err");
          renderContainers();
          applyControls();
          break;
        case "projects":
          projects = parseProjectList(msg);
          if (projectPending !== null) {
            projectName.value = "";
            globalStatus.set("Projet créé.", "ok");
          }
          releaseProject();
          renderContainers();
          renderProjects();
          applyControls();
          break;
        case "projectError":
          releaseProject();
          globalStatus.set(reasonText(msg.code), "err");
          applyControls();
          break;
        case "images":
          images = parseImages(msg);
          eulaNote = false;
          renderAll();
          break;
        case "imageProgress": {
          const p = parseImageProgress(msg);
          if (p === null) break;
          releaseInstall();
          installError = "";
          progress = p;
          renderProgress();
          applyControls();
          // Fin d'installation (réussie ou non) : l'état des images est relu.
          if (!p.busy) send({ type: "imagesStatus" });
          break;
        }
        case "imageError": {
          releaseInstall();
          const text =
            typeof msg.code === "string" && msg.code !== "container.failed"
              ? reasonText(msg.code)
              : safeText(msg.text, 400) || reasonText(msg.code);
          installError = text;
          renderProgress();
          applyControls();
          break;
        }
        default:
          break;
      }
    },
    /** Demande les listes (ouverture de la fenêtre, connexion) ; l'état d'installation est relu. */
    refresh: () => refreshAll(),
    setOnline(value) {
      online = value;
      if (!online) {
        // Hors ligne : l'état serveur redevient inconnu, rien n'est rejoué à la reconnexion.
        releaseInstall();
        releaseCreate();
        releaseProject();
        for (const id of [...busy.keys()]) release(id);
        progress = null;
        installError = "";
        eulaNote = false;
        renderAll();
      } else {
        applyControls();
      }
    },
  };
}
