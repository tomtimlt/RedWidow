# Méthode commune des agents — 0.3.57

Warband transmet automatiquement le skill **Conduite vérifiable d'une mission**
aux agents Claude, OpenAI et OpenCode, quel que soit le modèle choisi, depuis
VS Code comme depuis la CLI. Il n'est pas nécessaire de le recopier dans la
consigne utilisateur ni de demander à l'agent de le charger. Il accompagne
également les reprises. Le [texte embarqué complet](../packages/core/src/methodology.ts)
est la source unique ; il ne contient pas de recette d'exploitation.

## Contrat renforcé depuis la 0.3.57

La source exécutée est `packages/core/src/methodology.ts` (`AGENT_METHODOLOGY`).
Elle est injectée aux agents Claude, OpenCode et OpenAI via OpenCode, y compris
à la reprise ; l’intégration Claude la transmet aussi au démarrage des sous-agents.
Elle ne dépend pas d’un rappel dans le prompt utilisateur.

Pendant une mission autorisée avec écriture disponible, l’agent doit :

- Relire les notes du projet au démarrage et à la reprise, sans confondre notes
  partagées et preuves propres à la conversation courante.
- Consigner chaque étape significative au fil du travail, avant la dépendance
  suivante : observation, piste testée, résultat, échec diagnostiqué ou nouveau
  contexte. Les commandes répétitives d’un même test restent regroupées.
- Créer les notes avec `note`, conserver leurs ids, les corriger avec `update_note`,
  utiliser les états `hypothesis`, `confirmed`, `failed` selon les preuves et relier
  les vrais parents `from`. Les sorties détaillées restent dans les artefacts ;
  les titres courts ne contiennent pas de secrets ni de flags bruts.
- Marquer et corriger le chemin retenu avec `mark_path` et `pathFrom`, sans
  transformer une hypothèse en réussite pour obtenir un lien vert.
- Vérifier les écritures et réconcilier notes, liens et preuves avant le bilan.
- Produire systématiquement un rapport final, même en cas d’échec ou de blocage :
  objectifs, contexte, chronologie et ids, preuves, chemin retenu, pistes écartées,
  incertitudes, impacts/remédiations justifiés, limites et ressources à nettoyer.
  Écrire dans le dossier autorisé si un outil le permet, sinon fournir le rapport
  dans le fil sans prétendre avoir créé de fichier.

Un outil absent, refusé ou en échec est signalé ; il n’est ni inventé ni contourné.
Le mode apprentissage et la lecture seule restent sans écriture. Un arrêt immédiat
est respecté, sans nouvelles actions pour finir un rapport.

Les animations suivent les états et données réels. Le rejeu est local et manuel.
Le rapport Markdown de l’agent ne peuple pas automatiquement les cartes de
l’aperçu : celui-ci reste un brouillon issu des notes, avec gravités « À évaluer »,
sans identifiants ni loot. Aucun outil de PDF/SysReptor ou de commande graphique
supplémentaire n’est créé par ces consignes.

Ce contrat est une instruction fournie au modèle. Il ne crée pas un verrou du
moteur imposant un appel de note après chaque commande et ne garantit pas à lui
seul l’obéissance de chaque modèle. Les tests vérifient son injection, y compris
à la reprise ; ils ne constituent pas un benchmark d’obéissance en mission réelle.

## Ce que la méthode demande

- Cadrer l'objectif, sa preuve, le scope, le contexte, les résultats attendus
  et l'usage éventuel de solutions publiques spécifiques au challenge.
- Revenir de la collecte à l'évaluation et aux tests à chaque nouvel état,
  jusqu'à la preuve, au rapport et au nettoyage autorisé.
- Maintenir un registre de mission : faits sourcés et datés, hypothèses,
  contradictions, branches écartées, ressources actives, prochaine dépendance.
- Vérifier les préconditions volatiles et l'instrument avant de conclure à
  l'échec d'une hypothèse. Après un timeout, consulter le travail réel avant
  toute relance ; utiliser les tâches supervisées pour les opérations longues.
- Choisir des tests minimaux qui départagent des explications concurrentes.
  Modifier une variable nommée et préciser ce qui invaliderait l'hypothèse.
- Après **deux échecs sur une branche ou 25 minutes sans fait nouveau**, faire
  un bilan : relire les preuves, vérifier les prémisses, envisager d'autres
  explications et classer les prochains tests par gain d'information et coût.
- Chercher aussi à rebours depuis l'objectif, remettre en cause une supposition
  non testée et combiner des faits confirmés. Toute piste créative reste bornée,
  vérifiable et dans le périmètre.
- Mettre à jour la Kill Chain au fil des faits confirmés, préserver les preuves
  et distinguer résultat partiel, réussite démontrée et soumission confirmée.
  Trois stockages distincts : les notes Kill Chain (graphe d'attaque : hôtes,
  identifiants, sites, étapes, butin ; états hypothesis, confirmed, failed ;
  liens `from` entre faits établis), la matrice `record_coverage` (surfaces
  testées et leur état) et le registre de conversation (point de reprise).

Une hypothèse peut guider un test ; elle ne doit pas être présentée comme un
fait. Un blocage suspend une branche, sans arrêter automatiquement la mission.
La méthode évite aussi le travail rituel : les contrôles récents encore valables
se réutilisent, les réponses simples restent simples et l'apprentissage reste
en lecture seule. Le registre appartient à la conversation courante ; aucune
nouvelle mémoire partagée entre conversations n'est créée par cette livraison.

## Portée et validation

Ces règles sont des instructions au modèle. Le seuil de diagnostic n'est pas
un minuteur du moteur ; le registre et les bilans ne sont pas produits par un
automate. Les contrôles d'approbation écrits en code restent seuls responsables
des autorisations. Le modèle peut encore mal suivre une règle ou manquer une
piste : la réussite d'un challenge Hard ne se déduit pas des tests logiciels.

Claude reçoit le skill dans son contexte système et via `SubagentStart`.
Le serveur OpenCode lancé par Warband charge un `SKILL.md` temporaire constant
dans ses instructions communes, pour le parent et les sous-agents, sans écraser
leurs rôles. Le fichier ne contient aucun état de mission et est retiré à la
fermeture normale ou en erreur ; un arrêt brutal peut laisser ce texte constant
dans le répertoire temporaire. Le mode OpenAI utilise ce même adaptateur.

Un serveur OpenCode **externe** fourni par un appelant de la bibliothèque
reçoit la méthode dans le prompt de la session Warband. Sa configuration globale
n'est pas modifiée : la propagation à ses propres sous-agents n'est pas garantie.
L'extension utilise le serveur géré et bénéficie de la propagation commune.

Les tests vérifient l'injection, les reprises, les rôles conservés, le mode
lecture seule et la suppression du fichier temporaire. Un contrat optionnel
avec le vrai binaire OpenCode et un fournisseur simulé local vérifie le texte
effectivement envoyé au parent et à un sous-agent, sans inférence facturée.
Ils ne mesurent pas la qualité du raisonnement du modèle sur une box HTB.
