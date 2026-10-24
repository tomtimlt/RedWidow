# Idées pour warband

Réserve d'idées, non triée par priorité. Rien ici n'est décidé : toute entrée
retenue passe par `architect` (voie moteur) ou `cadre` (voie produit), et une
décision structurante devient un ADR dans `docs/adr/`.

Toutes les idées cyber supposent un cadre autorisé : mission avec périmètre et
accord écrit.

## Confort de l'extension (voie produit)

- **Diff avant d'approuver une écriture.** La carte d'approbation ouvre le diff
  natif de VS Code au lieu d'un simple chemin : on voit ce qu'on approuve. La
  gate ne change pas, c'est seulement l'affichage.
- **Points de retour par tour.** Avant chaque consigne, un instantané Git (ref
  cachée ou stash). Un bouton « revenir à avant ce tour » restaure l'espace de
  travail. Le graphe causal sait quel outil a touché quel fichier, ce qui
  permettrait aussi d'annuler un seul appel.
- **Coût et quotas par chat.** Le SDK envoie déjà `rate_limit_event` et le
  `result` avec l'usage, mais rien ne l'affiche. Une jauge par chat. Les
  messages `task_summary`, `post_turn_summary` et `autocompact_state`,
  aujourd'hui comptés dans `unhandledMessages`, pourraient y apparaître.
- **Recherche dans tous les journaux** : « quand ai-je lancé nmap sur
  10.0.0.5 ? ».
- **Statistiques de la gate** : quels outils sont refusés le plus souvent,
  quelles règles ne servent jamais.
- **Approbation à distance.** Les demandes d'approbation arrivent sur le
  téléphone (ntfy, Telegram…) quand on n'est pas devant l'écran. La gate reste
  la seule autorité ; seul le canal de notification change.
- **Tâches de fond.** Une consigne longue tourne sans chat ouvert ;
  notification VS Code quand une approbation est nécessaire ou que c'est fini.

## Orchestration d'agents

- **Agent relecteur.** Un second agent, en lecture seule, relit ce que le
  premier vient de faire et signale erreurs ou oublis avant l'approbation de la
  suite. En contexte cyber : signale ce qui est bruyant, hors périmètre ou mal
  justifié.
- **Recettes.** Des consignes à étapes enregistrées (« énumération web »,
  « revue de dépôt ») relancées en un clic avec des paramètres.
- **Mémoire de projet.** L'agent consulte un résumé de ce qui a été établi lors
  des sessions précédentes, sans relire tout l'historique.
- **Même consigne, deux moteurs.** L'ADR 0008 donne déjà un moteur par chat. On
  envoie la même consigne à Claude et à OpenCode côte à côte, puis on compare
  les diffs et les approbations demandées.
- **Rejouer une session.** On charge un journal dans le chat et on avance tour
  par tour, le graphe se construisant au fil de la lecture. Journal, graphe et
  export existent : il manque le lecteur.
- **Profils de mission.** Un préréglage par type de travail (politique, bac à
  sable, réseau, image). Ex. « audit lecture seule », « dev avec réseau ».
  Choisi à l'ouverture d'un chat.

## Sécurité (voie moteur)

- **Politique suggérée, jamais imposée.** Après plusieurs approbations
  identiques, l'interface propose d'ajouter une règle `allow` à la politique
  utilisateur. L'utilisateur valide. Les `deny`, chemins sensibles et dangers
  shell sont exclus d'office, conformément aux invariants.
- **Durcissement restant.** `plugins`, `agents` et `pathToClaudeCodeExecutable`
  restent passables via `sdkOptions` côté Claude (noté dans
  `docs/architecture-issues.md`, « À faire plus tard ») ; à examiner.

## Cyber — traçabilité et preuve de mission

- **Journal chaîné infalsifiable.** Chaque ligne du JSONL porte l'empreinte de
  la précédente. `journal verify` et l'export HTML signalent toute altération.
  Prouve au client l'ordre exact des actions et qu'aucune n'a été ajoutée après
  coup.
- **Horodatage signé.** À la clôture, le journal est scellé (signature
  détachée, ou horodatage RFC 3161). Utile en cas de litige.
- **Chronologie d'attaque exportable.** À partir du graphe causal : à telle
  heure, tel outil, sur telle cible, tel résultat. Matière d'un rapport et de
  tout exercice *purple team*.
- **Carte d'attaque.** Relier les trouvailles entre elles (hôte → service →
  identifiant → accès) dans un graphe qui se remplit pendant la mission, à
  partir du graphe causal existant.

