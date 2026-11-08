# Plan — Performance offensive de l'agent (warband)

## Contexte
L'objectif fixé par l'utilisateur : que le résultat d'une mission (test d'intrusion
autorisé, chasse aux vulnérabilités, machines HackTheBox difficiles/insane) ne
dépende quasiment plus que de la taille du modèle. Le harnais doit fournir au modèle
ce qui lui manque, pour qu'un modèle même non spécialisé cyber sorte le maximum de sa
capacité. Modèle de référence : DeepSeek via OpenCode (gratuit). L'utilisateur
attaque à chaud ; l'orchestrateur révise à froid à partir des traces.

Diagnostic de l'utilisateur, confirmé par l'exploration : « avec la solution il se
débrouille ; sans, il bloque ». Le modèle sait **exécuter**. Il échoue sur la
**découverte** (voir l'indice, générer la bonne hypothèse), la **décision** (ne pas
tunneliser) et la **persévérance** (ne pas abandonner). Les trois explorations
montrent que le harnais aggrave ces trois points. On ne mesure rien aujourd'hui.

Principe directeur : **mesurer d'abord, corriger ensuite, re-mesurer**. Chaque levier
est validé sur une trace réelle d'un run bloqué, pas sur une supposition. Tout le
travail est de l'ingénierie du harnais ; l'exécution des attaques se fait dans
l'environnement de l'utilisateur (conteneur Kali/Exegol), sur des cibles autorisées.

## Problèmes constatés (faits cités)

**A. Le modèle ne voit pas les indices (découverte)**
- `execute_command` et `exec` : garde les **200 dernières lignes** (`docker/tool-specs.ts:12-19`), une ligne coupée à 16 Kio (`process/lines.ts:8`). Sur Exegol, stderr bavard chasse stdout, et sur code ≠ 0 stdout est perdu (`docker/client.ts:450-457`).
- Outils Kali : réponse JSON sur une ligne, coupée à 16 Kio **sans marqueur**, JSON devenu invalide (`kali/api.ts`, `vscode/test/tool-output.test.ts:79`). Rien n'est sauvegardé pour relecture.
- `read_url` retire commentaires HTML, JS, champs cachés (`web/tools.ts:33-51`) — justement les indices de CTF. `http_request` les garde (64 Kio).
- Aucun outil de grep/tail sur une grande sortie sauvegardée ; il faut repasser par le shell, qui subit les mêmes plafonds. `read_project_file` lit par tranches mais seulement le dossier projet sur l'hôte (`vscode/src/engine/project-files.ts`).
- Masquage : un hash/JWT noté comme indice devient `[REDACTED]` dans `remember` (`project.ts:210`) et dans les extraits du bureau (`mission-desk.ts:390`).

**B. Le moteur ne relance jamais le modèle (persévérance)**
- Quand le modèle finit son tour, le run attend le prompt suivant ; un tour en échec arrête le run (`agent-opencode/src/runner.ts:1189,1262`). **Aucune continuation automatique.**
- Les relances ne sont que des champs de `mission_context`, injectés au début du tour (≤ 6000 car., `runner.ts:499-506`) et **supprimés en premier** quand le paquet déborde (`mission-desk.ts:902`). En cours de tour, rien n'est injecté.
- `stagnation` ne monte que si outil+arguments+résultat sont identiques : changer un paramètre y échappe (`mission-desk.ts:386`). Pas de détecteur d'« abandon imminent » hors un test de mots-clés (`isClosingText`).
- `methodology.ts:56` autorise explicitement l'arrêt quand les « pistes raisonnables sont épuisées » — contraire à l'objectif.

