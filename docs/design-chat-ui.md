# Spécification de design : webviews VS Code (chat, cockpit, studio)

## Décision visuelle actuelle — intégration de la 0.3.53

L’[ADR 0028](adr/0028-integration-refonte-interface.md) prime sur les prescriptions
visuelles historiques ci-dessous : charte « Acier et signature », Geist locale,
cinq palettes, rails, rayons 8/12/18 et pilules, nouvelle marque et animations
respectant le mouvement réduit. Les obligations de CSP, accessibilité, vérité
des données, contrôle des approbations et isolation restent applicables.
Le Bypass réel conserve le contrat de l’ADR 0017 ; les mentions historiques
« bientôt » ou « non câblé » ne décrivent pas sa réalisation actuelle.


## Décision visuelle actuelle — refonte du 24 octobre 2026

La demande du propriétaire de revoir toute l’interface à partir de ses trois
captures est cadrée dans [design-interface-2026.md](design-interface-2026.md).
Ce document prime sur les prescriptions visuelles historiques ci-dessous :
accent courant dérivé des boutons/liens VS Code, marque discrète, surfaces
neutres, réponses intégrées, lignes d’outils compactes, Configurer sur deux
colonnes lorsque la place le permet, conteneurs en liste et création à la
demande. Les icônes de l’interface sont des SVG locaux cohérents ; les anciens
glyphes décoratifs sont remplacés.

Les obligations de CSP, rendu sûr, vérité des données, accessibilité et respect
du mouvement réduit restent applicables. Les anciens choix de couleur de marque
sur les boutons courants, de bandeau noir forcé ou de menu toujours à une colonne
ne doivent pas empêcher la réalisation de la refonte demandée.

## 0. Amendement chat conversationnel (2026-10-23)

Décision utilisateur du 2026-10-23. Cette section prime, pour la webview de chat seulement, sur « formes anguleuses » (intro) et sur §1.3 (rayons 2/3/4 px). Le chat quitte l'aspect tableau de bord : assistant conversationnel sobre, intégré au thème VS Code. Pas de glassmorphism, pas de dégradé, jaune de marque en accent rare. Mouvement, keyframes, CSP, protocole et ids : inchangés (§2, ADR 0004 §C).

Jetons partagés (la feuille est unique) : `--jn-r-sm` 6 px, `--jn-r-md` 8 px, `--jn-r-lg` 12 px, `--jn-gutter` 16 px. Cockpit, studio et panneau éditeur héritent de ces quatre valeurs et de rien d'autre dans cet amendement. Leurs sélecteurs testés restent (capitales des `h3` cockpit/studio, `.studio-card` en `border-radius: var(--jn-r-lg)`). Interdit : `999px`, `--jn-r-pill`, cercle. Pouce d'effort : `border-radius: 0`. Toute autre `border-radius` vaut `0` ou un de ces trois jetons. Le moniteur (`#monitor`, 820 px) ne passe pas à 720 px.

Fil du chat, en CSS seulement :

