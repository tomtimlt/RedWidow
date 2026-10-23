import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatHtml, makeNonce } from "../src/logic/html.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const opts = {
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/chat.js",
  uiUri: "https://x.vscode-cdn.net/media/ui.js",
  styleUri: "https://x.vscode-cdn.net/media/chat.css",
};

describe("HTML du chat : CSP stricte", () => {
  const html = chatHtml(opts);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

  it("politique exacte, sans unsafe-* ni source distante", () => {
    expect(csp).toBe(
      "default-src 'none'; script-src 'nonce-abc123_-XYZ'; style-src https://x.vscode-cdn.net; img-src https://x.vscode-cdn.net",
    );
    expect(csp).not.toMatch(/unsafe|\*|http:|data:/);
  });
  it("deux scripts (ui.js puis chat.js), chacun avec nonce et source de l'extension ; aucun script ou style inline, aucun handler", () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(2);
    expect(scripts.map((m) => /src="([^"]+)"/.exec(m[1] ?? "")?.[1])).toEqual([
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
    expect(() => chatHtml({ ...opts, uiUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, cspSource: 'a"><script>' })).toThrow();
  });
  it("nonce aléatoire à chaque rendu", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(makeNonce()).not.toBe(a);
  });
});

describe("scripts de la webview", () => {
  const js = read("../media/chat.js");
  const ui = read("../media/ui.js");
  it("liste noire : pas d'horloge visuelle, de style en ligne ni de HTML dynamique", () => {
    for (const src of [js, ui]) {
      for (const bad of [
        'setAttribute("style"',
        "setAttribute('style'",
        "requestAnimationFrame",
        "setInterval",
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "eval(",
        "new Function",
      ]) {
        expect(src, bad).not.toContain(bad);
      }
      expect(src).not.toMatch(/addEventListener\(\s*["']scroll/);
    }
  });
  it("seules écritures de style : propriétés --jn-* et hauteur du champ", () => {
    for (const m of js.matchAll(/\.style\.(\w+)/g))
      expect(["setProperty", "height"]).toContain(m[1]);
    for (const m of js.matchAll(/style\.setProperty\(\s*("[^"]*")/g)) {
      expect(m[1]).toMatch(/^"--jn-[a-z]+"$/);
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
    const choices = [...js.matchAll(/button\("[^"]+", "(\w+)"/g)].map((m) => m[1]);
    expect(choices.sort()).toEqual(["always", "deny", "once"]);
  });
});

describe("manifeste de l'extension", () => {
  const m = JSON.parse(read("../extension.manifest.json"));
  it("inerte en espace non approuvé", () => {
    expect(m.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(m.capabilities.virtualWorkspaces).toBe(false);
  });
  it("tous les réglages sont en scope machine", () => {
    const props = Object.entries(m.contributes.configuration.properties) as [
      string,
      { scope: string },
    ][];
    expect(props.length).toBeGreaterThan(0);
    for (const [key, p] of props) expect(p.scope, key).toBe("machine");
  });
  it("aucun réglage ne désactive ou ne contourne la gate", () => {
    const keys = Object.keys(m.contributes.configuration.properties).join(" ");
    expect(keys).not.toMatch(/bash|allow|auto|yolo|permission|binary|path/i);
  });
});

describe("composer et Configurer (lot P1)", () => {
  const html = chatHtml(opts);
  const css = read("../media/chat.css");
  const js = read("../media/chat.js");
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  const section = (from: string, to: string) =>
    html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));

  it("le trombone est désactivé, libellé « bientôt »", () => {
    const attach = tag("attach");
    expect(attach).toMatch(/\sdisabled[\s>]/);
    expect(attach).toContain('aria-disabled="true"');
    expect(attach).toContain("bientôt");
  });
  it("le menu « / » ne propose que /clear", () => {
    const menu = section('id="slash-pop"', 'id="cfg-pop"');
    const studio = read("../media/studio.js");
    expect(menu.match(/class="cmd-opt"/g)).toHaveLength(1);
    expect(menu).toContain("/clear");
    expect(menu).not.toContain("/start");
    expect(js).not.toContain("/start");
    expect(studio).not.toContain("/start");
    expect(js).toContain("Aucun terminal Warband ouvert. Alt+J T pour en ouvrir un.");
    expect(studio).toContain("Aucun conteneur dédié. Créez-en un dans le cockpit.");
    expect(studio).toContain("Aucun conteneur. Créez-en un dans le cockpit.");
    expect(html).not.toMatch(/\bmcp\b|jauge|compact|pièce jointe active/i);
  });
  it("Monitor est une icône du compositeur, à côté de /, et ouvre le panneau", () => {
    const toolbar = section('id="toolbar"', 'id="model-pop"');
    expect(toolbar.indexOf('id="monitor-btn"')).toBeGreaterThan(toolbar.indexOf('id="slash-btn"'));
    expect(tag("monitor-btn")).toContain('class="ghost tool-btn"');
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
  it("Configurer : ordre Raisonnement, Fournisseur, Bypass, puis « bientôt » (Mode, Persona)", () => {
    const cfg = section('id="cfg-pop"', "<script nonce");
    const at = (s: string) => cfg.indexOf(s);
    expect(at("Raisonnement")).toBeGreaterThanOrEqual(0);
    expect(at("Raisonnement")).toBeLessThan(at("Fournisseur"));
    expect(at("Fournisseur")).toBeLessThan(at("Bypass des approbations"));
    expect(at("Bypass des approbations")).toBeLessThan(at("Bientôt"));
    expect(cfg.match(/class="cfg-off"/g)).toHaveLength(2);
    for (const label of ["Mode (Answer, Plan, Auto)", "Persona"]) {
      const at2 = cfg.indexOf(label);
      const start = cfg.lastIndexOf("<button", at2);
      const m = cfg.slice(start, cfg.indexOf("</button>", at2));
      expect(m, label).toMatch(/\sdisabled[\s>]/);
      expect(m, label).toContain('aria-disabled="true"');
      expect(m, label).toContain("bientôt");
    }
  });
  it("Configurer n'a plus de sélecteur de disposition", () => {
    const cfg = section('id="cfg-pop"', "<script nonce");
    expect(cfg).not.toContain("layout-seg");
    expect(cfg).not.toContain("data-layout");
    expect(cfg.indexOf("Raisonnement")).toBeGreaterThanOrEqual(0);
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
    for (const id of ["model-chip", "cfg-btn", "history-btn", "thinking", "send", "stop"]) {
      expect(tag(id), id).not.toBe("");
    }
    expect(html).toContain('class="spin-strip"');
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
  it("l'approbation en attente garde sa bordure et ajoute un anneau d'1 px (double trait)", () => {
    const rule = /body\.awaiting #composer \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(
      /box-shadow:\s*inset 0 0 0 1px\s+var\(\s*--vscode-editorWarning-foreground/,
    );
    expect(rule).toContain("--vscode-inputValidation-warningBorder");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("jetons de rayon (refonte visuelle)", () => {
    expect(css).toMatch(/--jn-r-sm: 6px;/);
    expect(css).toMatch(/--jn-r-md: 8px;/);
    expect(css).toMatch(/--jn-r-lg: 12px;/);
    expect(css).not.toMatch(/--jn-r-pill/);
    expect(css).toMatch(/border-radius:\s*999px/);
  });
  it("le popover Configurer est plus court, un peu plus large, et n'a plus de deux colonnes", () => {
    const rule = /#cfg-pop \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("width: min(300px, calc(100vw - 16px))");
    expect(rule).toContain("max-height: min(var(--jn-maxh, 70vh), 240px)");
    expect(css).not.toContain("cfg-cols");
    expect(css).not.toMatch(/@container pop/);
  });
});

describe("Bypass des approbations (lot B1, ADR 0006)", () => {
  const html = chatHtml(opts);
  const css = read("../media/chat.css");
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
  it("section propre entre Fournisseur et « Bientôt », état en role=status", () => {
    expect(cfg).toContain('<section class="cfg-col" aria-labelledby="cfg-h-bypass">');
    expect(tag("bypass-state")).toContain('role="status"');
    expect(cfg.indexOf('id="bypass-switch"')).toBeLessThan(cfg.indexOf("cfg-later"));
  });
  it("avertissement : deux phrases exactes", () => {
    expect(html).toContain(
      "Approuve d'office les demandes « ask » pendant 2 h, sans rien mémoriser.",
    );
    expect(html).toContain(
      "Restent demandés ou refusés : deny, chemins sensibles ou hors projet, accès hôte d'un conteneur, dangers shell, Bash sans règle ou commande composée.",
    );
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
    const start = js.indexOf("function toggleBypass(");
    const click = js.slice(start, js.indexOf("/** Envoi de `reset`", start));
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
      '"bypass-on"',
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
  it("aucun minuteur dans le Bypass", () => {
    const block = js.slice(
      js.indexOf("// --- Bypass des approbations"),
      js.indexOf("  wirePop(cfgPop"),
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
  it("bordure « actif » : deux variables, sans hex, sans animation", () => {
    const rule = /body\.bypass-on #composer \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("--vscode-editorWarning-foreground");
    expect(rule).toContain("--vscode-inputValidation-warningBorder");
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
  const css = read("../media/chat.css");
  const js = read("../media/chat.js");
  const tag = (id: string) => new RegExp(`<[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  const cfg = html.slice(html.indexOf('id="cfg-pop"'), html.indexOf("<script nonce"));

  it("interrupteur role=switch dans Configurer, avant Bypass", () => {
    const sw = tag("learning-switch");
    expect(sw).toContain('role="switch"');
    expect(sw).toContain('aria-checked="false"');
    expect(cfg.indexOf('id="learning-switch"')).toBeLessThan(cfg.indexOf('id="bypass-switch"'));
  });
  it("bascules de la barre d'entrée : role=switch dans la barre d'outils, hors Configurer, sans innerHTML", () => {
    const toolbar = html.slice(html.indexOf('id="toolbar"'), html.indexOf('id="model-pop"'));
    for (const id of ["bar-learning", "bar-bypass"]) {
      const sw = tag(id);
      expect(sw).toContain('role="switch"');
      expect(sw).toContain('aria-checked="false"');
      expect(sw).not.toMatch(/\sdisabled[\s>]/);
      expect(toolbar).toContain(`id="${id}"`);
      expect(cfg).not.toContain(`id="${id}"`);
    }
    expect(js).not.toContain("innerHTML");
  });
  it("les bascules de la barre utilisent les mêmes messages que Configurer, sans nouveau type", () => {
    expect(js).toContain('barLearning.addEventListener("click", toggleLearning)');
    expect(js).toContain('barBypass.addEventListener("click", toggleBypass)');
    expect(js).toContain('barBypass.setAttribute("aria-disabled", String(learning))');
    expect(js.match(/type: "setLearning"/g)?.length).toBe(1);
    expect(js.match(/type: "setBypass"/g)?.length).toBe(1);
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
