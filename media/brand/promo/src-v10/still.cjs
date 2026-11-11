// node still.cjs <variante> t1 t2 …  → st-<variante>-<t>.png (dossier OUT, ou le dossier courant)
// Les images sont calculées dans l'ordre du film, comme au rendu. PNG=1 : sans perte ; SCALE=2 : couverture nette.
const { chromium } = require('playwright');
const [fmt, ...ts] = process.argv.slice(2); const T = ts.map(Number);
const out = process.env.OUT || '.';
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: Number(process.env.SCALE || 1) });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errs.push('réseau : ' + r.url()); });
  await p.goto(`file://${__dirname}/film-${fmt}.html`); await p.evaluate(() => window.ready); await p.waitForTimeout(300);
  let cur = 0;
  for (const t of T) { for (; cur <= t; cur += 1 / 30) await p.evaluate((x) => window.render(x), cur); await p.evaluate((x) => window.render(x), t);
    await p.screenshot(process.env.PNG ? { path: `${out}/st-${fmt}-${t}.png` } : { path: `${out}/st-${fmt}-${t}.jpg`, type: 'jpeg', quality: 88 }); }
  console.log(errs.length ? errs : 'ok'); await b.close(); })();
