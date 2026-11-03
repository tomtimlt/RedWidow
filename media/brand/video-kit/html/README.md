# RedWidow UI components (HTML, for video)

Static snapshots of the real RedWidow interface (real DOM + real CSS), in
English, on the fictional lab. No network, no app logic. They stay sharp at any
zoom, every part can be animated with GSAP, and the CSS animations of the
product (walking spiders, studying spider, rotating bypass aura, effort wave)
play by themselves.

## How to use in a HyperFrames composition

1. Link the stylesheet once: `<link rel="stylesheet" href="html/css/redwidow-ui.css">`
   (fonts load from `html/css/fonts/`: Geist and JetBrains Mono, OFL; the CSS
   declares them as “Warband Geist” and “Warband JetBrains Mono”).
2. Copy the markup between `<!-- component:start -->` and `<!-- component:end -->`
   of a component into your scene. Each component is one root element with a
   fixed `width`/`height` (`.vo-ui` for app views, `.vo-term` for the terminal).
   Scale it with a CSS `transform` on a parent, never by changing its width.
3. Include `html/redwidow-ui.js` once. It restores the saved scroll positions
   (`[data-scroll-top]`) and gives small helpers, each taking the component
   root (or any parent):
   - `RedWidowUI.effort(root, 0..1)` moves the effort slider (`1` starts the wave);
   - `RedWidowUI.palette(root, id)` switches the color set (ids in `brand.json`);
   - `RedWidowUI.learning(root, true)` makes the spider study (book, eyes reading, crosshair off);
   - `RedWidowUI.bypass(root, true)` turns on the bypass look (rotating aura, moving gradients);
   - `RedWidowUI.running(root, true)` makes the small spiders walk.
   If you clone a component at runtime, call `RedWidowUI.restore(root)` on the clone.
4. Use one component per scene, or give each instance its own parent: several
   share element ids (`#log`, `#effort-scale`), so scope selectors to the parent
   (`scene.querySelector(...)`), never `document.querySelector`.

## Components

| File | Size (px) | Content |
| --- | --- | --- |
| `welcome.html` | 470 × 690 | welcome screen: animated spider (legs unfold, brain lights up, crosshair locks, eyes blink), examples, composer |
| `welcome-learning.html` | 470 × 690 | same, Learning mode: the spider studies (open book, eyes reading, page turning, crosshair off) |
| `chat-approval-wide.html` | 980 × 640 | chat: header with the small spider, mission rail, tool calls, authorization card, composer |
| `chat-approval-tall.html` | 470 × 849 | same scene, side-panel width (9:16) |
| `chat-learning.html` | 470 × 690 | Learning mode: course + terminal read, hint answer |
| `chat-bypass.html` | 980 × 640 | bypass on: rotating aura around the view, gradient badge “Bypass 1:58”, gradient composer border, findings report |
| `monitor.html` | 981 × 340 | Monitor: header, timeline, ffuf output lines |
| `killchain.html` | 981 × 450 | kill chain graph, selected path, legend |
| `configure.html` | 340 × 301 | Configure menu, effort slider at maximum (moving multicolor wave) |
| `appearance.html` | 1100 × 900 | Settings → Appearance, color set cards (23 in total, scroll for more) |
| `terminal.html` | 560 × 690 | Kali terminal over SSH to the lab, `sudo -l` line highlighted |

## Selectors worth animating

**Spider** (`welcome*`, and the small one in every chat header and answer)
- big spider `svg.welcome-spider`: `.rw-leg` (8 legs, `.rw-leg-l1` … `.rw-leg-r4`), `.rw-palp`,
  `.rw-brain`, `.rw-eyes`, `.rw-crosshair` (`.rw-ring`, `.rw-tick`), `.rw-book` (`.rw-book-turn` page)
- small spider `svg.rw-mini` (header `#title`, answers `.msg-avatar`, `#thinking`):
  `.rw-leg-l3`, `.rw-leg-r3`, `.rw-leg-l4`, `.rw-leg-r4`, `.rw-brain`, `.rw-eyes`

**Chat** (`chat-*`)
- `#bar` header, `.brand-name` wordmark (`.brand-ops` = “RED”)
- `#mission .mission-step` (4 steps; classes `is-done`, `is-current`, `is-todo`)
- `.tool-group .tool` (tool call rows), `.tool-name`, `.tool-summary`, `.tool-state`
- `.card` authorization card: `.card-risks .card-risk` (chips), `.card-buttons button` (Allow once, Deny, Always)
- `#thinking` (waiting line), `#composer` (prompt box), `#automatic-badge` (bypass countdown)
- `.msg.user`, `.msg-row.agent .msg` (messages), `.md-h`, `li`, `code`, `.report` (findings)

**Monitor**: `.mon-head`, `.mon-tick`, `.mon-row`, `.mon-space`, `.mon-line`
**Kill chain**: `.kc-node`, `.kc-node-label`, `.kc-edge.is-path`, `.kc-edge`, `.kc-legend-item`
**Configure**: `#effort-scale`, `.effort-knob`, `#effort-label`, `.cfg-switch-label`
**Appearance**: `.pal-card` (`aria-checked="true"` on the selected one), `.pal-sw`, `.pal-bar-fill`
**Terminal**: `.ln`, `.ln.hl`, `.cmd` (typed text), `.cur` (cursor)

## Rules

- Do not change any text inside a component (only `#effort-label` may step
  through Low, Medium, High, Extra, Maximum while the slider moves).
- Animate opacity, transforms, clip-path, masks, class toggles, the helpers
  above and `--jn-progress`; do not restyle colors or fonts by hand (switch
  palettes with `RedWidowUI.palette`).
- The interface is shown with English labels for the campaign; the shipped
  extension currently uses French labels.
