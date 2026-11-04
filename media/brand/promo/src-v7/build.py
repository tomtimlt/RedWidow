# RedWidow promo V7 : la V6 ralentie (94 BPM) en deux formats, 16:9 et 9:16.
# Usage : python3 build.py 16x9|9x16  → film-16x9.html / film-9x16.html + timeline.json
import os, sys, json, math
H = os.path.dirname(os.path.abspath(__file__))
K = '/home/user/warband/media/brand/video-kit/html/'
FMT = sys.argv[1] if len(sys.argv) > 1 else '16x9'
V = FMT == '9x16'
W, HH = (1080, 1920) if V else (1920, 1080)
BPM = 94
# +1 temps avant la révélation, +3 temps après « Rejouer » pour atteindre la racine avant le chapitre 3
def B(n): return round((n + (1 if n >= 6 else 0) + (3 if n >= 29 else 0)) * 60 / BPM, 4)
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
def L(b, cls, txt, x=None):
    xs = f' data-x="{B(x)}"' if x is not None else ''
    return f'<div class="cl {cls}" data-t="{B(b)}"{xs}>{txt}</div>'
def chapter(n, word, b, extra=''):
    return f'<div class="chap{extra}" data-t="{B(b)}"><div class="chap-n">{n:02d}</div><div class="chap-w">{word}</div></div>'
TL = {k: B(v) for k, v in dict(
    p1=0.5, p2=2.0, p3=3.5, p4=5.0, strike=6.5, reveal=8.0, tag=9.0,
    ch1=13.0, chat=14.5, type0=14.6, type1=16.0, send=16.1, tools=16.5, msg2=18.2, mon=18.5,
    ch2=21.0, kc=22.5, replay=27.0, ch3=31.0, drive=32.5, unleash=35.0, ch4=39.0, report=40.5,
    ch5=45.0, learn=46.5, learnOn=47.3, hint=50.0, notlong=53.0,
    models=55.0, m1=55.5, m2=57.5, m3=59.5, all=61.0, oss=63.0, free=65.0, lock=67.0, end=75.0).items()}
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

# Mise en page par format : (gauche, haut, largeur) des légendes et des fenêtres
if not V:
    capL = dict(left=110, top=360, width=660); capT = dict(left=110, top=150, width=1700)
    chatWin = lambda cid, key: win(cid, 'RedWidow: Chat', C[key.replace('-tall', '')], 980, 640, 1.05, 820, 230)
    monWin = win('w-mon', 'Monitor · kali-1', C['monitor'], 981, 340, 1.75, 101, 330)
    kcWin = win('w-kc', 'Kill chain', C['killchain'], 981, 450, 3.0, 124, 330, (0, 150, 557, 176)); feedPos = (124, 912)
    welWin = win('w-wel', 'RedWidow: Chat', C['welcome'], 470, 690, 3.0, 110, 150, (85, 60, 300, 246)); welCap = dict(left=1080, top=350, width=800)
    termWin = win('w-term', 'kali-1', C['terminal'], 560, 690, 1.1, 70, 150); learnWin = win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, 1.1, 736, 150)
    hintCap = dict(left=1330, top=350, width=560); painPos = (180, 300); centerTop = dict(models=330, end1=200)
else:
    capL = dict(left=70, top=250, width=940); capT = dict(left=70, top=250, width=940)
    CROP = {'w-chat': (0, 289, 470, 560), 'w-auto': (0, 0, 470, 560), 'w-rep': (0, 0, 470, 560)}
    chatWin = lambda cid, key: win(cid, 'RedWidow: Chat', C[key], 470, 849, 2.0, 70, 640, CROP[cid])
    monWin = win('w-mon', 'Monitor · kali-1', C['monitor'], 981, 340, 1.75, 50, 640, (0, 40, 560, 300))
    kcWin = win('w-kc', 'Kill chain', C['killchain'], 981, 450, 2.4, 52, 640, (0, 130, 406, 230)); feedPos = (60, 1260)
    welWin = win('w-wel', 'RedWidow: Chat', C['welcome'], 470, 690, 3.0, 90, 700, (85, 60, 300, 246)); welCap = dict(left=70, top=250, width=940)
    termWin = win('w-term', 'kali-1', C['terminal'], 560, 690, 1.75, 50, 560, (0, 160, 560, 270))
    learnWin = win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, 2.1, 46, 1080, (0, 300, 470, 300))
    hintCap = dict(left=70, top=250, width=940); painPos = (70, 640); centerTop = dict(models=700, end1=560)
