# Warband 0.3.63 — livraison locale

Cette version réunit les onze idées retenues. Elle est préparée sur la branche
`temp/0.3.63-agent-solo`. Le dépôt et les tags distants restent à publier après
revue de l'utilisateur. La publication 0.3.62 précédemment bloquée est distincte.

| Choix | Réalisation |
| --- | --- |
| A01, A02 | Décision courte sourcée, sélection de contexte et méthodes par thème à la demande |
| A03, A04 | Outils de tâches JSON additifs ; anciens appels conservés ; observations structurées du bureau |
| A06 | Répétitions, erreurs et diagnostic de stagnation ; pas de sanction du simple suivi d'une tâche |
| A07 | Recherche GitHub guidée par une lacune précise, documentation/version/tests ; outils web existants |
| A08 | Conseils ciblés sur erreurs, troncatures et répétitions ; aucun modèle de secours caché |
| A09 | Budget de branche indicatif, compteur de tâches et vrai plafond `max_parallel` (1–8) |
| C01 | Captures explicites, preuves masquées, empreintes, rattachement atomique et consultation |
| C02 | Recherche lexicale du run courant, sélections expliquées et aperçu du paquet ajouté au dernier tour |
| I01 | Export Attack Flow 2.0.0 / STIX 2.1 des étapes marquées confirmées et liens retenus |

A05 est exclue : aucun corpus de sessions anciennes, aucune solution de référence
générique et aucune mémoire implicite entre conversations.

## Utiliser les nouveautés

- Palette : capturer la sélection de l'éditeur ou un extrait du terminal Warband,
  puis rattacher la preuve à une trouvaille. Les captures restent dans le projet.
- Palette : lister les preuves du projet pour consulter les captures non rattachées.
- Kill Chain : consulter les preuves liées et exporter Attack Flow.
- Palette : voir le contexte de cette mission pour inspecter le paquet du dernier
  tour et les observations plus récentes. Les tokens ne sont pas estimés.
- Agent : `mcp__desk__mission_context`, `mcp__desk__record_decision`,
  `mcp__desk__load_skill` avec `section`. Les schémas exposés font foi.
- Tâches : `task_status_json`, `task_list_json` et `task_start.max_parallel`.

## Construire et vérifier

Node >=22.12, pnpm 10.28.0. Depuis la racine :

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm --filter @warband/vscode package linux-x64
pnpm --filter @warband/vscode package win32-x64
```

La cible Windows nécessite les distributions natives optionnelles correspondantes.
Si elles manquent : `pnpm install --frozen-lockfile --os=win32 --cpu=x64` avant son
packaging. Construire les deux cibles séquentiellement. Le packaging recompile
désormais les dépendances workspace avant tout bundle.

Le script `pnpm release:local` automatise contrôles, compilation, empaquetage,
SHA-256 et archive des sources courantes sans dépendre de GitHub Actions. Il exige
`tar` et les distributions natives des deux cibles déjà installées. Le dossier
de sortie est annoncé par le script. Il n'effectue aucun push ni publication.

## Vérifications et limites à annoncer

Les tests logiciels ne sont pas un benchmark comparant les modèles. Aucun appel
d'inférence facturé n'est nécessaire. La recette manuelle native VS Code et
Windows, les applications MCP réelles et l'import Attack Flow Builder doivent
être distingués des tests et de la validation de schéma. Le contrôle des archives
confirme leur contenu et les empreintes natives, pas leur exécution sur Windows.

## Publication manuelle après réception

Vérifier les quatre fichiers : VSIX Linux et Windows, chacun accompagné de son
SHA-256. Le tag `v0.3.63` doit viser les sources exactes du paquet et correspondre
au manifeste. Une archive de sources, les notes et les résultats de contrôle
accompagnent la livraison. Une branche temporaire locale ne crée aucun tag.

Après commit/push autorisés et création du tag, créer une release GitHub puis
joindre les quatre fichiers via le navigateur. Vérifier les noms et empreintes
avant de publier. Si un brouillon existe, le compléter ; ne pas déplacer un tag
existant. L'upload CLI 0.3.62 avait échoué HTTP401 sur uploads.github.com ; cette
version ne prétend pas corriger l'authentification du service ou sa facturation.