- `#bar` : filet `#bar::after` retiré (`opacity: 0`). Hauteur compacte (`min-height: 36px`). Logo, `#history-btn`, `#reset`, badges conservés. Le sélecteur est partagé : le filet disparaît aussi sur l'en-tête cockpit.
- Dès `@container app (min-width: 600px)`, colonne de lecture `width: min(720px, calc(100% - 2 * var(--jn-gutter)))` et `margin-inline: auto` pour `#log`, `#form`, `#approvals`, `#thinking`, `#no-provider`, `#readonly`. `#log` : `padding` vertical `--jn-s4`, `gap` `--jn-s5`.
- `.msg.agent` : sélecteur conservé. `max-width: 100%`, `padding: 0`, `border: 0`, `background: transparent`, `border-radius: 0`. Prose pleine largeur, sans liseré.
- `.msg.user` : bulle à droite, `max-width: 85%`, `padding: 10px 14px`, rayon `--jn-r-lg` (plus de coin coupé en `--jn-r-sm`). `background: var(--jn-accent-wash)` et `border: 1px solid var(--jn-accent-edge)` obligatoires. Pas d'aplat `--jn-brand`.
- `.tool-group` : `border: 0`, `background: transparent`. `.tool` sans filet. `summary` sans boîte au repos. `.tool-body pre` : mono, `max-height: 14em`, `overflow: auto`, fond `--vscode-textCodeBlock-background`, rayon `--jn-r-md`. Statuts : `.tool.pending .icon` → `--jn-accent` ; `.tool.ok .icon` → `--jn-ok` ; `.tool.error .icon` et `.tool.denied .icon` → `--jn-err`. Icônes de `chat.js` inchangées.
- `.codeblock` : fond `--vscode-textCodeBlock-background`, bordure `1px` en `--jn-line` à 45 % d'opacité, `pre` en `overflow-x: auto`, bouton Copier ghost inchangé. Hiérarchie CSS seule sur `.md-h` (graisse 600), listes et `.md-table`. Pas de coloration. Parseur et liste blanche inchangés (pas de lien, pas de citation).
- `.card` : compacte. Conserver `border-left: 2px solid var(--jn-card-accent)`, `--jn-card-accent` dérivé de `editorWarning`, fond `--vscode-editorWidget-background`, titre, clés, `details.card-details`, boutons. Chrome réduit : pas de fond warning plein, `.card-icon` sans pastille (fond transparent, couleur `--jn-card-accent`), `.card-buttons` en `flex-wrap: wrap` (une ligne tant que les boutons tiennent, retour à la ligne sinon, sans débordement), et sous 360 px la règle actuelle (primaire pleine largeur) reste, grille plus serrée (`gap: 2px 8px`). Le jaune de marque ne peint pas la carte.
- `#thinking` : `border: 0`, `background: transparent`. Une ligne de statut, sans boîte. Spinner et libellé conservés.
- `#composer` : fond `--vscode-input-background`, bordure 1 px, rayon `--jn-r-lg`, `padding: var(--jn-s3) var(--jn-s3) var(--jn-s2)`. Focus : bordure `--jn-accent`. `body.awaiting #composer` : bordure warning et `box-shadow` inset 1 px inchangés. Barre d'outils en bas. `.chip` : fond transparent, bordure `--jn-line`. `#send` primary, `#stop` danger. Aucun contrôle retiré. `#attach` reste disabled. Sous 719 px : `#toolbar` `flex-wrap: wrap`, `#ctl-group` `flex: 1 1 100%` `order: 3` `flex-wrap: nowrap`, `#send` `order: 2`, `#model-chip` `flex: 1 1 auto`. `#cfg-pop` : `width: min(300px, calc(100vw - 16px))`, `max-height: min(var(--jn-maxh, 70vh), 240px)`.
- `#history` : tiroir existant, fond `--jn-drawer-bg`. `.hist-head` sans filet (`border-bottom: 0`). Pas de colonne permanente.

Hors de cet amendement : protocoles, `approval.ts`, `Choice`, `postMessage`, ids, keyframes, `chat.ts`, `extension.ts`, `html.ts`, `markdown.ts`, `chat.js`.

Les quatre webviews (chat, cockpit, studio, panneau éditeur) chargent la même feuille `media/chat.css` (`extension.ts:530,589,732,952`) : la charte ci-dessous s'applique à toutes, sous réserve de la section 0. Direction artistique : celle du logo Warband. Un seul accent, le jaune de marque ; un secondaire, le gris ardoise ; formes anguleuses, esprit terminal ; mouvement sobre et fonctionnel.

- Statut : charte D.A. décidée (cadre), 2026-10-18, sur choix de l'utilisateur (accent jaune unique, formes anguleuses, animations sobres, logo revu). Remplace §1, §2 et la ligne « Rayons » de `design-studio-ui.md` §3. Cadre inchangé : ADR 0004 §C (CSP à nonce, `textContent`, aucune ressource distante), ADR 0005 (modèle, effort).
- Validé par l'utilisateur (2026-10-18) : logo redessiné selon §3 (pas de fichier source externe) ; petite taille réduite au chevron de tête et au curseur ; attente d'approbation en orange du thème (`--jn-warn`), toujours avec libellé.
- Cible : VS Code ≥ 1.90 (`extension.manifest.json:8`) = Chromium 122. Disponibles : container queries, `color-mix()`, `:has()`, API `popover`. **Indisponible : CSS anchor positioning** (placement calculé en JS).

