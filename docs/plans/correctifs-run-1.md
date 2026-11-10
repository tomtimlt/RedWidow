# Plan — Correctifs issus du run programme A n°1 (pour implémenteur GPT)

Branche : `temp/0.3.74-attachments-vision`. Release visée : 0.3.77 (procédure de `docs/livraison-0.3.76.md`).
Règles du dépôt : voir `CLAUDE.md` (texte en français, `pnpm check` vert avant chaque commit, aucun identifiant de modèle, gate inchangée, tout nouveau code `Reason` → `REASON_CODES` + catalogues fr/en, tout nouveau `kind` → validateur + `KIND_CLASS` + switch de `cli/format.ts`).

## Contexte

Premier run réel de bug bounty (DeepSeek via OpenCode, RedWidow 0.3.76, programme YesWeHack programme A). 159 appels en 29 min, aucune vulnérabilité. Constats tirés de la trace :

1. **Monitor aveugle** : l'agent n'a utilisé que des outils MCP (`mcp__web__http_request`, `read_url`, recherche). Le Monitor ne montre que `mcp__exegol__exec` et `mcp__kali__*` (filtre par nom, `packages/vscode/src/logic/chat.ts:438-450` et `packages/vscode/media/ui.js:12-13,82-110`). L'utilisateur n'a rien vu en direct.
2. **Pas d'export du fil** : aucun export de la conversation (texte agent, outils). L'utilisateur doit copier-coller. L'export d'audit ne garde pas `turn.*` (`packages/core/src/audit.ts:33-53`) et sa forme enveloppée (`{v,id,projectId,ts,actor,kind:"engine",runId,data}`, sans `seq`) n'est pas lisible par `warband trace`.
3. **Bannissement d'IP par le WAF** : une charge classique (`?hash=../../../../etc/passwd`) a fait bannir l'IP sur l'edge ModSecurity ; plusieurs hôtes de la cible partagent la même adresse IP publique. Le contrôleur de rythme est par nom d'hôte (`packages/core/src/pace/controller.ts:87-94`, clé `hostOfTarget(url.hostname)` dans `packages/core/src/web/http-request.ts:143`) : l'agent a continué sur les hôtes voisins et prolongé le bannissement.
4. **Gros corps illisibles** : `http_request` tronque la réponse à 64 Kio (`http-request.ts:205`, `capOutput`) sans rien sauvegarder ; OpenCode range le reste dans son propre dossier, sur une seule ligne, hors de portée de `read_output`. `comptage.js` (68 Ko) n'a jamais pu être cherché.
5. **Relances trop tardives** : la première recherche web arrive après 46 appels. Les relances (`research-triggers.ts`) ne passent que par `mission_context` en début de tour ; un run OpenCode est souvent un seul long tour.
6. **Pas de créativité** : la trace montre une liste de contrôle générique (balayage HEAD, `.env`, `robots.txt`, `favicon`, `health`, traversée classique). Une seule piste dérivée de l'application (format de `ajax.php`), abandonnée faute de lire le JS. Le but de l'utilisateur : que l'agent **innove** (hypothèses tirées du comportement observé, logique métier, méthodes peu connues), pas qu'il devienne un scanner amélioré.
7. **Aucun conteneur attaché** (`containers: []`) : l'agent n'avait pas Exegol, sans qu'aucun avertissement ne le signale.

## Lots (dans l'ordre ; un commit par lot ; `pnpm check` vert)

### Lot 1 — Monitor : tous les appels d'outils
- `packages/vscode/src/logic/chat.ts` (`monitorChatView`, l.438-450) et `packages/vscode/media/ui.js` (`monitorRows`, l.82-110, constantes l.12-13) : retirer le filtre par nom ; toute ligne `item.kind === "tool"` entre au Monitor.
- Rendu par famille (dans `ui.js`, à partir de `tool` et `input`) :
  - `mcp__web__http_request` : `MÉTHODE url → statut (octets)`, en rouge si erreur, délai ou arrêt de rythme ;
  - `mcp__web__read_url` et recherche web : URL ou requête ;
  - `read_output` / `projectfiles` : chemin et motif ;
  - exec et Kali : rendu actuel inchangé.
- Filtre dans l'en-tête du Monitor : « Tout / Shell / Web » (état local de la page, pas de nouveau message moteur).
- L'export texte du Monitor (`extension.ts:1802-1806`) suit le même contenu.
- Critères : tests dans `packages/vscode/test/` couvrant une vue avec un `http_request` et un `exec` ; les deux apparaissent ; le filtre « Shell » masque le web.

