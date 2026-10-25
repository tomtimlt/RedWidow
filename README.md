<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/vscode/media/logo.svg">
  <img src="docs/img/logo-clair.svg" alt="Logo Warband" width="96" height="96">
</picture>

# Warband

**Un assistant IA dans VS Code pour travailler dans tes conteneurs, avec approbation des actions et traces de mission.**

[![CI](https://github.com/tomtimlt/warband/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tomtimlt/warband/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-CC1C40.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-495F73.svg)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-495F73.svg)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/paysage-chat-sombre.png">
  <img src="docs/img/paysage-chat-clair.png" alt="Chat Warband sur grand écran, avec une carte d'approbation en attente" width="820">
</picture>

</div>

---

## Pourquoi Warband

Un agent IA qui lance lui-même des commandes de reconnaissance et d'exploitation dans un conteneur de pentest peut faire gagner beaucoup de temps en pentest, en CTF et en préparation de certifications, à condition de garder la main sur chaque action sensible.

Warband fait ça : les appels d'outil (exécution dans le conteneur, écriture, accès réseau) passent par une **gate d'approbation écrite en code**, pas laissée au bon vouloir du modèle. Chaque trouvaille (hôte, identifiant, étape, technique MITRE ATT&CK) est notée au fil de la conversation et alimente la **Kill chain**.

> **À utiliser uniquement dans un cadre autorisé** : CTF, labs de certification, engagement avec périmètre et accord écrit.

## Le parcours

**Choisir un projet → associer ses conteneurs → travailler avec l’agent → approuver les actions nécessaires → consulter les résultats et les traces.**

Le **cockpit** prépare les conteneurs et leurs associations ; le **chat** pilote
le travail et les approbations ; le **Monitor** suit les exécutions ; la **Kill
chain** rassemble les trouvailles. Le mode **Apprentissage** lit les cours sans
agir. Le Bypass est un choix explicite qui suspend les demandes d’approbation
pendant sa durée (voir Sécurité).

Pour distinguer ce qui existe et ce qui reste à terminer :
[état du projet](docs/etat-du-projet.md). Les ADR expliquent les décisions ;
ils ne constituent pas le guide d’utilisation.

## Fonctionnalités

**Un chat dans VS Code**
- Chat latéral ou dans l'éditeur, jusqu'à **quatre conversations** en parallèle.
- Sélecteur de **modèle** (liste fournie par le SDK au runtime) et curseur d'**effort** à six crans.
- **Historique** filtré par projet, relu depuis les journaux ; lecture seule ou reprise sous le même projet.
- Mentions : `@` pour citer un conteneur, `#` pour citer un terminal ouvert, `/` pour les commandes.
- Interface responsive de 280 px à plus de 900 px, thèmes sombre, clair et contraste élevé, mouvement réduit respecté.

**Pensé pour le pentest**
- L'agent exécute les outils de ton conteneur de pentest (`argv` sans shell, dans `/workspace`). La cible doit appartenir aux conteneurs autorisés du projet ; `@` permet de la préciser. Dans le chat, l’agent ne crée, n’arrête ni ne supprime aucun conteneur.
- **Résumé du projet** consultable et modifiable dans Réglages → Projet, réutilisé au début des nouvelles conversations.
- **Carnet de trouvailles** : hôtes, identifiants, sites, étapes, butin, avec un état (confirmé, hypothèse, échoué), la tactique et la technique **MITRE ATT&CK**, et les liens de causalité entre elles.
- Page **Kill chain** : le graphe interactif des trouvailles, en couches, avec zoom et déplacement.
- **Terminaux** de l'éditeur dans le conteneur ; `#` colle dans la consigne la sortie d'un terminal ouvert.

**Une approbation qui a du sens**
- Une carte par demande : outil, entrée neutralisée, raison de la politique. *Autoriser une fois*, *Refuser* ou *Toujours*, ce dernier sous confirmation native de VS Code et seulement quand c'est sûr.
- **Bypass** borné : pendant 2 h (4 h au plafond), approuve tout — y compris un `deny`, un chemin sensible ou un danger shell — sans jamais rien mémoriser, si un canal de réponse humain est fourni ; l’apprentissage et la CLI non interactive restent exclus (ADR 0017).
- **Mode Apprentissage** : l'agent lit des cours en lecture seule, explique et cite ses sources, et n'agit jamais.

**Un moteur traçable**
- Journal d'événements en JSONL, **graphe causal** exportable en HTML autonome.
- Secrets masqués avant tout enregistrement ; processus enfants lancés avec une liste blanche de variables.
- Outils **Docker structurés** (`ps`, `logs`, `inspect`, `run`…), chacun soumis à la politique.
- **Claude Agent SDK dans le chat VS Code**. La CLI propose aussi **OpenCode** (OpenAI, Gemini, Ollama, endpoints compatibles), derrière la même gate ; OpenCode n’est pas encore disponible dans le chat.

**Windows d'abord**
- Support natif, sans WSL. Les processus sont arrêtés proprement, arbre entier compris.

## Démarrage rapide

Prérequis : Node 22 ou plus, [pnpm](https://pnpm.io), VS Code 1.90 ou plus. Docker est nécessaire pour les outils de conteneur.

### L'extension VS Code

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @warband/vscode package        # cible win32-x64 par défaut
code --install-extension packages/vscode/warband-0.3.25-win32-x64.vsix
```

Raccourci : `pnpm maj` enchaîne mise à jour, build, empaquetage et installation.

Puis, dans VS Code, ouvre un dossier de confiance et :

1. **Warband : définir le jeton** (palette de commandes) : jeton d'abonnement (`claude setup-token`) ou clé API, stocké dans le stockage sécurisé de VS Code.
2. **Warband : ouvrir un chat** ou clique sur l'icône Warband de la barre d'activité.
3. Dans **Réglages → Projet**, active un projet ou crée-le (nom et dossier). Associe ensuite les conteneurs de travail dans le cockpit.
4. Écris ta consigne dans le chat. Hors Bypass, la politique décide des autorisations, demandes et refus.
5. Consulte les exécutions dans le Monitor et les trouvailles dans la Kill chain.

| Raccourci | Action |
| --- | --- |
| `Alt+J Alt+J` | Lanceur Warband |
| `Alt+J C` | Chat latéral |
| `Alt+J N` | Nouveau chat dans l'éditeur |
| `Alt+J K` | Cockpit |
| `Alt+J M` | Monitor |
| `Alt+J S` | Réglages |

### La ligne de commande

```sh
node packages/cli/dist/main.js run "liste les conteneurs arrêtés"
node packages/cli/dist/main.js policy check "docker ps -a | grep web"   # code 0 allow, 2 ask, 3 deny
node packages/cli/dist/main.js graph .warband/runs/<run>.jsonl -o run.html
node packages/cli/dist/main.js agents                                   # moteurs disponibles
```

Le guide complet de la CLI est dans [docs/cli.md](docs/cli.md).

## Sécurité

Ces règles ne s'affaiblissent pas :

- La **gate d'approbation est l'unique autorité**. Le hook `PreToolUse` du SDK décide ; le reste n'est qu'un filet qui refuse par défaut.
- Un `deny` de politique, un chemin sensible ou hors de l'espace de travail, un conteneur donnant accès à l'hôte et les dangers shell ne sont **jamais mémorisables**. Ils sont **contournables uniquement pendant un Bypass actif** (ADR 0017), sous la responsabilité de l'utilisateur.
- Les options du SDK qui touchent à la sécurité (mode de permission, outils, hooks, environnement…) sont **verrouillées** : un appelant ne peut pas les surcharger.
- Les secrets sont masqués avant d'atteindre un journal ; l'adresse e-mail du compte n'est jamais journalisée.
- **Bash est désactivé par défaut.**
- La politique d'un dépôt n'est appliquée qu'après **approbation de son empreinte**.
- L'extension vérifie l'empreinte SHA-256 du binaire embarqué avant de le lancer, et ses pages web ont une CSP stricte sans script en ligne.

Le détail est dans [docs/cli.md](docs/cli.md) et dans les [décisions d'architecture](docs/adr/README.md).

## Architecture

```
packages/
  core/            moteur : événements, journal, graphe, approbation (politique, gate, file), AgentRunner
  messages/        libellés (français complet, anglais minimal) pour les codes du moteur
  agent-sdk/       adaptateur du Claude Agent SDK, outils Docker
  agent-opencode/  adaptateur OpenCode
  cli/             interface en ligne de commande
  export-html/     rendu HTML/SVG autonome du graphe
  vscode/          extension VS Code (chat, cockpit, monitor, réglages)
```

Le cœur n'a aucune dépendance à un SDK d'agent et ne contient aucun texte d'affichage : il émet des événements typés et des codes, que les interfaces traduisent. Les interfaces dépendent du cœur, jamais l'inverse.

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/etat-du-projet.md](docs/etat-du-projet.md) | Parcours central, état des fonctionnalités et travaux restants |
| [docs/cli.md](docs/cli.md) | Moteur, approbation, authentification, OpenCode, Docker, CLI |
| [docs/extension-vscode.md](docs/extension-vscode.md) | Installation, usage et limites de l'extension |
| [docs/design-chat-ui.md](docs/design-chat-ui.md) | Charte visuelle : couleurs, formes, mouvement, logo |
| [docs/adr/](docs/adr/README.md) | Décisions d'architecture |
| [docs/cours.md](docs/cours.md) | Sources du mode Apprentissage |
| [docs/idees.md](docs/idees.md) | Idées en réserve |

## Développement

```sh
pnpm check   # biome + tsc (sources et tests) + vitest
pnpm build
```

Le CI exécute `pnpm check` et `pnpm build` sur Linux (Node 22 et 24) et sous Windows (Node 22).

## Statut

Projet personnel en développement actif. L'extension se distribue sous forme de `.vsix` à installer à la main (artefacts de release : `win32-x64` et `linux-x64`), pas encore sur le Marketplace. Elle n'a pas encore été éprouvée dans toutes les configurations de VS Code (remote, web) : voir les [limites connues](docs/extension-vscode.md#limites-connues).

## Licence

[MIT](LICENSE).
