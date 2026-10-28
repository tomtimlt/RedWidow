# Contrat de travail des agents — depuis la 0.3.57

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
