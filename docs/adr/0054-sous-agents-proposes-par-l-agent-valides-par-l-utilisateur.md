# 0054 — Sous-agents proposés par l'agent, validés par l'utilisateur

- Statut : accepté
- Date : 2026-11-27

## Contexte
Un chat fait aujourd'hui tout avec un seul agent. L'outil natif de sous-agent est fermé : côté Claude, `Task` n'est pas dans `builtinTools` (`agent-sdk/src/runner.ts:125`, `:648`) ; côté OpenCode, `task` est en `deny` (`agent-opencode/src/config.ts:20`). L'utilisateur veut cocher une case « Sous-agents » dans le chat : l'agent propose alors un découpage (par exemple domaines, fuzzing, API) ; l'utilisateur garde tout, une partie ou rien, et seuls les sous-agents retenus partent.

L'approche multi-agent autour des campagnes (ADR 0041, fiche d'engagement et plan de campagne) a été jugée confuse. Elle n'est pas reprise. Les tâches de fond (`core/src/tasks`, `max_parallel`, ADR 0032) ne servent pas à faire des sous-agents et ne changent pas.

Faits du code : une course = un processus moteur et un seul `start` (`vscode/src/engine/engine.ts:479`) ; les outils d'une course sont figés (`runner.ts:637-648`) ; un changement de réglage remplace le moteur inactif par un nouveau qui reprend la session (`vscode/src/logic/session.ts:158-162`) ; les événements d'un sous-agent Claude sont rattachés par `parent_tool_use_id` et `agentId` (`runner.ts:416-425`, `events.ts:82-89`) ; OpenCode suit déjà les sessions enfants (`agent-opencode/src/runner.ts:643`, `:1030-1046`) ; la politique par défaut est `ask` sans règle (`core/src/approval/policy.ts:71-72`).

## Décision
1. **Mode par chat.** Une préférence `subagents` par chat, stockée comme le fournisseur et le modèle (ADR 0036), transmise dans `StartParams`. Elle est ignorée en mode apprentissage. Un changement s'applique au message suivant, par remplacement du moteur inactif avec reprise de la session.
2. **Outil `propose_subagents`** (outil du bureau, exposé seulement si le mode est actif). Entrée : 1 à 4 éléments `nom` + `objectif`. Il bloque jusqu'à la réponse de l'utilisateur et rend les places retenues ou un refus avec la note éventuelle. Une seule proposition en attente à la fois. Politique : `allow`, car l'humain répond à la carte.
3. **Carte à cocher.** La proposition s'affiche dans le chat avec une case par sous-agent. L'utilisateur lance la sélection, ou n'en lance aucun. Un texte tapé pendant la proposition vaut refus avec cette note ; l'arrêt de la course vaut refus.
4. **Tableau des sous-agents dans le cœur** (sans SDK, sans texte d'affichage) : proposition en attente, places approuvées, sous-agents en cours.
5. **Règle structurelle dans la gate**, avant la politique, pour tout appel `Task` (OpenCode `task` est ramené à `Task`) : mode inactif → refus ; appel venant déjà d'un sous-agent → refus (pas d'imbrication) ; description qui ne correspond à aucune place approuvée non lancée → refus ; 4 sous-agents déjà en cours → refus ; sinon accord sans seconde demande. Ces refus ne sont ni mémorisables ni contournables par le Bypass. Les outils d'un sous-agent passent par la même gate, la même politique et le même périmètre de mission que ceux de l'agent principal.
6. **Exécution.** Les sous-agents retenus tournent en parallèle, 4 au plus, avec le modèle et les droits de l'agent principal. L'agent principal fait la synthèse. Une place se libère quand l'outil `Task` rend son résultat ou échoue.
7. **Adaptateurs**, seulement si le mode est actif : Claude reçoit `Task` et un agent `redwidow` défini par le moteur (l'option `agents` du SDK est verrouillée, jamais surchargeable) ; OpenCode passe `task` à `ask` pour `build` et définit un agent `redwidow` en mode sous-agent, sans `task`. Mode inactif : configuration inchangée.
8. **Événements** : `subagents.proposed` et `subagents.decided`. Le cycle de vie du sous-agent réutilise `tool.requested` (`agentToolUseId`, `agentId`) et `task.updated`. Codes de raison : `subagents.disabled`, `subagents.nested`, `subagents.not_approved`, `subagents.limit`, `subagents.approved`.

## Alternatives écartées
- **Laisser le modèle lancer ses sous-agents sans carte** : l'utilisateur ne choisirait plus ce qui part ; c'est le contraire de la demande.
- **Validation par la conversation seule** : le modèle interpréterait « oui » ou « juste le fuzzing » et lancerait lui-même ; rien ne l'empêcherait de mal comprendre. La carte et la gate rendent le choix vérifiable.
- **Réutiliser les tâches de fond ou les campagnes** : mécanismes d'une autre nature (processus d'outils, plan validé par empreinte) ; les mêler a déjà produit la confusion constatée.
- **Case valable pour un seul message** : le mode du chat est plus simple à comprendre et aligné sur les autres réglages du chat.

## Conséquences
- Mode inactif : aucun changement de comportement ni de configuration (les tests `task: false` restent valides).
- La gate gagne une règle propre aux sous-agents ; elle ne dépend d'aucun texte du modèle, seulement des places approuvées.
- Les demandes d'approbation de plusieurs sous-agents arrivent en parallèle et doivent porter le nom du sous-agent.
- Points à vérifier pendant l'implémentation : que le SDK Claude déclenche `PreToolUse` pour les appels d'un sous-agent (`agentId` est déjà transmis, `runner.ts:517`) ; qu'OpenCode exécute en parallèle plusieurs `task` d'un même message et fait passer la permission d'une session enfant par la gate.
- Coût : chaque sous-agent consomme ses propres tokens ; le plafond de 4 borne l'effet d'une proposition.
- Reste à faire plus tard si besoin : sous-agents avec modèle ou droits différents, reprise d'un sous-agent, imbrication.
