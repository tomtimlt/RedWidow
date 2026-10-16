# Spécification de design : chat VS Code (surface plate)

Les dégradés cyan/magenta, le balayage et le halo coloré sont retirés. La surface reprend les captures : filet 1 px, texte du thème, un accent pour le focus et le bouton principal. Les animations qui restent sont l'indicateur de travail et l'entrée des cartes (opacité, léger déplacement).

- Statut : décidé (architecte), 2026-10-15. Cadre : ADR 0004 §C (CSP à nonce, `textContent`, aucune ressource distante), ADR 0005 (modèle, effort).
- Cible : VS Code ≥ 1.90 (`extension.manifest.json:8`) = Chromium 122. Disponibles : container queries, `color-mix()`, `:has()`, API `popover`. **Indisponible : CSS anchor positioning** (placement calculé en JS).

## 1. Système de design (`media/chat.css`, en tête, préfixe `--jn-`)

- Espacements `--jn-s1..s5` = 4, 8, 12, 16, 24 px. Rayons : `--jn-r-sm` 4, `--jn-r-md` 8, `--jn-r-lg` 12 (composer), `--jn-r-pill` 999px.
- Ombre unique `--jn-shadow-pop: 0 8px 24px var(--vscode-widget-shadow, #0006)` (popovers seulement).
- Durées `--jn-d1` 120 ms (hover), `--jn-d2` 200 ms (entrées), `--jn-d3` 600 ms (balayage). Easings `--jn-ease-out: cubic-bezier(.2,.8,.2,1)`, `--jn-ease-io: cubic-bezier(.4,0,.2,1)`.
- Palette **dérivée du thème**, jamais de couleur figée hors repli de `var()` :
  - `--jn-accent: var(--vscode-focusBorder, var(--vscode-button-background))` ; `--jn-accent-2: var(--vscode-terminal-ansiMagenta, var(--jn-accent))` ; `--jn-cool: var(--vscode-terminal-ansiCyan, var(--jn-accent))`.
  - Halo : `--jn-glow: color-mix(in srgb, var(--jn-accent) var(--jn-glow-pct), transparent)` avec `--jn-glow-pct` = 45 % (sombre), 20 % (`body.vscode-light`).
  - Surfaces : `--vscode-input-background`, `--vscode-editorWidget-background`, `--vscode-dropdown-*`, `--vscode-list-activeSelection*`.
- **Contraste élevé** (`body.vscode-high-contrast`, `body.vscode-high-contrast-light`, `@media (forced-colors: active)`) : `--jn-glow-pct: 0%`, aucun dégradé, bordures `--vscode-contrastBorder`, focus `--vscode-contrastActiveBorder` 2 px, **effets coupés** (interrupteur §2).
- Icônes : glyphes Unicode (`▾ ↑ ■ ⟳ ✓`) ou SVG créé par `createElementNS`. **Pas de police codicons** (exigerait `font-src` et une dépendance).

## 2. Effets et budget de performance

Liste **fermée** ; tout effet absent est interdit.

