// Sérialise la page de l'aperçu en composant HTML statique, sans script, enveloppé dans .vo-ui.
const fs = require('fs');
module.exports = async function dump(p, file, w, h, opts = {}) {
  const out = process.env.SNAP; if (!out) return;
  const html = await p.evaluate(({ w, h, only }) => {
    document.querySelectorAll('[popover]').forEach((e) => { if (e.matches(':popover-open')) e.dataset.open = '1'; });
    document.querySelectorAll('*').forEach((e) => { if (e.scrollTop > 0) e.setAttribute('data-scroll-top', String(Math.round(e.scrollTop))); });
    document.querySelectorAll('input, textarea').forEach((e) => { if (e.value && e.type !== 'range') e.setAttribute('value', e.value); if (e.placeholder) e.setAttribute('placeholder', e.placeholder); });
    const body = document.body.cloneNode(true);
    body.querySelectorAll('script, .demo-toolbar, .notice.info').forEach((e) => e.remove());
    body.querySelectorAll('[popover]').forEach((e) => { if (e.dataset.open) { e.removeAttribute('popover'); e.removeAttribute('data-open'); } else e.remove(); });
    if (only) { const el = body.querySelector(only); const r = document.querySelector(only).getBoundingClientRect(); w = Math.ceil(r.width); h = Math.ceil(r.height); el.style.left = '0px'; el.style.top = '0px'; el.style.margin = '0'; body.innerHTML = ''; body.append(el); }
    const wrap = document.createElement('div');
    wrap.className = 'vo-ui ' + body.className; for (const a of body.attributes) if (a.name.startsWith('data-')) wrap.setAttribute(a.name, a.value);
    wrap.setAttribute('style', `width:${w}px;height:${h}px`);
    wrap.innerHTML = body.innerHTML;
    return wrap.outerHTML;
  }, { w, h, only: opts.only });
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${file}</title>
<link rel="stylesheet" href="css/redwidow-ui.css">
<script src="redwidow-ui.js" defer></script>
<style>html,body{margin:0;background:#0b0b0d}</style></head>
<body>
<!-- component:start -->
${html}
<!-- component:end -->
</body></html>
`;
  fs.writeFileSync(`${out}/${file}.html`, page);
};
