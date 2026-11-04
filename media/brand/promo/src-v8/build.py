# RedWidow promo V8 « Weave. Watch. Strike. Wrap. » : la chasse de la veuve noire calquée
# sur le rail de mission du produit (Repérage, Analyse, Action, Rapport).
# Usage : python3 build.py 16x9|9x16 [fr]  → film-<fmt>[-fr].html + timeline.json (commun)
import os, sys, json, math
H = os.path.dirname(os.path.abspath(__file__))
K = '/home/user/warband/media/brand/video-kit/html/'
FMT = sys.argv[1] if len(sys.argv) > 1 else '16x9'
V = FMT == '9x16'
LANG = sys.argv[2] if len(sys.argv) > 2 else 'en'; FR = LANG == 'fr'
import fr as FRM
X = (lambda txt: FRM.cap(txt)) if FR else (lambda txt: txt)
W, HH = (1080, 1920) if V else (1920, 1080)
BPM = 94
def B(n): return round(n * 60 / BPM, 4)  # temps musicaux → secondes
def comp(path):
    s = open(path).read()
    return s[s.index('<!-- component:start -->') + 24:s.index('<!-- component:end -->')]
def win(cid, title, markup, w, h, s, x, y, crop=None):
    cx, cy, cw, ch = crop or (0, 0, w, h)
    Wp, Hp = round(cw * s), round(ch * s)
    return (f'<div class="win" id="{cid}" style="left:{x}px;top:{y}px;width:{Wp}px" data-s="{s}" data-cx="{cx}" data-cy="{cy}" data-cw="{cw}" data-ch="{ch}">'
            f'<div class="tab"><i class="dot"></i>{title}</div>'
            f'<div class="cv" style="width:{Wp}px;height:{Hp}px"><div class="cs" style="width:{w}px;height:{h}px;transform:scale({s}) translate({-cx}px,{-cy}px)">{markup}</div></div></div>')
C = {n: comp(K + n + '.html') for n in ['monitor', 'killchain', 'welcome', 'chat-learning', 'terminal', 'chat-bypass']}
C['chat-agent'] = comp(H + '/snap/chat-agent.html')
C['chat-agent-tall'] = comp(H + '/snap/chat-agent-tall.html')
C['chat-bypass-tall'] = comp(H + '/snap/chat-bypass-tall.html')
if FR: C = {k: FRM.ui(v) for k, v in C.items()}
def L(b, cls, txt, x=None):
    xs = f' data-x="{B(x)}"' if x is not None else ''
    return f'<div class="cl {cls}" data-t="{B(b)}"{xs}>{X(txt)}</div>'
def chapter(n, word, sub, b, extra=''):
    return (f'<div class="chap{extra}" data-t="{B(b)}"><div class="chap-n">{n:02d}</div>'
            f'<div class="chap-t"><div class="chap-w">{X(word)}</div><div class="chap-s">{X(sub)}</div></div></div>')
TL = {k: B(v) for k, v in dict(
    # accroche : la cible, la toile, la veuve qui descend, verrouillage, silence, impact
    h1=0.3, h2=1.3, h3=2.3, thread=3.3, land=4.5, eyes=4.6, lockon=5.0, hush=5.5, reveal=6.0, tag=7.0,
    # 01 WEAVE · Repérage
    ch1=12.0, chat=13.5, type0=13.6, type1=15.0, send=15.1, tools=15.5, msg2=17.2, mon=17.5,
    # 02 WATCH · Analyse
    ch2=20.0, kc=21.5, replay=26.0,
    # 03 STRIKE · Action
    ch3=33.0, drive=34.5, unleash=37.0,
    # 04 WRAP · Rapport
    ch4=41.0, report=42.5,
    # 05 LEARN · Apprentissage
    ch5=47.0, learn=48.5, learnOn=49.3, hint=52.0, notlong=55.0,
    # modèles, récapitulatif, fin
    models=57.0, m1=57.5, m2=59.5, m3=61.5, r1=63.0, r2=64.0, r3=65.0, r4=66.0,
    all=67.5, oss=69.5, free=71.5, lock=73.5, end=81.5).items()}
TL['beat'] = round(60 / BPM, 5)

