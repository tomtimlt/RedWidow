// Composants RedWidow en plus : accueil (araignée), accueil en Apprentissage, bypass actif.
const { chromium } = require('playwright');
const dump = require('./dump.cjs');
const OUT = process.argv[2];
const UI = {
  'Peux-tu préparer une vue claire pour notre projet ?': 'Run recon on 10.10.10.14 and suggest an attack path.',
  'Je rassemble les composants, puis je prépare une proposition de disposition.': 'I will scan the target from the Kali container, then check the exposed services.',
  'Tâche de démonstration': 'mcp__kali__execute_command',
  'Préparer le composant 3': 'nmap -sV -T4 10.10.10.14', 'Préparer le composant 4': 'whatweb http://10.10.10.14:8080', 'Préparer le composant 6': 'ffuf -u http://10.10.10.14:8080/FUZZ',
  'réussi': 'done', 'en cours': 'running',
  'Une base lisible et cohérente': 'Attack surface identified',
  'Trois vues complémentaires :': 'Two exposed services:', 'conversation, activités et graphe': 'SSH and an admin panel',
  'Respecter les couleurs du thème VS Code': '/login form has no attempt limit', 'Préserver le clavier et les états de focus': 'The user parameter is echoed in the SQL error',
  'Espacements : 4 · 8 · 12 · 16\nRayons : 6 · 10 · 16': '22/tcp   open  ssh   OpenSSH 9.6p1\n8080/tcp open  http  Werkzeug 3.0.1',
  'On commence par où ?': 'Where do we start?', 'Décris la cible. Chaque action sensible demande ton accord.': 'Describe the target. Every sensitive action asks for your approval.',
  'Prépare une maquette pour le projet': 'Run recon on 10.10.10.14', 'Améliore la navigation de cet espace': 'Explain this nmap output', 'Propose une palette plus lisible': 'Draft the report from my findings',
  'Supervisé': 'Supervised', 'Automatique': 'Automatic', 'Apprentissage': 'Learning', 'Historique': 'History', 'Nouvelle': 'New', 'conversation': 'conversation', 'Modèle équilibré': 'Balanced model', 'Configurer': 'Configure',
  'Repérage': 'Recon', 'Analyse': 'Analysis', 'Rapport': 'Report', 'Rapport de relecture': 'Findings report', '4 constats': '4 findings',
  'Élevée': 'High', 'Moyenne': 'Medium', 'Faible': 'Low', 'Info': 'Info', '1 élevée · 1 moyenne · 1 faible · 1 info': '1 high · 1 medium · 1 low · 1 info',
  'Contraste insuffisant des libellés secondaires': 'SQL injection on /login', 'Thème clair · étiquettes des tableaux': 'http://10.10.10.14:8080 · user parameter',
  'Focus peu visible sur les liens du tableau': 'Admin panel without rate limiting', 'Navigation au clavier': '/login · brute force possible',
  'Espacement irrégulier entre les cartes': 'Verbose server banner', 'Historique long': 'Werkzeug 3.0.1 disclosed',
  'Palette Sentinelle lisible dans les trois thèmes': 'SSH open to the lab network', 'Composant': 'Service', 'État': 'Status', 'Navigation': 'ssh', 'Prête': 'filtered', 'Graphe': 'http-admin', 'À relire': 'to test', 'Copier': 'Copy', 'texte': 'nmap', 'Clair, sombre, contraste élevé': '22/tcp · OpenSSH 9.6p1' };
const tr = (ui) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const ns = []; let n; while ((n = w.nextNode())) ns.push(n); for (const nd of ns) { const t = nd.nodeValue.trim(); if (t in ui) nd.nodeValue = nd.nodeValue.replace(t, ui[t]); } document.querySelectorAll('.demo-toolbar,.notice.info').forEach((e) => e.remove()); const i = document.getElementById('input'); if (i) i.placeholder = 'Your prompt…'; document.activeElement?.blur?.(); };
(async () => {
  const b = await chromium.launch();
  for (const [name, scenario, w, h, setup] of [
    ['chat-bypass-tall', 'conversation', 470, 849, () => { document.body.classList.add('automatic-on'); const bd = document.getElementById('automatic-badge'); bd.hidden = false; bd.textContent = 'Bypass 1:58'; const r = document.getElementById('roe'); if (r) { r.hidden = false; r.dataset.level = '3'; const l = document.getElementById('roe-label'); if (l) l.textContent = 'Automatic'; } }]
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://127.0.0.1:4173/?view=chat&scenario=${scenario}&theme=dark&palette=widow`); await p.waitForTimeout(1300);
    await p.evaluate(setup); await p.evaluate(tr, UI);
    await p.evaluate(() => { const log = document.getElementById('log'); if (log) log.scrollTop = 1e6; });
    await p.waitForTimeout(2600);
    await p.screenshot({ path: `snap/${name}.png` });
    await dump(p, name, w, h);
    await p.close();
  }
  await b.close();
})();
