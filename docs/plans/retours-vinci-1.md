# Plan — Retours du run VINCI n°1 et finition de l'interface (avant V1)

Branche : `temp/0.3.74-attachments-vision`. Version visée : 0.3.78. Implémenteur : GPT. Revue : orchestrateur, lot par lot, avant push.

Règles : `CLAUDE.md`.
- Texte en français.
- `pnpm check` vert avant chaque commit.
- Gate inchangée ; aucun identifiant de modèle.
- Tout nouveau code `Reason` va dans `REASON_CODES` et dans les catalogues fr/en.
- Tout nouveau `kind` d'événement demande un validateur, une entrée `KIND_CLASS` et le switch de `cli/format.ts`.
- Un commit par lot.

Les lots marqués **[revue sécurité]** touchent aux secrets, chemins, processus ou à la gate. Ils ne sont poussés qu'après la revue de l'orchestrateur.

## Contexte

Le run VINCI n°1 a duré de 11:36 à 14:26 : 123 appels, 38 relances automatiques, aucun test authentifié. Il a révélé :

1. **Relances à vide.** Quand la seule piste restante demandait une action humaine (comptes de test), la continuation automatique a relancé 20 fois de suite : environ 40 messages « En attente des identifiants », 20 relances consommées pour rien.
2. **Comptes de test inutilisables.** L'utilisateur a collé `email:mot de passe` dans le chat. Après changement de modèle, l'agent a refusé de s'en servir (« pas de navigateur »), alors qu'il avait écrit lui-même `scripts/auth_login_probe.sh` une heure plus tôt.
3. **Fuite de secret.** Le mot de passe apparaît en clair dans le fil exporté : le recorder ne masque pas un couple `identifiant:mot de passe` dans `user.message`.
4. **Outils web absents au départ.** La rédaction de fiche a été demandée dans une conversation sans outils web : `read_url` n'était « pas exposé », et l'agent a contourné avec `curl` dans Exegol.
5. **Preuves refusées.** `record_test` refuse comme source un fichier produit dans le run (`scans/recon/fetch.log` : « n'est pas un événement search_web ou read_url »).
6. **Couverture superficielle.** 24 cases en 9 minutes, `negative` après une seule sonde.

Retours d'interface de l'utilisateur, avec les faits trouvés dans le code :

7. Terminal conteneur cassé sous Windows : `syntax error near unexpected token ')'` / `` `esac) -i' ``. Le script vient de `packages/vscode/src/logic/terminal-prompt.ts:31-43` : un rc multiligne avec `case … esac` et des guillemets, passé par l'argv du terminal VS Code (`extension.ts:845,894-897`, `termlog.ts:76-84`, `cockpit.ts:213`). Les styles de bannière de la page Apparence (`studio.js:541-562`) passent par le même chemin.
8. Liaison conteneur incompréhensible : « chemin hors de l'espace de travail ». Le dossier du projet n'est pas sous le montage `/workspace` du conteneur (`core/src/project-workspace.ts:65-110`). Le dossier est choisi librement à la création (`extension.ts:3682-3690`).
9. Réglages : il faut plusieurs clics. Chaque message `view` reconstruit toute la page (`studio.js:1893`, vidage vers 1930), sans verrou ni état optimiste (`studio.js:664-665`). Seules les cartes de prompt ont un verrou (`promptPending`, `studio.js:597`).
10. Fenêtres lentes à charger depuis le découpage CSS (11ad20e). Le volume CSS par page a pourtant baissé (chat 140 Ko, contre 196 Ko avant) et il n'y a pas d'`@import`. Cause non établie : il faut mesurer avant de corriger.
11. Pas de Stop quand la zone de saisie est vide pendant un run : il faut passer par l'arrêt d'urgence du projet (`chat.js:1780-1784,2165,2265` ; `chat.css:522`).
12. Le chat manque dans les accès rapides (actions de la barre de titre de l'éditeur, `extension.manifest.json`, `menus.editor/title`).
13. Kill chain :
    - la légende dépliée s'étire sur toute la hauteur (`css/killchain.css:45-56,424-440`, `align-self: stretch` par défaut dans la grille) ;
    - le clic sur un nœud affiche un libellé et « Supprimer » dans la barre du haut (`studio.js:1018-1033,1060-1080,1120-1125`).
14. Filtres hors du style de l'application : `<select>` natifs dans Audit (`studio.js:1623-1640`) et dans le Monitor (`html.ts:663`).
15. Menu « + » du chat trop grand (`chat.css:2898-2900`, `.pop` `max-height: 70vh`).
16. Matrice de couverture illisible : tableau sans `colgroup` avec `overflow-wrap: anywhere` (`css/base.css:794-813`, `studio.js:1652-1668`), et aucun code couleur des états (`studio.js:310-317,1632`).
17. Fiche programme : il manque un vrai « Remplir par IA ». Le bouton actuel envoie la consigne dans le chat actif, avec ses outils du moment (`program.js:90-91`, `extension.ts:2127-2137`).
18. Réglages : il manque un tri par usage (bug bounty, red team…). Groupes actuels : `studio.js:10-32`.
19. Bypass : l'utilisateur le veut illimité. Durée fixe de 2 h (`vscode/src/logic/bypass.ts:155-156`), plafond de 4 h dans le cœur (`core/src/approval/bypass.ts:9-12`). La jauge du chat croit le maximum à 2 h (`chat.js:963`).
20. « Quota gratuit OpenCode Zen épuisé » sur la 0.3.77 avec une nouvelle clé, alors que la même clé marche sur la 0.3.76.
    - La détection repose sur le message OpenCode `Free usage exceeded` (`agent-opencode/src/runner.ts:911-923`), inchangée entre les deux versions.
    - Le moteur n'isole que `XDG_CONFIG_HOME` (`runner.ts:296-298`), pas `XDG_DATA_HOME`, où se trouve `auth.json`.
    - S'y ajoute « Le moteur de chargement des modèles s'est arrêté (code 1) » (`controller.ts:236-241`, `model-load-error.ts:25-29`), sans détail affiché.

## Lots

### Lot 1 — Continuation : s'arrêter quand seul l'humain peut débloquer

Fichiers : `packages/core/src/mission-desk.ts` (`continuationPrompt`), `packages/agent-opencode/src/runner.ts` (boucle de continuation, vers les lignes 1210-1335).

- Une piste compte comme ouverte seulement si l'agent peut l'avancer : états `untested` et `blocked` dont la note ne signale pas un blocage externe. Les états `prerequisite`, et `blocked` avec un motif externe (domaine mort, compte requis), **ne relancent pas**.
- Si toutes les pistes restantes dépendent d'un humain :
  - pas de continuation ;
  - nouvel événement `continuation.waitingHuman { openLeads, reasons }` ;
  - notification VS Code « RedWidow attend une action de votre part : … » avec un bouton qui ouvre le chat.
- Deux réponses consécutives de l'agent sans aucun appel d'outil arrêtent aussi la continuation.
- Critères :
  - test : couverture composée seulement de `prerequisite` → aucune continuation, événement émis ;
  - test : deux tours sans outil → arrêt ;
  - le compteur `continuation.auto` n'augmente plus dans ces cas.

### Lot 2 — Comptes de test (ADR 0043) [revue sécurité]

Décision de l'orchestrateur, à écrire dans `docs/adr/0043-comptes-de-test.md` (contexte, décision, conséquences) :

- **Page « Comptes de test »** dans le groupe Projet (à côté de Fiche programme). L'utilisateur y saisit : site (hôte du périmètre de la fiche validée), identifiant, mot de passe ou cookie de session, libellé (`A`, `B`…). Stockage : `SecretStorage` de VS Code, jamais dans le projet ni dans le journal.
- **Le modèle ne voit jamais la valeur.** `mission_context` liste seulement « compte A sur boost.vinci.com (identifiant, mot de passe) ». Le modèle utilise des jetons : `{{compte:A:identifiant}}`, `{{compte:A:secret}}`.
- **Substitution au moment de l'exécution**, uniquement dans :
  - `http_request` (en-têtes, corps, URL), et seulement si l'hôte de la requête est celui du compte ;
  - `exec` et `task_start` sous forme de variables d'environnement `RW_COMPTE_A_IDENTIFIANT` / `RW_COMPTE_A_SECRET`, si la commande vise l'hôte du compte (analyse des hôtes existante, `core/src/program/shell-hosts.ts`).
  - Ailleurs, la requête est refusée avec un nouveau code `account.hostMismatch`, non mémorisable. Cela empêche d'envoyer un mot de passe vers un autre hôte.
- **Masquage.** Les valeurs de tous les comptes sont ajoutées au masquage du recorder avant tout sink. Toute réponse d'outil qui les contient arrive masquée au modèle et au journal.
- **Session.** `http_request` reçoit une option `session: "A"` qui conserve les cookies de ce compte (jarre en mémoire, par compte et par hôte). L'agent peut ainsi enchaîner connexion puis navigation authentifiée sans navigateur.
- Profil `bug-bounty` et `methodology.ts` : « les comptes de test fournis sont autorisés par la fiche ; utilise-les via les jetons ; ne demande jamais un mot de passe en clair ».
- Critères :
  - jeton substitué vers l'hôte du compte ;
  - refus vers un autre hôte ;
  - valeur absente du journal et des exports ;
  - jarre de cookies conservée entre deux appels ;
  - test d'exhaustivité des codes à jour.

### Lot 3 — Masquage des identifiants collés dans le chat [revue sécurité]

Fichiers : `packages/core` (règles de masquage du recorder), vue chat.

- Masquer dans `user.message` (et dans tout texte) les motifs :
  - `identifiant:mot_de_passe`, quand l'identifiant ressemble à une adresse e-mail ;
  - `password=…`, `pass=…`, `mdp …` ;
  - les en-têtes `Cookie:`.
- Côté chat : si un message envoyé contient un tel motif, afficher un avertissement non bloquant : « Identifiant détecté : il a été masqué dans les journaux. Utilisez la page Comptes de test pour que l'agent puisse s'en servir. »
- Critères : tests de masquage (e-mail:mdp, `password=`, `Cookie:`) ; l'export du fil n'en contient plus aucun.

### Lot 4 — Preuves issues des fichiers du run

Fichier : `packages/core/src/mission-desk.ts` (`assertEvidence`, vers les lignes 640-725).

- Accepter comme source d'une preuve :
  - un `toolUseId` de `exec`, `task_status`, `http_request` ou `read_output` de ce run ;
  - un fichier écrit pendant le run sous `outputs/`, `scans/` ou `evidence/`, avec son chemin relatif et son empreinte SHA-256 enregistrés.
- Ne pas accepter un fichier antérieur au run ni hors de ces dossiers. Message d'erreur : « source inconnue : citez l'appel d'outil ou un fichier produit dans ce run ».
- Critères : tests — sortie d'un `exec` acceptée, fichier `scans/` du run accepté, fichier hors dossier refusé.

### Lot 5 — Profondeur avant « négatif »

Fichiers : `methodology.ts`, profil `bug-bounty` de `agent-profiles.ts`, `record_coverage` dans `mission-desk.ts`.

- `negative` exige au moins deux variantes testées, ou une justification explicite dans la note. Sinon `record_coverage` répond par un avertissement (pas un refus) : « une seule sonde : précise les variantes essayées ou garde `untested` ».
- Dans `trace` : compter les cases passées en `negative` après une seule sonde.
- Critères : tests de l'avertissement et de la mesure.

### Lot 6 — Outils visibles et stables après changement de modèle

Fichiers : moteur (`engine/main.ts`), `mission-desk.ts`, en-tête du chat.

- `mission_context` commence par la liste réelle des familles d'outils exposées : « Outils disponibles : web (read_url, http_request, recherche), shell Exegol (exec, task_start), fichiers du projet… ».
- L'en-tête du chat affiche ces familles en pastilles.
- Vérifier, par un test sur la construction des toolsets, qu'un changement de fournisseur ou de modèle en cours de conversation conserve les mêmes familles d'outils.
- Critères : test de la ligne `mission_context` ; test de conservation des toolsets au changement de modèle.

### Lot 7 — Terminal conteneur sous Windows [revue sécurité]

Fichiers : `packages/vscode/src/logic/terminal-prompt.ts`, `termlog.ts`.

- Ne plus passer de texte multiligne ni de guillemets dans l'argv. Encoder le rc en base64 (alphabet sans guillemets ni espaces) : `["/bin/bash", "-c", "exec /bin/bash --rcfile <(printf %s <b64> | base64 -d) -i"]`.
- Même principe pour `capturedShell`.
- Tester les quatre styles de bannière (redwidow, compact, minimal, native).
- Critères :
  - test : aucune chaîne de l'argv ne contient de retour à la ligne ni de `"` ;
  - le script décodé passe `bash -n` ;
  - recette manuelle sous Windows par l'utilisateur.

### Lot 8 — Projet et conteneur sans piège de dossier [revue sécurité]

Fichiers : `extension.ts` (création de projet vers 3682-3690, `case "link"` vers 1425-1446, suppression vers 1656-1660), `core/src/project-workspace.ts`, `media/cockpit.js`, `media/studio.js`.

- **Création de projet** : plus de choix de dossier. Le dossier est créé automatiquement sous `~/.exegol/workspaces/<slug-du-projet>` (le chemin racine reste réglable dans Système pour les cas avancés).
- **« Nouveau conteneur »** monte ce dossier (`--workspace`, déjà fait à `extension.ts:1549`), puis lie automatiquement le conteneur au projet.
- **Liaison d'un conteneur existant** dont le montage ne contient pas le projet : remplacer « chemin hors de l'espace de travail » par une fenêtre claire. Texte : « Le conteneur htb1 partage le dossier C:\…\htb1, qui ne contient pas le projet vinci-bb-1 (C:\…\vinci-bb-1). L'agent et le conteneur ne verraient pas les mêmes fichiers. » Boutons : « Créer un conteneur pour ce projet » (recommandé) et « Choisir un autre conteneur ». Nouveau code `project.workspaceNotMounted { container, mounted, project }`.
- **Suppression du conteneur** : compléter le message existant par « Le projet reste sur votre PC dans <chemin> ; seuls les fichiers créés hors de /workspace dans le conteneur sont perdus. »
- Les projets existants hors de ce chemin restent utilisables, rien n'est déplacé automatiquement.
- Critères : tests de la création sans dialogue ; nouveau code et message ; montage vérifié par le marqueur existant (inchangé).

### Lot 9 — Réglages : un clic suffit

Fichier : `packages/vscode/media/studio.js` (`render`, vers 1893-1930 ; interrupteurs vers 664-665).

- Ne plus vider et reconstruire `main` à chaque `view`. Mettre à jour la section concernée (clé par section), ou conserver le nœud et ne remplacer que son contenu si l'état a changé.
- Interrupteurs et boutons :
  - état optimiste immédiat ;
  - verrou `pending` par contrôle (même modèle que `promptPending`) ;
  - retour à l'état précédent si l'hôte répond par une erreur.
- Critères : test DOM — un clic pendant l'arrivée d'une `view` reste appliqué ; un seul `postMessage` par clic.

### Lot 10 — Temps de chargement des fenêtres (mesure puis correctif)

- Ajouter des marques de temps : création du panneau, `DOMContentLoaded`, première `view` reçue, premier rendu. Les écrire dans Sortie → RedWidow (niveau debug).
- L'utilisateur relève les temps sur sa machine ; correction de la cause mesurée (attente de l'hôte, rendu complet, taille de `i18n.js`, CSS). Ne rien optimiser à l'aveugle.
- Critères : marques visibles dans Sortie ; après le correctif, temps relevé avant et après dans le commit.

