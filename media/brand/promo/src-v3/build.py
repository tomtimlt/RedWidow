# RedWidow promo V3 : ouverture qui respire, puis le montage de la V2 décalé de D secondes.
import os
H = os.path.dirname(os.path.abspath(__file__))
K = '/home/user/warband/media/brand/video-kit/html/'
D = 2.5
def T(x): return round(x + D, 3)
def comp(path):
    s = open(path).read()
    return s[s.index('<!-- component:start -->') + 24:s.index('<!-- component:end -->')]
def win(cid, title, markup, w, h, s, x, y, crop=None):
    cx, cy, cw, ch = crop or (0, 0, w, h)
    W, Hh = round(cw * s), round(ch * s)
    return (f'<div class="win" id="{cid}" style="left:{x}px;top:{y}px;width:{W}px" data-s="{s}" data-cx="{cx}" data-cy="{cy}">'
            f'<div class="tab"><i class="dot"></i>{title}</div>'
            f'<div class="cv" style="width:{W}px;height:{Hh}px"><div class="cs" style="width:{w}px;height:{h}px;transform:scale({s}) translate({-cx}px,{-cy}px)">{markup}</div></div></div>')
C = {n: comp(K + n + '.html') for n in ['monitor', 'killchain', 'welcome', 'chat-learning', 'terminal', 'configure', 'chat-bypass']}
C['chat-agent'] = comp(H + '/snap/chat-agent.html')
def L(t, cls, txt, extra=''):
    return f'<div class="cl {cls}" data-t="{t}"{extra}>{txt}</div>'
def scr(t, d, txt, style):
    return f'<div class="mono scr" data-t="{t}" data-d="{d}" style="position:absolute;{style}">{txt}</div>'
