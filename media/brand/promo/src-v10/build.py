# RedWidow promo V10 — film LinkedIn 4:5 (1080 × 1350), 94 BPM, français et anglais.
# On entre en pleine action : la consigne est envoyée, l'agent enchaîne ses outils,
# la carte d'autorisation tombe. Logo, puis les cinq temps du rail de mission.
# Usage : python3 build.py fr|en [a|15s|b]
#   a   : film complet (accroche A)            → film-4x5[-fr].html, timeline.json
#   15s : accroche, logo, Strike, rejeu, fin   → film-4x5[-fr]-15s.html, timeline-15s.json
#   b   : film complet, accroche B (rejeu puis consigne) → film-4x5[-fr]-b.html, timeline-b.json
import os, sys, json, math, re
H = os.path.dirname(os.path.abspath(__file__))
K = os.path.normpath(H + '/../../video-kit/html') + '/'
SPIDER = os.path.normpath(H + '/../../../spider.js')
LANG = sys.argv[1] if len(sys.argv) > 1 else 'fr'; FR = LANG == 'fr'
CUT = sys.argv[2] if len(sys.argv) > 2 else 'a'
assert LANG in ('fr', 'en') and CUT in ('a', '15s', 'b')
sys.path.insert(0, H)
import fr as FRM
X = (lambda txt: FRM.cap(txt)) if FR else (lambda txt: txt)
W, HH = 1080, 1350
BPM = 94
NO = 9000.0  # temps « jamais » pour les plans absents d'une variante (en temps musicaux)
def B(n): return round(n * 60 / BPM, 4)  # temps musicaux → secondes

# ---------------------------------------------------------------- timeline (en temps musicaux)
if CUT == '15s':
    BEATS = dict(t1=0, t2=1, t3=2, t4=3, card=4, allow=5.5, win=6, hush=7.25, reveal=8,
                 drive=10, unleash=12, kc=-400, replay=14, cut2=18, lock=18, end=24, step=0.6)
elif CUT == 'b':
    BEATS = dict(kcb=-400, replayb=-3.6, cb=4, type0=4.1, type1=5.3, send=5.4, bt1=5.75, bt2=6.25, bt3=6.75, hush=7.25, reveal=8,
                 mon=10, kc=16, replay=20, drive=28, unleash=32, report=36, learn=40, hint=44,
                 models=48, all=52, oss=53, free=54, lock=56, end=62, step=1.0)
else:
    BEATS = dict(t1=0, t2=1, t3=2, t4=3, card=4, allow=5.5, win=6, hush=7.25, reveal=8,
                 mon=10, kc=16, replay=20, drive=28, unleash=32, report=36, learn=40, hint=44,
                 models=48, all=52, oss=53, free=54, lock=56, end=62, step=1.0)
KEYS = ['t1', 't2', 't3', 't4', 'card', 'allow', 'win', 'kcb', 'replayb', 'cb', 'type0', 'type1', 'send', 'bt1', 'bt2', 'bt3',
        'hush', 'reveal', 'mon', 'kc', 'replay', 'cut2', 'drive', 'unleash', 'report', 'learn', 'hint',
        'models', 'all', 'oss', 'free', 'lock', 'end']
def bt(k): return BEATS.get(k, NO)
TL = {k: B(bt(k)) for k in KEYS}
TL['beat'] = round(60 / BPM, 5); TL['step'] = BEATS['step']; TL['cut'] = CUT; TL['bpm'] = BPM
has = lambda k: k in BEATS

# ---------------------------------------------------------------- composants de l'interface
def comp(path):
    s = open(path).read()
    return s[s.index('<!-- component:start -->') + 24:s.index('<!-- component:end -->')]
def win(cid, title, markup, w, h, s, x, y, crop=None):
    cx, cy, cw, ch = crop or (0, 0, w, h)
    Wp, Hp = round(cw * s), round(ch * s)
    return (f'<div class="win" id="{cid}" style="left:{x}px;top:{y}px;width:{Wp}px" data-s="{s}" data-cx="{cx}" data-cy="{cy}" data-cw="{cw}" data-ch="{ch}">'
            f'<div class="tab"><i class="dot"></i>{title}</div>'
            f'<div class="cv" style="width:{Wp}px;height:{Hp}px"><div class="cs" style="width:{w}px;height:{h}px;transform:scale({s}) translate({-cx}px,{-cy}px)">{markup}</div></div></div>')
