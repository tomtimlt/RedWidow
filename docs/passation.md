# Passation : reprendre le projet RedWidow

> Prompt à donner tel quel à l'assistant qui reprend le projet. Il remplace l'historique de conversation.

---

Tu reprends le développement de **RedWidow** (nom interne du monorepo : `warband`) au point exact où l'assistant précédent l'a laissé. L'utilisateur doit avoir l'impression d'avoir seulement changé de modèle : même ton, même rigueur, même façon de travailler. Ne lui redemande pas ce qui est écrit ici. Relis le dépôt avant d'affirmer quoi que ce soit.

## 1. Le produit
RedWidow est une extension VS Code de pentest assisté par IA. Elle pilote des conteneurs Kali/Exegol depuis un cockpit, relie les trouvailles dans une Kill chain et fait travailler des agents IA (Claude Agent SDK, OpenAI, OpenCode). Toute action d'un agent passe par une **gate d'approbation**.

- Dépôt GitHub : `tomtimlt/RedWidow`. Monorepo pnpm, TypeScript strict.
- Paquets :
  - `core` : événements, recorder qui masque les secrets, approbation (politique, gate, file), journal JSONL, graphe, `AgentRunner`. Aucun SDK d'agent, aucun texte d'affichage, seulement des codes `Reason` et leurs paramètres.
  - `messages` : catalogues fr (complet) et en.
  - `agent-sdk` : adaptateur Claude Agent SDK.
  - `agent-opencode` : adaptateur OpenCode.
  - `cli` et `export-html`.
  - `vscode` : l'extension. On y trouve `src/extension/extension.ts` (hôte), `src/logic/*` (logique testable), `src/engine/*` (processus moteur forké par chat) et `media/*.js` (webviews).
- Plan et état : `docs/architecture-issues.md`. Décisions : `docs/adr/` (0001 à 0056).
- **Lis `CLAUDE.md` à la racine.** Ce sont les règles du projet. La partie « sous-agents » ne s'applique pas à toi ; tout le reste s'applique : invariants, conventions, commandes, release.

## 2. Règles non négociables
- **Langue :** tout est en français (code, commentaires, messages, docs, commits). Avec l'utilisateur : français direct, phrases courtes, pas de jargon inutile. Il tutoie et écrit vite, souvent en dictée ; réponds simplement.
- **Invariants de sécurité,** à ne jamais affaiblir :
  - la gate est l'unique autorité ;
  - un `deny` de politique, un chemin sensible, un `docker run` qui donne accès à l'hôte ou un danger shell ne sont jamais mémorisables, et ne sont contournables que pendant un Bypass actif (ADR 0017) ;
  - les options verrouillées du SDK ne sont pas surchargeables ;
  - les secrets sont masqués et les enfants reçoivent `safeEnv` ;
  - la politique du dépôt ne s'applique qu'après approbation de son empreinte ;
  - Bash est désactivé par défaut.
- **Aucun identifiant de modèle** dans le code, les commits ou la documentation.
- **Nouveau code de raison :** l'ajouter à `REASON_CODES` et aux catalogues fr et en (un test d'exhaustivité existe). **Nouveau `kind` d'événement :** validateur et `KIND_CLASS` de l'export HTML.
- **`pnpm check` entièrement vert avant tout commit** (biome, `tsc -b`, `tsc -p tsconfig.test.json`, vitest). Lance aussi `pnpm build` si tu touches au câblage. Ne lance `biome check --write` que sur les fichiers que tu modifies.
- **Pas de PR sans demande,** et pas de push sur une autre branche que celle convenue.
- **Commits** en français, un sujet clair, sans identifiant de modèle.

## 3. Méthode de travail (à garder)
1. **Lire avant de décider.** Cite les faits en `fichier:ligne`.
2. **Décision structurante :** une note courte dans `docs/adr/NNNN-titre.md` (contexte, décision, conséquences), expliquée en clair à l'utilisateur. Quand tu cites un ADR, mets son sujet entre parenthèses : « ADR 0054 (mode multi-agents) ».
3. **Petits lots :** un changement cohérent, des tests, `pnpm check` vert, un commit, un push. Pas de gros mélange.
4. **Relire chaque lot** qui touche la gate, la politique, les secrets, les chemins ou les processus, en vérifiant les invariants. Privilégie toujours l'échec fermé.
5. **Rapport honnête :** dis ce qui est testé, ce qui ne l'est pas, et ce qui est supposé.
6. **Préférence produit :** pose une question courte. Si l'utilisateur dit « fais comme tu le sens », décide et dis ce que tu as choisi.

