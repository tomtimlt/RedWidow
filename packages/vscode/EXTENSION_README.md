# RedWidow

**Pentest in VS Code, with AI on call.**

Kali · Exegol · Terminals · Kill chain · Optional AI agent

A workspace for your CTFs, labs and authorized pentests. Prepare containers, open terminals and bring your findings together. Work by hand or call an agent when you need one.

**Previously Venator Ops / Warband.** The update keeps your projects, conversation history and settings.

## Your workspace in one place

- **Cockpit**: create, start and link Kali or Exegol containers to a project.
- **Terminals**: use your tools by hand, without an AI account.
- **Chat**: ask an agent to analyze output, find documentation or run a check.
- **Monitor**: follow the agent’s commands and their live output.
- **Kill chain**: connect findings, hypotheses and failed attempts in a graph.
- **Evidence and reports**: capture observations, export the graph as SVG and prepare a Markdown report draft.

The cockpit, terminals, manual evidence capture and exports work without an AI connection.

## Get started

You need **VS Code 1.90+** and **Docker installed and running** for containers. VSIX packages are available for **Windows x64** and **Linux x64**. You do not need Node.js or a development environment.

1. Open **RedWidow: Open settings** from the command palette (`Ctrl+Shift+P`). Under **Project**, create a project with a name and folder, or activate an existing project. Trust the folder in VS Code if you trust its contents.
2. Open the **Cockpit**, link an existing container or create one with **New container**, then start it.
3. Run **RedWidow: Open or restore the RedWidow workspace** to bring back the chat, kill chain and Monitor. Open a terminal to work by hand.
4. For AI assistance, open **Settings → Global → Providers**, configure a provider and enable it. The **Use RedWidow for free** guide there lists the no-subscription options. Pick that provider in the chat’s **Configure** menu, then select a model available on your account.

Providers include **Claude**, **OpenAI / ChatGPT** and **OpenCode** with its full runtime provider catalog. Search and enable providers such as Google Gemini, OpenRouter, GitHub Copilot and DeepSeek in Providers. The general **OpenCode** entry shows all connected models. Use **Add Ollama / a compatible endpoint** to enter your API URL and installed model IDs. You can switch provider while keeping the same conversation. Provider subscriptions and API charges are separate. On Windows, Claude requires [Git for Windows with Git Bash](https://git-scm.com/downloads/win).

You choose a **shared folder** when you create a container. A container is linked to the active project only if the project folder is inside that shared folder; otherwise it is created unlinked, which is not an error. An active project is not required to create a container; without one, the container is not linked. Files in the shared folder appear directly in the VS Code Explorer. Preparing a linked container also provides a named path under `/redwidow/Workspace/` for its project. Existing files remain in place. A container with a different mount needs an explicit migration; RedWidow does not recreate it automatically. If Docker Desktop does not share the folder, add it under Settings › Resources › File sharing, then Apply & restart.

In **Settings → Appearance → Docker terminal prompt**, choose Original, RedWidow, Compact or Minimal, with a preview of each. The choice applies to new Bash terminals opened by RedWidow in Kali or Exegol. Existing terminals keep their prompt, and no `.bashrc` file is changed. Choose Original to keep the container’s own theme.

English is the default interface language. Choose **EN / FR** in Settings. Native command titles follow your VS Code language.

## Add context and tools

The chat’s **+** menu brings together files, container mentions, terminal context, commands, Monitor and kill chain shortcuts.

Use **`@`** to mention a project container and **`#`** to attach an excerpt from a terminal opened by the extension. You can also type these shortcuts directly.

> Summarize my observations and suggest the next two useful checks. Explain why before proposing a command.

Attach text, source files, logs and PNG, JPEG, GIF or WebP images with the file picker, drag and drop, or paste from the clipboard. Preview images and remove attachments before sending. Up to **10 attachments**: text files are limited to **64 KiB each / 256 KiB total**, images to **5 MiB each / 12 MiB total**. The composer warns when image support is unknown and blocks image sends when the selected model explicitly lacks vision. PDFs and other binary documents are not supported. Clipboard file access depends on the platform; pasting a path does not read that file.

In **Settings → Project → Integrations**, enable the method profiles and MCP connectors you want available. Configure each external MCP service for your project. Then use **+** to choose one method, up to four MCP connectors, Burp and web search for this conversation. Disabling a connector preserves its configuration. A new conversation starts without optional resources selected.

Methods include **Mentor**, **Bug bounty**, **Out of the box**, **Red team** and **HTB / CTF**. A short brief guides the agent; detailed methods load only when needed. External MCP programs must be installed and started separately.

## Learn with hints

Put Markdown or PDF course material in the folder opened by **Settings → Atlas → Open courses folder**. Enable **Learning** in the chat’s **Configure** menu, attach terminal context with `#`, and ask for a hint or explanation. Learning mode reads course material and the context you provide; it does not execute commands or write files. Optional method profiles, MCP connectors and web search are paused in this mode.

## Stay in control

Sensitive actions produce approval cards. Allow an action once, deny it, or remember an eligible approval for the current conversation. Passwords, tokens and keys are masked before they reach logs.

**Bypass** approves actions for a time you choose, from 1 minute to 48 hours, or without limit, including actions the gate would normally deny. Its active state remains visible. Turn it off with the chat switch, the command **RedWidow: Turn off the approval Bypass**, or by clicking the status bar. It also switches off when the engine stops. Use it only for a scope you control. Learning mode is excluded.

## Red team engagement

Run **RedWidow: Open the engagement** to import and validate the engagement sheet and the campaign plan (**Validate engagement…**, **Validate plan…**). Nothing runs without a human validation of their fingerprint. **Emergency stop › Activate…** makes the agent's network and shell actions against the scope be refused; **Lift the stop…** releases it. The stop is saved on disk and survives closing VS Code.

## History

History is shared by all projects. It is read-only; resuming a conversation from another project asks you to switch to that project first. History left under the former `warband.warband` identifier is picked up automatically. **Clear all** empties it.

## Uninstall

Run **RedWidow: Clear token**, delete your containers in the Cockpit, then uninstall the extension. Some data stays on disk: `%APPDATA%\warband` or `~/.config/warband` (`XDG_CONFIG_HOME` is honored), the project folders (the folders you chose when creating or opening each project; existing projects may still live under `~/.exegol/workspaces`) and the extension's VS Code storage.

## More

[User guide and source](https://github.com/tomtimlt/RedWidow) · [Issues](https://github.com/tomtimlt/RedWidow/issues) · MIT license
