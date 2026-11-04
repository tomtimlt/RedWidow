# V6 : la V5 repassée dans la palette rouge Widow (noir, cramoisi, acier).
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
MAP = [
    # variables principales
    (':root{--bg:#0b0612;--g:#8CFF3F;--v:#9B5CFF;--v2:#c9b4ff;--ink:#f3eeff;--mute:#b9a9e0}',
     ':root{--bg:#0b0b0d;--g:#E5132B;--v:#8b8e97;--v2:#d2d4da;--ink:#f2f3f5;--mute:#a3a6ad}'),
    ('radial-gradient(1200px 800px at 50% 55%,#160a26 0%,var(--bg) 70%)', 'radial-gradient(1200px 800px at 50% 55%,#1c0a0e 0%,var(--bg) 70%)'),
    ('stroke:rgba(155,92,255,.16)', 'stroke:rgba(229,19,43,.11)'),
    ('#flash{position:absolute;inset:0;background:var(--v);', '#flash{position:absolute;inset:0;background:var(--g);'),
    ('.cl.tl{display:table;font:500 58px/1.55 "Warband JetBrains Mono";color:#e9e2ff;', '.cl.tl{display:table;font:500 58px/1.55 "Warband JetBrains Mono";color:#e6e7ea;'),
    ('.cl.tools span{font:700 30px/1 "Warband JetBrains Mono";color:var(--g);border:2px solid rgba(140,255,63,.6);', '.cl.tools span{font:700 30px/1 "Warband JetBrains Mono";color:#ff3b4e;border:2px solid rgba(229,19,43,.7);'),
    ('.chap-n{font:800 440px/1 "Warband Geist";letter-spacing:-0.05em;color:transparent;-webkit-text-stroke:4px var(--v)}', '.chap-n{font:800 440px/1 "Warband Geist";letter-spacing:-0.05em;color:transparent;-webkit-text-stroke:4px var(--v2)}'),
    ('.win{position:absolute;background:#140b20;border:1px solid #3b2a5c;border-radius:12px;overflow:hidden;box-shadow:0 30px 90px rgba(6,0,20,.75),0 0 60px rgba(155,92,255,.12);z-index:2}',
     '.win{position:absolute;background:#1f1f1f;border:1px solid #2f3337;border-radius:12px;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.7),0 0 60px rgba(229,19,43,.10);z-index:2}'),
    ('background:#100819;border-bottom:1px solid #2c1f45;font:500 14px "Warband Geist";color:#d8cff0}', 'background:#181818;border-bottom:1px solid #2b2b2b;font:500 14px "Warband Geist";color:#c8c8c8}'),
    ('.rail-step{font:700 22px/1 "Warband JetBrains Mono";letter-spacing:.14em;text-transform:uppercase;color:#7d6aa8;border:1.5px solid #3b2a5c;border-radius:999px;padding:12px 22px;display:flex;gap:12px;align-items:center;background:rgba(20,11,32,.85)}',
     '.rail-step{font:700 22px/1 "Warband JetBrains Mono";letter-spacing:.14em;text-transform:uppercase;color:#6f737b;border:1.5px solid #34363b;border-radius:999px;padding:12px 22px;display:flex;gap:12px;align-items:center;background:rgba(18,18,20,.85)}'),
    ('.rail-step i{font-style:normal;color:#5c4a85}', '.rail-step i{font-style:normal;color:#55585f}'),
    ('.rail-step.done{color:var(--v2);border-color:rgba(155,92,255,.7);background:rgba(155,92,255,.16)}', '.rail-step.done{color:var(--v2);border-color:rgba(210,212,218,.45);background:rgba(210,212,218,.08)}'),
    ('.rail-step.cur{color:#0b0612;background:var(--g);border-color:var(--g);box-shadow:0 0 24px rgba(140,255,63,.45)}', '.rail-step.cur{color:#ffffff;background:var(--g);border-color:var(--g);box-shadow:0 0 24px rgba(229,19,43,.45)}'),
    ('.rail-step.cur i{color:#0b0612}', '.rail-step.cur i{color:#ffffff}'),
    ('.hero-spider{--rw-red:#8CFF3F;--rw-steel-hi:#bdb6cc;--rw-steel:#5e5670;--rw-ink:#120a1c}', '.hero-spider{--rw-red:#E5132B;--rw-steel-hi:#B0B1B8;--rw-steel:#606168;--rw-ink:#131417}'),
    ('background:radial-gradient(circle,rgba(155,92,255,.42) 0%,rgba(155,92,255,.12) 35%,rgba(155,92,255,0) 68%)', 'background:radial-gradient(circle,rgba(229,19,43,.30) 0%,rgba(229,19,43,.09) 35%,rgba(229,19,43,0) 68%)'),
    ('.legal{position:absolute;left:0;right:0;bottom:44px;text-align:center;font:500 18px "Warband Geist";color:#6f6488}', '.legal{position:absolute;left:0;right:0;bottom:44px;text-align:center;font:500 18px "Warband Geist";color:#6f737b}'),
    ('.feed{position:absolute;z-index:5;font:500 26px/1.55 "Warband JetBrains Mono";color:#e2dbf5}', '.feed{position:absolute;z-index:5;font:500 26px/1.55 "Warband JetBrains Mono";color:#cfd2d8}'),
    ('.feed-row b{display:inline-block;font-weight:700;color:#0b0612;', '.feed-row b{display:inline-block;font-weight:700;color:#ffffff;'),
    ('.feed-row i{font-style:normal;color:#8d7fb0}', '.feed-row i{font-style:normal;color:#7d828b}'),
    ('.feed-row.bad span{color:#9d92b8;', '.feed-row.bad span{color:#a3a6ad;'),
    ('.feed.step{color:var(--g);', '.feed.step{color:#ff3b4e;'),
    ('.tab .dot{width:8px;height:8px;border-radius:50%;background:var(--g);display:inline-block;box-shadow:0 0 8px var(--g)}', '.tab .dot{width:8px;height:8px;border-radius:50%;background:var(--g);display:inline-block}'),
]
c = open('film.css').read()
for a, b in MAP:
    assert a in c, a[:70]
    c = c.replace(a, b, 1)
