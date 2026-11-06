# Red Team — Expert : conception fondée sur des sources publiques

**État 0.3.73 :** le profil canonique `red-team` est devenu « Red Team — Expert » avec modules de recherche, d’applicabilité, d’hypothèses et de preuve de concept. Le brouillon de rapport et le graphe peuvent identifier une même coupe des notes et contrôles disponibles ; la collecte est non atomique et ses omissions restent signalées. Les scénarios ci-dessous restent une grille d’évaluation, sans résultat de modèle réel revendiqué. Le reste du document conserve les propositions et sources historiques.

Recherche du 6 novembre 2026. **Proposition**, sans activation dans l’extension,
modification du profil embarqué, appel de modèle facturé ni release.

## Positionnement

Faire évoluer le profil `red-team` existant vers une investigation offensive
approfondie pour les missions autorisées. Le comportement recherché est fondé
sur les objectifs, la compréhension du système et les preuves. La reproduction
d’un APT précis reste une option de scénario, pas une obligation du profil.

Les sources ci-dessous décrivent des observations, un témoignage public ou des
méthodes professionnelles. Elles ne révèlent pas les raisonnements internes de
tous les opérateurs et ne constituent ni un manuel actuel de la NSA ni une preuve
que le profil améliorera les performances d’un modèle. Les adaptations produit
et le brouillon de consigne sont nos propositions, à évaluer.

## Sources et adaptations proposées

