# Venator Ops UI components (HTML, for video)

Static snapshots of the real Venator Ops interface (real DOM + real CSS), in
English, on the fictional lab. No network, no app logic. They stay sharp at any
zoom and every part can be animated with GSAP.

## How to use in a HyperFrames composition

1. Link the stylesheet once: `<link rel="stylesheet" href="html/css/venator-ui.css">`
   (fonts load from `html/css/fonts/`, Geist and Geist Mono, OFL).
2. Copy the markup between `<!-- component:start -->` and `<!-- component:end -->`
   of a component into your scene. Each component is one root element with a
   fixed `width`/`height` (`.vo-ui` for app views, `.vo-term` for the terminal).
   Scale it with a CSS `transform` on a parent, never by changing its width.
3. Include `html/venator-ui.js` once: it restores the saved scroll positions
   (`[data-scroll-top]`) and gives `VenatorUI.effort(root, 0..1)` to move the
   effort slider. If you clone a component at runtime, call
   `VenatorUI.restore(root)` on the clone.
4. Use one component per scene, or give each instance its own parent: several
   share element ids (`#log`, `#effort-scale`), so scope selectors to the parent
   (`scene.querySelector(...)`), never `document.querySelector`.

## Components

| File | Size (px) | Content |
| --- | --- | --- |
| `chat-approval-wide.html` | 980 × 640 | chat: header, mission rail, three tool calls, authorization card, composer |
| `chat-approval-tall.html` | 470 × 849 | same scene, side-panel width (9:16) |
| `chat-learning.html` | 470 × 690 | Learning mode: course + terminal read, hint answer |
| `monitor.html` | 981 × 340 | Monitor: header, timeline, ffuf output lines |
| `killchain.html` | 981 × 450 | kill chain graph, green selected path, legend |
| `configure.html` | 340 × 301 | Configure menu, effort slider at maximum |
| `appearance.html` | 1100 × 560 | Settings → Appearance, five color sets |
| `terminal.html` | 560 × 690 | Kali terminal over SSH to the lab, `sudo -l` line highlighted |

## Selectors worth animating

**Chat** (`chat-*`)
- `#bar` header, `.brand` logo (parts `.brand-wing`, `.brand-lead`, `.brand-node`)
- `#mission .mission-step` (4 steps; classes `is-done`, `is-wait`, `is-todo`)
- `.tool-group .tool` (tool call rows), `.tool-name`, `.tool-summary`, `.tool-state`
- `.card` authorization card: `.card-head`, `.card-risks .card-risk` (chips),
  `.card-grid` (tool / action / reason), `.card-buttons button` (Allow once, Deny, Always)
- `#thinking` (waiting line), `#composer` (prompt box)
- `.msg.user`, `.msg-row.agent .msg` (messages), `.md-h`, `li`, `code`

**Monitor** (`monitor.html`)
- `.mon-head`, `.mon-tick` (timeline ticks), `.mon-row` (entries), `.mon-space`
  (kali-1 pill), `.mon-line` (output lines, numbered)

**Kill chain** (`killchain.html`)
- `.kc-node` (7 nodes; `is-complete`, `is-planned`, `is-failed`), `.kc-node-label`, `.kc-node-meta`
- `.kc-edge.is-path` (green dashed path), `.kc-edge` (others), `.kc-tip` (arrow heads)
- legend: `.kc-legend-item`

**Configure** (`configure.html`)
- `#effort-scale` (`VenatorUI.effort(root, value)`; `is-max` shows the moving gradient),
  `.effort-knob`, `.effort-notch`, `#effort-label`, `.cfg-switch-label` (Learning, Approval bypass)

**Appearance** (`appearance.html`)
- `.pal-card` (5 cards, `aria-checked="true"` on the selected one), `.pal-sw` swatches,
  `.pal-bar-fill`, `.pal-bar-knob`

**Terminal** (`terminal.html`)
- `.ln` (one per line, in order), `.ln.hl` (the useful `sudo -l` line),
  `.cmd` (typed command text inside a prompt line, good for a typing effect), `.cur` (cursor)

## Rules

- Do not change any text inside a component (only `#effort-label` may step
  through Low, Medium, High, Extra, Maximum while the slider moves).
- Animate opacity, transforms, clip-path, masks, class toggles and the
  `--jn-progress` variable; do not restyle colors or fonts.
- The interface is shown with English labels for the campaign; the shipped
  extension currently uses French labels.