## 1. Système de design (`media/chat.css`, en tête, préfixe `--jn-`)

### 1.1 Couleurs de marque (seules valeurs figées admises)

| Jeton | Valeur | Usage |
|---|---|---|
| `--jn-accent` | `#CC1C40` | Rouge du A du wordmark. Aplat (envoi, puce active) et filet. 5,7:1 sur blanc, 5,4:1 pour le blanc posé dessus. Trop sombre pour du texte sur fond sombre (2,9:1) : le texte y est `--jn-ink`. |
| `--jn-steel` | `#495F73` | Acier du treillis. Filet du bandeau et bord du compositeur. ≥ 3:1 sur noir et sur blanc. |
| `--jn-ink` | `#FFFFFF` | Encre du wordmark. Texte sur le bandeau noir et sur le rouge. |

Ces trois déclarations sont les seuls hex hors repli de `var()` dans les feuilles ; le test `css-motion` ne les tolère que là.

### 1.2 Jetons d'usage, par thème

| Jeton | Sombre (défaut) | `body.vscode-light` | `body.vscode-high-contrast`, `-light` | `@media (forced-colors: active)` |
|---|---|---|---|---|
| `--jn-accent` (trait, focus, aplat) | `#CC1C40` | `#CC1C40` | `var(--vscode-contrastActiveBorder, var(--vscode-focusBorder))` | `Highlight` |
| `--jn-accent-fill` (fond d'action) | `--jn-accent` | `--jn-accent` + bordure 1 px `--jn-steel` | `var(--vscode-button-background)` + `--vscode-contrastBorder` | `ButtonFace` / `ButtonText` |
| `--jn-on-accent` | `--jn-ink` | `--jn-ink` | `var(--vscode-button-foreground)` | `ButtonText` |
| `--jn-tint` (sélection, survol actif) | accent 14 % | accent 10 % | `transparent` + bordure `--jn-accent` | `Highlight` |
| `--jn-secondary` | `--jn-steel` | `--jn-steel` | `--vscode-contrastBorder` | `CanvasText` |
| `--jn-accent-wash` (fond teinté opaque : bulle de consigne, étiquette active) | accent 14 % sur `input-background` | accent 10 % sur `input-background` | `transparent` | — |
| `--jn-accent-edge` (bordure teintée) | accent 45 % | accent 55 % | `--jn-accent` | — |

Les teintes d'accent passent par ces jetons, jamais par un `color-mix` direct dans une règle ; le contraste du texte posé dessus est vérifié par `test/contrast.test.ts`.

Justification thème clair : le rouge du A tient en trait sur blanc (5,7:1) et le blanc tient sur le rouge (5,4:1). Justification contraste élevé : l'utilisateur a choisi un thème pour ses couleurs, on lui obéit ; la marque repasse en monochrome `currentColor` (couleurs forcées : `CanvasText`).

**Dérivés du thème** (jamais figés) : fonds (`--vscode-editor-background`, `sideBar`, `editorWidget`, `input`, `dropdown`), texte (`--vscode-foreground`), atténué (`--jn-muted` = foreground 72 %), filets (`--jn-line` = `--vscode-panel-border`), polices, ombre (`--vscode-widget-shadow`), et les **états sémantiques** : `--jn-ok` (`testing-iconPassed`), `--jn-warn` (`editorWarning-foreground`), `--jn-err` (`errorForeground`). Leurs replis ne pointent plus vers un accent. L'attente d'approbation (`body.awaiting`, `body.waiting`) porte toujours un libellé ou un glyphe en plus de la couleur, le rouge de marque ne signifiant jamais un état.

Supprimés : `--jn-accent-2`, `--jn-cool`, `--jn-glow`, `--jn-glow-pct`, `--jn-ease-spring`, `--jn-r-pill`. Le bleu `focusBorder` n'est plus l'accent hors contraste élevé.

### 1.3 Formes

- Rayons : les valeurs 2/3/4 px de cette puce sont caduques. Les jetons valent ceux de la section 0 (6/8/12 px), y compris cockpit et studio. Toute valeur de `border-radius` est `0` ou un de ces trois jetons. Plus de pastille ni de cercle : radios et puces ne sont pas des disques. Le pouce d'effort reste à `0`.
- Bordures 1 px partout (`--jn-line`) ; 2 px seulement pour le focus en contraste élevé et le liseré gauche des cartes.
- Ombres : une seule, `--jn-shadow-pop: 0 2px 6px var(--vscode-widget-shadow, #0004)`, sur les popovers ; `none` en contraste élevé. Aucune autre `box-shadow` (sauf `inset` 1 px servant de bordure).
- Focus : `outline: 1px solid var(--jn-accent); outline-offset: 1px` ; 2 px en contraste élevé. Plus de halo.
- Espacements inchangés : `--jn-s1..s5` = 4, 8, 12, 16, 24 px ; cible 28 px (24 en compact).

### 1.4 Typographie

- Pas de police embarquée (CSP, dépendance). `--jn-font` = police d'interface du thème ; `--jn-mono` = police de l'éditeur.
- Mono (esprit terminal) pour : code, nom d'outil, modèle, compteurs, étiquettes d'état, en-têtes de section en petites capitales (`text-transform: uppercase`, `letter-spacing: .06em`, `--jn-fs-xs`). Interface pour : prose des messages, libellés de boutons, champs.
- Tailles `--jn-fs-xs` 11, `--jn-fs-sm` 12, `--jn-fs` thème (13), `--jn-fs-lg` 14 px. Graisses 400 et 600 seulement. Pas d'interlettrage négatif. `font-variant-numeric: tabular-nums` sur les compteurs.

## 2. Mouvement et budget de performance

Liste **fermée** ; tout effet absent est interdit.

- Durées `--jn-d1` 120 ms (survol, états), `--jn-d2` 160 ms (entrées), `--jn-d3` 200 ms (tiroir). Aucune durée finie au-delà de 200 ms. Easings `--jn-ease-out: cubic-bezier(.2,0,0,1)`, `--jn-ease-io: cubic-bezier(.4,0,.2,1)` ; aucune ordonnée de contrôle hors [0, 1] (pas de ressort).

| # | Effet | Déclencheur | Technique |
|---|---|---|---|
| M1 | Survol et états | hover/active/checked | `transition` de `color`, `background-color`, `border-color`, `opacity` (`--jn-d1`). `transform` seulement pour `active` (`translateY(1px)`), plus de `scale`. |
| M2 | Entrée d'un message ou d'une carte | ajout | `jn-msg-in` : `opacity 0→1` + `translateY(4px→0)`, `--jn-d2`, une fois. |
| M3 | Ouverture d'un popover | `toggle` | `jn-pop-in` : `opacity` + `translateY(4px→0)`, `--jn-d1`, sans `scale`. |
| M4 | Tiroir d'historique | ouverture | `jn-drawer-in` : `translateX`, `--jn-d3`. |
| M5 | Fondu (zones remplacées) | rendu | `jn-fade-in` : `opacity`, `--jn-d1`. |
| M6 | Spinner de travail | `body.running` sans attente | `jn-braille` inchangé (bande verticale, `steps(10)`, 1 s, infini), sous `#thinking`. |

Sort des `@keyframes` actuels : **gardés** `jn-braille`, `jn-msg-in`, `jn-pop-in`, `jn-drawer-in`, `jn-fade-in`. **Retiré** avec la marque treillis : `jn-blink` (plus de curseur). **Fusionnés** : `jn-card-in` → `jn-msg-in`, `jn-settle` → `jn-fade-in`. **Supprimés** : `jn-scan`, `jn-logo-in`, `jn-sweep-a/b`, `jn-pop-a/b`, `jn-halo-a/b`, ainsi que le curseur `▍` de `#thinking`, l'élément `.sweep` du composer et les classes `sweep`/`pop` posées par `chat.js`.

Règles fermes (inchangées sauf mention) :
- `@keyframes` : **uniquement `transform` et `opacity`**. `transition` : liste M1, jamais `all`. Interdits : `backdrop-filter`, `blur(`, `filter`, animation de `box-shadow`, de dimensions ou de position, `linear-gradient`.
- Animations infinies : **une seule** (M6 sous `#thinking`). Rien ne tourne hors run ; attente d'approbation ou vue cachée (`body.paused`) → `animation-play-state: paused`. La marque ne clignote pas.
- Logo : **aucun SMIL** (`<animate>`) dans les SVG, ni en fichier ni en ligne : il échappe à `prefers-reduced-motion` et tourne sans fin.
- JS : ni `requestAnimationFrame` ni `setInterval` pour le visuel ; pas d'écouteur `scroll` visuel ; `will-change` seulement sur la bande du spinner.
- Interrupteur global : `prefers-reduced-motion: reduce`, contraste élevé et `forced-colors` → `body *, ::before, ::after { animation: none !important; transition: none !important }`. Spinner → « … ». La marque ne bouge pas.
- **CSP inchangée** : ni `<style>`, ni `style=`, ni `setAttribute("style")`, ni `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`. États = classes. Seule écriture de style admise : `el.style.setProperty("--jn-…", valeur numérique)` et la hauteur du `textarea`.

## 3. Logo

- Marque : treillis acier (`#495F73`) et flèches rouges (`#CC1C40`), fond transparent. Même géométrie dans `media/logo.svg`, `media/icon.svg`, `media/logo-small.svg` et le SVG inline `BRAND` (18 px). Couleurs en dur. Lisible à 18 px (trait ≥ 1,6 unité de la grille 24, nœuds ≥ 1).
- Contraste élevé et couleurs forcées : la marque inline reprend `currentColor` / `CanvasText`. L'accueil masque `icon.svg` avec la couleur du thème.
- Aucun `<animate>`, `<script>`, attribut `on*`, ni référence externe dans aucun SVG. Pas de clignotement.

## 4. Responsive (container queries)

`body { container: app / inline-size }`. Points de rupture : **compact < 360 px**, **standard 360–599**, **large ≥ 600** (repères `@container app (max-width: 359px)` et `(min-width: 600px)` testés).

| Zone | Compact | Standard | Large |
|---|---|---|---|
| En-tête | boutons en icône seule (texte en `.sr-only`, `title`) ; badge bac à sable tronqué | texte court | idem |
| Fil | messages 100 % | `max-width: 92%` (bulle utilisateur 85 %, réponse agent 100 %) | colonne centrée `min(720px, …)` (§0) |
| Composer | barre d'outils sous le `textarea` : étiquette modèle tronquée, Configurer en icône, envoyer/stop en icône | étiquette + « Configurer ▾ » | idem, dans la colonne 720 px (§0) |
| Popover Configurer | une colonne, `min(232px, 100vw - 16px)` | idem | idem |

Barre d'outils du composer **sous 720 px** (`@container app (max-width: 719px)`) : rangée d'icônes (pièce jointe, @, #, /, envoi), puis une seule rangée pour modèle, Configurer, Apprentissage et Bypass (`#ctl-group` en `nowrap`). L'étiquette du modèle absorbe la place et se tronque, les autres contrôles gardent leur taille. Jamais de contrôle seul sur une ligne.

Aucun élément plus large que son conteneur ; textes longs en `ellipsis`. Popover en couche supérieure, placé par `placePopover` (`media/ui.js`).

## 5. Composants

- **Boutons** : `primary` = `--jn-accent-fill` / `--jn-on-accent`, bordure 1 px (`--jn-brand-ink` en clair) ; `secondary` = fond `--vscode-button-secondaryBackground`, bordure `--jn-line` ; `ghost` = transparent, survol `--jn-tint` ; `danger` = `--jn-err`. Disabled : `opacity .5`, aucun survol. Envoi = primary ; stop = `danger` en trait.
- **Étiquettes** (remplacent les pastilles : modèle, statut, bac à sable) : rectangle `--jn-r-sm`, bordure 1 px, texte mono `--jn-fs-sm`.
- **Composer** : bordure `--jn-line`, `--jn-accent` au `:focus-within`, `--jn-warn` sur `body.awaiting` (avec libellé d'attente).
- **Bascules, radios, cases** : carrées ; état actif = `--jn-accent-fill` + `--jn-on-accent`. Curseur d'effort : piste `--jn-line`, partie remplie `--jn-accent-fill` (via `--jn-pct`), pouce carré.
- **Sélection** (option de liste, page active du studio, ligne d'historique) : fond `--jn-tint` + liseré gauche 2 px `--jn-accent`.
- **Cartes d'approbation** : liseré gauche 2 px `--jn-warn`, entrée M2 ; sémantique et boutons inchangés (`design-studio-ui.md` P2).
- **Thinking** : `#thinking` hors du `role="log"`, `role="status"`, spinner mono + libellé ; plus de reflet ni de curseur propre.
- Sélecteur de modèle et Configurer : comportement et accessibilité inchangés, détaillés ci-dessous.

**(a) Sélecteur de modèle** (remplace `<select>` et `#models-refresh`). Étiquette `button` `aria-haspopup="listbox"` `aria-expanded` → popover : champ de filtre `role="combobox"` (`aria-controls`, `aria-activedescendant`), liste `role="listbox"`, options `role="option"` `aria-selected`/`aria-disabled`. Chaque option : libellé, description (1 ligne, `ellipsis`, complète en `title`), badge « actuel ». Groupes : « Par défaut » (entrée `null` = défaut) puis la liste du SDK. Clavier : ↑/↓ (sautent les désactivées), Début/Fin, Entrée choisit, Échap ferme et rend le focus à l'étiquette, saisie = filtre (`includes` insensible à la casse, **jamais de RegExp construite depuis la saisie**). Pied : « Actualiser la liste ». Liste indisponible : le popover montre la saisie libre actuelle. Verrouillé (`locked`) : étiquette `aria-disabled`, popover non ouvrable. Message posté : **`setModel` existant inchangé** ; l'extension revalide.

**(b) Configurer ▾** : popover `role="dialog"` `aria-label`, piège de focus (Tab/Maj+Tab cyclent), Échap et clic extérieur ferment (`popover="auto"`), focus rendu au déclencheur. « Raisonnement » : `input[type=range]` natif conservé, crans cliquables sous la piste (désactivés barrés), bouton « Auto », niveau en texte sous le curseur. « Exécution » : fournisseur en radios (Claude coché ; OpenCode `disabled`, « bientôt »), bac à sable et réseau **en lecture seule** depuis la vue. **Aucun nouveau type de message IPC.**

## Annexe : plan initial et réponses (2026-10-15)

Logique pure dans **`media/ui.js`** (script classique, second `<script nonce src>`, `module.exports` si `module` existe, sinon `globalThis.WarbandUI`), testée par vitest via `createRequire`. Pas de bundler. Lots U1 (jetons, composer, responsive, boutons), U2 (sélecteur et Configurer : `listboxKey`, `filterModels`, `placePopover`, `effortPct`), U3 (`bodyClasses`, `activityLabel`), U4 (prévisualisation avec CSP, `#csp-violation`, `preview-shots.mjs` via `EDGE_BIN`, profil de performance dans VS Code : aucune entrée Layout au repos, repaint limité à `#thinking`, < 3 % CPU, 0 % vue cachée ; clavier et NVDA sur les deux popovers).

- `workbench.reduceMotion` : le média `prefers-reduced-motion` suffit (interrupteur CSS, classe `reduce-motion` pilotée par `matchMedia`). Pas de champ `reduceMotion` dans la vue.
- État réseau : champ `sandboxNetwork` (`none` | `bridge` | `null`). « réseau activé » si `bridge`, « Coupé » si bac à sable en `none`, « Sans objet » sans bac à sable ; l'en-tête reprend « réseau activé » seulement en `bridge`.
- Popovers ouverts par `popovertarget` ; `beforetoggle` refuse l'ouverture quand le modèle est verrouillé.

## 6. Lots de la refonte D.A. (pour `surface`, dans l'ordre)

Validation de chaque lot : `pnpm check` vert, puis `node packages/vscode/scripts/preview-shots.mjs` (manuel) aux largeurs 280/360/520/900 × thèmes sombre/clair/contraste élevé, captures relues. Interdits communs : modifier la CSP ou le protocole (messages IPC), toucher `packages/` hors `packages/vscode`, le moteur, la gate, la politique, les secrets ; ajouter une police, une dépendance ou une ressource distante ; `innerHTML`/`style=`/`<style>`/`on*=` ; supprimer un sélecteur testé (`model-chip`, `cfg-btn`, `history-btn`, `#thinking`, `.spin-strip`, `#csp-violation`, `#overflow`) ; affaiblir un test existant autrement que par l'amendement explicitement décrit dans le lot.

**D1 — Jetons et palette.** Fichiers : `media/chat.css` (bloc de jetons, blocs clair/contraste élevé/forced-colors, toutes les références aux jetons supprimés), `test/css-motion.test.ts`, nouveau `test/contrast.test.ts`. Critères : jetons §1.1–1.2 présents ; zéro occurrence de `--jn-accent-2`, `--jn-cool`, `--jn-glow`, `--jn-r-pill`, `999px`, `ease-spring`, `focusBorder` hors bloc contraste élevé ; amendement du test hex limité aux déclarations `--jn-brand*`, `--jn-on-brand`, `--jn-slate*` ; nouveau test : tout `border-radius` vaut `0` ou `var(--jn-r-sm|md|lg)`, jetons de rayon ≤ 4 px, au plus une `box-shadow` non `inset` ; `contrast.test.ts` calcule le ratio WCAG des paires figées contre les fonds des fixtures de `preview.test.ts` (texte ≥ 4,5, focus et bordure active ≥ 3) dans les trois thèmes.

**D2 — Mouvement.** Fichiers : `media/chat.css`, `media/chat.js` (l. 288-303, classes `sweep`/`pop`), `media/ui.js` si concerné, `src/logic/html.ts` (`.sweep` l. 99, `.cursor` l. 97), `test/css-motion.test.ts`, `test/html.test.ts`. Critères : ensemble des `@keyframes` = exactement les six gardés de §2 ; toute durée finie ≤ 200 ms ; aucun `cubic-bezier` à ordonnée hors [0, 1] ; au plus 2 animations infinies, sélecteurs `#thinking…` ou `body.running…brand-cursor` ; interrupteur global conservé ; aucun `scale(` dans les `@keyframes` et transitions.

**D3 — Logo.** Fichiers : `media/logo.svg`, `media/icon.svg`, nouveau `media/logo-small.svg`, `src/logic/html.ts` (`BRAND`), `media/chat.css` (`.brand-*`, `.welcome::before`), `src/extension/extension.ts` (`iconPath` des panneaux éditeur → `logo-small.svg`), test SVG. Critères : géométrie §3 (test : coordonnées entières ou demi-entières, `viewBox="0 0 24 24"`) ; aucun `<animate|<script|on\w+=|href=` dans les SVG ni dans `BRAND` ; `BRAND` sans attribut `fill` hex ; curseur immobile hors `body.running`.

**D4 — Typographie et composants.** Fichiers : `media/chat.css` (règles chat, `.cockpit*`, `.studio*`), `media/chat.js`, `media/cockpit.js`, `media/studio.js` (classes seulement). Critères : §1.4 et §5 appliqués aux trois vues ; graisses ∈ {400, 600} ; aucun `letter-spacing` négatif ; aucun débordement horizontal à 280 px (`#overflow` absent du DOM de prévisualisation).

**D5 — Vérification.** Fichiers : `test/preview.test.ts`, `scripts/preview-shots.mjs`. Critères : états capturés (accueil, run en cours, approbation en attente, popover ouvert, cockpit, studio) × 4 largeurs × 3 thèmes ; `--dump-dom` sans `#csp-violation` ni `#overflow` ; vérification manuelle dans VS Code : focus visible au clavier partout, curseur du logo figé sous « Réduire les animations ».

## Amendement — graphe de trouvailles circulaire

À la demande du propriétaire, les nœuds de la Kill chain et leurs badges de
statut peuvent être circulaires. Cette exception est limitée aux sélecteurs
`.kc-node-head` et `.kc-node-badge` ; les autres composants gardent les rayons
prescrits. Les libellés restent sous les cercles, les métadonnées secondaires,
et les relations suivent les liens réellement enregistrés. Une actualisation
des données du même projet conserve le zoom et le déplacement du graphe.
