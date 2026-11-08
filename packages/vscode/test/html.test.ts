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
  it("le seul écouteur scroll suit le Monitor sans reconstruire la vue", () => {
    expect([...js.matchAll(/addEventListener\(\s*["']scroll/g)]).toHaveLength(1);
    expect(ui).not.toMatch(/addEventListener\(\s*["']scroll/);
    const listener = js.match(
      /monitor\.addEventListener\(\s*["']scroll["'],\s*\(\) => \{([\s\S]*?)\},\s*\{\s*passive:\s*true\s*\}\s*,?\s*\)/,
    );
    expect(listener).not.toBeNull();
    expect(listener?.[1]).toContain("monitorFollow = false");
    expect(listener?.[1]).not.toMatch(/render|replaceChildren|innerHTML|outerHTML|postMessage/);
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
    expect(studio).toContain('type: "openKillchain"');
    expect(studio).toContain("killchain-full");
    expect(studio).toContain("studio-kc-page");
    expect(studio).not.toContain("studio-card studio-kc-page");
    expect(css).toMatch(/body\.killchain-full \.studio-kc-page\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/body\.killchain-full \.kc-viewport\s*\{[^}]*height:\s*100%/);
    expect(read("../src/extension/extension.ts")).not.toContain("Cite un conteneur");
  });
  it("chaque chat rend ses cartes ; le Monitor est une section sans décision", () => {
    expect(js).not.toContain("cardsFor");
    expect(js).not.toContain("setLayout");
    expect(js).toContain("view.approvals");
    expect(html).not.toContain('id="away-return"');
    expect(tag("monitor-rows")).not.toBe("");
    const monitor = section('id="monitor"', 'id="approvals"');
    expect(monitor).not.toMatch(/once|deny|always|approve/);
    expect(html).not.toMatch(/Autoriser une fois|Toujours</);
  });
  it("les sélecteurs testés sont conservés", () => {
    for (const id of [
      "model-chip",
      "cfg-btn",
      "history-btn",
      "thinking",
      "send",
      "stop",
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
  it("avertissement (ADR 0017) : deux phrases exactes, tout est levé", () => {
    expect(html).toContain(
      "Approuve tout pendant 2 h, deny compris : chemins sensibles ou hors projet, accès hôte d'un conteneur, dangers shell, sans rien mémoriser.",
    );
    expect(html).toContain("Vous en devenez responsable.");
  });
  it("badge dans #bar après #sandbox, masqué au départ", () => {
    const bar = html.slice(html.indexOf('<header id="bar">'), html.indexOf("</header>"));
    expect(bar.indexOf('id="sandbox"')).toBeLessThan(bar.indexOf('id="bypass-badge"'));
    expect(tag("bypass-badge")).toMatch(/\shidden[\s>]/);
  });
  it("la webview n'envoie qu'un setBypass avec une seule clé booléenne", () => {
    const bodies = [...js.matchAll(/postMessage\(\{([^}]*)\}\)/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((b) => b.includes("setBypass"));
    expect(bodies).toEqual(['type: "setBypass", enabled']);
  });
  it("le clic n'écrit ni aria-checked, ni classe, ni texte", () => {
    const click = fnBody(js, "toggleBypass");
    expect(click).toContain("const enabled = !(last?.on === true || last?.armed === true);");
    expect(click).not.toMatch(/setAttribute|classList|textContent|\.hidden|replaceChildren/);
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
    expect(js.match(/type: "setBypass"/g)?.length).toBe(1);
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
