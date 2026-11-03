// RedWidow UI components for video: restores scroll positions saved in the
// snapshots and exposes small helpers for GSAP timelines. No network, no state.
(function () {
  function restore(root) {
    (root || document).querySelectorAll("[data-scroll-top]").forEach(function (el) {
      el.scrollTop = Number(el.getAttribute("data-scroll-top")) || 0;
    });
  }
  function ui(root) {
    return root && root.classList && root.classList.contains("vo-ui") ? root : (root || document).querySelector(".vo-ui");
  }
  // Sets the effort slider position (0 to 1) and the max state.
  function effort(root, value) {
    var scale = (root || document).querySelector("#effort-scale");
    if (!scale) return;
    scale.style.setProperty("--jn-progress", String(value));
    scale.classList.toggle("is-max", value >= 0.999);
  }
  // Switches the color set of a component (see brand.json for the 23 ids).
  function palette(root, id) {
    var el = ui(root);
    if (el) el.setAttribute("data-palette", id);
  }
  // Learning mode: the spider studies (book, reading eyes, crosshair off).
  function learning(root, on) {
    var el = ui(root);
    if (el) el.classList.toggle("learning", !!on);
  }
  // Approval bypass: rotating aura and moving gradients in the palette colors.
  function bypass(root, on) {
    var el = ui(root);
    if (el) el.classList.toggle("automatic-on", !!on);
  }
  // Agent activity: the small spiders walk and their brain pulses.
  function running(root, on) {
    var el = ui(root);
    if (el) el.classList.toggle("running", !!on);
  }
  window.RedWidowUI = { restore: restore, effort: effort, palette: palette, learning: learning, bypass: bypass, running: running };
  if (document.readyState !== "loading") restore();
  else document.addEventListener("DOMContentLoaded", function () { restore(); });
})();
