# Protection du dépôt

Objectif : rien n'entre dans `main`, ne crée de tag ni ne publie sur le Marketplace sans l'accord du propriétaire.
Ces réglages se font dans GitHub (Settings) : ils ne sont pas dans le code. Le fichier `.github/CODEOWNERS` désigne le relecteur.

## 1. Règle sur `main` (Settings → Rules → Rulesets → New branch ruleset)
- Cible : `main`. Application : *Active*.
- Exiger une pull request avant fusion, avec 1 approbation, et *Require review from Code Owners*.
- Exiger que les contrôles passent (`check (22)`, `check (24)`, `windows`) avant fusion.
- Bloquer les push forcés et la suppression de la branche.
- Ne pas ajouter d'exception (bypass) pour les autres contributeurs.

## 2. Règle sur les tags (New tag ruleset)
- Cible : `v*`. Restreindre création, mise à jour et suppression. Seul le propriétaire (et l'application GitHub Actions, que le workflow Release utilise pour créer le tag) peut contourner.

## 3. Publication Marketplace derrière une approbation
- Settings → Environments → New environment `marketplace` : *Required reviewers* = le propriétaire, *Deployment branches* = `main` seulement.
- Déplacer le secret `VSCE_PAT` de « Repository secrets » vers les secrets de cet environnement.
- Puis le job de publication du workflow Release doit déclarer `environment: marketplace` (changement de `.github/workflows/release.yml`, à faire après la création de l'environnement et du secret).

## 4. Accès
- Settings → Collaborators : ne garder que les personnes nécessaires, en droit *Read* ou *Triage* tant qu'elles n'ont pas besoin d'écrire.
- Settings → Actions → General : *Require approval for all outside collaborators* et permissions du jeton en lecture seule par défaut.

## Conséquence sur le flux de release
Un push direct sur `main` est alors refusé : une release passe par une pull request approuvée par le propriétaire, puis le workflow Release publie après approbation de l'environnement `marketplace`.
