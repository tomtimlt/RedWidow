# Bannières RedWidow (README, aperçu social, bandeau, LinkedIn, Apprentissage).
# Usage : python3 gen.py → écrit les pages HTML ; node shoot.cjs les photographie.
# Pré-requis : captures anglaises du lab (cap_en.cjs : lab-chat, lab-graph, lab-monitor, lab-learn-term, lab-learn-chat).
import math, os
here = os.path.dirname(os.path.abspath(__file__)) + '/'
fonts = 'file:///home/user/warband/media/fonts/'
logo = 'file:///home/user/warband/media/logo.svg'
RED = '#E5132B'

css = f'''@font-face{{font-family:Geist;src:url({fonts}geist-latin.woff2) format("woff2");font-weight:100 900}}
@font-face{{font-family:"JetBrains Mono";src:url({fonts}jetbrains-mono-latin.woff2) format("woff2");font-weight:100 900}}
*{{box-sizing:border-box;margin:0}}body{{background:#0e0e10;overflow:hidden;font-family:Geist}}
.stage{{position:relative;overflow:hidden;background:#0e0e10}}
.shot{{position:absolute;transform-origin:0 0}}
.pane{{position:absolute;background:#1f1f1f;border:1px solid #2f3337;border-radius:12px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45)}}
.pane img{{display:block}}
.pane-head{{height:35px;display:flex;align-items:center;background:#181818;border-bottom:1px solid #2b2b2b;font:13px Geist,sans-serif}}
.pane-title{{padding:0 16px;font-weight:600;font-size:12.5px;color:#e7e7e7;display:flex;align-items:center;gap:8px}}
.pane-title i,.tab i.d{{width:8px;height:8px;border-radius:50%;background:{RED};display:inline-block;font-style:normal}}
.tab{{display:flex;align-items:center;gap:8px;height:100%;padding:0 14px;color:#9d9d9d;border-right:1px solid #2b2b2b}}
.tab.on{{color:#fff;background:#1f1f1f;box-shadow:inset 0 1px 0 {RED}}}.tab em{{font-style:normal;margin-left:6px;color:#bbb}}
.copy{{position:absolute;color:#f2f3f5}}
.mark{{display:flex;align-items:center;gap:12px;font:700 var(--m) "JetBrains Mono";letter-spacing:.2em}}.mark b{{color:{RED}}}.mark img{{height:calc(var(--m) * 2.1);width:auto;display:block}}
h1{{font:800 var(--h)/1.02 Geist;letter-spacing:-.035em;text-transform:uppercase;margin-top:var(--g1)}}h1 span{{color:{RED}}}
p{{font:400 var(--b)/1.45 Geist;color:#a3a6ad;margin-top:var(--g2)}}
.facts{{display:flex;gap:8px;margin-top:var(--g3);white-space:nowrap}}
.facts span{{font:500 var(--f) Geist;color:#aab3bc;padding:.34em .9em;border:1px solid #2f3337;border-radius:999px;background:#15181b}}
.facts span.hot{{color:#ff3b4e;border-color:rgba(229,19,43,.6);background:rgba(229,19,43,.08)}}
'''

def tab(t, on=False):
    return f'<span class="tab{" on" if on else ""}"><i class="d"></i>{t}{"<em>×</em>" if on else ""}</span>'

def panel(x, y, w, h, img, title='', tabs=None):
    head = tabs if tabs else f'<span class="pane-title"><i></i>{title}</span>'
    return f'<div class="pane" style="left:{x}px;top:{y}px;width:{w}px"><div class="pane-head">{head}</div><img src="{here}{img}" width="{w}" height="{h}"></div>'

GAP = 24
shot_main = (panel(0, 0, 470, 849, 'lab-chat.png', 'RedWidow: Chat')
    + panel(470 + GAP, 0, 981, 450, 'lab-graph.png', tabs=tab('Cockpit') + tab('Settings') + tab('Kill chain', True))
    + panel(470 + GAP, 485 + GAP, 981, 340, 'lab-monitor.png', tabs=tab('Monitor · kali-1', True)))
shot_learn = (panel(0, 0, 560, 690, 'lab-learn-term.png', 'kali-1')
    + panel(560 + GAP, 0, 470, 690, 'lab-learn-chat.png', 'RedWidow: Chat'))

