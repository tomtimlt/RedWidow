# Images de chapitre du README (1600 × 800) : plaque à gauche (numéro, verbe, phase,
# légende de la pub), fenêtres du kit à droite, fond acier et toile. Même langage que
# les pubs V8/V9 et les bannières.
import math, os
H = os.path.dirname(os.path.abspath(__file__)) + '/'
R0 = H + '../'  # captures du lab (cap_en.cjs) : lab-chat-wide, lab-graph, lab-monitor, lab-learn-*
fonts = 'file:///home/user/warband/media/fonts/'
RED = '#E5132B'
W_, H_ = 1600, 800

css = f'''@font-face{{font-family:Geist;src:url({fonts}geist-latin.woff2) format("woff2");font-weight:100 900}}
@font-face{{font-family:JBM;src:url({fonts}jetbrains-mono-latin.woff2) format("woff2");font-weight:100 900}}
*{{box-sizing:border-box;margin:0}}body{{background:#0e0e10;overflow:hidden}}
.stage{{position:relative;width:{W_}px;height:{H_}px;overflow:hidden;background:radial-gradient(900px 620px at 72% 50%,#1b0b0f 0%,#0e0e10 72%)}}
.web{{position:absolute;inset:0;fill:none;stroke:rgba(229,19,43,.10);stroke-width:1}}
.plate{{position:absolute;left:84px;top:0;bottom:0;width:430px;display:flex;flex-direction:column;justify-content:center;color:#f2f3f5;font-family:Geist}}
.num{{font:800 168px/0.9 Geist;letter-spacing:-.05em;color:transparent;-webkit-text-stroke:2.5px #d2d4da}}
.verb{{font:800 92px/1 Geist;letter-spacing:-.035em;text-transform:uppercase;color:{RED};margin-top:10px}}
.sub{{font:700 20px/1 JBM;letter-spacing:.26em;text-transform:uppercase;color:#a3a6ad;margin-top:16px}}
.line{{width:56px;height:3px;background:{RED};margin:34px 0 26px;border-radius:2px}}
.cap{{font:800 40px/1.06 Geist;letter-spacing:-.03em;text-transform:uppercase}}.cap span{{color:{RED}}}
.note{{font:500 19px/1.5 Geist;color:#a3a6ad;margin-top:16px}}
.pane{{position:absolute;background:#1f1f1f;border:1px solid #2f3337;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.3)}}
.pane img{{display:block}}
.head{{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#181818;border-bottom:1px solid #2b2b2b;font:600 12.5px Geist;color:#e7e7e7}}
.head i{{width:8px;height:8px;border-radius:50%;background:{RED};display:inline-block}}
.vig{{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 62%,rgba(0,0,0,.35) 100%)}}
'''

def web(cx, cy):
    n = 16; R = 1700
    rays = ''.join(f'<line x1="{cx}" y1="{cy}" x2="{cx + R * math.cos(a):.1f}" y2="{cy + R * math.sin(a):.1f}"/>' for a in [i * 2 * math.pi / n + 0.1 for i in range(n)])
    rings = []
    for k in range(1, 13):
        r = 40 * k * 1.14 ** k
        pts = [f'{cx + r * (0.93 + 0.07 * math.cos(i * 2.1 + k)) * math.cos(i * 2 * math.pi / n + 0.1):.1f},{cy + r * (0.93 + 0.07 * math.cos(i * 2.1 + k)) * math.sin(i * 2 * math.pi / n + 0.1):.1f}' for i in range(n + 1)]
        rings.append(f'<polyline points="{" ".join(pts)}"/>')
    return f'<svg class="web" width="{W_}" height="{H_}">{rays}{"".join(rings)}</svg>'

def pane(x, y, w, img, cw, ch, title):
    """Fenêtre : img est une capture 2x de cw × ch pixels CSS, affichée à la largeur w."""
    h = round(ch * w / cw)
    return (f'<div class="pane" style="left:{x}px;top:{y}px;width:{w}px"><div class="head"><i></i>{title}</div>'
            f'<img src="{img}" width="{w}" height="{h}"></div>')

def plate(num, verb, sub, cap, note):
    n = f'<div class="num">{num}</div>' if num else ''
    v = f'<div class="verb">{verb}</div>' if verb else ''
    return f'<div class="plate">{n}{v}<div class="sub">{sub}</div><div class="line"></div><div class="cap">{cap}</div><div class="note">{note}</div></div>'

def page(name, plate_html, panes, web_at=(1160, 400)):
    open(H + name + '.html', 'w').write(f'<!doctype html><meta charset="utf-8"><style>{css}</style><body><div class="stage">'
        f'{web(*web_at)}{panes}{plate_html}<div class="vig"></div></div>')