## Cyber — garde-fous métier

- **Périmètre dur.** IP, domaines et plages autorisés déclarés en début de
  mission. La gate refuse tout appel visant hors périmètre, sans contournement
  (même logique que le refus hors espace de travail déjà en place). Protection
  la plus importante, absente de presque tous les outils d'agents offensifs.
- **Fenêtre horaire.** Hors des heures convenues au contrat, les outils
  offensifs se bloquent d'eux-mêmes.
- **Garde-fou de bruit.** La gate reconnaît les options agressives (`-T5`,
  force brute massive) et demande une confirmation explicite, pour éviter de
  faire tomber un service de production.

## Cyber — données sensibles

- **Coffre à identifiants.** Mots de passe et hachages trouvés vont dans un
  coffre chiffré. L'agent ne les voit jamais en clair : il manipule une
  référence (`cred#3`) que le moteur substitue au lancement de la commande.
  Prolonge le masquage des secrets déjà fait dans le recorder.
- **Anonymisation à l'export.** Un mode qui remplace IP, noms et identifiants
  du client par des jetons stables au moment de l'export HTML, pour partager
  une démo ou une formation sans exposer le client.
- **Mode démo.** Rejouer une session en masquant IP et noms du client, pour une
  présentation ou une formation.

## Cyber — couverture et réutilisation

- **Cartographie vers un référentiel.** Trouvailles reliées aux catégories
  OWASP, MITRE ATT&CK ou PTES. On voit ce qui a été couvert et ce qui manque,
  avant la fin de la mission.
- **Rejeu reproductible.** Les commandes de la mission s'exportent en script
  rejouable, pour qu'un client vérifie une correction ou qu'on refasse un test
  après remédiation.
- **Liste de nettoyage de fin de mission.** Générée depuis le journal :
  fichiers déposés, comptes créés, services lancés sur les cibles — à retirer
  avant de partir.

## Intégration SysReptor

Exegol tient déjà des trouvailles par projet (`packages/core/src/exegol/findings.ts`) ;
SysReptor en fait un rapport de pentest. Une trouvaille warband (type,
libellé, état) correspond plutôt à une **note** SysReptor qu'à un *finding*
(qui attend CVSS, description, remédiation, modèle de rapport).

Trois voies :

- **A — Bouton « Envoyer vers SysReptor », piloté par l'humain (recommandé en
  premier).** Depuis le panneau Trouvailles ou un tour du chat, on pousse une
  sélection vers un projet SysReptor (notes ou finding brouillon). L'agent n'a
  aucun accès. Client HTTP TypeScript + réglage URL et jeton. Jeton masqué par
  le recorder, jamais journalisé.
- **B — Outils `mcp__sysreptor__*` pour l'agent, écrits par nous.** Sur le
  modèle du toolset Exegol (`tool-specs.ts`) : lire le projet, ajouter une
  note, créer un finding brouillon. Chaque écriture passe par la gate.
- **C — Brancher `reptor mcp` tel quel (déconseillé).** Moins de code, mais
  dépendance Python, outils générés automatiquement, CLI alpha, serveur sans
  authentification, et il faut ouvrir la configuration MCP stricte du moteur.

Points de sécurité, quelle que soit l'option : jeton traité comme un secret
(masquage + `safeEnv`) ; chaque envoi explicite ; trouvailles `credential` et
`loot` exclues par défaut ; option « CA personnalisée » pour les instances
auto-signées, jamais de désactivation TLS.

Décisions à demander : SysReptor auto-hébergé ou cloud ? envoyer le journal
(notes) ou rédiger des vulnérabilités (findings) ? l'agent écrit-il lui-même
(option B) ? faut-il aussi **importer** le périmètre du projet comme cibles
Exegol ?

## Portage du bac à sable : Kali Docker et Kali WSL

Le mécanisme d'exécution est générique : `execWorkspace` fait un
`docker exec --workdir /workspace <conteneur> <argv>`
(`packages/core/src/docker/client.ts`).

**Kali en Docker — effort faible.** Ce qui est spécifique à Exegol se réduit à
quatre points à rendre configurables par profil :

1. le filtre de liste par label `org.exegol.*` (`client.ts`) ;
2. le préfixe de nom court `exegol-` (`targets.ts`) ;
3. le répertoire `/workspace` codé en dur dans `execWorkspace` ;
4. le lancement par le binaire `exegol` (`extension.ts`), remplacé par
   `docker run` / `docker start`.

Aucun de ces points ne touche à la gate.

