# ADR 0026 — chemin retenu de la Kill Chain

Statut : accepté, 27 octobre 2026, demande du propriétaire ; annotation autonome
par l'agent et correction possible par l'utilisateur.

Une trouvaille gagne `pathFrom?: string[]`, sous-ensemble de ses parents `from`.
Ce champ marque les liens du chemin retenu ; il ne change ni état, ni causalité,
ni preuve. Les anciens fichiers restent valides. La lecture refuse un marquage
mal formé. Retirer un parent ou supprimer un nœud retire ses marques devenues
invalides. Les écritures utilisent le verrou et le remplacement atomique déjà
en place pour les trouvailles, sans nouvelle mémoire partagée entre conversations.

L'outil `mcp__exegol__mark_path` prend seulement un id et les ids `pathFrom` ;
il n'accepte aucun projet, chemin de fichier ou patch arbitraire du modèle. Le
projet vient des cibles du moteur et les parents doivent exister. Il ne lance
aucune commande, ne requiert pas de conteneur et ne fournit aucune capacité
réseau. La gate l'autorise par défaut pour cette annotation réversible, selon
la demande d'autonomie ; une règle explicite de refus garde priorité. Les
écritures de notes et les exécutions conservent leurs contrôles. Le mode
Apprentissage n'expose pas ce toolset. Les deux adaptateurs le construisent à
partir de la même spécification. La consigne méthodologique demande sa mise à
jour au fil des découvertes et au bilan.

Le panneau permet de sélectionner un lien et de modifier son marquage. Aucun
vert optimiste : il attend les données relues après écriture. L'hôte revalide
le projet actif, la génération et l'existence du panneau avant le commit. La
mutation d'un seul lien fusionne le marquage courant sous verrou pour ne pas
effacer un changement concurrent de l'agent. Les filtres et la sélection sont
des états locaux à la vue, remis à zéro au changement de projet.

Revue effectuée dans la session principale, sans revue indépendante ni
sous-agent conformément à la demande utilisateur. Critères : refus d'un lien
absent ou hors parents, concurrence, nettoyage des liens, isolation du projet,
refus prioritaire de politique, absence d'exécution, absence de changement
implicite d'état, et parcours clavier/réactif dans Chromium.
