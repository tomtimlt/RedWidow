<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/redwidow-logo.svg">
  <img src="docs/img/redwidow-logo-light.svg" alt="RedWidow logo" width="96" height="80">
</picture>

# RedWidow

**Weave. Watch. Strike. Wrap.**

The AI-native pentest workspace for VS Code. Your Docker Kali and Exegol
containers, their terminals, a Monitor, a kill chain and reports in one place,
with an AI agent that runs only what you approve.

![Open source](https://img.shields.io/badge/open%20source-MIT-E5132B.svg)
![VS Code 1.90+](https://img.shields.io/badge/VS%20Code-1.90%2B-606168.svg)
![Windows and Linux](https://img.shields.io/badge/Windows%20%7C%20Linux-606168.svg)
![Docker required](https://img.shields.io/badge/Docker-required-606168.svg)

<br>

<img src="docs/img/redwidow-banner.png" alt="RedWidow: Weave. Watch. Strike. Wrap. The chat, the kill chain and the Monitor side by side" width="860">

</div>

---

> **Use only in an authorized setting**: CTFs, certification labs, or an
> engagement with a defined scope and written permission.

## See it in 50 seconds

<div align="center">
<img src="docs/img/redwidow-promo.gif" alt="Animated preview: a target locked in a web, the spider drops, the RedWidow logo appears" width="640">

[Watch the full video](docs/video/redwidow-promo.mp4)
</div>

## Why RedWidow

A pentest means dozens of terminals, scans and notes scattered everywhere.
RedWidow follows the way a widow hunts, and brings it all together inside VS Code:

| | | |
| --- | --- | --- |
| **01 Weave** | Recon | Prepare your Docker Kali and Exegol containers, open terminals in them, and give the agent a target. |
| **02 Watch** | Analysis | The Monitor follows every command live; the kill chain maps hosts, credentials, sites, steps and loot. |
| **03 Strike** | Action | Drive it step by step, or let it hunt in Automatic mode. Sensitive actions ask for your approval. |
| **04 Wrap** | Report | Findings with severities, drafted as Markdown. |

## What you can do

### Work with the agent

Write your prompt in the chat and the agent takes it from there. When an action
needs your approval, a card shows the tool, the command and the reason.

<div align="center">
<img src="docs/img/redwidow-chat.png" alt="The RedWidow chat with an authorization card: tool, sqlmap command, reason, and the Allow once, Deny and Always buttons" width="860">
</div>

In the chat you also get:

- `@` to mention a container, `#` to mention an open terminal (the agent reads its output), `/` for commands;
- up to **four conversations** in parallel, and a **history** filtered by project;
- a choice of **model** and **reasoning effort** for the next message;
- web search (documentation, READMEs, GitHub releases), with sources and the date they were read.

### Follow the execution: the Monitor

Each command shows up with its status and live output. A timeline lets you jump
to any command, and the down arrow turns auto-follow on or off.

<div align="center">
<img src="docs/img/redwidow-monitor.png" alt="The Monitor: a timeline of commands, the entry of the running command and its numbered output" width="860">
</div>

### Follow your attack: the kill chain

Hosts, credentials, sites, steps, loot: every finding has a **state**
(confirmed, hypothesis, failed), a **MITRE ATT&CK technique** and cause-and-effect
links to the others. The graph works with mouse and keyboard, and **Replay**
walks the selected path node by node.

<div align="center">
<img src="docs/img/redwidow-killchain.png" alt="The kill chain: a graph of linked findings, the selected path as green dashes, and the legend" width="860">
</div>

### Learn: Learning mode

Stuck on an HTB box? Give it your course, mention your terminal session with
`#`, and it explains where you stand based on what you actually typed. The mode
is read-only: it cites its sources and points you in the right direction. It
never runs or writes anything.

<div align="center">
<img src="docs/img/redwidow-learning.png" alt="Learning mode: Stuck on a box? Feed it your course. It reads your terminal. Never executes." width="860">
</div>

### Keep a record and write it up

Every mission is logged so you can read it back. The **report preview** shows
the active project's findings without credentials or loot, and the export
produces a **Markdown draft** to complete with your evidence and remediations.
Severities stay "To be assessed": you decide them yourself. No external
reporting tool is needed.

## Without AI

RedWidow helps you organize a pentest even without an account or an AI
provider.

- **Projects**: a name, a working folder and the containers that go with it, with a summary you write and edit yourself.
- **The cockpit**: create, start, stop and link your Docker Kali and Exegol containers. Kali images are prepared for you.
- **Your terminals in the container**: open a terminal in Kali or Exegol from VS Code and work as usual.
- **The kill chain**: browse the project's findings graph, mark the selected path and replay it.
- **The report draft**: preview and Markdown export.

The day you want some help, add a provider in **Configure**: the chat, the
Monitor and the automatic feeding of the kill chain then rely on the agent.

## Installation

Requirements: **VS Code 1.90 or later** and **Docker** for the containers.

1. Download the `.vsix` file for your platform (**Windows** or **Linux**) from the [releases](https://github.com/tomtimlt/redwidow/releases).
2. Install it: `code --install-extension <file>.vsix`, or in VS Code **Extensions → … → Install from VSIX**.
3. Reload the VS Code window.

RedWidow is not on the Marketplace yet: installation is manual.

## First launch

1. Open a **trusted folder** in VS Code.
2. Open **Settings → Project**: activate a project or create one (a name and a folder).
3. In the **cockpit**, link the project's Kali or Exegol containers, or create them.
4. To use the agent, open **Configure** in the chat, pick your provider and add your access. It is stored in VS Code's secure storage.
5. Open the chat (the RedWidow icon in the activity bar) and write your prompt.

| Shortcut | Action |
| --- | --- |
| `Alt+J Alt+J` | Launcher |
| `Alt+J C` | Side chat |
| `Alt+J N` | New chat in the editor |
| `Alt+J K` | Cockpit |
| `Alt+J M` | Monitor |
| `Alt+J S` | Settings |

## FAQ

**Which AI providers are supported?**
**Claude** (subscription token or API key), **OpenAI** (ChatGPT subscription or API key) and **OpenCode**, which also opens the door to Gemini, local models through Ollama and compatible endpoints. You can switch provider and keep the same conversation.

**Which systems does it run on?**
Windows (native, no WSL) and Linux.

**Where is my data?**
Conversation logs are stored by VS Code on your machine, outside your repository. The history keeps roughly the last 100 conversations, and passwords, tokens and keys are masked before anything is written to a log.

**What is Bypass for?**
Running a long sequence without clicking on every card. It is set in **Configure**, lasts 2 hours by default (4 hours at most) and takes the color of your palette, with a countdown.

**Are there profiles for my context?**
Yes: method profiles (mentor, bug bounty, out of the box, red team, HTB) steer the agent.

**Does the interface follow my theme?**
Yes: light, dark and high-contrast themes, reduced motion respected, and **23 color sets** (solid colors and gradients, Widow by default) to choose from in **Settings → Appearance**.

## Status

A personal project under active development. The published version is installed by hand (`.vsix`) and has not yet been tried in every VS Code setup (remote windows, web version). Known limitations are listed in the [extension guide](docs/extension-vscode.md#limites-connues).

## Going further

| | |
| --- | --- |
| [Extension guide](docs/extension-vscode.md) | Installation, usage and limitations |
| [Project status](docs/etat-du-projet.md) | What exists and what is left to do |
| [Command line](docs/cli.md) | Driving the engine and the approval policy outside VS Code |
| [Development](docs/adr/README.md) | For developers: architecture decisions and code layout |

The detailed documentation is currently written in French.

## License

[MIT](LICENSE).
