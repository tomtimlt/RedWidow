# Spécification de design : cockpit, composer, Configurer, cartes et réglages

## Décision visuelle actuelle — intégration de la 0.3.53

L’[ADR 0028](adr/0028-integration-refonte-interface.md) prime sur les prescriptions
visuelles historiques ci-dessous : charte « Acier et signature », Geist locale,
cinq palettes, rails, rayons 8/12/18 et pilules, nouvelle marque et animations
respectant le mouvement réduit. Les obligations de CSP, accessibilité, vérité
des données, contrôle des approbations et isolation restent applicables.
Le Bypass réel conserve le contrat de l’ADR 0017 ; les mentions historiques
« bientôt » ou « non câblé » ne décrivent pas sa réalisation actuelle.


- Statut : cadré (cadre), 2026-10-16. Conception propre à Warband.
- Hérite de `docs/design-chat-ui.md` (CSP, budget d'effets, règles JS) : tout ce qui n'est pas remplacé ici reste en vigueur.
- Règle de vérité : **aucune valeur inventée**. Donnée absente : l'élément est masqué, ou affiché désactivé avec le libellé « bientôt » et sans faux état (ni %, ni pastille verte/rouge, ni compteur).

## 1. Décision

1. Refonte visuelle complète (jetons, composer, Configure, cartes, Réglages) sur les données existantes ; les fonctions sans donnée sont « bientôt » ou absentes (tableau §2).
2. Le journal d'agent (appels d'exec Exegol) est le panneau **Monitor** ; le shell interactif est un terminal d'éditeur VS Code (`terminalLaunch`, `isTransient`), pas une webview.
3. Layouts : **Editor** = l'état actuel (chat dans la Side Bar). **Chat** et **Monitor** = un panneau webview éditeur `warband.stage` en `ViewColumn.One`. Une seule surface de conversation active à la fois : en layout Chat, la vue `warband.chat` de la Side Bar affiche « Conversation ouverte dans l'éditeur » et un bouton de retour, sans cartes d'approbation. Monitor est en lecture seule : les approbations s'y répondent par un renvoi au chat. Layout mémorisé dans `workspaceState` (pas de réglage).
4. Bypass : **non câblé**. Interrupteur affiché désactivé « bientôt » dans Configure. Aucune classe `bypass` posée sur le corps, aucun état orange lié au Bypass.

5. Décisions de l'utilisateur (2026-10-16) : (a) la bordure orange du composer signifie « approbation en attente » (`body.awaiting`), en attendant le Bypass ; (b) le bouton « Terminal » du cockpit et la commande `warband.openTerminal` ouvrent un shell d'éditeur via `terminalLaunch` sur le conteneur en marche ; (c) en layout Chat, la Side Bar affiche la liste des Sessions (historique restylé) et un renvoi vers l'éditeur.

## 2. Inventaire des éléments d'interface