import sys
FR = len(sys.argv) > 1 and sys.argv[1] == 'fr'
CHAT = 'RedWidow: Chat'
if FR:
    css = css + '.verb{font-size:76px}.cap{font-size:36px}'
    CHAT = 'RedWidow : Chat'

if FR:
    page('01-weave-fr', plate('01', 'Tisse.', 'Repérage', 'Donne-lui<br><span>une cible.</span>', 'L’agent lance les scans dans ton<br>conteneur Exegol ou Kali.'),
         pane(590, 70, 960, H + 'fr-chat-agent.png', 980, 640, CHAT))
    page('02-watch-fr', plate('02', 'Guette.', 'Analyse', 'Elle trace<br><span>la kill chain.</span>', 'Chaque commande en direct dans le Monitor,<br>chaque trouvaille reliée dans le graphe.'),
         pane(620, 52, 930, H + 'fr-killchain.png', 981, 450, 'Kill chain') + pane(570, 432, 740, H + 'fr-monitor.png', 981, 340, 'Monitor · kali-1'))
    page('03-strike-fr', plate('03', 'Frappe.', 'Action', 'Pilote-la.<br><span>Ou lâche la bête.</span>', 'Valide chaque action, ou laisse-la<br>travailler seule pour une durée choisie.'),
         pane(590, 70, 960, H + 'fr-chat-approval-wide.png', 980, 640, CHAT))
    page('04-wrap-fr', plate('04', 'Emballe.', 'Rapport', 'Elle écrit<br><span>le rapport.</span>', 'Constats et gravités, matrice de<br>couverture, brouillon Markdown.'),
         pane(590, 70, 960, H + 'fr-chat-bypass.png', 980, 640, CHAT))
    page('05-learn-fr', plate('05', 'Apprends.', 'Mode Apprentissage', 'Bloqué sur une box&nbsp;?<br><span>Elle lit ton terminal.</span>', 'Elle lit ton cours et le terminal cité<br>avec #. Elle n’exécute jamais rien.'),
         pane(586, 72, 512, H + 'fr-terminal.png', 560, 690, 'kali-1') + pane(1118, 72, 430, H + 'fr-chat-learning.png', 470, 690, CHAT))
    page('06-yours-fr', plate('', '', 'À ta façon', '23 jeux de couleurs.<br><span>Une araignée.</span>', 'Couleurs franches et dégradés, pour<br>les thèmes clair, sombre et contrasté.'),
         pane(660, 40, 840, H + 'fr-appearance.png', 1100, 900, 'RedWidow : Réglages'))
else:
    page('01-weave', plate('01', 'Weave.', 'Recon', 'Give it<br><span>a target.</span>', 'The agent runs the scans in your<br>Exegol or Kali container.'),
         pane(590, 70, 960, H + 'chat-agent.png', 980, 640, CHAT))
    page('02-watch', plate('02', 'Watch.', 'Analysis', 'It maps<br><span>the kill chain.</span>', 'Every command live in the Monitor,<br>every finding linked in the graph.'),
         pane(620, 52, 930, R0 + 'lab-graph.png', 981, 450, 'Kill chain') + pane(570, 432, 740, R0 + 'lab-monitor.png', 981, 340, 'Monitor · kali-1'))
    page('03-strike', plate('03', 'Strike.', 'Action', 'Drive it.<br><span>Or unleash it.</span>', 'Approve each action, or let it run<br>in Automatic mode for a set time.'),
         pane(590, 70, 960, R0 + 'lab-chat-wide.png', 980, 640, CHAT))
    page('04-wrap', plate('04', 'Wrap.', 'Report', 'It writes<br><span>the report.</span>', 'Findings with severities, a coverage<br>matrix, a Markdown draft.'),
         pane(590, 70, 960, H + 'chat-bypass.png', 980, 640, CHAT))
    page('05-learn', plate('05', 'Learn.', 'Learning mode', 'Stuck on a box?<br><span>It reads your terminal.</span>', 'It reads your course and the terminal<br>you cite with #. It never runs anything.'),
         pane(586, 72, 512, R0 + 'lab-learn-term.png', 560, 690, 'kali-1') + pane(1118, 72, 430, R0 + 'lab-learn-chat.png', 470, 690, CHAT))
    page('06-yours', plate('', '', 'Make it yours', '23 color sets.<br><span>One spider.</span>', 'Solid colors and gradients, for light,<br>dark and high-contrast themes.'),
         pane(660, 40, 840, H + 'appearance.png', 1100, 900, 'RedWidow: Settings'))
print('ok')
