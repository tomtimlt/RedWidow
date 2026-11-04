// RedWidow promo v1 : chaque image est calculée à partir du temps t (secondes).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const out3 = (x) => 1 - Math.pow(1 - x, 3);
  const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x, k = 2.2) => 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  // Araignées (calques de media/spider.js)
  const mk = (slot, mini) => { const s = mini ? WarbandSpider.createMini('rw-spider hero-spider') : WarbandSpider.create('rw-spider hero-spider'); $(slot).append(s); return s; };
  const hero = mk('#hero-slot'), lockSp = mk('#lock-slot'), endSp = mk('#end-slot');
  const legsOf = (s) => ['l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'l4', 'r4'].map((k) => $('.rw-leg-' + k, s));
  // Petite araignée qui parcourt la kill chain
  const walker = WarbandSpider.createMini('rw-spider hero-spider walker');
  $('#w-kc .cv').append(walker);

  // Captions : apparition par montée, sortie franche
  const lines = $$('.cl[data-t]'), groups = $$('.grp[data-t]'), slams = $$('.slam[data-t]'), scr = $$('.scr[data-t]');
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@<>/\\|=+*';
  scr.forEach((e) => { e.dataset.text = e.textContent; });
  function captions(t) {
    for (const e of lines) {
      const a = +e.dataset.t, x = e.dataset.x ? +e.dataset.x : 1e9;
      const p = out3(P(t, a, a + 0.28));
      e.style.opacity = t < a || t >= x ? 0 : p;
      e.style.transform = `translateY(${(1 - p) * 34}px)`;
    }
    for (const g of groups) { const a = +g.dataset.t, x = g.dataset.x ? +g.dataset.x : 1e9; g.style.display = t >= a - 0.001 && t < x ? '' : 'none'; }
    for (const e of slams) {
      const a = +e.dataset.t, p = P(t, a, a + 0.22);
      e.style.opacity = t < a ? 0 : 1;
      e.style.transform = `scale(${1.18 - 0.18 * out3(p)})`;
    }
    for (const e of scr) {
      const a = +e.dataset.t, d = +e.dataset.d, txt = e.dataset.text;
      if (t < a) { e.style.opacity = 0; continue; }
      e.style.opacity = 1;
      const n = Math.floor(P(t, a, a + d) * txt.length), f = Math.floor(t * 30);
      e.textContent = txt.split('').map((c, i) => (i < n || c === ' ' ? c : GLYPHS[(i * 7 + f * 13) % GLYPHS.length])).join('');
    }
  }

  // Flashs et secousses (impacts motivés : verrouillage, révélation, « FREE »)
  const FLASH = [6.0, 25.0, 38.0], SHAKE = [[4.5, 12], [6.0, 8], [38.0, 10]];
  function fx(t) {
    let f = 0;
    for (const a of FLASH) if (t >= a && t < a + 0.3) f = Math.max(f, t < a + 0.067 ? 0.9 : 0.9 * (1 - P(t, a + 0.067, a + 0.3)));
    $('#flash').style.opacity = f;
    let dx = 0, dy = 0;
    for (const [a, amp] of SHAKE) if (t >= a && t < a + 0.3) { const k = amp * (1 - P(t, a, a + 0.3)); dx += Math.sin(t * 190) * k; dy += Math.cos(t * 230) * k; }
    $('#stage').style.transform = `translate(${dx}px,${dy}px)`;
  }

  // S1 : huit pattes, un cerveau, une cible
  function spiderBuild(s, t, t0, opts = {}) {
    const legs = legsOf(s);
    legs.forEach((g, i) => { const a = t0 + i * 0.035, p = P(t, a, a + 0.42); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.12 + 0.88 * back(p)})`; });
    $$('.rw-palp', s).forEach((g) => { const p = P(t, t0 + 0.3, t0 + 0.6); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.2 + 0.8 * back(p)})`; });
    const body = $('.rw-body', s); body.style.opacity = 0.25 + 0.75 * P(t, t0 - 0.3, t0 + 0.1);
    const tb = opts.brain ?? t0 + 0.5, tc = opts.cross ?? t0 + 0.8;
    const brain = $('.rw-brain', s); brain.style.opacity = t < tb ? 0.12 : 0.12 + 0.88 * out3(P(t, tb, tb + 0.12));
    const pc = P(t, tc, tc + 0.38);
    for (const e of [$('.rw-crosshair', s), $('.rw-plate', s)]) { if (!e) continue; e.style.opacity = t < tc ? 0 : 1; }
    const ch = $('.rw-crosshair', s); ch.style.transformOrigin = '50% 50%'; ch.style.transform = `scale(${1.8 - 0.8 * back(pc, 1.6)}) rotate(${-60 * (1 - out3(pc))}deg)`;
    const eyes = $('.rw-eyes', s); eyes.style.opacity = t < tc ? 0.3 : 1; eyes.style.transformOrigin = '50% 50%';
    const bl = P(t, tc + 0.9, tc + 1.05); eyes.style.transform = `scaleY(${bl > 0 && bl < 1 ? 1 - 0.9 * Math.sin(bl * Math.PI) : 1})`;
  }
  function s1(t) {
    spiderBuild(hero, t, 0.45, { brain: 2.5, cross: 4.5 });
    const g = $('#brainglow'); const p = P(t, 2.5, 3.3); g.style.opacity = t < 2.5 ? 0 : 0.9 * (1 - p); g.style.transform = `scale(${0.6 + 0.6 * out3(p)})`;
  }
  function s2(t) { spiderBuild(lockSp, t, 6.0, { brain: 6.0, cross: 6.05 }); }

  // S3 : l'agent au travail
  const chat = $('#w-chat');
  const rows = $$('#log > *', chat), tools = $$('.tool-group > details', chat);
  const input = $('#input', chat), roe = $('#roe', chat), roeLabel = $('#roe-label', chat), badge = $('#automatic-badge', chat), ui = $('.vo-ui', chat);
  const thinkLabel = $('#thinking-label', chat), clock = $('#thinking-clock', chat);
  const PROMPT = 'Recon 10.10.10.14 and find me a way in.';
  const CMDS = ['nmap', 'whatweb', 'ffuf', 'sqlmap'];
  function s3(t) {
    const typed = Math.floor(P(t, 8.3, 9.35) * PROMPT.length);
    input.value = t < 9.45 ? PROMPT.slice(0, typed) : '';
    show(rows[0], t >= 9.45);
    const auto = t >= 9.6;
    ui.classList.toggle('automatic-on', auto);
    roe.dataset.level = auto ? '3' : '2'; roeLabel.textContent = auto ? 'Automatic' : 'Supervised';
    badge.hidden = !auto; badge.textContent = 'Bypass 2:00';
    const run = t >= 10.0 && t < 12.6;
    ui.classList.toggle('running', run);
    show(rows[1], t >= 10.0);
    show(rows[2], t >= 10.5);
    tools.forEach((d, i) => show(d, t >= 10.5 + i * 0.5));
    const k = clamp(Math.floor((t - 10.5) / 0.5), 0, 3);
    thinkLabel.textContent = `Tool: ${CMDS[k]}`;
    clock.textContent = `T+00:${String(Math.max(0, Math.floor((t - 10) * 4))).padStart(2, '0')}`;
    show(rows[3], t >= 12.6);
  }

  // S4 : le Monitor en direct
  const mon = $('#w-mon');
  const monRows = $$('.mon-row', mon), lastLines = $$('.mon-line', monRows[monRows.length - 1]), ticks = $$('.mon-tick', mon);
  function s4(t) {
    lastLines.forEach((l, i) => show(l, t >= 14.7 + i * 0.055));
    $$('[data-scroll-top]', mon).forEach((e) => { e.scrollTop = e.scrollHeight; });
    ticks.forEach((k, i) => { const p = P(t, 14.55 + i * 0.12, 14.75 + i * 0.12); k.style.opacity = p; k.style.transform = `scaleY(${p})`; });
  }

  // S5 : la kill chain, construite par l'agent (la petite araignée)
  const kc = $('#w-kc'); const KS = +kc.dataset.s, KX = +kc.dataset.cx, KY = +kc.dataset.cy;
  const nodes = $$('.kc-node', kc), edges = $$('.kc-edge', kc), tips = $$('.kc-tip', kc);
  const C = [[65, 238], [219, 197], [219, 279], [374, 197], [374, 279], [528, 238], [683, 238]];
  const NODE_T = [18.45, 18.95, 19.45, 20.05, 20.55, 21.65, 22.75];
  const EDGE_T = [[18.7, 19.0], [18.75, 19.45], [20.25, 20.55], [19.85, 20.55], [19.8, 20.05], [20.95, 21.65], [22.05, 22.75]];
  const ROUTE = [[18.3, 0], [18.75, 0], [19.45, 2], [19.85, 2], [20.55, 4], [20.95, 4], [21.65, 5], [22.05, 5], [22.75, 6]];
  function s5(t) {
    nodes.forEach((n, i) => { const p = P(t, NODE_T[i], NODE_T[i] + 0.3); n.style.opacity = p > 0 ? 1 : 0; n.style.transformOrigin = '50% 50%'; n.style.scale = String(0.4 + 0.6 * back(p)); });
    edges.forEach((e, i) => { const [a, b] = EDGE_T[i]; const p = io(P(t, a, b)); e.style.opacity = p > 0 ? 1 : 0; e.style.clipPath = `inset(-20px ${(1 - p) * 100}% -20px -20px)`; });
    tips.forEach((e) => { e.style.opacity = P(t, 22.8, 23.0); });
    // position de l'araignée le long de la route
    let pos = C[0], moving = false;
    for (let i = 0; i < ROUTE.length - 1; i++) {
      const [ta, na] = ROUTE[i], [tb, nb] = ROUTE[i + 1];
      if (t >= ta && t < tb) { const p = io(P(t, ta, tb)); pos = [C[na][0] + (C[nb][0] - C[na][0]) * p, C[na][1] + (C[nb][1] - C[na][1]) * p]; moving = na !== nb; break; }
      if (t >= tb) pos = C[nb];
    }
    walker.style.opacity = t >= 18.3 ? 1 : 0;
    walker.style.left = `${(pos[0] - KX) * KS - 55}px`; walker.style.top = `${(pos[1] - KY) * KS - 118}px`;
    const step = Math.sin(t * 2 * Math.PI * 4);
    legsOf(walker).forEach((g) => { if (!g) return; const odd = /l3|r4/.test(g.getAttribute('class')); g.style.rotate = moving ? `${(odd ? 1 : -1) * step * 9}deg` : '0deg'; });
  }

  // S6 : Apprentissage
  const wel = $('#w-wel'), welUi = $('.vo-ui', wel);
  function s6b(t) {
    const on = t >= 26.4;
    welUi.classList.toggle('learning', on);
    const r = $('#roe', wel); if (r) { r.hidden = false; r.dataset.level = on ? '1' : '2'; const l = $('#roe-label', wel); if (l) l.textContent = on ? 'Learning' : 'Supervised'; }
  }
  const term = $('#w-term'), learn = $('#w-learn');
  const tl = $$('.ln', term), hl = $('.ln.hl', term), lrows = $$('#log > *', learn);
  function s6c(t) {
    tl.forEach((l, i) => { l.style.visibility = t >= 28.5 + i * 0.045 ? 'visible' : 'hidden'; });
    const fl = P(t, 29.4, 29.9); hl.style.background = t >= 29.4 ? `rgba(229,19,43,${0.14 + 0.5 * (1 - fl)})` : '';
    lrows.forEach((r, i) => show(r, t >= 28.9 + i * 0.28));
    const strong = $('#log strong', learn);
    const path = $('#link-path');
    if (strong && t >= 30.0) {
      const a = hl.getBoundingClientRect(), b = strong.getBoundingClientRect();
      const x1 = a.right - 40, y1 = a.top + a.height / 2, x2 = b.left - 6, y2 = b.top + b.height / 2;
      path.setAttribute('d', `M${x1} ${y1} C${x1 + 120} ${y1} ${x2 - 120} ${y2} ${x2} ${y2}`);
      const len = path.getTotalLength(), p = io(P(t, 30.0, 30.5));
      path.style.strokeDasharray = `${len}`; path.style.strokeDashoffset = `${len * (1 - p)}`;
      path.style.opacity = 1 - P(t, 32.4, 32.9);
    } else path.style.opacity = 0;
  }

  // S7 : effort au maximum
  const cfg = $('#w-cfg'), scale = $('#effort-scale', cfg), elabel = $('#effort-label', cfg);
  const LEVELS = ['Low', 'Medium', 'High', 'Extra', 'Maximum'];
  function s7a(t) {
    const v = 0.2 + 0.8 * io(P(t, 33.1, 33.85));
    scale.style.setProperty('--jn-progress', String(v));
    scale.classList.toggle('is-max', v >= 0.999);
    elabel.textContent = LEVELS[Math.min(4, Math.round(v * 4))];
  }
  function s9(t) { spiderBuild(endSp, t, 39.0, { brain: 39.25, cross: 39.4 }); }

  // Horloge virtuelle pour les animations CSS du produit (araignées, aura, effort)
  const seen = new WeakMap();
  function clockAnims(t) {
    for (const a of document.getAnimations()) {
      if (!seen.has(a)) seen.set(a, t);
      a.pause(); a.currentTime = Math.max(0, (t - seen.get(a)) * 1000);
    }
  }
  const scenes = $$('.scene');
  const RUN = { s1, s2, s3, s4, s5, s6b, s6c, s7a, s9 };
  window.render = (t) => {
    for (const s of scenes) {
      const on = t >= +s.dataset.in && t < +s.dataset.out;
      if (on && s.style.display !== 'block') { s.style.display = 'block'; $$('[data-scroll-top]', s).forEach((e) => { e.scrollTop = +e.dataset.scrollTop; }); }
      if (!on) s.style.display = 'none';
      if (on && RUN[s.id]) RUN[s.id](t);
    }
    captions(t); fx(t); clockAnims(t);
  };
  window.ready = document.fonts.ready.then(() => true);
})();
