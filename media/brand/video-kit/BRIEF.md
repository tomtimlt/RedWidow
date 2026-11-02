# Venator Ops — Ad video brief

This kit is for an AI video tool (or an editor) producing a short promo for
**Venator Ops**. Use only the assets in this folder. Read the rules before
generating anything.

## The product in one line

**Pentest in VS Code, with AI on call.** A workspace inside VS Code that brings
together Docker Kali and Exegol containers, their terminals, a Monitor, a kill
chain and reports. An AI agent helps when you call it.

## Rules (must follow)

1. **No real targets, no real data.** Every screen shows a fictional lab
   (`10.10.10.14`, user `dev`). Never add real IPs, hostnames, flags, hashes,
   credentials or company names.
2. **Do not invent features.** Only show what is in the screens below. No
   "autonomous hacking", no "one-click exploit", no "hack anything".
3. **Not an autonomous agent.** The AI is a helper you call, not the pilot.
   Avoid words like "autopilot", "fully automated", "replaces pentesters".
4. **Authorized use only.** If a disclaimer is shown, use: *For authorized
   testing only: CTFs, labs and scoped engagements.*
5. **No fake UI.** Do not generate or redraw the interface. Animate the
   provided screenshots (pan, zoom, crop, reveal), never alter their text.
6. **Brand look.** Flat dark background, no glow, no gradients, no neon, no
   particles, no glitch effects, no hooded hacker, no matrix rain, no stock
   "cyber" footage.

## Brand

| Token | Value | Use |
| --- | --- | --- |
| Background | `#101214` | every frame |
| Panel | `#1f1f1f` | behind screenshots |
| Text | `#eef1f4` | headlines |
| Muted text | `#a3acb6` | sublines |
| Signature teal | `#3cc7c0` | last line of a hook, accents only |
| Steel | `#7d8b99` | logo brackets |
| Status green / orange | `#3fb950` / `#d29922` | only as they appear in screenshots |

- **Fonts**: Geist (headlines, 800, uppercase, tight tracking −3 %) and Geist
  Mono (wordmark, small labels). Files in `fonts/`, licence OFL (`OFL-Geist.txt`).
- **Wordmark**: `VENATOR OPS`, mono, wide tracking, `OPS` in teal.
- **Motion**: lines rise 28 px and fade in, 0.6–0.7 s, ease-out, one after the
  other; the teal line arrives slightly later. Cuts on the beat, no spins, no
  bounces except a small settle.
- **Music**: minimal electronic, steady pulse around 100–110 BPM, dark but calm.
  No dubstep drops, no sirens.

## Assets

### `logo/`
- `venator-ops-mark.svg` — vector mark.
- `venator-ops-mark-1024.png` — mark, transparent background.
- `venator-ops-mark-on-dark-1024.png` — mark on the brand background.
- `venator-ops-wordmark.png` / `-on-dark.png` — mark + `VENATOR OPS`, transparent or on dark.

### `screens/` (2x, real interface, fictional lab)
- `chat-approval-wide.png` — chat in landscape: tool calls and an authorization card (Allow once / Deny / Always) for a `sqlmap` command.
- `chat-approval-tall.png` — same scene, portrait (good for 9:16).
- `chat-learning.png` — Learning mode: the user shares a course, the AI reads the terminal and gives a hint, not the answer.
- `terminal-kali-1.png` — Kali terminal session over SSH to the lab; the useful `sudo -l` line is highlighted.
- `killchain.png` — kill chain graph: linked findings with MITRE ATT&CK IDs, selected path as green dashes, legend.
- `monitor.png` — Monitor: command timeline and live, numbered `ffuf` output.

- `configure-effort-max.png` — Configure menu with the effort slider at maximum (animated gradient frozen).
- `effort-slider-max.png` — the effort slider alone.
- `appearance-palettes.png` — Settings → Appearance with the five color sets.

### `elements/` (close-up crops, 2x)
`approval-card.png`, `tool-calls.png`, `mission-rail.png`, `composer.png`,
`killchain-path.png`, `killchain-legend.png`.

### `logo/parts/`
`brackets.svg`, `spark.svg`, `satellite.svg`: the mark split in layers (same
viewBox) to animate the lock-on.

For a HyperFrames render, use `HYPERFRAMES-PROMPT.md` (60 s shot list).

### `cards/` (text frames, 16:9 1920×1080 and 9:16 1080×1920)
Each card exists on the brand background and as `-alpha` (transparent, to put
text over footage).

| File | Text |
| --- | --- |
| `01-your-pentest` | YOUR PENTEST. |
| `02-one-cockpit` | ONE COCKPIT. |
| `03-one-agent` | ONE AGENT. (teal) |
| `04-hook-full` | the three lines + “Kali · Exegol · Terminals · Kill chain” |
| `05-learning` | STUCK ON A BOX? / FEED IT YOUR COURSE. / IT READS YOUR TERMINAL. |
| `06-without-ai` | WORKS BY HAND. / AI WHEN YOU CALL IT. |
| `07-tagline` | PENTEST IN VS CODE, / WITH AI ON CALL. |
| `08-end` | logo, wordmark, tagline, “Open source · github.com/tomtimlt/warband” |

## Storyboard — 30 s, 16:9 (9:16 cut below)

| Time | Visual | On-screen text | Voice-over |
| --- | --- | --- | --- |
| 0–2 s | `01-your-pentest` | YOUR PENTEST. | “Your pentest.” |
| 2–4 s | `02-one-cockpit` | ONE COCKPIT. | “One cockpit.” |
| 4–6 s | `03-one-agent` | ONE AGENT. | “One agent.” |
| 6–10 s | `terminal-kali-1`, slow push-in | — | “Kali and Exegol, right inside VS Code.” |
| 10–14 s | `monitor`, pan left to right | — | “Every command, followed live.” |
| 14–18 s | `killchain`, slow zoom on the green path | — | “Every finding, mapped to your kill chain.” |
| 18–22 s | `chat-approval-wide`, zoom to the card | — | “Call the agent when you need it. It asks before it acts.” |
| 22–26 s | `05-learning` then `chat-learning` | STUCK ON A BOX? … | “Stuck? Feed it your course. It reads your terminal and gives you a hint.” |
| 26–30 s | `08-end` | logo + tagline | “Venator Ops. Pentest in VS Code, with AI on call.” |

### 15 s cut
`04-hook-full` (0–3 s) → `terminal-kali-1` (3–6 s) → `killchain` (6–9 s) →
`chat-approval-wide` (9–12 s) → `08-end` (12–15 s).

### 9:16 (Reels, Shorts, LinkedIn mobile)
Same order with the `-9x16` cards; use `chat-approval-tall.png`; crop
`killchain.png` and `monitor.png` to the middle third and pan across them.

## Voice-over

Calm, confident, low-key; one speaker; no hype words. Full script (≈ 25 s):

> Your pentest. One cockpit. One agent.
> Kali and Exegol, right inside VS Code.
> Every command, followed live. Every finding, mapped to your kill chain.
> Call the agent when you need it. It asks before it acts.
> Stuck on a box? Feed it your course. It reads your terminal and gives you a hint.
> Venator Ops. Pentest in VS Code, with AI on call.

## Status to keep in mind

The extension interface currently ships in French; the screenshots were
translated to English for this campaign. Distribution is a manual `.vsix`
from the GitHub releases, not the VS Code Marketplace: do not say
“available on the Marketplace”.
