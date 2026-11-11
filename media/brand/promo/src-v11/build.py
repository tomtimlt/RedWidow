# RedWidow promo V11 — film LinkedIn 4:5 (1080 × 1350), 94 BPM, français et anglais.
# Une cible, une histoire, trente secondes. L'accroche montre la sortie nmap qui défile dans
# le Monitor sous la consigne citée en grand, puis la carte d'autorisation et l'entrée trouvée.
# Le corps suit 10.10.10.14 sans redite : kill chain et rejeu, mode Auto, rapport, Apprentissage.
# Usage : python3 build.py fr|en [a|15s]
#   a   : film complet (29,4 s)                        → film-4x5[-fr].html, timeline.json
#   15s : accroche, logo, rejeu, Auto, fin (15,3 s)    → film-4x5[-fr]-15s.html, timeline-15s.json
import os, sys, json, math, re
H = os.path.dirname(os.path.abspath(__file__))
K = os.path.normpath(H + '/../../video-kit/html') + '/'
LANG = sys.argv[1] if len(sys.argv) > 1 else 'fr'; FR = LANG == 'fr'
CUT = sys.argv[2] if len(sys.argv) > 2 else 'a'
assert LANG in ('fr', 'en') and CUT in ('a', '15s')
sys.path.insert(0, H)
import fr as FRM
X = (lambda txt: FRM.cap(txt)) if FR else (lambda txt: txt)
W, HH = 1080, 1350
BPM = 94
NO = 9000.0  # temps « jamais » pour les plans absents d'une coupe (en temps musicaux)
def B(n): return round(n * 60 / BPM, 4)  # temps musicaux → secondes

# ---------------------------------------------------------------- timeline (en temps musicaux)
# t1..t3 : nmap, whatweb, ffuf dans le Monitor ; t4 : sqlmap (arrive dans le chat, hors champ).
HOOK = dict(t1=0, t2=1, t3=2, t4=3, card=4, allow=5.5, win=6, hush=7.25, reveal=8)
if CUT == '15s':
    BEATS = dict(HOOK, kc=-400, replay=10, unleash=14, lock=18, end=24, step=0.6)
else:
    BEATS = dict(HOOK, kc=10, replay=14, unleash=18, report=22, learn=26, hint=28.5,
                 models=32, all=36, oss=37, free=38, lock=40, end=46, step=0.6)
KEYS = ['t1', 't2', 't3', 't4', 'card', 'allow', 'win', 'hush', 'reveal', 'kc', 'replay', 'unleash',
        'report', 'learn', 'hint', 'models', 'all', 'oss', 'free', 'lock', 'end']
def bt(k): return BEATS.get(k, NO)
has = lambda k: k in BEATS
TL = {k: B(bt(k)) for k in KEYS}
TL['beat'] = round(60 / BPM, 5); TL['step'] = BEATS['step']; TL['cut'] = CUT; TL['bpm'] = BPM
# Rail de mission : une plage par étape (01 Repérage dès la première image)
TL['rail'] = [] if CUT == '15s' else [[B(-1), TL['hush']], [TL['kc'], TL['unleash']], [TL['unleash'], TL['report']],
                                     [TL['report'], TL['learn']], [TL['learn'], TL['models']]]

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

def L(b, cls, txt, x=None, raw=False):
    xs = f' data-x="{B(x)}"' if x is not None else ''
    return f'<div class="cl {cls}" data-t="{B(b)}"{xs}>{txt if raw else X(txt)}</div>'
def kick(b, n, verb, phase):
    """Repère de chapitre dans la bande du haut : numéro, verbe de chasse, phase réelle du rail."""
    return f'<div class="cl kicker" data-t="{B(b)}"><b>{n:02d}</b>{X(verb)}<i>·</i>{X(phase)}</div>'
