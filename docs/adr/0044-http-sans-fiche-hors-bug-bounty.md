# 0044 — HTTP sans fiche hors Bug bounty

Statut : accepté — décision utilisateur du 9 novembre 2026 (lot 23).

La fiche programme ne correspond pas aux missions générales, HTB et pentest.
Son absence bloquait pourtant toutes les requêtes `http_request`.

Le profil fixé par le moteur exige cette fiche seulement en Bug bounty.
Toute fiche validée reste appliquée dans les autres profils : périmètre par
la gate, rythme et suffixe User-Agent. Sans fiche, le contrôleur utilise le
rythme Normal et regroupe les hôtes par IP ; sans projet, il vit en mémoire.
Les approbations, leur mémorisation et le Bypass conservent leur contrat.
Sans fournisseur moteur de contexte HTTP, l’outil reste fermé.

Un engagement reste facultatif pour HTTP. Ses exclusions explicites sont
vérifiées dans l’outil avant transport, y compris après DNS et attente ;
l’arrêt d’urgence est relu au même endroit et une erreur de lecture ferme
l’accès. Les hôtes simplement hors engagement conservent la demande de la
gate. Cette vérification des exclusions complète la gate pour HTTP sans
modifier le comportement des outils shell.

Validation : tables de profils, approbation mémorisée, suffixe conservé,
rythme Normal et groupes IP, arrêt persistant, exclusions avec et sans
Bypass, arrêt déclenché pendant DNS ou attente, transmission du profil par
le moteur VS Code. Aucun nouvel élément visuel, icône ou jeton de couleur.
