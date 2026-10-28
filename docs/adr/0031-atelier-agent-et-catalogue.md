# ADR 0031 — Atelier agent et catalogue de connecteurs

Statut : accepté pour la 0.3.62. Décision, implémentation et revue dans la session
principale, sans délégation conformément à la préférence utilisateur.

Le dossier partagé est l’unité de travail : aucune migration automatique de VS
Code dans Kali, aucun montage Docker changé silencieusement. La préparation ne
supprime et n’écrase rien. La disposition native conserve les éditeurs existants.
Le Monitor sépare sa chronologie du défilement des commandes et conserve un repère
sélectionné avec aria-pressed. Trois actions principales sont dans navigation.

Le cœur garde uniquement les définitions de connecteurs, schémas et outils
neutres ; le transport reste dans l’extension. Aucun SDK MCP ajouté au cœur.
Le catalogue fermé ne lit pas une commande MCP depuis le dépôt. Paramètres
utilisateur machine par UUID ; quatre services au maximum, transport local avec
origine verrouillée, redirections interdites, échéances et sorties bornées.
Les logiciels tiers, licences et comptes restent des prérequis explicites.
Chaque pont est soumis à la gate et non mémorisable. Le Bypass n’est pas modifié.
L’Apprentissage n’expose aucun de ces services.

Les sources de skills sont épinglées et licenciées séparément, pas exécutées ni
chargées dans tous les prompts. Cinq profils courts composent une méthode adaptée
à la mission ; l’accès aux textes upstream passe par un outil en lecture seule.
Le journal et les preuves priment sur les résumés. Les fichiers locaux se lisent
par pages sous la racine du projet, sans chargement intégral ni accès externe.

Voir [atelier-agent.md](../atelier-agent.md) pour les chemins de configuration,
les licences, la phase de réflexion sur le bureau du modèle et les limites de
recette. Les services absents ne sont jamais annoncés comme installés ou testés.