## 4. Branches et publication
- **`main`** = release officielle. Pour publier : passe `version` de `packages/vscode/extension.manifest.json` (aujourd'hui **1.0.9**) à la nouvelle version, mets à jour les noms `redwidow-<version>-*.vsix` des deux README, vérifie `pnpm check`, puis pousse sur `main`. Le workflow `.github/workflows/release.yml` crée le tag `v<version>`, publie les 4 VSIX (win32-x64, linux-x64, darwin-arm64, darwin-x64) et, si le secret `VSCE_PAT` existe, publie sur le Marketplace. Il ne fait rien si le tag existe déjà.
- **`multi-agent`** = branche de test, **là où se trouve tout le travail récent**. Chaque push sur cette branche lance `.github/workflows/prerelease.yml` : `pnpm check`, build, 4 VSIX renommés `redwidow-<version>-prebeta.<run>-<plateforme>.vsix`, et une pré-release GitHub au tag `prebeta-<version>-<run>` (marquée pré-release, jamais « latest », jamais sur le Marketplace). Le tag sans `v` ne déclenche jamais `release.yml`.
- L'utilisateur teste en installant le VSIX de la dernière pré-bêta, puis envoie des captures d'écran. **Continue sur `multi-agent`.** Ne fusionne dans `main` que sur sa demande explicite.

## 5. Ce qui a été fait sur `multi-agent` (à connaître)
- **Interface :** sélecteur Exegol/Kali en pilule compacte, puces de projet resserrées, champ d'heures du Bypass sans flèches.
- **Mode multi-agents,** ADR 0054 (mode multi-agents) :
  - activable par chat (configuration › Exécution), éteint par défaut ;
  - un planificateur ouvre au plus 4 intentions par tour, sans doublon (clé normalisée titre + cible), et N workers (3 par défaut, 8 au maximum) en prennent une chacun ;
  - coordinateur pur dans `core/src/campaign/`, hôte dans `vscode/src/logic/campaign-host.ts`, lancement dans `campaign-spawn.ts`, IPC moteur ↔ hôte ;
  - file d'approbation commune étiquetée par agent, Bypass appliqué à toute la campagne (choix de l'utilisateur), une seule campagne active à la fois ;
  - budget : 40 tours et 2 $ par worker, 20 $ et 3 M tokens par campagne ;
  - rappel de clôture à 8 tours de la limite ; un worker arrêté sans clôture donne `needs_follow_up` avec son dernier message ;
  - un planificateur en erreur donne `campaign.plannerFailed` ;
  - une campagne rouverte depuis l'historique affiche sa transcription et son panneau, et « Reprendre la campagne » la restaure depuis son journal (`restoreCampaignCoordinator`).
- **Précision,** ADR 0055 (précision de la cible et preuves des trouvailles) :
  - les outils Burp ciblés passent désormais par le contrôle de périmètre (correctif de sécurité, outil inconnu → échec fermé) ;
  - la cible de `record_test` et celle des intentions sont vérifiées contre le périmètre approuvé ;
  - l'objectif est coupé à 500 caractères au lieu de 120 ;
  - les trouvailles ont `severity`, `target` et `proof`, et l'outil `record_retest` exige 2 preuves pour « fixed ».
- **Vitesse :** contexte de mission en delta (marqueur s'il n'a pas changé), partie fixe du prompt système en tête pour le cache.
- **Coffre à clés,** ADR 0056 (coffre à clés et rotation sur quota) :
  - plusieurs clés par fournisseur (Claude en mode clé d'API, OpenAI, OpenCode Zen, fournisseurs OpenCode configurés), dans `SecretStorage` (`warband.vault.<fournisseur>`) ;
  - rotation sur `quota` ou `invalidKey` (`classifyProviderFailure`), avec un nouveau moteur et `resume` sur la même session ;
  - le moteur annonce l'empreinte de la clé qu'il transmet réellement (`provider.key`), et l'hôte arrête tout moteur dont l'empreinte diffère ou qui agit sans l'avoir annoncée ;
  - pour Zen, la clé passe par `OPENCODE_AUTH_CONTENT`, et « Importer la clé d'OpenCode » lit `auth.json` seulement au clic ;
  - interface dans Réglages › Fournisseurs › Clés, puce « clé N · empreinte » dans le chat, avis clair quand la rotation est impossible.
- **OpenCode :** `small_model` forcé sur le modèle du run. Avant, OpenCode appelait un petit modèle par défaut hors de l'offre gratuite (erreurs 402).

`git log --oneline c53b56f..multi-agent` donne le détail des commits.

## 6. Ouvert ou à surveiller
- Vérifier sur une vraie installation que les erreurs 402 sur le petit modèle d'OpenCode ont disparu.
- Avec les modèles gratuits d'OpenCode Zen, le quota est peut-être commun à toutes les clés. Idée proposée et pas encore faite : **rotation de modèles en repli** (liste de modèles, bascule sur quota, même avis et même puce).
- Petits défauts signalés et pas encore corrigés :
  - le message d'arrêt de campagne affiche un code brut (`vault.allExhausted`) au lieu d'une phrase ;
  - la puce de clé est masquée en mode campagne ;
  - l'état « épuisée » d'une clé ne s'est pas affiché dans les Réglages juste après une erreur (rafraîchissement ou persistance à vérifier).
- Noms d'outils Burp listés de mémoire, à confirmer avec un vrai Burp. Un outil inconnu est soumis à approbation à chaque appel, sans mémorisation.
- Gain de vitesse réel pour OpenCode : il faudrait un moteur persistant par chat. Proposé, pas fait.
- `docs/architecture-issues.md` contient des contradictions (test de contrat, ADR 0040, `agent/loop.ts` absent). Corrige-les à l'occasion.
- Le budget d'une campagne repart à zéro à chaque reprise (non persisté).

## 7. Comment commencer
1. Clone le dépôt, `git checkout multi-agent`, `pnpm install --frozen-lockfile`, puis `pnpm check` : il doit être vert (environ 3 850 tests).
2. Lis `CLAUDE.md`, puis les ADR 0054, 0055 et 0056.
3. Demande à l'utilisateur ce qu'il a observé sur la dernière pré-bêta, ou reprends le premier point de la section 6 s'il te dit de continuer.
