# V9 : corrections de la V8 (format 4:5 français d'abord) demandées par le propriétaire.
# 1. interligne de « TOUT ÇA. / OPEN SOURCE. » ; 2. kill chain lisible et racine allumée ;
# 3. plan logo raccourci (une mesure de moins) ; 4. badge « Auto » ; 5. chapitre 05 au rail et au récap.
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
def rep(text, a, b):
    assert a in text, a[:90]
    return text.replace(a, b, 1)

s = open('build.py').read()
s = rep(s, "# RedWidow promo V8 « Weave. Watch. Strike. Wrap. »", "# RedWidow promo V9 (corrections de la V8) « Weave. Watch. Strike. Wrap. »")
# 3 — une mesure (4 temps) de moins entre la révélation et 01 TISSE
s = rep(s, "def B(n): return round(n * 60 / BPM, 4)  # temps musicaux → secondes",
        "CUT = 4  # V9 : une mesure retirée entre la révélation et le chapitre 1 (même coupe dans la musique)\n"
        "def B(n): return round((n - (CUT if n >= 12 else 0)) * 60 / BPM, 4)  # temps musicaux → secondes")
s = rep(s, 'data-t="{TL[\'tag\']}" data-d="0.8"', 'data-t="{TL[\'tag\']}" data-d="0.45"')
# 5 — récapitulatif : APPRENDS après EMBALLE ; « TOUT ÇA. » un temps plus tard
s = rep(s, "r4=66.0,\n    all=67.5,", "r4=66.0, r5=67.0,\n    all=68.5,")
s = rep(s, "('r4', 'all', 'Wrap.', 'Report', 4)]", "('r4', 'r5', 'Wrap.', 'Report', 4), ('r5', 'all', 'Learn.', 'Learning', 5)]")
s = rep(s, "{L(67.5, 'outline', 'All of it.')}", "{L(68.5, 'outline', 'All of it.')}")
s = rep(s, "enumerate(['Recon', 'Analysis', 'Action', 'Report'])", "enumerate(['Recon', 'Analysis', 'Action', 'Report', 'Learning'])")
s = rep(s, "<title>RedWidow promo V8 {FMT} {LANG}</title>", "<title>RedWidow promo V9 {FMT} {LANG}</title>")
# 2 — 4:5 : kill chain sans recadrage, graphe redisposé en colonnes par film.js
s = rep(s, "    kcWin = win('w-kc', 'Kill chain', C['killchain'], 981, 450, 2.4, 52, 400, (0, 130, 406, 230)); feedPos = (60, 1010)",
        "    kcWin = win('w-kc', 'Kill chain', C['killchain'], 974, 880, 1.0, 53, 236); feedPos = (60, 1166)")
open('build.py', 'w').write(s)

f = open('fr.py').read()
f = rep(f, "'Weave.': 'Tisse.',", "'Learning': 'Apprentissage', 'Weave.': 'Tisse.',")
open('fr.py', 'w').write(f)

j = open('film.js').read()
j = rep(j, "// RedWidow promo V8", "// RedWidow promo V9 (corrections de la V8)")
# 4 — badge
j = rep(j, "badge.textContent = 'Bypass 2:00';", "badge.textContent = 'Auto 2:00';")
j = rep(j, "badge.textContent = 'Bypass 1:59';", "badge.textContent = 'Auto 1:59';")
# 5 — rail à cinq étapes, actif jusqu'aux modèles
j = rep(j, "const rail = $('#rail'), chs = [T.ch1, T.ch2, T.ch3, T.ch4];\n    const inRail = t >= T.ch1 + 0.6 && t < T.ch5;",
        "const rail = $('#rail'), chs = [T.ch1, T.ch2, T.ch3, T.ch4, T.ch5];\n    const inRail = t >= T.ch1 + 0.6 && t < T.models;")
j = rep(j, "const CUTS = [T.reveal, T.ch1, T.ch2, T.ch3, T.ch4, T.ch5, T.models, T.r1, T.r2, T.r3, T.r4, T.all, T.lock];",
        "const CUTS = [T.reveal, T.ch1, T.ch2, T.ch3, T.ch4, T.ch5, T.models, T.r1, T.r2, T.r3, T.r4, T.r5, T.all, T.lock];")
