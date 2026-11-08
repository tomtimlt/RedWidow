# Décisions d'architecture (ADR)

Un ADR consigne une décision structurante : pourquoi ce choix, quelles alternatives, quelles conséquences. Rédigés par l'agent `architect` (voir `AGENTS.md`), numérotés dans l'ordre : `NNNN-titre-court.md`.

**Quand en écrire un** : nouveau paquet ou frontière entre paquets, API publique du cœur, format d'événement ou de journal, politique de sécurité et d'approbation, ajout d'une dépendance majeure, abandon d'une option déjà discutée.
**Quand s'en passer** : détail d'implémentation local, correction de bug, choix réversible sans conséquence.

Les décisions déjà prises avant ce dossier sont résumées dans `docs/architecture-issues.md` (garde unique `PreToolUse`, Bash retiré par défaut, politique de dépôt approuvée par empreinte, masquage dans le recorder, adaptateur SDK séparé, libellés dans `@warband/messages`, journal borné). Les ADR s'y réfèrent plutôt que de les répéter.

## Modèle

```md
# NNNN — Titre

- Statut : proposé | accepté | remplacé par NNNN | abandonné
- Date : AAAA-MM-JJ

## Contexte
Le problème, les contraintes (sécurité, compatibilité, coût), les faits établis (avec fichier:ligne).

## Décision
Ce qu'on fait, en une demi-page maximum.

## Alternatives écartées
Pour chacune : pourquoi pas.

## Conséquences
Positives, négatives, risques, ce qu'il faudra surveiller ou vérifier.

## Plan
Lots pour `dev` : objectif, fichiers, critères d'acceptation vérifiables.
```

## Décisions récentes

- [0019 — Conversations sans mémoire implicite](0019-conversations-sans-memoire-implicite.md) : remplace l’injection du résumé de l’ADR 0016 dans l’extension.
- [0020 — Fournisseurs OpenAI et OpenCode](0020-fournisseurs-openai-opencode.md) : authentification isolée, catalogue runtime, variantes et continuité du fil avec nouvelle session SDK (amendement 0.3.32).
- [0021 — Création et suppression des conteneurs](0021-creation-et-suppression-conteneurs.md) : Exegol interactif, image Kali locale complète et suppression confirmée par ID.

- [0022 — Suppression des trouvailles](0022-suppression-des-trouvailles.md) : suppression unique, détachement des liens et écritures coordonnées.

- [0023 — Recherche et lecture web](0023-recherche-et-lecture-web.md) : outils partagés, sources publiques et approbations conservées.

- [0024 — Tâches longues dans les conteneurs](0024-taches-longues-conteneurs.md) : supervision, résultats persistés et annulation.

- [0025 — Méthode commune aux agents](0025-methode-commune-agents.md) : skill permanent, état vérifié, preuves et réévaluation des branches.

- [0026 — Chemin retenu de la Kill Chain](0026-chemin-retenu-killchain.md) : annotation autonome des liens existants, distincte des preuves.

- [0030 — Gestion des projets et MCP Burp](0030-gestion-projets-et-mcp-burp.md) : fiches réversibles, connexion locale optionnelle et gate conservée.

- [0031 — Atelier agent et catalogue](0031-atelier-agent-et-catalogue.md) : dossier partagé, connecteurs isolés et skills à la demande.

- [0039 — Recherche web native pour les missions cyber](0039-recherche-web-native-missions-cyber.md) : recherche autorisée, lecture sur sources de référence, garde d'arguments et relances non bloquantes.

- [0040 — Fiche programme, périmètre et rythme vers les cibles](0040-fiche-programme-et-rythme-des-cibles.md) : fiche validée par empreinte, périmètre en `ask` par hôte, outil `http_request` rythmé, proxy sans interception reporté.
- [0041 — Fiche dengagement red team, plan de campagne et arrêt durgence](0041-engagement-red-team-et-arret-d-urgence.md) : engagement validé par empreinte, périmètre cible vs infrastructure déclarée, arrêt durgence non contournable, plan de campagne, journal.

Le statut accepté décrit la décision ; les preuves d’exécution et les limites
figurent dans [l’état du projet](../etat-du-projet.md).
