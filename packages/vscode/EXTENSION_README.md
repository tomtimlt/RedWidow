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
4. For AI assistance, open **Settings → System control**, configure a provider and enable it. Pick that provider in the chat’s **Configure** menu, then select a model available on your account.

Providers include **Claude**, **OpenAI / ChatGPT** and **OpenCode** with its full runtime provider catalog. Search and enable providers such as Google Gemini, OpenRouter, GitHub Copilot and DeepSeek in System control. The general **OpenCode** entry shows all connected models. Use **Add Ollama / a compatible endpoint** to enter your API URL and installed model IDs. You can switch provider while keeping the same conversation. Provider subscriptions and API charges are separate. On Windows, Claude requires [Git for Windows with Git Bash](https://git-scm.com/downloads/win).

English is the default interface language. Choose **EN / FR** in Settings. Native command titles follow your VS Code language.

## Add context and tools

The chat’s **+** menu brings together files, container mentions, terminal context, commands, Monitor and kill chain shortcuts.

Use **`@`** to mention a project container and **`#`** to attach an excerpt from a terminal opened by the extension. You can also type these shortcuts directly.

> Summarize my observations and suggest the next two useful checks. Explain why before proposing a command.

Text, source files and logs are supported: **10 files**, **64 KiB per file**, **256 KiB in total**. Convert PDFs and images to text before attaching them.

In **Settings → System control**, enable the method profiles and MCP connectors you want available. Configure each external MCP service for your project. Then use **+** to choose one method, up to four MCP connectors, Burp and web search for this conversation. Disabling a connector preserves its configuration. A new conversation starts without optional resources selected.

Methods include **Mentor**, **Bug bounty**, **Out of the box**, **Red team** and **HTB / CTF**. A short brief guides the agent; detailed methods load only when needed. External MCP programs must be installed and started separately.

## Learn with hints

Put Markdown or PDF course material in the folder opened by **Settings → Atlas → Open courses folder**. Enable **Learning** in the chat’s **Configure** menu, attach terminal context with `#`, and ask for a hint or explanation. Learning mode reads course material and the context you provide; it does not execute commands or write files. Optional method profiles, MCP connectors and web search are paused in this mode.

## Stay in control

Sensitive actions produce approval cards. Allow an action once, deny it, or remember an eligible approval for the current conversation. Passwords, tokens and keys are masked before they reach logs.

**Bypass** approves actions for two hours, including actions the gate would normally deny. Its active state and countdown remain visible. Use it only for a scope you control. Learning mode is excluded.

## More

[User guide and source](https://github.com/tomtimlt/warband) · [Issues](https://github.com/tomtimlt/warband/issues) · MIT license