S = []
# A — ouverture : la fenêtre sort du noir, le prompt se tape, l'agent part (temps absolus)
S.append(('a', 0, 6.5, f'''
{win('w-hook', 'RedWidow: Chat', C['chat-agent'], 980, 640, 1.05, 820, 190)}
<div class="cap left" style="left:110px;top:330px;width:680px">{L(1.0, 'mid', 'An AI agent')}{L(2.9, 'mid', 'that hacks')}{L(4.4, 'mid r', 'with you.')}</div>
{scr(5.3, 0.6, 'Inside VS Code', 'left:110px;top:640px')}'''))
# B — révélation
S.append(('b', T(4.0), T(6.5), f'''
<div class="lock" style="top:300px"><div id="lock-slot" class="spslot" style="width:340px;height:427px"></div>
<div><div class="wm slam" data-t="{T(4.0)}"><b>RED</b>WIDOW</div><div class="mono scr" data-t="{T(4.55)}" data-d="0.6">Your AI red teamer</div></div></div>'''))
# C — Monitor
S.append(('c', T(6.5), T(10.0), f'''
<div class="cap" style="left:110px;top:70px;width:1700px">{L(T(6.5), 'mid inl', 'Every command.')}{L(T(7.0), 'mid inl r', 'Live.')}</div>
{win('w-mon', 'Monitor · kali-1', C['monitor'], 981, 340, 1.75, 101, 300)}
{scr(T(8.2), 0.5, 'In your Docker Kali and Exegol containers', 'left:110px;top:970px')}'''))
# D — kill chain
S.append(('d', T(10.0), T(16.5), f'''
<div class="cap" style="left:110px;top:90px;width:1700px">
<div class="grp" data-t="{T(10.0)}" data-x="{T(14.9)}">{L(T(10.0), 'mid inl', 'It draws')}{L(T(10.15), 'mid inl r', 'your kill chain.')}</div>
<div class="grp" data-t="{T(14.9)}">{L(T(14.9), 'mid inl', 'From scan')}{L(T(15.05), 'mid inl r', 'to root.')}</div></div>
{win('w-kc', 'Kill chain', C['killchain'], 981, 450, 2.2, 124, 300, (0, 120, 760, 240))}
{scr(T(12.8), 0.6, 'MITRE ATT&amp;CK · mapped by the agent', 'left:124px;top:900px')}'''))
# E — plein auto et rapport
S.append(('e', T(16.5), T(21.0), f'''
{win('w-auto', 'RedWidow: Chat', C['chat-bypass'], 980, 640, 1.05, 820, 190)}
<div class="cap left" style="left:110px;top:330px;width:680px">
<div class="grp" data-t="{T(16.5)}" data-x="{T(18.5)}">{L(T(16.5), 'big r', 'Full auto.')}{L(T(16.7), 'mono', 'ROE · Automatic')}</div>
<div class="grp" data-t="{T(18.5)}">{L(T(18.5), 'mid', 'It writes')}{L(T(18.65), 'mid r', 'the report.')}</div></div>'''))
# F — Apprentissage
S.append(('f1', T(21.0), T(22.0), f'''<div class="cap center" style="top:430px">{L(T(21.0), 'huge', 'Stuck on a box?')}</div>'''))
S.append(('f2', T(22.0), T(24.5), f'''
{win('w-wel', 'RedWidow: Chat', C['welcome'], 470, 690, 3.0, 110, 130, (85, 60, 300, 246))}
<div class="cap left" style="left:1080px;top:330px;width:800px">{L(T(22.0), 'mono', 'Learning mode')}{L(T(22.6), 'mid', 'It reads')}{L(T(22.95), 'mid', 'your terminal.')}{L(T(23.5), 'mid r', 'And your course.')}</div>'''))
S.append(('f3', T(24.5), T(29.0), f'''
{win('w-term', 'kali-1', C['terminal'], 560, 690, 1.1, 70, 143)}
{win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, 1.1, 736, 143)}
<div class="cap left" style="left:1330px;top:330px;width:560px">
<div class="grp" data-t="{T(24.5)}" data-x="{T(27.0)}">{L(T(24.6), 'mid', 'It sees')}{L(T(24.75), 'mid', 'what you')}{L(T(24.9), 'mid r', 'missed.')}</div>
<div class="grp" data-t="{T(27.0)}">{L(T(27.0), 'mid', 'Stuck?')}{L(T(27.2), 'mid r', 'Not for')}{L(T(27.35), 'mid r', 'long.')}</div></div>'''))
# G — puissance
S.append(('g1', T(29.0), T(30.5), f'''
{win('w-cfg', 'Configure', C['configure'], 340, 301, 3.4, 382, 400, (0, 91, 340, 80))}
<div class="cap left" style="top:120px;width:1700px">{L(T(29.0), 'mid inl', 'Max')}{L(T(29.15), 'mid inl r', 'brain.')}{L(T(29.6), 'mono', 'Reasoning effort · Maximum')}</div>'''))
S.append(('g2', T(30.5), T(32.5), f'''
<div class="cap center" style="top:300px">{L(T(30.5), 'mono', 'Any model')}
<div class="swap" style="height:240px">{L(T(30.6), 'huge one', 'Claude.', f' data-x="{T(31.1)}"')}{L(T(31.1), 'huge one', 'GPT.', f' data-x="{T(31.6)}"')}{L(T(31.6), 'huge one r', 'Ollama.')}</div></div>'''))
# H — fin
S.append(('h1', T(32.5), T(35.5), f'''<div class="cap left" style="top:250px">{L(T(32.5), 'big', 'All of this.')}{L(T(33.5), 'big', 'Open source.')}{L(T(34.5), 'giant r', 'Free.')}</div>'''))
S.append(('h2', T(35.5), T(39.5), f'''
<div class="lock end" style="top:250px"><div id="end-slot" class="spslot" style="width:300px;height:377px"></div>
<div><div class="wm slam" data-t="{T(35.5)}"><b>RED</b>WIDOW</div><div class="mono scr" data-t="{T(36.0)}" data-d="0.6">github.com/tomtimlt/redwidow</div></div></div>
<div class="legal cl" data-t="{T(36.3)}">For authorized testing only.</div>'''))
body = ''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i, a, b, h in S)
html = f'''<!doctype html><html><head><meta charset="utf-8"><title>RedWidow promo V3</title>
<link rel="stylesheet" href="file://{K}css/redwidow-ui.css">
<link rel="stylesheet" href="file://{H}/film.css">
<script src="file:///home/user/warband/media/spider.js"></script>
</head><body><div id="stage">{body}</div><div id="flash"></div><script src="file://{H}/film.js"></script></body></html>'''
open(H + '/film.html', 'w').write(html)
print(len(html))
