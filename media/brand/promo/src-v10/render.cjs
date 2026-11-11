// node render.cjs <variante> sortie.mp4 durée musique.wav     (variante : 4x5, 4x5-fr, 4x5-fr-15s, 4x5-b…)
// Rendu image par image (Playwright → ffmpeg). Toute requête réseau fait échouer le rendu.
const { chromium } = require('playwright'); const { spawn } = require('child_process');
const [fmt, out, durArg, audio] = process.argv.slice(2);
const [W, H] = [1080, 1350]; const FPS = 30, DUR = Number(durArg);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errs.push('réseau : ' + r.url()); });
  await p.goto(`file://${__dirname}/film-${fmt}.html`); await p.evaluate(() => window.ready); await p.waitForTimeout(400);
  const args = ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', audio,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-t', String(DUR), '-movflags', '+faststart', out];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round(DUR * FPS), t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await p.evaluate((x) => window.render(x), f / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 96 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`${fmt} image ${f}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  console.log('fin', errs.length ? errs : 'aucune erreur'); await b.close();
  if (errs.length) process.exit(1);
})();
