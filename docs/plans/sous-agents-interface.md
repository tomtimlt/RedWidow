# Sous-agents : interface du chat (lot 3 de l'ADR 0054)

Cadrage produit de l'ADR 0054 (sous-agents proposés par l'agent, validés par l'utilisateur), partie interface. La logique est livrée (lot 1) : `StartParams.subagents`, messages moteur `subagentsProposal` / `subagentsAnswer`, `Prefs.subagents` et `ChatControls.subagents` (`logic/controls.ts`), `session.setSubagents` / `session.answerSubagents` (`logic/session.ts:1286-1315`), `ChatView.subagentsProposal` (`logic/chat.ts:117-153`), effacement sur `subagents.decided` (`chat.ts:428`). Le moteur traite déjà le texte libre pendant une proposition comme un refus avec note (`engine/engine.ts:517-519`).

## Décision

1. **Interrupteur dans `#cfg-pop`, section Exécution**, au-dessus de « Apprentissage », même forme (`role="switch"`). Quand le mode est actif, une puce `#subagents-chip` apparaît dans `#toolbar` (état visible popover fermé, ouvre `#cfg-pop`). Gelé pendant une réponse, comme l'apprentissage : on le change entre deux messages, il s'applique au message suivant.
2. **La proposition en attente est une carte dans `#approvals`**, à côté des demandes d'autorisation. Elle demande une réponse, comme elles. Le fil garde un **élément « Sous-agents »** (nouveau `ChatItem`), construit à partir des événements `subagents.proposed` / `subagents.decided`. C'est le résumé en lecture seule, y compris quand on relit l'historique.
3. **Pas de champ de note dans la carte.** La note passe par le composeur : un message envoyé pendant la proposition vaut refus, avec ce texte pour note. Une ligne d'indice sous le champ le dit.
4. **Les sous-agents sont affichés en imbrication.** Les appels d'un sous-agent se rangent sous l'élément `Task` qui l'a lancé, repliés par défaut. Chaque carte d'autorisation venant d'un sous-agent porte son nom. Un compteur `n/4` apparaît sur la puce de la barre.
5. **Les erreurs et refus utilisent le rendu existant.** Un `Task` refusé par la gate (`subagents.limit`, `.not_approved`, `.nested`, `.disabled`) s'affiche comme tout outil refusé, avec le libellé du code de raison. Rien de nouveau à inventer.

## Pourquoi, alternatives écartées

- **Où mettre l'interrupteur.**
  - *Dans la barre seule* : écartée, la barre est déjà pleine (menu, modèle, recherche, configurer, envoyer).
  - *Dans le menu `#composer-menu`* : écartée, il contient des actions ponctuelles, pas des modes durables.
  - `#cfg-pop` regroupe les réglages durables du chat. La puce compense le fait que le popover est fermé la plupart du temps.
- **Où mettre la carte de proposition.**
  - *Seulement dans le fil* : écartée. La carte serait emportée par le défilement et par la fenêtre de 60 éléments. Il faudrait aussi réécrire la gestion du focus, alors que `#approvals` la fait déjà (`chat.js:1823-1852`).
  - *Seulement dans `#approvals`* : écartée, il ne resterait aucune trace en relecture. D'où le couple carte vivante + élément du fil.
- **Note dans la carte.**
  - *Champ de note dans la carte* : écarté, ce serait un doublon du composeur, que l'utilisateur a déjà désigné comme moyen de refuser avec un texte.
- **Échap.**
  - *Échap vaut refus* : écarté, un refus par accident coûte une nouvelle proposition. Échap rend seulement le focus au composeur.
- **Coût du choix.** Les appels des sous-agents comptent dans la fenêtre de 60 éléments (`MAX_ITEMS`). Quatre sous-agents bavards peuvent repousser le début du tour vers la pagination. C'est accepté, et rien ne change côté moteur.

## Règles communes à tous les lots

- **Fichiers interdits** : `packages/core`, `packages/agent-sdk`, `packages/agent-opencode`, `packages/vscode/src/engine/`, `logic/protocol.ts` et `logic/controller.ts` (protocole IPC moteur). Ne pas modifier la gate ni la politique.
- **Messages webview → hôte.** Tout nouveau message passe par `WebviewMessage` et `parseWebviewMessage` (`logic/approval.ts`), avec une liste stricte de clés. Toute clé en trop est refusée, comme pour `setLearning` (`approval.ts:327`). La décision reste à la session et au moteur : l'interface ne fait qu'envoyer des identifiants.
- **Libellés.** Chaque libellé existe en fr et en en :
  - `html.ts` : `localized("…", locale)` + `data-i18n` ;
  - `chat.js` : `t(…)` ;
  - `logic/*.ts` : `t` de `@warband/messages`.
  - Les entrées en vont dans le domaine `packages/messages/src/ui-domains/` qui contient déjà les libellés voisins (`chat.ts` pour la webview, `logic.ts` pour `logic/`).