def web():
    cx, cy, R = W / 2, HH / 2, 1500
    rays = ''.join(f'<line x1="{cx}" y1="{cy}" x2="{cx + R * math.cos(a):.1f}" y2="{cy + R * math.sin(a):.1f}"/>' for a in [i * math.pi / 9 for i in range(18)])
    rings = []
    for k in range(1, 15):
        r = 70 * k * 1.12 ** k / 1.6
        pts = [f'{cx + r * (0.94 + 0.06 * math.cos(i * 2.3)) * math.cos(i * math.pi / 9):.1f},{cy + r * (0.94 + 0.06 * math.cos(i * 2.3)) * math.sin(i * math.pi / 9):.1f}' for i in range(19)]
        rings.append(f'<polyline points="{" ".join(pts)}"/>')
    return f'<svg id="web" width="{W}" height="{HH}" viewBox="0 0 {W} {HH}" style="transform-origin:{cx}px {cy}px">{rays}{"".join(rings)}</svg>'

def hookweb(cx, cy):
    """Toile qui se tisse depuis la cible : rayons puis spires, tracés par pathLength."""
    R = 2300; n = 16
    rays = ''.join(f'<line class="hr" pathLength="1" x1="{cx}" y1="{cy}" x2="{cx + R * math.cos(a):.1f}" y2="{cy + R * math.sin(a):.1f}"/>'
                   for a in [i * 2 * math.pi / n + 0.1 for i in range(n)])
    rings = []
    for k in range(1, 13):
        r = 46 * k * 1.13 ** k
        pts = [f'{cx + r * (0.93 + 0.07 * math.cos(i * 2.1 + k)) * math.cos(i * 2 * math.pi / n + 0.1):.1f},{cy + r * (0.93 + 0.07 * math.cos(i * 2.1 + k)) * math.sin(i * 2 * math.pi / n + 0.1):.1f}' for i in range(n + 1)]
        rings.append(f'<polyline class="hg" pathLength="1" points="{" ".join(pts)}"/>')
    return f'<svg id="hookweb" width="{W}" height="{HH}" viewBox="0 0 {W} {HH}">{rays}{"".join(rings)}</svg>'

# Mise en page par format : (gauche, haut, largeur) des légendes et des fenêtres
if not V:
    capL = dict(left=110, top=360, width=660); capT = dict(left=110, top=150, width=1700)
    chatWin = lambda cid, key: win(cid, 'RedWidow: Chat', C[key.replace('-tall', '')], 980, 640, 1.05, 820, 230)
    monWin = win('w-mon', 'Monitor · kali-1', C['monitor'], 981, 340, 1.75, 101, 330)
    kcWin = win('w-kc', 'Kill chain', C['killchain'], 981, 450, 3.0, 124, 330, (0, 150, 557, 176)); feedPos = (124, 912)
    welWin = win('w-wel', 'RedWidow: Chat', C['welcome'], 470, 690, 3.0, 110, 150, (85, 60, 300, 246)); welCap = dict(left=1080, top=350, width=800)
    termWin = win('w-term', 'kali-1', C['terminal'], 560, 690, 1.1, 70, 150); learnWin = win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, 1.1, 736, 150)
    hintCap = dict(left=1285, top=350, width=620) if FR else dict(left=1330, top=350, width=560)
    centerTop = dict(models=330, end1=200, recap=330)
    hookCap = dict(left=110, top=300, width=1000); TGT = (1390, 650); SPW, SPH = 310, 389
else:
    capL = dict(left=70, top=250, width=940); capT = dict(left=70, top=250, width=940)
    CROP = {'w-chat': (0, 289, 470, 560), 'w-auto': (0, 0, 470, 560), 'w-rep': (0, 0, 470, 560)}
    chatWin = lambda cid, key: win(cid, 'RedWidow: Chat', C[key], 470, 849, 2.0, 70, 640, CROP[cid])
    monWin = win('w-mon', 'Monitor · kali-1', C['monitor'], 981, 340, 1.75, 50, 640, (0, 40, 560, 300))
    kcWin = win('w-kc', 'Kill chain', C['killchain'], 981, 450, 2.4, 52, 640, (0, 130, 406, 230)); feedPos = (60, 1260)
    welWin = win('w-wel', 'RedWidow: Chat', C['welcome'], 470, 690, 3.0, 90, 700, (85, 60, 300, 246)); welCap = dict(left=70, top=250, width=940)
    termWin = win('w-term', 'kali-1', C['terminal'], 560, 690, 1.75, 50, 560, (0, 160, 560, 270))
    learnWin = win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, 2.1, 46, 1080, (0, 300, 470, 300))
    hintCap = dict(left=70, top=215, width=940); centerTop = dict(models=700, end1=560, recap=760)
    hookCap = dict(left=70, top=250, width=940); TGT = (540, 1330); SPW, SPH = 300, 377
