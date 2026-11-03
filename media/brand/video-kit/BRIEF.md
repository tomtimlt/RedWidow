# RedWidow — Ad video brief

This kit is for an AI video tool (or an editor) producing promos for
**RedWidow**. Use only the assets in this folder. Read the rules before
generating anything.

## The product in one line

**Pentest in VS Code, with AI on call.** A workspace inside VS Code that brings
together Docker Kali and Exegol containers, their terminals, a Monitor, a kill
chain and reports. An AI agent helps when you call it; Learning mode only reads
and explains. Open source.

## Rules (must follow)

1. **No real targets, no real data.** Every screen shows a fictional lab
   (`10.10.10.14`, user `dev`). Never add real IPs, hostnames, flags, hashes,
   credentials or company names.
2. **Do not invent features.** Only show what is in the components. No
   "autonomous hacking", no "one-click exploit", no "hack anything".
3. **Not an autonomous agent.** The AI is a helper you call, not the pilot.
   Avoid "autopilot", "fully automated", "replaces pentesters".
4. **Authorized use only.** End card, small: *For authorized testing only:
   CTFs, labs and scoped engagements.*
5. **No fake UI.** Build every UI shot from `html/` (live components). Never
   redraw the interface, never zoom the PNGs in `screens/` (reference only).
6. **Brand look.** Flat deep black background, no stock "cyber" footage, no
   hooded hacker, no matrix rain, no glitch, no neon added on top. The only
   glows and gradients are the ones the interface already has (bypass aura,
   effort wave, gradient palettes).

## Brand

| Token | Value | Use |
| --- | --- | --- |
| Background | `#0b0b0d` | every frame |
| Panel | `#1f1f1f` | window frames behind components |
| Text | `#eef1f4` | headlines |
| Muted text | `#a3a6ad` | sublines |
| Signature crimson | `#E5132B` | “RED” of the wordmark, last line of a hook, accents |
| Steel | `#B0B1B8` / `#606168` | spider body |
| Status green / orange | `#3fb950` / `#d29922` | only as they appear in the UI |

- **Fonts** (`fonts/`, OFL): **Geist** for headlines (800, uppercase,
  tracking −3 %) and sublines (500); **JetBrains Mono** for small labels and
  the UI wordmark (700, caps, tracking 0.16em).
- **Wordmark**: `REDWIDOW`, “RED” in crimson, “WIDOW” in white. Lockup:
  spider + wordmark in Geist 800.
- **Logo**: the armored spider with a brain on the cephalothorax and an empty
  red crosshair on the abdomen. Small sizes use the head with four legs.
- **Palettes**: the product has 23 color sets (`brand.json`). Default and
  brand: **Widow** (crimson). Use other sets only in the “Make it yours” beat.
- **Motion**: lines rise 28 px and fade in, 0.45 s `power3.out`, 0.18 s
  stagger, crimson line half a beat late. Cuts on the beat. Small settles only.
- **Music**: minimal electronic, steady pulse 110–120 BPM, dark but calm. No
  dubstep drops, no sirens.

## Assets

### `html/` — live UI components (use these for every UI shot)
Real DOM + real CSS, sharp at any zoom, every part animatable, product
animations included. See `html/README.md` for sizes, selectors and the
`RedWidowUI` helpers (palette, learning, bypass, running, effort).

### `logo/`
- `redwidow.svg` — full spider, vector, **in layers** (`.rw-leg-l1` … `.rw-leg-r4`,
  `.rw-palp-l/r`, `.rw-brain`, `.rw-eyes`, `.rw-crosshair` with `.rw-ring` and
  `.rw-tick-*`; colors as CSS variables `--rw-steel-hi`, `--rw-steel`,
  `--rw-ink`, `--rw-red`): inline it to animate legs, brain, eyes, crosshair.
- `redwidow-mini.svg` — small icon (head with brain, eyes, four legs);
  `redwidow-mini-mono.svg` — monochrome (`currentColor`).
