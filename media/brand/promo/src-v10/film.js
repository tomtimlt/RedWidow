// RedWidow promo V10 (LinkedIn 4:5, 94 BPM, fr et en) : chaque image est calculée à partir du temps t (secondes).
// Aucune transition CSS : tout mouvement vient de window.render(t) ou de l'horloge virtuelle des animations du produit.
(() => {
  const T = window.TL, BEAT = T.beat, CUT = T.cut;
  const $ = (s, r = document) => (r ? r.querySelector(s) : null);
  const $$ = (s, r = document) => (r ? [...r.querySelectorAll(s)] : []);
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const out3 = (x) => 1 - Math.pow(1 - x, 3);
  const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x, k = 2.2) => 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  const lerp = (a, b, p) => a + (b - a) * p;
  const W = (en, fr) => (window.LANG === 'fr' ? fr : en);
  const has = (k) => T[k] < 5000;

  // Interface dans la palette par défaut, Widow (cramoisi)
  $$('.vo-ui').forEach((u) => u.setAttribute('data-palette', 'widow'));
  const mk = (slot) => { const s = WarbandSpider.create('rw-spider hero-spider'); $(slot).append(s); return s; };
  const lockSp = mk('#lock-slot'), endSp = mk('#end-slot');
  const legsOf = (s) => ['l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'l4', 'r4'].map((k) => $('.rw-leg-' + k, s));

  // ------------------------------------------------------------ légendes
  // Lignes qui montent de 28 px en fondu (0,45 s, power3.out).
  const lines = $$('.cl[data-t]'), groups = $$('.cg[data-t]'), slams = $$('.slam[data-t]'), scr = $$('.scr[data-t]');
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@<>/\\|=+*';
  scr.forEach((e) => { e.dataset.text = e.textContent; });
  function captions(t) {
    for (const e of lines) {
      const a = +e.dataset.t, x = e.dataset.x ? +e.dataset.x : 1e9;
      const p = out3(P(t, a, a + 0.45));
      e.style.opacity = t < a || t >= x ? 0 : p;
      e.style.transform = `translateY(${(1 - p) * 28}px)`;
    }
    for (const g of groups) { const a = +g.dataset.t, x = g.dataset.x ? +g.dataset.x : 1e9; g.style.display = t >= a - 0.001 && t < x ? '' : 'none'; }
    for (const e of slams) { const a = +e.dataset.t, p = P(t, a, a + 0.25); e.style.opacity = t < a ? 0 : 1; e.style.transform = `scale(${1.15 - 0.15 * out3(p)})`; }
    for (const e of scr) {
      const a = +e.dataset.t, d = +e.dataset.d, txt = e.dataset.text;
      if (t < a) { e.style.opacity = 0; continue; }
      e.style.opacity = 1;
      const n = Math.floor(P(t, a, a + d) * txt.length), f = Math.floor(t * 30);
      e.textContent = txt.split('').map((c, i) => (i < n || c === ' ' || c === ' ' ? c : GLYPHS[(i * 7 + f * 13) % GLYPHS.length])).join('');
    }
  }

  // ------------------------------------------------------------ effets : toile qui bat la mesure, éclair, balayage, rail
  const FLASH = [T.reveal, T.free].filter((x) => x < 5000);
  const WIPES = [T.mon, T.kc, T.replay, T.drive, T.unleash, T.report, T.learn, T.hint, T.cb].filter((x) => x < 5000 && x > 0.1);
  const sceneEls = $$('.scene');
  const WIPE_IN = sceneEls.filter((s) => WIPES.some((w) => Math.abs(w - +s.dataset.in) < 0.001));
  function fx(t) {
    const web = $('#web'), beatPh = (((t / BEAT) % 1) + 1) % 1;
    const pulse = Math.exp(-beatPh * 5);
    const calm = t >= T.learn && t < T.models ? 0.3 : 1;
    web.style.opacity = t >= T.hush && t < T.reveal ? 0.3 : 0.5 + 0.5 * pulse * calm;
    web.style.transform = `rotate(${t * 2.2}deg) scale(${1 + 0.012 * pulse})`;
    const fr = Math.floor(t * 15) + 40, gr = $('#grain'); gr.style.backgroundPosition = `${(fr * 137) % 512}px ${(fr * 89) % 512}px`;
    let f = 0;
    for (const a of FLASH) if (t >= a && t < a + 0.35) f = Math.max(f, t < a + 0.067 ? 0.7 : 0.7 * (1 - P(t, a + 0.067, a + 0.35)));
    $('#flash').style.opacity = f;
    const w = $('#wipe'); let on = false;
    for (const a of WIPES) if (t >= a && t < a + 0.22) { const p = out3(P(t, a, a + 0.22)); w.style.top = `${p * 1350}px`; w.style.opacity = 1 - p * 0.3; on = true; }
    if (!on) w.style.opacity = 0;
    for (const s of WIPE_IN) {
      if (s.style.display === 'none') { s.style.clipPath = ''; continue; }
      const a = +s.dataset.in, p = out3(P(t, a + 0.0, a + 0.22)); s.style.clipPath = p < 1 ? `inset(0 0 ${(1 - p) * 100}% 0)` : '';
    }
    // rail de mission : la pastille courante porte son nom, les autres leur numéro
    const rail = $('#rail');
    if (rail) {
      const chs = [T.mon, T.kc, T.drive, T.report, T.learn];
      const inRail = t >= T.mon && t < T.models;
      rail.style.opacity = inRail ? out3(P(t, T.mon, T.mon + 0.3)) : 0;
      const cur = chs.filter((x) => t >= x).length - 1;
      $$('.rail-step', rail).forEach((r, i) => { r.classList.toggle('cur', i === cur); r.classList.toggle('done', i < cur); });
      const a = chs[cur] ?? 0, b = [T.kc, T.drive, T.report, T.learn, T.models][cur] ?? 1;
      rail.style.setProperty('--p', String(P(t, a, b)));
    }
  }

  function spiderBuild(s, t, t0, o = {}) {
    legsOf(s).forEach((g, i) => { const a = t0 + i * 0.025, p = P(t, a, a + 0.3); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.12 + 0.88 * back(p)})`; });
    $$('.rw-palp', s).forEach((g) => { const p = P(t, t0 + 0.2, t0 + 0.4); g.style.opacity = p > 0 ? 1 : 0; g.style.transform = `scale(${0.2 + 0.8 * back(p)})`; });
    $('.rw-body', s).style.opacity = 0.25 + 0.75 * P(t, t0 - 0.2, t0 + 0.1);
    const tb = o.brain ?? t0 + 0.25, tc = o.cross ?? t0 + 0.4;
    $('.rw-brain', s).style.opacity = t < tb ? 0.12 : 0.12 + 0.88 * out3(P(t, tb, tb + 0.12));
    const pc = P(t, tc, tc + 0.38);
    for (const e of [$('.rw-crosshair', s), $('.rw-plate', s)]) if (e) e.style.opacity = t < tc ? 0 : 1;
    const ch = $('.rw-crosshair', s); ch.style.transformOrigin = '50% 50%'; ch.style.transform = `scale(${1.8 - 0.8 * back(pc, 1.6)}) rotate(${-60 * (1 - out3(pc))}deg)`;
    const eyes = $('.rw-eyes', s); eyes.style.opacity = t < tc ? 0.3 : 1; eyes.style.transformOrigin = '50% 50%';
    const bl = P(t, tc + 1.4, tc + 1.55); eyes.style.transform = `scaleY(${bl > 0 && bl < 1 ? 1 - 0.9 * Math.sin(bl * Math.PI) : 1})`;
  }

  // ------------------------------------------------------------ outils communs aux chats
  // Caméra verticale : cy en pixels du composant (avant mise à l'échelle).
  const camY = (win, cy) => { const cs = $('.cs', win); cs.style.transform = `scale(${win.dataset.s}) translate(${-win.dataset.cx}px,${-cy}px)`; };
  // Position d'un élément dans le repère du composant (indépendante de la caméra).
  const yIn = (win, el) => { const cs = $('.cs', win), s = +win.dataset.s; const a = cs.getBoundingClientRect(), b = el.getBoundingClientRect(); return { top: (b.top - a.top) / s, bottom: (b.bottom - a.top) / s, left: (b.left - a.left) / s, right: (b.right - a.left) / s }; };
  // États réels d'une ligne d'outil : « en cours » (horloge) puis « réussi » (coche).
  const CLOCK = '<svg class="ico icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="clock"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"></path><path d="M12 7v5l3 2"></path></svg>';
  function prepTool(d) {
    const check = $('svg[data-icon="check"]', d); const tmp = document.createElement('span'); tmp.innerHTML = CLOCK; const clock = tmp.firstChild;
    check.after(clock); d._check = check; d._clock = clock; d._state = $('.tool-state', d);
  }
  function toolState(d, pending) {
    d.classList.toggle('pending', pending); d.classList.toggle('ok', !pending);
    show(d._check, !pending); show(d._clock, pending);
    d._state.textContent = pending ? W('running', 'en cours') : W('done', 'réussi');
  }
  // Rail de mission du produit : étapes terminées (coche), étape courante, étapes à venir (états réels).
  const MST = ['is-done', 'is-current', 'is-wait', 'is-todo'];
  function setMission(win, cur, state = 'is-current') {
    const steps = $$('.mission-step', win); if (!steps.length) return;
    if (!win._check) win._check = ($('.mission-step.is-done .mission-mark', win) || {}).innerHTML || '';
    steps.forEach((li, i) => {
      const cls = i < cur ? 'is-done' : i === cur ? state : 'is-todo';
      MST.forEach((k) => li.classList.toggle(k, k === cls));
      if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      const m = $('.mission-mark', li), want = i < cur ? 'c' : 'n';
      if (m.dataset.k !== want) { m.dataset.k = want; if (want === 'c') m.innerHTML = win._check; else m.textContent = String(i + 1); }
    });
  }
  const arrive = (el, t, a) => { const p = out3(P(t, a, a + 0.18)); show(el, t >= a); el.style.opacity = p; el.style.transform = `translateY(${(1 - p) * 10}px)`; };
  function cursorTo(cur, t, pts) {
    // pts : [[t, x, y], …] ; interpolation douce entre les points, caché hors de l'intervalle
    if (!cur) return;
    if (t < pts[0][0] || t > pts[pts.length - 1][0]) { cur.style.opacity = 0; return; }
    let k = 0; while (k < pts.length - 2 && t >= pts[k + 1][0]) k++;
    const [ta, xa, ya] = pts[k], [tb, xb, yb] = pts[k + 1], p = io(P(t, ta, tb));
    cur.style.opacity = 1; cur.style.left = `${lerp(xa, xb, p)}px`; cur.style.top = `${lerp(ya, yb, p)}px`;
  }
  const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.55]; };
  const press = (el, t, a) => { const p = P(t, a, a + 0.16); el.style.transform = p > 0 && p < 1 ? `scale(${1 - 0.07 * Math.sin(p * Math.PI)})` : ''; };

  // ------------------------------------------------------------ accroche A : outils, carte, Allow once, résultat
  const hk = $('#w-hook');
  const HK = hk && { rows: $$('#log > *', hk), tools: $$('.tool-group > details', hk), ui: $('.vo-ui', hk), log: $('#log', hk),
    label: $('#thinking-label', hk), clock: $('#thinking-clock', hk), card: $('#approvals .card', hk), btn: $('#approvals .card-buttons .primary', hk), cur: $('#cur-hook') };
  const CMDS = ['nmap', 'whatweb', 'ffuf', 'sqlmap'];
  if (HK) HK.tools.forEach(prepTool);
  function hook(t) {
    const TT = [T.t1, T.t2, T.t3, T.t4], CH = +hk.dataset.ch;
    const gone = T.allow + 0.2;                       // la carte se referme après la pression
    show(HK.rows[0], true); show(HK.rows[1], true); show(HK.rows[2], true);
    HK.tools.forEach((d, i) => {
      // nmap est déjà parti à la première image ; sqlmap attend l'accord
      arrive(d, t, i === 0 ? -1 : TT[i]);
      toolState(d, i < 3 ? t < TT[i] + BEAT * 0.8 : t < T.win - 0.12);
      const hit = P(t, TT[i], TT[i] + 0.3); $('.tool-summary', d).style.color = t >= TT[i] && hit < 1 ? `rgb(${lerp(255, 204, hit)},${lerp(255, 204, hit)},${lerp(255, 204, hit)})` : '';
    });
    const cardOn = t >= T.card && t < gone;
    show(HK.card, cardOn);
    if (cardOn) { const p = out3(P(t, T.card, T.card + 0.22)), q = P(t, T.allow + 0.08, gone); HK.card.style.opacity = p * (1 - q); HK.card.style.transform = `translateY(${(1 - p) * -26}px) scale(${1 - 0.03 * q})`; }
    HK.ui.classList.toggle('waiting', cardOn);
    HK.ui.classList.toggle('running', t < T.win + 0.3);
    show(HK.rows[3], t >= T.win); if (t >= T.win) arrive(HK.rows[3], t, T.win);
    const k = clamp(TT.filter((x) => t >= x).length - 1, 0, 3);
    HK.label.textContent = cardOn ? W('Waiting for your approval', 'En attente de votre accord') : `${W('Tool: ', 'Outil : ')}${CMDS[k]}`;
    HK.clock.textContent = `T+00:${String(Math.max(0, Math.floor(1 + t * 2.4))).padStart(2, '0')}`;
    HK.log.scrollTop = HK.log.scrollHeight;
    // caméra : l'en-tête et les outils, puis la carte, puis le résultat
    const last = yIn(hk, HK.tools[k]);
    const cyTools = clamp(last.bottom + 14 - CH, 0, 1e4);
    const cyCard = cardOn ? clamp(yIn(hk, HK.card).bottom + 10 - CH, 0, 1e4) : cyTools;
    const cyWin = clamp(yIn(hk, HK.log).bottom + 8 - CH, 0, 1e4);
    setMission(hk, t >= T.win ? 1 : 0, cardOn ? 'is-wait' : 'is-current');
    let cy = cyTools;
    if (t >= T.card) cy = lerp(cyTools, cyCard, io(P(t, T.card, T.card + 0.35)));
    if (t >= gone) cy = cyWin;
    camY(hk, cy);
    press(HK.btn, t, T.allow);
    if (cardOn || t < gone + 0.1) {
      const [bx, by] = HK.btn.isConnected && cardOn ? center(HK.btn) : (hook._b || [540, 1000]); if (cardOn && t > T.card + 0.4) hook._b = [bx, by];
      const b = hook._b || [bx, by];
      cursorTo(HK.cur, t, [[T.card + 0.3, 900, 1230], [T.allow - 0.12, b[0], b[1]], [gone, b[0], b[1]]]);
    } else HK.cur.style.opacity = 0;
    // silence avant le logo : l'image retient son souffle
    $('#hook').style.filter = t >= T.hush ? `brightness(${1 - 0.5 * out3(P(t, T.hush, T.reveal))})` : '';
  }

  // ------------------------------------------------------------ accroche B : la consigne tapée qui a tout lancé
  const cbw = $('#w-chatb');
  const CB = cbw && { rows: $$('#log > *', cbw), tools: $$('.tool-group > details', cbw), ui: $('.vo-ui', cbw), log: $('#log', cbw), input: $('#input', cbw),
    label: $('#thinking-label', cbw), clock: $('#thinking-clock', cbw) };
  const PROMPT = W('Recon 10.10.10.14 and find me a way in.', 'Repère 10.10.10.14 et trouve-moi une entrée.');
  if (CB) CB.tools.forEach(prepTool);
  function chatb(t) {
    const TT = [T.bt1, T.bt2, T.bt3], CH = +cbw.dataset.ch;
    const n = Math.floor(P(t, T.type0, T.type1) * PROMPT.length), caret = Math.floor(t * 2.5) % 2 ? '' : '▍';
    CB.input.value = t < T.send ? PROMPT.slice(0, n) + caret : '';
    show(CB.rows[0], t >= T.send); show(CB.rows[1], t >= T.send + 0.12); show(CB.rows[2], t >= T.bt1); show(CB.rows[3], false);
    CB.tools.forEach((d, i) => { if (i > 2) { show(d, false); return; } arrive(d, t, TT[i]); toolState(d, t < TT[i] + BEAT * 0.45); });
    CB.ui.classList.toggle('running', t >= T.send);
    setMission(cbw, 0);
    const k = clamp(TT.filter((x) => t >= x).length - 1, 0, 2);
    CB.label.textContent = `${W('Tool: ', 'Outil : ')}${CMDS[k]}`;
    CB.clock.textContent = `T+00:${String(Math.max(0, Math.floor((t - T.send) * 2.4))).padStart(2, '0')}`;
    const comp = yIn(cbw, $('#composer', cbw));
    camY(cbw, lerp(clamp(comp.bottom + 8 - CH, 0, 1e4), 0, io(P(t, T.send, T.send + 0.35))));
    $('#chatb').style.filter = t >= T.hush ? `brightness(${1 - 0.5 * out3(P(t, T.hush, T.reveal))})` : '';
  }
  function reveal(t) {
    spiderBuild(lockSp, t, T.reveal - 0.05, { brain: T.reveal + 0.15, cross: T.reveal + 0.25 });
    $('#halo').style.opacity = 0.9 * out3(P(t, T.reveal, T.reveal + 0.4));
  }

  // ------------------------------------------------------------ 01 · Monitor qui suit les nouvelles lignes
  const mon = $('#w-mon');
  const MON = mon && { rows: $$('.mon-row', mon), ticks: $$('.mon-tick', mon) };
  if (MON) MON.last = $$('.mon-line', MON.rows[MON.rows.length - 1]);
  function monitor(t) {
    MON.rows.forEach((r, i) => show(r, t >= T.mon + i * BEAT));
    MON.last.forEach((l, i) => show(l, t >= T.mon + 2 * BEAT + 0.1 + i * 0.09));
    $$('[data-scroll-top]', mon).forEach((e) => { e.scrollTop = e.scrollHeight; });
    MON.ticks.forEach((k, i) => { const p = P(t, T.mon + i * BEAT, T.mon + 0.2 + i * BEAT); k.style.opacity = p; k.style.transform = `scaleY(${p})`; });
    const c = $('#monitor-count', mon), n = clamp(Math.floor((t - T.mon) / BEAT) + 1, 1, 3);
    if (c) c.textContent = W(`${n} command${n > 1 ? 's' : ''}`, `${n} commande${n > 1 ? 's' : ''}`);
    const clk = $('#mission-clock', mon); if (clk) clk.textContent = `T+00:${String(Math.floor(14 + (t - T.mon) * 2.4)).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------ 02 · kill chain : l'agent ajoute les étapes, puis « Rejouer »
  const EDGE_NODES = [[0, 1], [0, 2], [1, 4], [2, 4], [1, 3], [4, 5], [5, 6]];
  const REPLAY = [0, 1, 2, 4, 5], ROOT = 6, ROOT_EDGE = 6;
  const FR_LAB = { 'Admin panel :8080': 'Panneau admin :8080', 'Default accounts': 'Comptes par défaut', 'SSH brute force': 'Force brute SSH', 'SQLi on /login confirmed': 'SQLi sur /login confirmée',
    'www-data shell via webshell': 'Shell www-data via webshell', 'Root escalation': 'Élévation root' };
  const FEED = [
    ['+', 'host', 'Scan 10.10.10.14', 'T1046'], ['+', 'site', 'Admin panel :8080', 'T1595'], ['+', 'credential', 'Default accounts', 'T1078'],
    ['×', 'step', 'SSH brute force', 'failed'], ['+', 'step', 'SQLi on /login confirmed', 'T1190'], ['+', 'step', 'www-data shell via webshell', 'T1059'],
    ['+', 'loot', 'Root escalation', 'T1068']].map(W((r) => r, ([s, k, l, id]) => [s, { host: 'hôte', credential: 'identifiant', step: 'étape', loot: 'butin' }[k] || k, FR_LAB[l] || l, id === 'failed' ? 'échec' : id]));
  function makeKC(kc, feed, stepLine, tKc, tReplay) {
    if (!kc) return () => {};
    const view = $('.kc-viewport', kc), nodes = $$('.kc-node', kc), edges = $$('.kc-edge', kc), tips = $$('.kc-tip', kc), btn = $('.kc-replay', kc), status = $('.kc-replay-status', kc);
    const NB = [0.2, 0.8, 1.3, 1.9, 2.4, 2.9, 3.4].map((x) => tKc + x * BEAT);
    const EB = [[0.4, 0.8], [0.9, 1.3], [2.0, 2.4], [2.0, 2.4], [1.5, 1.9], [2.5, 2.9], [3.0, 3.4]].map(([a, b]) => [tKc + a * BEAT, tKc + b * BEAT]);
    const feedRows = feed ? FEED.map(([s, k, l, id]) => { const d = document.createElement('div'); d.className = 'feed-row' + (s === '×' ? ' bad' : ''); const a = document.createElement('b'); a.textContent = 'agent'; const m = document.createElement('span'); m.textContent = ` ${s} ${l}`; const r = document.createElement('i'); r.textContent = `  ${k} · ${id}`; d.append(a, m, r); feed.append(d); return d; }) : [];
    const isPath = edges.map((e) => e.classList.contains('is-path'));
    // Disposition en colonnes : les liens courent dans les couloirs libres (gouttière centrale, marge droite)
    // et entrent par le côté des têtes de nœud : aucun trait ne passe sur un libellé.
    const Kc = 1.95, NW = 236, X1 = 14, X2 = 280, XC = 147, PITCH = 96, R = [2, 2 + PITCH, 2 + 2 * PITCH, 2 + 3 * PITCH];
    const POS = [[XC, R[0]], [X1, R[1]], [X2, R[1]], [X1, R[2]], [X2, R[2]], [X2, R[3]], [X1, R[3]]];
    const canvas = $('.kc-canvas', kc); canvas.style.transform = 'translate(0px, 0px) scale(' + Kc + ')';
    nodes.forEach((n, i) => { n.style.left = POS[i][0] + 'px'; n.style.top = POS[i][1] + 'px'; n.style.width = NW + 'px'; });
    const svg = $('.kc-edges', kc); svg.setAttribute('width', '540'); svg.setAttribute('height', '400');
    const cx = (i) => POS[i][0] + NW / 2, hy = (i) => POS[i][1] + 23, HR = 27, AR = 30, RC = 12, GA = 259, GB = 271, GR = 521;
    const lane = (a, b, x, sa, sb) => {
      // sa, sb : côté de sortie et d'entrée (+1 à droite de la tête, −1 à gauche)
      const x0 = cx(a) + sa * HR, x1 = cx(b) + sb * AR, da = Math.sign(x - x0), db = Math.sign(x1 - x);
      return ['M', x0, hy(a), 'H', x - da * RC, 'Q', x, hy(a), x, hy(a) + RC, 'V', hy(b) - RC, 'Q', x, hy(b), x + db * RC, hy(b), 'H', x1].join(' ');
    };
    const drop = (a, b) => { const s = Math.sign(cx(b) - cx(a)); return ['M', cx(a) + s * HR, hy(a), 'H', cx(b) - s * RC, 'Q', cx(b), hy(a), cx(b), hy(a) + RC, 'V', POS[b][1] - 4].join(' '); };
    const PATHS = [drop(0, 1), drop(0, 2), lane(1, 4, GB, 1, -1), lane(2, 4, GB, -1, -1), lane(1, 3, GA, 1, 1), lane(4, 5, GR, 1, 1),
      ['M', cx(5) - HR, hy(5), 'H', cx(6) + AR].join(' ')];
    edges.forEach((e, i) => e.setAttribute('d', PATHS[i]));
    $$('.kc-edge-hit', kc).forEach((e, i) => e.setAttribute('d', PATHS[i]));
    $('.cs', kc).style.transform = 'none';
    const STEP = BEAT * T.step, r0 = tReplay + BEAT * (T.step === 1 ? 1 : 0.4);
    const label = (i) => $('.kc-node-label', nodes[i]).textContent, meta = (i) => ($('.kc-node-meta', nodes[i]).textContent.split('·')[1] || '').trim();
    return (t) => {
      nodes.forEach((n, i) => { const p = P(t, NB[i], NB[i] + 0.28); n.style.opacity = p > 0 ? '' : 0; n.style.transformOrigin = '50% 50%'; n.style.scale = String(0.5 + 0.5 * back(p)); });
      edges.forEach((e, i) => { const [a, b] = EB[i]; const p = io(P(t, a, b)); e.style.visibility = p > 0 ? 'visible' : 'hidden'; e.style.clipPath = `inset(-20px -20px ${(1 - p) * 100}% -20px)`; });
      tips.forEach((e) => { e.style.opacity = P(t, NB[6], NB[6] + 0.2); });
      const shown = NB.filter((x) => t >= x).length;
      feedRows.forEach((r, i) => {
        const age = shown - 1 - i, p = out3(P(t, NB[i], NB[i] + 0.25));
        r.style.display = i < shown && age < 1 ? '' : 'none';
        r.style.opacity = p * (1 - P(t, tReplay - 0.2, tReplay));
        r.style.transform = `translateY(${(1 - p) * 14}px)`;
      });
      // « Rejouer » : le bouton réel est pressé, le chemin retenu s'allume étape par étape
      const replaying = t >= tReplay;
      if (btn) { btn.setAttribute('aria-pressed', replaying ? 'true' : 'false'); press(btn, t, tReplay); }
      view.classList.toggle('is-replaying', replaying);
      const step = Math.floor((t - r0) / STEP), done = replaying && step >= REPLAY.length;
      const visited = new Set(replaying && step >= 0 ? REPLAY.slice(0, Math.min(REPLAY.length, step + 1)) : []);
      // Fin du rejeu : le nœud racine s'allume avec son lien, mais reste une étape prévue (pastille « ? »).
      if (done) visited.add(ROOT);
      nodes.forEach((n, i) => { n.classList.toggle('is-visited', visited.has(i)); n.classList.toggle('is-replay', replaying && step >= 0 && (done ? i === ROOT : REPLAY[Math.min(step, REPLAY.length - 1)] === i)); });
      edges.forEach((e, i) => { const [u, v] = EDGE_NODES[i]; e.classList.toggle('is-lit', (isPath[i] || (done && i === ROOT_EDGE)) && visited.has(u) && visited.has(v)); });
      // Sous la fenêtre, en grand : l'étape rejouée et sa technique ATT&CK (même libellé que le statut
      // du produit, « Étape 2/5 : … »), puis la suite prévue.
      const k = Math.min(step, REPLAY.length - 1);
      if (stepLine) {
        if (replaying && step >= 0) {
          const i = done ? ROOT : REPLAY[k];
          stepLine.innerHTML = '';
          const a = document.createElement('b'); a.textContent = done ? W('Next · planned', 'Ensuite · prévu') : `${W('Step', 'Étape')} ${k + 1}/${REPLAY.length}`;
          const m = document.createElement('span'); m.textContent = ` ${label(i)}`;
          const r = document.createElement('i'); r.textContent = ` · ${meta(i)}`;
          stepLine.append(a, m, r);
          stepLine.style.opacity = 1;
        } else stepLine.style.opacity = 0;
      }
    };
  }
  const killchain = makeKC($('#w-kc'), $('#kc-feed'), $('#kc-step'), T.kc, T.replay);
  const killchainB = makeKC($('#w-kcb'), null, $('#kcb-step'), T.kcb, T.replayb);

  // ------------------------------------------------------------ 03 · « Drive it. » : la carte d'autorisation et ses trois boutons
  const drv = $('#w-drive');
  const DR = drv && { card: $('#approvals .card', drv), btns: $$('#approvals .card-buttons button', drv), log: $('#log', drv), cur: $('#cur-drive'), risks: $$('.card-risk', drv) };
  function drive(t) {
    const CH = +drv.dataset.ch;
    DR.log.scrollTop = DR.log.scrollHeight;
    const p = out3(P(t, T.drive + 0.1, T.drive + 0.34)); DR.card.style.opacity = p; DR.card.style.transform = `translateY(${(1 - p) * -26}px)`;
    camY(drv, clamp(yIn(drv, DR.card).bottom + 10 - CH, 0, 1e4));
    const c = DR.btns.map(center), b = (n) => T.drive + n * BEAT;
    cursorTo(DR.cur, t, [[b(0.4), 930, 1240], [b(1), c[2][0], c[2][1]], [b(1.6), c[2][0], c[2][1]], [b(2), c[1][0], c[1][1]], [b(2.6), c[1][0], c[1][1]], [b(3), c[0][0], c[0][1]], [b(3.6), c[0][0], c[0][1]], [b(4.2), c[0][0], c[0][1]]]);
    press(DR.btns[0], t, b(3.62));
  }
  // ------------------------------------------------------------ 03 · « Or unleash it. » : l'aura du mode Auto, le compte à rebours
  const act = $('#w-auto'), aui = $('.vo-ui', act);
  function auto(t) {
    aui.classList.add('automatic-on', 'running');
    setMission(act, 2);
    const tk = $('#thinking-label', act); if (tk) tk.textContent = W('Thinking', 'Réflexion');
    const roe = $('#roe', act); roe.dataset.level = '3'; $('#roe-label', act).textContent = W('Automatic', 'Automatique');
    const left = 120 - Math.floor(Math.max(0, t - T.unleash - 0.3));
    const badge = $('#automatic-badge', act); badge.hidden = false; badge.textContent = `Auto ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const rep = $('#log .report', act); if (rep) rep.style.display = 'none';
    const log = $('#log', act); log.scrollTop = log.scrollHeight;
  }
  // ------------------------------------------------------------ 04 · le rapport de constats s'écrit
  const rw = $('#w-rep'), rui = $('.vo-ui', rw), rlog = $('#log', rw), rep = $('#log .report', rw);
  const segs = $$('.report-seg', rw), items = $$('.report-item', rw), repParts = rep ? [$('.report-head', rep), $('.report-summary', rep)] : [];
  function report(t) {
    rui.classList.add('automatic-on');
    const roe = $('#roe', rw); roe.dataset.level = '3'; $('#roe-label', rw).textContent = W('Automatic', 'Automatique');
    const badge = $('#automatic-badge', rw); badge.hidden = false; badge.textContent = 'Auto 1:56';
    const a = T.report + 0.1;
    repParts.forEach((p) => { if (p) p.style.opacity = P(t, a, a + 0.2); });
    segs.forEach((s, i) => { s.style.transformOrigin = '0 50%'; s.style.transform = `scaleX(${out3(P(t, a + 0.1 + i * 0.08, a + 0.4 + i * 0.08))})`; });
    items.forEach((it, i) => { const p = P(t, a + 0.3 + i * BEAT * 0.6, a + 0.55 + i * BEAT * 0.6); it.style.opacity = p; it.style.transform = `translateY(${(1 - out3(p)) * 16}px)`; });
    rlog.scrollTop = rlog.scrollHeight;
    camY(rw, clamp(yIn(rw, rlog).bottom + 6 - (+rw.dataset.ch), 0, 1e4));
  }

  // ------------------------------------------------------------ 05 · l'araignée étudie, puis l'indice tiré du terminal
  const term = $('#w-term'), lrn = $('#w-learn');
  const tl = $$('.ln', term), hl = $('.ln.hl', term), lrows = $$('#log > *', lrn);
  function hint(t) {
    const h0 = T.hint;
    tl.forEach((l, i) => { l.style.visibility = t >= h0 + (i - 10) * 0.07 ? 'visible' : 'hidden'; });
    const s0 = h0 + BEAT * 1.5;
    hl.style.background = t >= h0 + 0.6 ? `rgba(229,19,43,${0.16 + 0.4 * (1 - P(t, h0 + 0.6, h0 + 1.1))})` : '';
    hl.style.boxShadow = t >= s0 ? 'inset 4px 0 0 #E5132B' : '';
    lrows.forEach((r) => show(r, true));
    const log = $('#log', lrn); log.scrollTop = 0;
    const last = lrows[lrows.length - 1]; arrive(last, t, h0 + 0.5);
    const strong = $('#log strong', lrn);
    if (strong) {
      const p = out3(P(t, s0, s0 + 0.45));
      strong.style.color = t >= s0 ? '#ffffff' : '';
      strong.style.backgroundImage = `linear-gradient(90deg, rgba(229,19,43,.75) ${p * 100}%, transparent ${p * 100}%)`;
      strong.style.borderRadius = '3px'; strong.style.boxDecorationBreak = 'clone'; strong.style.webkitBoxDecorationBreak = 'clone'; strong.style.padding = '0 2px';
    }
    // cadrage du chat : le message de l'élève, puis la réponse de l'agent
    const head = $('.md-h', last);
    camY(lrn, lerp(0, clamp(yIn(lrn, head || last).top - 14, 0, 1e4), t < h0 + 0.5 ? 0 : io(P(t, h0 + 0.5, h0 + 0.9))));
    // le terminal : de la commande « sudo -l » à l'invite
    camY(term, clamp(yIn(term, tl[10]).top - 4, 0, 1e4));
  }
  function end2(t) {
    spiderBuild(endSp, t, T.lock - 0.05, { brain: T.lock + 0.2, cross: T.lock + 0.3 });
    $('#halo2').style.opacity = 0.9 * out3(P(t, T.lock, T.lock + 0.5));
    const star = $('.star svg'); if (star) { const p = P(t, T.lock + BEAT * 1.5 + 0.3, T.lock + BEAT * 1.5 + 0.9); star.style.transform = `rotate(${72 * out3(p)}deg) scale(${1 + 0.35 * Math.sin(p * Math.PI)})`; }
  }

  // ------------------------------------------------------------ horloge virtuelle pour les animations CSS du produit
  const seen = new WeakMap();
  function clockAnims(t) {
    for (const an of document.getAnimations()) {
      if (!seen.has(an)) seen.set(an, t);
      an.pause(); an.currentTime = Math.max(0, (t - seen.get(an)) * 1000 + 600);
    }
  }
  const RUN = { hook, kcb: killchainB, chatb, reveal, mon: monitor, kc: killchain, drive, auto, report, hint, end2 };
  window.render = (t) => {
    for (const s of sceneEls) {
      const on = t >= +s.dataset.in && t < +s.dataset.out;
      if (on && s.style.display !== 'block') { s.style.display = 'block'; $$('[data-scroll-top]', s).forEach((el) => { el.scrollTop = +el.dataset.scrollTop; }); }
      if (!on) s.style.display = 'none';
      if (on && RUN[s.id]) RUN[s.id](t);
    }
    captions(t); fx(t); clockAnims(t);
  };
  window.ready = document.fonts.ready.then(() => true);
})();
