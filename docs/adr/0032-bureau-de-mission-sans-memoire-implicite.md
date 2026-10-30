# ADR 0032 — Bureau de mission et preuves explicites

Date : 30 octobre 2026. Statut : accepté, implémentation locale 0.3.63.

## Décision

Chaque run exposant le bureau crée un `MissionDesk` dans le cœur. Il reçoit les
événements déjà masqués du recorder, conserve au plus 128 observations bornées et
prépare un contexte lexical autour de la décision courante. Les adaptateurs Claude
et OpenCode transmettent ce même contrat neutre et libèrent ses abonnements en
`finally`. Aucun SDK ni état global n'entre dans le cœur.

L'agent dispose de `mission_context` et `record_decision` en complément de
`load_skill`, dont l'option `section` sélectionne un thème. Une référence de
décision doit appartenir au run. Le paquet explique ses sélections et omissions ;
le JSON est délimité comme donnée sans autorité et les chevrons sont échappés.
L'IPC remonte le paquet effectivement ajouté au dernier tour pour consultation.

Le contexte n'importe aucun corpus d'anciennes missions ou de solutions génériques
(A05 rejetée). Une nouvelle instance démarre vide, y compris après changement de
fournisseur. Les preuves persistantes du projet sont capturées explicitement par
l'utilisateur et ne sont jamais automatiquement injectées dans une autre session.

## Progression et limites

Le bureau détecte les répétitions sans résultat nouveau et adapte ses conseils aux
erreurs ou aux sorties tronquées. Les budgets de branche sont **indicatifs** ; les
plafonds du runner restent ceux existants. `max_parallel` est, lui, réellement
contrôlé sous verrou par le superviseur des tâches (1 à 8). Les opérations de
suivi ne déclenchent pas à elles seules un diagnostic de stagnation.

Les états structurés `task_status_json` et `task_list_json` sont additifs. Les
anciens outils conservent leurs réponses. Les tâches observées ne constituent pas
un inventaire exhaustif des processus. Aucun code retour ne confirme à lui seul
un objectif de mission. Les recherches GitHub passent par les outils web déjà
exposés ; elles n'installent ni n'exécutent automatiquement de code découvert.

## Preuves et échanges

Les captures sont masquées avant empreinte et stockage atomique, sous verrou par
projet. Leur liaison à une trouvaille fusionne les références sous le verrou des
trouvailles. Une preuve non rattachée reste consultable dans la liste du projet.
Les captures de terminaux sont bornées à l'allowlist active et les captures de
fichiers au chemin réel relatif du projet. Les preuves remasquées signalent une
éventuelle troncature et distinguent empreinte enregistrée et empreinte affichée.

L'export Attack Flow produit un bundle STIX 2.1 / Attack Flow 2.0.0 validé contre
le schéma officiel. Il exporte les étapes **marquées** confirmées et les liens
retenus, exclut identifiants et loot, et décrit les omissions. La validation de
schéma ne constitue ni une preuve technique ni une recette dans le Builder.

## Autorisations et livraison

La politique par défaut autorise exactement les deux opérations locales du
bureau, sans exécution ni persistance. Les politiques utilisateur, la gate, le
Bypass ADR0017 et le mode apprentissage gardent leurs règles. Aucun outil de
bureau n'est ajouté au mode apprentissage.

Le packaging compile les dépendances workspace avant le bundle pour éviter
l'inclusion de `dist` périmés. Les cibles utilisent des stages distincts. La
0.3.63 est préparée sur une branche temporaire ; push, tag et publication attendent
la décision de l'utilisateur.