def cap(d, inner, cls='cap'):
    return f'<div class="{cls}" style="left:{d["left"]}px;top:{d["top"]}px;width:{d["width"]}px">{inner}</div>'
inl = '' if V else ' inl'

S = []
S.append(('pain', 0, TL['reveal'], f'''<div class="term-lines" style="left:{painPos[0]}px;top:{painPos[1]}px">
{L(0.5, 'tl', '<b>&gt;</b> 23 terminals open')}{L(2.0, 'tl', '<b>&gt;</b> nmap output lost in a .txt')}{L(3.5, 'tl', '<b>&gt;</b> notes in four different apps')}{L(5.0, 'tl', '<b>&gt;</b> report due tomorrow')}</div>'''))
S.append(('reveal', TL['reveal'], B(13.0), f'''<div id="halo" class="halo"></div>
<div class="lock"><div id="lock-slot" class="spslot"></div>
<div class="lock-txt"><div class="wm slam" data-t="{TL['reveal']}"><b>RED</b>WIDOW</div>
<div class="mono scr tagline" data-t="{TL['tag']}" data-d="0.8">AI-native pentest workspace · in VS Code</div></div></div>'''))
S.append(('c1', TL['ch1'], TL['chat'], chapter(1, 'Recon', 13.0)))
S.append(('recon', TL['chat'], TL['mon'], chatWin('w-chat', 'chat-agent-tall') + cap(capL,
    L(15.0, 'mid', 'Give it') + L(15.2, 'mid g', 'a target.') +
    f'''<div class="cg stack" data-t="{TL['tools']}">{L(16.6, 'mono', 'It runs the scans')}{L(16.6, 'tools', '<span>nmap</span><span>whatweb</span><span>ffuf</span><span>sqlmap</span>')}</div>''')))
S.append(('mon', TL['mon'], TL['ch2'], cap(capT, L(18.5, 'mid' + inl, 'Live,') + L(18.8, 'mid g' + inl, 'in your Kali.')) + monWin))
S.append(('c2', TL['ch2'], TL['kc'], chapter(2, 'Analysis', 21.0)))
S.append(('kc', TL['kc'], TL['ch3'], cap(capT,
    f'''<div class="cg" data-t="{TL['kc']}" data-x="{TL['replay']}">{L(22.5, 'mid' + inl, 'It maps')}{L(22.7, 'mid g' + inl, 'the kill chain.')}</div>
<div class="cg" data-t="{TL['replay']}">{L(27.0, 'mid' + inl, 'Scan')}{L(27.2, 'mid g' + inl, 'to root.')}</div>''') + kcWin +
    f'<div id="kc-feed" class="feed" style="left:{feedPos[0]}px;top:{feedPos[1]}px"></div><div id="kc-step" class="feed step" style="left:{feedPos[0]}px;top:{feedPos[1]}px"></div>'))
S.append(('c3', TL['ch3'], TL['drive'], chapter(3, 'Action', 31.0)))
S.append(('action', TL['drive'], TL['ch4'], chatWin('w-auto', 'chat-bypass-tall') + cap(capL,
    f'''<div class="cg" data-t="{TL['drive']}" data-x="{TL['unleash']}">{L(32.5, 'big', 'Drive it.')}{L(32.8, 'mono', 'Step by step · ROE Supervised')}</div>
<div class="cg" data-t="{TL['unleash']}">{L(35.0, 'mid', 'Or')}{L(35.15, 'big g', 'unleash')}{L(35.3, 'big g', 'it.')}{L(35.6, 'mono', 'Full auto · ROE Automatic')}</div>''')))
S.append(('c4', TL['ch4'], TL['report'], chapter(4, 'Report', 39.0)))
S.append(('report', TL['report'], TL['ch5'], chatWin('w-rep', 'chat-bypass-tall') + cap(capL,
    L(40.6, 'mid', 'It writes') + L(40.8, 'mid g', 'the report.') + L(41.6, 'mono', 'Findings · severities · Markdown draft'))))
