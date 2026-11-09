# Choisir une méthode pour l’agent

Les profils orientent la façon de travailler de l’agent, quel que soit son
fournisseur ou son modèle. Ouvre **Réglages → Contrôle système** pour activer les
méthodes proposées, puis sélectionne un profil dans le menu **+** du chat. Le choix
concerne cette conversation et s’applique au prochain tour. Une nouvelle conversation
repart en **Pentest**, le mode normal sans document préalable. Les méthodes sont suspendues en mode Apprentissage.

| Profil | Utile pour | Résultat recherché |
| --- | --- | --- |
| Mentor | Comprendre un concept ou dépasser une difficulté | Un indice adapté, une tentative de l’apprenant, puis une vérification de compréhension |
| Bug bounty | Examiner une application dans un programme défini, au rythme que ses règles permettent | Les règles citées, une matrice de couverture, des négatifs contrôlés et un rapport généré depuis le journal |
| Pentest (par défaut) | Tester rapidement avec les accès disponibles | Notes, constats et preuves |
| Red Team — Expert | Évaluer un objectif d’exercice et les défenses associées | Des résultats et de la télémétrie corrélés, dans les règles d’engagement |
| Hack The Box / CTF | Progresser sur un laboratoire ou un challenge | Une prochaine investigation justifiée et une résolution comprise |

## Documents exigés

| Profil | Documents validés avant les actions opérationnelles |
| --- | --- |
| Pentest | Aucun |
| Hack The Box / CTF | Aucun |
| Bug bounty | Fiche programme |
| Red Team — Expert | Fiche d’engagement et plan de campagne |
| Mentor | Aucun |

Les lectures de documentation et la préparation restent disponibles pour rédiger
les documents nécessaires. Les documents manquants produisent un refus de politique
non mémorisable ; le Bypass conserve son contrat. La validation propre à
`http_request` continue d’exiger la fiche en Bug bounty, y compris sous Bypass.
Les protections universelles (gate, arrêt d’urgence, rythme par groupe d’IP)
restent actives ; une fiche programme validée reste appliquée dans tout profil.
L’identifiant interne `out-of-box` est conservé pour les préférences existantes,
avec le libellé **Pentest**.

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

Le profil Bug bounty suit sa propre méthode en onze sections, dans cet ordre : `regles`, `rythme`, `impact`, `phases`, `fiches`, `couverture`, `negatifs`, `waf`, `recherche`, `preuves`, `rapport`.

- **Règles** : carte du programme citée avant toute requête. Aucun interdit n'est inventé : contourner le WAF n'est interdit que si le programme l'écrit, et toute contrainte non citée est « auto-imposée ».
- **Rythme adaptatif** : rythme du programme s'il existe ; sinon environ une requête par seconde, une à la fois, sans parallélisme. Au premier 429, 403 de WAF ou timeout, pause de 60 s puis débit divisé par deux, avec remontée progressive ; arrêt et signalement au premier ban. Un script séquentiel bridé est permis (une requête à la fois, arrêt automatique au premier 429, 403 ou timeout, sortie enregistrée).
- **Impact et phases** : usage normal de l'application, cartographie, puis chasse depuis l'impact éligible ; reconnaissance passive sans trafic vers la cible, code partagé entre hôtes testé sur chacun d'eux.
- **Fiches** : une phrase par fiche, au format fixe « Fiche <type> : vérification ; vérification. », pour sept types de paramètres (identifiant, URL ou hôte, fichier ou chemin, email/téléphone/OTP, texte réaffiché, nombre, corps de requête) et cinq fonctionnalités (recherche ou filtre, flux à code, lien envoyé par email, upload, export).
- **Couverture et négatifs** : matrice surface × paramètre × classe × état tenue avec `record_test` ; un négatif exige un contrôle positif et deux variantes ; un 403 du WAF reste « bloqué, non réfuté » ; une anomalie n'est fermée qu'après trois variantes.
- **Preuves et rapport** : preuve minimale expurgée, validation avant constat (preuve objective et reproductible, rejouée avec un contrôle, sinon « piste qualifiée »), rapport généré depuis la matrice et relu contre les contradictions.

Le profil Bug bounty exige une fiche programme validée. Le moteur applique son
périmètre, son suffixe User-Agent et son rythme à `http_request` ; il conserve la
matrice structurée avec `record_coverage` et les essais avec `record_test`.
Hors Bug bounty, cet outil reste disponible mais la couverture n’est pas exigée.

Le profil Expert garde l’identifiant `red-team` : c’est une émulation d’adversaire autorisée, strictement encadrée par défaut, avec un point de contrôle humain à chaque phase. Il suit neuf sections, dans cet ordre : `engagement`, `menace`, `reconnaissance`, `plan`, `infrastructure`, `execution`, `opsec_journal`, `preuves`, `cloture`.

- **Engagement et menace** : la fiche d’engagement validée par empreinte est citée avant toute exécution (briques de l’ADR 0041 : fiche d’engagement, gate, arrêt d’urgence, plan de campagne, journal, clôture). L’adversaire crédible et ses techniques ATT&CK viennent de sources datées, par la recherche web commune ; aucune chaîne offensive n’est préécrite.
- **Reconnaissance** : surface cartographiée dans le périmètre ; OSINT borné aux rôles et informations professionnelles publiques, vie privée exclue, minimisation.
- **Plan et infrastructure** : plan de campagne validé par l’humain avant toute exécution ; infrastructure limitée à celle déclarée, tout achat ou compte engageant l’utilisateur étant une demande exécutée par lui.
- **Exécution, journal, preuves** : une étape du plan à la fois via `record_step` avec preuve, rythme et arrêt d’urgence respectés ; journal de campagne et déconfliction avec la white team ; preuve minimale, validation avant constat, résultats avec `record_test` et journal de campagne.
- **Clôture** : démontage obligatoire via `record_teardown` (tous les éléments cochés) avant de clore, rapport généré depuis le journal et la Kill Chain, rejeu avec les défenseurs (purple team).

La création autorisée d’un artefact ne vaut pas autorisation de l’exécuter ; modèle, effort et permissions restent ceux choisis. Ces consignes guident le modèle ; le moteur applique la gate et les contrôles de l’ADR 0041.