def facts(items, hot=()):
    return '<div class="facts">' + ''.join(f'<span class="{"hot" if i in hot else ""}">{t}</span>' for i, t in enumerate(items)) + '</div>'

def page(file, W, H, copy_html, copy_vars, shot=None, at=None, extra=''):
    shot_html = ''
    if shot:
        shot_html = f'<div class="shot" style="left:{at[0]}px;top:{at[1]}px;transform:scale({at[2]})">{shot}</div>'
    vars_ = ';'.join(f'--{k}:{v}px' for k, v in copy_vars.items() if k != 'left' and k != 'top')
    open(here + file, 'w').write(f'<!doctype html><meta charset="utf-8"><style>{css}</style><body><div class="stage" style="width:{W}px;height:{H}px">{extra}{shot_html}'
        f'<div class="copy" style="left:{copy_vars["left"]}px;top:{copy_vars["top"]}px;{vars_}">{copy_html}</div></div>')

MARK = f'<div class="mark"><img src="{logo}" alt=""><span><b>RED</b>WIDOW</span></div>'
PILLS = ['Open source', 'Docker Kali', 'Exegol', 'Learning mode']

# 1 — README / dépôt (1280 × 640) : description, trois fenêtres
page('banner-github.html', 1280, 640,
    MARK + '<h1>Weave. Watch.<br><span>Strike. Wrap.</span></h1>'
    '<p>The AI-native pentest workspace for VS Code.<br>Docker Kali and Exegol, terminals, Monitor,<br>kill chain and reports in one place.</p>' + facts(PILLS),
    dict(left=72, top=172, m=17, h=52, b=19, g1=40, g2=18, g3=28, f=14), shot_main, (612, 56, 0.6))

# 2 — LinkedIn (1584 × 396), texte décalé hors de la photo de profil
page('banner-linkedin.html', 1584, 396,
    MARK + '<h1>Weave. Watch.<br><span>Strike. Wrap.</span></h1>'
    '<p>The AI-native pentest workspace for VS Code.<br>Docker Kali and Exegol in one workspace. Open source.</p>' + facts(PILLS[:3]),
    dict(left=440, top=60, m=14, h=40, b=16, g1=22, g2=12, g3=18, f=13), shot_main, (946, 10, 0.425))

# 3 — Apprentissage (1280 × 640)
page('banner-github-learning.html', 1280, 640,
    MARK + '<h1 style="font-size:var(--h)">Stuck on a box?<br>Feed it your course.<br><span>It reads your terminal.</span></h1>'
    '<p>Learning mode · Your course · Your terminal · Hints</p>' + facts(['Never executes'], hot=(0,)),
    dict(left=72, top=160, m=17, h=34, b=19, g1=34, g2=22, g3=28, f=14), shot_learn, (650, 84, 0.54))

# 4 — Bandeau de titre (1280 × 320, photographié en 2x)
def web(cx, cy, W, H):
    n = 16; R = 1400
    rays = ''.join(f'<line x1="{cx}" y1="{cy}" x2="{cx + R * math.cos(a):.1f}" y2="{cy + R * math.sin(a):.1f}"/>' for a in [i * 2 * math.pi / n + 0.1 for i in range(n)])
    rings = []
    for k in range(1, 12):
        r = 34 * k * 1.14 ** k
        pts = [f'{cx + r * (0.93 + 0.07 * math.cos(i * 2.1 + k)) * math.cos(i * 2 * math.pi / n + 0.1):.1f},{cy + r * (0.93 + 0.07 * math.cos(i * 2.1 + k)) * math.sin(i * 2 * math.pi / n + 0.1):.1f}' for i in range(n + 1)]
        rings.append(f'<polyline points="{" ".join(pts)}"/>')
    return f'<svg width="{W}" height="{H}" style="position:absolute;left:0;top:0;fill:none;stroke:rgba(229,19,43,.16);stroke-width:1">{rays}{"".join(rings)}</svg>'
page('banner-github-strip.html', 1280, 320,
    MARK + '<h1 style="white-space:nowrap">Weave. Watch. <span>Strike. Wrap.</span></h1>' + facts(PILLS),
    dict(left=72, top=70, m=17, h=58, b=18, g1=24, g2=0, g3=26, f=14), extra=web(1100, 160, 1280, 320))
print('pages ok')