### Lot 2 — Export du fil de mission
- Nouvelle fonction pure `packages/vscode/src/logic/chat-export.ts` : `exportChat(events): { markdown: string; jsonl: string }` à partir des événements du cœur `user.message`, `agent.text`, `agent.thinking` (option, désactivée par défaut), `tool.requested`, `tool.result` (sortie limitée à 4 Kio par appel, avec mention de troncature), `approval.decided`, `continuation.auto`, arrêts de rythme. Horodatage et numéro d'appel sur chaque ligne.
- Les événements viennent du journal (déjà masqué par le recorder) : ne rien relire hors du journal, ne pas ajouter l'e-mail du compte.
- Commande `warband.exportChat` (manifeste + `extension.ts`, à côté de `exportAudit`, l.4033) et bouton « Exporter le fil » dans la vue chat. Sortie : `<projet>/exports/fil-<runId>.md` + `.jsonl`.
- Ajouter `chat.md` dans le ZIP d'audit (`packages/vscode/src/logic/audit-export.ts`).
- Ajouter `turn.started`/`turn.finished` (et `continuation.auto` s'il manque) à l'ensemble `retained` de `packages/core/src/audit.ts:33-53`.
- Critères : test unitaire de `exportChat` (ordre, troncature, pensées exclues par défaut) ; test d'audit vérifiant la présence de `turn.finished`.

### Lot 3 — `warband trace` lit l'export d'audit
- `packages/core/src/trace/analyze.ts` (ou sa lecture dans `packages/cli/src/main.ts`) : accepter, en plus du journal brut, un fichier `events-*.jsonl` d'audit **ou le ZIP lui-même** (lecture de `journals/*.jsonl`). Désenvelopper `kind:"engine"` → `data` ; ignorer les autres enregistrements.
- `seq` absent : ordre = ordre des lignes, sans avertissement par ligne (un seul avertissement de synthèse).
- Critères : fixture synthétique enveloppée (pas de données réelles de cible dans le dépôt) ; même rapport que pour le journal brut équivalent ; tours comptés.

### Lot 4 — Rythme partagé par IP et détection de bannissement
- `packages/core/src/pace/` : la clé du contrôleur devient un **groupe d'edge** = adresse IP résolue (la résolution existe déjà pour le contrôle d'adresse publique, `packages/core/src/web/network.ts:180` ; la réutiliser, ne pas résoudre deux fois). Le registre garde `hôte → groupe` et la liste des hôtes du groupe.
- Débit, pauses, arrêt et reprise s'appliquent au groupe. `program resume <hôte>` reprend le groupe de cet hôte. Le fichier d'arrêt persistant (`project.ts:176`) reste lisible dans l'ancien format (par hôte).
- **Bannissement suspect** : un délai dépassé (ou une connexion coupée) sur un groupe qui répondait sainement juste avant → pause immédiate du groupe (5 min) ; un second signal pendant la pause → arrêt du groupe. Le message rendu au modèle nomme tous les hôtes du groupe et dit d'arrêter toute requête vers eux, de passer à une source passive ou à un autre groupe.
- Nouveaux codes éventuels (`pace.edgeBanSuspected`, …) : `REASON_CODES` + fr/en.
- Ne pas toucher à la gate ni à `evaluateProgram` : le rythme reste un frein, pas une autorité.
- Critères : tests du contrôleur — deux hôtes même IP partagent le débit ; un délai après des réponses saines met le groupe en pause ; la reprise d'un hôte relâche le groupe ; ancien fichier d'arrêt relu.

### Lot 5 — Gros corps HTTP sauvegardés et cherchables
- `packages/core/src/web/http-request.ts` : au-delà de 64 Kio (et toujours pour JS/JSON minifiés > 2000 caractères par ligne), écrire le corps complet dans `<projet>/outputs/warband-http-<id>/body.txt` en réutilisant `packages/core/src/docker/output-capture.ts` (même plafond, même dossier que `execute_command`). Pour un corps à lignes très longues, écrire aussi `body.split.txt` (coupure après `;`, `}` ou `,` dès 200 caractères) pour que la recherche ligne à ligne fonctionne.
- Réponse au modèle : statut, en-têtes, extrait tête + queue, puis la même ligne que pour `execute_command` (« sortie complète : … ; à relire avec read_output (tranche ou recherche) »).
- Le dossier `outputs` doit être passé au serveur web comme il l'est déjà au serveur docker (`packages/vscode/src/engine/main.ts`).
- Critères : test — corps de 200 Kio sur une ligne → fichiers écrits, `read_output` avec motif trouve une chaîne au milieu ; corps < 64 Kio → rien d'écrit.