**Kali en WSL — effort moyen à élevé.** Ce n'est plus Docker : pilotage par
`wsl -d kali-linux -- <commande>`. Il faut :

- un **nouvel adaptateur d'exécution** à côté de `DockerClient` (processus via
  `wsl.exe`) ; recorder, gate, événements et graphe restent identiques ;
- une **décision sécurité** : `wsl` est délibérément dans la liste des dangers
  shell (`packages/core/src/approval/shell.ts`) ; il faut une voie dédiée et
  contrôlée, pas une levée de l'interdiction → ADR + revue sécurité ;
- repenser la résolution par `@nom` et le conteneur dédié (`targets.ts`) : WSL
  a des distributions, pas des conteneurs nommés.

Forme cible : une notion de **profil de bac à sable** (Exegol, Kali-Docker,
Kali-WSL) décrivant comment lister, démarrer et exécuter. Le cœur ne change
presque pas pour le cas Docker ; le cas WSL ajoute un adaptateur.

## Ancien inventaire de chantiers — historique à recouper

Cette liste précède plusieurs livraisons. Elle ne sert plus de liste de tâches :
Windows W-L6 est indiqué comme validé dans le suivi, le bac à sable ADR 0003
est abandonné, et plusieurs fonctions de graphe/cours/Kali existent déjà.
Voir [l’état du projet](etat-du-projet.md) avant de reprendre un élément.

### Liste conservée pour mémoire

Voir `docs/architecture-issues.md`.

- **Bac à sable Docker, lots S1 à S5** (ADR 0003) : tous « à faire », plus gros
  chantier ouvert.
- **Sous-agents (outil Task) rattachés dans le graphe** : jamais testé.
- **Export HTML** : recherche, pagination, repli des sous-arbres, arêtes
  approbation → processus, lien des `api.retry`.
