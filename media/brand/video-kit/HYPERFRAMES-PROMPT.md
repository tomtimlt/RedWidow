# Prompt — Venator Ops 60-second promo with HyperFrames

Copy everything below the line into Claude (Sonnet) in a Claude Code session
where the HyperFrames plugin is installed. Put this whole `video-kit/` folder
inside the HyperFrames project first (for example as `assets/video-kit/`).

---

You are a senior motion designer. Build a **60-second, fast, punchy promo
video** for **Venator Ops** with **HyperFrames** (HTML compositions rendered
to MP4). Use the HyperFrames skills: run `/hyperframes` for composition
authoring, `/hyperframes-cli` for preview and render, and `/gsap` for
animation. Follow the conventions those skills give you (timing attributes,
tracks, project layout, render command); if anything below conflicts with the
skill, the skill wins on syntax and this brief wins on content.

Push the plugin as far as it goes: several tracks, nested compositions per
scene, GSAP timelines with precise easing, masks and clip-path reveals,
staggered text, camera-style pans and zooms on screenshots, beat-synced cuts.
Prefer many short, well-timed moves over long fades.

## 1. Product (do not change the message)

**Venator Ops — Pentest in VS Code, with AI on call.** A workspace inside
VS Code that brings together Docker Kali and Exegol containers, their
terminals, a Monitor, a kill chain and reports. An AI agent helps when you
call it: it asks before running anything, and Learning mode only reads and
explains.

## 2. Hard rules

1. **Only use the provided assets.** Never generate, redraw or retype any part
   of the interface. You may crop, scale, pan, zoom, mask and reveal the PNGs.
2. **Fictional lab only.** Never add IPs, hostnames, flags, hashes,
   credentials, company or person names. What is in the screenshots is all.
3. **No invented features or claims.** No "autonomous hacking", "autopilot",
   "one click", "hack anything", "Marketplace". The AI is a helper, not the pilot.
4. **Look**: flat `#101214` background, no glow, no neon, no gradients except the
   ones already inside screenshots, no particles, no glitch, no hooded hacker,
   no matrix rain, no stock footage, no emoji.
5. **Type**: Geist 800 uppercase for hooks (letter-spacing −0.03em), Geist 500
   for sublines, Geist Mono for the wordmark and small labels. Load them from
   `assets/video-kit/fonts/` with `@font-face`. Never use a system fallback.
6. **Color**: text `#eef1f4`, muted `#a3acb6`, signature teal `#3cc7c0` only for
   the last line of a hook and small accents, steel `#7d8b99`.
7. **Safe area**: keep text 96 px inside the frame (16:9) and 72 px (9:16).
8. **Disclaimer** in the end card, small: *For authorized testing only.*

## 3. Assets (paths relative to `assets/video-kit/`)

- `brand.json`: colors, fonts and motion tokens. Read it first.
- `logo/parts/brackets.svg`, `spark.svg`, `satellite.svg`: the logo split into
  layers (same 24×24 viewBox, stack them) for the lock-on animation.
- `logo/venator-ops-wordmark.png` (transparent), `logo/venator-ops-mark.svg`.
- `screens/` (2x PNG):
  `terminal-kali-1.png` (Kali shell over SSH, the `sudo -l` line highlighted),
  `monitor.png` (command timeline + live ffuf output),
  `killchain.png` (findings graph, green selected path, legend),
  `chat-approval-wide.png` / `chat-approval-tall.png` (tool calls + authorization card),
  `chat-learning.png` (Learning mode reading the terminal and the course),
  `configure-effort-max.png` (Configure menu, effort slider at maximum),
  `effort-slider-max.png` (just the slider), `appearance-palettes.png` (5 color sets).
- `elements/` (crops for close-ups): `approval-card.png`, `tool-calls.png`
  (three rows), `mission-rail.png` (Recon → Analysis → Action → Report),
  `composer.png`, `killchain-path.png`, `killchain-legend.png`.
- `cards/`: ready text frames, plain and `-alpha`, 16:9 and 9:16. Prefer
  rebuilding the text live in HTML (so each line can animate); use the PNG
  cards as visual reference for size and layout.

## 4. Timing and rhythm

- 1920×1080, 30 fps, exactly **60.0 s**. Music grid **120 BPM** (one beat =
  0.5 s). Cut on beats; fast sections cut every 1–2 beats.
- Text in: rise 28 px + fade, 0.45 s, `power3.out`; staggered lines 0.18 s
  apart; the teal line lands half a beat late. Text out: 0.25 s fade + 12 px
  rise, or a hard cut on the beat.
- Screens: enter with a clip-path wipe or a 6 % scale-down from 1.06, then a
  slow push-in (≈ 4 % over the shot). Close-ups: zoom to the element crop,
  then whip-pan (0.3 s, slight 4 px blur on the move only).
- Panels sit on `#1f1f1f` rounded rectangles (12 px radius, 1 px `#2f3337`
  border, soft shadow) like VS Code windows; never full-bleed screenshots
  without the panel.

## 5. Shot list (60 s)

