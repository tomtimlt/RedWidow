// Captures 2x des composants du kit traduits en français (libellés réels du produit, lab fictif traduit).
const { chromium } = require('playwright');
const fs = require('fs');
const K = 'file://' + __dirname + '/kit/', M = JSON.parse(fs.readFileSync(__dirname + '/fr-map.json', 'utf8'));
const JOBS = ['chat-approval-tall', 'chat-approval-wide', 'killchain', 'monitor', 'chat-agent', 'chat-bypass', 'appearance', 'terminal', 'chat-learning'];
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const name of JOBS) {
    const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(K + name + '.html'); await p.waitForTimeout(2200);
    const left = await p.evaluate(({ map, prefix, name }) => {
      document.documentElement.lang = 'fr';
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const ns = []; let n; while ((n = w.nextNode())) ns.push(n);
      const untouched = [];
      for (const nd of ns) {
        if (nd.parentElement.closest('.brand-name, #title, style, script')) continue;
        const s = nd.nodeValue.trim(); if (!s) continue;
        if (s in map) nd.nodeValue = nd.nodeValue.replace(s, map[s]);
        else { const k = Object.keys(prefix).find((p) => s.startsWith(p)); if (k) nd.nodeValue = prefix[k]; }
      }
      const i = document.querySelector('#input'); if (i) i.placeholder = 'Votre consigne…';
      if (name === 'chat-bypass') { const l = document.getElementById('log'); if (l) l.scrollTop = l.scrollHeight; }
      document.activeElement?.blur?.();
      const e = document.querySelector('.vo-ui, .vo-term'); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, { map: M.map, prefix: M.prefix, name });
    await p.waitForTimeout(300);
    await p.screenshot({ path: __dirname + '/fr-' + name + '.png', clip: left }); console.log(name, JSON.stringify(left));
    await p.close();
  }
  console.log(errs.length ? errs : 'ok'); await b.close();
})();
