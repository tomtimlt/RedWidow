# Warband

Chat d'agent avec approbation de chaque outil. Voir `docs/extension-vscode.md` du dépôt warband.

## Accès rapide (sans palette de commandes)

- **Barre d'état** : « 🚀 Warband » ouvre le lanceur ; l'élément du conteneur lié ouvre un terminal.
- **Barre de titre du chat** : terminal, nouveau chat, cockpit, réglages en un clic.
- **Raccourcis** (macOS : `Ctrl+J` au lieu de `Alt+J`) :

| Raccourci | Action |
| --- | --- |
| `Alt+J Alt+J` | Lanceur : fenêtres Warband et un terminal par conteneur démarré |
| `Alt+J T` | Terminal Exegol |
| `Alt+J C` | Chat latéral |
| `Alt+J N` | Nouveau chat dans l'éditeur |
| `Alt+J K` | Cockpit |
| `Alt+J M` | Monitor |
| `Alt+J S` | Réglages |

Jeton : « Warband : définir le jeton ».

Dans **Configurer**, choisir Claude, **OpenAI (ChatGPT / API)** ou OpenCode,
puis **Configurer la connexion**. OpenAI accepte l’abonnement ChatGPT par
OAuth Codex via OpenCode ou une clé API stockée dans le coffre de VS Code.
Changer de fournisseur conserve la conversation et son projet : une nouvelle
session SDK reçoit les messages utilisateur/assistant du fil courant, masqués
et bornés, sans rejouer les outils ni leurs approbations.
Les modèles sont découverts à la connexion ; après 45 secondes au plus,
un échec permet de réessayer ou de configurer la connexion dans le popover
de modèle. OpenAI/OpenCode proposent uniquement les variantes de raisonnement
annoncées par le modèle au runtime ; **Auto** laisse son choix par défaut.
Les six crans Claude et le préréglage Ultracode restent propres à Claude.

Le cockpit propose VPN et bureau web pour Exegol, une image Kali complète
construite localement, la progression des téléchargements et la suppression
des conteneurs avec confirmation. Les dossiers hôtes et volumes sont conservés.

OpenCode 1.19.0 est embarqué sous licence MIT ; sa licence figure dans
`third-party/opencode-LICENSE` du paquet.

Recherche web : les agents disposent de `search_web` et `read_url` pour consulter
les informations récentes et GitHub, avec sources et date de consultation.
Recherche Exa publique sans clé ; lecture textuelle de pages publiques.

## Version 0.3.63 — mission courante et preuves

Bureau de mission commun aux moteurs : contexte sourcé à la demande, décisions courtes, méthodes par thème et conseils de déblocage. Aucun corpus d’anciennes sessions n’est injecté. La palette propose la capture et la consultation des preuves du projet, l’aperçu du contexte ajouté au dernier tour et l’export Attack Flow des étapes marquées confirmées. Les outils de tâches JSON sont additifs ; max_parallel borne réellement les tâches actives, les budgets de branche restent indicatifs.
