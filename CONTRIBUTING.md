# Contribuer à Venator Ops

Le projet portait auparavant le nom Warband. Le nom affiché devient Venator Ops ; les identifiants techniques (`warband.warband`, `warband.*`), les paquets et les chemins de configuration restent stables pour préserver les installations et les données existantes. Voir le [périmètre de la transition](docs/venator-ops.md).

Pour installer et utiliser l’extension, commence par le [README](README.md). Cette page concerne la modification du code et la construction des paquets.

## Préparer le dépôt

Prérequis : **Node.js 22.12 ou plus**, la version de **pnpm indiquée par `packageManager` dans `package.json`**, et Docker pour les essais de conteneurs.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` lance Biome, la vérification des types des sources et des tests, puis Vitest. Les tests de contrat qui appellent des fournisseurs réels restent facultatifs et peuvent être facturés : ne pas les lancer avec les vérifications ordinaires.

## Construire les VSIX

```sh
pnpm --filter @warband/vscode package linux-x64
pnpm --filter @warband/vscode package win32-x64
```

Les paquets sont créés dans `packages/vscode/`, avec la version de `packages/vscode/extension.manifest.json`. Chaque VSIX embarque les binaires correspondant à sa plateforme. Pour l’installer, utilise **Extensions → … → Installer à partir de VSIX…** dans VS Code.

Pour préparer une livraison locale complète :

```sh
pnpm release:local
```

Cette commande enchaîne vérification, compilation, empaquetage des deux plateformes, empreintes et archive des sources. Elle attend un fichier `docs/livraison-X.Y.Z.md` pour la version du manifeste. La procédure de commit, de brouillon GitHub et de transfert privé des artefacts est décrite dans la section Livraison d’[AGENTS.md](AGENTS.md#livraison). GitHub Actions n’est pas nécessaire à la construction locale.

## Se repérer dans le code

| Paquet | Responsabilité |
| --- | --- |
| `packages/core` | Événements, approbations, processus, Docker, projets, trouvailles et contrat d’agent |
| `packages/messages` | Traduction des codes du moteur |
| `packages/agent-sdk` | Adaptateur Claude |
| `packages/agent-opencode` | Adaptateur OpenCode |
| `packages/cli` | Interface en ligne de commande |
| `packages/export-html` | Export autonome du graphe |
| `packages/vscode` | Extension, interface et moteur embarqué |

Le cœur ne dépend ni d’un SDK d’agent ni d’une interface. Les adaptateurs implémentent le contrat commun ; les interfaces dépendent du cœur. Préserve l’approbation en code, le masquage des secrets, la vérification d’intégrité des binaires et les restrictions du mode Apprentissage.

## Essayer la CLI

Après compilation :

```sh
node packages/cli/dist/main.js --help
node packages/cli/dist/main.js agents
```

Les commandes et l’authentification sont détaillées dans le [guide CLI](docs/cli.md).

## Documentation technique

- [État du projet](docs/etat-du-projet.md) : inventaire et limites de validation ; vérifier le commit de référence.
- [Extension VS Code](docs/extension-vscode.md) : détails de l’interface et historique de ses évolutions.
- [Atelier agent](docs/atelier-agent.md) : fichiers, preuves et intégrations.
- [Sources de cours](docs/cours.md) : synchronisation des sources du mode Apprentissage.
- [Décisions d’architecture](docs/adr/README.md) : contrats et choix structurants.
- [Charte du chat](docs/design-chat-ui.md) : conventions visuelles.

Pour proposer une modification, explique le problème utilisateur, le comportement obtenu et les vérifications exécutées. Signale les essais non réalisés, notamment sous VS Code natif et Windows. Les contributions suivent la [licence MIT](LICENSE) du projet.

## Modifier une méthode d’agent

Les profils sont définis dans `packages/core/src/agent-profiles.ts`. Après une
modification, compiler avec `pnpm build`, puis régénérer les cinq fichiers avec
`node scripts/sync-agent-skills.mjs`. Le mode `--check` vérifie leur cohérence
sans écrire. Les tests contrôlent les budgets et le chargement ; la qualité
des réponses s’évalue séparément avec la [grille](docs/profils-evaluation.md).
