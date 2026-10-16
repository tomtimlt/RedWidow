# Spécification de design : portage de la maquette Exegol Studio

- Statut : cadré (cadre), 2026-10-16. Référence visuelle : `packages/vscode/design/exegol-studio-mockup.html` (référence seulement, jamais copiée : palette figée, `innerHTML`, `style=`, animations infinies hors budget).
- Hérite de `docs/design-chat-ui.md` (CSP, budget d'effets, règles JS) : tout ce qui n'est pas remplacé ici reste en vigueur.
- Règle de vérité : **aucune valeur inventée**. Donnée absente : l'élément est masqué, ou affiché désactivé avec le libellé « bientôt » et sans faux état (ni %, ni pastille verte/rouge, ni compteur).

## 1. Décision

1. Portage visuel complet (jetons, composer, Configure, cartes, Réglages) sur les données existantes ; les fonctions sans donnée sont « bientôt » ou absentes (tableau §2).
2. Terminal latéral = **panneau webview éditeur `john.terminal` en `ViewColumn.Beside`** (singleton, comme `john.studio`). Onglet « agent » en données réelles (appels d'exec Exegol déjà présents dans la vue du chat) ; onglet « shell » interactif **non câblé** (« bientôt ») : il exige un nouveau processus, décision architecte (§5).
3. Layouts : **Editor** = l'état actuel (chat dans la Side Bar). **Chat** et **Monitor** = un panneau webview éditeur `john.stage` en `ViewColumn.One`. Une seule surface de conversation active à la fois : en layout Chat, la vue `john.chat` de la Side Bar affiche « Conversation ouverte dans l'éditeur » et un bouton de retour, sans cartes d'approbation. Monitor est en lecture seule : les approbations s'y répondent par un renvoi au chat. Layout mémorisé dans `workspaceState` (pas de réglage).
4. Bypass : **non câblé**. Interrupteur affiché désactivé « bientôt » dans Configure. Aucune classe `bypass` posée sur le corps, aucun état orange lié au Bypass.

5. Décisions de l'utilisateur (2026-10-16) : (a) la bordure orange du composer signifie « approbation en attente » (`body.awaiting`), en attendant le Bypass ; (b) l'onglet « shell » du terminal latéral, désactivé « bientôt », porte un bouton de repli « Ouvrir dans le terminal VS Code » qui réutilise le chemin existant de `/start` (`extension.ts:130-152`), sans nouveau code de processus ; (c) en layout Chat, la Side Bar affiche la liste des Sessions (historique restylé) et un renvoi vers l'éditeur.

## 2. Inventaire de la maquette

| Élément | Sort | Source / remarque |
|---|---|---|
| Barre de titre, Activity Bar, onglets d'éditeur, page Welcome, raccourcis `kbd` | Ne pas porter | Chrome VS Code. |
| En-tête de la Side Bar (Sessions, Conversation, Nouvelle, Réglages) | Réel | `history-btn`, `reset`, commande `john.openStudio`. Pas de nouveau bouton sans action. |
| Message utilisateur / agent, rendu markdown, lignes d'outil `details` | Réel | Existant, restylé. |
| « Thought for Ns » | Masqué | Seulement si la vue porte déjà le raisonnement et sa durée ; sinon absent. |
| Nom du modèle dans l'en-tête d'un message agent | Masqué | La vue ne dit pas quel modèle a produit le message. |
| Barre thinking | Réel | `#thinking` existant, budget E4 inchangé. |
| Carte d'approbation | Réel | Lot P2. Champs : `label`, `summary`/`tool`, `reason`, `detail`. **Pas de lignes conteneur ni workdir.** |
| Puces « créer une règle » allow/ask/deny | Ne pas porter | Écrit la politique : architecte. |
| Pièces jointes, bouton trombone | « bientôt » | Désactivé. |
| Bouton @ et menu Mentionner | Réel partiel | Seulement les types reconnus par `parseMentions` ; les autres absents. |
| Bouton / et menu Commandes | Réel partiel | `/start <nom>` et `/clear` (= message `reset` existant). `/compact`, `/help`, skills : absents. |
| Pastille modèle + menu | Réel | `model-chip` existant (liste du SDK, pas la liste figée de la maquette). |
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
| Terminal latéral, onglet agent | Réel | Lot P3. |
| Terminal latéral, onglet shell, invite, « Nouveau shell » | « bientôt » | Processus nouveau : architecte. « Effacer » vide l'affichage local seulement. |
| Barre d'état : conteneur, layout, modèle | Réel | `StatusBarItem`. Conteneur = projet lié (cockpit) ; « connecté » seulement si l'état cockpit l'établit, sinon le nom seul. |
| Barre d'état : Mode, Contexte, BYPASS | Masqué | Pas de donnée. |
| Réglages : groupes Engagement / Système, icônes | Réel | Lot P5, sur les 13 pages existantes de `studio.js`. |
| Réglages : compteur Kill chains | Réel | Longueur de `view.findings`. |
| Réglages : pastilles Approvals / MCP, « License Pro » | Masqué / ne pas porter | Pas de donnée ; pas de page Licence. |

## 3. Système de design (remplace `design-chat-ui.md` §1 sur ces points)

- Rayons : `--jn-r-sm` 8 px, `--jn-r-md` 12 px, `--jn-r-lg` 18 px (composer, cartes, panneaux), `--jn-r-pill` 999px.
- Palette convertie : chaque couleur de la maquette devient une variable `--vscode-*`, hex seulement en repli de `var()`. Bleu = `--vscode-focusBorder`. Orange = `--vscode-editorWarning-foreground` (repli `--vscode-inputValidation-warningBorder`). Terminal : `--vscode-terminal-background/foreground`, `--vscode-terminal-ansi*`, police `--vscode-editor-font-family`.
- Composer : bordure bleue au `:focus-within` ; **orange quand une approbation est en attente** (`body.awaiting`, état réel). Le Bypass n'emprunte pas cet état.
- Configure : popover de largeur 232 px (bornée par `min(232px, 100vw - 16px)`), **une colonne** à toutes les largeurs (remplace la règle « deux colonnes en large »). Ordre : Layout, Raisonnement, Fournisseur, puis les « bientôt » (Mode, Bypass, Persona) regroupés en bas.
- Barre d'outils du composer : une seule ligne, sans retour. Sous 360 px (`@container app`, points 359/600 existants), Configure est réduit à l'icône (texte en `.sr-only`, `title`).
- Animations de la maquette (`pulse`, curseur clignotant, point « live ») : **statiques**. Seuls restent E1 à E6.

## 4. Lots pour `surface` (ordre imposé)

Commande de validation de chaque lot : `pnpm check` vert. Interdits communs : modifier la CSP, une ressource distante, une police ou une dépendance, `innerHTML`/`style=`/`<style>`/`on*=`, affaiblir `test/css-motion.test.ts` ou `test/html.test.ts`, toucher `packages/core`, la gate, la politique, les secrets, `safeEnv` ou un lancement de processus, un identifiant de modèle, une valeur inventée.

**P1 — Jetons, composer, Configure.** Fichiers : `media/chat.css`, `media/chat.js`, `media/ui.js`, `src/logic/html.ts` (`chatHtml`), tests associés. Critères : rayons §3 ; composer sur une ligne, Configure en icône sous 360 px ; popover 232 px une colonne ; Mode/Bypass/Persona présents `disabled` avec « bientôt », sans message IPC ; boutons trombone désactivé « bientôt », @ et / avec menus limités au tableau §2 (`/clear` poste `reset`) ; pas de bouton MCP ni jauge ; état orange sur `body.awaiting` ; sélecteurs testés conservés (`model-chip`, `cfg-btn`, `history-btn`, `#thinking`, `.spin-strip`, `#csp-violation`, `#overflow`) ; aucun débordement à 280 px. Interdits : câbler Layout (P4), Bypass ou Mode.

**P2 — Cartes d'approbation.** Fichiers : `media/chat.js` (`renderCard`), `media/chat.css`, test. Critères : carte en grille clé/valeur (outil, résumé, raison, détail repliable) ; boutons exactement `once`, `deny`, `always` (ce dernier seulement si `canRemember`, toujours sous modale native) ; Échap = refuser conservé ; aucune ligne conteneur/workdir ; aucune puce de règle. Interdits : changer le message `approve` ou ses choix.

**P3 — Terminal latéral.** Fichiers : nouveaux `media/terminal.js`, `media/terminal.css` ; `src/logic/html.ts` (`terminalHtml`, même CSP) ; `src/extension/extension.ts` (panneau `john.terminal` Beside, singleton, transmission de la vue du chat existante) ; `extension.manifest.json` (commande `john.openTerminal`) ; tests (CSP de `terminalHtml` ; `css-motion` étendu à **chaque** `media/*.css`). Critères : onglet agent = appels d'exec Exegol de la vue (commande, statut, sortie si la vue la porte), texte en `textContent`, DOM borné (lignes anciennes retirées au-delà d'un plafond) ; onglet shell désactivé « bientôt » ; « Effacer » local. Interdits : `docker exec`, `createTerminal`, `child_process`, nouveau message vers le moteur.

**P4 — Layouts et sessions.** Fichiers : `src/extension/extension.ts` (panneau `john.stage`, message webview `setLayout` validé par liste blanche `editor|chat|monitor`, `workspaceState`, `StatusBarItem` conteneur/layout/modèle), `src/logic/html.ts`, `media/chat.js`, `media/ui.js` (`monitorRows(view)` pur, testé), `media/chat.css`, test. Critères : une seule surface de chat active (placeholder dans la Side Bar en layout Chat, aucune carte rendue en double) ; Monitor en lecture seule avec renvoi au chat ; liste Sessions = historique restylé, statut « en cours » seulement si `running`. Interdits : sessions multiples, rooms, état inventé.

**P5 — Réglages.** Fichiers : `media/studio.js`, sa feuille (règles `.studio*`), `src/logic/html.ts` (`studioHtml` si besoin), test. Critères : groupes Engagement (Projet, Conteneurs, Fournisseurs, Personas, Approbations, Kill chain) et Système (Modèle, Harness, MCP, Atlas, Disposition, Modes, Contrôle système) ; compteur Kill chain réel ; pas de pastille de statut, pas de Licence. Interdits : nouvelle page à données inventées.

## 5. Décisions requises

Pour `architect` (voie moteur) :
1. **Bypass des approbations** : sémantique, bornes (deny, chemins, dangers shell jamais contournés), journalisation, affichage. Rien n'est câblé avant un ADR.
2. **Modes Answer/Plan/Auto** : correspondance avec `permissionMode`, option verrouillée.
3. **Shell interactif du terminal maison** : `docker exec -i` lancé par l'extension (sans PTY, `safeEnv`, cycle de vie, plafonds) et protocole webview↔processus.
4. **Sortie des exec dans la vue** (capée, masquée) si elle n'y est pas déjà ; durée des appels.
5. **Champs conteneur/cwd dans la demande d'approbation** (`approval.ts:12-22`).
6. **Règles depuis une carte** (puces allow/ask/deny) : écriture de politique, empreinte.
7. Données d'usage (contexte), statut MCP, pièces jointes, personas.

Pour l'utilisateur : voir le rapport.