### Lot 11 — Stop dans la zone de saisie

Fichiers : `media/chat.js` (vers 1780-1784, 2165, 2265), `css/chat.css` (522).

- Pendant un run :
  - zone de saisie vide : le bouton principal devient « Stop » (même action que `stop`) ;
  - texte présent : « Envoyer » (message en cours de session) ;
  - Échap, sans texte, arrête aussi le run.
- L'arrêt d'urgence du projet reste réservé à son usage (engagement).
- Critères : test — run actif + saisie vide → le clic poste `stop`.

### Lot 12 — Accès rapides

- Ajouter « Chat » aux actions de la barre de titre (`menus.editor/title` du manifeste) avec l'icône RedWidow, à côté de Réglages, Monitor, Terminal et Kill chain.
- Critères : test `manifest-commands`.

### Lot 13 — Kill chain : légende et fiche de nœud

Fichiers : `media/studio.js` (1018-1125, 1235-1242, 1307-1407), `css/killchain.css` (45-142, 424-440, 578-641).

- **Légende dépliée** : `align-self: start; max-height: 100%; overflow: auto`. Elle prend la hauteur de son contenu, pas celle de la fenêtre.
- **Clic sur un nœud** : petite fenêtre flottante ancrée au nœud (classe `.pop` existante) avec tout le contenu :
  - libellé complet, type, état, tactique et technique ATT&CK, preuves, liens entrants et sortants ;
  - boutons « Changer l'état » et « Supprimer » (avec confirmation).
