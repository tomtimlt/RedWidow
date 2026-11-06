// node hook.cjs : aperçu social 1280 × 640 (et 2x) tiré de l'accroche de la V8 (la cible verrouillée dans la toile) + mot-symbole.
const { chromium } = require('playwright');
const FILM = process.argv[2], T = +process.argv[3] || 3.4, OUT = __dirname + '/';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 4 / 3 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + FILM); await p.evaluate(() => window.ready); await p.waitForTimeout(300);
  let cur = 0;
  for (; cur <= T; cur += 1 / 30) await p.evaluate((x) => window.render(x), cur);
  await p.evaluate((x) => window.render(x), T);
  await p.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:110px;top:820px;z-index:60;color:#f2f3f5;font-family:"Warband Geist"';
    d.innerHTML = '<div style="display:flex;align-items:center;gap:26px"><div id="ovsp" style="width:96px;height:80px"></div><div style="font:800 96px/1 \'Warband Geist\';letter-spacing:-.035em"><span style="color:#E5132B">RED</span>WIDOW</div></div>'
      + '<div style="font:700 26px \'Warband JetBrains Mono\';letter-spacing:.18em;text-transform:uppercase;color:#a3a6ad;margin:22px 0 0 2px">The AI-native pentest workspace · open source</div>';
    document.getElementById('stage').append(d);
    const img = document.createElement('img'); img.src = 'file:///home/user/warband/media/logo.svg'; img.style.cssText = 'width:96px;height:80px'; document.getElementById('ovsp').append(img);
  });
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'banner-github-hook-en@2x.png', clip: { x: 0, y: 60, width: 1920, height: 960 } });
  console.log(errs.length ? errs : 'ok'); await b.close();
})();