C = {n: comp(K + n + '.html') for n in ['monitor', 'killchain', 'welcome-learning', 'chat-learning', 'terminal', 'chat-approval-tall']}
C['chat-agent-tall'] = comp(H + '/snap/chat-agent-tall.html')
C['chat-bypass-tall'] = comp(H + '/snap/chat-bypass-tall.html')
# Chat de l'accroche : la conversation « Recon 10.10.10.14 and find me a way in. » avec la carte
# d'autorisation réelle du composant chat-approval-tall (même commande sqlmap), placée dans sa section.
card = re.search(r'<section id="approvals"[^>]*>(.*?)</section>', C['chat-approval-tall'], re.S).group(1)
assert 'card-buttons' in card
C['chat-hook'] = re.sub(r'(<section id="approvals"[^>]*>)(</section>)', lambda m: m.group(1) + card + m.group(2), C['chat-agent-tall'], count=1)
assert 'card-buttons' in C['chat-hook']
if FR: C = {k: FRM.ui(v) for k, v in C.items()}

def L(b, cls, txt, x=None):
    xs = f' data-x="{B(x)}"' if x is not None else ''
    return f'<div class="cl {cls}" data-t="{B(b)}"{xs}>{X(txt)}</div>'
def kick(b, n, verb, phase):
    """Repère de chapitre dans la bande du haut : numéro, verbe de chasse, phase réelle du rail."""
    return f'<div class="cl kicker" data-t="{B(b)}"><b>{n:02d}</b>{X(verb)}<i>·</i>{X(phase)}</div>'
def cap(inner, cls='cap', top=60):
    return f'<div class="{cls}" style="left:60px;top:{top}px;width:960px">{inner}</div>'

def web():
    cx, cy, R = W / 2, HH / 2, 1500
    rays = ''.join(f'<line x1="{cx}" y1="{cy}" x2="{cx + R * math.cos(a):.1f}" y2="{cy + R * math.sin(a):.1f}"/>' for a in [i * math.pi / 9 for i in range(18)])
    rings = []
    for k in range(1, 15):
        r = 70 * k * 1.12 ** k / 1.6
        pts = [f'{cx + r * (0.94 + 0.06 * math.cos(i * 2.3)) * math.cos(i * math.pi / 9):.1f},{cy + r * (0.94 + 0.06 * math.cos(i * 2.3)) * math.sin(i * math.pi / 9):.1f}' for i in range(19)]
        rings.append(f'<polyline points="{" ".join(pts)}"/>')
    return f'<svg id="web" width="{W}" height="{HH}" viewBox="0 0 {W} {HH}" style="transform-origin:{cx}px {cy}px">{rays}{"".join(rings)}</svg>'

# ---------------------------------------------------------------- mise en page 4:5
# Bande du haut 60–380 : repère et titre. Centre 392–1170 : interface. Rail 1186–1232.
# Rien d'essentiel sous 1240 (commandes du lecteur LinkedIn).
SC = 2.2          # échelle des chats : texte d'interface de 13 px rendu à 28,6 px
CX, CYT, CHH = 23, 392, 338
def chatWin(cid, key, cy=0, title='RedWidow: Chat', h=849):
    return win(cid, title, C[key], 470, h, SC, CX, CYT, (0, cy, 470, CHH))
CURSOR = '<svg class="cursor" viewBox="0 0 24 24" width="54" height="54"><path d="M5 3l14 8.5-6.2 1.3L16 20l-2.6 1.2-3.2-7.1L5 18z" fill="#f2f3f5" stroke="#0b0b0d" stroke-width="1.4" stroke-linejoin="round"/></svg>'

S = []
# -- accroche A : la consigne est envoyée, les outils s'enchaînent, la carte tombe, Allow once
if has('t1'):
    S.append(('hook', -1, TL['reveal'], chatWin('w-hook', 'chat-hook') + CURSOR.replace('class="cursor"', 'class="cursor" id="cur-hook"') + cap(
        L(-2, 'kicker lead', 'For pentesters · AI agent inside VS Code') +
        L(-0.45, 'mid', 'One sentence.') + L(2, 'mid', 'Four tools.') + L(6, 'mid g', 'One way in.'))))
