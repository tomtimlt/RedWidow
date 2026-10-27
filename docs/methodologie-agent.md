# Méthode commune des agents — 0.3.47

Warband transmet automatiquement le skill **Conduite vérifiable d'une mission**
aux agents Claude, OpenAI et OpenCode, quel que soit le modèle choisi, depuis
VS Code comme depuis la CLI. Il n'est pas nécessaire de le recopier dans la
consigne utilisateur ni de demander à l'agent de le charger. Il accompagne
également les reprises. Le [texte embarqué complet](../packages/core/src/methodology.ts)
est la source unique ; il ne contient pas de recette d'exploitation.

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
