# ADR 0024 — tâches longues dans les conteneurs

Statut : accepté, 26 octobre 2026, demande du propriétaire.

Les appels MCP synchrones peuvent expirer alors que leur commande continue.
Augmenter leur délai ne fournit ni état fiable ni annulation.

## Décision

Exposer `task_start`, `task_list`, `task_status` et `task_cancel` dans les
toolsets Kali et Exegol, pour les trois fournisseurs. Un superviseur Python 3
dans le conteneur lance un argv sans shell implicite, puis rend immédiatement
un identifiant. Les appels suivants sont courts ; ils ne relancent pas la commande.
Python 3 est déjà un prérequis de l’image Kali Warband et d’Exegol.

La cible et le projet sont revérifiés à chaque appel ; le projet ne vient
jamais du modèle. L’état autoritaire est privé au conteneur, séparé par une
empreinte du projet. Les résultats sont dans un dossier unique sous
`/workspace/outputs`. Les chemins et identifiants sont contrôlés, les liens
symboliques refusés et les écritures effectuées via des descripteurs de dossiers.
Le lancement reste soumis à la gate : les règles de refus applicables à
l’exécution synchrone restent prises en compte, et un lancement est au mieux
une demande non mémorisable hors Bypass. L’annulation passe aussi par la gate.

Durée par défaut : une heure, maximum 24 heures. Sorties capturées : 32 Mio
au total, puis arrêt explicite `output_limit`. Chaque consultation retourne
au plus 8 Kio par flux, avec tailles et indication de troncature. Huit tâches
actives et 500 tâches conservées au maximum par projet/conteneur.

L’annulation est une demande au superviseur, jamais un PID fourni par le modèle.
Il termine le groupe de la commande (TERM puis KILL). L’état final distingue
réussite, échec, annulation, durée dépassée, sortie trop volumineuse et interruption.
Un superviseur absent ou remplacé ne permet jamais de conclure au succès.

## Cycle de vie et limites

La tâche survit à la fin du tour, au changement de fournisseur et à la fermeture
du chat ; son délai continue de s’appliquer. Arrêter le chat ne l’annule pas.
L’arrêt du conteneur interrompt la tâche : elle n’est jamais reprise
automatiquement. Les descendants qui créent leur propre session et un arrêt
brutal du superviseur ne permettent pas une garantie de nettoyage absolue.
Les fichiers produits directement par la commande, hors des flux capturés,
ne sont pas plafonnés. Aucun pourcentage de progression n’est inventé.

Les tâches ne réinjectent pas les messages des anciennes conversations.
La liste ne révèle pas leurs anciennes consignes ; elle donne les états et
les chemins de résultats du projet explicitement consulté. Pas de nouvelle
page de réglages : les outils et leurs résultats restent dans le fil du chat.