| Élément | Sort | Source / remarque |
|---|---|---|
| Barre de titre, Activity Bar, onglets d'éditeur, page Welcome, raccourcis `kbd` | Ne pas porter | Chrome VS Code. |
| En-tête de la Side Bar (Sessions, Conversation, Nouvelle, Réglages) | Réel | `history-btn`, `reset`, commande `warband.openStudio`. Pas de nouveau bouton sans action. |
| Message utilisateur / agent, rendu markdown, lignes d'outil `details` | Réel | Existant, restylé. |
| « Thought for Ns » | Masqué | Seulement si la vue porte déjà le raisonnement et sa durée ; sinon absent. |
| Nom du modèle dans l'en-tête d'un message agent | Masqué | La vue ne dit pas quel modèle a produit le message. |
| Barre thinking | Réel | `#thinking` existant, budget E4 inchangé. |
| Carte d'approbation | Réel | Lot P2. Champs : `label`, `summary`/`tool`, `reason`, `detail`. **Pas de lignes conteneur ni workdir.** |
| Puces « créer une règle » allow/ask/deny | Ne pas porter | Écrit la politique : architecte. |
| Pièces jointes, bouton trombone | « bientôt » | Désactivé. |
| Bouton @ et menu Mentionner | Réel partiel | Seulement les types reconnus par `parseMentions` ; les autres absents. |
| Bouton / et menu Commandes | Réel partiel | `/clear` (= message `reset`). `/start` retiré : la création est dans le cockpit. `/compact`, `/help`, skills : absents. |
| Pastille modèle + menu | Réel | `model-chip` existant (liste du SDK, pas une liste figée). |
| Bouton MCP + menu à statuts | Masqué | Aucun statut MCP. |
| Jauge de contexte + popover | Masqué | Aucune donnée d'usage. |
| Configure : Layout | Réel | Lot P4. |
| Configure : Mode Answer/Plan/Auto | « bientôt » | Toucherait `permissionMode` (option verrouillée) : architecte. |
| Configure : Bypass | « bientôt » | Gate : architecte. |
| Configure : Persona | « bientôt » | Aucune donnée. |
| Configure : Speed (vitesse de stream) | Ne pas porter | Ralentissement artificiel de démonstration. |
| Configure : Raisonnement (effort) et Fournisseur | Réel | Existants (`design-chat-ui.md` §4b), passés en une colonne. |
| Vue Sessions (lignes, rooms, statut) | Réel partiel | = historique existant restylé. Statut « en cours » seulement pour la conversation courante si `running`. Rooms : absentes. « Nouvelle session » = `reset`. |
| Layout Chat (plein éditeur) | Réel | Lot P4. |
| Layout Monitor (commandes, méta, « en attente ») | Réel partiel | Commandes et statut (en attente / approuvé / refusé / erreur) depuis la vue. Durée, nombre de requêtes : seulement si la vue les porte. « live » : point statique. |
| Journal d'exec Exegol (Monitor) | Réel | Appels d'exec de la vue du chat actif. |
| Shell interactif Exegol | Réel | Terminal d'éditeur `terminalLaunch` + `isTransient`, au plus quatre par conteneur. |
| Barre d'état : conteneur, layout, modèle | Réel | `StatusBarItem`. Conteneur = projet lié (cockpit) ; « connecté » seulement si l'état cockpit l'établit, sinon le nom seul. |
| Barre d'état : Mode, Contexte, BYPASS | Masqué | Pas de donnée. |
| Réglages : groupes Engagement / Système, icônes | Réel | Lot P5, sur les 13 pages existantes de `studio.js`. |
| Réglages : compteur Kill chains | Réel | Longueur de `view.findings`. |
| Réglages : pastilles Approvals / MCP, « License Pro » | Masqué / ne pas porter | Pas de donnée ; pas de page Licence. |

## 3. Système de design (remplace `design-chat-ui.md` §1 sur ces points)

- Rayons, palette, accent, mouvement : **remplacés le 2026-10-18** par la charte D.A. de `design-chat-ui.md` §1–3, puis les rayons par l'amendement du 2026-10-23 (section 0 : 6/8/12 px, y compris le cockpit et le studio ; accent jaune de marque, plus de pastille). Les lignes ci-dessous valent pour le reste.
- Palette convertie : chaque couleur est une variable `--vscode-*`, hex seulement en repli de `var()`. Bleu = `--vscode-focusBorder`. Orange = `--vscode-editorWarning-foreground` (repli `--vscode-inputValidation-warningBorder`). Terminal : `--vscode-terminal-background/foreground`, `--vscode-terminal-ansi*`, police `--vscode-editor-font-family`.
- Composer : bordure bleue au `:focus-within` ; **orange quand une approbation est en attente** (`body.awaiting`, état réel). Le Bypass n'emprunte pas cet état.
- Configure : popover de largeur 232 px (bornée par `min(232px, 100vw - 16px)`), **une colonne** à toutes les largeurs (remplace la règle « deux colonnes en large »). Ordre : Layout, Raisonnement, Fournisseur, puis les « bientôt » (Mode, Bypass, Persona) regroupés en bas.
- Barre d'outils du composer : une seule ligne, sans retour. Sous 360 px (`@container app`, points 359/600 existants), Configure est réduit à l'icône (texte en `.sr-only`, `title`).
- Animations décoratives (`pulse`, curseur clignotant, point « live ») : **statiques**. Seuls restent E1 à E6.

## 4. Lots pour `surface` (ordre imposé)

Commande de validation de chaque lot : `pnpm check` vert. Interdits communs : modifier la CSP, une ressource distante, une police ou une dépendance, `innerHTML`/`style=`/`<style>`/`on*=`, affaiblir `test/css-motion.test.ts` ou `test/html.test.ts`, toucher `packages/core`, la gate, la politique, les secrets, `safeEnv` ou un lancement de processus, un identifiant de modèle, une valeur inventée.