### Lot 6 — Relances en cours de tour
- `packages/core/src/mission-desk.ts` : exposer `pendingNudge(): string | null` (relances de `research-triggers.ts` et pistes de couverture non testées, ≤ 300 caractères, au plus une toutes les 8 réponses d'outil, jamais deux fois la même).
- Les serveurs MCP du moteur (web, exegol, kali, projectfiles) ajoutent cette note en pied de résultat (« Note du bureau : … »). Elle est journalisée dans `tool.result` comme le reste.
- Déclencheur (a) de `research-triggers.ts` (technologie vue sans recherche) : actif dès la première détection, pas après N appels.
- Critères : test — après détection d'une techno sans recherche, le résultat d'outil suivant porte la note ; elle ne se répète pas.

### Lot 7 — Créativité : hypothèses dérivées plutôt que liste de contrôle
Méthode (texte, `packages/core/src/methodology.ts` et profils `bug-bounty`/`htb` de `packages/core/src/agent-profiles.ts`) :
- **Hypothèse d'abord** : chaque sonde active part d'une observation citée (réponse, JS, en-tête, comportement) et d'une hypothèse écrite ; les chemins et charges génériques ne viennent qu'en complément.
- **Comprendre avant d'attaquer** : lire le JS et les flux de l'application (fonctions, rôles, états, identifiants) et en tirer les points de confiance à tester (logique métier, contrôle d'accès, enchaînements d'étapes).
- **Cible avec WAF** : sondes différentielles discrètes d'abord (comparer deux requêtes bénignes qui ne diffèrent que d'un élément) ; jamais de charge de signature connue en premier.
- **À chaque stagnation** : produire trois hypothèses non évidentes (enchaînement de deux comportements, différence entre deux analyseurs, état et concurrence, cache, encodage, méthodes inhabituelles) et tester la moins coûteuse ; noter l'origine dans `record_coverage`.

Mesure (`packages/core/src/trace/analyze.ts` + `packages/cli/src/trace-format.ts`) :
- « Dérivé / générique » : une requête est dérivée si son chemin ou un de ses paramètres apparaît dans une sortie d'outil antérieure ; sinon générique. Afficher le ratio et les 5 chemins génériques les plus fréquents.
- Nombre de familles de technique distinctes.
- Critères : test sur fixture synthétique (3 dérivées, 2 génériques → 60 %).

### Lot 8 — Avertissement sans conteneur
- Au démarrage d'une mission de profil offensif sans conteneur attaché : un événement existant ou nouveau (`mission.noContainer`, avec validateur, `KIND_CLASS`, `format.ts`), une ligne dans `mission_context` (« pas de conteneur : outils shell indisponibles ») et un bandeau dans le Monitor.
- Critères : test — profil `bug-bounty`, `containers: []` → événement émis et ligne présente.

## Interdits
- Ne pas affaiblir la gate ni les invariants de `CLAUDE.md` ; le rythme et les relances restent des aides, jamais une autorisation.
- Pas de données réelles de cible (URL, réponses du programme) dans les fixtures ou la documentation.
- Pas de binaire dans le dépôt ; aucun identifiant de modèle.
- Ne pas changer de branche, ne pas ouvrir de PR.

## Vérification
- `pnpm check` vert après chaque lot ; `git status` propre.
- Bout en bout : `pnpm build`, puis `node packages/cli/dist/main.js --lang fr trace <export-audit>.zip` produit tours, ratio dérivé/générique et aucun avertissement par ligne.
- Dans VS Code : une mission avec un `http_request` apparaît dans le Monitor ; « Exporter le fil » produit le Markdown.
- Re-mesure : l'utilisateur relance la même mission programme A (alias YesWeHack pour la surface authentifiée, Exegol attaché, rythme prudent), envoie le ZIP d'audit et le fil exporté ; comparaison à froid avec le run n°1 (appels avant la première recherche, ratio dérivé, bannissement évité).

## Livraison
Après approbation : copier ce plan dans `docs/plans/correctifs-run-1.md`, commit et push sur la branche ; l'implémenteur GPT part de ce fichier.