**C. Le modèle ne reçoit aucun savoir offensif (découverte/décision)**
- Le socle dit « méthode uniquement, sans recette ni technique » (`methodology.ts:1`). Les profils `htb`/`red-team` sont de la méthode pure, zéro vecteur/outil.
- Les seules « fiches » structurées sont dans `bug-bounty` (`agent-profiles.ts:78`, format « Fiche <entrée> : technique ; technique ») — **le modèle à reprendre**.
- HackTricks/OWASP/WSTG sont déjà dans le dépôt (`cours/sources.json`, outils `mcp__cours__chercher`/`lire`) mais **accessibles seulement en mode Apprentissage** (`runner-options.ts:23-24`). En mission, le modèle n'y a pas accès.
- `research-triggers.ts` détecte déjà techno/version/erreur/WAF mais ne produit qu'une relance textuelle — **aucun contenu injecté**, aucune correspondance situation→playbook.

## Approche retenue

### Étape 0 — Débloquer la PR #16 (préalable, hors sujet perf)
- CI Linux rouge : `packages/core/test/attack-flow.test.ts:132` ne garde le test que sur `import jsonschema`, mais le script importe aussi `referencing` (absent du runner). Corriger la garde pour tester les deux imports **et** ajouter `pip install "jsonschema>=4.18" referencing` dans `.github/workflows/ci.yml` (job `check`) pour que le test tourne réellement.
- Conflit avec `main` : seul `README.md`. Fusionner `origin/main` (merge commit, pas de rebase), résoudre README.

