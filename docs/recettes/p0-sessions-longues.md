# P0 — sessions longues, en attente du go utilisateur

Branche : `temp/p0-long-sessions`, base `76cfb53` (0.3.72).
L’utilisateur autorise les P0 uniquement : aucune release, publication ou P1.
La version du manifeste reste inchangée pendant cette préparation.

## Changements

- Audit : retrait du journal de commandes et de ses filtres de la vue de réglages.
  Les traces sur disque et l’export ne sont pas supprimés. Registre des contrôles
  paginé à 25 entrées, brouillons conservés par projet/test.
- Le chargement Audit de cette vue utilise un aperçu compact : lecture de 4 Mio
  maximum et aucune trace brute envoyée à la webview. Les limites d’aperçu restent
  signalées. Le lecteur d’export conserve son fonctionnement antérieur.
- Chat et Monitor : fenêtre de travail en mémoire de 60 éléments au lieu de 300.
  La pagination relit les journaux ; le contexte du moteur n’est pas réduit par
  cette fenêtre d’affichage. Les approbations restent séparées de la pagination.
- Réutilisation des groupes d’outils et des nœuds inchangés ; évite de détacher
  tout le chat et le Monitor à chaque rafraîchissement.
- Historique fermé : aucune reconstruction de sa liste. Le menu des ressources
  n’est reconstruit que lorsque ses choix, les verrous ou la langue changent.
- Chat caché : conserve seulement la dernière vue reçue et la rend au retour.

## Vérifications

`pnpm check` : 2 263 tests réussis, 14 ignorés, aucun échec, types valides.
Biome : aucune erreur, 180 avertissements et 8 conseils.
Le premier lancement sans les permissions réseau nécessaires a échoué sur les
fixtures locales ; la vérification finale utilise les permissions adaptées.

Les tests de pagination parcourent les 905 éléments sans trou ni doublon et
vérifient les résultats tardifs ; navigation pendant un tour avec approbation
conservée, retour au direct et relecture après réouverture contrôlés.

Recette Chromium sur les scripts de production, avec CSP :
- 1 000 contrôles d’Audit, seulement 25 formulaires rendus, navigation entre pages ;
- absence de liste de commandes, qualification opérateur, brouillon, pause/reprise
  et export ZIP réel ; FR/EN, thèmes sombre/clair/contraste élevé ;
- charge synthétique de 10 000 appels d’outil et leurs résultats de 12 000 caractères,
  fenêtre de 60 éléments, chat/Monitor et réutilisation des nœuds ;
- menus, palette, Apprentissage et Bypass contrôlés dans la même recette.

Les recettes et leurs sorties sont dans `/tmp/p0-*-browser.mjs`,
`/tmp/p0-*-browser.log` et `/workspace/work/p0-*-preview/` dans cet environnement.
Aucun appel IA facturé. Il reste à valider une session native prolongée Windows
et Linux et à mesurer la mémoire dans ces conditions. Ce test synthétique ne
constitue pas une mesure d’endurance de deux heures ni une garantie d’absence de
plantage pour toutes les missions.

Le prompt du terminal et le workspace Docker partagé sont réservés au P1 après
nouvelle instruction de l’utilisateur.