- **Rendu.** Construction par `el()` / `textContent` uniquement. Pas de `innerHTML`, pas d'`insertAdjacentHTML`, pas de gabarit avec une donnée venue du modèle.
- **Validation.** `pnpm check` entièrement vert.

## Lot A : interrupteur « Sous-agents » et préférence branchée

**Objectif.** L'utilisateur active ou coupe le mode du chat. L'état est visible popover fermé.

**Fichiers.** `logic/approval.ts`, `extension/extension.ts`, `logic/html.ts`, `media/chat.js`, `packages/messages/src/ui-domains/chat.ts`. CSS seulement si nécessaire, dans le fichier de style qui porte déjà `.cfg-control`.

**Étapes.**
1. **`approval.ts`** :
   - ajouter `| { type: "setSubagents"; enabled: boolean }` à `WebviewMessage` ;
   - dans `parseWebviewMessage`, ajouter le cas sur le modèle de `setLearning` : booléen strict, aucune autre clé.
2. **`extension.ts`**, près de `case "setLearning"` (l.1256) : `case "setSubagents": return s.setSubagents(message.enabled);`.
3. **`html.ts`**, dans `section.cfg-execution`, avant `#learning-switch` : bloc `div.cfg-control` contenant
   - `button#subagents-switch` (`role="switch"`, `aria-checked="false"`, `aria-describedby="subagents-help"`, icône existante au choix) ;
   - le libellé « Sous-agents » / « Subagents » ;
   - `p#subagents-help.tip`, avec « L'agent propose des sous-agents en parallèle (4 au plus) ; vous choisissez ceux qui partent. » / « The agent proposes parallel subagents (up to 4); you choose which ones run. ».
4. **`html.ts`**, dans `#toolbar`, juste avant `.spacer` : `button#subagents-chip.chip` (`hidden`, `popovertarget="cfg-pop"`, libellé « Sous-agents », `span#subagents-count` vide).
5. **`chat.js`**, dans `renderControls` (près de l.789-792) :
   - `aria-checked = c.subagents === true` ;
   - `aria-disabled = c.locked || c.learning` ;
   - texte de `#subagents-help`, au choix :
     - si `c.learning` : « Indisponible en mode Apprentissage. » / « Unavailable in Learning mode. » ;
     - sinon si `c.locked` : « Modifiable après la réponse en cours ; s'applique au message suivant. » / « Can be changed after the current reply; applies to the next message. » ;
     - sinon : la phrase d'aide.
   - `#subagents-chip.hidden = c.subagents !== true`.
6. **`chat.js`**, au clic : si `aria-disabled` vaut `"true"`, ne rien faire. Sinon : `vscode.postMessage({ type: "setSubagents", enabled: ctl.subagents !== true })`. Un seul point d'envoi.
7. **Sortie du mode apprentissage.** La préférence enregistrée revient d'elle-même, puisque `ChatControls.subagents` est déjà l'état effectif. Rien à stocker côté webview.

**Critères.**
- **`test/approval.test.ts`** :
  - `setSubagents` accepté avec `true` et avec `false` ;
  - refusé sans `enabled`, avec `enabled` non booléen, ou avec une clé en plus (`mode`, `systemPrompt`).
- **`test/html.test.ts`** :
  - `#subagents-switch` est présent, avec `role="switch"` et `aria-describedby` ;
  - `#subagents-chip` est présent et `hidden` ;
  - `chat.js` contient exactement un `type: "setSubagents"`, dont le corps est `type: "setSubagents", enabled: ctl.subagents !== true` (même forme que le test `setLearning`, l.494-507) ;
  - le rendu en anglais contient « Subagents ».
- **`test/chat-i18n.test.ts`** vert : tout libellé nouveau a sa traduction en.

**Interdits.**
- Ne pas modifier `session.setSubagents` ni `buildControls`.
- Pas de case à cocher par message.
- Pas d'envoi pendant `locked`.