- Retirer la sélection et « Supprimer » de la barre du haut. Fermeture par Échap ou par un clic à l'extérieur.
- Critères : tests DOM de l'ouverture, de la fermeture et de la suppression ; captures avant et après.

### Lot 14 — Filtres au style de l'application

- Sortir `.seg` de `css/sessions.css:5-22` vers `css/base.css` comme composant commun (boutons `ghost` avec `aria-pressed`).
- Remplacer les `<select>` natifs du filtre de couverture d'Audit (`studio.js:1623-1640`) et de la famille du Monitor (`html.ts:663`, `viewer.js:24,106,150`) par ce composant.
- Critères : aucun `<select>` restant dans ces deux vues ; navigation au clavier (flèches, Tab) conservée.

### Lot 15 — Menu « + » compact

- `#composer-menu` : `width: min(320px, …)`, `max-height: 50vh`, défilement interne, sections repliables (Skills / méthodes, Fichiers…), la dernière section ouverte étant mémorisée.
- Critères : capture ; défilement visible avec la liste complète des profils.

### Lot 16 — Matrice de couverture lisible et colorée

Fichiers : `studio.js` (`coverageSection`, 1604-1670 ; états 310-317), `css/base.css` (794-813), `css/studio.css` (959-967).

- Ajouter un `colgroup` : Surface 22 %, Paramètre 18 %, Classe 14 %, État 10 %, Note 36 %. Utiliser `overflow-wrap: break-word` (pas `anywhere`) et une coupure aux espaces : plus de mots coupés lettre par lettre.
- Pastilles d'état colorées, à partir des couleurs déjà utilisées par la kill chain (`killchain.css:320`) :
  - **Confirmé** : rouge vif, gras (« faille trouvée ») ;
  - **Prérequis manquant** : ambre ;
  - **Bloqué** : orange atténué ;
  - **Négatif** : vert atténué ;
  - **Non testé** : neutre.
