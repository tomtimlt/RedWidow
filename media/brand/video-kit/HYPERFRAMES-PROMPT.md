# Prompt — RedWidow 60-second promo with HyperFrames (v3)

Copy everything below the line into Claude (Sonnet) in a Claude Code session
where the HyperFrames plugin is installed. Put this whole `video-kit/` folder
inside the HyperFrames project first (for example as `assets/video-kit/`).

---

You are a senior motion designer. Build a **60-second, fast, punchy promo
video** for **RedWidow** with **HyperFrames** (HTML compositions rendered to
MP4). Use the HyperFrames skills: `/hyperframes` to author compositions,
`/hyperframes-cli` to preview and render, `/gsap` for animation. On syntax
(timing attributes, tracks, project layout, render command) the skills win; on
content and style this brief wins.

## 0. The most important rule: animate the real HTML, never zoom images

The interface is provided as **live HTML components** in
`assets/video-kit/html/` (real DOM + real CSS of the product). Read
`html/README.md` first: it lists every component, its size, the selectors to
animate and the `RedWidowUI` helpers.

- Build every UI shot from these components. Animate their **parts**: rows
  drop in, buttons get clicked, terminal lines type out, graph nodes pop, the
  path draws, the slider slides, palettes switch, the spider studies.
- The product's own CSS animations play by themselves inside the components:
  the welcome spider unfolds and breathes, the small spiders walk while
  `RedWidowUI.running(root, true)` is on, the bypass aura rotates, the effort
  wave moves. Let them play; do not fight them with GSAP on the same element.
- Zoom by scaling the component's parent with a CSS transform: the HTML stays
  sharp at any scale. Crop with a moving camera (parent translate/scale +
  `overflow: hidden` frame), not by cutting images.
- The PNGs in `screens/` are **reference only**. Never put one on screen.

## 1. Product (do not change the message)

**RedWidow — Pentest in VS Code, with AI on call.** A workspace inside VS Code
that brings together Docker Kali and Exegol containers, their terminals, a
Monitor, a kill chain and reports. An AI agent helps when you call it;
Learning mode only reads and explains. Open source.

## 2. Hard rules

1. **Never change text inside a component.** Only exception: `#effort-label`
   may show Low, Medium, High, Extra or Maximum while the slider moves.
2. **Fictional lab only**: no IPs, hosts, flags, hashes, credentials, company
   or person names beyond what the components already contain.
3. **No invented features or claims**: no "autonomous hacking", "autopilot",
   "one click", "hack anything", "Marketplace". The AI is a helper, not the pilot.
4. **Look**: flat `#0b0b0d` background, no particles, no glitch, no hooded
   hacker, no matrix rain, no stock footage, no emoji. No glow added on top:
   the only glows are the UI's own (bypass aura, effort wave).
5. **Type** for titles: Geist 800 uppercase, letter-spacing −0.03em; sublines
   Geist 500; labels JetBrains Mono 700 caps, letter-spacing 0.16em. Fonts are
   in `html/css/fonts/` (declared as “Warband Geist” and “Warband JetBrains
   Mono” in the UI CSS; reuse those family names).
6. **Color**: text `#eef1f4`, muted `#a3a6ad`, crimson `#E5132B` for “RED” of the
   wordmark, the last line of a hook and small accents. Steel `#B0B1B8`.
7. **Frames**: put each component in a window frame: `#1f1f1f`, 12 px radius,
   1 px `#2f3337` border, soft shadow, 35 px VS Code-style tab bar with a short
   title (“RedWidow: Chat”, “Kill chain”, “Monitor · kali-1”, “kali-1”).
8. **Safe area**: 96 px (16:9), 72 px (9:16). End card includes, small:
   *For authorized testing only.*

## 3. Assets

- `html/` — **the components**: `welcome`, `welcome-learning`,
  `chat-approval-wide`, `chat-approval-tall`, `chat-learning`, `chat-bypass`,
  `monitor`, `killchain`, `configure`, `appearance`, `terminal`;
  `css/redwidow-ui.css`, `redwidow-ui.js`.
- `logo/redwidow.svg` — the full spider **in layers** (legs `.rw-leg-l1` …
  `.rw-leg-r4`, palps, `.rw-brain`, `.rw-eyes`, `.rw-crosshair`); inline it as
  SVG for the logo animations. `logo/redwidow-mini.svg` — small head icon.
- `brand.json` — colors, palettes (23 ids), motion tokens.
- `cards/` — reference for title size and layout only; build titles as live text.

## 4. Rhythm

- 1920×1080, 30 fps, exactly **60.0 s**, grid **120 BPM** (beat = 0.5 s); cut on
  beats, fast sections every 1–2 beats.
- Titles: lines rise 28 px + fade in 0.45 s `power3.out`, 0.18 s stagger,
  crimson line half a beat late; out with a hard cut or 0.25 s fade.
- UI: components enter with a clip-path wipe or a scale from 1.06; inside,
  parts stagger 0.06–0.12 s. Camera moves (parent transform) `power2.inOut`
  0.6–1.2 s; whip-pans 0.3 s with a 4 px blur on the move only.
- Keep any text meant to be read still for at least 1 s.

## 5. Shot list (60 s) with animation recipes

