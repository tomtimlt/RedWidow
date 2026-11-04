// node still.cjs 16x9|9x16 t1 t2 … → st-<fmt>-<t>.png
const { chromium } = require('playwright');
const [fmt, ...ts] = process.argv.slice(2); const T = ts.map(Number);
const [W, H] = fmt === '9x16' ? [1080, 1920] : [1920, 1080];
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`file://${__dirname}/film-${fmt}.html`); await p.evaluate(() => window.ready); await p.waitForTimeout(300);
  let cur = 0;
  for (const t of T) { for (; cur <= t; cur += 1 / 30) await p.evaluate((x) => window.render(x), cur); await p.evaluate((x) => window.render(x), t); await p.screenshot({ path: `st-${fmt}-${t}.png` }); }
  console.log(errs); await b.close(); })();