- Résumé « Non testé / Négatif / Bloqué / Prérequis / Confirmé » sous forme de compteurs colorés. Si Confirmé > 0, un bandeau en tête : « 1 faille confirmée ».
- Contraste vérifié par le test `contrast` existant.
- Critères : tests de rendu des classes d'état et du bandeau ; capture.

### Lot 17 — Fiche programme : « Remplir par IA »

Fichiers : `media/program.js`, `extension.ts` (2127-2137), `program-controls.ts` (187-190).

- Sur la page Fiche programme : un champ « Adresse de la page du programme » et un bouton « Remplir par IA ».
- Le bouton ouvre une **nouvelle conversation** avec :
  - le profil `bug-bounty` ;
  - les outils web activés (`read_url`, `http_request`, recherche) ;
  - la consigne `programDraftPrompt` contenant l'URL.
- Ensuite l'utilisateur relit le brouillon et le valide comme aujourd'hui (empreinte inchangée).
- Critères : test — la conversation créée porte le toolset web et le profil ; l'URL figure dans la consigne.

### Lot 18 — Réglages par usage

Fichier : `media/studio.js` (groupes 10-32), `packages/messages`.

- En tête des Réglages, un sélecteur « Usage » : Bug bounty, Red team, HTB / CTF, Apprentissage, Tout.
- Chaque usage affiche seulement les pages et options utiles, et propose ses préréglages.

  | Usage | Pages | Préréglages |
  |---|---|---|
  | Bug bounty | Fiche programme, Comptes de test, Audit, Kill chain | Profil `bug-bounty`, encadrement Acharné, rythme Prudent, outils web activés |
  | Red team | Engagement, arrêt d'urgence, plan de campagne, Audit | Encadrement Strict |
  | HTB / CTF | Conteneurs, Kill chain, Cours | Encadrement Acharné |
  | Apprentissage | Cours | — |
  | Tout | Affichage actuel | — |

