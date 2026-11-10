# Bannière d'en-tête française (1280 × 640, photographiée en 2x) avec le gabarit de gen.py.
import runpy, os
H = os.path.dirname(os.path.abspath(__file__)) + '/'
ns = runpy.run_path(H + '../readme/gen.py')
GAP = 24; P = ns['panel']; T = ns['tab']
rel = '../readme10/'
shot = (P(0, 0, 470, 849, rel + 'fr-chat-approval-tall.png', 'RedWidow : Chat')
    + P(470 + GAP, 0, 981, 450, rel + 'fr-killchain.png', tabs=T('Cockpit') + T('Réglages') + T('Kill chain', True))
    + P(470 + GAP, 485 + GAP, 981, 340, rel + 'fr-monitor.png', tabs=T('Monitor · kali-1', True)))
html_copy = (ns['MARK'] + '<h1>Tisse. Guette.<br><span>Frappe. Emballe.</span></h1>'
    '<p>L’atelier de pentest dopé à l’IA pour VS Code.<br>Conteneurs Exegol et Kali, terminaux, Monitor,<br>kill chain et rapports au même endroit.</p>'
    + ns['facts'](['Open source', 'Exegol', 'Docker Kali', 'Mode Apprentissage']))
ns['page']('banner-github-fr.html', 1280, 640, html_copy, dict(left=72, top=172, m=17, h=52, b=19, g1=40, g2=18, g3=28, f=14), shot, (612, 56, 0.6))
os.replace(H + '../readme/banner-github-fr.html', H + 'banner-github-fr.html')
print('ok')
