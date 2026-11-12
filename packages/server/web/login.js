// Page de connexion : aucun script ni style inline (CSP stricte, nonce sur la balise script).
const form = document.getElementById("login");
const field = document.getElementById("password");
const errorBox = document.getElementById("error");

function show(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: field.value }),
    });
    if (res.status === 204) {
      field.value = "";
      // Lien profond conservé par la coquille quand la session a expiré (seulement #w=…).
      let next = "";
      try {
        next = sessionStorage.getItem("rw:next") ?? "";
        sessionStorage.removeItem("rw:next");
      } catch {
        // Stockage bloqué : retour à l'accueil.
      }
      location.assign(/^#w=[A-Za-z0-9:_-]{1,80}$/.test(next) ? `/${next}` : "/");
      return;
    }
    if (res.status === 429) {
      const wait = res.headers.get("Retry-After");
      show(`Trop de tentatives : réessayez dans ${wait ?? "quelques"} s.`);
    } else if (res.status === 401) {
      show("Mot de passe incorrect.");
    } else {
      show("Connexion impossible.");
    }
  } catch {
    show("Serveur injoignable.");
  }
});