**P1 — Jetons, composer, Configure.** Fichiers : `media/chat.css`, `media/chat.js`, `media/ui.js`, `src/logic/html.ts` (`chatHtml`), tests associés. Critères : rayons §3 ; composer sur une ligne, Configure en icône sous 360 px ; popover 232 px une colonne ; Mode/Bypass/Persona présents `disabled` avec « bientôt », sans message IPC ; boutons trombone désactivé « bientôt », @ et / avec menus limités au tableau §2 (`/clear` poste `reset`) ; pas de bouton MCP ni jauge ; état orange sur `body.awaiting` ; sélecteurs testés conservés (`model-chip`, `cfg-btn`, `history-btn`, `#thinking`, `.spin-strip`, `#csp-violation`, `#overflow`) ; aucun débordement à 280 px. Interdits : câbler Layout (P4), Bypass ou Mode.

**P2 — Cartes d'approbation.** Fichiers : `media/chat.js` (`renderCard`), `media/chat.css`, test. Critères : carte en grille clé/valeur (outil, résumé, raison, détail repliable) ; boutons exactement `once`, `deny`, `always` (ce dernier seulement si `canRemember`, toujours sous modale native) ; Échap = refuser conservé ; aucune ligne conteneur/workdir ; aucune puce de règle. Interdits : changer le message `approve` ou ses choix.

**P3 — Shell d'éditeur.** Le journal d'agent reste le Monitor ; le shell interactif est un terminal d'éditeur (`terminalLaunch`, `isTransient`), pas une webview `warband.terminal`.

**P4 — Layouts et sessions.** Fichiers : `src/extension/extension.ts` (panneau `warband.stage`, message webview `setLayout` validé par liste blanche `editor|chat|monitor`, `workspaceState`, `StatusBarItem` conteneur/layout/modèle), `src/logic/html.ts`, `media/chat.js`, `media/ui.js` (`monitorRows(view)` pur, testé), `media/chat.css`, test. Critères : une seule surface de chat active (placeholder dans la Side Bar en layout Chat, aucune carte rendue en double) ; Monitor en lecture seule avec renvoi au chat ; liste Sessions = historique restylé, statut « en cours » seulement si `running`. Interdits : sessions multiples, rooms, état inventé.

**P5 — Réglages.** Fichiers : `media/studio.js`, sa feuille (règles `.studio*`), `src/logic/html.ts` (`studioHtml` si besoin), test. Critères : groupes Engagement (Projet, Conteneurs, Fournisseurs, Personas, Approbations, Kill chain) et Système (Modèle, Harness, MCP, Atlas, Disposition, Modes, Contrôle système) ; compteur Kill chain réel ; pas de pastille de statut, pas de Licence. Interdits : nouvelle page à données inventées.

## 5. Décisions requises

Pour `architect` (voie moteur) :
1. **Bypass des approbations** : sémantique, bornes (deny, chemins, dangers shell jamais contournés), journalisation, affichage. Rien n'est câblé avant un ADR.
2. **Modes Answer/Plan/Auto** : correspondance avec `permissionMode`, option verrouillée.
3. **Shell interactif** : le shell est un terminal d'éditeur VS Code (`terminalLaunch`, `isTransient`) ; le journal d'agent est le Monitor.
4. **Sortie des exec dans la vue** (capée, masquée) si elle n'y est pas déjà ; durée des appels.
5. **Champs conteneur/cwd dans la demande d'approbation** (`approval.ts:12-22`).
6. **Règles depuis une carte** (puces allow/ask/deny) : écriture de politique, empreinte.
7. Données d'usage (contexte), statut MCP, pièces jointes, personas.

Pour l'utilisateur : voir le rapport.

## 6. Bypass

