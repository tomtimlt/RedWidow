const { chromium } = require('playwright');
const base = ['01-weave', '02-watch', '03-strike', '04-wrap', '05-learn', '06-yours'];
const names = process.argv[2] === 'fr' ? base.map((n) => n + '-fr') : base;
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const n of names) {
    const p = await b.newPage({ viewport: { width: 1600, height: 800 }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errs.push(n + ': ' + e.message)); p.on('requestfailed', (r) => errs.push(n + ' manque ' + r.url()));
    await p.goto('file://' + __dirname + '/' + n + '.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
    await p.screenshot({ path: __dirname + '/' + n + '.png' }); await p.close();
  }
  console.log(errs.length ? errs : 'ok'); await b.close();
})();