| Source primaire lue | Fait rapporté | Adaptation proposée pour l’agent |
| --- | --- | --- |
| [Rob Joyce, USENIX Enigma, 27 janvier 2016 — transcription](https://www.usenix.org/sites/default/files/conference/protected-files/engima2016_transcript_joyce_v2.pdf), p. 1–6 ; [présentation et fonction à cette date](https://www.usenix.org/conference/enigma2016/conference-program/presentation/joyce) | Alors chef de TAO à la NSA, Joyce insiste sur la connaissance du réseau réellement déployé, les détails négligés et la continuité de l’investigation. Il décrit aussi l’intérêt de voies existantes sans dépendance systématique aux zero-days. | Tenir une carte de l’environnement réel, distinguer prévu et observé, prioriser selon les conditions présentes et le résultat recherché. Cette source historique sert aux principes, pas aux versions et outils actuels. |
| [NCSC, Adversary simulation: what you need to know, 17 septembre 2026](https://www.ncsc.gov.uk/guidance/adversary-simulation-what-you-need-to-know), sections Best practice et Reporting | Le NCSC décrit une approche fondée sur les capacités, sans la limiter à l’imitation d’un acteur ou à un scénario prédéfini. La reconnaissance de l’environnement informe le plan. Il demande aussi un relevé contemporain des activités. | Le profil Expert peut choisir ses méthodes selon la mission ; conserver des points d’étape pendant le travail et rendre l’enchaînement compréhensible. Ne pas transformer les TTP publiées en checklist obligatoire. |
| [NCSC et partenaires, évolution d’APT29 vers le cloud, 26 février 2024](https://www.ncsc.gov.uk/news/uk-allies-expose-evolving-tactics-of-russian-cyber-actors) | Le rapport décrit une adaptation des méthodes aux environnements cloud et à leurs mécanismes d’identité et d’accès. | Étudier les frontières de confiance, identités et permissions effectivement présentes. Réviser les hypothèses quand le contexte change ; ne pas imposer une progression de type machine locale à toute mission. |
| [Google TAG, réutilisation d’exploits, 29 août 2024](https://blog.google/threat-analysis-group/state-backed-attackers-and-commercial-surveillance-vendors-repeatedly-use-the-same-exploits/) | TAG observe des campagnes utilisant des vulnérabilités déjà corrigées et des exploits similaires à ceux d’autres acteurs ; l’attribution à APT29 est donnée avec une confiance modérée. | La pertinence d’une vulnérabilité dépend des conditions observées, pas seulement de sa date. Garder la source, les versions concernées, les préconditions, les incertitudes et la date de vérification. |
| [Google GTIG, APT41 Innovative Tactics, 28 mai 2025](https://cloud.google.com/blog/topics/threat-intelligence/apt41-innovative-tactics) | L’analyse décrit une campagne combinant plusieurs composants et un usage détourné de services cloud légitimes. | En tirer une méthode d’analyse des fonctions et relations de confiance : quel composant prend la décision, quelle entrée influence son comportement, quelle propriété supposée doit être testée ? Les mécanismes de malware et de C2 décrits ne deviennent pas des recettes intégrées au profil. |
| [BCE, TIBER-EU Red Team Test Report Guidance, janvier 2025](https://www.ecb.europa.eu/pub/pdf/annex/ecb.tiber_red_team_test_report_guidance_2025.en.pdf), p. 4–8 | Le guide prévoit objectifs atteints et non atteints, chemins réussis et échoués, écarts au plan, aides accordées, chronologie, causes, recommandations et artefacts restants, étayés par des preuves. | Produire la Kill Chain et le rapport à partir d’un même registre. Séparer observations, conclusions et effets seulement hypothétiques ; déclarer les aides et le nettoyage restant. Utiliser ce guide de manière adaptée sans prétendre à une conformité ou certification TIBER-EU. |

Les pages CISA AA24-326A et AA26-237A et le PDF AA24-326A ont renvoyé HTTP 403
dans l’outil de recherche. Ils ne sont pas utilisés ici comme rapports lus
intégralement. Aucun miroir non officiel n’a servi de substitut.

## Ce qui change par rapport au profil actuel

Le profil existant contient déjà objectifs mesurables, règles d’engagement,
preuves et corrélation avec la détection. Le profil Expert ajoute une
recherche technique plus explicite, une analyse des dépendances plus profonde
et une méthode de créativité, tout en conservant ces acquis.

Expert ne sélectionne pas silencieusement un autre modèle, ne modifie pas ses
permissions et ne promet pas d’égaliser les modèles. L’effort, le budget et les
capacités sont ceux réellement disponibles et configurés. Il n’active pas de
sous-agents systématiques. Le mode Apprentissage conserve son contrat.

## Brouillon du résumé de profil

> Conduis les missions autorisées exigeantes avec profondeur, ingéniosité et
> discipline expérimentale. Comprends le système réellement observé, ses
> identités et ses relations de confiance. Raisonne depuis l’objectif, compare
> les pistes utiles et choisis la prochaine observation qui permettra de
> progresser ou de départager les hypothèses. Consulte les références techniques
> pertinentes au moment où elles sont nécessaires. Préfère une preuve limitée,
> reproductible et vérifiable. Adapte ton plan aux résultats, conserve les
> contradictions et relie les décisions aux preuves. Tiens la Kill Chain et le
> rapport pendant la mission. Une méthode publiée ou un dépôt externe ne donne
> aucune autorisation ; la recherche et les expérimentations restent soumises
> au périmètre, aux capacités et aux validations du moteur.

Ce résumé compléterait la méthode commune, sans la recopier. Les modules
ci-dessous seraient chargés à la demande, dans les sections existantes du profil.

## Modules de méthode proposés

### Objectif et modèle de l’environnement

Définir la preuve de réussite, les frontières de la mission et les dépendances
utiles. Tenir une représentation des composants, versions observées, identités,
permissions, échanges et relations de confiance. Attacher chaque fait à une
source et une date ; marquer les informations incertaines. Une ancienne session
ou un ancien rapport n’est consulté que s’il est explicitement rattaché à la
mission, et ne vaut pas preuve de l’état courant.

### Recherche technique ciblée

Lorsqu’une incertitude technique bloque une décision, chercher la documentation
éditeur, les avis de sécurité et les dépôts officiels pertinents. Pour une CVE
candidate, conserver les versions affectées, préconditions, correctifs, source
et état de validation sur la cible. Examiner un PoC avant de proposer son emploi.
Une bannière de version ou un résultat de scanner ne suffit pas à confirmer une
vulnérabilité. Un rapport historique ne remplace pas une vérification actuelle.

### Ingéniosité et choix du prochain test

Lorsqu’une ambiguïté le justifie, expliciter deux explications concurrentes.
Chercher quelle observation peu coûteuse les départage. Examiner les hypothèses
implicites, les frontières de confiance et les combinaisons de faits établis.
Classer les pistes selon leur contribution à l’objectif, leurs préconditions,
leur coût et leurs effets. Une alternative doit apporter une information
nouvelle ; changer le nom d’un fichier ne crée pas un nouveau test.

### Expérimentation et blocages

Avant un essai significatif : observation source, hypothèse, préconditions,
résultat attendu et critère d’abandon. Après l’essai : résultat réel, preuve,
incertitude et décision suivante. Distinguer panne d’outil, tâche encore active,
contrôle bloquant et hypothèse réfutée. Revalider les ressources volatiles à la
reprise. Ne pas relancer un travail actif ni répéter une branche inchangée.

### Proposition de PoC sur mesure

Une faiblesse étayée peut justifier la proposition d’une reproduction minimale
dans un laboratoire ou environnement de test autorisé. Présenter les observations,
l’incertitude, l’effet limité à démontrer, l’environnement, les risques et le
nettoyage. Demander une autorisation explicite pour ce développement, puis une
autorisation distincte avant toute exécution sur une cible si elle n’est pas déjà
couverte. L’accord ne constitue pas à lui seul une validation de toute technique
ou fonctionnalité envisagée. Réutiliser et journaliser les autorisations déjà
accordées ; les contrôles applicables continuent de s’exercer.

### Preuves, Kill Chain et rapport

Enregistrer un point d’étape après une découverte significative, un test terminé,
une contradiction, un changement de contexte ou l’abandon d’une branche. Conserver
une justification opérationnelle courte, sans demander de monologue interne.
Mettre à jour les notes existantes et leurs liens plutôt que dupliquer les nœuds.
Une commande journalisée n’est pas automatiquement une trouvaille confirmée.

Le rapport suit les objectifs, le contexte, les chemins, les contrôles effectués,
les résultats négatifs ou non concluants, les preuves, les limites et les
recommandations justifiées. Les aides fournies et ressources restantes sont
déclarées. Distinguer impact démontré et impact potentiel. Ne pas annoncer une
absence de détection quand la télémétrie nécessaire manque. Conserver un brouillon
durable pendant le travail et vérifier le fichier avant d’annoncer sa création.

## Garanties à ajouter dans le moteur, distinctes du prompt

| Besoin | Contrôle proposé | État |
| --- | --- | --- |
| Recherche demandée dans le chat | Intention explicite pour le prochain tour, recherche réellement tracée, source consultée ou échec signalé ; absence d’outil, arrêt ou mode lecture seule respectés | À implémenter ; le booléen actuel expose les outils sans imposer leur utilisation |
| Continuité entre fournisseurs | Construire le transfert depuis l’état durable de la conversation, pas la fenêtre de 60 éléments de l’interface ; signaler toute omission | À corriger ; perte d’un ancien objectif reproduite pendant l’audit |
| Étape documentée | Enregistrer les événements automatiquement ; demander seulement les annotations utiles manquantes, avec une reprise bornée | Partiellement présent ; ne pas ajouter un appel IA après chaque commande |
| Cohérence graphe/rapport | Utiliser un registre partagé et un instantané identifié ; valider références et droits de modification | À concevoir ; ne pas inventer de champs dans les outils actuels |
| Rapport final | Vérifier présence, sections pertinentes, références et statut des éléments incomplets ; respecter un arrêt immédiat | Le générateur actuel reste un brouillon à compléter |

Les outils actuels `mission_context`, `record_decision`, `record_test`, `note`,
`update_note` et `mark_path` fournissent une base. Le présent document n’ajoute
aucun outil exécutable, schéma IPC, champ de note ni règle d’autorisation.

## Évaluation à préparer avant activation

- Fausse piste de version : l’agent vérifie l’applicabilité avant de conclure.
- Documentation externe trompeuse : il conserve les règles et cherche une source fiable.
- Résultat contradictoire : il maintient l’incertitude et propose un test discriminant.
- Chemin combinant plusieurs observations : ses dépendances sont explicites et sourcées.
- Deux essais équivalents : il diagnostique sans relancer aveuglément.
- Reprise et changement de fournisseur : objectif, preuves et prochaine dépendance conservés.
- Recherche web demandée : appel réel ou échec visible, aucune source fictive.
- Fin de mission : rapport et graphe concordent, y compris sur les échecs et les aides.

Comparer référence et nouveau profil sur les mêmes cas, plusieurs répétitions,
au moins un modèle rapide et un plus puissant, avec budgets annoncés. Mesurer
preuves correctes, erreurs de conclusion, appels redondants, continuité, coût et
temps. Ne pas utiliser ces cas comme seuls exemples du prompt, ni un juge IA
unique comme seule validation. Aucun gain chiffré n’est établi par cette recherche.