| # | Time | Component | Text on screen | What moves |
| --- | --- | --- | --- | --- |
| 1 | 0.0–3.0 | `logo/redwidow.svg` inline | — | legs scale from 0.15 out of the body, pair by pair (0.08 s apart, `back.out(1.6)`, transform-origin at the inner end of each leg), palps follow, `.rw-brain` flashes from 20 % to full, `.rw-crosshair` locks in (scale 1.7→1, rotate −45°→0), `.rw-eyes` blink once; wordmark REDWIDOW wipes in, “RED” in crimson |
| 2 | 3.0–4.0 | title | YOUR PENTEST. | hard cut on beat, ≈ 190 px |
| 3 | 4.0–5.0 | title | ONE COCKPIT. | hard cut |
| 4 | 5.0–6.5 | title | ONE AGENT. (crimson) | half a beat late, scale 1.04→1 |
| 5 | 6.5–7.5 | title | KALI · EXEGOL · INSIDE VS CODE | words stagger 0.1 s |
| 6 | 7.5–12.0 | `terminal` | “Your containers. Your terminals.” | all `.ln` hidden; reveal in order; type `.cmd` at ≈ 35 ms/char with `.cur` at the end; output lines appear instantly; push-in on `.ln.hl`, its background flashes once |
| 7 | 12.0–17.0 | `monitor` | “Every command, live.” | `.mon-tick` pop one by one; `.mon-row` slides down; `.mon-line` stream in (40 ms stagger); camera pans down the output |
| 8 | 17.0–23.0 | `killchain` | “Every finding, mapped.” + label MITRE ATT&CK | `.kc-node` pop left to right (`back.out`), labels fade in; draw `.kc-edge.is-path` with stroke-dashoffset in node order; legend items slide in from the right; slow push-in on the path |
| 9 | 23.0–24.5 | `chat-approval-wide` (camera on `#mission`) | — | `RedWidowUI.running(root, true)`: the header spider walks; the four `.mission-step` light up one per half beat |
| 10 | 24.5–30.0 | `chat-approval-wide` | “Call the agent. It asks first.” | `.tool-group .tool` drop in; `.card` scales 1.06→1 with fade; `.card-risk` chips pop; a round cursor (16 px, white, 60 %) moves to the first `.card-buttons button` (Allow once) and clicks (scale 0.96→1); then `running(root, false)` |
| 11 | 30.0–31.5 | title | STUCK ON A BOX? | hard cut |
| 12 | 31.5–33.0 | title | FEED IT YOUR COURSE. / IT READS YOUR TERMINAL. (crimson) | stagger, crimson late |
| 13 | 33.0–36.0 | `welcome` → `RedWidowUI.learning(root, true)` | “Learning mode.” | the spider is on screen; on the beat, switch learning on: the book pops into its palps, the eyes start reading, the crosshair dims, a page turns; slow push-in on the spider |
| 14 | 36.0–40.0 | `terminal` left + `chat-learning` right | “Hints, not answers.” | both windows slide in from opposite sides; chat messages appear in order, tool rows tick in; a thin crimson line (separate SVG) draws from `.ln.hl` to the answer’s `<strong>`, then fades |
| 15 | 40.0–42.0 | title | WORKS BY HAND. / AI WHEN YOU CALL IT. (crimson) | stagger |
| 16 | 42.0–44.0 | title ticker | PROJECTS → COCKPIT → TERMINALS → KILL CHAIN → REPORTS | one word per half beat, same position, hard swaps |
| 17 | 44.0–47.0 | `configure` | “Tune the effort.” | menu pops in (0.96→1); drive `RedWidowUI.effort(root, v)` from 0.2 to 1 with a GSAP proxy, stepping `#effort-label` Low → Medium → High → Extra → Maximum; at 1 the multicolor wave starts by itself |
| 18 | 47.0–51.0 | `chat-bypass` | “Make it yours.” + card text 23 COLOR SETS. / ONE SPIDER. | the bypass aura already rotates; every half beat call `RedWidowUI.palette(root, id)` with `widow`, `aurora`, `venom`, `synthwave`, `arctic`, `nebula`, `multi`, ending on `widow`: the whole UI, the spider’s eyes and the aura change color |
| 19 | 51.0–55.0 | montage | — | eight 0.5 s cuts on the beat, each a different component and a different moving part already shown, each with a 3 % punch-in |
| 20 | 55.0–57.5 | title | PENTEST IN VS CODE, / WITH AI ON CALL. (crimson) | stagger |
| 21 | 57.5–60.0 | end card | spider, REDWIDOW, “Open source · github.com/tomtimlt/warband”, small “For authorized testing only.” | spider lock-in again (legs + crosshair, 0.8 s), hold to the end |

## 6. Audio

- If `assets/music.mp3` exists, use it (60 s, 1 s fade-out, beat 1 at 0.0 s);
  otherwise keep the 120 BPM grid and render silent.
- Optional voice-over (TTS if the plugin offers it, or `assets/voiceover.mp3`):
  > Your pentest. One cockpit. One agent.
  > Kali and Exegol, right inside VS Code.
  > Every command, live. Every finding, mapped.
  > Call the agent when you need it. It asks first.
  > Stuck on a box? Feed it your course. It reads your terminal and gives you a hint.
  > Works by hand. AI when you call it. Make it yours.
  > RedWidow. Pentest in VS Code, with AI on call.

## 7. Deliverables

1. `redwidow-promo-16x9.mp4` — 1920×1080, 30 fps, 60 s, H.264.
2. `redwidow-promo-9x16.mp4` — 1080×1920, same shot list; use
   `chat-approval-tall`, `welcome`, `welcome-learning` and `chat-learning`,
   stack windows vertically; titles on 2–3 lines.
3. The HyperFrames source (one composition per scene + root timeline).

## 8. Before rendering, check

- Exactly 60.0 s; every scene starts on a beat.
- Preview frames at 1, 4, 6, 10, 15, 20, 27, 32, 35, 38, 41, 46, 49, 53, 58 s:
  fonts are Geist and JetBrains Mono, UI text is sharp (no bitmap zoom),
  nothing touches the safe area, no component text was changed, no forbidden
  word appears, the spider studies in shot 13 and the palette changes in shot 18.
- Then render both formats and report the paths and durations.