def cap(d, inner, cls='cap'):
    return f'<div class="{cls}" style="left:{d["left"]}px;top:{d["top"]}px;width:{d["width"]}px">{inner}</div>'
inl = '' if V else ' inl'
tx, ty = TGT; spTop = ty - 150 - SPH

S = []
S.append(('hook', 0, TL['reveal'], hookweb(tx, ty) +
    f'''<div id="tglow" style="left:{tx}px;top:{ty}px"></div>
<div id="thread" style="left:{tx - 1}px"></div>
<div id="hook-sp" class="spslot" style="left:{tx - SPW / 2}px;top:{spTop}px;width:{SPW}px;height:{SPH}px" data-top="{spTop}"><i class="eyeglow"></i></div>
<div id="target" style="left:{tx}px;top:{ty}px"><i class="t-ring"></i><i class="t-dot"></i>
<i class="br tl"></i><i class="br tr"></i><i class="br bl"></i><i class="br bm"></i>
<div class="t-lab"><span class="t-st">{X('target')}</span> · 10.10.10.14</div></div>''' + cap(hookCap,
    L(0.0, 'mono kick', 'For pentesters · inside VS Code') + L(0.3, 'mid', 'Your target') + L(1.3, 'mid', 'is already') + L(2.3, 'big g', 'in the web.'))))
S.append(('reveal', TL['reveal'], TL['ch1'], f'''<div id="halo" class="halo"></div>
<div class="lock"><div id="lock-slot" class="spslot"></div>
<div class="lock-txt"><div class="wm slam" data-t="{TL['reveal']}"><b>RED</b>WIDOW</div>
<div class="mono scr tagline" data-t="{TL['tag']}" data-d="0.8">{X('AI-native pentest workspace · in VS Code')}</div></div></div>'''))
S.append(('c1', TL['ch1'], TL['chat'], chapter(1, 'Weave.', 'Recon', 12.0)))
S.append(('recon', TL['chat'], TL['mon'], chatWin('w-chat', 'chat-agent-tall') + cap(capL,
    L(14.0, 'mid', 'Give it') + L(14.2, 'mid g', 'a target.') +
    f'''<div class="cg stack" data-t="{TL['tools']}">{L(15.6, 'mono', 'It runs the scans')}{L(15.6, 'tools', '<span>nmap</span><span>whatweb</span><span>ffuf</span><span>sqlmap</span>')}</div>''')))
S.append(('mon', TL['mon'], TL['ch2'], cap(capT, L(17.5, 'mid' + inl, 'Live,') + L(17.8, 'mid g' + inl, 'in your Kali.')) + monWin))
S.append(('c2', TL['ch2'], TL['kc'], chapter(2, 'Watch.', 'Analysis', 20.0)))
S.append(('kc', TL['kc'], TL['ch3'], cap(capT,
    f'''<div class="cg" data-t="{TL['kc']}" data-x="{TL['replay']}">{L(21.5, 'mid' + inl, 'It maps')}{L(21.7, 'mid g' + inl, 'the kill chain.')}</div>
<div class="cg" data-t="{TL['replay']}">{L(26.0, 'mid' + inl, 'Scan')}{L(26.2, 'mid g' + inl, 'to root.')}</div>''') + kcWin +
    f'<div id="kc-feed" class="feed" style="left:{feedPos[0]}px;top:{feedPos[1]}px"></div><div id="kc-step" class="feed step" style="left:{feedPos[0]}px;top:{feedPos[1]}px"></div>'))
S.append(('c3', TL['ch3'], TL['drive'], chapter(3, 'Strike.', 'Action', 33.0)))
S.append(('action', TL['drive'], TL['ch4'], chatWin('w-auto', 'chat-bypass-tall') + cap(capL,
    f'''<div class="cg" data-t="{TL['drive']}" data-x="{TL['unleash']}">{L(34.5, 'big', 'Drive it.')}{L(34.8, 'mono', 'Step by step · ROE Supervised')}</div>
<div class="cg" data-t="{TL['unleash']}">{L(37.0, 'mid', 'Or')}{L(37.15, 'big g', 'unleash')}{L(37.3, 'big g', 'it.')}{L(37.6, 'mono', 'Full auto · ROE Automatic')}</div>''')))
S.append(('c4', TL['ch4'], TL['report'], chapter(4, 'Wrap.', 'Report', 41.0)))
S.append(('report', TL['report'], TL['ch5'], chatWin('w-rep', 'chat-bypass-tall') + cap(capL,
    L(42.6, 'mid', 'It writes') + L(42.8, 'mid g', 'the report.') + L(43.6, 'mono', 'Findings · severities · Markdown draft'))))