## Lot B : carte de proposition et élément « Sous-agents » du fil

**Objectif.** L'utilisateur choisit les sous-agents qui partent, ou n'en lance aucun. Le fil garde la trace de la réponse, y compris en relecture.

**Fichiers.** `logic/chat.ts` (principal), `logic/approval.ts`, `extension/extension.ts`, `logic/html.ts`, `media/chat.js`, `packages/messages/src/ui-domains/chat.ts` et `logic.ts`. Ajouter aussi tout consommateur d'un `switch` sur `ChatItem.kind` : `logic/conversation-context.ts`, l'export du fil dans `extension.ts`, `logic/mission-report.ts` si concerné. Chacun ignore ou résume le nouveau genre. Rien ne doit tomber dans la branche par défaut de `renderItem` (`chat.js:311`), qui l'afficherait comme un avis.

**Étapes.**
1. **`chat.ts`, nouveau genre de `ChatItem`.**
   ```ts
   { kind: "subagents"; proposalId: string; items: { id: string; name: string; goal: string }[];
     status: "pending" | "accepted" | "declined"; selected: string[]; note?: string }
   ```
   `selected` contient des identifiants d'éléments. Neutralisation identique à `setSubagentsProposal` : `cleanText` à 200 caractères pour le nom, 4000 pour l'objectif, 2000 pour la note.
2. **`chat.ts`, dans `event()`.**
   - `subagents.proposed` : `push` d'un élément `pending`.
   - `subagents.decided` : retrouver l'élément par `proposalId`. Lui donner `status = decision`, `selected = e.selected.map(p => p.id)` filtré sur les identifiants connus, et `note` s'il y en a une. Garder l'effacement existant de la proposition vivante.
3. **`approval.ts`.** Ajouter à `WebviewMessage` :
   ```ts
   | { type: "answerSubagents"; proposalId: string; selected: string[]; note?: never }
   ```
   La webview n'envoie jamais de note. Dans le parseur, n'accepter que les clés `type`, `proposalId` et `selected` :
   - `proposalId` : chaîne de 1 à 200 caractères ;
   - `selected` : tableau d'au plus 4 chaînes de 1 à 200 caractères, sans doublon ;
   - tout le reste est refusé.
4. **`extension.ts`** : `case "answerSubagents": return s.answerSubagents(message.proposalId, message.selected);`. La session revalide l'appartenance (`session.ts:1301`).
5. **`chat.js`, carte vivante**, rendue dans `#approvals` à partir de `view.subagentsProposal`, avant les cartes d'autorisation :
   - **Structure.** Un `<form class="card subagents-card">` contenant :
     - le titre « L'agent propose des sous-agents » / « The agent proposes subagents » ;
     - un `<label>` par élément, avec une case cochée au départ, le nom en gras et l'objectif dessous ;
     - le bouton principal (`type="submit"`) « Lancer la sélection (n) » / « Run selection (n) », désactivé quand n = 0 et recalculé à chaque changement de case ;
     - le bouton secondaire « Aucun sous-agent » / « No subagents ».
   - **Envoi.**
     - Le bouton principal envoie `answerSubagents` avec les identifiants cochés.
     - Le bouton secondaire envoie `answerSubagents` avec `selected: []`.
     - Après un envoi, tous les contrôles de la carte sont désactivés et le bouton principal affiche « Lancement… » / « Starting… », jusqu'à ce que la vue n'ait plus de proposition.
   - **Clavier.**
     - Une carte nouvelle (`proposalId` jamais vu) reçoit le focus sur sa première case, comme `fresh` pour les cartes d'autorisation.
     - Espace coche ou décoche. Entrée soumet le formulaire si n > 0. Échap rend le focus à `#input`, sans refuser.
   - **Rendu stable.** La carte est mise en cache par `proposalId`, comme `approvalNodes`. Un nouveau rendu ne décoche rien.
   - **Repère visuel.** `body.awaiting` tient compte de la carte.