# -- accroche B : la fin du rejeu de la kill chain, puis la consigne qui a tout lancé
if has('kcb'):
    S.append(('kcb', -1, TL['cb'], cap(L(-2, 'kicker lead', 'For pentesters · AI agent inside VS Code') +
        L(-0.45, 'mid', 'It maps the path') + L(1.5, 'mid g', 'to root.')) +
        win('w-kcb', 'Kill chain', C['killchain'], 1034, 812, 1.0, 23, 284) +
        '<div id="kcb-step" class="feed step" style="left:60px;top:1138px"></div>'))
    S.append(('chatb', TL['cb'], TL['reveal'], chatWin('w-chatb', 'chat-agent-tall') + cap(
        L(-2, 'kicker lead', 'For pentesters · AI agent inside VS Code') +
        L(4, 'mid', 'One sentence') + L(4.3, 'mid g', 'started it.'))))
# -- logo : une demi-seconde de silence, l'araignée verrouille son viseur
S.append(('reveal', TL['reveal'], min(TL['mon'], TL['drive']), f'''<div id="halo" class="halo"></div>
<div class="lock"><div id="lock-slot" class="spslot"></div>
<div class="lock-txt"><div class="wm slam" data-t="{TL['reveal']}"><b>RED</b>WIDOW</div>
<div class="mono scr tagline" data-t="{round(TL['reveal'] + 0.12, 4)}" data-d="0.3">{X('Pentest in VS Code, with AI on call.')}</div></div></div>'''))
# -- 01 WEAVE · Repérage : les outils tournent dans kali-1, le Monitor suit chaque commande
if has('mon'):
    S.append(('mon', TL['mon'], TL['kc'], cap(kick(10, 1, 'Weave', 'Recon') +
        L(10, 'mid', 'Exegol. Kali.') + L(10.3, 'mid g', 'Watched live.') + L(12, 'mono', 'Every agent command · Monitor')) +
        win('w-mon', 'Monitor · kali-1', C['monitor'], 470, 338, SC, CX, CYT)))
# -- 02 WATCH · Analyse : la kill chain se construit, puis « Rejouer » jusqu'au nœud racine
k0 = bt('kc') if has('mon') else bt('replay')
kcCap = (kick(k0, 2, 'Watch', 'Analysis') + (
    f'''<div class="cg" data-t="{TL['kc']}" data-x="{TL['replay']}">{L(16, 'mid', 'It maps')}{L(16.3, 'mid g', 'the kill chain.')}</div>
<div class="cg" data-t="{TL['replay']}">{L(20, 'mid', 'The path')}{L(20.3, 'mid g', 'to root.')}</div>''' if has('mon') else
    f'''<div class="cg" data-t="{TL['replay']}">{L(bt('replay'), 'mid', 'The path')}{L(bt('replay') + 0.3, 'mid g', 'to root.')}</div>'''))
S.append(('kc', TL['kc'] if has('mon') else TL['replay'], TL['drive'] if has('mon') else TL['cut2'], cap(kcCap) +
    win('w-kc', 'Kill chain', C['killchain'], 1034, 812, 1.0, 23, 284) +
    '<div id="kc-feed" class="feed" style="left:60px;top:1138px"></div><div id="kc-step" class="feed step" style="left:60px;top:1138px"></div>'))
# -- 03 STRIKE · Action : la carte d'autorisation, puis le mode Auto
d0, u0 = bt('drive'), bt('unleash')
S.append(('drive', TL['drive'], TL['unleash'], chatWin('w-drive', 'chat-approval-tall') + CURSOR.replace('class="cursor"', 'class="cursor" id="cur-drive"') + cap(
    kick(d0, 3, 'Strike', 'Action') + L(d0, 'big', 'Drive it.') + L(d0 + 0.5, 'mono', 'Allow once · Deny · Always'))))
S.append(('auto', TL['unleash'], TL['report'] if has('report') else TL['replay'], chatWin('w-auto', 'chat-bypass-tall', h=CHH) + cap(
    kick(u0 - 1, 3, 'Strike', 'Action') + L(u0, 'mid', 'Or unleash') + L(u0 + 0.3, 'big g', 'it.') + L(u0 + 0.8, 'mono', 'No prompts · 1 min to 48 h'))))