- Le choix est mémorisé par projet. Aucun réglage de sécurité n'est modifié sans action explicite : les préréglages sont proposés, pas appliqués d'office.
- Critères : test de filtrage des pages par usage ; « Tout » égal à l'affichage actuel.

### Lot 19 — Bypass renouvelable (amendement de l'ADR 0017) [revue sécurité]

- **Pas de Bypass illimité.** L'invariant de `CLAUDE.md` et l'ADR 0017 (Bypass) fixent 2 h par défaut et 4 h au plafond par activation.
- À la place :
  - choix de la durée à l'activation (1 h, 2 h, 4 h) ;
  - notification 10 minutes avant l'échéance avec un bouton « Prolonger », qui réactive pour la même durée par un geste humain ;
  - le Bypass reste éteint à l'arrêt du moteur.
- Le nombre de renouvellements n'est pas limité, mais chaque renouvellement est un geste humain journalisé.
- Corriger la jauge (`chat.js:963`) pour qu'elle utilise la durée réelle.
- Ajouter l'amendement à l'ADR 0017.
- Critères : tests — plafond de 4 h respecté par activation ; renouvellement journalisé ; extinction à l'arrêt.

### Lot 20 — Diagnostic du fournisseur et du moteur

- **Carte d'erreur du fournisseur** : afficher le fournisseur et le modèle utilisés, la source des identifiants (fichier `auth.json` lu, sans son contenu) et le message brut d'OpenCode.
- **Bouton « Tester la connexion »** dans Réglages → Fournisseurs.
- **Comportement de `XDG_DATA_HOME`** : le documenter et le tester. Une clé ajoutée par `opencode auth login` hors de RedWidow doit être vue, ou bien l'interface doit dire où RedWidow la cherche.
- **Arrêt du moteur (« code 1 »)** : afficher dans la carte d'erreur les 20 dernières lignes de stderr du processus (`controller.ts:236-241`), avec les secrets masqués.
- Critères : tests de la carte d'erreur et du masquage de stderr ; recette par l'utilisateur sur la machine en 0.3.77.

