// RedWidow promo V2 : chaque image est calculée à partir du temps t (secondes).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const out3 = (x) => 1 - Math.pow(1 - x, 3);
  const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x, k = 2.2) => 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  const mk = (slot) => { const s = WarbandSpider.create('rw-spider hero-spider'); $(slot).append(s); return s; };
  const lockSp = mk('#lock-slot'), endSp = mk('#end-slot');
  const legsOf = (s) => ['l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'l4', 'r4'].map((k) => $('.rw-leg-' + k, s));
  const walker = WarbandSpider.createMini('rw-spider hero-spider walker');
  $('#w-kc .cv').append(walker);

  // Légendes
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
    for (const e of slams) { const a = +e.dataset.t, p = P(t, a, a + 0.22); e.style.opacity = t < a ? 0 : 1; e.style.transform = `scale(${1.18 - 0.18 * out3(p)})`; }
    for (const e of scr) {
      const a = +e.dataset.t, d = +e.dataset.d, txt = e.dataset.text;
      if (t < a) { e.style.opacity = 0; continue; }
      e.style.opacity = 1;
      const n = Math.floor(P(t, a, a + d) * txt.length), f = Math.floor(t * 30);
      e.textContent = txt.split('').map((c, i) => (i < n || c === ' ' ? c : GLYPHS[(i * 7 + f * 13) % GLYPHS.length])).join('');
    }
  }

  // Flashs et secousses : révélation, coupure « Stuck », « Free »
  const FLASH = [4.0, 21.0, 34.5], SHAKE = [[2.5, 6], [4.0, 10], [34.5, 10]];
  function fx(t) {
    let f = 0;
    for (const a of FLASH) if (t >= a && t < a + 0.3) f = Math.max(f, t < a + 0.067 ? 0.9 : 0.9 * (1 - P(t, a + 0.067, a + 0.3)));
    $('#flash').style.opacity = f;
    let dx = 0, dy = 0;
    for (const [a, amp] of SHAKE) if (t >= a && t < a + 0.3) { const k = amp * (1 - P(t, a, a + 0.3)); dx += Math.sin(t * 190) * k; dy += Math.cos(t * 230) * k; }
    $('#stage').style.transform = `translate(${dx}px,${dy}px)`;
  }

  // Araignée qui se construit : pattes, cerveau, viseur, yeux
  function spiderBuild(s, t, t0, o = {}) {
    legsOf(s).forEach((g, i) => { const a = t0 + i * 0.03, p = P(t, a, a + 0.36); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.12 + 0.88 * back(p)})`; });
    $$('.rw-palp', s).forEach((g) => { const p = P(t, t0 + 0.25, t0 + 0.5); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.2 + 0.8 * back(p)})`; });
    $('.rw-body', s).style.opacity = 0.25 + 0.75 * P(t, t0 - 0.2, t0 + 0.1);
    const tb = o.brain ?? t0 + 0.3, tc = o.cross ?? t0 + 0.5;
    $('.rw-brain', s).style.opacity = t < tb ? 0.12 : 0.12 + 0.88 * out3(P(t, tb, tb + 0.12));
    const pc = P(t, tc, tc + 0.38);
    for (const e of [$('.rw-crosshair', s), $('.rw-plate', s)]) if (e) e.style.opacity = t < tc ? 0 : 1;
    const ch = $('.rw-crosshair', s); ch.style.transformOrigin = '50% 50%'; ch.style.transform = `scale(${1.8 - 0.8 * back(pc, 1.6)}) rotate(${-60 * (1 - out3(pc))}deg)`;
    const eyes = $('.rw-eyes', s); eyes.style.opacity = t < tc ? 0.3 : 1; eyes.style.transformOrigin = '50% 50%';
    const bl = P(t, tc + 0.9, tc + 1.05); eyes.style.transform = `scaleY(${bl > 0 && bl < 1 ? 1 - 0.9 * Math.sin(bl * Math.PI) : 1})`;
  }

  // A : l'agent au travail, en accéléré, pendant l'accroche
  const hook = $('#w-hook');
  const H = { rows: $$('#log > *', hook), tools: $$('.tool-group > details', hook), input: $('#input', hook), roe: $('#roe', hook), roeLabel: $('#roe-label', hook), badge: $('#automatic-badge', hook), ui: $('.vo-ui', hook), label: $('#thinking-label', hook), clock: $('#thinking-clock', hook) };
  const PROMPT = 'Recon 10.10.10.14 and find me a way in.', CMDS = ['nmap', 'whatweb', 'ffuf', 'sqlmap'];
  function a(t) {
    H.input.value = t < 0.85 ? PROMPT.slice(0, Math.floor(P(t, 0.1, 0.8) * PROMPT.length)) : '';
    show(H.rows[0], t >= 0.85);
    const auto = t >= 0.95;
    H.ui.classList.toggle('automatic-on', auto);
    H.roe.dataset.level = auto ? '3' : '2'; H.roeLabel.textContent = auto ? 'Automatic' : 'Supervised';
    H.badge.hidden = !auto; H.badge.textContent = 'Bypass 2:00';
    H.ui.classList.toggle('running', t >= 1.05 && t < 2.6);
    show(H.rows[1], t >= 1.05); show(H.rows[2], t >= 1.3);
    H.tools.forEach((d, i) => show(d, t >= 1.3 + i * 0.3));
    H.label.textContent = `Tool: ${CMDS[clamp(Math.floor((t - 1.3) / 0.3), 0, 3)]}`;
    H.clock.textContent = `T+00:${String(Math.max(0, Math.floor((t - 1) * 6))).padStart(2, '0')}`;
    show(H.rows[3], t >= 2.6);
  }
  function b(t) { spiderBuild(lockSp, t, 4.0, { brain: 4.25, cross: 4.4 }); }

  // C : Monitor qui suit les nouvelles lignes
  const mon = $('#w-mon'), monRows = $$('.mon-row', mon), lastLines = $$('.mon-line', monRows[monRows.length - 1]), ticks = $$('.mon-tick', mon);
  function c(t) {
    lastLines.forEach((l, i) => show(l, t >= 6.7 + i * 0.055));
    $$('[data-scroll-top]', mon).forEach((e) => { e.scrollTop = e.scrollHeight; });
    ticks.forEach((k, i) => { const p = P(t, 6.55 + i * 0.12, 6.75 + i * 0.12); k.style.opacity = p; k.style.transform = `scaleY(${p})`; });
  }

  // D : la petite araignée parcourt la kill chain et chaque étape naît à son passage
  const kc = $('#w-kc'); const KS = +kc.dataset.s, KX = +kc.dataset.cx, KY = +kc.dataset.cy;
  const nodes = $$('.kc-node', kc), edges = $$('.kc-edge', kc), tips = $$('.kc-tip', kc);
  const CN = [[65, 238], [219, 197], [219, 279], [374, 197], [374, 279], [528, 238], [683, 238]];
  const O = -8;
  const NODE_T = [18.45, 18.95, 19.45, 20.05, 20.55, 21.65, 22.75].map((x) => x + O);
  const EDGE_T = [[18.7, 19.0], [18.75, 19.45], [20.25, 20.55], [19.85, 20.55], [19.8, 20.05], [20.95, 21.65], [22.05, 22.75]].map(([p, q]) => [p + O, q + O]);
  const ROUTE = [[18.3, 0], [18.75, 0], [19.45, 2], [19.85, 2], [20.55, 4], [20.95, 4], [21.65, 5], [22.05, 5], [22.75, 6]].map(([p, n]) => [p + O, n]);
  function d(t) {
    nodes.forEach((n, i) => { const p = P(t, NODE_T[i], NODE_T[i] + 0.3); n.style.opacity = p > 0 ? 1 : 0; n.style.transformOrigin = '50% 50%'; n.style.scale = String(0.4 + 0.6 * back(p)); });
    edges.forEach((e, i) => { const [p0, p1] = EDGE_T[i]; const p = io(P(t, p0, p1)); e.style.opacity = p > 0 ? 1 : 0; e.style.clipPath = `inset(-20px ${(1 - p) * 100}% -20px -20px)`; });
    tips.forEach((e) => { e.style.opacity = P(t, NODE_T[6] + 0.05, NODE_T[6] + 0.25); });
    let pos = CN[0], moving = false;
    for (let i = 0; i < ROUTE.length - 1; i++) {
      const [ta, na] = ROUTE[i], [tb, nb] = ROUTE[i + 1];
      if (t >= ta && t < tb) { const p = io(P(t, ta, tb)); pos = [CN[na][0] + (CN[nb][0] - CN[na][0]) * p, CN[na][1] + (CN[nb][1] - CN[na][1]) * p]; moving = na !== nb; break; }
      if (t >= tb) pos = CN[nb];
    }
    walker.style.opacity = t >= ROUTE[0][0] ? 1 : 0;
    walker.style.left = `${(pos[0] - KX) * KS - 55}px`; walker.style.top = `${(pos[1] - KY) * KS - 118}px`;
    const step = Math.sin(t * 2 * Math.PI * 4);
    legsOf(walker).forEach((g) => { if (!g) return; const odd = /l3|r4/.test(g.getAttribute('class')); g.style.rotate = moving ? `${(odd ? 1 : -1) * step * 9}deg` : '0deg'; });
  }

  // E : plein automatique, puis le rapport qui s'écrit
  const auto = $('#w-auto'), aui = $('.vo-ui', auto);
  const rep = $('#log .report', auto), segs = $$('.report-seg', auto), items = $$('.report-item', auto);
  const repParts = rep ? [$('.report-head', rep), $('.report-summary', rep)] : [];
  // Le chat suit la conversation : on voit d'abord la fin de l'échange, puis il
  // défile jusqu'au rapport quand celui-ci s'écrit (comme le suivi automatique).
  const alog = $('#log', auto);
  let before = null, after = null;
  function e(t) {
    aui.classList.add('automatic-on');
    if (before === null && rep) { rep.style.display = 'none'; before = alog.scrollHeight - alog.clientHeight; rep.style.display = ''; after = alog.scrollHeight - alog.clientHeight; }
    const on = t >= 18.6;
    if (rep) rep.style.display = on ? '' : 'none';
    repParts.forEach((p) => { if (p) p.style.opacity = P(t, 18.6, 18.8); });
    segs.forEach((s, i) => { s.style.transformOrigin = '0 50%'; s.style.transform = `scaleX(${out3(P(t, 18.7 + i * 0.08, 19.0 + i * 0.08))})`; });
    items.forEach((it, i) => { const p = P(t, 18.9 + i * 0.3, 19.15 + i * 0.3); it.style.opacity = p; it.style.transform = `translateY(${(1 - out3(p)) * 16}px)`; });
    alog.scrollTop = on ? before + (after - before) * io(P(t, 18.6, 19.1)) : Math.max(0, before);
  }

  // F : Apprentissage
  const wel = $('#w-wel'), welUi = $('.vo-ui', wel);
  function f2(t) {
    const on = t >= 22.4;
    welUi.classList.toggle('learning', on);
    const r = $('#roe', wel); if (r) { r.hidden = false; r.dataset.level = on ? '1' : '2'; const l = $('#roe-label', wel); if (l) l.textContent = on ? 'Learning' : 'Supervised'; }
  }
  const term = $('#w-term'), learn = $('#w-learn');
  const tl = $$('.ln', term), hl = $('.ln.hl', term), lrows = $$('#log > *', learn);
  function f3(t) {
    tl.forEach((l, i) => { l.style.visibility = t >= 24.5 + i * 0.045 ? 'visible' : 'hidden'; });
    const fl = P(t, 25.4, 25.9); hl.style.background = t >= 25.4 ? `rgba(229,19,43,${0.14 + 0.5 * (1 - fl)})` : '';
    lrows.forEach((r, i) => show(r, t >= 24.9 + i * 0.28));
    const strong = $('#log strong', learn), path = $('#link-path');
    if (strong && t >= 26.0) {
      const A = hl.getBoundingClientRect(), B = strong.getBoundingClientRect();
      const x1 = A.right - 40, y1 = A.top + A.height / 2, x2 = B.left - 6, y2 = B.top + B.height / 2;
      path.setAttribute('d', `M${x1} ${y1} C${x1 + 120} ${y1} ${x2 - 120} ${y2} ${x2} ${y2}`);
      const len = path.getTotalLength(), p = io(P(t, 26.0, 26.5));
      path.style.strokeDasharray = `${len}`; path.style.strokeDashoffset = `${len * (1 - p)}`;
      path.style.opacity = 1 - P(t, 28.4, 28.9);
    } else path.style.opacity = 0;
  }

  // G : effort au maximum
  const cfg = $('#w-cfg'), scale = $('#effort-scale', cfg), elabel = $('#effort-label', cfg);
  const LEVELS = ['Low', 'Medium', 'High', 'Extra', 'Maximum'];
  function g1(t) {
    const v = 0.2 + 0.8 * io(P(t, 29.1, 29.85));
    scale.style.setProperty('--jn-progress', String(v));
    scale.classList.toggle('is-max', v >= 0.999);
    elabel.textContent = LEVELS[Math.min(4, Math.round(v * 4))];
  }
  function h2(t) { spiderBuild(endSp, t, 35.5, { brain: 35.75, cross: 35.9 }); }

  // Horloge virtuelle pour les animations CSS du produit
  const seen = new WeakMap();
  function clockAnims(t) {
    for (const an of document.getAnimations()) {
      if (!seen.has(an)) seen.set(an, t);
      an.pause(); an.currentTime = Math.max(0, (t - seen.get(an)) * 1000);
    }
  }
  const scenes = $$('.scene');
  const RUN = { a, b, c, d, e, f2, f3, g1, h2 };
  window.render = (t) => {
    for (const s of scenes) {
      const on = t >= +s.dataset.in && t < +s.dataset.out;
      if (on && s.style.display !== 'block') { s.style.display = 'block'; $$('[data-scroll-top]', s).forEach((el) => { el.scrollTop = +el.dataset.scrollTop; }); }
      if (!on) s.style.display = 'none';
      if (on && RUN[s.id]) RUN[s.id](t);
    }
    captions(t); fx(t); clockAnims(t);
  };
  window.ready = document.fonts.ready.then(() => true);
})();
