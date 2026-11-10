const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 }); const e = [];
  p.on('requestfailed', (r) => e.push(r.url())); await p.goto('file://' + __dirname + '/banner-github-fr.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
  await p.screenshot({ path: __dirname + '/hero-fr.png' }); console.log(e.length ? e : 'ok'); await b.close(); })();
