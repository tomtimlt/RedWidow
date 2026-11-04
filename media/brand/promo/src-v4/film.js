// RedWidow promo V4 : chaque image est calculée à partir du temps t (secondes).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const out3 = (x) => 1 - Math.pow(1 - x, 3);
  const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x, k = 2.2) => 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  const lerp = (a, b, p) => a + (b - a) * p;

  const mk = (slot) => { const s = WarbandSpider.create('rw-spider hero-spider'); $(slot).append(s); return s; };
  const lockSp = mk('#lock-slot'), endSp = mk('#end-slot');
  const legsOf = (s) => ['l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'l4', 'r4'].map((k) => $('.rw-leg-' + k, s));

  // Légendes
  const lines = $$('.cl[data-t]'), groups = $$('.grp[data-t]'), slams = $$('.slam[data-t]'), scr = $$('.scr[data-t]');
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@<>/\\|=+*';
  scr.forEach((e) => { e.dataset.text = e.textContent; });
  function captions(t) {
    for (const e of lines) {
      const a = +e.dataset.t, x = e.dataset.x ? +e.dataset.x : 1e9;
      const p = out3(P(t, a, a + 0.3));
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
  const FLASH = [6.5, 25.0, 39.5], SHAKE = [[6.5, 10], [39.5, 10]];
  function fx(t) {
    let f = 0;
    for (const a of FLASH) if (t >= a && t < a + 0.3) f = Math.max(f, t < a + 0.067 ? 0.9 : 0.9 * (1 - P(t, a + 0.067, a + 0.3)));
    $('#flash').style.opacity = f;
    let dx = 0, dy = 0;
    for (const [a, amp] of SHAKE) if (t >= a && t < a + 0.3) { const k = amp * (1 - P(t, a, a + 0.3)); dx += Math.sin(t * 190) * k; dy += Math.cos(t * 230) * k; }
    $('#stage').style.transform = `translate(${dx}px,${dy}px)`;
  }

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

  // A — ouverture : la fenêtre sort du noir, le prompt se tape, l'agent lance ses outils
  const hook = $('#w-hook');
  const H = { rows: $$('#log > *', hook), tools: $$('.tool-group > details', hook), input: $('#input', hook), ui: $('.vo-ui', hook), label: $('#thinking-label', hook), clock: $('#thinking-clock', hook) };
  const PROMPT = 'Recon 10.10.10.14 and find me a way in.', CMDS = ['nmap', 'whatweb', 'ffuf', 'sqlmap'];
  function a(t) {
    const p = out3(P(t, 0.1, 0.8)); hook.style.opacity = p; hook.style.transform = `translateY(${(1 - p) * 24}px)`;
    const n = Math.floor(P(t, 0.8, 2.3) * PROMPT.length), caret = Math.floor(t * 2.5) % 2 ? '' : '▍';
    H.input.value = t < 2.4 ? PROMPT.slice(0, n) + (t >= 0.5 ? caret : '') : '';
    show(H.rows[0], t >= 2.4);
    H.ui.classList.toggle('running', t >= 2.6 && t < 4.9);
    show(H.rows[1], t >= 2.6); show(H.rows[2], t >= 3.0);
    H.tools.forEach((d, i) => show(d, t >= 3.0 + i * 0.4));
    H.label.textContent = `Tool: ${CMDS[clamp(Math.floor((t - 3.0) / 0.4), 0, 3)]}`;
    H.clock.textContent = `T+00:${String(Math.max(0, Math.floor((t - 2.6) * 5))).padStart(2, '0')}`;
    show(H.rows[3], t >= 4.9);
  }
  function b(t) { spiderBuild(lockSp, t, 6.5, { brain: 6.75, cross: 6.9 }); }

  // C — Monitor qui suit les nouvelles lignes
  const mon = $('#w-mon'), monRows = $$('.mon-row', mon), lastLines = $$('.mon-line', monRows[monRows.length - 1]), ticks = $$('.mon-tick', mon);
  function c(t) {
    lastLines.forEach((l, i) => show(l, t >= 9.2 + i * 0.055));
    $$('[data-scroll-top]', mon).forEach((e) => { e.scrollTop = e.scrollHeight; });
    ticks.forEach((k, i) => { const p = P(t, 9.05 + i * 0.12, 9.25 + i * 0.12); k.style.opacity = p; k.style.transform = `scaleY(${p})`; });
  }

  // D — kill chain : l'agent ajoute les étapes (journal sous le graphe), la caméra suit
  // la dernière étape, puis recule pour « Rejouer » le chemin (fonction réelle du produit)
  const kc = $('#w-kc'), cs = $('.cs', kc), view = $('.kc-viewport', kc);
  const nodes = $$('.kc-node', kc), edges = $$('.kc-edge', kc), tips = $$('.kc-tip', kc);
  const CN = [[65, 238], [219, 197], [219, 279], [374, 197], [374, 279], [528, 238], [683, 238]];
  const NODE_T = [12.7, 13.2, 13.6, 14.1, 14.5, 15.0, 15.5];
  const EDGE_T = [[12.9, 13.2], [13.3, 13.6], [14.2, 14.5], [14.2, 14.5], [13.8, 14.1], [14.7, 15.0], [15.2, 15.5]];
  const FEED = [
    ['+', 'host', 'Scan 10.10.10.14', 'T1046'], ['+', 'site', 'Admin panel :8080', 'T1595'], ['+', 'credential', 'Default accounts', 'T1078'],
    ['×', 'step', 'SSH brute force', 'failed'], ['+', 'step', 'SQLi on /login confirmed', 'T1190'], ['+', 'step', 'www-data shell via webshell', 'T1059'],
    ['+', 'loot', 'Root escalation', 'T1068']];
  const feed = $('#kc-feed'), stepLine = $('#kc-step');
  const feedRows = FEED.map(([s, k, l, id]) => { const d = document.createElement('div'); d.className = 'feed-row' + (s === '×' ? ' bad' : ''); const a = document.createElement('b'); a.textContent = 'agent'; const m = document.createElement('span'); m.textContent = ` ${s} ${l}`; const r = document.createElement('i'); r.textContent = `  ${k} · ${id}`; d.append(a, m, r); feed.append(d); return d; });
  const REPLAY = [0, 1, 2, 4, 5], REPLAY_T0 = 16.7, STEP = 0.5;
  const isPath = edges.map((e) => e.classList.contains('is-path'));
  const EDGE_NODES = [[0, 1], [0, 2], [1, 4], [2, 4], [1, 3], [4, 5], [5, 6]];
  function camAt(t) {
    // zoom serré qui suit la dernière étape, puis recul sur tout le graphe
    const s0 = 3.0, s1 = 2.2, W0 = 557, H0 = 176;
    let k = 0; for (let i = 0; i < NODE_T.length; i++) if (t >= NODE_T[i] - 0.15) k = i;
    const prev = Math.max(0, k - 1), pk = io(P(t, NODE_T[k] - 0.15, NODE_T[k] + 0.35));
    const targ = (i) => clamp(CN[i][0] - W0 * 0.62, 0, 760 - W0);
    let cx = lerp(targ(prev), targ(k), k === prev ? 1 : pk), s = s0, cy = 238 - H0 / 2;
    const back = io(P(t, 16.0, 16.6));
    return { s: lerp(s, s1, back), cx: lerp(cx, 0, back), cy: lerp(cy, 120, back) };
  }
  function d(t) {
    const cam = camAt(t);
    cs.style.transform = `scale(${cam.s}) translate(${-cam.cx}px,${-cam.cy}px)`;
    nodes.forEach((n, i) => { const p = P(t, NODE_T[i], NODE_T[i] + 0.3); n.style.opacity = p > 0 ? '' : 0; n.style.transformOrigin = '50% 50%'; n.style.scale = String(0.5 + 0.5 * back(p)); });
    edges.forEach((e, i) => { const [p0, p1] = EDGE_T[i]; const p = io(P(t, p0, p1)); e.style.visibility = p > 0 ? 'visible' : 'hidden'; e.style.clipPath = `inset(-20px ${(1 - p) * 100}% -20px -20px)`; });
    tips.forEach((e) => { e.style.opacity = P(t, 15.5, 15.7); });
    // journal de l'agent : les trois dernières lignes
    const shown = NODE_T.filter((x) => t >= x).length;
    feedRows.forEach((r, i) => {
      const age = shown - 1 - i, p = out3(P(t, NODE_T[i], NODE_T[i] + 0.25));
      r.style.display = i < shown && age < 3 ? '' : 'none';
      r.style.opacity = (age === 0 ? p : age === 1 ? 0.7 : 0.4) * (1 - P(t, 15.9, 16.2));
      r.style.transform = `translateY(${(1 - p) * 14}px)`;
    });
    // « Rejouer » : crochets sur l'étape courante, liens du chemin allumés, reste atténué
    const replaying = t >= REPLAY_T0 && t < REPLAY_T0 + REPLAY.length * STEP + 0.8;
    view.classList.toggle('is-replaying', replaying);
    const step = Math.floor((t - REPLAY_T0) / STEP);
    const visited = new Set(replaying ? REPLAY.slice(0, Math.min(REPLAY.length, step + 1)) : []);
    nodes.forEach((n, i) => { n.classList.toggle('is-visited', visited.has(i)); n.classList.toggle('is-replay', replaying && REPLAY[Math.min(step, REPLAY.length - 1)] === i); });
    edges.forEach((e, i) => { const [u, v] = EDGE_NODES[i]; e.classList.toggle('is-lit', isPath[i] && visited.has(u) && visited.has(v)); });
    if (replaying) {
      const k = Math.min(step, REPLAY.length - 1), lab = $('.kc-node-label', nodes[REPLAY[k]]).textContent;
      stepLine.textContent = step >= REPLAY.length ? 'Replay · path replayed' : `Replay · step ${k + 1}/${REPLAY.length} · ${lab}`;
      stepLine.style.opacity = 1;
    } else stepLine.style.opacity = 0;
  }

  // E — « You steer. » puis « Or let it hunt. » : le mode Automatique s'allume sur cette phrase
  const auto = $('#w-auto'), aui = $('.vo-ui', auto);
  const roe = $('#roe', auto), roeLabel = $('#roe-label', auto), badge = $('#automatic-badge', auto);
  const rep = $('#log .report', auto), segs = $$('.report-seg', auto), items = $$('.report-item', auto);
  const repParts = rep ? [$('.report-head', rep), $('.report-summary', rep)] : [];
  const alog = $('#log', auto);
  let before = null, after = null;
  function e(t) {
    const on = t >= 20.5;
    aui.classList.toggle('automatic-on', on);
    roe.dataset.level = on ? '3' : '2'; roeLabel.textContent = on ? 'Automatic' : 'Supervised';
    badge.hidden = !on; badge.textContent = 'Bypass 2:00';
    aui.classList.toggle('running', t >= 20.5 && t < 22.2);
    if (before === null && rep) { rep.style.display = 'none'; before = alog.scrollHeight - alog.clientHeight; rep.style.display = ''; after = alog.scrollHeight - alog.clientHeight; }
    const shown = t >= 22.2;
    if (rep) rep.style.display = shown ? '' : 'none';
    repParts.forEach((p) => { if (p) p.style.opacity = P(t, 22.2, 22.4); });
    segs.forEach((s, i) => { s.style.transformOrigin = '0 50%'; s.style.transform = `scaleX(${out3(P(t, 22.3 + i * 0.08, 22.6 + i * 0.08))})`; });
    items.forEach((it, i) => { const p = P(t, 22.5 + i * 0.3, 22.75 + i * 0.3); it.style.opacity = p; it.style.transform = `translateY(${(1 - out3(p)) * 16}px)`; });
    alog.scrollTop = shown ? before + (after - before) * io(P(t, 22.2, 22.7)) : Math.max(0, before);
  }

  // F — Apprentissage (temps de la V2 décalés de 4 s)
  const wel = $('#w-wel'), welUi = $('.vo-ui', wel);
  function f2(t) {
    const on = t >= 26.4;
    welUi.classList.toggle('learning', on);
    const r = $('#roe', wel); if (r) { r.hidden = false; r.dataset.level = on ? '1' : '2'; const l = $('#roe-label', wel); if (l) l.textContent = on ? 'Learning' : 'Supervised'; }
  }
  const term = $('#w-term'), learn = $('#w-learn');
  const tl = $$('.ln', term), hl = $('.ln.hl', term), lrows = $$('#log > *', learn);
  function f3(t) {
    tl.forEach((l, i) => { l.style.visibility = t >= 28.5 + i * 0.045 ? 'visible' : 'hidden'; });
    const fl = P(t, 29.4, 29.9); hl.style.background = t >= 29.4 ? `rgba(229,19,43,${0.14 + 0.5 * (1 - fl)})` : '';
    lrows.forEach((r, i) => show(r, t >= 28.9 + i * 0.28));
    const strong = $('#log strong', learn);
    if (strong) {
      const p = out3(P(t, 29.9, 30.35));
      strong.style.color = t >= 29.9 ? '#ffffff' : '';
      strong.style.backgroundImage = `linear-gradient(90deg, rgba(229,19,43,.55) ${p * 100}%, transparent ${p * 100}%)`;
      strong.style.borderRadius = '3px'; strong.style.boxDecorationBreak = 'clone'; strong.style.webkitBoxDecorationBreak = 'clone'; strong.style.padding = '0 2px';
    }
    hl.style.boxShadow = t >= 29.9 ? `inset 4px 0 0 #E5132B, 0 0 0 1px rgba(229,19,43,${0.6 * (1 - P(t, 30.4, 31.4)) + 0.25})` : '';
  }

  // G — effort au maximum
  const cfg = $('#w-cfg'), scale = $('#effort-scale', cfg), elabel = $('#effort-label', cfg);
  const LEVELS = ['Low', 'Medium', 'High', 'Extra', 'Maximum'];
  function g1(t) {
    const v = 0.2 + 0.8 * io(P(t, 33.1, 33.85));
    scale.style.setProperty('--jn-progress', String(v));
    scale.classList.toggle('is-max', v >= 0.999);
    elabel.textContent = LEVELS[Math.min(4, Math.round(v * 4))];
  }
  function h2(t) { spiderBuild(endSp, t, 40.5, { brain: 40.75, cross: 40.9 }); }

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
