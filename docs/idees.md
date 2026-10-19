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

## Chantiers déjà planifiés à relancer

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