S.append(('c5', TL['ch5'], TL['learn'], chapter(5, 'Learn', 45.0, ' bonus')))
S.append(('learn', TL['learn'], TL['hint'], welWin + cap(welCap,
    L(46.6, 'mono', 'Learning mode') + L(47.0, 'mid', 'Stuck on') + L(47.2, 'mid', 'a box?') + L(48.3, 'mid v', 'It studies') + L(48.5, 'mid v', 'with you.'))))
S.append(('hint', TL['hint'], TL['models'], termWin + learnWin + cap(hintCap,
    f'''<div class="cg" data-t="{TL['hint']}" data-x="{TL['notlong']}">{L(50.2, 'mid', 'It reads')}{L(50.4, 'mid', 'your terminal.')}{L(51.2, 'mid g', 'It points')}{L(51.4, 'mid g', 'to the flaw.')}</div>
<div class="cg" data-t="{TL['notlong']}">{L(53.0, 'mid', 'Stuck?')}{L(53.3, 'mid g', 'Not for long.')}</div>''')))
S.append(('models', TL['models'], TL['all'], f'''<div class="cap center" style="top:{centerTop['models']}px">{L(55.0, 'mono', 'Bring any model')}
<div class="swap" style="height:260px">{L(55.5, 'huge one', 'Claude.', 57.5)}{L(57.5, 'huge one', 'GPT.', 59.5)}{L(59.5, 'huge one g', 'Ollama.')}</div></div>'''))
S.append(('end1', TL['all'], TL['lock'], f'''<div class="cap center" style="top:{centerTop['end1']}px">{L(61.0, 'outline', 'All of it.')}{L(63.0, 'outline', 'Open source.')}{L(65.0, 'giant g', 'Free.')}</div>'''))
S.append(('end2', TL['lock'], TL['end'] + 1.2, f'''<div id="halo2" class="halo"></div>
<div class="lock"><div id="end-slot" class="spslot small"></div>
<div class="lock-txt"><div class="wm slam" data-t="{TL['lock']}"><b>RED</b>WIDOW</div><div class="mono scr url" data-t="{B(68.0)}" data-d="0.8">github.com/tomtimlt/redwidow</div></div></div>
<div class="legal cl" data-t="{B(68.5)}">For authorized testing only.</div>'''))
rail = '<div id="rail" class="rail">' + ''.join(f'<div class="rail-step" data-i="{i}"><i>{i + 1:02d}</i>{w}</div>' for i, w in enumerate(['Recon', 'Analysis', 'Action', 'Report'])) + '</div>'
body = ''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i, a, b, h in S)
html = f'''<!doctype html><html><head><meta charset="utf-8"><title>RedWidow promo V7 {FMT}</title>
<link rel="stylesheet" href="file://{K}css/redwidow-ui.css">
<link rel="stylesheet" href="file://{H}/film.css">
{'<link rel="stylesheet" href="file://' + H + '/film-9x16.css">' if V else ''}
<script src="file:///home/user/warband/media/spider.js"></script>
<script>window.TL = {json.dumps(TL)}; window.FMT = "{FMT}";</script>
</head><body class="fmt-{FMT}"><div id="stage">{web()}{body}{rail}<div id="wipe"></div></div><div id="flash"></div><script src="file://{H}/film.js"></script></body></html>'''
open(f'{H}/film-{FMT}.html', 'w').write(html)
json.dump(TL, open(H + '/timeline.json', 'w'), indent=1)
print(FMT, len(html), 'end', TL['end'])
