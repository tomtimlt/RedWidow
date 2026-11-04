# RedWidow promo V4 : temps absolus, calés sur une grille de 120 BPM.
import os
H = os.path.dirname(os.path.abspath(__file__))
K = '/home/user/warband/media/brand/video-kit/html/'
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
# A — ouverture : lisible en 3 s sans le son (ce que c'est, pour qui)
S.append(('a', 0, 6.5, f'''
{win('w-hook', 'RedWidow: Chat', C['chat-agent'], 980, 640, 1.05, 820, 190)}
<div class="cap left" style="left:110px;top:330px;width:680px">{L(0.6, 'mid', 'An AI agent')}{L(1.6, 'mid', 'that hacks')}{L(2.6, 'mid r', 'with you.')}</div>
{scr(3.4, 0.7, 'For pentesters · inside VS Code', 'left:110px;top:640px')}'''))
# B — révélation
S.append(('b', 6.5, 9.0, f'''
<div class="lock" style="top:300px"><div id="lock-slot" class="spslot" style="width:340px;height:427px"></div>
<div><div class="wm slam" data-t="6.5"><b>RED</b>WIDOW</div><div class="mono scr" data-t="7.05" data-d="0.6">Your AI red teamer</div></div></div>'''))
# C — Monitor
S.append(('c', 9.0, 12.5, f'''
<div class="cap" style="left:110px;top:70px;width:1700px">{L(9.0, 'mid inl', 'Every command.')}{L(9.5, 'mid inl r', 'Live.')}</div>
{win('w-mon', 'Monitor · kali-1', C['monitor'], 981, 340, 1.75, 101, 300)}
{scr(10.7, 0.5, 'In your Docker Kali and Exegol containers', 'left:110px;top:970px')}'''))
# D — kill chain : l'agent la remplit en direct, puis « Rejouer » parcourt le chemin
S.append(('d', 12.5, 19.5, f'''
<div class="cap" style="left:110px;top:80px;width:1700px">
<div class="grp" data-t="12.5" data-x="16.0">{L(12.5, 'mid inl', 'It draws')}{L(12.65, 'mid inl r', 'your kill chain.')}{L(13.0, 'mono', 'Mapped live by the agent · MITRE ATT&amp;CK')}</div>
<div class="grp" data-t="16.0">{L(16.0, 'mid inl', 'From scan')}{L(16.15, 'mid inl r', 'to root.')}{L(16.5, 'mono', 'Replay walks the path, step by step')}</div></div>
{win('w-kc', 'Kill chain', C['killchain'], 981, 450, 3.0, 124, 335, (0, 150, 557, 176))}
<div id="kc-feed" class="feed" style="left:124px;top:918px"></div>
<div id="kc-step" class="feed step" style="left:124px;top:918px"></div>'''))
# E — tu pilotes, ou tu la laisses chasser ; puis le rapport
S.append(('e', 19.5, 25.0, f'''
{win('w-auto', 'RedWidow: Chat', C['chat-bypass'], 980, 640, 1.05, 820, 190)}
<div class="cap left" style="left:110px;top:330px;width:680px">
<div class="grp" data-t="19.5" data-x="20.5">{L(19.5, 'big', 'You steer.')}{L(19.7, 'mono', 'ROE · Supervised')}</div>
<div class="grp" data-t="20.5" data-x="22.0">{L(20.5, 'mid', 'Or let it')}{L(20.65, 'big r', 'hunt.')}{L(20.9, 'mono', 'ROE · Automatic')}</div>
<div class="grp" data-t="22.0">{L(22.0, 'mid', 'It writes')}{L(22.15, 'mid r', 'the report.')}</div></div>'''))
# F — Apprentissage
S.append(('f1', 25.0, 26.0, f'''<div class="cap center" style="top:430px">{L(25.0, 'huge', 'Stuck on a box?')}</div>'''))
S.append(('f2', 26.0, 28.5, f'''
{win('w-wel', 'RedWidow: Chat', C['welcome'], 470, 690, 3.0, 110, 130, (85, 60, 300, 246))}
<div class="cap left" style="left:1080px;top:330px;width:800px">{L(26.0, 'mono', 'Learning mode')}{L(26.6, 'mid', 'It reads')}{L(26.95, 'mid', 'your terminal.')}{L(27.5, 'mid r', 'And your course.')}</div>'''))
S.append(('f3', 28.5, 33.0, f'''
{win('w-term', 'kali-1', C['terminal'], 560, 690, 1.1, 70, 143)}
{win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, 1.1, 736, 143)}
<div class="cap left" style="left:1330px;top:330px;width:560px">
<div class="grp" data-t="28.5" data-x="31.0">{L(28.6, 'mid', 'It sees')}{L(28.75, 'mid', 'what you')}{L(28.9, 'mid r', 'missed.')}</div>
<div class="grp" data-t="31.0">{L(31.0, 'mid', 'Stuck?')}{L(31.2, 'mid r', 'Not for')}{L(31.35, 'mid r', 'long.')}</div></div>'''))
# G — puissance (une seconde par modèle, au rythme de la vidéo)
S.append(('g1', 33.0, 34.5, f'''
{win('w-cfg', 'Configure', C['configure'], 340, 301, 3.4, 382, 400, (0, 91, 340, 80))}
<div class="cap left" style="top:120px;width:1700px">{L(33.0, 'mid inl', 'Max')}{L(33.15, 'mid inl r', 'brain.')}{L(33.6, 'mono', 'Reasoning effort · Maximum')}</div>'''))
S.append(('g2', 34.5, 37.5, f'''
<div class="cap center" style="top:300px">{L(34.5, 'mono', 'Any model')}
<div class="swap" style="height:240px">{L(34.55, 'huge one', 'Claude.', ' data-x="35.5"')}{L(35.5, 'huge one', 'GPT.', ' data-x="36.5"')}{L(36.5, 'huge one r', 'Ollama.')}</div></div>'''))
# H — fin
S.append(('h1', 37.5, 40.5, f'''<div class="cap left" style="top:250px">{L(37.5, 'big', 'All of this.')}{L(38.5, 'big', 'Open source.')}{L(39.5, 'giant r', 'Free.')}</div>'''))
S.append(('h2', 40.5, 45.0, f'''
<div class="lock end" style="top:250px"><div id="end-slot" class="spslot" style="width:300px;height:377px"></div>
<div><div class="wm slam" data-t="40.5"><b>RED</b>WIDOW</div><div class="mono scr" data-t="41.0" data-d="0.6">github.com/tomtimlt/redwidow</div></div></div>
<div class="legal cl" data-t="41.3">For authorized testing only.</div>'''))
body = ''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i, a, b, h in S)
html = f'''<!doctype html><html><head><meta charset="utf-8"><title>RedWidow promo V4</title>
<link rel="stylesheet" href="file://{K}css/redwidow-ui.css">
<link rel="stylesheet" href="file://{H}/film.css">
<script src="file:///home/user/warband/media/spider.js"></script>
</head><body><div id="stage">{body}</div><div id="flash"></div><script src="file://{H}/film.js"></script></body></html>'''
open(H + '/film.html', 'w').write(html)
print(len(html))
