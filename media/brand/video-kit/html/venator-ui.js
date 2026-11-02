// Venator Ops UI components for video: restores scroll positions saved in the
// snapshots and exposes small helpers for GSAP timelines. No network, no state.
(function () {
  function restore(root) {
    (root || document).querySelectorAll("[data-scroll-top]").forEach(function (el) {
      el.scrollTop = Number(el.getAttribute("data-scroll-top")) || 0;
    });
  }
  // Sets the effort slider position (0 to 1) and the max state.
  function effort(root, value) {
    var scale = (root || document).querySelector("#effort-scale");
    if (!scale) return;
    scale.style.setProperty("--jn-progress", String(value));
    scale.classList.toggle("is-max", value >= 0.999);
  }
  window.VenatorUI = { restore: restore, effort: effort };
  if (document.readyState !== "loading") restore();
  else document.addEventListener("DOMContentLoaded", function () { restore(); });
})();
