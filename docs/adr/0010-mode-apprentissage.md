# 0010 — Mode apprentissage par chat

- Statut : accepté
- Date : 2026-10-17

## Contexte

Un mode « apprentissage » transforme l'agent en assistant pédagogique : il lit un dossier de cours en lecture seule, explique, cite ses sources, et **n'agit jamais** (ni `exec`, ni `note`, ni shell, ni écriture). Le projet est destiné à l'open source : seules des sources de documentation libres sont visées.

Faits établis :

- Le moteur construit le runner après `start` (`packages/vscode/src/engine/engine.ts:183`, sondage `models` : `:222`). `createRunner` vient de `packages/vscode/src/engine/main.ts:36` et passe aujourd'hui `toolsets: [exegolToolset(...)]` (`main.ts:45`). Il ne reçoit aucun paramètre : il ne sait pas quel mode a été demandé.
- `StartParams` (`packages/vscode/src/logic/protocol.ts:33-44`) est validé par liste blanche de clés (`START_KEYS`, `protocol.ts:119-131`). Il porte déjà `systemPrompt` fourni par l'UI, transmis tel quel au runner (`engine.ts:194`), où il est ajouté au prompt système du binaire (`packages/agent-sdk/src/runner.ts:510-512`).
- La politique du run vient de `policyLoader(params.cwd)` (`engine.ts:156`) : politique utilisateur, ou politique du dépôt approuvée par empreinte, sinon `DEFAULT_POLICY` (`default: "ask"`, `packages/core/src/approval/policy.ts:53-78`). La gate est créée à `engine.ts:161-169`.
- La gate est l'unique autorité (hook `PreToolUse`, `runner.ts:387-410`) ; `canUseTool` est un filet fail-closed (`runner.ts:413`). `permissionMode` est verrouillé à `"default"` (`runner.ts:486`).
- Dans `evaluatePolicy`, toute branche qui n'est pas une règle explicite se plafonne par `stricter("ask", policy.default)` (`policy.ts:157`, `:229`, `:309`, `:364`, `:372`, `:381`) ou retombe sur `policy.default` (`:389-394`). Avec `default: "deny"`, aucune branche ne peut produire `ask`.
- Le Bypass n'agit que sur un verdict `ask` (`gate.ts:286`) et ne lève jamais un `deny` (ADR 0006, Décision 1). Sans `ask` (Asker absent), un verdict `ask` est refusé avant tout Bypass (`gate.ts:272-277`).
- La précédence d'une politique est `deny` > `ask` > `allow`, indépendamment de l'ordre (`policy.ts:37`, `:99-111`) : une règle `deny *` écraserait tous les `allow`. Le joker n'existe que si le motif contient `*` ; sinon la comparaison est exacte et sensible à la casse (`policy.ts:89-91`).
- Le dossier de configuration (`defaultConfigDir()`, `packages/core/src/approval/source.ts:26-34`) contient aussi la politique utilisateur, le magasin de confiance des empreintes et les trouvailles : le dossier de cours en est un sous-dossier, donc voisin de fichiers sensibles.
- Le serveur MCP `exegol` (`packages/core/src/exegol/tool-specs.ts`, `packages/agent-sdk/src/exegol-tools.ts`) est le modèle d'un toolset : spécifications dans `core`, enveloppe MCP dans `agent-sdk`, consigne en prose dans `core` (`EXEGOL_SERVER_INSTRUCTIONS`).

## Décision

1. **Protocole.** `StartParams.mode?: "learning"`. Valeur absente : comportement actuel, strictement inchangé. Toute autre valeur (autre chaîne, casse différente, `null`, nombre, objet) est rejetée (`ipc.invalidMessage`, champ `mode`). `mode` s'ajoute à `START_KEYS`. Si `mode` est présent, `systemPrompt` est rejeté : en mode apprentissage, la consigne système ne vient jamais de l'UI. Le mode est fixé par le `start` (un seul `start` par moteur, `engine.ts:248`) ; il ne change pas en cours de session.

2. **Assemblage côté moteur.** `createRunner` reçoit le mode (`createRunner(mode?)`), y compris pour le sondage `models`. En mode apprentissage, `main.ts` construit `createSdkRunner({ executable, toolsets: [coursToolset()], builtinTools: [] })` : aucun toolset Exegol, aucun outil natif, pas d'option `bash`. La vérification d'empreinte du binaire reste identique. `engine.ts` pose `systemPrompt = LEARNING_SYSTEM_PROMPT` (constante exportée par `core`, comme `EXEGOL_SERVER_INSTRUCTIONS`) à la place de `params.systemPrompt`. Aucune option verrouillée du runner n'est touchée, `permissionMode` reste `"default"`.

