# Choisir une méthode pour l’agent

Les profils orientent la façon de travailler de l’agent, quel que soit son
fournisseur ou son modèle. Ouvre **Réglages → Contrôle système** pour activer les
méthodes proposées, puis sélectionne un profil dans le menu **+** du chat. Le choix
concerne cette conversation et s’applique au prochain tour. Une nouvelle conversation
repart sans méthode spécialisée. Les méthodes sont suspendues en mode Apprentissage.

| Profil | Utile pour | Résultat recherché |
| --- | --- | --- |
| Mentor | Comprendre un concept ou dépasser une difficulté | Un indice adapté, une tentative de l’apprenant, puis une vérification de compréhension |
| Bug bounty | Examiner une application dans un programme défini | Un constat reproductible, un impact démontré et un rapport exploitable |
| Out of the box | Sortir d’une piste qui tourne en rond | Des hypothèses distinctes et une observation qui permet de les départager |
| Red Team — Expert | Évaluer un objectif d’exercice et les défenses associées | Des résultats et de la télémétrie corrélés, dans les règles d’engagement |
| Hack The Box | Progresser sur un laboratoire ou un challenge | Une prochaine investigation justifiée et une résolution comprise |

## Comment ils aident

Un résumé du seul profil choisi accompagne la conversation. L’agent peut charger
la méthode détaillée, ou seulement une section utile, avec `load_skill`. Il ne
reçoit pas les cinq méthodes complètes à chaque message. Les références externes
embarquées restent consultables explicitement, avec leur provenance.

Chaque profil couvre l’objectif, le cadrage, le déroulement, les blocages, les
preuves et la clôture. La priorité est de réduire une incertitude utile : un
résultat nouveau peut justifier une nouvelle piste ; un test répété sans
information nouvelle demande une réévaluation. Un problème d’environnement ou
un timeout ne devient pas automatiquement une conclusion sur la cible.

Le Mentor respecte le niveau d’aide demandé : indique par exemple « un premier
indice seulement » ou « explique toute la correction ». Le profil HTB ne consulte
pas implicitement une solution du challenge. Le profil Red Team — Expert distingue une
action observée, une alerte et une réponse défensive : l’absence de télémétrie
ne permet pas de conclure à une absence de détection.

Les profils utilisent les outils disponibles et les autorisations de la mission.
Le mode **Apprentissage** reste consacré aux cours et aux éléments que tu fournis,
sans exécution ni écriture. Le profil Mentor ne remplace pas cet interrupteur.

## Ce qui est vérifié

Les tests logiciels contrôlent la sélection du profil, le chargement ciblé, les
limites de contexte et la cohérence des fichiers embarqués. Ils ne mesurent pas
la qualité des réponses d’un modèle. La [grille d’évaluation](profils-evaluation.md)
permet de comparer les modèles sur les mêmes situations et de relever leurs
erreurs sans publier de secrets ni de solutions de challenges actifs.

Le profil Expert garde l’identifiant `red-team`. Ses modules à la demande couvrent la recherche technique, l’applicabilité des CVE, les hypothèses discriminantes et les preuves de concept. La création autorisée d’un artefact ne vaut pas autorisation de l’exécuter ; modèle, effort et permissions restent ceux choisis.
