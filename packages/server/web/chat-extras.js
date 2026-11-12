// Extras de la page de chat web, injectés par le serveur de pages après `chat.js` (même origine, même nonce).
// La page de l'extension (`packages/vscode/media`) reste intacte : ce script s'y accroche par le DOM.
//
// 1. Bouton « Joindre un fichier » à côté du « + » : envoie `attachPick {requestId}` (dialogue de
//    téléversement côté serveur), reçoit `attachmentPicked {requestId, attachment}` ou
//    `attachmentRefused {requestId, reason}`. L'attachement validé est rejoué dans le chemin existant de la
//    page (dépôt d'un fichier sur la zone de saisie) : même contrôle, même pastille, même format de `send`.
//    Rien n'est envoyé sans le clic humain sur « Envoyer » de la page.
// 2. `draft {text}` (mission préremplie) : le texte est posé dans le champ de saisie, jamais envoyé.
//
// Limite connue : le menu `@` de la page coupe sa liste à 20 fichiers alors que le serveur en renvoie 50 ;
// ce script n'y touche pas (le code est dans `media/ui.js`).
(() => {
  const MAX_DRAFT = 4000;
  const MAX_NAME = 180;
  /** Données d'image acceptées avant décodage (5 Mio en binaire, soit environ 6,7 M de caractères base64). */
  const MAX_BASE64 = 7_000_000;
  const PICK_TIMEOUT_MS = 10 * 60 * 1000;

  const REFUSALS = {
    missing: "Le fichier n'a pas été reçu. Réessayez.",
    type: "Type refusé : texte (.txt, .md, .json, .csv, .log) ou image PNG, JPEG, GIF, WebP.",
    size: "Fichier trop volumineux.",
    binary: "Ce fichier n'est pas un texte UTF-8 ni une image valide.",
    empty: "Le fichier est vide.",
  };

  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  const input = document.getElementById("input");
  const menuBtn = document.getElementById("composer-menu-btn");
  const attachBtn = document.getElementById("attach-btn");
  const composer = document.getElementById("composer");
  const status = document.getElementById("attachment-status");
  if (!vscode || !input || !menuBtn || !attachBtn || !composer) return;

  const say = (text) => {
    if (!status) return;
    status.textContent = text;
    status.hidden = text === "";
  };

  // ───────────────────────────── Bouton « Joindre un fichier » ─────────────────────────────

  const pick = document.createElement("button");
  pick.id = "attach-pick-btn";
  pick.type = "button";
  pick.className = "ghost tool-btn";
  pick.title = "Joindre un fichier";
  pick.setAttribute("aria-label", "Joindre un fichier");
  const icon = attachBtn.querySelector("svg");
  if (icon) pick.append(icon.cloneNode(true));
  else pick.textContent = "+";
  menuBtn.after(pick);

  /** Demande en cours : `{ requestId, timer }`, ou `null`. Une seule à la fois. */
  let pending = null;
  let serial = 0;

  const refresh = () => {
    pick.disabled = attachBtn.disabled || pending !== null;
  };
  refresh();
  // Le bouton suit l'état de celui de la page (pas de vue, occupé, lecture seule, sans fournisseur).
  new MutationObserver(refresh).observe(attachBtn, {
    attributes: true,
    attributeFilter: ["disabled"],
  });

  const settle = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    refresh();
  };

  pick.addEventListener("click", () => {
    if (pending !== null || pick.disabled) return;
    serial += 1;
    const requestId = `pick-${Date.now().toString(36)}-${serial}`;
    pending = { requestId, timer: setTimeout(settle, PICK_TIMEOUT_MS) };
    refresh();
    say("");
    vscode.postMessage({ type: "attachPick", requestId });
  });

  const validName = (name) =>
    typeof name === "string" &&
    name.trim() !== "" &&
    name.length <= MAX_NAME &&
    !/[\\/\p{Cc}\p{Cf}]/u.test(name);

  /** Attachement du serveur → `File` (ou `null`), pour le chemin de dépôt de la page. */
  function toFile(attachment) {
    if (attachment === null || typeof attachment !== "object" || !validName(attachment.name)) {
      return null;
    }
    if (typeof attachment.mimeType === "string") {
      const data = attachment.data;
      if (typeof data !== "string" || data.length === 0 || data.length > MAX_BASE64) return null;
      try {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return new File([bytes], attachment.name, { type: attachment.mimeType });
      } catch {
        return null;
      }
    }
    if (typeof attachment.text !== "string") return null;
    return new File([attachment.text], attachment.name, { type: "text/plain" });
  }

  /** Rejoue le fichier comme un dépôt humain sur la zone de saisie : `addFiles` de la page fait le reste. */
  function attach(file) {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      composer.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function onPicked(msg) {
    if (pending === null || msg.requestId !== pending.requestId) return;
    settle();
    const file = toFile(msg.attachment);
    if (file === null || !attach(file)) say("Impossible de joindre ce fichier.");
  }

  function onRefused(msg) {
    if (pending === null || msg.requestId !== pending.requestId) return;
    settle();
    if (msg.reason === "cancelled") return;
    say(Object.hasOwn(REFUSALS, msg.reason) ? REFUSALS[msg.reason] : "Fichier refusé.");
  }

  // ───────────────────────────── Brouillon de mission ─────────────────────────────

  /** Pose le brouillon dans le champ de saisie ; un texte déjà saisi est conservé (le brouillon suit). */
  function onDraft(msg) {
    const text = msg.text;
    if (typeof text !== "string" || text.trim() === "" || text.length > MAX_DRAFT) return;
    if (input.disabled) return;
    input.value = input.value.trim() === "" ? text : `${input.value}\n\n${text}`;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // Messages de la coquille : le pont les rejoue comme des `MessageEvent` sans source ni origine. Tout
  // message réel (autre fenêtre) est ignoré.
  window.addEventListener("message", (event) => {
    if (event.source !== null || event.origin !== "") return;
    const msg = event.data;
    if (msg === null || typeof msg !== "object") return;
    if (msg.type === "attachmentPicked") onPicked(msg);
    else if (msg.type === "attachmentRefused") onRefused(msg);
    else if (msg.type === "draft") onDraft(msg);
  });

  // Ce script se charge après `chat.js` : le `ready` de la page peut donc arriver à la coquille avant que
  // l'écouteur ci-dessus existe. La coquille attend ce message (intercepté, jamais transmis au serveur)
  // pour poser un brouillon.
  vscode.postMessage({ type: "extrasReady" });
})();