6. **`chat.js`, élément du fil `kind === "subagents"`**, en lecture seule :
   - `pending` et `view.subagentsProposal?.proposalId === item.proposalId` : « Sous-agents proposés : a, b, c. En attente de votre choix. » / « Subagents proposed: a, b, c. Awaiting your choice. »
   - `pending` sans proposition vivante (course arrêtée, moteur tombé, relecture) : « Proposition de sous-agents restée sans réponse. » / « Subagent proposal left unanswered. »
   - `accepted` : « Sous-agents lancés : a, b » / « Subagents started: a, b ». Les noms non retenus apparaissent barrés ou en sourdine, dans un `<details>` replié qui montre aussi les objectifs.
   - `declined` : « Aucun sous-agent lancé. » / « No subagents started. » Ajouter « Note : … » / « Note: … » s'il y a une note.
   - Après un refus, si `view.controls?.subagents` est vrai et la vue n'est pas en lecture seule, ajouter un bouton lien « Désactiver le mode sous-agents » / « Turn off subagents mode ». Il envoie `setSubagents` `false`, depuis le même point d'envoi que le lot A : factoriser l'appel dans une fonction, pour garder un seul `type: "setSubagents"` dans le fichier.
7. **`html.ts`**, sous `#input` dans `#composer` : `p#subagents-hint.hint` (`role="status"`, `hidden`), avec le texte « Une proposition de sous-agents attend votre choix : envoyer un message la refuse, avec ce texte pour note. » / « A subagent proposal is waiting: sending a message declines it, with your text as the note. ». `chat.js` l'affiche quand `view.subagentsProposal` est présent. Le message envoyé apparaît dans le fil comme d'habitude, et la carte disparaît sur `subagents.decided`.

**Critères.**
- **Nouveau `test/subagents-view.test.ts`, sur `createChatState`** :
  - `proposed` produit un élément `pending` ;
  - `decided` `accepted` donne le statut et les identifiants retenus ;
  - `decided` `declined` avec une note donne la note, neutralisée et plafonnée ;
  - un `decided` d'un autre `proposalId` ne change rien ;
  - un identifiant inconnu dans `selected` est ignoré ;
  - une relecture sans `decided` reste `pending` ;
  - en lecture seule, `view()` n'a pas de `subagentsProposal` mais garde l'élément ;
  - des caractères de contrôle ou bidi dans le nom sont retirés.
- **`test/approval.test.ts`** : `answerSubagents` est accepté avec un ou plusieurs identifiants, et avec `[]`. Il est refusé :
  - avec plus de 4 identifiants ;
  - avec un doublon ;
  - avec un identifiant non chaîne, vide ou de plus de 200 caractères ;
  - avec la clé `note` ;
  - avec toute autre clé ;
  - sans `proposalId`.
- **`test/html.test.ts`** :
  - `#subagents-hint` est présent et `hidden` ;
  - `chat.js` contient exactement un `type: "answerSubagents"` ;
  - aucun `innerHTML` n'est ajouté ;
  - la branche `kind === "subagents"` existe dans le rendu.
- Les tests existants sur les consommateurs de `ChatItem` (`conversation-context.test.ts`, `chat-export.test.ts`) restent verts. Ajouter un cas pour le nouveau genre là où il est résumé.

**Interdits.**
- Pas de note saisie dans la carte.
- Pas de refus implicite (Échap, perte de focus, changement de chat).
- Ne pas retirer la carte côté webview avant la vue de l'hôte : c'est `subagents.decided` qui la retire.
- Ne pas modifier `session.answerSubagents`, `controller.subagentsAnswer` ni le moteur.

## Lot C : sous-agents en cours, imbrication et autorisations nommées

**Objectif.** L'utilisateur voit quels sous-agents tournent, ce que chacun fait, et pour quel sous-agent il autorise une action.

**Fichiers.** `logic/chat.ts` (principal), `logic/approval.ts`, `media/chat.js`, `packages/messages/src/ui-domains/chat.ts` et `logic.ts`.

**Étapes.**
1. **`chat.ts`, champs ajoutés à l'élément `tool`.**
   - Une `agent?: string` (nom affiché, neutralisé à 200 caractères), pour un `Task` lancé par l'agent principal, prise dans `input.description` si c'est une chaîne.
   - Une `parentToolUseId?: string` pour un appel venant d'un sous-agent, prise dans `e.agentToolUseId`.
2. **`chat.ts`, tables internes.** Tenir `taskNames: Map<toolUseId du Task, nom>` et `agentNames: Map<agentId, nom>`. Cette seconde table est alimentée par `tool.requested` lorsque `agentToolUseId` et `agentId` sont présents. Nettoyer les deux à l'éviction des éléments, comme `execTools`.
3. **`approval.ts`.**
   - `toCard` recopie `pending.agentId` (neutralisé) dans un champ `agentId?` de la carte. Ce champ ne sert qu'à la résolution ci-dessous.
   - `view()`, dans `chat.ts`, ajoute `agent?: string` en résolvant le nom par `agentNames`. Comme la résolution se fait à chaque vue, l'ordre d'arrivée entre `tool.requested` et la demande d'autorisation est sans importance.
   - Une carte venant d'un sous-agent dont le nom est inconnu reçoit `agent: ""`. L'affichage est alors générique.
