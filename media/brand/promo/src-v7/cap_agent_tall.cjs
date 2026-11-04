const { chromium } = require('playwright');
const dump = require('./dump.cjs');
const T = '10.10.10.14';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 470, height: 849 }, deviceScaleFactor: 1 });
  await p.goto('http://127.0.0.1:4173/?view=chat&scenario=conversation&theme=dark&palette=widow'); await p.waitForTimeout(1400);
  await p.evaluate((T) => {
    document.querySelectorAll('.demo-toolbar,.notice.info,#log > section.report').forEach((e) => e.remove());
    const rows = [...document.querySelectorAll('#log > .msg-row')];
    rows[0].querySelector('.msg').textContent = `Recon ${T} and find me a way in.`;
    rows[1].querySelector('.msg').innerHTML = '<p>On it. Scanning the target from <code>kali-1</code>.</p>';
    const group = document.querySelector('#log > .tool-group');
    const tpl = group.querySelector('details');
    while (group.children.length < 4) group.append(tpl.cloneNode(true));
    const cmds = [`nmap -sV -T4 ${T}`, `whatweb http://${T}:8080`, `ffuf -u http://${T}:8080/FUZZ -w common.txt`, `sqlmap -u http://${T}:8080/login --batch`];
    [...group.children].forEach((d, i) => { d.className = 'tool ok'; d.querySelector('.tool-name').textContent = 'mcp__kali__execute_command'; d.querySelector('.tool-summary').textContent = cmds[i]; d.querySelector('.tool-state').textContent = 'done'; });
    rows[2].querySelector('.msg').innerHTML = '<h3 class="md-h">Way in: SQL injection on /login</h3><p>sqlmap confirms a boolean-based injection on the <code>user</code> parameter of the admin panel.</p><ul><li>Admin panel on <code>:8080</code>, no rate limit on <code>/login</code></li><li>Next: pull the admin hash, then try it on SSH</li></ul>';
    const ui = { 'Supervisé': 'Supervised', 'Historique': 'History', 'Nouvelle': 'New', 'conversation': 'conversation', 'Modèle équilibré': 'Balanced model', 'Copier': 'Copy', 'Configurer': 'Configure', 'Repérage': 'Recon', 'Analyse': 'Analysis', 'Action': 'Action', 'Rapport': 'Report' };
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const ns = []; let q; while ((q = tw.nextNode())) ns.push(q);
    for (const nd of ns) { const t = nd.nodeValue.trim(); if (t in ui) nd.nodeValue = nd.nodeValue.replace(t, ui[t]); }
    document.getElementById('input').placeholder = 'Your prompt…';
    document.activeElement?.blur?.();
  }, T);
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'snap/chat-agent-tall.png' });
  await dump(p, 'chat-agent-tall', 470, 849);
  console.log(await p.evaluate(() => ({ mission: document.getElementById('mission')?.hidden, thinking: document.getElementById('thinking')?.outerHTML.slice(0, 400) })));
  await b.close();
})();
