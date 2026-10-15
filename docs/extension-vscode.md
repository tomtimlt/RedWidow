# Extension VS Code : installation et usage

Extension privée (ADR 0004, lots E3 + E4) : chat d'agent dans VS Code, avec une carte d'approbation pour chaque outil demandé. Pas de Marketplace : le `.vsix` s'installe à la main. Cible construite et testée à la construction : `win32-x64`.

## Construire et installer

```
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @john-studio/vscode package        # cible win32-x64 par défaut
code --install-extension packages/vscode/john-studio-0.2.0-win32-x64.vsix
```

Le `.vsix` fait environ 117 Mio (il embarque le binaire `claude` du SDK, 257 Mio décompressé, vérifié par empreinte SHA-256 au démarrage du moteur). Il est ignoré par git.

## Premier run

1. Ouvrir un **dossier approuvé** (l'extension est inerte dans un espace non approuvé ou virtuel).
2. Palette de commandes : **John : définir le jeton**. Choisir « Jeton d'abonnement » (`claude setup-token`) ou « Clé API », puis coller le jeton (saisie masquée). Il est stocké dans le stockage sécurisé de VS Code, transmis uniquement à l'environnement du processus moteur, jamais écrit dans les réglages, un message d'erreur ou un journal. « John : effacer le jeton » le supprime. Sans jeton, le binaire utilise ses propres identifiants (mode `auto`).
3. **John : ouvrir le chat** (ou l'icône John de la barre d'activité). Saisir une consigne, `Ctrl+Entrée` ou « Envoyer ».
4. Le fil affiche le texte de l'agent (texte brut), les appels d'outils et leurs résultats (plafonnés à 2000 caractères). **Stop** annule le run ; le message suivant relance un moteur en reprenant la session. **Nouvelle conversation** repart de zéro.

## Cartes d'approbation

Chaque demande de la gate d'approbation devient une carte : outil, entrée (neutralisée : caractères de contrôle, séquences ESC et contrôles bidirectionnels retirés), raison de la politique. Boutons :

- **Autoriser une fois** ;
- **Refuser** ;
- **Toujours** : proposé seulement si le verdict est mémorisable (prédicat `isRememberable` du cœur : jamais pour un `deny`, un chemin sensible ou hors espace de travail, un accès hôte ou un danger shell). Exige une **confirmation modale native** de VS Code, hors webview. Effet actuel : autorisation **pour la durée de la conversation** (pour le bac à sable, c'est la sémantique voulue : conteneur éphémère). La persistance dans la politique utilisateur sur disque, comme `john run` le fait, n'est pas encore branchée.

Il n'y a ni « tout autoriser » ni mode autonome. La gate reste l'unique juge : la webview ne fait que relayer le choix.

## Réglages (`Fichier > Préférences > Paramètres`, section John)

Tous en scope **machine** : la valeur posée dans `.vscode/settings.json` d'un dépôt est ignorée (le code relit uniquement la valeur utilisateur ou le défaut).

| Réglage | Rôle |
|---|---|
| `john.model` | Modèle, texte libre. Vide : défaut du SDK. |
| `john.maxTurns` | Plafond de tours (0 : aucun). |
| `john.sandbox.enabled` | Active le bac à sable Docker (`mcp__sandbox__exec`). |
| `john.sandbox.image` | Image **locale** (obligatoire si activé ; jamais téléchargée). |
| `john.sandbox.timeoutSec` | Délai par exécution, 1 à 1800 s (défaut 600). |

Les réglages sont lus au démarrage du moteur : pour les appliquer, **Nouvelle conversation**.

## Tester le bac à sable

```
docker pull alpine:3.20
```

Puis activer `john.sandbox.enabled`, poser `john.sandbox.image` à `alpine:3.20`, ouvrir une nouvelle conversation et demander par exemple « exécute `uname -a` dans le bac à sable ». Une carte `mcp__sandbox__exec` apparaît. Le conteneur (réseau coupé, utilisateur non privilégié) est créé au démarrage du run et supprimé à la fin, à l'annulation et sur erreur. Docker Desktop doit être démarré.

## Limites connues

- **Non vérifié dans un VS Code réel** (voir ci-dessous) ; cible `linux-x64` non construite sur ce poste.
- Claude seul (pas d'OpenCode) ; texte brut, pas de Markdown.
- Pas de graphe en direct (E5), pas de commande d'approbation de la politique du dépôt (la politique du dépôt n'est appliquée qu'après approbation de son empreinte, comme dans la CLI ; sans approbation elle est inerte et un avertissement est affiché).
- « Toujours » ne persiste pas sur disque (voir plus haut).
- Une seule demande de tour à la fois ; l'historique affiché est limité aux 300 derniers éléments.
- Le journal du run est écrit dans `.john-studio/runs/` du dossier ouvert, comme la CLI.
- Réglages en scope machine : comportement en remote (SSH/WSL) à valider.

## Ce qui a été vérifié

Tests vitest : logique (cartes, mapping des réponses, validation des messages de la webview, réglages, état du chat, session avec contrôleur factice), HTML généré (CSP stricte, nonce, aucun script inline), script de la webview (aucun `innerHTML`/`eval`), manifeste (scope machine, espace non approuvé). Le `.vsix` se construit ; le moteur empaqueté démarre sous Node et atteint la création du bac à sable.

Non vérifié en vrai : installation `code --install-extension`, rendu de la webview, saisie masquée du jeton, `fork` sous Electron (`ELECTRON_RUN_AS_NODE`), run Claude complet depuis l'extension, bac à sable avec un démon Docker actif, comportement en espace non approuvé.