| # | Effet | Déclencheur | Technique |
|---|---|---|---|
| E1 | Halo néon du composer | `:focus-within` | `::before` portant un `box-shadow` **statique** `0 0 0 1px accent, 0 0 12px glow` ; seule son `opacity` transite (`--jn-d2`). |
| E2 | Balayage du composer au changement de modèle | `controls.model` change **dans la vue reçue** (valeur acceptée par l'extension, pas le clic) | `::after` en `linear-gradient` étroit, `transform: translateX(-100%→100%)`, `--jn-d3`, une fois. Relance sans reflow : alterner les classes `sweep-a`/`sweep-b` (deux `@keyframes` identiques). |
| E3 | « Pop » de la pastille de modèle | même déclencheur | `transform: scale(.96→1)` + `::before` halo `opacity 0→1→0`, 300 ms, une fois. |
| E4 | Indicateur « thinking » | `body.running` sans approbation en attente | Spinner braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` en **bande verticale** (une trame par ligne, boîte `height:1lh; overflow:hidden`), `translateY` en `steps(10)`, 1 s ; libellé en police de l'éditeur ; curseur `▍` en `opacity` `steps(2)` ; scanline = `::after` 1 px en dégradé, `translateY` sur la seule rangée, `opacity` ≤ .25. |
| E5 | Entrée d'une carte d'approbation | ajout | `opacity 0→1` + `translateY(4px→0)`, `--jn-d2`, une fois ; liseré gauche accent statique. |
| E6 | Survols/états des boutons, pastilles, options | hover/active | `transition` de `color`, `background-color`, `border-color`, `opacity`, `transform` seulement, `--jn-d1`. |

Règles fermes :
- `@keyframes` : **uniquement `transform` et `opacity`**. `transition` : la liste de E6, jamais `all`. Interdits partout : `backdrop-filter`, `blur(`, `filter` animé, animation de `box-shadow`, `width/height/top/left/margin/padding`, `background-position`.
- Animations infinies : **au plus 3, toutes sous `#thinking`** (E4). Le spinner par outil en attente est **supprimé** (icône statique `◌`) : un seul foyer de mouvement.
- `#thinking` est `display:none` hors `body.running` : rien ne tourne sans run. Approbation en attente → libellé « En attente de votre accord », animations figées (aucun mouvement pendant qu'on attend l'humain).
- `visibilitychange` (la vue a `retainContextWhenHidden`) → `body.paused` → `animation-play-state: paused`.
- JS : **ni `requestAnimationFrame` ni `setInterval`** pour le visuel ; aucun écouteur `scroll` visuel ; mesures (`getBoundingClientRect`) seulement à l'ouverture d'un popover et dans un `ResizeObserver` actif tant qu'il est ouvert. `will-change` seulement sur la bande du spinner.
- Interrupteur global : `@media (prefers-reduced-motion: reduce)`, contraste élevé et `forced-colors` appliquent à `body *, ::before, ::after` : `animation: none !important; transition: none !important`. Le spinner devient le texte statique « … ».
- **CSP inchangée** : aucun `<style>`, aucun attribut `style=`, aucun `setAttribute("style")`, aucun `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`. États = classes togglées par JS. Seule écriture de style admise : `el.style.setProperty("--jn-…", valeur numérique)` (CSSOM, non soumis à `style-src`) pour le placement du popover et le remplissage du curseur, plus la hauteur existante du `textarea`.

## 3. Responsive (container queries)

`body { container: app / inline-size }`. Points de rupture sur la largeur : **compact < 360 px**, **standard 360–599**, **large ≥ 600**.

| Zone | Compact | Standard | Large |
|---|---|---|---|
| En-tête | boutons en icône seule (texte en `.sr-only`, `title`) ; badge bac à sable tronqué | texte court | idem |
| Fil | messages 100 % | `max-width: 92%` | colonne centrée `max-width: 820px` |
| Composer | barre d'outils sous le `textarea` : pastille modèle (libellé tronqué, `min-width:0`), « ⚙ » seul, envoyer/stop en icône | pastille + « Configurer ▾ » avec niveau d'effort | idem, centré 820 px |
| Popover Configurer | une colonne | une colonne | deux colonnes (≥ 480 px de popover) |

- Plus de barre `#controls` séparée : modèle et configuration vivent dans le composer. Aucun élément ne fixe une largeur > 100 % du conteneur ; textes longs en `ellipsis`.
- Popover : `position: fixed` dans la couche supérieure (`popover`), largeur `min(naturelle, 100vw - 16px)`, `max-height` calculée, défilement interne. Placement par `placePopover` (§5) : au-dessus de l'ancre par défaut (composer en bas), bascule dessous si la place manque, recalage horizontal dans `[8, vw - 8 - largeur]`.
- Cibles : 28 px de haut (24 px minimum en compact), tout atteignable au clavier, focus toujours visible.

## 4. Composants

**(a) Sélecteur de modèle** (remplace `<select>` et `#models-refresh`). Pastille `button` `aria-haspopup="listbox"` `aria-expanded` → popover : champ de filtre `role="combobox"` (`aria-controls`, `aria-activedescendant`), liste `role="listbox"`, options `role="option"` `aria-selected`/`aria-disabled`. Chaque option : libellé, description (1 ligne, `ellipsis`, complète en `title`), badge « actuel ». Groupes : « Par défaut » (entrée `null` = défaut) puis la liste du SDK. Clavier : ↑/↓ (sautent les désactivées), Début/Fin, Entrée choisit, Échap ferme et rend le focus à la pastille, saisie = filtre (`includes` insensible à la casse, **jamais de RegExp construite depuis la saisie**). Pied : « Actualiser la liste ». Liste indisponible : le popover montre la saisie libre actuelle. Verrouillé (`locked`) : pastille `aria-disabled`, popover non ouvrable. Message posté : **`setModel` existant inchangé** ; l'extension revalide.

**(b) Configurer ▾** : popover `role="dialog"` `aria-label`, piège de focus (Tab/Maj+Tab cyclent), Échap et clic extérieur ferment (`popover="auto"`), focus rendu au déclencheur. Colonne « Raisonnement » : curseur d'effort natif `input[type=range]` conservé (accessibilité native), piste en dégradé `--jn-cool → --jn-accent-2` (`::-webkit-slider-runnable-track`), remplissage via `--jn-pct`, crans cliquables sous la piste (désactivés barrés), bouton « Auto », infobulle du niveau en texte sous le curseur. Colonne « Exécution » : fournisseur en radios à coche (Claude coché ; OpenCode `disabled`, « bientôt »), bac à sable et réseau **en lecture seule** à partir des données déjà présentes dans la vue. **Aucun nouveau type de message IPC** dans ce chantier.

**(c) Boutons** : `primary` (bouton du thème + halo E1 au focus), `secondary`, `ghost`, `danger` (`--vscode-inputValidation-errorBorder`/`errorForeground`). États : hover (E6), `:focus-visible` (anneau 1 px accent + halo statique, 2 px `contrastActiveBorder` en contraste élevé), active (`scale(.97)`), disabled (`opacity .5`, aucun survol). Pastille = `ghost` en `--jn-r-pill`.

**(d) Cartes et outils** : carte = E5 + liseré ; boutons inchangés en sémantique (« toujours » reste sous modale native). Lignes d'outils : survol E6, icône de résultat `scale(1.2→1)` une fois ; dépliage sans animation de hauteur.

**(e) Thinking** : `#thinking` (remplace `#activity`) **hors du `role="log"`**, collé au-dessus du composer, `role="status"` ; parties animées `aria-hidden`. Libellé : « Réflexion », sinon « Outil : <nom> » du dernier outil en attente, sinon « En attente de votre accord ».

## 5. Plan de lots

Logique pure dans **`media/ui.js`** (script classique, chargé par un second `<script nonce src>` ; exporte `module.exports` si `module` existe, sinon `globalThis.JohnUI`), testée par vitest via `createRequire`. Pas de bundler ajouté.

- **U1 — Jetons, composer, responsive, boutons.** `chat.css`, `chat.js`, `html.ts`, tests. Critères : test `test/css-motion.test.ts` qui analyse `chat.css` : propriétés des `@keyframes` ⊆ {transform, opacity} ; `transition(-property)` ⊆ liste E6, pas `all` ; aucun `backdrop-filter`/`blur(` ; règles `infinite` seulement sous `#thinking` ; présence de l'interrupteur (reduced-motion, contraste élevé, forced-colors). Test `chat.js` : aucun `innerHTML|outerHTML|insertAdjacentHTML|document.write|setAttribute("style"|requestAnimationFrame|setInterval|eval|new Function`. Test CSP de `html.ts` inchangé et étendu : chaque `<script>` a le nonce et une source de l'extension, aucun `style=`, aucun `<style>`.
- **U2 — Sélecteur et Configurer** (revue sécurité architecte). `ui.js` : `listboxKey(state, key, options) → state` (flèches, Début/Fin, saut des désactivées, bouclage), `filterModels(models, query)`, `placePopover(anchor, size, viewport, margin) → {x, y, side, maxHeight}`, `effortPct`. Critères : tests de navigation (désactivées sautées, liste vide, toutes désactivées), placement (bascule haut/bas, recalage aux deux bords, viewport de 280 px plus étroit que le popover), filtre avec `.*(` traité littéralement ; un libellé `<img onerror>` affiché inerte (preview).
- **U3 — Effets et thinking.** `ui.js` : `bodyClasses(view, {hidden, reducedMotion}) → string[]` et `activityLabel(view)`. Critères : tests de la correspondance (idle, running, approbation en attente, caché, lecture seule) ; changement de modèle refusé par l'extension → pas de balayage.
- **U4 — Vérification perf et accessibilité.** `preview.test.ts` génère la page **avec la CSP** (`cspSource` = `file:`, nonce `preview` sur le shim, thème en `<link>` vers `preview/theme-{dark,light,hc}.css`), un écouteur `securitypolicyviolation` ajoute `#csp-violation`. `scripts/preview-shots.mjs` (manuel, hors `pnpm check`, binaire `EDGE_BIN` sinon chemin Edge par défaut) : `msedge --headless=new --screenshot --window-size=W,800` pour W ∈ {280, 360, 520, 900} × 3 thèmes × états (idle, running, popover ouvert), puis `--dump-dom` sans `#csp-violation`. Critères : aucun débordement horizontal (`scrollWidth ≤ clientWidth` signalé par le shim dans le DOM), captures relues ; dans VS Code (« Open Webview Developer Tools », Performance, 10 s de run sans événement) : aucune entrée Layout, repaint limité à `#thinking` (Paint flashing), processus webview < 3 % CPU, 0 % vue cachée ; navigation complète au clavier et lecteur d'écran (NVDA) sur les deux popovers.

Interdits pour tous les lots : nouvelle dépendance (police, framework, codicons), modification de la CSP, ressource distante, nouveau message IPC, texte du modèle hors `textContent`.

## Questions ouvertes (réponses, 2026-10-15)

- `workbench.reduceMotion` : le média `prefers-reduced-motion` honoré par la webview suffit (interrupteur CSS, plus la classe `reduce-motion` pilotée par `matchMedia`). Pas de champ `reduceMotion` dans la vue.
- État réseau : champ `sandboxNetwork` (`none` | `bridge` | `null`) dans la vue. Colonne « Réseau » : « réseau activé » si `bridge`, « Coupé » si bac à sable actif en `none`, « Sans objet » sans bac à sable ; l'en-tête reprend « réseau activé » seulement en `bridge`.
- Écarts : les « points de pulsation » du thinking ne sont pas réalisés (budget de 3 animations infinies : spinner, curseur, scanline). Les popovers s'ouvrent par `popovertarget` (activation déclarative) et `beforetoggle` refuse l'ouverture quand le modèle est verrouillé.