| # | Time | Visual | Text on screen | Motion |
| --- | --- | --- | --- | --- |
| 1 | 0.0–3.0 | Logo build on black | — | brackets slide in from 40 % outside and lock (0.6 s, `back.out(1.4)`), spark scales from 0 with 45° turn, satellite orbits once, wordmark wipes in under it |
| 2 | 3.0–4.0 | Type | YOUR PENTEST. | hard cut in on beat, huge (≈ 190 px) |
| 3 | 4.0–5.0 | Type | ONE COCKPIT. | hard cut on beat |
| 4 | 5.0–6.5 | Type | ONE AGENT. (teal) | lands half a beat late, slight scale 1.04→1 |
| 5 | 6.5–7.5 | Type | KALI · EXEGOL · INSIDE VS CODE | words stagger 0.1 s |
| 6 | 7.5–12.0 | `terminal-kali-1.png` in a panel | caption: “Your containers. Your terminals.” | reveal the terminal top-to-bottom line by line (mask steps of one line height, 0.12 s each), then zoom onto the highlighted `sudo -l` line |
| 7 | 12.0–17.0 | `monitor.png` | “Every command, live.” | wipe in from left, pan across the output, quick zoom on the timeline at the top |
| 8 | 17.0–23.0 | `killchain.png` then `killchain-path.png` | “Every finding, mapped.” + small mono label “MITRE ATT&CK” | reveal the graph left-to-right with a clip-path that follows the green path; legend (`killchain-legend.png`) slides in from the right |
| 9 | 23.0–24.5 | `mission-rail.png` | — | the four steps light up one per half beat (mask each quarter) |
| 10 | 24.5–30.0 | `tool-calls.png` then `approval-card.png` | “Call the agent. It asks first.” | the three tool rows drop in staggered; then the authorization card scales from 1.08 to 1 with its corner brackets; a simple round cursor (16 px, white, 60 % opacity) moves to **Allow once** and clicks (scale pulse) |
| 11 | 30.0–31.5 | Type | STUCK ON A BOX? | hard cut |
| 12 | 31.5–33.0 | Type | FEED IT YOUR COURSE. / IT READS YOUR TERMINAL. (teal) | stagger, teal late |
| 13 | 33.0–39.0 | `terminal-kali-1.png` left, `chat-learning.png` right, two panels | caption: “Learning mode. Hints, not answers.” | panels slide in from opposite sides; a thin teal line draws from the highlighted terminal line to the chat answer, then fades |
| 14 | 39.0–42.0 | Type | WORKS BY HAND. / AI WHEN YOU CALL IT. (teal) | stagger |
| 15 | 42.0–44.0 | Word ticker | PROJECTS → COCKPIT → TERMINALS → KILL CHAIN → REPORTS | one word per half beat, same position, hard swaps |
| 16 | 44.0–48.0 | `configure-effort-max.png`, then zoom on `effort-slider-max.png` | “Tune the effort.” | the menu pops in (scale 0.96→1), push-in on the slider |
| 17 | 48.0–51.0 | `appearance-palettes.png` | “Make it yours.” | pan across the five cards, hold half a beat on each |
| 18 | 51.0–55.0 | Rapid montage | — | eight cuts of 0.5 s on the beat: approval card, monitor, kill chain path, terminal line, effort slider, mission rail, tool calls, learning chat; each with a 3 % punch-in |
| 19 | 55.0–57.5 | Type | PENTEST IN VS CODE, / WITH AI ON CALL. (teal) | stagger |
| 20 | 57.5–60.0 | End card | logo, `VENATOR OPS`, “Open source · github.com/tomtimlt/warband”, small “For authorized testing only.” | logo locks again (short version), hold to the end |

## 6. Audio

- If `assets/music.mp3` exists, use it as the music track, trimmed to 60 s
  with a 1 s fade-out, and align beat 1 to 0.0 s. If it does not exist, build
  the timing on the 120 BPM grid anyway and render without music.
- Optional voice-over (only if a TTS option is available in the plugin or the
  user provides `assets/voiceover.mp3`). Script, calm and confident:
  > Your pentest. One cockpit. One agent.
  > Kali and Exegol, right inside VS Code.
  > Every command, live. Every finding, mapped.
  > Call the agent when you need it. It asks first.
  > Stuck on a box? Feed it your course. It reads your terminal and gives you a hint.
  > Works by hand. AI when you call it.
  > Venator Ops. Pentest in VS Code, with AI on call.

## 7. Deliverables

1. `venator-ops-promo-16x9.mp4` (1920×1080, 30 fps, 60 s, H.264).
2. `venator-ops-promo-9x16.mp4` (1080×1920): same shot list re-laid out:
   hooks on 2–3 lines, screenshots stacked vertically or cropped to the middle
   third with pans, use `chat-approval-tall.png`.
3. Keep the HyperFrames source (one composition per scene + a root timeline)
   so it can be edited later.

## 8. Before you render, check

- Total length is exactly 60.0 s and every scene starts on a beat.
- Preview frames at 1, 4, 6, 10, 15, 20, 27, 32, 36, 40, 46, 50, 53, 58 s:
  fonts are Geist (not a fallback), nothing is cut by the safe area, no
  screenshot text is altered or blurred while it is meant to be read
  (static for at least 1 s when there is a caption to read).
- No forbidden word from the rules appears anywhere.
- Then render both formats and report the file paths and durations.
