(() => {
  // Source unique des pictogrammes : grille 24 px, trait 1,5, extrémités arrondies.
  // Les emplacements <svg data-icon="…"> des pages HTML sont remplis au chargement.
  const ring = (cx, cy, r) => `M${cx + r} ${cy}a${r} ${r} 0 1 1-${r * 2} 0 ${r} ${r} 0 0 1 ${r * 2} 0`;
  const paths = {
    loader: ["M20 12a8 8 0 1 1-8-8"],
    trash: ["M4 7h16", "M9 7V4.5h6V7", "M6 7l1 13h10l1-13", "M10 11v5", "M14 11v5"],
    ban: [ring(12, 12, 9), "m5.6 5.6 12.8 12.8"],
    search: [ring(10.5, 10.5, 6.5), "m15.5 15.5 5 5"],
    file: ["M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z", "M14 3.5V8h4.5"],
    tool: ["M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-4 2-2-2z"],
    terminal: ["m5 8 4 4-4 4", "M12 16h7"],
    folder: ["M3.5 7.5a2 2 0 0 1 2-2H9l2 2h7.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"],
    space: ["m12 3 8 4.5v9L12 21l-8-4.5v-9z", "M4 7.5 12 12l8-4.5", "M12 12v9"],
    image: ["M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5z", "m3.5 16 5-5 4.5 4.5 2.5-2.5 5 5", "M15.5 9h.01"],
    play: ["m8 5 11 7-11 7z"],
    stop: ["M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"],
    link: [
      "m10 13 4-4",
      "M9 15l-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0",
      "m15 9 2-2a3.5 3.5 0 0 1 5 5l-5 5a3.5 3.5 0 0 1-5 0"
    ],
    plus: ["M12 5v14", "M5 12h14"],
    minus: ["M5 12h14"],
    close: ["M6 6l12 12", "M18 6 6 18"],
    fit: ["M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9", "M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9", "M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15", "M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"],
    download: ["M12 4v11", "m7 10 5 5 5-5", "M5 20h14"],
    chevronRight: ["m9 6 6 6-6 6"],
    chevronDown: ["m6 9 6 6 6-6"],
    caret: ["m7 10 5 5 5-5"],
    down: ["M12 5v14", "M5.5 12.5 12 19l6.5-6.5"],
    send: ["M12 19V5", "M5.5 11.5 12 5l6.5 6.5"],
    refresh: ["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"],
    settings: [
      "M10.3 3.5h3.4l.6 2.4 1.7 1 2.4-.7 1.7 2.9-1.8 1.7v2l1.8 1.7-1.7 2.9-2.4-.7-1.7 1-.6 2.4h-3.4l-.6-2.4-1.7-1-2.4.7-1.7-2.9 1.8-1.7v-2L3.9 9.1l1.7-2.9 2.4.7 1.7-1z",
      ring(12, 12, 2.75)
    ],
    sliders: ["M4 7h10M18 7h2M4 17h4M12 17h8", ring(16, 7, 2), ring(10, 17, 2)],
    project: ["M3.5 7.5a2 2 0 0 1 2-2H9l2 2h7.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"],
    book: ["M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1z", "M12 6v14"],
    // Graphe : quatre nœuds ronds reliés par des liens courbes, comme la vue.
    graph: [
      ring(4.5, 12, 2.25),
      ring(12, 6, 2.25),
      ring(12, 18, 2.25),
      ring(19.5, 12, 2.25),
      "M6.4 10.8C7.6 8.3 8.4 7.1 9.8 6.6",
      "M6.4 13.2C7.6 15.7 8.4 16.9 9.8 17.4",
      "M14.2 6.6C15.6 7.1 16.4 8.3 17.6 10.8",
      "M14.2 17.4C15.6 16.9 16.4 15.7 17.6 13.2"
    ],
    server: [
      "M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 19 10.5H5A1.5 1.5 0 0 1 3.5 9V5A1.5 1.5 0 0 1 5 3.5z",
      "M5 13.5h14a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19v-4A1.5 1.5 0 0 1 5 13.5z",
      "M7 7h.01M7 17h.01M11 7h6M11 17h6"
    ],
    shield: ["M12 3 19.5 6v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z", "m9 12 2 2 4-4"],
    check: ["m5 12.5 4.5 4.5L19 7"],
    bolt: ["M13 3 5.5 13.5h6L10.5 21 18 10.5h-6z"],
    clock: [ring(12, 12, 9), "M12 7v5l3 2"],
    copy: ["M9.5 9h9A1.5 1.5 0 0 1 20 10.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 8 19.5v-9A1.5 1.5 0 0 1 9.5 9z", "M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"],
    // Cerveau : deux hémisphères fermés et arrondis, plis intérieurs symétriques.
    brain: [
      "M11.5 5.2C10.6 3.8 8.2 3.6 7.2 5.1 5.3 5.2 4.2 6.9 4.7 8.7 3.3 9.6 3.1 12.2 4.5 13.4 3.9 15.4 5.2 17.4 7.3 17.5 7.8 19.2 10.2 20.3 11.5 19z",
      "M12.5 5.2C13.4 3.8 15.8 3.6 16.8 5.1 18.7 5.2 19.8 6.9 19.3 8.7 20.7 9.6 20.9 12.2 19.5 13.4 20.1 15.4 18.8 17.4 16.7 17.5 16.2 19.2 13.8 20.3 12.5 19z",
      "M7.6 9.3c1.3-.1 2.3.7 2.4 1.9",
      "M16.4 9.3c-1.3-.1-2.3.7-2.4 1.9",
      "M7.4 14.2c1.3-.4 2.6.2 3 1.4",
      "M16.6 14.2c-1.3-.4-2.6.2-3 1.4"
    ],
    history: ["M3.5 12a8.5 8.5 0 1 0 2.5-6", "M3.5 4.5V9H8", "M12 8v4l2.5 1.5"],
    info: [ring(12, 12, 9), "M12 11v5.5M12 7.5h.01"],
    at: [ring(12, 12, 4), "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"],
    hash: ["M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"],
    slash: ["M15 4 9 20"],
    clip: ["m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6L15.5 7"],
    pulse: ["M3 12h4l2.5-6 5 12L17 12h4"],
    sparkle: ["M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9z"]
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ATTRS = {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false"
  };
  const fill = (svg, name) => {
    for (const [key, value] of Object.entries(ATTRS)) svg.setAttribute(key, value);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const d of paths[name] || paths.space) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    svg.dataset.icon = name;
    return svg;
  };
  const create = (name, options) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const className = typeof options === "string" ? options : options?.className;
    svg.setAttribute("class", className || "ico");
    return fill(svg, name);
  };
  for (const slot of document.querySelectorAll("svg[data-icon]")) fill(slot, slot.dataset.icon);
  window.WarbandIcons = Object.freeze({ create, names: Object.freeze(Object.keys(paths)) });
})();
