const { chromium } = require('playwright');
const T = process.argv.slice(2).map(Number);
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/film.html'); await p.evaluate(() => window.ready); await p.waitForTimeout(300);
  // avance du début jusqu'à chaque instant pour que l'horloge virtuelle voie les animations naître au bon moment
  let cur = 0;
  for (const t of T) { for (; cur <= t; cur += 1 / 30) await p.evaluate((x) => window.render(x), cur); await p.evaluate((x) => window.render(x), t); await p.screenshot({ path: `st-${t}.png` }); }
  console.log(errs); await b.close(); })();
