// node shoot.cjs : photographie les pages de gen.py et capture le terminal et le chat d'Apprentissage du kit.
const { chromium } = require('playwright');
const path = __dirname + '/';
const KIT = 'file:///home/user/warband/media/brand/video-kit/html/';
const JOBS = [
  ['banner-github', 1280, 640, 1], ['banner-github', 1280, 640, 2, 'banner-github@2x'],
  ['banner-linkedin', 1584, 396, 2], ['banner-github-learning', 1280, 640, 1], ['banner-github-strip', 1280, 320, 2],
];
(async () => {
  const b = await chromium.launch(); const errs = [];
  // fenêtres de l'Apprentissage : composants du kit (déjà en anglais), 2x
  for (const [file, w, h, out, sel] of [['terminal', 560, 690, 'lab-learn-term', '.vo-term'], ['chat-learning', 470, 690, 'lab-learn-chat', null]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(KIT + file + '.html'); await p.waitForTimeout(1500);
    await p.evaluate(() => { document.activeElement?.blur?.(); });
    await p.screenshot({ path: path + out + '.png', clip: { x: 0, y: 0, width: w, height: h } }); await p.close();
  }
  require('child_process').execSync(`python3 ${path}gen.py`);
  for (const [name, w, h, dsf, out] of JOBS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`file://${path}${name}.html`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
    await p.screenshot({ path: path + (out ?? name) + '.png' }); await p.close();
  }
  console.log(errs.length ? errs : 'ok'); await b.close();
})();
