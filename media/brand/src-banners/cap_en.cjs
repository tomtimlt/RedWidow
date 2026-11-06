// Captures de l'atelier avec textes anglais (interface comprise) sur un lab fictif.
const { chromium } = require('playwright');

const T = '10.10.10.14';
const UI = {
  'Supervisé': 'Supervised', 'Apprentissage': 'Learning', 'Historique': 'History', 'Nouvelle': 'New', 'conversation': 'conversation',
  'Repérage': 'Recon', 'Analyse': 'Analysis', 'Rapport': 'Report', 'Copier': 'Copy',
  'réussi': 'done', 'en cours': 'running', 'lu': 'read',
  'Autorisation requise': 'Authorization required', 'Exécution': 'Execution', 'Mémorisable': 'Rememberable',
  'Outil': 'Tool', 'Raison': 'Reason', 'Détails': 'Details',
  'Autoriser une fois': 'Allow once', 'Refuser': 'Deny', 'Toujours': 'Always',
  'En attente de votre accord': 'Waiting for your approval', 'Modèle équilibré': 'Balanced model',
  'Ajuster': 'Fit', 'Exporter le brouillon': 'Export draft', 'Exporter l’image': 'Export image', 'Rejouer': 'Replay',
  'Légende': 'Legend', 'Type': 'Type', 'Hôte': 'Host', 'Identifiant': 'Credential', 'Étape': 'Step', 'Loot': 'Loot',
  'État': 'State', 'Confirmé': 'Confirmed', 'Hypothèse': 'Hypothesis', 'Échec': 'Failed', 'Echec': 'Failed', 'Etape': 'Step',
  'Ressource': 'Host', 'Référence': 'Credential', 'Résultat': 'Loot', 'Terminé': 'Confirmed', 'Prévu': 'Hypothesis',
  'Chemin retenu : liens verts marqués par l’agent ou par vous. Sélectionnez un lien pour le modifier.': 'Selected path: green links marked by the agent or by you. Select a link to edit it.',
  'commandes': 'commands', '3 commandes': '3 commands', 'Suivi': 'Follow', 'approuvé': 'approved',
  'Sortie en direct. Cliquer une entrée pour la suivre en lecture seule.': 'Live output. Click an entry to follow it read-only.',
  'Votre consigne…': 'Your prompt…', 'Configurer': 'Configure'
};
const chat = {
  'Peux-tu préparer une vue claire pour notre projet ?': `Run recon on ${T} and suggest an attack path.`,
  'Je rassemble les composants, puis je prépare une proposition de disposition.': 'I will scan the target from the Kali container, then check the exposed services.',
  'Tâche de démonstration': 'mcp__kali__execute_command',
  'Préparer le composant 3': `nmap -sV -T4 ${T}`, 'Préparer le composant 4': `whatweb http://${T}:8080`, 'Préparer le composant 6': `ffuf -u http://${T}:8080/FUZZ`,
  'Une base lisible et cohérente': 'Attack surface identified',
  'Trois vues complémentaires :': 'Two exposed services:', 'conversation, activités et graphe': 'SSH and an admin panel',
  'Respecter les couleurs du thème VS Code': '/login form has no attempt limit', 'Préserver le clavier et les états de focus': 'The user parameter is echoed in the SQL error',
  'texte': 'nmap', 'Espacements : 4 · 8 · 12 · 16\nRayons : 6 · 10 · 16': '22/tcp   open  ssh   OpenSSH 9.6p1\n8080/tcp open  http  Werkzeug 3.0.1',
  'Composant': 'Service', 'État': 'Status', 'Navigation': 'ssh', 'Prête': 'filtered', 'Graphe': 'http-admin', 'À relire': 'to test',
  'Préparer la présentation': 'mcp__kali__execute_command', 'Afficher une variante du composant': `sqlmap -u http://${T}:8080/login --batch`,
  'Scénario de démonstration : validation attendue.': 'Confirm the SQL injection on /login (authorized lab).'
};
const graph = {
  'Brief du projet': `Scan ${T}`, 'resource · P01': 'host · T1046', 'Références visuelles': 'Admin panel :8080', 'site · P02': 'site · T1595',
  'Palette et typographie': 'Default accounts', 'reference · P02': 'credential · T1078', 'Variante écartée': 'SSH brute force', 'step · P03': 'step · T1190',
  'Disposition des panneaux': 'SQLi on /login confirmed', 'Relecture de la navigation et des états vides': 'www-data shell via webshell', 'step · P04': 'step · T1059',
  'Maquette de présentation': 'Root escalation', 'result · P05': 'loot · T1068'
};
const out3 = ['Starting Nmap 7.95 ( https://nmap.org )', `Nmap scan report for ${T}`, 'Host is up (0.031s latency).', 'Not shown: 998 closed tcp ports', 'PORT     STATE SERVICE VERSION', '22/tcp   open  ssh     OpenSSH 9.6p1', '8080/tcp open  http    Werkzeug httpd 3.0.1', 'Nmap done: 1 IP address (1 host up)'];
const out4 = [`http://${T}:8080 [200 OK]`, 'HTTPServer[Werkzeug/3.0.1 Python/3.12]', 'PasswordField[password]', 'Title[Admin · Login]', 'Cookies[session]', 'HttpOnly[session]', 'X-Frame-Options[DENY]', 'UncommonHeaders[x-request-id]'];
const out6 = [':: Method     : GET', `:: URL        : http://${T}:8080/FUZZ`, ':: Wordlist   : common.txt', ':: Matcher    : 200-299,301,302,401,403', '________________________________________', 'login        [Status: 200, Size: 1843, Words: 412]', 'admin        [Status: 302, Size: 189, Words: 18]', 'api          [Status: 401, Size: 52, Words: 4]', 'static       [Status: 301, Size: 179, Words: 14]', 'logout       [Status: 302, Size: 189, Words: 18]', 'health       [Status: 200, Size: 15, Words: 1]', 'robots.txt   [Status: 200, Size: 41, Words: 4]', 'backup       [Status: 403, Size: 199, Words: 18]', 'uploads      [Status: 301, Size: 181, Words: 14]', 'users        [Status: 401, Size: 52, Words: 4]', 'reset        [Status: 200, Size: 1290, Words: 301]', 'debug        [Status: 403, Size: 199, Words: 18]', 'metrics      [Status: 401, Size: 52, Words: 4]', 'docs         [Status: 200, Size: 2213, Words: 498]', 'graphql      [Status: 401, Size: 52, Words: 4]', 'status       [Status: 200, Size: 27, Words: 2]', 'config       [Status: 403, Size: 199, Words: 18]', '', ':: Progress: [4744/4744] :: 312 req/sec :: Errors: 0 ::'];
const mon = { 'atelier-ui': 'kali-1', 'demo preview composant-3': `nmap -sV -T4 ${T}`, 'demo preview composant-4': `whatweb http://${T}:8080`, 'demo preview composant-6': `ffuf -u http://${T}:8080/FUZZ -w common.txt` };
// view, scénario, viewport, nom de fichier, carte de textes
const shots = [
  ['chat', 'approval', 470, 849, 'lab-chat', chat], ['graph', 'conversation', 981, 450, 'lab-graph', graph], ['monitor', 'approval', 981, 340, 'lab-monitor', mon],
  ['chat', 'approval', 980, 640, 'lab-chat-wide', chat]
];
(async () => {
  const b = await chromium.launch();
  for (const [view, scenario, w, h, name, map] of shots) {
    const p = await b.newPage({ viewport: { width: w, height: h + 60 }, deviceScaleFactor: 2 });
    await p.goto(`http://127.0.0.1:4173/?view=${view}&scenario=${scenario}&theme=dark&palette=widow`);
    await p.waitForTimeout(1600);
    await p.evaluate(({ map, ui, outs }) => {
      document.querySelectorAll('.demo-toolbar,.notice.info').forEach((e) => e.remove());
      const all = { ...ui, ...map };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const nodes = []; let n; while ((n = w.nextNode())) nodes.push(n);
      for (const node of nodes) {
        const s = node.nodeValue.trim();
        if (s in all) node.nodeValue = node.nodeValue.replace(s, all[s]);
        const m = /^Étape (\d+) · aperçu du composant (\d)$/.exec(s);
        if (m) node.nodeValue = (outs[m[2]] || [])[+m[1] - 1] ?? '';
      }
      const input = document.getElementById('input'); if (input) input.placeholder = 'Your prompt…';
      document.activeElement?.blur?.();
    }, { map, ui: UI, outs: { 3: out3, 4: out4, 6: out6 } });
    if (name === 'lab-chat-wide') await p.evaluate(() => { document.querySelectorAll('#log .md-table, #log .codeblock').forEach((e) => e.remove()); const rows = [...document.querySelectorAll('#log > .msg-row.agent')]; if (rows[1]) rows[1].remove(); });
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(250);
    await p.evaluate(() => { for (const el of document.querySelectorAll('#log, .mon-list, main, body')) el.scrollTop = 1e6; });
    if (view === 'graph') { await p.focus('.kc-viewport'); await p.keyboard.press('0'); await p.waitForTimeout(400); await p.evaluate(() => document.activeElement?.blur?.()); }
    await p.waitForTimeout(250);
    await p.screenshot({ path: name + '.png' });
    await p.close();
  }
  await b.close();
})();
