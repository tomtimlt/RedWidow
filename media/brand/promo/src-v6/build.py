# RedWidow promo V6 : la V5 en palette rouge Widow, 110 BPM, temps en temps (beats).
import os, json, math
H = os.path.dirname(os.path.abspath(__file__))
K = '/home/user/warband/media/brand/video-kit/html/'
BPM = 110
def B(n): return round((n + (1 if n >= 6 else 0)) * 60 / BPM, 4)
def comp(path):
    s = open(path).read()
    return s[s.index('<!-- component:start -->') + 24:s.index('<!-- component:end -->')]
def win(cid, title, markup, w, h, s, x, y, crop=None):
    cx, cy, cw, ch = crop or (0, 0, w, h)
    W, Hh = round(cw * s), round(ch * s)
    return (f'<div class="win" id="{cid}" style="left:{x}px;top:{y}px;width:{W}px" data-s="{s}" data-cx="{cx}" data-cy="{cy}">'
            f'<div class="tab"><i class="dot"></i>{title}</div>'
            f'<div class="cv" style="width:{W}px;height:{Hh}px"><div class="cs" style="width:{w}px;height:{h}px;transform:scale({s}) translate({-cx}px,{-cy}px)">{markup}</div></div></div>')
C = {n: comp(K + n + '.html') for n in ['monitor', 'killchain', 'welcome', 'chat-learning', 'terminal', 'chat-bypass']}
C['chat-agent'] = comp(H + '/snap/chat-agent.html')
def L(b, cls, txt, x=None):
    xs = f' data-x="{B(x)}"' if x is not None else ''
    return f'<div class="cl {cls}" data-t="{B(b)}"{xs}>{txt}</div>'
def scr(b, d, txt, style, cls='mono'):
    return f'<div class="{cls} scr" data-t="{B(b)}" data-d="{d}" style="position:absolute;{style}">{txt}</div>'
def chapter(n, word, b):
    return (f'<div class="chap" data-t="{B(b)}"><div class="chap-n">{n:02d}</div>'
            f'<div class="chap-w">{word}</div></div>')

# Repères (en temps) : une seule source pour la page, le script et la musique
TL = {k: B(v) for k, v in dict(
    p1=0.5, p2=2.0, p3=3.5, p4=5.0, strike=6.5, reveal=8.0, tag=9.0,
    ch1=13.0, chat=14.5, type0=14.6, type1=16.0, send=16.1, tools=16.5, msg2=18.2, mon=18.5,
    ch2=21.0, kc=22.5, replay=27.0,
    ch3=31.0, drive=32.5, unleash=35.0,
    ch4=39.0, report=40.5,
    ch5=45.0, learn=46.5, learnOn=47.3, hint=50.0, notlong=53.0,
    models=55.0, m1=55.5, m2=57.5, m3=59.5,
    all=61.0, oss=63.0, free=65.0, lock=67.0, end=75.0).items()}
TL['beat'] = round(60 / BPM, 5)

# Toile d'araignée en fond (rayons + spirale), décorative
def web():
    cx, cy, R = 960, 540, 1250
    rays = ''.join(f'<line x1="{cx}" y1="{cy}" x2="{cx + R * math.cos(a):.1f}" y2="{cy + R * math.sin(a):.1f}"/>' for a in [i * math.pi / 9 for i in range(18)])
    rings = []
    for k in range(1, 14):
        r = 70 * k * 1.12 ** k / 1.6
        pts = []
        for i in range(19):
            a = i * math.pi / 9; rr = r * (0.94 + 0.06 * math.cos(i * 2.3))
            pts.append(f'{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}')
        rings.append(f'<polyline points="{" ".join(pts)}"/>')
    return f'<svg id="web" width="1920" height="1080" viewBox="0 0 1920 1080">{rays}{"".join(rings)}</svg>'