- Statut : cadré (cadre), 2026-10-16, après les lots 2 et 2b de l'ADR 0006 (moteur et hôte prêts). **Remplace**, pour le seul Bypass : §1.4, les lignes « Configure : Bypass » et « Barre d'état : BYPASS » du §2 (la barre d'état native existe déjà côté hôte), la phrase « Le Bypass n'emprunte pas cet état » du §3 et l'interdit « câbler Bypass » de P1. Le reste du document est inchangé.

### 6.1 Décision

1. **Interrupteur dans Configure.** Le Bypass quitte le groupe « Bientôt » (qui garde Mode et Persona) et devient une section propre, `<section class="cfg-col" aria-labelledby="cfg-h-bypass">`, placée **juste avant** « Bientôt ». Titre « Bypass des approbations ». Contrôle : `<button id="bypass-switch" type="button" role="switch" aria-checked="false" aria-describedby="bypass-state bypass-warn">`, libellé visible « Bypass ». Sous le contrôle, `<p id="bypass-state" role="status">` (état) et `<p id="bypass-warn" class="tip">` (avertissement, 6.1.3).
2. **Source unique de l'état.** Seul le message poussé `{type:"bypass", on, armed, expiresAt}` modifie le rendu (interrupteur, texte d'état, badge, classe du corps). Le clic n'écrit rien dans le DOM : il envoie `{type:"setBypass", enabled}` avec `enabled = !(on || armed)` du **dernier message reçu**. Avant tout message, l'état est « off ».
3. **États affichés** (fonction pure dans `ui.js`, voir lot B1) :

   | Message reçu | `aria-checked` | Texte d'état | Corps / badge |
   |---|---|---|---|
   | `on:false, armed:false` | `false` | vide (ou avis de retombée, ci-dessous) | rien |
   | `on:false, armed:true` | `true` | « En attente : actif dès que l'agent le confirme. » | rien |
   | `on:true`, `expiresAt` nombre fini | `true` | « Actif jusqu'à HH:MM (reste 1 h 58). » | `body.bypass-on`, badge visible |
   | `on:true`, `expiresAt` absent ou invalide | traité comme « off » (échec fermé) | | rien |

   « Armé sans session » et « en attente d'accusé » portent le **même** message (`armed:true`, `expiresAt:null`) : l'interface ne les distingue pas et n'invente pas la différence. Un seul texte les couvre honnêtement.