c = c.replace('/* RedWidow promo V5 « Toxic » : violet profond et vert toxique. */', '/* RedWidow promo V6 : la V5 dans la palette rouge Widow (noir, cramoisi, acier). */')
open('film.css', 'w').write(c)
j = open('film.js').read()
JM = [
    ("// RedWidow promo V5 « Toxic »", "// RedWidow promo V6 (palette Widow)"),
    ("// Toute l'interface en palette « Toxique » (vert) pour la pub\n  $$('.vo-ui').forEach((u) => u.setAttribute('data-palette', 'toxic'));", "// Interface dans la palette par défaut, Widow (cramoisi)\n  $$('.vo-ui').forEach((u) => u.setAttribute('data-palette', 'widow'));"),
    ("st.style.filter = g > 0 ? `drop-shadow(${8 * g}px 0 0 rgba(155,92,255,.85)) drop-shadow(${-8 * g}px 0 0 rgba(140,255,63,.75))` : 'none';", "st.style.filter = g > 0 ? `drop-shadow(${8 * g}px 0 0 rgba(229,19,43,.85)) drop-shadow(${-8 * g}px 0 0 rgba(235,238,242,.55))` : 'none';"),
    ("l.style.color = t >= T.strike + i * 0.08 + 0.15 ? '#6f6488' : '';", "l.style.color = t >= T.strike + i * 0.08 + 0.15 ? '#5d6067' : '';"),
    ("hl.style.background = t >= h0 + 0.9 ? `rgba(140,255,63,${0.12 + 0.4 * (1 - fl)})` : '';", "hl.style.background = t >= h0 + 0.9 ? `rgba(229,19,43,${0.14 + 0.45 * (1 - fl)})` : '';"),
    ("strong.style.color = t >= s0 ? '#0b0612' : '';", "strong.style.color = t >= s0 ? '#ffffff' : '';"),
    ("strong.style.backgroundImage = `linear-gradient(90deg, rgba(140,255,63,.9) ${p * 100}%, transparent ${p * 100}%)`;", "strong.style.backgroundImage = `linear-gradient(90deg, rgba(229,19,43,.75) ${p * 100}%, transparent ${p * 100}%)`;"),
    ("hl.style.boxShadow = t >= s0 ? `inset 4px 0 0 #8CFF3F, 0 0 0 1px rgba(140,255,63,${0.6 * (1 - P(t, s0 + 0.5, s0 + 1.5)) + 0.25})` : '';", "hl.style.boxShadow = t >= s0 ? `inset 4px 0 0 #E5132B, 0 0 0 1px rgba(229,19,43,${0.6 * (1 - P(t, s0 + 0.5, s0 + 1.5)) + 0.25})` : '';"),
]
for a, b in JM:
    assert a in j, a[:70]
    j = j.replace(a, b, 1)
open('film.js', 'w').write(j)
s = open('build.py').read()
s = s.replace('# RedWidow promo V5 « Toxic » : violet et vert toxique', '# RedWidow promo V6 : la V5 en palette rouge Widow').replace('<title>RedWidow promo V5</title>', '<title>RedWidow promo V6</title>')
open('build.py', 'w').write(s)
print('ok')