### Étape 1 — Banc de mesure (avant toute correction)
But : produire un chiffre de départ et surtout **localiser le point de blocage** sur une trace réelle.
- Outil d'analyse de trace : un script/commande CLI qui prend le journal JSONL d'un run (`core` journal) et produit un rapport : nb de requêtes, nb de tours, où le run s'arrête, dernières sorties d'outils tronquées, pistes ouvertes jamais retentées. Réutilise le journal existant (`core` recorder/journal) et `capOutput`.
- Protocole : l'utilisateur fournit la trace d'un run DeepSeek bloqué sur sa machine hard/insane. L'orchestrateur classe le blocage en A (pas vu), B (abandon), C (pas connu/pas envisagé). Chaque correction suivante est ciblée sur la classe dominante et re-mesurée sur le même run.
- Pas de cible jouet (DVWA/Juice Shop écartés par l'utilisateur).

### Étape 2 — Visibilité des sorties (classe A) — lot moteur `dev`
- Sauvegarde systématique de la sortie **complète** de `execute_command`, `exec` et outils Kali dans le dossier de mission (`scans/`), et renvoi au modèle d'un extrait **tête+queue** (pas seulement la queue) avec le chemin du fichier complet et un marqueur de troncature explicite. Réutilise la mécanique des tâches (`tasks/tools.ts:71` sauvegarde déjà dans `/workspace/outputs` et informe le modèle) — généraliser ce motif aux commandes synchrones.
- Nouvel outil de lecture de tranche + recherche sur ces fichiers sauvegardés (grep/tail bornés), sur le modèle de `read_project_file` (offset/longueur), sans repasser par le shell plafonné.
- Outils Kali : réparer la coupe à 16 Kio qui casse le JSON (marqueur + sauvegarde du corps complet).
- Ne pas masquer les hashes/jetons dans ce que voit le modèle (c'est déjà le cas en sortie brute) ; mais exposer une variante non masquée des indices que le modèle a lui-même notés, pour éviter la perte via `remember`/bureau.
- Critère : sur la trace de l'étape 1, l'indice précédemment hors fenêtre devient lisible.

### Étape 3 — Persévérance et anti-tunnel (classe B) — lot moteur `dev`
- **Continuation automatique** : à la fin d'un tour, si des pistes de la matrice de couverture restent `untested`/`blocked` et qu'aucun arrêt humain n'est demandé, le moteur ré-amorce un tour avec une relance injectée (« N pistes non testées : … ; reprends sans conclure »). Borne dure (budget de tours/temps de la mission) pour ne pas tourner à l'infini. S'appuie sur `coverage` et `research-triggers` existants.
- Durcir `stagnation` : compter la répétition d'**approche** (même famille d'outil/endpoint), pas seulement outil+arguments identiques (`mission-desk.ts:386`).
- Inverser la règle d'arrêt pour les profils offensifs : retirer/affaiblir « pistes raisonnables épuisées » (`methodology.ts:56`) au profit de « ne pas conclure tant que des pistes restent ou qu'une recherche n'a pas été faite ».
- Revoir l'encadrement : pour l'offensif, viser la **profondeur d'itération**, pas des points de contrôle qui coupent (`supervision.ts`). Ajouter un mode/variante « acharné » (peu de checkpoints, continuation forte).

### Étape 4 — Savoir offensif injecté (classe C) — lot `cadre`→`surface`
- Créer des **fiches de playbook** au format `bug-bounty` (`agent-profiles.ts:78`), par situation : service/port détecté, technologie/version, type d'erreur, classe de vuln. Contenu méthodologique orienté « quoi essayer et dans quel ordre », cité de sources publiques, **sans** copier de writeup de challenge (règle `agent-desk.ts:37` conservée).
- Brancher `research-triggers`/`detectTechnologies` (`research-triggers.ts:61-162`) pour qu'une techno/erreur détectée **sélectionne et serve la fiche correspondante** via `load_skill`, au lieu d'une simple relance textuelle.
- Ouvrir l'accès `cours`/HackTricks (déjà dans le dépôt) **hors mode Apprentissage** pour les missions autorisées. Usage personnel non commercial compatible CC-BY-NC ; noter la licence dans l'ADR (révision de l'ADR 0010).
- Ajouter `gtfobins.github.io`, `hacktricks` aux `REFERENCE_HOSTS` (`web/guard.ts:13-40`) pour que `read_url` n'exige plus d'autorisation sur ces sources.

### Étape 5 — Re-mesure et itération
- Relancer la trace de l'étape 1 après chaque étape, comparer le point de blocage.
- Répéter sur le mur suivant que l'utilisateur rapporte.

## Fichiers principaux touchés
- Mesure : nouveau script d'analyse de journal (CLI) ; `packages/core` journal/recorder (lecture).
- Visibilité : `packages/core/src/docker/tool-specs.ts`, `process/lines.ts`, `process/run.ts`, `kali/tool-specs.ts`+`kali/api.ts`, `tasks/tools.ts` (motif à généraliser), nouvel outil de lecture de tranche.
- Persévérance : `packages/core/src/mission-desk.ts`, `methodology.ts`, `supervision.ts`, `agent-opencode/src/runner.ts` (continuation).
- Savoir : `packages/core/src/agent-profiles.ts` (fiches), `research-triggers.ts`, `agent-desk.ts` (load_skill), `web/guard.ts`, accès `cours` hors apprentissage (`runner-options.ts`, `engine/main.ts`).

## Vérification
- `pnpm check` vert à chaque lot ; revue orchestrateur des lots gate/politique.
- Banc de trace : le même run DeepSeek bloqué doit franchir le mur visé après le lot correspondant (preuve, pas affirmation).
- L'utilisateur fournit les traces ; l'orchestrateur révise à froid.

## Décisions par défaut (modifiables)
1. Ordre : étape 0, puis 1 (mesure), puis A (visibilité), B (persévérance), C (savoir). Sans voir l'indice ni persévérer, le savoir ne sert à rien. Si la première trace montre une autre classe dominante, on réordonne.
2. HackTricks/cours accessibles en mission (usage personnel, licence notée).
3. Mode « acharné » = nouveau niveau d'encadrement (`relentless`) à côté de léger/standard/strict, recommandé pour HTB et bug bounty : continuation forte, seuils anti-tunnel actifs, pas de checkpoint qui coupe.

## Organisation du travail
- Exploration : `explorer` (Haiku). Code moteur : `dev` (Sonnet). Fiches/produit : `cadre` puis `surface`. Décision et revue courte : orchestrateur. Un lot à la fois par zone ; `pnpm check`, diff et revue avant chaque push sur `temp/0.3.74-attachments-vision`.
- Ce que l'utilisateur fournit : la trace brute d'un run DeepSeek bloqué (hard/insane), la configuration OpenCode utilisée, et les traces après chaque lot.