- `redwidow-crosshair.svg` — crosshair alone.
- PNG, transparent and on dark: `redwidow-1024`, `redwidow-mini-1024`,
  `redwidow-lockup` (spider + REDWIDOW), `redwidow-wordmark` (small icon + UI wordmark).

### `screens/` (2x PNG, reference only)
`welcome`, `welcome-learning`, `chat-approval-wide`, `chat-approval-tall`,
`chat-learning`, `chat-bypass`, `monitor`, `killchain`, `configure-effort-max`,
`effort-slider-max`, `appearance-palettes`.

### `cards/` (16:9 1920×1080 and 9:16 1080×1920, on background and `-alpha`)
Reference for title size and layout; build titles as live text.

| File | Text |
| --- | --- |
| `01-your-pentest` | YOUR PENTEST. |
| `02-one-cockpit` | ONE COCKPIT. |
| `03-one-agent` | ONE AGENT. (crimson) |
| `04-hook-full` | the three lines + “Kali · Exegol · Terminals · Kill chain” |
| `05-learning` | STUCK ON A BOX? / FEED IT YOUR COURSE. / IT READS YOUR TERMINAL. |
| `06-without-ai` | WORKS BY HAND. / AI WHEN YOU CALL IT. |
| `07-tagline` | PENTEST IN VS CODE, / WITH AI ON CALL. |
| `08-end` | spider, REDWIDOW, tagline, “Open source · github.com/tomtimlt/warband” |
| `09-make-it-yours` | 23 COLOR SETS. / ONE SPIDER. |

### `fonts/`
Geist and JetBrains Mono (woff2) with their OFL licences.

For a HyperFrames render, use `HYPERFRAMES-PROMPT.md` (60 s shot list).

## Storyboard — 30 s, 16:9 (9:16 cut below)

| Time | Visual | On-screen text | Voice-over |
| --- | --- | --- | --- |
| 0–2.5 s | spider from `logo/redwidow.svg`: legs unfold, brain lights up, crosshair locks | — | — |
| 2.5–4.5 s | title | YOUR PENTEST. ONE COCKPIT. | “Your pentest. One cockpit.” |
| 4.5–6 s | title | ONE AGENT. | “One agent.” |
| 6–10 s | `terminal`, lines type out, push-in on `sudo -l` | — | “Kali and Exegol, right inside VS Code.” |
| 10–14 s | `monitor`, output streams | — | “Every command, followed live.” |
| 14–18 s | `killchain`, nodes pop, path draws | — | “Every finding, mapped to your kill chain.” |
| 18–22 s | `chat-approval-wide`, the card lands, Allow once clicked | — | “Call the agent when you need it. It asks before it acts.” |
| 22–26 s | `welcome-learning` then `chat-learning` | STUCK ON A BOX? … | “Stuck? Feed it your course. It reads your terminal and gives you a hint.” |
| 26–30 s | `08-end` | spider + tagline | “RedWidow. Pentest in VS Code, with AI on call.” |

### 15 s cut
spider intro (0–2 s) → `04-hook-full` (2–5 s) → `terminal` (5–8 s) →
`chat-approval-wide` (8–12 s) → `08-end` (12–15 s).

### 9:16 (Reels, Shorts, LinkedIn mobile)
Same order with the `-9x16` cards; use `chat-approval-tall`, `welcome`,
`welcome-learning` and `chat-learning` (side-panel width); stack two windows
vertically when a scene shows two.

## Voice-over

Calm, confident, low-key; one speaker; no hype words.

> Your pentest. One cockpit. One agent.
> Kali and Exegol, right inside VS Code.
> Every command, followed live. Every finding, mapped to your kill chain.
> Call the agent when you need it. It asks before it acts.
> Stuck on a box? Feed it your course. It reads your terminal and gives you a hint.
> RedWidow. Pentest in VS Code, with AI on call.

## Status to keep in mind

The extension interface currently ships in French and is still named Warband
in the published repository; the components were translated to English and
rebranded for this campaign. Distribution is a manual `.vsix` from the GitHub
releases, not the VS Code Marketplace: do not say “available on the
Marketplace”.
