# ADR 0025 — méthode commune aux agents

Statut : accepté, 27 octobre 2026, demande du propriétaire.

## Contexte

Le benchmark utilisateur rapporte des échecs de vérification d'état et de
gestion des branches sur un challenge difficile. Une consigne saisie à la main
ou placée uniquement dans `AGENTS.md` ne couvre pas tous les moteurs Warband.
Une méthode doit rester indépendante des techniques, du modèle et du projet.

## Décision

Le cœur exporte une seule constante Markdown `AGENT_METHODOLOGY`. Les adaptateurs
l'injectent à chaque run, reprises comprises. La CLI et l'extension utilisent
ces mêmes adaptateurs. La méthode est proportionnée : mission itérative,
preuves contextualisées, hypothèses testables, diagnostic après deux échecs ou
25 minutes sans fait nouveau, alternatives discriminantes, suivi des tâches,
registre propre à la conversation et sortie sur preuves. Le mode apprentissage
et les réponses simples ne déclenchent pas de travail opérationnel.

Claude ajoute la méthode au preset système et au hook `SubagentStart`, avant
les hooks supplémentaires. OpenCode géré reçoit un fichier `SKILL.md` temporaire
via `config.instructions`, lu par toutes ses sessions, y compris filles. Le
texte n'est pas également dupliqué dans le champ `system`. Les rôles d'agents
existants restent intacts. Le dossier est créé par `mkdtemp`, le fichier en 600,
sans texte utilisateur, puis supprimé après fermeture du serveur, même en erreur.
Le sondage du catalogue ne crée pas ce fichier. Aucun état de conversation n'est
persisté par ce mécanisme. Un serveur externe reçoit seulement le prompt de
notre session ; sa configuration globale ne doit pas être modifiée.

## Alternatives et conséquences

Un skill seulement consultable à la demande peut ne jamais être chargé.
Remplacer les prompts de rôles intégrés supprimerait leurs consignes natives.
Augmenter les délais ou ajouter des recettes ne corrigerait pas la méthode.
La méthode embarquée ajoute du contexte à chaque inférence opérationnelle ;
elle ne garantit ni le respect du seuil ni le succès sur une cible. Aucun
nouveau contrôleur d'état, minuteur ou contournement de gate n'est introduit.

Validation : tests des deux adaptateurs (injection, reprise, apprentissage,
hooks/rôles préservés, nettoyage après erreur) et contrat OpenCode local qui
inspecte les requêtes parent/enfant. La qualité sur HTB reste à mesurer avec
des missions comparables ; les tests déterministes ne constituent pas ce benchmark.
