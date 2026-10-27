# ADR 0027 — Pages de journaux et image complète de la Kill Chain

Statut : accepté et implémenté pour la 0.3.52. Lecture, décision et revue dans
la session principale, conformément à la demande de travailler sans sous-agents.

## Problème

ChatState évince les éléments au-delà de 300 ; le Monitor masquait ensuite tout
sauf les 200 dernières commandes de cette fenêtre. La relecture d'une conversation
accumulait tous ses événements en mémoire puis ne conservait que les 300 derniers
éléments. Un journal de run était limité aux 16 premiers Mio. Le Monitor rendait
aussi un chat invisible, et toutes les sorties de cartes repliées avaient un DOM.

## Décision

- Conserver 300 éléments par page et une fenêtre active indépendante ; consulter
  les pages antérieures depuis les journaux existants. Aucun second journal,
  cache persistant de messages ou fichier utilisateur n'est créé.
- Associer chaque élément à sa source `runId/id` ; le curseur est choisi côté
  session. La webview envoie uniquement older/newer/latest, jamais un chemin,
  un run ou un identifiant de conversation pour cette navigation.
- Lire chaque journal par blocs de 64 Kio, sur un instantané de taille. Les UUID,
  événements et appartenance au run sont revalidés ; les lignes de plus d'un
  million de caractères sont ignorées. La lecture complète ne conserve aucun
  tableau global d'événements. Le contrat optionnel `JournalFiles.scan` laisse
  fonctionner les anciens hôtes qui fournissent seulement `read` borné.
- Relire aussi les résultats tardifs des outils de la page. Une page antérieure
  ne crée aucune approbation ; les approbations affichées restent celles du
  moteur actif. Changer de page n'arrête pas ce moteur et ne change pas le
  contexte envoyé au fournisseur. Une révision invalide toute lecture périmée.
- Garder la rétention existante (100 conversations / 200 Mio cumulés, conversation
  active protégée). Une suppression ou une sortie déjà tronquée n'est pas
  reconstituable. Les notifications locales sans événement ne sont pas archivées.
- Le Monitor affiche les 300 commandes possibles de la page. Ses messages ne
  transportent plus le Markdown ni le catalogue ; il ne rend pas le chat caché.
  Les cartes repliées créent leur détail à l'ouverture, les nœuds inchangés sont
  réutilisés, et les caches ne dépassent pas la page affichée. Les tables de
  corrélation de processus sont nettoyées à la fin et à l'éviction.
- Regrouper sorties de processus et réflexion toutes les 100 ms maximum, sans
  retarder les approbations, erreurs, résultats ni fins de tour. Aucun délai
  d'exécution ou de réflexion du modèle n'est ajouté.
- Générer l'image SVG côté hôte à partir des trouvailles du projet actif, sans
  accepter de SVG fourni par la webview. XML échappé, pas de script, HTML ou
  ressource externe. Disposition complète par couches avec cartes de hauteur
  variable, noms complets et lignes vertes persistées, même hors cadrage/filtre.
  Un dialogue natif choisit le fichier ; projet et documents non enregistrés
  sont recontrôlés avant écriture. Tous les types sont présents, uniquement les
  libellés et métadonnées du graphe (pas les sorties brutes ni champs de secrets).

## Limites

Une lecture de page parcourt les journaux de la conversation ; aucun index
persistant ni moteur de virtualisation supplémentaire n'est introduit. Une
optimisation plus large des runtimes d'agents, d'Electron ou de Docker n'est pas
incluse. Le gain du rendu simulé ne prédit pas la RAM totale de VS Code Windows.