S.append(('c5', TL['ch5'], TL['learn'], chapter(5, 'Learn.', 'Learning mode', 47.0, ' bonus')))
S.append(('learn', TL['learn'], TL['hint'], welWin + cap(welCap,
    L(48.6, 'mono', 'Learning mode') + L(49.0, 'mid', 'Stuck on') + L(49.2, 'mid', 'a box?') + L(50.3, 'mid v', 'It studies') + L(50.5, 'mid v', 'with you.'))))
S.append(('hint', TL['hint'], TL['models'], termWin + learnWin + cap(hintCap, cls='cap hintcap', inner=
    f'''<div class="cg" data-t="{TL['hint']}" data-x="{TL['notlong']}">{L(52.2, 'mid', 'It reads')}{L(52.4, 'mid', 'your terminal.')}{L(53.2, 'mid g', 'It points')}{L(53.4, 'mid g', 'to the flaw.')}</div>
<div class="cg" data-t="{TL['notlong']}">{L(55.0, 'mid', 'Stuck?')}{L(55.3, 'mid g', 'Not for long.')}</div>''')))
S.append(('models', TL['models'], TL['r1'], f'''<div class="cap center" style="top:{centerTop['models']}px">{L(57.0, 'mono', 'Bring any model')}
<div class="swap" style="height:260px">{L(57.5, 'huge one', 'Claude.', 59.5)}{L(59.5, 'huge one', 'GPT.', 61.5)}{L(61.5, 'huge one g', 'Ollama.')}</div></div>'''))
REC = [('r1', 'r2', 'Weave.', 'Recon', 1), ('r2', 'r3', 'Watch.', 'Analysis', 2), ('r3', 'r4', 'Strike.', 'Action', 3), ('r4', 'all', 'Wrap.', 'Report', 4)]
S.append(('recap', TL['r1'], TL['all'], f'''<div class="cap center recap" style="top:{centerTop['recap']}px">''' + ''.join(
    f'<div class="rcw{" ink" if n == 3 else ""}" data-t="{TL[a]}" data-x="{TL[b]}"><span class="rcn">{n:02d} · {X(sub)}</span><b>{X(w)}</b></div>' for a, b, w, sub, n in REC) + '</div>'))
S.append(('end1', TL['all'], TL['lock'], f'''<div class="cap center" style="top:{centerTop['end1']}px">{L(67.5, 'outline', 'All of it.')}{L(69.5, 'outline', 'Open source.')}{L(71.5, 'giant g', 'Free.')}</div>'''))
S.append(('end2', TL['lock'], TL['end'] + 1.2, f'''<div id="halo2" class="halo"></div>
<div class="lock"><div id="end-slot" class="spslot small"></div>
<div class="lock-txt"><div class="wm slam" data-t="{TL['lock']}"><b>RED</b>WIDOW</div><div class="mono scr url" data-t="{B(75.0)}" data-d="0.8">github.com/tomtimlt/redwidow</div></div></div>
<div class="legal cl" data-t="{B(75.5)}">{X('For authorized testing only.')}</div>'''))
rail = '<div id="rail" class="rail">' + ''.join(f'<div class="rail-step" data-i="{i}"><i>{i + 1:02d}</i>{X(w)}</div>' for i, w in enumerate(['Recon', 'Analysis', 'Action', 'Report'])) + '</div>'
body = ''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i, a, b, h in S)
html = f'''<!doctype html><html lang="{LANG}"><head><meta charset="utf-8"><title>RedWidow promo V8 {FMT} {LANG}</title>
<link rel="stylesheet" href="file://{K}css/redwidow-ui.css">
<link rel="stylesheet" href="file://{H}/film.css">
{'<link rel="stylesheet" href="file://' + H + '/film-9x16.css">' if V else ''}
<script src="file:///home/user/warband/media/spider.js"></script>
<script>window.TL = {json.dumps(TL)}; window.FMT = "{FMT}"; window.LANG = "{LANG}";</script>
</head><body class="fmt-{FMT}"><div id="stage">{web()}{body}{rail}<div id="wipe"></div></div><div id="vig"></div><div id="grain"></div><div id="flash"></div><script src="file://{H}/film.js"></script></body></html>'''
open(f'{H}/film-{FMT}{"-fr" if FR else ""}.html', 'w').write(html)
json.dump(TL, open(H + '/timeline.json', 'w'), indent=1)
print(FMT, LANG, len(html), 'end', TL['end'])
