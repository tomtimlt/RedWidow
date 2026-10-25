# ADR 0021 — Création complète et suppression humaine des conteneurs

- Statut : accepté pour le lot 0.3.30
- Date : 2026-10-25
- Complète les ADR 0012, 0014 et 0018.

## Contexte

La création doit fournir un environnement exploitable tout en laissant à
l’humain les options réseau, VPN, ressources et suppression. Une image Kali
minimale préparée uniquement pour MCP ne fournit pas toute la suite de mission.
Un nom Docker peut être réutilisé pendant une confirmation de suppression.

Repères : `packages/vscode/src/logic/exegol-create.ts`,
`packages/vscode/src/logic/container-remove.ts`,
`packages/core/src/docker/image-progress.ts`,
`packages/core/src/docker/client.ts` et `packages/core/src/project.ts`.

## Décision

- Créer Exegol par arguments structurés dans un terminal interactif après
  vérification des options de la CLI installée. Choisir workspace et VPN par
  dialogue natif ; accepter `.ovpn`, `.conf` ou un dossier sans lire les
  secrets VPN dans la webview. Exiger NAT pour le VPN. Lier le bureau web
  optionnel au loopback (6080 par défaut). Rendre explicites les partages et
  activer `--log`, avec méthode `script` si disponible. Refuser les options
  impossibles plutôt que lancer une configuration différente.
- Construire localement `warband/kali:complete-1` depuis
  `kalilinux/kali-rolling:latest`, avec `kali-linux-headless`, Python,
  `mcp-kali-server`, subfinder/httpx/nuclei et les utilitaires nécessaires,
  sans recommandations APT. Le tag local n’est pas une image publiée.
- Lire le flux de pull du démon local pour les couches, octets et vitesses ;
  permettre l’annulation. Utiliser la CLI pour les contextes distants.
  Afficher l’état de construction distinctement du téléchargement.
- Créer les nouveaux Kali avec `json-file`, `max-size=10m`, `max-file=3` ;
  conserver stdin et TTY, le bind `/workspace` et la commande de l’image.
- Réserver la suppression du cockpit à une action humaine avec confirmation
  native de l’identité, de l’état, de la perte des fichiers internes et des
  projets associés. Revérifier l’état et l’ID complet après confirmation,
  puis supprimer par ID (force si actif). Conserver volumes, images et
  dossiers hôtes. Nettoyer ensuite associations et principal dans les projets ;
  signaler séparément un nettoyage partiel.

## Alternatives écartées

- Simuler un téléchargement de l’image locale : aucun dépôt ne la publie.
- Installer toute la suite au premier scan : durée et mutations imprévisibles
  dans le parcours agent ; la préparation reste pilotée par l’humain.
- Supprimer seulement par nom : risque de viser un conteneur homonyme recréé.
- Supprimer les volumes avec le conteneur : perte de données non demandée.

## Conséquences et validation

La construction exige du réseau, du temps et de l’espace pour ses couches.
L’image rolling n’assure pas une reconstruction identique dans le temps.
La rotation des logs ne s’applique pas rétroactivement aux conteneurs existants.

La construction complète réelle et un pull Alpine via l’API Docker ont réussi.
Le démarrage de l’image complète reste non validé : le stockage cloud de
32 Go, avec Docker `vfs`, était insuffisant pour cet essai. Les parcours
Windows/VS Code, VPN et bureau Exegol restent à valider. Les contrôles
finaux et leur périmètre figurent dans l’état du projet après exécution.