### Lot 21 — Reliquats de la revue de la 0.3.77

- Mesure « dérivé / générique » : exclure `/` et le balayage des racines ; comparer aussi par nom de fichier (exemple : `console.js` trouvé dans la page doit compter comme dérivé).
- `read_url` : revenir à un plafond de 1 Mio. Le plafond de 32 Mio ne sert qu'à `http_request`.
- `body.split.txt` : remettre la colonne à zéro sur les retours à la ligne déjà présents.
- Guides : remplacer « Réglages → Contrôle système » par « Système » (`EXTENSION_README.md`, `docs/profils-agent.md`).

### Lot 22 — claude-kit de YesWeHack (facultatif)

`yeswehack/claude-kit` est un plugin Claude Code de rédaction et de triage de rapports. Il contient :
- `/ywh:write` (mise en forme d'un rapport) ;
- `/ywh:triage` (verdict READY / NEEDS FIXES / DO NOT SUBMIT, recalcul CVSS, contrôle du périmètre) ;
- `/ywh:gotchas` (preuves minimales et pièges par classe de faille).

Sa licence est GPL-3.0 : **ne rien copier dans le dépôt** (MIT).

À faire :
- Une page de documentation qui recommande de l'installer dans Claude Code pour rédiger et relire les rapports avant soumission.
- Une étape « Relecture avant soumission » au moment de `record_test` avec la conclusion `confirmed`, rédigée par nous. Liste de contrôle :
  - dans le périmètre de la fiche ;
  - preuve minimale reproductible ;
  - impact réel, non théorique ;
  - CVSS justifié ;
  - aucune donnée de tiers.

## Ordre

1. Lots 1, 2, 3, 4 et 7 : comportement de l'agent et secrets. Ce sont eux qui bloquent le prochain benchmark.
2. Lots 8, 9, 11, 17, 20 : ce qui bloque l'utilisateur.
3. Lots 5, 6, 10, 12-16, 18, 19, 21 : finition de l'interface.
4. Lot 22 (facultatif).

Lots qui touchent les mêmes fichiers, à faire dans l'ordre et un à la fois :
- `studio.js` : 9, 13, 14, 16, 18 ;
- `chat.js` : 11, 15, 19 ;
- `mission-desk.ts` : 1, 4, 5, 6.

## Interdits

- Ne pas affaiblir la gate ni les invariants de `CLAUDE.md` : pas de Bypass illimité ; un mot de passe de compte ne sort jamais vers un hôte autre que le sien et n'apparaît jamais dans le journal.
- Pas de contenu copié depuis claude-kit (GPL).
- Pas de données de cible réelle dans les fixtures ni la documentation.
- Pas de binaire dans le dépôt ; aucun identifiant de modèle ; pas de changement de branche ; pas de PR.

## Vérification

- `pnpm check` vert après chaque lot.
- Captures avant et après pour les lots d'interface (`packages/vscode/scripts/ui-snapshots.mjs`).
- Recette par l'utilisateur sous Windows :
  - terminal (lot 7) ;
  - création de projet et liaison (lot 8) ;
  - Réglages en un clic (lot 9) ;
  - Stop (lot 11) ;
  - Remplir par IA (lot 17) ;
  - comptes de test (lot 2).
- Re-mesure : run VINCI n°2, avec deux comptes de test saisis dans la page Comptes de test. Attendus :
  - aucune relance à vide ;
  - tests authentifiés effectués ;
  - aucun secret dans le ZIP d'audit.
