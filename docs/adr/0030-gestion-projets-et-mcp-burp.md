# ADR 0030 — Gestion des projets et connexion MCP Burp

Statut : accepté et implémenté pour la 0.3.61. Lecture, décision et revue dans
la session principale, conformément à la demande de travailler sans sous-agents.

## Gestion des projets

La page Projet permet de renommer ou retirer la fiche sélectionnée, y compris
inactive, indépendamment de l’activation de son dossier. Le nom est choisi dans
une saisie native, pas fourni par une webview. Le renommage conserve UUID, dossier,
conteneurs, état actif et données. Le cœur écrit atomiquement avec ses validations.

La suppression utilise removeProject : fiche retirée, aucun effacement de dossier,
conteneur, note, trouvaille ou journal. Si la fiche était active, activeId devient
null ; aucun autre projet n’est activé et le dossier VS Code reste ouvert. Les
conversations conservées ne sont jamais réattribuées à un autre projet.

L’hôte refuse les modifications pendant un tour, verrouille les opérations de
projet et utilise une confirmation native pour le retrait. Après le dialogue,
il revalide le panneau, la confiance, la génération, le travail en cours et la
fiche relue. Une annulation ou un contexte périmé n’écrit rien. L’ancienne action
unlink de la webview utilise également ce parcours confirmé ; son bouton ambigu
« Délier le conteneur affiché » est retiré.

## MCP Burp Suite

Le serveur officiel PortSwigger est un programme externe installé et démarré
par l’utilisateur dans Burp. Warband ne lance ni Java, ni commande de configuration
arbitraire. Connexion désactivée par défaut, paramètres machine utilisateur seuls :
port entier, SSE /sse ou Streamable HTTP /mcp, exclusivement sur 127.0.0.1.
Aucun réglage de dépôt ne peut activer le serveur. Le transport réel est celui du
serveur installé ; aucune tentative automatique de rejouer un appel d’outil.

Le transport MCP est dans l’extension et dépend du SDK MCP déjà utilisé par les
adaptateurs. Le cœur garde seulement les définitions DockerToolSpec et un contrat
de backend injecté, sans dépendance au SDK MCP. Les deux adaptateurs exposent les
mêmes outils in-process : list_tools pour les noms/schémas réels, call_tool pour
l’appel explicite. Ce pont évite de figer les versions du catalogue Burp. Il ne
permet ni URI, ni commande, ni méthode JSON-RPC arbitraire dans les arguments.
Le mode Apprentissage garde uniquement ses outils de cours.

Les appels passent par la gate existante, avec le nom Burp et les arguments
visibles. La politique plafonne call_tool à ask, même face à un allow global,
et conserve les deny. Aucune mémorisation session/toujours sur ce multiplexeur :
un accord ne couvre pas tous les outils Burp. Le Bypass conserve son contrat
existant (Asker, durée, journal et absence de mémorisation). list_tools est en
lecture seule et permis par la politique par défaut. Le test natif ne fait
qu’une initialisation et une découverte, jamais tools/call ni appel au modèle.

Toutes les requêtes du transport, endpoint SSE et métadonnées compris, restent
sur l’origine locale configurée ; redirections refusées. Une connexion par appel,
fermée dans finally, échéance globale 20 s et requêtes 15 s. Réception bornée à
1 Mio, arguments 64 Kio, catalogue 128 Kio et résultat textuel 32 Kio ; troncature
signalée, contenu non textuel non transféré. Les erreurs ne recopient pas les
corps sensibles et précisent qu’un timeout ne prouve pas l’arrêt dans Burp.

Les réglages sont propagés au prochain moteur sans changer l’identité du fil.
Désactiver Burp arrête le tour actif pour couper ses outils ; une nouvelle consigne
recrée le moteur sans Burp. Le projet ouvert dans Burp reste choisi dans Burp :
aucune association implicite avec le projet Warband ni autorisation de cible.
Les résultats et arguments rejoignent le journal et son masquage habituel.

## Validation et limites

Tests de relecture et annulation, préservation des données de projet, paramètres
machine et IPC strict, reconstruction de moteur, transport MCP réel sur serveurs
factices SSE/HTTP, bornes, endpoint hostile, annulation et non-mémorisation. Tests
Chromium des contrôles réels sur trois thèmes. Aucun appel au modèle ni serveur
Burp réel disponible dans le cloud : l’installation et le test sur le poste de
l’utilisateur restent nécessaires. Les actions longues doivent être suivies dans
Burp ; cette intégration ne crée pas de task_list pour des opérations Burp.