# -- 04 WRAP · Rapport
if has('report'):
    S.append(('report', TL['report'], TL['learn'], chatWin('w-rep', 'chat-bypass-tall', h=640) + cap(
        kick(36, 4, 'Wrap', 'Report') + L(36, 'mid', 'It writes') + L(36.3, 'mid g', 'the report.') + L(37, 'mono', 'Findings · severities · Markdown draft'))))
# -- 05 LEARN · Apprentissage : l'araignée étudie, puis l'indice tiré du terminal
if has('learn'):
    S.append(('learn', TL['learn'], TL['hint'], cap(kick(40, 5, 'Learn', 'Learning mode') +
        L(40, 'mid', 'Stuck on') + L(40.3, 'mid g', 'a box?')) +
        win('w-wel', 'RedWidow: Chat', C['welcome-learning'], 470, 690, 3.0, 90, 346, (85, 52, 300, 263))))
    S.append(('hint', TL['hint'], TL['models'], cap(kick(39, 5, 'Learn', 'Learning mode') +
        L(44, 'mid', 'It reads') + L(44.3, 'mid g', 'your terminal.') + L(45.5, 'mono tight', 'A hint, not the answer · never executes')) +
        win('w-term', 'kali-1', C['terminal'], 560, 690, 1.84, 23, 348, (0, 250, 560, 172)) +
        win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, SC, 23, 710, (0, 330, 470, 180))))
# -- modèles
if has('models'):
    S.append(('models', TL['models'], TL['all'], f'''<div class="cap center" style="top:400px">{L(48, 'mono', 'Bring any model')}
{L(48, 'huge', 'Claude.')}{L(49, 'huge', 'GPT.')}{L(50, 'huge g', 'Ollama.')}</div>'''))
    S.append(('end1', TL['all'], TL['lock'], f'''<div class="cap center" style="top:400px">{L(52, 'outline', 'All of it.')}{L(53, 'outline', 'Open source.')}{L(54, 'giant g', 'Free.')}</div>'''))
# -- fin : l'araignée, l'URL en grand, l'étoile
lk = bt('lock')
oss = f'''<div class="cl osl" data-t="{B(lk + 0.25)}">{X('Open source.')} <span class="g">{X('Free.')}</span></div>''' if CUT == '15s' else ''
S.append(('end2', TL['lock'], TL['end'] + 2, f'''<div id="halo2" class="halo"></div>
<div class="endcol"><div id="end-slot" class="spslot small"></div>
<div class="wm slam" data-t="{TL['lock']}"><b>RED</b>WIDOW</div>{oss}
<div class="url cl" data-t="{B(lk + 0.4)}">github.com/tomtimlt/redwidow</div>
<div class="star cl" data-t="{B(lk + 1.5)}"><svg viewBox="0 0 24 24" width="40" height="40"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" fill="currentColor"/></svg>{X('Star it on GitHub')}</div></div>
<div class="legal cl" data-t="{B(lk + 2)}">{X('For authorized testing only.')}</div>'''))

rail = ''
if CUT != '15s':
    rail = '<div id="rail" class="rail">' + ''.join(
        f'<div class="rail-step" data-i="{i}"><i>{i + 1:02d}</i><span>{X(w)}</span></div>' for i, w in enumerate(['Recon', 'Analysis', 'Action', 'Report', 'Learning'])) + '</div>'
body = ''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i, a, b, h in S)
suffix = ('-fr' if FR else '') + ('' if CUT == 'a' else '-' + CUT)
html = f'''<!doctype html><html lang="{LANG}"><head><meta charset="utf-8"><title>RedWidow promo V10 4x5 {LANG} {CUT}</title>
<link rel="stylesheet" href="../../video-kit/html/css/redwidow-ui.css">
<link rel="stylesheet" href="film.css">
<script src="../../../spider.js"></script>
<script>window.TL = {json.dumps(TL)}; window.LANG = "{LANG}";</script>
</head><body><div id="stage">{web()}{body}{rail}<div id="wipe"></div></div><div id="vig"></div><div id="grain"></div><div id="flash"></div><script src="film.js"></script></body></html>'''
open(f'{H}/film-4x5{suffix}.html', 'w').write(html)
json.dump(TL, open(f'{H}/timeline{"" if CUT == "a" else "-" + CUT}.json', 'w'), indent=1)
print('4x5', LANG, CUT, len(html), 'fin', TL['end'], 's')
