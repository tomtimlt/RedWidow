import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { chatHtml, cockpitHtml, killchainHtml, makeNonce, studioHtml } from "../src/logic/html.js";
import { shortcutLabel } from "../src/logic/shortcuts.js";
import { readCss } from "./css.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const opts = {
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/chat.js",
  iconsUri: "https://x.vscode-cdn.net/media/icons.js",
  uiUri: "https://x.vscode-cdn.net/media/ui.js",
  styleUri: "https://x.vscode-cdn.net/media/chat.css",
};

describe("HTML du chat : raccourci de terminal selon la plate-forme", () => {
  it("Alt+J T par défaut hors macOS, Ctrl+J T transmis sous macOS, valeur refusée si suspecte", () => {
    expect(
      chatHtml({ ...opts, terminalShortcut: shortcutLabel("openTerminal", "linux") }),
    ).toContain('data-terminal-shortcut="Alt+J T"');
    expect(
      chatHtml({ ...opts, terminalShortcut: shortcutLabel("openTerminal", "darwin") }),
    ).toContain('data-terminal-shortcut="Ctrl+J T"');
    expect(() => chatHtml({ ...opts, terminalShortcut: '"><script>' })).toThrow();
  });
});

describe("HTML du chat : CSP stricte", () => {
  const html = chatHtml(opts);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

  it("politique exacte, sans unsafe-* ni source distante", () => {
    expect(csp).toBe(
      "default-src 'none'; script-src 'nonce-abc123_-XYZ'; style-src https://x.vscode-cdn.net; img-src https://x.vscode-cdn.net data:; font-src https://x.vscode-cdn.net",
    );
    expect(csp).not.toMatch(/unsafe|\*|http:/);
  });
  it("cinq scripts locaux (traductions, icônes, araignée, UI, chat), chacun avec nonce et source de l'extension ; aucun script ou style inline, aucun handler", () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(5);
    expect(scripts.map((m) => /src="([^"]+)"/.exec(m[1] ?? "")?.[1])).toEqual([
      "https://x.vscode-cdn.net/media/i18n.js",
      opts.iconsUri,
      "https://x.vscode-cdn.net/media/spider.js",
      opts.uiUri,
      opts.scriptUri,
    ]);
    for (const m of scripts) {
      expect(m[1]).toContain('nonce="abc123_-XYZ"');
      expect(m[2]).toBe("");
    }
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
    // Toutes les ressources viennent de l'origine webview.
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(m[1]?.startsWith("https://x.vscode-cdn.net/")).toBe(true);
    }
  });
  it("refuse une valeur capable de sortir d'un attribut", () => {
    expect(() => chatHtml({ ...opts, nonce: 'a"onload="x' })).toThrow();
    expect(() => chatHtml({ ...opts, scriptUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, iconsUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, i18nUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, spiderUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, uiUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, cspSource: 'a"><script>' })).toThrow();
  });
  it("nonce aléatoire à chaque rendu", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(makeNonce()).not.toBe(a);
  });
});

describe("araignée dans les réglages et la Kill chain", () => {
  it.each([studioHtml, killchainHtml])(
    "charge l’icône locale sous nonce avant le script de la vue",
    (render) => {
      const html = render({ ...opts, scriptUri: "https://x.vscode-cdn.net/media/studio.js" });
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      expect(scripts).toHaveLength(4);
      expect(scripts.map((match) => /src="([^"]+)"/.exec(match[1] ?? "")?.[1])).toEqual([
        "https://x.vscode-cdn.net/media/i18n.js",
        opts.iconsUri,
        "https://x.vscode-cdn.net/media/spider.js",
        "https://x.vscode-cdn.net/media/studio.js",
      ]);
      for (const match of scripts) {
        expect(match[1]).toContain(`nonce="${opts.nonce}"`);
        expect(match[2]).toBe("");
      }
      expect(() => render({ ...opts, spiderUri: 'x" onerror="y' })).toThrow();
    },
  );
});

