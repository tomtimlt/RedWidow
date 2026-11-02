# Prompt — Venator Ops 60-second promo with HyperFrames (v2)

Copy everything below the line into Claude (Sonnet) in a Claude Code session
where the HyperFrames plugin is installed. Put this whole `video-kit/` folder
inside the HyperFrames project first (for example as `assets/video-kit/`).

---

You are a senior motion designer. Build a **60-second, fast, punchy promo
video** for **Venator Ops** with **HyperFrames** (HTML compositions rendered
to MP4). Use the HyperFrames skills: `/hyperframes` to author compositions,
`/hyperframes-cli` to preview and render, `/gsap` for animation. On syntax
(timing attributes, tracks, project layout, render command) the skills win; on
content and style this brief wins.

## 0. The most important rule: animate the real HTML, never zoom images

The interface is provided as **live HTML components** in
`assets/video-kit/html/` (real DOM + real CSS of the product). Read
`html/README.md` first: it lists every component, its size, and the selectors
to animate.

- Build every UI shot from these components. Animate their **parts**: rows
  drop in, buttons get clicked, terminal lines type out, graph nodes pop, the
  green path draws, the slider slides. This is what makes the video look real
  and crisp.
- Zoom by scaling the component's parent with a CSS transform: the HTML stays
  sharp at any scale. Use crops by moving the camera (parent translate/scale +
  `overflow: hidden` frame), not by cutting images.
- The PNGs in `screens/` and `elements/` are **reference only**. Never put a
  PNG on screen above 100 % of its native size, and do not use them for close
  ups. Prefer not using them at all.

## 1. Product (do not change the message)

**Venator Ops — Pentest in VS Code, with AI on call.** A workspace inside
VS Code that brings together Docker Kali and Exegol containers, their
terminals, a Monitor, a kill chain and reports. An AI agent helps when you
call it; Learning mode only reads and explains.

## 2. Hard rules

1. **Never change text inside a component.** Only exception: `#effort-label`
   may show Low, Medium, High, Extra or Maximum while the slider moves.
2. **Fictional lab only**: no IPs, hosts, flags, hashes, credentials, company
   or person names beyond what the components already contain.
3. **No invented features or claims**: no "autonomous hacking", "autopilot",
   "one click", "hack anything", "Marketplace". The AI is a helper, not the pilot.
4. **Look**: flat `#101214` background, no glow, no neon, no particles, no
   glitch, no hooded hacker, no matrix rain, no stock footage, no emoji.
5. **Type** for titles: Geist 800 uppercase, letter-spacing −0.03em; sublines
   Geist 500; wordmark Geist Mono. Fonts are in `html/css/fonts/` (the UI CSS
   already declares them as “Warband Geist” / “Warband Geist Mono”; reuse those
   family names in your own text styles).
6. **Color**: text `#eef1f4`, muted `#a3acb6`, teal `#3cc7c0` only for the last
   line of a hook and small accents, steel `#7d8b99`.
7. **Frames**: put each component in a window frame: `#1f1f1f`, 12 px radius,
   1 px `#2f3337` border, soft shadow, optional 35 px VS Code-style tab bar
   with a short title (e.g. “Venator Ops: Chat”, “Kill chain”, “Monitor · kali-1”,
   “Venator Ops : kali-1”).
8. **Safe area**: 96 px (16:9), 72 px (9:16). End card includes, small:
   *For authorized testing only.*

## 3. Assets

- `html/` — **the components** (see `html/README.md`): `chat-approval-wide`,
  `chat-approval-tall`, `chat-learning`, `monitor`, `killchain`, `configure`,
  `appearance`, `terminal`; `css/venator-ui.css`, `venator-ui.js`.
- `logo/parts/brackets.svg`, `spark.svg`, `satellite.svg` — logo layers (same
  24×24 viewBox) for the lock-on; inline them as SVG so they stay vector.
- `brand.json` — colors and motion tokens.
- `cards/` — reference for title size and layout only; build titles as live text.

## 4. Rhythm

- 1920×1080, 30 fps, exactly **60.0 s**, grid **120 BPM** (beat = 0.5 s); cut on
  beats, fast sections every 1–2 beats.
- Titles: lines rise 28 px + fade in 0.45 s `power3.out`, 0.18 s stagger, teal
  line half a beat late; out with a hard cut or 0.25 s fade.
- UI: components enter with a clip-path wipe or a scale from 1.06; inside,
  parts stagger 0.06–0.12 s. Camera moves (parent transform) `power2.inOut`
  0.6–1.2 s; whip-pans 0.3 s with a 4 px blur on the move only.
- Keep any text meant to be read still for at least 1 s.

## 5. Shot list (60 s) with animation recipes