3. **Invariant central.** En mode apprentissage, la gate refuse tout appel d'outil autre que `mcp__cours__chercher` et `mcp__cours__lire`, de façon non mémorisable, et ce refus tient pendant un Bypass.
   - **Mécanisme retenu : une `Policy` dédiée, pas une garde dans la gate.** `LEARNING_POLICY` (constante figée, `core`) :
     ```ts
     { default: "deny", rules: [
       { tool: "mcp__cours__chercher", decision: "allow" },
       { tool: "mcp__cours__lire", decision: "allow" },
     ] }
     ```
     Noms **exacts**, sans joker : un futur troisième outil `cours` ne doit pas être autorisé en silence. La casse est sensible, donc `MCP__COURS__LIRE` est refusé.
   - **Branchement : `engine.ts`, à la création de la gate (`:156-169`).** Si `params.mode === "learning"`, le moteur n'appelle pas `policyLoader` (ni politique utilisateur, ni politique du dépôt, aucune approbation d'empreinte, `policySource: null`, pas d'avertissement) et passe `LEARNING_POLICY` à `createApprovalGate`. Il ne fournit pas `ask` à la gate : un `ask` imprévu devient `approval.noAsker` (refus, avant le Bypass). `workspace` reste `{ cwd: params.cwd, posixShell: true }`. L'interrupteur `bypass` n'est pas modifié (ADR 0006 intact) ; il est inopérant ici.
   - **Pourquoi fail-closed.** Avec `default: "deny"`, le verdict ne peut valoir que `allow` pour les deux noms exacts, sinon `deny` : Bash, PowerShell, outils natifs, `mcp__exegol__*`, `mcp__docker__*` (pourtant `allow` dans `DEFAULT_POLICY`), `external_directory`, chemins sensibles ou hors espace (rétrogradés en `deny` par `stricter("ask", "deny")`). Un `deny` n'est ni mémorisable (`sessionKey` exige `ask`, `gate.ts:111`) ni bypassable. Un appel `cours` portant `EXTERNAL_PATTERNS_FIELD` est lui aussi refusé (`capExternal`, `policy.ts:326-331`).
   - **Pourquoi une politique et non une garde dédiée.** La gate reste l'unique autorité et son code n'est pas modifié (pas de nouveau chemin de décision à auditer, pas de régression possible sur l'ADR 0006). Une garde dupliquerait ce que `default: "deny"` exprime déjà. Une politique dédiée est aussi indépendante de tout fichier de configuration : un `policy.json` utilisateur, une politique de dépôt ou une règle « toujours autoriser » d'une session précédente ne peuvent pas rouvrir un outil.
   - **Codes de raison.** Aucun nouveau code : les refus rendent `policy.default` (« aucune règle pour l'outil X »). Le libellé est un peu terne pour l'usager ; un `policy.learning` plus parlant est une amélioration optionnelle, hors de cette décision (si on le veut : `REASON_CODES`, catalogues fr complet et en, test d'exhaustivité).

4. **Outils `cours`, lecture seule.** Serveur MCP `cours`, deux outils, racine `<defaultConfigDir()>/cours/`. La racine n'est jamais un paramètre d'outil ni d'entrée de l'UI.
   - `chercher { requete }` : recherche littérale (sous-chaîne, insensible à la casse, **pas d'expression régulière fournie par le modèle**) dans les fichiers texte du dossier. Lignes `chemin:numéro: extrait`, plafonds en nombre de résultats, de fichiers visités, de profondeur et d'octets lus au total. Le parcours ne suit aucun lien symbolique.
   - `lire { chemin, debut? }` : contenu d'un fichier texte à partir d'une ligne, sortie plafonnée par `capOutput` (64 Kio par défaut, marqueur de troncature). Lecture bornée à l'octet près sur le descripteur ouvert (pas de lecture complète d'un gros fichier suivie d'une coupe).
   - **Confinement du chemin** (fonction pure unique, utilisée par les deux outils) : refus d'une chaîne vide ou contenant NUL ; refus d'un chemin absolu sous toute forme (`/x`, `\x`, `C:\x`, `\\srv\x`) ; `\` traité comme séparateur puis refus de tout segment `..` ; refus de tout segment contenant `:` (lecteur Windows, flux de données alternatif) ; ensuite `realpath` de la racine et du chemin demandé, et contrôle d'appartenance par préfixe **avec séparateur** (insensible à la casse sous win32) : un lien dont la cible sort de la racine est refusé. Seuls les fichiers réguliers sont lus (vérification sur le descripteur ouvert : pas de FIFO, de périphérique, de dossier). La racine elle-même peut être un lien choisi par l'utilisateur (on confine sur sa cible).
   - Le contenu des cours est une donnée non fiable : la consigne le dit au modèle, mais la sécurité n'en dépend pas (voir Conséquences).
   - Politique de base : les deux outils sont en `allow` (Décision 3).

5. **`permissionMode`** reste `"default"`, verrouillé. Le mode apprentissage ne touche ni cette option ni aucune autre option verrouillée du runner.

6. **Périmètre.** Moteur de l'extension (adaptateur Claude) seulement. La CLI et l'adaptateur OpenCode n'exposent pas le mode. L'interface (masquer l'interrupteur Bypass, ouvrir le dossier de cours, indication du mode) relève de la voie produit.

## Alternatives écartées

- **Garde dédiée dans la gate** (« en mode apprentissage, refuser hors `cours` ») : ajoute un second chemin de décision dans le composant le plus sensible, exige une option de gate supplémentaire et probablement un code de raison, sans rien exprimer que `default: "deny"` n'exprime déjà.
- **Seulement retirer les outils** (`builtinTools: []`, un seul toolset) : cela réduit la surface mais ne fait pas autorité. La liste d'outils annoncée par le SDK n'est pas la gate ; une politique `ask` par défaut redemanderait à l'humain des outils qui ne devraient pas exister.
- **Charger la politique habituelle et lui ajouter des règles `deny`** : une liste de refus est ouverte (tout nouvel outil MCP passe en `ask`), et une règle utilisateur `allow` ou « toujours autoriser » reste en vigueur.
- **Règle `allow` en `mcp__cours__*`** : un futur outil d'écriture ajouté au serveur `cours` serait autorisé sans décision.
- **Règle `deny *` + `allow` ciblés** : sans effet, `deny` l'emporte sur `allow` quel que soit l'ordre (`policy.ts:37`).
- **Outil natif `Read` confiné par racine** : `Read` lit tout fichier hors du dossier de cours après une demande, renvoie le fichier entier et ne fixe pas de plafond.
- **Autre `permissionMode`** (`plan`, `dontAsk`…) : option verrouillée, et ferait trancher le SDK à la place de la gate.
- **Prompt système reçu de l'UI** : une webview compromise redéfinirait le rôle de l'agent.

## Conséquences

Positives : aucun invariant touché ; `gate.ts`, `runner.ts` et `permissionMode` inchangés ; les deux adaptateurs de la gate restent le seul chemin ; test d'invariant simple et exhaustif (« tout sauf deux noms est refusé »).

Sécurité et risques :

- **Menace principale : injection par le contenu des cours** (un fichier de cours contient des instructions). Le pire effet est une réponse trompeuse : l'agent n'a ni écriture, ni shell, ni réseau, ni outil d'action, donc rien à exfiltrer ni à exécuter. La consigne système le rappelle (le texte des fichiers est une donnée) mais ne constitue pas le contrôle.
- **Voisinage de fichiers sensibles** : `cours/` est dans le dossier qui contient la politique, le magasin de confiance et les trouvailles. Le confinement (`realpath` + préfixe avec séparateur, refus de `..`, des absolus, de `:` et des liens sortants) est la seule barrière ; il doit être testé à fond.
- **Course `realpath` / ouverture** : un lien échangé entre le contrôle et l'ouverture. L'agent n'a aucun moyen d'écrire ; il faudrait un tiers avec droit d'écriture dans le dossier de configuration de l'utilisateur, qui contrôle déjà la politique. Accepté ; on revérifie la cible après ouverture pour réduire la fenêtre.
- **Déni de ressources** : gros fichiers, FIFO, arborescences profondes, expressions régulières. Réponses : lecture bornée sur le descripteur, fichiers réguliers seulement, plafonds de parcours, recherche littérale.
- **Divergence moteur / `main.ts`** : le moteur choisit la politique, `main.ts` les outils, tous deux depuis `params.mode`. Si `main.ts` oubliait le mode, la gate refuserait `exec` quand même. Si le moteur oubliait la politique, aucun outil d'action n'existerait (runner restreint) et les outils `cours` seraient en `ask`. Les deux couches doivent être testées ensemble de bout en bout.
- **Prompt système non pur** : la consigne s'ajoute au prompt du binaire (`append` d'un préréglage, `runner.ts:510-512`). Défaut d'ergonomie connu, pas de sécurité ; le changer toucherait une option verrouillée du runner et demanderait un autre ADR.
- **Bypass** : l'interrupteur de l'UI existe mais n'a aucun effet en mode apprentissage ; l'UI doit le masquer ou l'indiquer inopérant pour ne pas afficher un état trompeur (voie produit).
- **Politique ignorée** : en mode apprentissage, `policy.json` et la politique du dépôt ne sont ni lus ni évalués. C'est voulu.

## Addendum (2026-10-17) — Téléchargement des cours par l'extension

Choix utilisateur : téléchargement depuis l'extension, rien dans le dépôt. Sources : OWASP Cheat Sheets et WSTG (CC BY-SA), HackTricks (CC BY-NC).

1. **Action de l'extension, hors agent et hors gate.** Le téléchargement est une action de l'hôte déclenchée par l'usager. Le moteur, l'agent, `LEARNING_POLICY` et la gate ne changent pas ; aucun outil de téléchargement n'existe pour le modèle. La webview envoie un message sans champ (`cours.sync`, `cours.cancel`) ; aucun chemin, URL, ref ni nom de source ne vient d'elle.
2. **Déclencheur : automatique, après un consentement unique mémorisé (choix utilisateur).** À la première activation du mode apprentissage, l'usager voit une fois les sources et leurs licences (dont la mention CC BY-NC de HackTricks) et donne son accord ; cet accord est mémorisé (clé de portée machine, hors `warband.prefs`). Ensuite, à chaque activation où `coursRoot()` est absent ou sans cours, le téléchargement part **sans nouveau clic**. Le consentement unique est requis car il y a réseau, écriture disque et une source non commerciale. La page Atlas garde un bouton « Télécharger / Mettre à jour les cours » (et permet de revoir / révoquer l'accord). Le téléchargement est non bloquant : le chat reste utilisable et, sans cours, `chercher`/`lire` répondent « aucun cours installé ».
3. **Où tourne le code : module TypeScript importé par l'hôte**, pas un sous-processus `node scripts/cours-sync.mjs`. Raisons : le script n'est pas dans le VSIX et le `node` de l'usager n'est pas garanti (l'extension tourne sous Electron) ; un module se teste (git simulé par injection d'un `exec`) et se bundle avec esbuild. Le manifeste (`cours/sources.json`, refs figées) est **embarqué au bundle** et jamais téléchargé : changer une source ou une ref = commit relu. La validation (`cours-validation`) est portée avec le module et testée. `scripts/cours-sync.mjs` reste utilisable pendant la migration puis est supprimé ou réduit à un lanceur du même module (pas de logique en double).
4. **Pré-requis et échecs.** `git` absent (ENOENT), réseau coupé, échec de clone, disque : chaque source rend un résultat typé `{ nom, etat: "ok" | "echec", raison }` avec codes `Reason` (ajouter à `REASON_CODES`, catalogues fr complet et en, test d'exhaustivité). Aucune exception ne sort de la fonction ; l'extension affiche un message clair (« git introuvable », « hors ligne ») et laisse le mode utilisable. Une source en échec n'empêche pas les autres.
5. **Progression, verrou, annulation.** Événement hôte → webview `cours.progress { source, indice, total, etape }` (étapes : clone, copie, terminé) ; pas de pourcentage fichier par fichier pour HackTricks. Verrou en mémoire dans l'hôte (un seul téléchargement) ; un second `cours.sync` pendant l'exécution est ignoré. Annulation prise en charge via `AbortSignal` passé à `execFile` (tue `git`), nettoyage du temporaire. Verrou inter-fenêtres : fichier verrou `coursRoot()/.sync.lock` créé en mode exclusif (`wx`), périmé après un délai ; accepté de ne pas aller plus loin.
6. **Sécurité.** Écriture confinée à `coursRoot()/<nom>/` : `nom` vient du manifeste embarqué, validé (segment simple, sans `..`, séparateur ni `:`), et le chemin final est revérifié par préfixe avec séparateur. Clone dans un temporaire du système, puis remplacement atomique du dossier de la source (`rename`) : un échec ne détruit pas une version précédente valide. Environnement de `git` en liste blanche (`safeEnv`-like), `GIT_TERMINAL_PROMPT=0`, `core.hooksPath` neutralisé, pas de sous-modules, pas de `--recurse`, `--depth 1` à la ref figée. Copie des seuls `.md`/`.txt` + licence, fichiers réguliers uniquement, liens symboliques non suivis ni copiés, plafonds de nombre et de taille. Rien du contenu téléchargé n'est exécuté ni interprété (pas de script, pas de `postinstall`). `SOURCE.md` indique origine, ref, licence ; HackTricks y porte la mention CC BY-NC (usage non commercial), reprise dans l'UI. Aucune sortie de `git` n'est journalisée sans passer par le recorder (masquage).
7. **Sources installées : les trois d'office (choix utilisateur).** OWASP Cheat Sheets, OWASP WSTG et HackTricks sont téléchargées ensemble. La mention CC BY-NC de HackTricks est affichée lors du consentement unique, écrite dans son `SOURCE.md` et documentée (`docs/cours.md`). Conséquence à garder en tête : tant que HackTricks est installée d'office, l'extension **ne peut pas** être distribuée commercialement avec les cours ; si cet usage devient souhaité, repasser HackTricks en option décochable.
8. **Risques.** Le dépôt amont est une donnée non fiable (déjà couvert : injection = réponse trompeuse seulement). Ref figée par SHA de commit préférée à une branche.

