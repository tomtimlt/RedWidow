(() => {
  const paths = {
    trash: ["M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"],
    ban: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "m6 6 12 12"],
    search: ["M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14", "m15 15 6 6"],
    file: ["M5 3h9l5 5v13H5z", "M14 3v6h5"],
    tool: ["M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-4 2-2-2z"],
    terminal: ["m5 7 5 5-5 5", "M13 17h6"],
    folder: ["M3 7V5h6l2 2h10v12H3z"],
    space: ["m12 3 9 5v8l-9 5-9-5V8z", "m3 8 9 5 9-5", "M12 13v8"],
    image: ["M3 4h18v16H3z", "m3 16 6-6 5 5 3-3 4 4", "M16 8h.01"],
    play: ["m8 5 11 7-11 7z"],
    stop: ["M6 6h12v12H6z"],
    link: [
      "m10 13 4-4",
      "M9 15l-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0",
      "m15 9 2-2a3.5 3.5 0 0 1 5 5l-5 5a3.5 3.5 0 0 1-5 0"
    ],
    plus: ["M12 5v14", "M5 12h14"],
    minus: ["M5 12h14"],
    fit: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
    download: ["M12 4v11", "m7 10 5 5 5-5", "M5 20h14"],
    close: ["m6 6 12 12", "M18 6 6 18"],
    chevronRight: ["m9 5 7 7-7 7"],
    chevronDown: ["m5 9 7 7 7-7"],
    caret: ["m7 10 5 5 5-5"],
    refresh: ["M20 7v5h-5", "M4 17v-5h5", "M6 6a8 8 0 0 1 13 3", "M18 18A8 8 0 0 1 5 15"],
    settings: [
      "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3z",
      "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6"
    ],
    sliders: ["M4 7h7m4 0h5M4 17h3m4 0h9", "M11 4v6M7 14v6"],
    project: ["M3 7h6l2 2h10v11H3z", "M3 7V4h7l2 3"],
    book: ["M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1z", "M12 6v14"],
    graph: ["M5 12h5m4-7-4 7 4 7", "M2 10h4v4H2zM16 3h4v4h-4zM16 17h4v4h-4z", "M14 5h2m-2 14h2"],
    server: ["M3 3h18v7H3zM3 14h18v7H3z", "M7 6.5h.01M7 17.5h.01M11 6.5h6m-6 11h6"],
    shield: ["m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z", "m8 12 3 3 5-6"],
    check: ["m5 12 4 4L19 6"],
    clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M12 7v5l3 2"],
    copy: ["M9 9h11v11H9z", "M5 15H3V3h12v2"],
    brain: [
      "M12 5v14",
      "M8 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 2 5 3 3 0 0 0 6 2",
      "M16 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-2 5 3 3 0 0 1-6 2"
    ],
    history: ["M3 5v5h5", "M4 9a8 8 0 1 1 1 8", "M12 7v5l3 2"],
    info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M12 11v6M12 7h.01"],
    at: ["M16 8v7c0 3 5 2 5-3a9 9 0 1 0-4 7", "M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0"],
    hash: ["M10 3 8 21M16 3l-2 18M4 9h16M3 15h16"],
    slash: ["M15 4 9 20"],
    clip: ["m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8"],
    pulse: ["M2 12h5l3-8 4 16 3-8h5"],
    send: ["m3 3 19 9-19 9 4-9z", "M7 12h15"],
    sparkle: ["m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"]
  };
  paths.graph = paths.graph;
  const create = (name, options) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const className = typeof options === "string" ? options : options?.className;
    const attrs = {
      class: className || "ico",
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
    for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
    for (const d of paths[name] || paths.space) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  };
  window.WarbandIcons = Object.freeze({ create });
})();
