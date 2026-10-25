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