describe("scripts de la webview", () => {
  const js = read("../media/chat.js");
  const ui = read("../media/ui.js");
  it("aucun HTML dynamique, style injecté ou évaluation de code", () => {
    for (const src of [js, ui]) {
      for (const bad of [
        'setAttribute("style"',
        "setAttribute('style'",
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "eval(",
        "new Function",
      ]) {
        expect(src, bad).not.toContain(bad);
      }
    }
  });
  it("le chat n'écoute plus le défilement : le suivi du Monitor vit dans viewer.js", () => {
    expect([...js.matchAll(/addEventListener\(\s*["']scroll/g)]).toHaveLength(0);
    expect(ui).not.toMatch(/addEventListener\(\s*["']scroll/);
    expect(read("../media/viewer.js")).toMatch(/addEventListener\(\s*["']scroll/);
  });
  it("seules écritures de style : propriétés --jn-* et hauteur du champ", () => {
    for (const m of js.matchAll(/\.style\.(\w+)/g))
      expect(["setProperty", "removeProperty", "height"]).toContain(m[1]);
    for (const m of js.matchAll(/style\.(?:setProperty|removeProperty)\(\s*("[^"]*")/g)) {
      expect(m[1]).toMatch(/^("--jn-[a-z]+"|"flex-grow")$/);
    }
  });
  it("n'insère jamais de HTML ni ne lance de code dynamique", () => {
    for (const bad of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "eval(",
      "new Function",
      "fetch(",
      "XMLHttpRequest",
    ]) {
      expect(js, bad).not.toContain(bad);
    }
    expect(js).toContain("textContent");
  });
  it("ne propose que les trois choix de la gate (pas de « tout autoriser »)", () => {
    const choices = [...js.matchAll(/button\(l\("[^"]+"\), "(\w+)"/g)].map((m) => m[1]);
    expect(choices.sort()).toEqual(["always", "deny", "once"]);
  });
});

describe("manifeste de l'extension", () => {
  const m = JSON.parse(read("../extension.manifest.json"));
  it("inerte en espace non approuvé", () => {
    expect(m.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(m.capabilities.virtualWorkspaces).toBe(false);
  });
  it("les réglages gardent leur scope prévu", () => {
    const props = Object.entries(m.contributes.configuration.properties) as [
      string,
      { scope: string },
    ][];
    expect(props.length).toBeGreaterThan(0);
    for (const [key, p] of props)
      expect(p.scope, key).toBe(
        key === "warband.palette"
          ? "window"
          : key === "warband.language"
            ? "application"
            : "machine",
      );
  });
  it("aucun réglage ne désactive ou ne contourne la gate", () => {
    const keys = Object.keys(m.contributes.configuration.properties).join(" ");
    expect(keys).not.toMatch(/bash|allow|auto|yolo|permission|binary|path/i);
  });
});

describe("composer et Configurer (lot P1)", () => {
  const html = chatHtml(opts);
  const css = readCss();
  const js = read("../media/chat.js");
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  const section = (from: string, to: string) =>
    html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));

  it("le compositeur ne présente pas de fonction future", () => {
    expect(tag("attach")).toBe("");
    expect(html).not.toContain("bientôt");
  });
  it("le menu « / » ne propose que /clear", () => {
    const menu = section('id="slash-pop"', 'id="cfg-pop"');
    const studio = read("../media/studio.js");
    expect(menu.match(/class="cmd-opt"/g)).toHaveLength(1);
    expect(menu).toContain("/clear");
    expect(menu).not.toContain("/start");
    expect(js).not.toContain("/start");
    expect(studio).not.toContain("/start");
    expect(js).toContain(
      "Aucun terminal RedWidow ouvert. ${document.body.dataset.terminalShortcut",
    );
    expect(js).not.toContain("Alt+J T pour en ouvrir un");
    expect(studio).toContain("Aucun conteneur affiché. Gérez les associations dans le cockpit.");
    expect(studio).toContain("Aucun conteneur pour l’instant");
    expect(html).not.toMatch(/\bmcp\b|jauge|compact|pièce jointe active/i);
  });
  it("Monitor reste accessible dans le menu + et ouvre le panneau", () => {
    const toolbar = section('id="toolbar"', 'id="model-pop"');
    expect(toolbar.indexOf('id="monitor-btn"')).toBeGreaterThan(toolbar.indexOf('id="slash-btn"'));
    expect(tag("monitor-btn")).toContain('class="ghost composer-action"');
    expect(tag("monitor-btn")).toContain('aria-label="Monitor"');
    expect(js).toContain('vscode.postMessage({ type: "openMonitor" })');
    const ext = read("../src/extension/extension.ts");
    expect(ext).toMatch(/case "openMonitor":\s*openMonitor\(\);/);
  });
  it("les boutons @, # et / existent, le dernier ouvre le menu", () => {
    expect(tag("mention-btn")).toContain('aria-controls="mention-pop"');
    expect(tag("hash-btn")).toContain('aria-controls="mention-pop"');
    expect(html.indexOf('id="hash-btn"')).toBeGreaterThan(html.indexOf('id="mention-btn"'));
    expect(html.indexOf('id="hash-btn"')).toBeLessThan(html.indexOf('id="slash-btn"'));
    expect(tag("slash-btn")).toContain('popovertarget="slash-pop"');
    expect(html).toContain('id="mention-pop"');
    expect(html).toContain('id="mention-list"');
  });
  it("Configurer regroupe les fonctions disponibles en deux sections", () => {
    const cfg = section('id="cfg-pop"', "<script nonce");
    expect(cfg).toContain('class="cfg-col cfg-model"');
    expect(cfg).toContain('class="cfg-col cfg-execution"');
    expect(cfg).toContain("Modèle et raisonnement");
    expect(cfg).toContain('<select id="provider"');
    expect(cfg).toContain('value="claude">Claude');
    expect(cfg).toContain('value="openai">OpenAI (ChatGPT / API)');
    expect(cfg).toContain('value="opencode">OpenCode');
    expect(cfg).toContain("Configurer la connexion");
    expect(cfg).toContain("Réglages → Fournisseurs");
    expect(js).toContain('type: "selectProvider", id: event.target.value');
    expect(js).toContain('$("provider").disabled = c.locked');
    expect(js).toContain('$("provider-connect").addEventListener');
    expect(js).toContain("ctlGroup.hidden = !view.controls || noProvider");
    expect(cfg).not.toMatch(/cfg-off|cfg-later|Bientôt|Persona|Answer, Plan/);
  });
  it("Configurer n'a plus de sélecteur de disposition", () => {
    const cfg = section('id="cfg-pop"', "<script nonce");
    expect(cfg).not.toContain("layout-seg");
    expect(cfg).not.toContain("data-layout");
    expect(cfg.indexOf("raisonnement")).toBeGreaterThanOrEqual(0);
  });
  it("Kill chain : bouton compositeur et vue plein écran dédiée", () => {
    const toolbar = section('id="toolbar"', 'id="model-pop"');
    expect(toolbar.indexOf('id="killchain-btn"')).toBeGreaterThan(
      toolbar.indexOf('id="slash-btn"'),
    );
    expect(tag("killchain-btn")).toContain('aria-label="Kill chain"');
    expect(js).toContain('vscode.postMessage({ type: "openKillchain" })');
    const ext = read("../src/extension/extension.ts");
    expect(ext).toMatch(/case "openKillchain":\s*openKillchain\(\);/);
    expect(ext).toContain('"warband.killchain"');
    const studio = read("../media/studio.js");
    // Les réglages n'ont plus de page Kill chain : le panneau autonome s'ouvre depuis l'hôte.
    expect(studio).not.toContain('type: "openKillchain"');
    expect(studio).toContain("killchain-full");
    expect(studio).toContain("studio-kc-page");
    expect(studio).not.toContain("studio-card studio-kc-page");
    expect(css).toMatch(/body\.killchain-full \.studio-kc-page\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/body\.killchain-full \.kc-viewport\s*\{[^}]*height:\s*100%/);
    expect(read("../src/extension/extension.ts")).not.toContain("Cite un conteneur");
  });
  it("chaque chat rend ses cartes ; le Monitor, la Sortie et le Rapport ne sont plus servis par le chat", () => {
    expect(js).not.toContain("cardsFor");
    expect(js).not.toContain("setLayout");
    expect(js).toContain("view.approvals");
    expect(html).not.toContain('id="away-return"');
    expect(html).not.toMatch(/id="monitor(?!-btn)/);
    expect(html).not.toContain("mon-");
    expect(js).not.toMatch(/mode-(monitor|watch|report)|monitorRows|renderReport/);
    expect(html).not.toMatch(/Autoriser une fois|Toujours</);
  });
  it("les sélecteurs testés sont conservés", () => {
    for (const id of [
      "model-chip",
      "cfg-btn",
      "history-btn",
      "thinking",
      "send",
      "monitor-btn",
      "killchain-btn",
      "no-provider-add",
    ]) {
      expect(tag(id), id).not.toBe("");
    }
    expect(html).toContain('class="brand thinking-mark"');
  });
  it("D2 : plus d'élément .sweep ni de curseur ▍ dans #thinking, plus de classes sweep/pop posées par chat.js", () => {
    expect(html).not.toContain("sweep");
    expect(section('id="thinking"', 'id="composer"')).not.toMatch(/cursor|▍/);
    expect(js).not.toMatch(/\.sweep|"sweep"|"pop"|modelFx|pop-[ab]/);
  });
  it("la bordure orange suit la présence d'une carte dans #approvals", () => {
    expect(js).toContain('classList.toggle("awaiting", approvals.childElementCount > 0)');
    const rule = /body\.awaiting #composer \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("--vscode-editorWarning-foreground");
    expect(rule).toContain("--vscode-inputValidation-warningBorder");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("les rayons suivent la nouvelle charte et l’attente conserve une couleur du thème", () => {
    expect(css).toContain("--jn-r-sm: 8px");
    expect(css).toContain("--jn-r-md: 12px");
    expect(css).toContain("--jn-r-lg: 18px");
    expect(css).toContain("body.awaiting #composer");
    expect(css).toContain("--vscode-editorWarning-foreground");
  });
  it("Configurer garde ses deux sections sans options factices", () => {
    expect(tag("cfg-pop")).toContain('role="dialog"');
    expect(html).toContain('class="cfg-col cfg-model"');
    expect(html).toContain('class="cfg-col cfg-execution"');
  });
});

it("les titres Monitor et rapport préservent le mot-symbole, le logo et les contrôles", () => {
  const html = chatHtml(opts);
  const bar = html.slice(html.indexOf('<header id="bar">'), html.indexOf("</header>"));
  expect(bar).toContain('class="brand-name"><span class="brand-ops">Red</span>Widow');
  expect(bar).toContain('id="context-title" class="context-title" hidden');
  const js = read("../media/chat.js");
  const start = js.indexOf('  window.addEventListener("message",');
  const listener = js.slice(start, js.indexOf("\n  function grow()", start));
  const node = (textContent = "") => ({ textContent, title: "", hidden: false });
  const wordmark = node("VENATOR OPS");
  const contextTitle = node();
  const title = node("VENATOR OPS");
  let receive: (event: { data: unknown }) => void = () => {};
  const nodes = new Map([
    ["title", title],
    ["context-title", contextTitle],
  ]);
  runInNewContext(listener, {
    $: (id: string) => nodes.get(id),
    document: { querySelector: () => wordmark },
    window: {
      addEventListener: (_: string, handler: typeof receive) => {
        receive = handler;
      },
    },
  });
  for (const text of ["Monitor", "Rapport — Projet", "<b>texte littéral</b>", "x".repeat(200)]) {
    receive({ data: { type: "title", text } });
    expect(contextTitle.textContent).toBe(text.slice(0, 120));
    expect(contextTitle.title).toBe(contextTitle.textContent);
    expect(contextTitle.hidden).toBe(false);
    expect(wordmark.textContent).toBe("VENATOR OPS");
    expect(title.textContent).toBe("VENATOR OPS");
  }
  receive({ data: { type: "title", text: "" } });
  expect(contextTitle.hidden).toBe(true);
  receive({ data: { type: "title", text: { invalid: true } } });
  expect(contextTitle.textContent).toBe("");
});

describe("Bypass des approbations (lot B1, ADR 0006)", () => {
  const html = chatHtml(opts);
  const css = readCss();
  const js = read("../media/chat.js");
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  const cfg = html.slice(html.indexOf('id="cfg-pop"'), html.indexOf("<script nonce"));
  /** Corps d'une fonction de chat.js, de sa déclaration à la ligne de fermeture (indentation de 2). */
  const fnBody = (src: string, name: string) => {
    const s = src.indexOf(`function ${name}(`);
    const e = src.indexOf("\n  }\n", s);
    return s < 0 || e < 0 ? "" : src.slice(s, e + 5);
  };

  it("interrupteur : role=switch, aria-checked=false, sans disabled, décrit par état et avertissement", () => {
    const sw = tag("bypass-switch");
    expect(sw).toContain('role="switch"');
    expect(sw).toContain('aria-checked="false"');
    expect(sw).not.toMatch(/\sdisabled[\s>]/);
    expect(sw).toContain('aria-describedby="bypass-state bypass-warn"');
  });
  it("Bypass dans la section Exécution, état en role=status", () => {
    expect(cfg).toContain(
      '<section class="cfg-col cfg-execution" aria-labelledby="cfg-h-execution">',
    );
    expect(tag("bypass-state")).toContain('role="status"');
    expect(cfg).not.toContain("cfg-later");
  });
  it("avertissement : durée choisie et responsabilité explicite", () => {
    expect(html).toContain(
      "Approuve tout pendant la durée choisie, deny compris : chemins sensibles ou hors projet, accès hôte d'un conteneur, dangers shell, sans rien mémoriser.",
    );
    expect(html).toContain("Vous en devenez responsable.");
    expect(html).toContain(
      "Pendant le Bypass, les actions de l’agent ne vous sont plus demandées ; vous en êtes responsable.",
    );
  });
  it("badge dans #bar après #sandbox, masqué au départ", () => {
    const bar = html.slice(html.indexOf('<header id="bar">'), html.indexOf("</header>"));
    expect(bar.indexOf('id="sandbox"')).toBeLessThan(bar.indexOf('id="bypass-badge"'));
    expect(tag("bypass-badge")).toMatch(/\shidden[\s>]/);
  });
  it("la webview transmet la durée choisie à l'activation et demande la coupure", () => {
    const bodies = [...js.matchAll(/postMessage\(\{([^}]*)\}\)/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((b) => b.includes("setBypass"));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('type: "setBypass", enabled: false');
    expect(bodies[1]).toContain('type: "setBypass"');
    expect(bodies[1]).toContain("enabled: true");
    expect(bodies[1]).toContain("durationMs: bypassUnlimited ? null : durationMs");
  });
  it("le clic ouvre le choix ou demande la coupure sans modifier l'état actif", () => {
    const click = fnBody(js, "toggleBypass");
    expect(click).toContain("bypassPop.showPopover()");
    expect(click).toContain('type: "setBypass", enabled: false');
    expect(click).not.toMatch(
      /bypassSwitch\.setAttribute|bypassState\.textContent|bypassBadge|classList|replaceChildren/,
    );
    const activation = js.slice(
      js.indexOf('$("bypass-activate").addEventListener'),
      js.indexOf("  function resetConversation()"),
    );
    expect(activation).toContain('type: "setBypass"');
    expect(activation).not.toMatch(
      /bypassSwitch\.setAttribute|bypassState\.textContent|bypassBadge|classList|replaceChildren/,
    );
  });
  it("aria-checked, bypass-on, badge et texte d'état ne sont écrits que par renderBypass", () => {
    const render = fnBody(js, "renderBypass");
    expect(render).toContain('bypassSwitch.setAttribute("aria-checked"');
    expect(render).toContain('classList.toggle("bypass-on"');
    const outside = js.replace(render, "");
    for (const bad of [
      "bypassSwitch.setAttribute",
      "bypassState.textContent",
      "bypassBadge.hidden",
      "bypassBadge.title",
      "bypassBadge.replaceChildren",
      'classList.add("bypass-on"',
      'classList.toggle("bypass-on"',
    ]) {
      expect(outside, bad).not.toContain(bad);
    }
    // Rendu appelé seulement par le gestionnaire `message`, à l'ouverture de Configurer et par
    // renderControls (le mode Apprentissage grise le Bypass, ADR 0010).
    expect(outside.match(/renderBypass\(\)/g)).toHaveLength(3);
  });
  it("le gestionnaire message ne traite le Bypass que sur un message `bypass`", () => {
    expect(js).toContain('else if (message && message.type === "bypass")');
  });
  it("le reset passe toujours par resetConversation (drapeau d'arrêt demandé)", () => {
    expect(js.match(/type: "reset"/g)).toHaveLength(1);
    expect(js).toContain('bypassUserOff = true;\n    vscode.postMessage({ type: "reset" });');
  });
  it("le clic et le rendu de verdict ne créent pas eux-mêmes de minuteur", () => {
    const block = fnBody(js, "renderBypass") + fnBody(js, "toggleBypass");
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
  it("bordure active magenta, sans hex ni animation de la bordure", () => {
    const rule = /body\.bypass-on #composer \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("var(--jn-bypass)");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).not.toMatch(/animation|transition/);
    const section = css
      .slice(css.indexOf("--- Bypass des approbations"), css.indexOf("--- Cockpit"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(section).not.toMatch(/animation|@keyframes/);
  });
  it("sous 360 px, seule l'heure du badge est masquée visuellement", () => {
    expect(css).toMatch(/@container app \(max-width: 359px\) \{[\s\S]*?#bypass-badge \.bp-time \{/);
  });
});

describe("Mode apprentissage (ADR 0010)", () => {
  const html = chatHtml(opts);
  const css = readCss();
  const js = read("../media/chat.js");
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  const cfg = html.slice(html.indexOf('id="cfg-pop"'), html.indexOf("<script nonce"));

  it("interrupteur role=switch dans Configurer, avant Bypass", () => {
    const sw = tag("learning-switch");
    expect(sw).toContain('role="switch"');
    expect(sw).toContain('aria-checked="false"');
    expect(cfg.indexOf('id="learning-switch"')).toBeLessThan(cfg.indexOf('id="bypass-switch"'));
  });
  it("les bascules sont regroupées dans Configurer", () => {
    for (const id of ["bar-learning", "bar-bypass"]) expect(tag(id)).toBe("");
    expect(cfg).toContain('id="learning-switch"');
    expect(cfg).toContain('id="bypass-switch"');
    expect(js).not.toContain("innerHTML");
  });
  it("les bascules Configurer conservent les messages existants", () => {
    expect(js).toContain('learningSwitch.addEventListener("click", toggleLearning)');
    expect(js).toContain('bypassSwitch.addEventListener("click", toggleBypass)');
    expect(js.match(/type: "setLearning"/g)?.length).toBe(1);
    expect(js.match(/type: "setBypass"/g)?.length).toBe(2);
    expect(js).not.toMatch(/barLearning|barBypass/);
  });
  it("pastille dans l'en-tête, masquée au départ", () => {
    const bar = html.slice(html.indexOf('<header id="bar">'), html.indexOf("</header>"));
    expect(bar).toContain('id="learning-badge"');
    expect(tag("learning-badge")).toMatch(/\shidden[\s>]/);
  });
  it("la webview n'envoie setLearning qu'avec une clé booléenne", () => {
    const bodies = [...js.matchAll(/postMessage\(\{([^}]*)\}\)/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((b) => b.includes("setLearning"));
    expect(bodies).toEqual(['type: "setLearning", enabled: ctl.learning !== true']);
  });
  it("Bypass grisé en apprentissage : texte, aria-disabled, sans badge ni bypass-on", () => {
    expect(js).toContain("Inopérant en mode Apprentissage");
    expect(js).toContain('bypassSwitch.setAttribute("aria-disabled", String(learning))');
    expect(js).toContain('document.body.classList.toggle("learning"');
    expect(css).toContain("#learning-badge");
  });
});

describe("Mode Sous-agents (ADR 0054)", () => {
  const html = chatHtml(opts);
  const js = read("../media/chat.js");
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  const cfg = html.slice(html.indexOf('id="cfg-pop"'), html.indexOf("<script nonce"));

  it("interrupteur role=switch dans Exécution, avant Apprentissage, décrit par son aide", () => {
    const sw = tag("subagents-switch");
    expect(sw).toContain('role="switch"');
    expect(sw).toContain('aria-checked="false"');
    expect(sw).toContain('aria-describedby="subagents-help"');
    expect(tag("subagents-help")).toContain('class="tip"');
    expect(cfg).toContain('class="cfg-col cfg-execution"');
    expect(cfg.indexOf('class="cfg-col cfg-execution"')).toBeLessThan(
      cfg.indexOf('id="subagents-switch"'),
    );
    expect(cfg.indexOf('id="subagents-switch"')).toBeLessThan(cfg.indexOf('id="learning-switch"'));
  });
  it("puce dans la barre, masquée au départ, avant l'espaceur, ouvrant Configurer", () => {
    const chip = tag("subagents-chip");
    expect(chip).toMatch(/\shidden[\s>]/);
    expect(chip).toContain('class="chip"');
    expect(chip).toContain('popovertarget="cfg-pop"');
    const toolbar = html.slice(html.indexOf('id="toolbar"'), html.indexOf('id="model-pop"'));
    expect(toolbar).toContain('id="subagents-count"');
    expect(toolbar.indexOf('id="subagents-chip"')).toBeLessThan(toolbar.indexOf('class="spacer"'));
  });
  it("chat.js n'envoie setSubagents que depuis un seul point, avec une clé booléenne", () => {
    expect(js).toContain('subagentsSwitch.addEventListener("click", toggleSubagents)');
    expect(js.match(/type: "setSubagents"/g)?.length).toBe(1);
    // Un seul appel factorisé : l'interrupteur envoie l'inverse de l'état effectif, le lien du fil envoie `false`.
    const bodies = [...js.matchAll(/postMessage\(\{([^}]*)\}\)/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((b) => b.includes("setSubagents"));
    expect(bodies).toEqual(['type: "setSubagents", enabled']);
    expect(js).toContain("setSubagentsMode(ctl.subagents !== true)");
    expect(js).toContain("setSubagentsMode(false)");
  });
  it("chat.js ne reconstruit rien par innerHTML et ne lit que l'état effectif du contrôle", () => {
    expect(js).not.toContain("innerHTML");
    expect(js).toContain('$("subagents-chip").hidden = c.subagents !== true');
    expect(js).toContain('"aria-checked", String(c.subagents === true)');
    expect(js).toContain('"aria-disabled", String(c.locked || c.learning)');
  });
  it("le rendu en anglais contient « Subagents », sans perdre la clé française", () => {
    const english = chatHtml({ ...opts, locale: "en" });
    expect(english).toContain('data-i18n="Sous-agents">Subagents</span>');
    expect(english).toContain(
      "The agent proposes parallel subagents (up to 4); you choose which ones run.",
    );
    expect(english).toContain('title="Subagents mode on: open Configure"');
    expect(html).toContain(">Sous-agents</span>");
  });
  it("le style de l'interrupteur couvre aussi Sous-agents", () => {
    const css = readCss();
    expect(css).toContain('#subagents-switch[aria-checked="true"]::after');
    expect(css).toContain('#subagents-switch[aria-disabled="true"]');
  });
});

describe("Proposition de sous-agents : carte et élément du fil (ADR 0054, lot B)", () => {
  const html = chatHtml(opts);
  const js = read("../media/chat.js");
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  /** Corps d'une fonction de chat.js, de sa déclaration à la ligne de fermeture (indentation de 2). */
  const body = (name: string) => {
    const start = js.indexOf(`  function ${name}(`);
    return start < 0 ? "" : js.slice(start, js.indexOf("\n  }\n", start) + 5);
  };
  const card = body("renderSubagentsCard");
  const item = body("renderSubagentsItem");

  it("l'indice sous le champ est présent, masqué, annoncé, et placé entre #input et la barre", () => {
    const hint = tag("subagents-hint");
    expect(hint).toMatch(/\shidden[\s>]/);
    expect(hint).toContain('role="status"');
    expect(hint).toContain('class="hint"');
    expect(html.indexOf('id="input"')).toBeLessThan(html.indexOf('id="subagents-hint"'));
    expect(html.indexOf('id="subagents-hint"')).toBeLessThan(html.indexOf('id="toolbar"'));
    expect(html).toContain(
      "Une proposition de sous-agents attend votre choix : envoyer un message la refuse, avec ce texte pour note.",
    );
    expect(chatHtml({ ...opts, locale: "en" })).toContain(
      "A subagent proposal is waiting: sending a message declines it, with your text as the note.",
    );
  });
  it("chat.js affiche l'indice tant que la vue porte une proposition", () => {
    expect(js).toContain('$("subagents-hint").hidden = proposal === null');
  });
  it("chat.js n'envoie answerSubagents que depuis un seul point, sans note", () => {
    expect(js.match(/type: "answerSubagents"/g)?.length).toBe(1);
    const bodies = [...js.matchAll(/postMessage\(\{([^}]*)\}\)/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((b) => b.includes("answerSubagents"));
    expect(bodies).toEqual(['type: "answerSubagents", proposalId: proposal.proposalId, selected']);
    expect(js).not.toMatch(/answerSubagents[^)]*note/);
  });
  it("aucun innerHTML ni gabarit HTML : la carte et l'élément posent le texte du modèle par el()", () => {
    expect(js).not.toContain("innerHTML");
    expect(js).not.toMatch(/insertAdjacentHTML|outerHTML/);
    expect(card).not.toBe("");
    expect(item).not.toBe("");
    for (const code of [card, item]) {
      expect(code).not.toMatch(/innerHTML|insertAdjacentHTML|style=|createElement|\.html\b/);
      for (const m of code.matchAll(/\bel\(\s*"(\w+)"/g)) {
        expect([
          "div",
          "span",
          "p",
          "strong",
          "button",
          "details",
          "summary",
          "ul",
          "li",
          "form",
          "label",
          "input",
        ]).toContain(m[1]);
      }
    }
    expect(card).toContain('el("strong", "subagents-name", entry.name)');
    expect(card).toContain('el("span", "subagents-goal", entry.goal)');
    expect(item).toContain('el("strong", "subagents-name", entry.name)');
  });
  it('la branche kind === "subagents" existe dans le rendu, avant la branche notice par défaut', () => {
    const render = body("renderItem");
    expect(render).toContain('item.kind === "subagents"');
    expect(
      render.indexOf('item.kind === "subagents") node = renderSubagentsItem(item)'),
    ).toBeLessThan(render.indexOf('node = el("div", `notice'));
  });
  it("carte : formulaire dans #approvals, cases cochées au départ, bouton principal et secondaire", () => {
    expect(card).toContain('el("form", "card subagents-card enter")');
    expect(card).toContain("box.checked = true");
    expect(card).toContain('main.type = "submit"');
    expect(card).toContain('l("Aucun sous-agent")');
    expect(card).toContain('t("Lancer la sélection ({0})", { 0: count })');
    expect(card).toContain('t("Lancement…")');
    expect(card).toContain("main.disabled = sent || count === 0");
    expect(card).toContain('none.addEventListener("click", () => answer([]))');
    expect(js).toContain(
      "stableChildren(approvals, subagentsCard ? [subagentsCard.node, ...cards] : cards)",
    );
  });
  it("carte : Échap rend le focus au champ sans refuser, Entrée envoie seulement si n > 0", () => {
    expect(card).toContain('e.key === "Escape"');
    expect(card).toContain("input.focus();");
    // Un seul envoi, via answer : Échap ne l'appelle pas.
    const escapeBranch = card.slice(
      card.indexOf('e.key === "Escape"'),
      card.indexOf('e.key === "Enter"'),
    );
    expect(escapeBranch).not.toContain("answer(");
    expect(card).toContain("if (selected.length > 0) answer(selected)");
    expect(card).toContain("if (sent) return;");
  });
  it("la carte n'est jamais retirée côté webview avant la vue de l'hôte", () => {
    expect(card).not.toMatch(/\.remove\(|replaceChildren|hidden\s*=/);
    expect(js).toContain("if (proposal === null) subagentsCard = null;");
  });
  it("le focus va à la première case d'une carte nouvelle, avant les cartes d'autorisation", () => {
    expect(js).toContain('if (freshProposal) subagentsCard.node.querySelector("input")?.focus();');
  });
  it("le lien « Désactiver » n'est offert qu'après un refus, hors lecture seule et hors tour en cours", () => {
    expect(item).toContain('item.status === "declined" && item.canDisable');
    expect(js).toContain(
      "view.controls?.subagents === true && view.controls.locked !== true && !view.readonly",
    );
  });
  it("le style de la carte et de l'élément du fil existe", () => {
    const css = readCss();
    for (const selector of [
      ".subagents-options",
      ".subagents-option",
      ".subagents-item",
      ".subagents-goal",
      "#subagents-hint",
    ])
      expect(css).toContain(selector);
  });
});

describe("Sous-agents en cours : imbrication, nom et compteur (ADR 0054, lot C)", () => {
  const js = read("../media/chat.js");
  /** Corps d'une fonction de chat.js, de sa déclaration à la ligne de fermeture (indentation de 2). */
  const body = (name: string) => {
    const start = js.indexOf(`  function ${name}(`);
    return start < 0 ? "" : js.slice(start, js.indexOf("\n  }\n", start) + 5);
  };
  const renderCard = body("renderCard");
  const renderTool = body("renderTool");
  const taskBox = body("renderTaskBox");
  const count = body("paintSubagentsCount");

  it("la ligne « Sous-agent » de la carte d'autorisation est construite par textContent (el), sans HTML", () => {
    expect(renderCard).not.toBe("");
    expect(renderCard).toContain('"card-agent"');
    expect(renderCard).toContain('l("Sous-agent « {0} »", { 0: card.agent })');
    expect(renderCard).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|createElement/);
    // Le nom du modèle n'entre jamais dans un gabarit : seul le paramètre du traducteur le porte.
    expect(renderCard).not.toMatch(/`[^`]*\$\{card\.agent\}/);
  });

  it("le nom du sous-agent, l'état et le préfixe se posent par el(), sans gabarit ni HTML", () => {
    expect(renderTool).toContain('el("span", "tool-summary subagent-name", item.agent)');
    expect(renderTool).toContain('el("span", "subagent-tag", t("Sous-agent"))');
    expect(renderTool).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|createElement/);
    expect(renderTool).not.toMatch(/`[^`]*\$\{item\.agent\}/);
  });

  it("les appels d'un sous-agent sont rangés dans un <details> replié sous le Task", () => {
    expect(taskBox).toContain('el("details", "subagent-calls")');
    expect(taskBox).toContain("details.open = openCalls.has(toolUseId)");
    expect(taskBox).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|createElement/);
    expect(js).toContain("launchers.has(item.parentToolUseId)");
  });

  it("le compteur de la puce se pose par textContent et annonce sa valeur par aria-label", () => {
    expect(count).toMatch(/count\.textContent = ` · \$\{running\}\/\$\{max\}`/);
    expect(count).toContain('count.setAttribute(\n      "aria-label"');
    expect(count).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(js).toContain("paintSubagentsCount(view.subagents)");
    expect(chatHtml(opts)).toContain('<span id="subagents-count"></span>');
  });

  it("aucun innerHTML n'est ajouté à chat.js", () => {
    expect(js).not.toContain("innerHTML");
  });

  it("le style de l'imbrication, du nom et de la ligne de la carte existe", () => {
    const css = readCss();
    for (const selector of [
      ".subagent-name",
      ".subagent-tag",
      ".subagent-task",
      ".subagent-calls",
      ".subagent-calls-body",
      ".card-agent",
    ])
      expect(css).toContain(selector);
  });
});

describe("HTML localisé des webviews", () => {
  it("traduit les textes statiques et attributs tout en conservant les annotations françaises", () => {
    const french = chatHtml(opts);
    const english = chatHtml({ ...opts, locale: "en" });
    expect(french).toContain('<html lang="fr">');
    expect(english).toContain('<html lang="en">');
    expect(french).toContain('aria-label="Votre consigne"');
    expect(english).toContain('aria-label="Your instruction"');
    expect(english).toContain('placeholder="Your instruction…"');
    expect(english).toContain('data-i18n-placeholder="Votre consigne…"');
    expect(english).toContain('data-i18n="Tout effacer">Clear all</span>');
    expect(english).toContain('id="send"');
    expect(english).toContain(
      'data-i18n="Vous en devenez responsable.">You take responsibility for it.</span>',
    );
  });
  it("charge les traductions avant tous les rendus, pour chaque page", () => {
    for (const renderer of [chatHtml, cockpitHtml, studioHtml, killchainHtml]) {
      const html = renderer({ ...opts, locale: "en" });
      expect(html).toContain('<html lang="en">');
      const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
      expect(scripts[0]?.[1]).toContain("media/i18n.js");
      for (const script of scripts) expect(script[1]).toContain(`nonce="${opts.nonce}"`);
    }
    expect(cockpitHtml({ ...opts, locale: "en" })).toContain(
      'data-i18n="Conteneurs">Containers</span>',
    );
    expect(studioHtml({ ...opts, locale: "en" })).toContain('aria-label="Settings"');
    expect(killchainHtml({ ...opts, locale: "en" })).toContain(
      '<title data-i18n="Graphe">Graph</title>',
    );
  });
});