S = []
# 0 — la galère, en lignes de terminal
S.append(('pain', 0, TL['reveal'], f'''
<div class="term-lines" style="left:180px;top:300px">
{L(0.5, 'tl', '<b>&gt;</b> 23 terminals open')}{L(2.0, 'tl', '<b>&gt;</b> nmap output lost in a .txt')}{L(3.5, 'tl', '<b>&gt;</b> notes in four different apps')}{L(5.0, 'tl', '<b>&gt;</b> report due tomorrow')}
</div>'''))
# 1 — révélation
S.append(('reveal', TL['reveal'], B(13.0), f'''
<div id="halo" class="halo"></div>
<div class="lock"><div id="lock-slot" class="spslot" style="width:360px;height:452px"></div>
<div><div class="wm slam" data-t="{TL['reveal']}"><b>RED</b>WIDOW</div>
{f'<div class="mono scr tagline" data-t="{TL["tag"]}" data-d="0.7">AI-native pentest workspace · in VS Code</div>'}</div></div>'''))
# Chapitres 1–4 (rail de mission du produit)
S.append(('c1', TL['ch1'], TL['chat'], chapter(1, 'Recon', 13.0)))
S.append(('recon', TL['chat'], TL['mon'], f'''
{win('w-chat', 'RedWidow: Chat', C['chat-agent'], 980, 640, 1.05, 820, 230)}
<div class="cap" style="left:110px;top:360px;width:660px">{L(15.0, 'mid', 'Give it')}{L(15.2, 'mid g', 'a target.')}
<div class="cg stack" data-t="{TL['tools']}">{L(16.6, 'mono', 'It runs the scans')}{L(16.6, 'tools', '<span>nmap</span><span>whatweb</span><span>ffuf</span><span>sqlmap</span>')}</div></div>'''))
S.append(('mon', TL['mon'], TL['ch2'], f'''
<div class="cap" style="left:110px;top:150px;width:1700px">{L(18.5, 'mid inl', 'Live,')}{L(18.8, 'mid inl g', 'in your Kali.')}</div>
{win('w-mon', 'Monitor · kali-1', C['monitor'], 981, 340, 1.75, 101, 330)}'''))
S.append(('c2', TL['ch2'], TL['kc'], chapter(2, 'Analysis', 21.0)))
S.append(('kc', TL['kc'], TL['ch3'], f'''
<div class="cap" style="left:110px;top:150px;width:1700px">
<div class="cg" data-t="{TL['kc']}" data-x="{TL['replay']}">{L(22.5, 'mid inl', 'It maps')}{L(22.7, 'mid inl g', 'the kill chain.')}</div>
<div class="cg" data-t="{TL['replay']}">{L(27.0, 'mid inl', 'Scan')}{L(27.2, 'mid inl g', 'to root.')}</div></div>
{win('w-kc', 'Kill chain', C['killchain'], 981, 450, 3.0, 124, 330, (0, 150, 557, 176))}
<div id="kc-feed" class="feed" style="left:124px;top:912px"></div>
<div id="kc-step" class="feed step" style="left:124px;top:912px"></div>'''))
S.append(('c3', TL['ch3'], TL['drive'], chapter(3, 'Action', 31.0)))
S.append(('action', TL['drive'], TL['ch4'], f'''
{win('w-auto', 'RedWidow: Chat', C['chat-bypass'], 980, 640, 1.05, 820, 230)}
<div class="cap" style="left:110px;top:360px;width:660px">
<div class="cg" data-t="{TL['drive']}" data-x="{TL['unleash']}">{L(32.5, 'big', 'Drive it.')}{L(32.8, 'mono', 'Step by step · ROE Supervised')}</div>
<div class="cg" data-t="{TL['unleash']}">{L(35.0, 'mid', 'Or')}{L(35.15, 'big g', 'unleash')}{L(35.3, 'big g', 'it.')}{L(35.6, 'mono', 'Full auto · ROE Automatic')}</div></div>'''))
S.append(('c4', TL['ch4'], TL['report'], chapter(4, 'Report', 39.0)))
S.append(('report', TL['report'], TL['ch5'], f'''
{win('w-rep', 'RedWidow: Chat', C['chat-bypass'], 980, 640, 1.05, 820, 230)}
<div class="cap" style="left:110px;top:360px;width:660px">{L(40.6, 'mid', 'It writes')}{L(40.8, 'mid g', 'the report.')}{L(41.6, 'mono', 'Findings · severities · Markdown draft')}</div>'''))
# 5 — bonus : Apprentissage
S.append(('c5', TL['ch5'], TL['learn'], chapter(5, 'Learn', 45.0).replace('class="chap"', 'class="chap bonus"')))
S.append(('learn', TL['learn'], TL['hint'], f'''
{win('w-wel', 'RedWidow: Chat', C['welcome'], 470, 690, 3.0, 110, 150, (85, 60, 300, 246))}
<div class="cap" style="left:1080px;top:350px;width:800px">{L(46.6, 'mono', 'Learning mode')}{L(47.0, 'mid', 'Stuck on')}{L(47.2, 'mid', 'a box?')}{L(48.3, 'mid v', 'It studies')}{L(48.5, 'mid v', 'with you.')}</div>'''))
S.append(('hint', TL['hint'], TL['models'], f'''
{win('w-term', 'kali-1', C['terminal'], 560, 690, 1.1, 70, 150)}
{win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, 1.1, 736, 150)}
<div class="cap" style="left:1330px;top:350px;width:560px">
<div class="cg" data-t="{TL['hint']}" data-x="{TL['notlong']}">{L(50.2, 'mid', 'It reads')}{L(50.4, 'mid', 'your terminal.')}{L(51.2, 'mid g', 'It points')}{L(51.4, 'mid g', 'to the flaw.')}</div>
<div class="cg" data-t="{TL['notlong']}">{L(53.0, 'mid', 'Stuck?')}{L(53.3, 'mid g', 'Not for long.')}</div></div>'''))
# 6 — modèles (deux temps chacun)
S.append(('models', TL['models'], TL['all'], f'''
<div class="cap center" style="top:330px">{L(55.0, 'mono', 'Bring any model')}
<div class="swap" style="height:260px">{L(55.5, 'huge one', 'Claude.', 57.5)}{L(57.5, 'huge one', 'GPT.', 59.5)}{L(59.5, 'huge one g', 'Ollama.')}</div></div>'''))
# 7 — fin
S.append(('end1', TL['all'], TL['lock'], f'''
<div class="cap center" style="top:200px">{L(61.0, 'outline', 'All of it.')}{L(63.0, 'outline', 'Open source.')}{L(65.0, 'giant g', 'Free.')}</div>'''))
S.append(('end2', TL['lock'], TL['end'] + 1, f'''
<div id="halo2" class="halo"></div>
<div class="lock"><div id="end-slot" class="spslot" style="width:300px;height:377px"></div>
<div><div class="wm slam" data-t="{TL['lock']}"><b>RED</b>WIDOW</div><div class="mono scr url" data-t="{B(68.0)}" data-d="0.7">github.com/tomtimlt/redwidow</div></div></div>
<div class="legal cl" data-t="{B(68.5)}">For authorized testing only.</div>'''))
# barre de chapitres en haut (inspirée du rail de mission du produit)
rail = '<div id="rail" class="rail">' + ''.join(f'<div class="rail-step" data-i="{i}"><i>{i + 1:02d}</i>{w}</div>' for i, w in enumerate(['Recon', 'Analysis', 'Action', 'Report'])) + '</div>'
body = ''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i, a, b, h in S)
html = f'''<!doctype html><html><head><meta charset="utf-8"><title>RedWidow promo V6</title>
<link rel="stylesheet" href="file://{K}css/redwidow-ui.css">
<link rel="stylesheet" href="file://{H}/film.css">
<script src="file:///home/user/warband/media/spider.js"></script>
<script>window.TL = {json.dumps(TL)};</script>
</head><body><div id="stage">{web()}{body}{rail}<div id="wipe"></div></div><div id="flash"></div><script src="file://{H}/film.js"></script></body></html>'''
open(H + '/film.html', 'w').write(html)
json.dump(TL, open(H + '/timeline.json', 'w'), indent=1)
print(len(html), 'end', TL['end'])