- **Rotation des journaux** (seul le plafond d'octets existe).
- **Nettoyage des conteneurs orphelins** quand le client docker est tué par
  SIGKILL.
- **Validation sur un vrai Windows** (lot W-L6) ; job CI Windows encore rouge.
- **Support de podman** (parsing tolérant, option `engine`, tests).

C'est une excellente question. Puisque ton architecture sépare le cœur (moteur, sécurité) des interfaces, tu as une base saine pour ajouter des fonctionnalités très fortes. 

Voici des idées pratiques, classées par profil, en gardant toujours ton ADN : **contrôle, traçabilité et transparence**.

---

###  Pour les Pentesters Pros (Efficacité, Rigidité, Reporting)

Les pros se fichent que l'IA "discute" ; ils veulent qu'elle leur fasse gagner du temps sans faire de fautes professionnelles.

1. **Le "Scope Enforcement" (Garde-fou de périmètre absolu)**
   * **L'idée :** Avant de commencer, l'utilisateur importe un fichier `scope.txt` (liste d'IP/domaines autorisés pour la mission).
   * **En pratique :** Le moteur de Warband (la *Gate*) intercepte **toutes** les commandes. Si l'agent tape `nmap 8.8.8.8` et que ce n'est pas dans le scope, la gate refuse catégoriquement, même si l'utilisateur clique sur "Autoriser". C'est la sécurité légale ultime pour un freelance ou un cabinet.

2. **L'OPSEC et le "Client-Safe Mode" (Masquage des données)**
   * **L'idée :** Les pros ne peuvent pas envoyer les IP clients ou les mots de passe trouvés à OpenAI/Anthropic (RGPD/NDA).
   * **En pratique :** Warband intercepte les prompts avant l'envoi au LLM et remplace les vraies IP par `[IP_CIBLE_1]` et les hashs par `[HASH_1]`. Quand la réponse revient, il remet les vraies valeurs localement.

3. **L'Export de Rapport Automatique (Markdown/PDF)**
   * **L'idée :** Tu as ton carnet de trouvailles avec MITRE ATT&CK.
   * **En pratique :** Un bouton "Générer le rapport". Warband compile toutes les commandes exécutées, les outputs pertinents, les notes MITRE et les captures d'écran du terminal dans un beau document Markdown structuré, prêt à être collé dans Obsidian, Dradis ou Ghostwriter.

4. **Le "Loot Extractor" (Extraction de butin)**
   * **L'idée :** Quand tu lances `secretsdump.py` ou `gobuster`, l'output est énorme.
   * **En pratique :** L'agent ne se contente pas d'afficher la sortie, il parse les résultats en temps réel. S'il voit un `NTLM hash`, il l'ajoute automatiquement à un onglet "Credentials" dans l'UI. S'il voit un répertoire `.git`, il le note dans "Web Findings".

5. **Le "Terminal Shadowing" (Contexte de l'hôte)**
   * **L'idée :** Le pentester a souvent plusieurs terminaux ouverts (un pour le pivot, un pour Responder, etc.).
   * **En pratique :** Ton système de mention `#` est déjà génial. Pousse-le : permettre à l'agent de lire les 50 dernières lignes d'un terminal en arrière-plan pour comprendre le contexte ("Ah, je vois que ton tunnel Chisel est tombé, veux-tu le relancer ?").

---

###  Pour les Débutants / CTF Players (Pédagogie, Fun, Aide au blocage)

Les débutants ont besoin d'être rassurés, guidés, et de ne pas casser leur machine.

1. **Le "Explain Before Execute" (Mode Pédagogique)**
   * **L'idée :** Le débutant ne comprend pas toujours la commande que l'IA propose.
   * **En pratique :** Dans la carte d'approbation, en plus de "Autoriser" ou "Refuser", un bouton **"Expliquer"**. L'IA détaille chaque argument de la commande (`-sS` veut dire SYN Scan, `-Pn` veut dire ne pas ping, etc.) avant que l'utilisateur ne valide.

2. **Le "CTF Mode" (Chasse aux Flags)**
   * **L'idée :** En CTF, on cherche des flags (`flag{...}`, `HTB{...}`).
   * **En pratique :** Warband surveille les sorties terminal en arrière-plan. Dès qu'une regex de flag est détectée, l'interface déclenche une notification visuelle (genre confettis ou bordure verte) et ajoute le flag dans une liste "Flags capturés" sur le côté. L'agent peut même dire : *"J'ai trouvé le user.txt, on cherche le root maintenant ?"*

3. **Le "Nudge System" (Le coup de pouce sans spoiler)**
   * **L'idée :** Quand un débutant bloque, il demande la réponse. C'est nul pour apprendre.
   * **En pratique :** Un réglage dans l'UI : "Niveau d'aide". Si on est sur "Débutant", l'IA ne donne pas la commande finale. Elle dit : *"Regarde du côté du port 80, il y a un CMS. As-tu essayé de vérifier sa version ?"* Si on est sur "Pro", elle donne la commande brute.

4. **Le "Workflow Builder" (Scénarios guidés)**
   * **L'idée :** Proposer des "recettes" toutes faites.
   * **En pratique :** Des boutons au démarrage du chat : "Énumération Web", "Scan Réseau basique", "PrivEsc Linux". Ça pré-remplit le prompt et lance une série d'étapes logiques (avec approbation à chaque étape).

5. **La "Sandbox Visuelle" (Pour les débutants sur Windows)**
   * Puisque tu es natif Windows sans WSL, c'est l'occasion rêvée pour les débutants Windows qui galèrent avec Docker. 
   * Un bouton "Démarrer un environnement de test" qui lance un conteneur Docker (Kali ou Exegol) avec une cible vulnérable pré-configurée (comme *Metasploitable* ou *OWASP Juice Shop*) en local. Idéal pour s'entraîner sans rien configurer.

---

###  L'idée "Killer Feature" (Qui marche pour les deux)

**Le "Replay" de Kill Chain (Le temps réel et le passé)**
Puisque tu as un journal d'événements JSONL et un graphe causal :
* **L'idée :** Une timeline interactive.
* **En pratique :** Le pro comme le débutant peut cliquer sur une étape du graphe (ex: "Découverte du port 445"). Ça ouvre un panneau qui montre : *la commande exacte*, *l'output exact*, *le prompt de l'IA à ce moment-là*, et *la décision d'approbation* (qui a cliqué, à quelle heure). C'est la fonction "Boîte noire" de l'avion. Tu peux rejouer ton pentest étape par étape.

###  Conseil d'implémentation
Ne cherche pas à tout faire d'un coup. Ton architecture événementielle te permet de les ajouter comme des "plugins" ou des règles dans ton moteur. 
*   **Priorité 1 pour les pros :** Le Scope Enforcement. C'est le truc qui va faire dire "Ok, cet outil est safe pour mes clients".
*   **Priorité 2 pour les débutants :** L'explication des commandes dans la carte d'approbation. Ça coûte presque rien à coder (c'est juste un prompt) et ça transforme l'outil en professeur.

Tu as une base saine. Choisis une ou deux idées qui te parlent le plus, et intègre-les à ton README. Le positionnement de Warband sera béton.