def cap(inner, cls='cap', top=60, cid=''):
    i = f' id="{cid}"' if cid else ''
    return f'<div class="{cls}"{i} style="left:60px;top:{top}px;width:960px">{inner}</div>'

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
# Bande du haut 60–400 : repère et titre. Interface 410–1170. Rail 1186–1232.
# Rien d'essentiel sous 1240 (commandes du lecteur LinkedIn).
SC = 2.2          # échelle des chats et du Monitor : texte d'interface de 13 px rendu à 28,6 px
CX, CYT, CHH = 23, 392, 338
HY, HCH = 424, 322  # fenêtres de l'accroche, sous les trois lignes de titre et la consigne
def chatWin(cid, key, cy=0, title='RedWidow: Chat', h=849, y=CYT, ch=CHH):
    return win(cid, title, C[key], 470, h, SC, CX, y, (0, cy, 470, ch))
CURSOR = '<svg class="cursor" viewBox="0 0 24 24" width="54" height="54"><path d="M5 3l14 8.5-6.2 1.3L16 20l-2.6 1.2-3.2-7.1L5 18z" fill="#f2f3f5" stroke="#0b0b0d" stroke-width="1.4" stroke-linejoin="round"/></svg>'
PROMPT = FRM.UI['Recon 10.10.10.14 and find me a way in.'] if FR else 'Recon 10.10.10.14 and find me a way in.'

S = []
# -- accroche : le titre et la consigne tiennent sur les deux plans (Monitor, puis chat)
S.append(('hookcap', -1, TL['reveal'], cap(
    L(-2, 'kicker lead', 'For pentesters · AI agent inside VS Code') +
    L(-0.5, 'cmdline', f'<b>&gt;</b> {PROMPT}', raw=True) +
    L(-0.4, 'mid', 'One sentence.') + L(2, 'mid', 'Four tools.') + L(6, 'mid g', 'One way in.'), cid='hcap')))
S.append(('hookmon', -1, TL['card'], win('w-hmon', 'Monitor · kali-1', C['monitor'], 470, HCH, SC, CX, HY)))
S.append(('hook', TL['card'], TL['reveal'], chatWin('w-hook', 'chat-hook', y=HY, ch=HCH) + CURSOR.replace('class="cursor"', 'class="cursor" id="cur-hook"')))
# -- logo : une demi-seconde de silence, l'araignée verrouille son viseur
nxt = TL['kc'] if CUT == 'a' else TL['replay']
S.append(('reveal', TL['reveal'], nxt, f'''<div id="halo" class="halo"></div>
<div class="lock"><div id="lock-slot" class="spslot"></div>
<div class="lock-txt"><div class="wm slam" data-t="{TL['reveal']}"><b>RED</b>WIDOW</div>
<div class="mono scr tagline" data-t="{round(TL['reveal'] + 0.12, 4)}" data-d="0.3">{X('Pentest in VS Code, with AI on call.')}</div></div></div>'''))
# -- 02 GUETTE · Analyse : la kill chain se construit, puis « Rejouer » jusqu'au nœud racine
if CUT == 'a':
    kcCap = (kick(10, 2, 'Watch', 'Analysis') +
        f'''<div class="cg" data-t="{TL['kc']}" data-x="{TL['replay']}">{L(10, 'mid', 'It maps')}{L(10.3, 'mid g', 'the kill chain.')}</div>
<div class="cg" data-t="{TL['replay']}">{L(14, 'mid', 'The path')}{L(14.3, 'mid g', 'to root.')}</div>''')
else:
    kcCap = (kick(10, 2, 'Watch', 'Analysis') +
        f'''<div class="cg" data-t="{TL['replay']}">{L(10, 'mid', 'The path')}{L(10.3, 'mid g', 'to root.')}</div>''')
S.append(('kc', TL['kc'] if CUT == 'a' else TL['replay'], TL['unleash'], cap(kcCap) +
    win('w-kc', 'Kill chain', C['killchain'], 1034, 812, 1.0, 23, 284) +
    '<div id="kc-feed" class="feed" style="left:60px;top:1138px"></div><div id="kc-step" class="feed step" style="left:60px;top:1138px"></div>'))
