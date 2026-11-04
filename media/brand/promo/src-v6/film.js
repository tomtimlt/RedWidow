// RedWidow promo V6 (palette Widow) : chaque image est calculée à partir du temps t (secondes).
(() => {
  const T = window.TL, BEAT = T.beat;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const out3 = (x) => 1 - Math.pow(1 - x, 3);
  const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x, k = 2.2) => 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  const lerp = (a, b, p) => a + (b - a) * p;
  const b2t = (n) => n * BEAT;

  // Interface dans la palette par défaut, Widow (cramoisi)
  $$('.vo-ui').forEach((u) => u.setAttribute('data-palette', 'widow'));
  const mk = (slot) => { const s = WarbandSpider.create('rw-spider hero-spider'); $(slot).append(s); return s; };
  const lockSp = mk('#lock-slot'), endSp = mk('#end-slot');
  const legsOf = (s) => ['l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'l4', 'r4'].map((k) => $('.rw-leg-' + k, s));

  // Légendes, groupes, mots qui claquent, texte décodé, cartons de chapitre
  const lines = $$('.cl[data-t]'), groups = $$('.cg[data-t]'), slams = $$('.slam[data-t]'), scr = $$('.scr[data-t]'), chaps = $$('.chap[data-t]');
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@<>/\\|=+*';
  scr.forEach((e) => { e.dataset.text = e.textContent; });
  function captions(t) {
    for (const e of lines) {
      const a = +e.dataset.t, x = e.dataset.x ? +e.dataset.x : 1e9;
      const p = out3(P(t, a, a + 0.32));
      e.style.opacity = t < a || t >= x ? 0 : p;
      e.style.transform = `translateY(${(1 - p) * 30}px)`;
    }
    for (const g of groups) { const a = +g.dataset.t, x = g.dataset.x ? +g.dataset.x : 1e9; g.style.display = t >= a - 0.001 && t < x ? '' : 'none'; }
    for (const e of slams) { const a = +e.dataset.t, p = P(t, a, a + 0.25); e.style.opacity = t < a ? 0 : 1; e.style.transform = `scale(${1.15 - 0.15 * out3(p)})`; }
    for (const e of scr) {
      const a = +e.dataset.t, d = +e.dataset.d, txt = e.dataset.text;
      if (t < a) { e.style.opacity = 0; continue; }
      e.style.opacity = 1;
      const n = Math.floor(P(t, a, a + d) * txt.length), f = Math.floor(t * 30);
      e.textContent = txt.split('').map((c, i) => (i < n || c === ' ' ? c : GLYPHS[(i * 7 + f * 13) % GLYPHS.length])).join('');
    }
    for (const c of chaps) {
      const a = +c.dataset.t, p = out3(P(t, a, a + 0.35));
      c.style.opacity = t >= a ? 1 : 0;
      $('.chap-n', c).style.transform = `translateX(${(1 - p) * -160}px)`;
      $('.chap-w', c).style.clipPath = `inset(0 ${(1 - out3(P(t, a + 0.1, a + 0.45))) * 100}% 0 0)`;
    }
  }

  // Effets : toile qui respire sur le temps, éclairs violets, dédoublement de couleurs
  // sur les coupes de chapitre, balayage vert à l'entrée des plans d'interface
  const CUTS = [T.reveal, T.ch1, T.ch2, T.ch3, T.ch4, T.ch5, T.models, T.all, T.lock];
  const FLASH = [T.reveal, T.ch5, T.free];
  const WIPES = [T.chat, T.mon, T.kc, T.drive, T.report, T.learn, T.hint];
  function fx(t) {
    const web = $('#web'), beatPh = (t / BEAT) % 1;
    const pulse = t >= T.reveal ? Math.exp(-beatPh * 5) : 0.2;
    web.style.opacity = 0.55 + 0.45 * pulse * (t >= T.ch5 && t < T.models ? 0.3 : 1);
    web.style.transform = `rotate(${t * 2.2}deg) scale(${1 + 0.012 * pulse})`;
    let f = 0;
    for (const a of FLASH) if (t >= a && t < a + 0.35) f = Math.max(f, t < a + 0.067 ? 0.75 : 0.75 * (1 - P(t, a + 0.067, a + 0.35)));
    $('#flash').style.opacity = f;
    let g = 0;
    for (const a of CUTS) if (t >= a && t < a + 0.12) g = 1 - P(t, a, a + 0.12);
    const st = $('#stage');
    st.style.filter = g > 0 ? `drop-shadow(${8 * g}px 0 0 rgba(229,19,43,.85)) drop-shadow(${-8 * g}px 0 0 rgba(235,238,242,.55))` : 'none';
    st.style.transform = g > 0 ? `translateX(${Math.sin(t * 400) * 10 * g}px)` : 'none';
    const w = $('#wipe'); let on = false;
    for (const a of WIPES) if (t >= a && t < a + 0.35) { const p = io(P(t, a, a + 0.35)); w.style.top = `${p * 1080}px`; w.style.opacity = 1 - p * 0.3; on = true; }
    if (!on) w.style.opacity = 0;
    for (const s of $$('.scene')) {
      const a = +s.dataset.in; if (!WIPES.includes(a) || s.style.display === 'none') { if (WIPES.includes(a)) s.style.clipPath = ''; continue; }
      const p = io(P(t, a, a + 0.35)); s.style.clipPath = p < 1 ? `inset(0 0 ${(1 - p) * 100}% 0)` : '';
    }
    // rail de chapitres
    const rail = $('#rail'), chs = [T.ch1, T.ch2, T.ch3, T.ch4];
    const inRail = t >= T.ch1 + 0.6 && t < T.ch5;
    rail.style.opacity = inRail ? out3(P(t, T.ch1 + 0.6, T.ch1 + 0.9)) : 0;
    const cur = chs.filter((x) => t >= x).length - 1;
    $$('.rail-step', rail).forEach((r, i) => { r.classList.toggle('cur', i === cur); r.classList.toggle('done', i < cur); });
  }

  function spiderBuild(s, t, t0, o = {}) {
    legsOf(s).forEach((g, i) => { const a = t0 + i * 0.035, p = P(t, a, a + 0.4); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.12 + 0.88 * back(p)})`; });
    $$('.rw-palp', s).forEach((g) => { const p = P(t, t0 + 0.3, t0 + 0.55); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.2 + 0.8 * back(p)})`; });
    $('.rw-body', s).style.opacity = 0.25 + 0.75 * P(t, t0 - 0.2, t0 + 0.1);
    const tb = o.brain ?? t0 + 0.35, tc = o.cross ?? t0 + 0.55;
    $('.rw-brain', s).style.opacity = t < tb ? 0.12 : 0.12 + 0.88 * out3(P(t, tb, tb + 0.12));
    const pc = P(t, tc, tc + 0.38);
    for (const e of [$('.rw-crosshair', s), $('.rw-plate', s)]) if (e) e.style.opacity = t < tc ? 0 : 1;
    const ch = $('.rw-crosshair', s); ch.style.transformOrigin = '50% 50%'; ch.style.transform = `scale(${1.8 - 0.8 * back(pc, 1.6)}) rotate(${-60 * (1 - out3(pc))}deg)`;
    const eyes = $('.rw-eyes', s); eyes.style.opacity = t < tc ? 0.3 : 1; eyes.style.transformOrigin = '50% 50%';
    const bl = P(t, tc + 0.9, tc + 1.05); eyes.style.transform = `scaleY(${bl > 0 && bl < 1 ? 1 - 0.9 * Math.sin(bl * Math.PI) : 1})`;
  }

  // 0 — la galère : lignes tapées, puis barrées en vert
  const tls = $$('.cl.tl');
  tls.forEach((l) => { l.dataset.full = l.innerHTML; const s = document.createElement('i'); s.className = 'strike'; l.append(s); });
  function pain(t) {
    tls.forEach((l, i) => {
      const a = +l.dataset.t, text = l.textContent;
      const strike = $('.strike', l), w = l.getBoundingClientRect().width;
      const p = out3(P(t, T.strike + i * 0.08, T.strike + i * 0.08 + 0.3));
      strike.style.width = `${p * w}px`;
      l.style.color = t >= T.strike + i * 0.08 + 0.15 ? '#5d6067' : '';
      void a; void text;
    });
  }
  function reveal(t) {
    spiderBuild(lockSp, t, T.reveal, { brain: T.reveal + 0.3, cross: T.reveal + 0.5 });
    $('#halo').style.opacity = 0.9 * out3(P(t, T.reveal, T.reveal + 0.5));
  }

  // 1 — Recon : prompt, puis les outils
  const chat = $('#w-chat');
  const H = { rows: $$('#log > *', chat), tools: $$('.tool-group > details', chat), input: $('#input', chat), ui: $('.vo-ui', chat), label: $('#thinking-label', chat), clock: $('#thinking-clock', chat) };
  const PROMPT = 'Recon 10.10.10.14 and find me a way in.', CMDS = ['nmap', 'whatweb', 'ffuf', 'sqlmap'];
  const pills = $$('.cl.tools span');
  function recon(t) {
    const n = Math.floor(P(t, T.type0, T.type1) * PROMPT.length), caret = Math.floor(t * 2.5) % 2 ? '' : '▍';
    H.input.value = t < T.send ? PROMPT.slice(0, n) + caret : '';
    show(H.rows[0], t >= T.send);
    H.ui.classList.toggle('running', t >= T.send + 0.15 && t < T.msg2);
    show(H.rows[1], t >= T.send + 0.15); show(H.rows[2], t >= T.tools);
    H.tools.forEach((d, i) => show(d, t >= T.tools + i * BEAT * 0.75));
    pills.forEach((p, i) => { const a = T.tools + i * BEAT * 0.75; const q = out3(P(t, a, a + 0.2)); p.style.opacity = q; p.style.transform = `scale(${0.8 + 0.2 * back(q)})`; });
    H.label.textContent = `Tool: ${CMDS[clamp(Math.floor((t - T.tools) / (BEAT * 0.75)), 0, 3)]}`;
    H.clock.textContent = `T+00:${String(Math.max(0, Math.floor((t - T.send) * 5))).padStart(2, '0')}`;
    show(H.rows[3], t >= T.msg2);
  }
  // Monitor qui suit les nouvelles lignes
  const mon = $('#w-mon'), monRows = $$('.mon-row', mon), lastLines = $$('.mon-line', monRows[monRows.length - 1]), ticks = $$('.mon-tick', mon);
  function monitor(t) {
    lastLines.forEach((l, i) => show(l, t >= T.mon + 0.15 + i * 0.07));
    $$('[data-scroll-top]', mon).forEach((e) => { e.scrollTop = e.scrollHeight; });
    ticks.forEach((k, i) => { const p = P(t, T.mon + i * 0.12, T.mon + 0.2 + i * 0.12); k.style.opacity = p; k.style.transform = `scaleY(${p})`; });
  }

  // 2 — Analysis : l'agent ajoute les étapes, la caméra suit, puis « Rejouer »
  const kc = $('#w-kc'), cs = $('.cs', kc), view = $('.kc-viewport', kc);
  const nodes = $$('.kc-node', kc), edges = $$('.kc-edge', kc), tips = $$('.kc-tip', kc);
  const CN = [[65, 238], [219, 197], [219, 279], [374, 197], [374, 279], [528, 238], [683, 238]];
  const NB = [0.3, 1.1, 1.8, 2.5, 3.1, 3.8, 4.4].map((x) => T.kc + b2t(x));
  const EB = [[0.6, 1.1], [1.3, 1.8], [2.6, 3.1], [2.6, 3.1], [2.0, 2.5], [3.3, 3.8], [3.9, 4.4]].map(([a, b]) => [T.kc + b2t(a), T.kc + b2t(b)]);
  const FEED = [
    ['+', 'host', 'Scan 10.10.10.14', 'T1046'], ['+', 'site', 'Admin panel :8080', 'T1595'], ['+', 'credential', 'Default accounts', 'T1078'],
    ['×', 'step', 'SSH brute force', 'failed'], ['+', 'step', 'SQLi on /login confirmed', 'T1190'], ['+', 'step', 'www-data shell via webshell', 'T1059'],
    ['+', 'loot', 'Root escalation', 'T1068']];
  const feed = $('#kc-feed'), stepLine = $('#kc-step');
  const feedRows = FEED.map(([s, k, l, id]) => { const d = document.createElement('div'); d.className = 'feed-row' + (s === '×' ? ' bad' : ''); const a = document.createElement('b'); a.textContent = 'agent'; const m = document.createElement('span'); m.textContent = ` ${s} ${l}`; const r = document.createElement('i'); r.textContent = `  ${k} · ${id}`; d.append(a, m, r); feed.append(d); return d; });
  const REPLAY = [0, 1, 2, 4, 5], STEP = BEAT;
  const isPath = edges.map((e) => e.classList.contains('is-path'));
  const EDGE_NODES = [[0, 1], [0, 2], [1, 4], [2, 4], [1, 3], [4, 5], [5, 6]];
  function camAt(t) {
    const W0 = 557, H0 = 176;
    let k = 0; for (let i = 0; i < NB.length; i++) if (t >= NB[i] - 0.15) k = i;
    const prev = Math.max(0, k - 1), pk = io(P(t, NB[k] - 0.15, NB[k] + 0.35));
    const targ = (i) => clamp(CN[i][0] - W0 * 0.62, 0, 760 - W0);
    const cx = lerp(targ(prev), targ(k), k === prev ? 1 : pk), bk = io(P(t, T.replay - 0.2, T.replay + 0.4));
    return { s: lerp(3.0, 2.2, bk), cx: lerp(cx, 0, bk), cy: lerp(238 - H0 / 2, 120, bk) };
  }
  function killchain(t) {
    const cam = camAt(t);
    cs.style.transform = `scale(${cam.s}) translate(${-cam.cx}px,${-cam.cy}px)`;
    nodes.forEach((n, i) => { const p = P(t, NB[i], NB[i] + 0.3); n.style.opacity = p > 0 ? '' : 0; n.style.transformOrigin = '50% 50%'; n.style.scale = String(0.5 + 0.5 * back(p)); });
    edges.forEach((e, i) => { const [a, b] = EB[i]; const p = io(P(t, a, b)); e.style.visibility = p > 0 ? 'visible' : 'hidden'; e.style.clipPath = `inset(-20px ${(1 - p) * 100}% -20px -20px)`; });
    tips.forEach((e) => { e.style.opacity = P(t, NB[6], NB[6] + 0.2); });
    const shown = NB.filter((x) => t >= x).length;
    feedRows.forEach((r, i) => {
      const age = shown - 1 - i, p = out3(P(t, NB[i], NB[i] + 0.25));
      r.style.display = i < shown && age < 3 ? '' : 'none';
      r.style.opacity = (age === 0 ? p : age === 1 ? 0.7 : 0.4) * (1 - P(t, T.replay - 0.3, T.replay));
      r.style.transform = `translateY(${(1 - p) * 14}px)`;
    });
    const r0 = T.replay + 0.5, replaying = t >= r0 && t < r0 + REPLAY.length * STEP + 1.0;
    view.classList.toggle('is-replaying', replaying);
    const step = Math.floor((t - r0) / STEP);
    const visited = new Set(replaying ? REPLAY.slice(0, Math.min(REPLAY.length, step + 1)) : []);
    nodes.forEach((n, i) => { n.classList.toggle('is-visited', visited.has(i)); n.classList.toggle('is-replay', replaying && REPLAY[Math.min(step, REPLAY.length - 1)] === i); });
    edges.forEach((e, i) => { const [u, v] = EDGE_NODES[i]; e.classList.toggle('is-lit', isPath[i] && visited.has(u) && visited.has(v)); });
    if (replaying) {
      const k = Math.min(step, REPLAY.length - 1), lab = $('.kc-node-label', nodes[REPLAY[k]]).textContent;
      stepLine.textContent = step >= REPLAY.length ? 'Replay · path replayed' : `Replay · step ${k + 1}/${REPLAY.length} · ${lab}`;
      stepLine.style.opacity = 1;
    } else stepLine.style.opacity = 0;
  }

  // 3 — Action : « Drive it. » (Supervisé) puis « Or unleash it. » (Automatique)
  const act = $('#w-auto'), aui = $('.vo-ui', act);
  function action(t) {
    const on = t >= T.unleash;
    aui.classList.toggle('automatic-on', on);
    const roe = $('#roe', act); roe.dataset.level = on ? '3' : '2'; $('#roe-label', act).textContent = on ? 'Automatic' : 'Supervised';
    const badge = $('#automatic-badge', act); badge.hidden = !on; badge.textContent = 'Bypass 2:00';
    aui.classList.toggle('running', on);
    const rep = $('#log .report', act); if (rep) rep.style.display = 'none';
    const log = $('#log', act); log.scrollTop = log.scrollHeight;
  }
  // 4 — Report : le rapport s'écrit, le chat défile jusqu'à lui
  const rw = $('#w-rep'), rui = $('.vo-ui', rw), rlog = $('#log', rw), rep = $('#log .report', rw);
  const segs = $$('.report-seg', rw), items = $$('.report-item', rw), repParts = rep ? [$('.report-head', rep), $('.report-summary', rep)] : [];
  let before = null, after = null;
  function report(t) {
    rui.classList.add('automatic-on');
    const roe = $('#roe', rw); roe.dataset.level = '3'; $('#roe-label', rw).textContent = 'Automatic';
    const badge = $('#automatic-badge', rw); badge.hidden = false; badge.textContent = 'Bypass 1:59';
    if (before === null && rep) { rep.style.display = 'none'; before = rlog.scrollHeight - rlog.clientHeight; rep.style.display = ''; after = rlog.scrollHeight - rlog.clientHeight; }
    const a = T.report + 0.25;
    repParts.forEach((p) => { if (p) p.style.opacity = P(t, a, a + 0.2); });
    segs.forEach((s, i) => { s.style.transformOrigin = '0 50%'; s.style.transform = `scaleX(${out3(P(t, a + 0.1 + i * 0.08, a + 0.4 + i * 0.08))})`; });
    items.forEach((it, i) => { const p = P(t, a + 0.3 + i * BEAT * 0.6, a + 0.55 + i * BEAT * 0.6); it.style.opacity = p; it.style.transform = `translateY(${(1 - out3(p)) * 16}px)`; });
    rlog.scrollTop = before + (after - before) * io(P(t, a - 0.1, a + 0.5));
  }

  // 5 — Learn : l'araignée étudie, puis l'indice pointe la faille
  const wel = $('#w-wel'), welUi = $('.vo-ui', wel);
  function learn(t) {
    const on = t >= T.learnOn;
    welUi.classList.toggle('learning', on);
    const r = $('#roe', wel); if (r) { r.hidden = false; r.dataset.level = on ? '1' : '2'; const l = $('#roe-label', wel); if (l) l.textContent = on ? 'Learning' : 'Supervised'; }
  }
  const term = $('#w-term'), lrn = $('#w-learn');
  const tl = $$('.ln', term), hl = $('.ln.hl', term), lrows = $$('#log > *', lrn);
  function hint(t) {
    const h0 = T.hint;
    tl.forEach((l, i) => { l.style.visibility = t >= h0 + i * 0.045 ? 'visible' : 'hidden'; });
    const fl = P(t, h0 + 0.9, h0 + 1.4); hl.style.background = t >= h0 + 0.9 ? `rgba(229,19,43,${0.14 + 0.45 * (1 - fl)})` : '';
    lrows.forEach((r, i) => show(r, t >= h0 + 0.4 + i * 0.28));
    const strong = $('#log strong', lrn), s0 = h0 + b2t(2.2);
    if (strong) {
      const p = out3(P(t, s0, s0 + 0.45));
      strong.style.color = t >= s0 ? '#ffffff' : '';
      strong.style.backgroundImage = `linear-gradient(90deg, rgba(229,19,43,.75) ${p * 100}%, transparent ${p * 100}%)`;
      strong.style.borderRadius = '3px'; strong.style.boxDecorationBreak = 'clone'; strong.style.webkitBoxDecorationBreak = 'clone'; strong.style.padding = '0 2px';
    }
    hl.style.boxShadow = t >= s0 ? `inset 4px 0 0 #E5132B, 0 0 0 1px rgba(229,19,43,${0.6 * (1 - P(t, s0 + 0.5, s0 + 1.5)) + 0.25})` : '';
  }
  function end2(t) {
    spiderBuild(endSp, t, T.lock, { brain: T.lock + 0.3, cross: T.lock + 0.45 });
    $('#halo2').style.opacity = 0.9 * out3(P(t, T.lock, T.lock + 0.5));
  }

  // Horloge virtuelle pour les animations CSS du produit
  const seen = new WeakMap();
  function clockAnims(t) {
    for (const an of document.getAnimations()) {
      if (!seen.has(an)) seen.set(an, t);
      an.pause(); an.currentTime = Math.max(0, (t - seen.get(an)) * 1000);
    }
  }
  const scenes = $$('.scene');
  const RUN = { pain, reveal, recon, mon: monitor, kc: killchain, action, report, learn, hint, end2 };
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
