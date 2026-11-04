// node render.cjs 16x9|9x16 out.mp4 durée musique.wav
const { chromium } = require('playwright'); const { spawn } = require('child_process');
const [fmt, out, durArg, audio] = process.argv.slice(2);
const [W, H] = fmt === '9x16' ? [1080, 1920] : [1920, 1080]; const FPS = 30, DUR = Number(durArg);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`file://${__dirname}/film-${fmt}.html`); await p.evaluate(() => window.ready); await p.waitForTimeout(400);
  const args = ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', audio,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round(DUR * FPS), t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await p.evaluate((x) => window.render(x), f / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`${fmt} frame ${f}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  console.log('done', errs.length ? errs : 'no errors'); await b.close();
})();
