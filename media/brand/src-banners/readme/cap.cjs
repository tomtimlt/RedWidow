// Captures 2x des composants du kit (anglais, lab fictif) pour les images du README.
const { chromium } = require('playwright');
const K = 'file://' + __dirname + '/kit/';
const JOBS = [['chat-agent', 980, 640], ['chat-bypass', 980, 640], ['appearance', 0, 0]];
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [name, w0, h0] of JOBS) {
    const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(K + name + '.html'); await p.waitForTimeout(2200);
    const box = await p.evaluate(() => { const e = document.querySelector('.vo-ui'); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    if (name === 'chat-bypass') await p.evaluate(() => { const l = document.getElementById('log'); if (l) l.scrollTop = l.scrollHeight; const b = document.getElementById('automatic-badge'); if (b) b.textContent = 'Auto 1:58'; });
    await p.evaluate(() => document.activeElement?.blur?.()); await p.waitForTimeout(300);
    await p.screenshot({ path: __dirname + '/' + name + '.png', clip: box }); console.log(name, JSON.stringify(box));
    await p.close();
  }
  console.log(errs.length ? errs : 'ok'); await b.close();
})();
