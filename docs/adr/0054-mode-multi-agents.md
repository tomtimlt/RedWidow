# 0054 — Mode multi-agents : un planificateur et des workers, activable par chat

- Statut : accepté (version de test, branche `multi-agent`)
- Date : 2026-11-15

## Contexte
Un chat lance aujourd'hui un seul agent par run. Faits du code :
- un moteur est un processus forké par chat (`packages/vscode/src/logic/controller.ts:241`) ; `CHAT_CAP = 4` (`extension.ts:341`) ;
- chaque run a son recorder (`runId` aléatoire, `core/src/recorder.ts:48`), sa file d'approbation et sa gate (`engine/engine.ts`, `createApprovalGate`) ; aucun état global mutable ne bloque des runs concurrents ;
- le Bypass vit dans l'hôte, par chat (`extension.ts:5457`), et le moteur n'en a qu'un miroir en lecture seule (`engine/bypass-mirror.ts`). La gate ne l'applique que si un `ask` humain existe (`core/src/approval/gate.ts:357-374`) ;
- la carte d'approbation (`logic/approval.ts:26-40`) ne porte ni chat ni run. La réponse est routée par `toolUseId` ;
- le graphe causal est construit en mémoire à partir de `parentId`, un run à la fois (`core/src/graph/build.ts`). Aucun nœud objectif ou intention n'existe.

On reprend l'idée d'un outil red team open source : un planificateur ne lance que les directions pas encore couvertes, et N workers en prennent chacune une, puis rendent un verdict de couverture.

## Décision
1. **Un mode, éteint par défaut.** Préférence par chat `multiAgent` (ADR 0036), `false` par défaut, et nombre de workers `multiAgent.workers`, 3 par défaut, de 1 à 8. Mode éteint : aucun changement de comportement, aucun code de campagne n'est chargé dans le moteur. **Une seule campagne active à la fois** dans l'extension, pour borner le nombre de processus à 1 + 8 en plus des chats.
2. **Campagne = un chat.** Le planificateur et les workers sont des runs ordinaires, chacun dans son propre processus moteur, rattachés au chat de la campagne. Ils ne comptent pas dans `CHAT_CAP`.
3. **Coordinateur dans `core`, sans SDK ni texte.** Module `campaign/` : intentions (`open`, `claimed`, `done`, `blocked`, `exhausted`) ; verdicts de couverture (`reported`, `no_issue_found`, `ruled_out`, `not_applicable`, `needs_follow_up`) ; prise d'intention atomique (un seul fil JS, l'état vit dans l'hôte) ; au plus 4 intentions ouvertes par tour du planificateur ; refus d'un doublon exact (même clé normalisée parmi `open`, `claimed`, `done`). Le jugement « direction déjà couverte sur le fond » reste au planificateur. Les codes de refus passent par `reason()` et les catalogues fr et en.
4. **Événements.** Nouveaux kinds `campaign.started`, `campaign.intent.opened`, `campaign.intent.claimed`, `campaign.intent.closed`, `campaign.finished`. Chacun a un validateur et une entrée `KIND_CLASS`. Ils sont écrits dans un journal de campagne qui référence les `runId` des workers. Le journal de chaque run reste inchangé.
5. **Outils du bureau.** Le planificateur reçoit `campaign_open_intent` et `campaign_status` ; un worker reçoit `campaign_close_intent` (verdict, résumé, références d'événements comme preuves). Ces outils appellent un port `CampaignPort` du `RunContext`, branché par IPC sur le coordinateur de l'hôte. Ce sont des outils du bureau : ils passent par la gate comme les autres.
6. **Cycle de vie.** L'hôte lance le planificateur. À chaque intention ouverte, si un worker est libre, l'hôte la lui attribue et lance son run avec l'intention et le contexte de mission. Si un run se termine sans `campaign_close_intent`, l'hôte ferme l'intention au nom du worker (`needs_follow_up`, dernier texte d'agent, `closedBy: "host"`) ; elle reste `blocked` après un arrêt utilisateur ou d'urgence, ou un crash avant tout texte. Un rappel de clôture est injecté une fois à 8 tours restants (point de contrôle du bureau). Le planificateur est réveillé à chaque fermeture, avec un délai anti-rebond, jamais par une attente en boucle. La campagne se termine quand le planificateur l'arrête, quand le budget est épuisé ou à l'arrêt d'urgence.
7. **Approbations : une file commune.** Chaque worker garde sa propre gate, qui reste l'unique autorité. L'hôte agrège les demandes de tous les moteurs de la campagne dans la vue du chat. La carte gagne un champ `agent` (rôle et numéro de worker, titre court de l'intention). La réponse est routée par `toolUseId` vers le bon moteur ; un `toolUseId` inconnu est refusé.
8. **Bypass : appliqué à toute la campagne.** Choix de l'utilisateur. Le Bypass du chat est envoyé en miroir à tous les moteurs de la campagne ; l'activer, le couper ou le laisser expirer s'applique à tous. L'utilisateur en est responsable (ADR 0017). Les invariants restent :
   - durée bornée ;
   - extinction à l'arrêt du moteur ;
   - effet seulement si un humain répond (chaque gate a son `ask`) ;
   - un engagement arrêté (`engagement.halted`) n'est jamais contourné.
9. **Budget.** Chaque worker a un plafond de tours et de budget par intention, et la campagne un total. Le coordinateur cesse d'attribuer des intentions quand le total est atteint, et le moteur coupe un run qui dépasse son plafond. Un plafond de tokens (`CAMPAIGN_MAX_TOKENS`, 3 000 000, entrée + sortie) double le plafond en dollars, car un modèle gratuit remonte un coût de 0 ; le premier atteint arrête les attributions.
10. **Arrêt.** L'arrêt du chat ou l'arrêt d'urgence coupe tous les moteurs de la campagne, avec le cycle de vie des processus de l'ADR 0001.
11. **Espace de travail partagé.** Les workers partagent le dossier du projet. Le planificateur doit donner des intentions disjointes. Aucun verrou de fichier dans cette version.

## Lots
1. `core` : module `campaign/`, événements, validateurs, raisons, catalogues, `KIND_CLASS`, tests.
2. Outils du bureau et `CampaignPort` dans les deux adaptateurs, tests.
3. Hôte : orchestration des processus, IPC, miroir du Bypass vers tous les moteurs, agrégation des approbations, arrêt, tests dans `logic/`.
4. Interface (`cadre`, puis `surface`) : interrupteur du mode, nombre de workers, panneau de campagne, étiquette `agent` sur la carte.
5. Budget par intention, avec une réserve pour conclure.

## Alternatives écartées
- Sous-agents du SDK (`Task`) : propres à un fournisseur, invisibles pour la gate d'OpenCode, et non vérifiés (`architecture-issues.md:286`).
- Base de données partagée : inutile avec un seul processus coordinateur.
- Bypass activé worker par worker : refusé par l'utilisateur.

## Conséquences
- Jusqu'à 9 processus moteur en plus pendant une campagne, d'où le coût en mémoire et en tokens. Le plafond reste réglable.
- Des écritures concurrentes dans le dossier du projet sont possibles. À revoir si elles posent problème.
- Le graphe de campagne (intentions → runs) demande un rendu dédié (lot 4).
