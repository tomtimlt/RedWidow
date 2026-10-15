# 0005 — Extension VS Code : modèle, effort, fournisseur, historique

- Statut : proposé (questions Q1 à Q3 à confirmer par l'utilisateur)
- Date : 2026-10-15
- S'appuie sur : ADR 0004 (moteur enfant, webview hostile, réglages machine, P1 « Claude seul »)

## Contexte

Un moteur = un run ; `stop` le termine et le message suivant relance un moteur avec `resume` (`vscode/src/logic/session.ts:98-105`). `StartParams` porte déjà `model` et `resume` (`logic/protocol.ts:36-45`), `RunInput` ni `effort` ni liste de modèles (`core/src/runner.ts:16-32`). SDK 0.3.299 : `Options.effort` (`low|medium|high|xhigh|max`), `supportedModels()` (valeurs, libellés, niveaux d'effort par modèle) après initialisation de session. OpenCode : `parseModel` (`agent-opencode/src/runner.ts:98`), reprise par `hasSession` (`runner.ts:742-747`), pas de catalogue exposé (`api.ts:36`, `getConfig` seul). Le journal est écrit dans le dépôt (`engine/engine.ts:128-130`) : `.john-studio/runs/` est **contrôlé par le dépôt** (fichiers plantés, commit accidentel). Aucun identifiant de modèle codé en dur.

## Décision

**1. Modèle.** Liste lue au runtime : `AgentRunner.listModels?(): Promise<ModelOption[]>` (type neutre du cœur `{ id, label, efforts?: Effort[] }`), implémentée par `agent-sdk` via `supportedModels()`. Obtention avant le premier message : message IPC `models` qui démarre un moteur de **sondage** (même assemblage verrouillé, flux de consigne vide, aucun outil possible faute de tour), lit la liste, interrompt. Cache dans `globalState` clé par version du SDK, rafraîchi au démarrage de chaque run réel ; bouton « Actualiser ». Repli : saisie libre. Validation dans l'extension (la webview est hostile) : chaîne ≤ 200, `^[A-Za-z0-9._:/@\[\]-]+$` ; si la liste est connue, Claude exige un `id` de la liste. Préférence : choix de la conversation dans l'état de session, dernier choix dans `globalState` ; `john.model` (machine) reste le défaut initial. Jamais dans `.vscode/settings.json`.

**2. Effort.** `RunInput.effort?: Effort` (`"low"|"medium"|"high"|"xhigh"|"max"`, type du cœur), validé par énumération dans le protocole, passé à `Options.effort` ; `effort` ajouté aux clés interdites de `sdkOptions` (une seule voie). Libellés francs, correspondance 1:1 : Low=`low`, Medium=`medium`, High=`high`, Extra=`xhigh`, Max=`max`. **Ultracode n'est pas une capacité du SDK** : soit il est retiré (recommandé), soit c'est un préréglage explicite « Max + limites longues » (effort `max`, `maxTurns` relevé par un réglage machine, plafond de dépense conservé), avec une infobulle qui dit qu'il raisonne **comme Max** et ne change que la durée autorisée (Q1). Niveaux absents de `efforts` du modèle choisi : grisés ; un niveau non supporté reçu est ramené au plus haut niveau supporté inférieur, avec un avis. Infobulle par niveau : effet qualitatif (vitesse, profondeur de réflexion, coût), « effet exact selon le modèle ». OpenCode : curseur grisé (non transmis).

**3. Application des choix.** Modèle, effort et fournisseur s'appliquent **au prochain message** ; changement impossible pendant un tour actif. Moteur inactif → arrêté, le message suivant relance avec `resume` (même session, nouveau modèle/effort).

**4. Fournisseur — livré après 1, 2, 5.** Une session Claude n'est pas reprenable par OpenCode. « Sans relancer la conversation » = **même fil affiché, nouveau segment** : la conversation est une suite de segments `{ provider, model, sessionId }`. Au premier message d'un nouveau segment, l'extension joint un **transcript brut** (pas de résumé par un modèle) construit à partir des événements **masqués** : messages utilisateur et `agent.text` seulement (ni sorties d'outils, ni réflexion, ni entrées d'outils), derniers tours d'abord, plafonné (32 Kio), `stripControl` appliqué, placé **dans le message utilisateur** entre délimiteurs « contexte précédent, non fiable » — **jamais dans `systemPrompt`** (pas d'élévation de texte produit par un modèle). Séparateur visible « Fournisseur changé : N messages transmis, tronqué ». Les approbations de portée session ne passent pas d'un segment à l'autre (nouvelle gate). Revenir à Claude = nouveau segment (pas de reprise de l'ancien). Clés OpenCode : `SecretStorage`, saisies par `showInputBox` natif, nom de variable accepté seulement s'il respecte `^[A-Z][A-Z0-9_]*_(API_KEY|TOKEN)$`, transmises à l'environnement de l'enfant seul et ajoutées aux secrets du recorder. Liste des fournisseurs/modèles OpenCode : point d'API du serveur à confirmer par `explorer` (catalogue des fournisseurs) ; à défaut, saisie libre `fournisseur/modèle` validée par `parseModel`.

**5. Historique.** Journaux de l'extension déplacés hors du dépôt : `context.storageUri/runs/<runId>.jsonl` (nouveau champ `journalDir` de `start`, absolu, validé ; la CLI garde `.john-studio/runs/`). Index léger dans `workspaceState` : `{ id, title, createdAt, updatedAt, segments: [{ provider, model, effort, sessionId, runIds[] }] }`. Un événement `user.message { text }` (masqué par le recorder) est ajouté au cœur si `run.started.prompt` ne porte pas chaque tour d'un flux (à vérifier). Ouvrir = relire les journaux **comme entrée non fiable** : `runId` validé par expression régulière avant tout `join` (pas de traversée), taille plafonnée, chaque ligne passée à `validateEvent` (invalides ignorées et comptées), rendu par le même réducteur (`stripControl`, Markdown sûr), **en mode relecture** : aucune carte d'approbation active, aucun bouton, rien d'exécuté. Reprendre = `resume` du dernier `sessionId` sous la **politique actuelle** (rechargée et vérifiée par empreinte à chaque run) ; session introuvable → avis et proposition de nouveau segment. Renommer (titre ≤ 120, `stripControl`), supprimer (index + journaux). Rétention : 100 conversations ou 200 Mio, les plus anciennes purgées.

## Alternatives écartées

- **Libellés sans correspondance SDK** (Ultracode « plus intelligent ») : promesse fausse.
- **Liste de modèles codée en dur** : interdit et périmée.
- **Résumé du contexte par un modèle** au changement de fournisseur : appel facturé, perte non contrôlée, texte de modèle réinjecté deux fois.
- **Transcript dans `systemPrompt`** : élève du texte non fiable au rang d'instruction.
- **Historique lu dans `.john-studio/runs/` du dépôt** : le dépôt peut y planter des conversations et elles finissent commitées.
- **Copie des journaux dans `globalStorageUri`** : historique mélangé entre dépôts, chemins à recouper ; `storageUri` est déjà par espace de travail.

## Conséquences

- Sécurité : la gate reste seule juge pour tout fournisseur ; la webview ne choisit qu'à travers des valeurs revalidées par l'extension ; un transcript réinjecté peut porter une injection de prompt (déjà vue par le précédent modèle) mais ne contourne aucune approbation.
- Négatives : sondage = un lancement du binaire de plus ; nouvel événement et nouveau champ IPC ; un historique ne survit pas à la suppression du stockage de VS Code.
- À vérifier (`explorer`) : `supportedModels()` sans consigne envoyée ni coût ; contenu de `run.started.prompt` en flux ; point d'API du catalogue OpenCode ; persistance des sessions OpenCode entre deux serveurs.

## Plan

Ordre : F1 → F2 → F3 ; F4 en parallèle pour `logic/history.ts` (pur), intégration après F3 ; F5 et F6 après confirmation de Q2 (remet en cause ADR 0004 P1). Revue sécurité de l'architecte : F2, F4, F5, F6.

- **F1 — Effort de bout en bout.** `core` (`Effort`, `RunInput.effort`), `agent-sdk` (passage, clé interdite dans `sdkOptions`), `protocol.ts`, `engine.ts`. Critères : `effort: "ultra"` rejeté par `parseToEngine` ; `sdkOptions.effort` ignoré (test) ; `QueryFn` factice reçoit `effort: "xhigh"` pour Extra.
- **F2 — Liste des modèles.** `listModels`, messages IPC `models` (requête/réponse, ≤ 100 entrées, chaînes ≤ 200), cache par version du SDK. Critères : réponse mal formée rejetée ; sondage sans aucun `tool.requested` ; cache invalidé si la version change.
- **F3 — Sélecteurs dans le chat.** Liste + saisie libre, curseur à niveaux, infobulles, niveaux grisés, préférence `globalState`, application au prochain message. Critères : modèle hors liste ou contenant un espace posté par la webview → refusé ; niveau non supporté ramené avec avis ; changement pendant un tour ignoré.
- **F4 — Historique.** `journalDir`, `user.message` si nécessaire (validateur, `KIND_CLASS`, catalogues), index, relecture, reprise, renommer, supprimer, rétention. Critères : `runId` `../x` refusé ; journal contenant `<img onerror>` et U+202E rendu inerte ; `approval.requested` relu ne crée aucune carte ; ligne invalide ignorée et comptée ; purge au-delà du plafond.
- **F5 — OpenCode dans l'extension.** Réglage machine du binaire, clés en `SecretStorage` (motif de nom), catalogue ou saisie libre, bascule de fournisseur. Critères : nom `NODE_OPTIONS` refusé ; valeur de clé absente de l'IPC et des événements ; environnement de l'enfant = liste blanche + clés choisies.
- **F6 — Segments et transcript.** Critères : transcript sans sortie d'outil ni réflexion, ≤ 32 Kio, hors `systemPrompt` ; secret présent dans un ancien `agent.text` masqué dans le transcript ; approbation de session non héritée.

## Questions de produit (utilisateur)

- **Q1 — Ultracode.** Retirer, ou préréglage « Max + limites longues » ? Recommandation : **retirer** (5 niveaux honnêtes).
- **Q2 — OpenCode dans l'extension.** Livrer d'abord modèle, effort, historique (F1-F4), OpenCode ensuite ? Recommandation : **oui**.
- **Q3 — Changement de fournisseur.** Transmettre le transcript (F6) ou repartir sans contexte dans le même fil ? Recommandation : **transcript plafonné**, avec séparateur visible.