| # | Time | Component | Text on screen | What moves (selectors from `html/README.md`) |
| --- | --- | --- | --- | --- |
| 1 | 0.0–3.0 | logo layers | — | brackets fly in from the four corners and lock (0.6 s `back.out(1.4)`), spark scales from 0 with a 45° turn, satellite orbits once; wordmark VENATOR OPS wipes in |
| 2 | 3.0–4.0 | title | YOUR PENTEST. | hard cut on beat, ≈ 190 px |
| 3 | 4.0–5.0 | title | ONE COCKPIT. | hard cut |
| 4 | 5.0–6.5 | title | ONE AGENT. (teal) | half a beat late, scale 1.04→1 |
| 5 | 6.5–7.5 | title | KALI · EXEGOL · INSIDE VS CODE | words stagger 0.1 s |
| 6 | 7.5–12.0 | `terminal` | “Your containers. Your terminals.” | all `.ln` hidden; reveal them in order; for prompt lines type `.cmd` character by character (≈ 35 ms/char, keep the `.cur` cursor at the end); output lines appear instantly; then the camera pushes in on `.ln.hl` and its background flashes once |
| 7 | 12.0–17.0 | `monitor` | “Every command, live.” | `.mon-tick` pop in one by one; `.mon-row` slides down; `.mon-line` appear in fast stagger (40 ms) as if streaming; camera pans down the output |
| 8 | 17.0–23.0 | `killchain` | “Every finding, mapped.” + mono label MITRE ATT&CK | all `.kc-node` start at scale 0; pop them left to right (`back.out`), each with its label fading in; draw `.kc-edge.is-path` with stroke-dashoffset from full length to its dash pattern, following the node order; legend items `.kc-legend-item` slide in from the right; slow push-in on the green path |
| 9 | 23.0–24.5 | `chat-approval-wide` (camera on `#mission`) | — | the four `.mission-step` light up one per half beat (opacity 0.3→1) |
| 10 | 24.5–30.0 | `chat-approval-wide` | “Call the agent. It asks first.” | `.tool-group .tool` drop in staggered; `.card` scales 1.06→1 with fade; `.card-risks .card-risk` chips pop; a simple round cursor (16 px, white, 60 % opacity, as a separate element above the component) moves to the first `.card-buttons button` (Allow once) and clicks: button scale 0.96→1 |
| 11 | 30.0–31.5 | title | STUCK ON A BOX? | hard cut |
| 12 | 31.5–33.0 | title | FEED IT YOUR COURSE. / IT READS YOUR TERMINAL. (teal) | stagger, teal late |
| 13 | 33.0–39.0 | `terminal` left + `chat-learning` right | “Learning mode. Hints, not answers.” | both windows slide in from opposite sides; in the chat, messages appear in order (`.msg.user`, then each `.msg-row.agent`), tool rows tick in; a thin teal line (separate SVG) draws from `.ln.hl` in the terminal to the answer’s `<strong>` in the chat, then fades |
| 14 | 39.0–42.0 | title | WORKS BY HAND. / AI WHEN YOU CALL IT. (teal) | stagger |
| 15 | 42.0–44.0 | title ticker | PROJECTS → COCKPIT → TERMINALS → KILL CHAIN → REPORTS | one word per half beat, same position, hard swaps |
| 16 | 44.0–48.0 | `configure` | “Tune the effort.” | menu pops in (scale 0.96→1); drive `VenatorUI.effort(root, v)` from 0.2 to 1 with a GSAP proxy object, updating `#effort-label` Low → Medium → High → Extra → Maximum at each fifth; at 1 the moving gradient starts by itself |
| 17 | 48.0–51.0 | `appearance` | “Make it yours.” | camera pans across the five `.pal-card`; move the selection: set `aria-checked="true"` on the next card (and `false` on the others) every half beat, ending on the first one |
| 18 | 51.0–55.0 | montage | — | eight 0.5 s cuts on the beat, each a different component and a different moving part already animated above, each with a 3 % punch-in |
| 19 | 55.0–57.5 | title | PENTEST IN VS CODE, / WITH AI ON CALL. (teal) | stagger |
| 20 | 57.5–60.0 | end card | logo layers, VENATOR OPS, “Open source · github.com/tomtimlt/warband”, small “For authorized testing only.” | short logo lock again, hold to the end |

## 6. Audio

- If `assets/music.mp3` exists, use it (60 s, 1 s fade-out, beat 1 at 0.0 s);
  otherwise keep the 120 BPM grid and render silent.
- Optional voice-over (TTS if the plugin offers it, or `assets/voiceover.mp3`):
  > Your pentest. One cockpit. One agent.
  > Kali and Exegol, right inside VS Code.
  > Every command, live. Every finding, mapped.
  > Call the agent when you need it. It asks first.
  > Stuck on a box? Feed it your course. It reads your terminal and gives you a hint.
  > Works by hand. AI when you call it.
  > Venator Ops. Pentest in VS Code, with AI on call.

## 7. Deliverables

1. `venator-ops-promo-16x9.mp4` — 1920×1080, 30 fps, 60 s, H.264.
2. `venator-ops-promo-9x16.mp4` — 1080×1920, same shot list; use
   `chat-approval-tall` and stack windows vertically; titles on 2–3 lines.
3. The HyperFrames source (one composition per scene + root timeline).

## 8. Before rendering, check

- Exactly 60.0 s; every scene starts on a beat.
- Preview frames at 1, 4, 6, 10, 15, 20, 27, 32, 36, 40, 46, 50, 53, 58 s:
  fonts are Geist, UI text is sharp (no bitmap zoom), nothing touches the safe
  area, no component text was changed, no forbidden word appears.
- Then render both formats and report the paths and durations.