4. **`chat.ts`, compteur.** `view()` ajoute `subagents?: { running: number; max: 4 }` quand `controls.subagents` est vrai. `running` compte les éléments `tool` qui vérifient tout ceci : outil `Task` ou `Agent` (même liste que `present.ts:22-23`), sans `parentToolUseId`, `decision === "allow"`, `status === "pending"`. Le 4 reprend la constante exportée par `@warband/core` si elle l'est. Ne pas la redéfinir ailleurs que dans `chat.ts`.
5. **`chat.js`, imbrication.** Dans `renderItems`, un élément dont le `parentToolUseId` correspond à un `Task` présent dans la fenêtre est rendu dans un conteneur `div.subagent-calls` du nœud de ce `Task`. Le conteneur est un `<details>` replié par défaut, dont le résumé est « n actions » / « n actions ». L'état ouvert ou fermé est gardé entre rendus, comme `openTools`. Un élément dont le parent est hors fenêtre reste à plat, avec un préfixe « Sous-agent » / « Subagent ».
6. **`chat.js`, en-tête du `Task`.** Le nom du sous-agent (`item.agent`) et un état :
   - `pending` + `allow` : « en cours » / « running » ;
   - `ok` : « terminé » / « done » ;
   - `error` : « échec » / « failed » ;
   - `denied` : rendu existant du refus, avec le libellé du code `subagents.*` déjà dans `output` ;
   - `interrupted` : « interrompu » / « interrupted ».
7. **`chat.js`, carte d'autorisation.** Si `card.agent` est défini, ajouter en tête une ligne « Sous-agent « nom » » / « Subagent "name" », ou « Sous-agent » / « Subagent » si le nom est vide. Le contenu et les boutons de la carte ne changent pas.
8. **`chat.js`, puce du lot A.** `#subagents-count` affiche ` · running/max` quand `running > 0`, et `aria-label` dit « n sous-agents en cours sur 4 » / « n of 4 subagents running ».

**Critères.**
- **Nouveau `test/subagents-nesting.test.ts`** :
  - un `Task` principal porte `agent` d'après `input.description` ;
  - un `tool.requested` avec `agentToolUseId` porte `parentToolUseId` ;
  - le compteur suit l'ordre `Task` autorisé, puis `tool.result`, et passe de 1 à 0 ;
  - un `Task` refusé avec `subagents.limit` n'est pas compté et garde le libellé de refus ;
  - les tables sont vidées à l'éviction (`MAX_ITEMS` dépassé) ;
  - le compteur est absent quand le mode est inactif.
- **`test/approval-card.test.ts`** :
  - `toCard` recopie `agentId` neutralisé ;
  - une carte sans `agentId` n'a pas de champ `agent` dans la vue ;
  - avec un `agentId` connu, la vue donne le nom ;
  - avec un `agentId` inconnu, la vue donne `""`.
- **`test/html.test.ts`** : la ligne « Sous-agent » de la carte d'autorisation est construite par `textContent`.

**Interdits.**
- Ne pas déduire une autorisation de l'interface : la carte reste une demande ordinaire de la gate.
- Ne pas traiter `task.updated` dans ce lot : l'état vient de l'élément `Task`.
- Ne pas changer la fenêtre `MAX_ITEMS`.

## Décisions requises (voie moteur, non bloquantes)

Aucune n'empêche les lots A à C.

1. **Arrêt de la course et refus.** `subagents.decided` ne dit pas si un refus vient de « Aucun sous-agent » ou de l'arrêt de la course. Les deux s'affichent « Aucun sous-agent lancé ». Un champ de cause permettrait de les distinguer. À trancher par l'orchestrateur s'il le juge utile.
2. **OpenCode.** Si les appels d'une session enfant n'arrivent pas avec `agentToolUseId` et `agentId` dans `tool.requested`, l'imbrication et le nom tombent sur le rendu générique (appel à plat, « Sous-agent »). C'est à vérifier côté adaptateur, sans changer l'interface.