4. **Temps restant sans minuteur.** L'heure d'expiration absolue (HH:MM, heure locale, `toLocaleTimeString` avec `hour` et `minute` en `2-digit`) est la donnée principale : elle ne vieillit pas. Le reste (« reste 1 h 58 », arrondi à la minute supérieure comme `formatRemaining` de l'hôte) est **recalculé** à chaque message `bypass` et à l'ouverture de Configure (événement `toggle` du popover, `newState === "open"`). Ni `setInterval`, ni `requestAnimationFrame`, ni `setTimeout` pour ce rendu.
5. **Avis de retombée.** Le script garde le seul dernier message reçu et un indicateur « l'utilisateur a demandé off ou `reset` » (posé à l'envoi de `setBypass {enabled:false}` ou de `reset`, effacé au message `bypass` suivant). Sur un passage à « off » sans cet indicateur : depuis « armé », texte d'état « Bypass désactivé avant confirmation. » ; depuis « actif », « Bypass terminé. ». L'avis reste jusqu'au prochain message `bypass` ou clic sur l'interrupteur. Ces deux phrases sont vraies quelle que soit la cause (délai de 5 s, expiration, commande de la barre d'état, changement de dossiers) : aucune cause n'est affirmée.
6. **Signal permanent quand actif.** (a) `body.bypass-on #composer` : bordure `var(--vscode-editorWarning-foreground, var(--vscode-inputValidation-warningBorder))`, sans animation. (b) Badge `<span id="bypass-badge" class="badge" hidden>` dans `#bar`, après `#sandbox` : texte « BYPASS · HH:MM », `title` « Bypass actif jusqu'à HH:MM : désactivable dans Configurer ou la barre d'état ». Sous 360 px (`@container app`), le badge n'affiche que « BYPASS » (heure dans `title` et en `.sr-only`). (c) Distinction avec « approbation en attente » : `body.awaiting #composer` garde sa bordure orange **et ajoute** un anneau `box-shadow: 0 0 0 1px` de la même couleur (double trait) ; seul, le Bypass n'a que la bordure, et c'est le badge qui le nomme. Aucune nouvelle animation, aucune `transition` sur `all`.
7. **Cartes.** Le Bypass ne retire ni ne masque aucune carte. Une décision auto-approuvée ne produit pas d'`approval.requested` (ADR 0006, Décision 4), donc pas de carte : l'interface n'a rien à filtrer. `#approvals`, `cardsFor`, `body.awaiting` et les choix `once|deny|always` sont inchangés.
8. **Avertissement** (`#bypass-warn`, deux lignes, deux phrases) :
   - « Approuve d'office les demandes « ask » pendant 2 h, sans rien mémoriser. »
   - « Restent demandés ou refusés : deny, chemins sensibles ou hors projet, accès hôte d'un conteneur, dangers shell, Bash sans règle ou commande composée. »

### 6.2 Pourquoi, alternatives écartées

- Heure absolue d'abord : exacte sans rafraîchissement, conforme à « pas de minuteur » ; un compte à rebours seul serait faux entre deux messages.
- `aria-checked="true"` dès « armé » : l'interrupteur représente la **demande** (le clic suivant l'annule) ; l'état effectif est dit par le texte, la bordure et le badge, réservés à `on:true` (ADR 0006, Décision 6 : aucun affichage actif sans accusé). Écarté : `aria-checked="mixed"`, non défini pour `role="switch"`.
- Écarté : bordure en tirets pour le Bypass (lisibilité faible en thème contrasté) ; modale (refusée par le propriétaire) ; badge cliquable (un second point de désactivation dans la webview sans besoin ; la barre d'état en a déjà un).

### 6.3 Lot B1 pour `surface`

- **Objectif** : câbler l'interface du Bypass selon 6.1, sur le message poussé seulement.
- **Fichiers** : `packages/vscode/src/logic/html.ts` (`chatHtml` : section Bypass, badge, groupe « Bientôt » réduit à Mode et Persona) ; `packages/vscode/media/ui.js` (fonction pure `bypassView(push, previous, userOff, now)` → `{ checked, state: "off"|"pending"|"on"|"dropped"|"ended", text, badge, until }`, exportée comme les autres utilitaires de `ui.js`) ; `packages/vscode/media/chat.js` (réception `bypass`, clic, ouverture de Configure, indicateur `userOff`) ; `packages/vscode/media/chat.css` ; `packages/vscode/test/html.test.ts`, `packages/vscode/test/ui.test.ts`.
- **Critères** :
  1. HTML : `#bypass-switch` avec `role="switch"`, `aria-checked="false"`, sans `disabled` ; section avant « Bientôt » ; exactement deux `class="cfg-off"` (Mode, Persona) ; `#bypass-badge` présent et `hidden` ; les deux phrases de 6.1.8 présentes.
  2. Source de `chat.js` : un seul `postMessage` contenant `setBypass`, de la forme `{ type: "setBypass", enabled: <booléen> }`, sans autre clé ; `aria-checked`, `hidden` du badge, `bypass-on` et le texte d'état ne sont écrits que dans la fonction de rendu appelée depuis le gestionnaire `message` (et à l'ouverture de Configure) ; le gestionnaire de clic n'écrit ni `aria-checked` ni `classList`.
  3. `ui.test.ts` : les cinq états de `bypassView` ; `on:true` sans `expiresAt` fini → « off » ; message mal formé (champ manquant, type faux) → « off » ; reste arrondi à la minute supérieure ; « dropped » / « ended » seulement sans `userOff`.
  4. Le test « aucune classe bypass dans la feuille ni le script » (`html.test.ts:197-200`) est **remplacé** par des tests du nouveau comportement (règle `body.bypass-on #composer` avec les deux variables, sans hex hors `var()` ; règle `body.awaiting #composer` contenant toujours les deux variables et un `box-shadow`). Le test `html.test.ts:150-165` est mis à jour pour Mode et Persona. Aucun autre test assoupli.
  5. `css-motion.test.ts` vert sans modification ; textes en `textContent` ; aucun débordement à 280 px.
  6. Validation : `pnpm check` vert.
- **Interdits** : toucher `src/logic/bypass.ts`, `src/logic/approval.ts`, `src/extension/`, `src/engine/`, `packages/core`, le protocole, la gate, la politique ; tout état optimiste ; toute durée envoyée par la webview ; `setInterval`, `requestAnimationFrame`, `setTimeout` pour le Bypass ; modale ; `innerHTML`, `style=`, `.style.` hors règles en vigueur ; nouvelle animation ou `transition: all` ; identifiant de modèle ; masquage ou filtrage de cartes.
