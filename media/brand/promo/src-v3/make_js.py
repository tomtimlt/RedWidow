# Dérive film.js de la V3 à partir de celui de la V2.
import os
H = os.path.dirname(os.path.abspath(__file__))
j = open(os.path.join(H, '..', 'film2', 'film.js')).read()
def rep(a, b):
    global j
    assert a in j, a[:90]
    j = j.replace(a, b, 1)
rep('// RedWidow promo V2 :', '// RedWidow promo V3 :')
rep("  const FLASH = [4.0, 21.0, 34.5], SHAKE = [[2.5, 6], [4.0, 10], [34.5, 10]];",
    "  const D = 2.5; // tout ce qui suit l'ouverture est décalé de D secondes par rapport à la V2\n  const FLASH = [6.5, 23.5, 37.0], SHAKE = [[4.4, 5], [6.5, 10], [37.0, 10]];")
# Ouverture qui respire
a0 = j.index('  function a(t) {')
a1 = j.index('  function b(t)')
j = j[:a0] + '''  function a(t) {
    const w = $('#w-hook'), p = out3(P(t, 0.15, 1.0));
    w.style.opacity = p; w.style.transform = `translateY(${(1 - p) * 24}px)`;
    const typing = t >= 1.2 && t < 2.8;
    const n = Math.floor(P(t, 1.2, 2.7) * PROMPT.length);
    const caret = Math.floor(t * 2.5) % 2 ? '' : '\\u258d';
    H.input.value = t < 2.8 ? PROMPT.slice(0, n) + (t >= 0.6 ? caret : '') : '';
    show(H.rows[0], t >= 2.8);
    const auto = t >= 3.0;
    H.ui.classList.toggle('automatic-on', auto);
    H.roe.dataset.level = auto ? '3' : '2'; H.roeLabel.textContent = auto ? 'Automatic' : 'Supervised';
    H.badge.hidden = !auto; H.badge.textContent = 'Bypass 2:00';
    H.ui.classList.toggle('running', t >= 3.2 && t < 5.3);
    show(H.rows[1], t >= 3.2); show(H.rows[2], t >= 3.6);
    H.tools.forEach((d, i) => show(d, t >= 3.6 + i * 0.4));
    H.label.textContent = `Tool: ${CMDS[clamp(Math.floor((t - 3.6) / 0.4), 0, 3)]}`;
    H.clock.textContent = `T+00:${String(Math.max(0, Math.floor((t - 3.2) * 5))).padStart(2, '0')}`;
    show(H.rows[3], t >= 5.3);
    void typing;
  }
''' + j[a1:]
# L'indice : plus de flèche, la ligne du terminal et la phrase de l'indice s'allument ensemble
f0 = j.index("    const strong = $('#log strong', learn), path = $('#link-path');")
f1 = j.index("    } else path.style.opacity = 0;\n  }") + len("    } else path.style.opacity = 0;\n  }")
j = j[:f0] + '''    const strong = $('#log strong', learn);
    if (strong) {
      const p = out3(P(t, 25.9, 26.35));
      strong.style.color = t >= 25.9 ? '#ffffff' : '';
      strong.style.backgroundImage = `linear-gradient(90deg, rgba(229,19,43,.55) ${p * 100}%, transparent ${p * 100}%)`;
      strong.style.borderRadius = '3px';
      strong.style.boxDecorationBreak = 'clone';
      strong.style.webkitBoxDecorationBreak = 'clone';
      strong.style.padding = '0 2px';
    }
    // la ligne sudo -l garde un liseré vif pendant que l'indice s'allume
    hl.style.boxShadow = t >= 25.9 ? `inset 4px 0 0 #E5132B, 0 0 0 1px rgba(229,19,43,${0.6 * (1 - P(t, 26.4, 27.4)) + 0.25})` : '';
  }''' + j[f1:]
# Les scènes après l'ouverture reprennent les temps de la V2
rep("  const RUN = { a, b, c, d, e, f2, f3, g1, h2 };",
    "  const sh = (fn) => (t) => fn(t - D);\n  const RUN = { a, b: sh(b), c: sh(c), d: sh(d), e: sh(e), f2: sh(f2), f3: sh(f3), g1: sh(g1), h2: sh(h2) };")
open(os.path.join(H, 'film.js'), 'w').write(j)
print('ok', len(j))
