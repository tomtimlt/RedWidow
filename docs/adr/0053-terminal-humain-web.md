# 0053 — Terminal humain dans l'interface web

- Statut : accepté
- Date : 2026-11-12

## Contexte
L'interface web de RedWidow Serveur (ADR 0052) propose des fenêtres de terminal que l'utilisateur ouvre lui-même pour travailler dans un conteneur Kali ou Exegol. Ce terminal n'est pas un outil de l'agent : la gate d'approbation, qui encadre les appels d'outils de l'agent, ne s'y applique pas. L'utilisateur veut que tout y soit journalisé.

## Décision
1. **Ouverture depuis le web seulement**, par une session authentifiée, dans un conteneur Kali/Exegol géré par RedWidow. Jamais un shell de l'hôte ni du conteneur serveur.
2. **Mécanisme** : exec Docker avec `Tty: true` par l'API Engine (socket de l'hôte, côté serveur seulement), sans `node-pty`. Environnement de l'exec en liste blanche (`safeEnv`). Une session terminal survit 60 s à une coupure de la WebSocket, puis est fermée.
3. **Hors gate, par construction** : c'est une action humaine directe. La gate reste l'unique autorité sur les outils de l'agent ; rien de ce terminal n'alimente la mémorisation des approbations ni la politique.
4. **Journalisation complète** : chaque session écrit un journal `term-<id>.jsonl` sous `runs/`, en passant par le recorder (masquage des secrets connus avant écriture). Nouveaux événements : `terminal.opened` (conteneur, taille), `terminal.data` (sens `in`/`out`, morceaux bornés), `terminal.resized`, `terminal.closed` (code, durée).
5. **Arrêt d'urgence** : il arrête les agents (ADR 0041) et ne coupe pas les terminaux humains ; l'interface affiche l'état d'arrêt dans chaque fenêtre de terminal.

## Conséquences
- Le journal contient ce que l'utilisateur tape, y compris un mot de passe saisi à la main s'il n'est pas un secret connu du coffre. C'est assumé (demande de l'utilisateur) et rappelé dans l'interface.
- Les journaux de terminal grossissent vite ; les morceaux sont bornés et la rotation suit celle des journaux de mission.
- Nouveaux `kind` d'événement : validateurs et `KIND_CLASS` de l'export HTML à compléter.