# -- 03 FRAPPE · Action : le mode Auto (la carte d'autorisation a déjà été pressée dans l'accroche)
u0 = bt('unleash')
S.append(('auto', TL['unleash'], TL['report'] if has('report') else TL['lock'], chatWin('w-auto', 'chat-bypass-tall', h=CHH) + cap(
    kick(u0, 3, 'Strike', 'Action') + L(u0, 'mid', 'Or unleash') + L(u0 + 0.3, 'big g', 'it.') + L(u0 + 0.8, 'mono', 'No prompts · 1 min to 48 h'))))
# -- 04 EMBALLE · Rapport
if has('report'):
    S.append(('report', TL['report'], TL['learn'], chatWin('w-rep', 'chat-bypass-tall', h=640) + cap(
        kick(22, 4, 'Wrap', 'Report') + L(22, 'mid', 'It writes') + L(22.3, 'mid g', 'the report.') + L(23, 'mono', 'Findings · severities · Markdown draft'))))
# -- 05 APPRENDS · Apprentissage : l'araignée étudie, puis l'indice tiré du terminal
if has('learn'):
    S.append(('learn', TL['learn'], TL['hint'], cap(kick(26, 5, 'Learn', 'Learning mode') +
        L(26, 'mid', 'Stuck on') + L(26.3, 'mid g', 'a box?')) +
        win('w-wel', 'RedWidow: Chat', C['welcome-learning'], 470, 690, 3.0, 90, 346, (85, 52, 300, 263))))
    S.append(('hint', TL['hint'], TL['models'], cap(kick(25, 5, 'Learn', 'Learning mode') +
        L(28.5, 'mid', 'It reads') + L(28.8, 'mid g', 'your terminal.') + L(29.5, 'mono tight', 'A hint, not the answer · never executes')) +
        win('w-term', 'kali-1', C['terminal'], 560, 690, 1.84, 23, 348, (0, 250, 560, 172)) +
        win('w-learn', 'RedWidow: Chat', C['chat-learning'], 470, 690, SC, 23, 710, (0, 330, 470, 180))))
# -- modèles, puis « Tout ça. Open source. Gratuit. »
if has('models'):
    S.append(('models', TL['models'], TL['all'], f'''<div class="cap center" style="top:400px">{L(32, 'mono', 'Bring any model')}
{L(32, 'huge', 'Claude.')}{L(33, 'huge', 'GPT.')}{L(34, 'huge g', 'Ollama.')}</div>'''))
    S.append(('end1', TL['all'], TL['lock'], f'''<div class="cap center" style="top:400px">{L(36, 'outline', 'All of it.')}{L(37, 'outline', 'Open source.')}{L(38, 'giant g', 'Free.')}</div>'''))
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
if TL['rail']:
    rail = '<div id="rail" class="rail">' + ''.join(
        f'<div class="rail-step" data-i="{i}"><i>{i + 1:02d}</i><span>{X(w)}</span></div>' for i, w in enumerate(['Recon', 'Analysis', 'Action', 'Report', 'Learning'])) + '</div>'
body = ''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i, a, b, h in S)
suffix = ('-fr' if FR else '') + ('' if CUT == 'a' else '-' + CUT)
html = f'''<!doctype html><html lang="{LANG}"><head><meta charset="utf-8"><title>RedWidow promo V11 4x5 {LANG} {CUT}</title>
<link rel="stylesheet" href="../../video-kit/html/css/redwidow-ui.css">
<link rel="stylesheet" href="film.css">
<script src="../../../spider.js"></script>
<script>window.TL = {json.dumps(TL)}; window.LANG = "{LANG}";</script>
</head><body><div id="stage">{web()}{body}{rail}<div id="wipe"></div></div><div id="vig"></div><div id="grain"></div><div id="flash"></div><script src="film.js"></script></body></html>'''
open(f'{H}/film-4x5{suffix}.html', 'w').write(html)
json.dump(TL, open(f'{H}/timeline{"" if CUT == "a" else "-" + CUT}.json', 'w'), indent=1)
print('4x5', LANG, CUT, len(html), 'fin', TL['end'], 's')