# 2 — kill chain : en 4:5, graphe redisposé en colonnes, sans caméra ; fin du rejeu : racine allumée
j = rep(j, "  function killchain(t) {\n    const cam = camAt(t);\n    cs.style.transform = `scale(${cam.s}) translate(${-cam.cx}px,${-cam.cy}px)`;",
r"""  const F45 = window.FMT === '4x5';
  if (F45) {
    // Disposition en colonnes pour le format 4:5 : libellés d'environ 28 px, rien de coupé.
    const K = 2.0, NW = 214, X1 = 14, X2 = 258, XC = 136, R = [6, 112, 218, 324];
    const POS = [[XC, R[0]], [X1, R[1]], [X2, R[1]], [X1, R[2]], [X2, R[2]], [X1, R[3]], [X2, R[3]]];
    const canvas = $('.kc-canvas', kc); canvas.style.transform = `translate(1px, 6px) scale(${K})`;
    nodes.forEach((n, i) => { n.style.left = `${POS[i][0]}px`; n.style.top = `${POS[i][1]}px`; n.style.width = `${NW}px`; });
    const c = (i) => [POS[i][0] + NW / 2, POS[i][1] + 26];
    const svg = $('.kc-edges', kc); svg.setAttribute('width', '500'); svg.setAttribute('height', '480');
    const d = (a, b) => {
      const [x1, y1] = c(a), [x2, y2] = c(b);
      if (Math.abs(y1 - y2) < 1) return `M${x1 + 26} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2 - 26} ${y2}`;
      const ya = y1 + 26, yb = y2 - 26, ym = (ya + yb) / 2;
      return `M${x1} ${ya} C${x1} ${ym} ${x2} ${ym} ${x2} ${yb}`;
    };
    edges.forEach((e, i) => e.setAttribute('d', d(...EDGE_NODES[i])));
    $$('.kc-edge-hit', kc).forEach((e, i) => e.setAttribute('d', d(...EDGE_NODES[i])));
    cs.style.transform = 'none';
  }
  const ROOT = 6, ROOT_EDGE = EDGE_NODES.findIndex(([u, v]) => u === 5 && v === ROOT);
  const setDone = (n, on) => {
    if (!n.dataset.state) n.dataset.state = [...n.classList].find((k) => k.startsWith('is-') && k !== 'is-visited' && k !== 'is-replay') || '';
    const b = $('.kc-node-badge', n);
    if (b && b.dataset.text === undefined) { b.dataset.text = b.textContent; b.dataset.state = [...b.classList].find((k) => k.startsWith('is-')) || ''; }
    n.classList.toggle(n.dataset.state, !on); n.classList.toggle('is-complete', on || n.dataset.state === 'is-complete');
    if (b) { b.classList.toggle(b.dataset.state, !on); b.classList.toggle('is-complete', on || b.dataset.state === 'is-complete'); b.textContent = on ? '✓' : b.dataset.text; }
  };
  function killchain(t) {
    if (!F45) { const cam = camAt(t); cs.style.transform = `scale(${cam.s}) translate(${-cam.cx}px,${-cam.cy}px)`; }""")
j = rep(j, "e.style.clipPath = `inset(-20px ${(1 - p) * 100}% -20px -20px)`; });",
        "e.style.clipPath = F45 ? `inset(-20px -20px ${(1 - p) * 100}% -20px)` : `inset(-20px ${(1 - p) * 100}% -20px -20px)`; });")
j = rep(j, "      r.style.display = i < shown && age < 3 ? '' : 'none';", "      r.style.display = i < shown && age < (F45 ? 2 : 3) ? '' : 'none';")
j = rep(j, "    edges.forEach((e, i) => { const [u, v] = EDGE_NODES[i]; e.classList.toggle('is-lit', isPath[i] && visited.has(u) && visited.has(v)); });",
"""    // Fin du rejeu : la racine s'allume, avec son lien, comme les autres nœuds validés
    const done = replaying && step >= REPLAY.length;
    if (done) { visited.add(ROOT); nodes[ROOT].classList.add('is-visited', 'is-replay'); nodes[REPLAY[REPLAY.length - 1]].classList.remove('is-replay'); }
    nodes.forEach((n, i) => setDone(n, (replaying && visited.has(i) && i !== 3) || (done && i === ROOT)));
    edges.forEach((e, i) => { const [u, v] = EDGE_NODES[i]; e.classList.toggle('is-lit', (isPath[i] || (done && i === ROOT_EDGE)) && visited.has(u) && visited.has(v)); e.classList.toggle('is-path', isPath[i] || (done && i === ROOT_EDGE)); });""")
j = rep(j, "stepLine.textContent = step >= REPLAY.length ? W('Replay · path replayed', 'Rejouer · chemin rejoué') :",
        "stepLine.textContent = step >= REPLAY.length ? `${W('Replay · path replayed', 'Rejouer · chemin rejoué')} · ${$('.kc-node-label', nodes[ROOT]).textContent}` :")
open('film.js', 'w').write(j)

c = open('film-4x5.css').read()
c += """/* V9 */
.cl.outline{line-height:1.2}
#w-kc .cs > *{width:974px !important;height:880px !important}
#w-kc .kc-node-label{font-size:14px}
#w-kc .kc-node-meta{font-size:11px}
#w-kc .kc-legend,#w-kc .kc-legend-toggle{display:none !important}
.rail{gap:8px}.rail-step{font-size:17px;padding:10px 13px;gap:7px}
"""
open('film-4x5.css', 'w').write(c)
print('ok')
