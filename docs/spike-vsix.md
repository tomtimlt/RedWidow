# Spike E1 : empaquetage du `.vsix` (ADR 0004)

Reproduire : `pnpm build` puis `pnpm --filter @john-studio/vscode package [cible]` (défaut `win32-x64`). Rien n'est publié ; les artefacts (`packages/vscode/.vsix-stage/`, `*.vsix`) sont ignorés par git.

## Résultats (Windows 11, win32-x64, SDK 0.3.299)

- **Bundle esbuild** : le moteur (`src/engine/diagnostic.ts`, avec `@john-studio/agent-sdk`, `core`, le SDK et ses dépendances) donne un seul `engine.mjs` de 1,32 Mio (format ESM : le SDK utilise `import.meta` ; un `require` est fourni en en-tête). L'extension (`extension.cjs`, `vscode` externe) fait 2,6 Kio. Les paquets du workspace sont résolus par leur `dist/` : `pnpm build` est un prérequis.
- **Binaire natif trouvé** : oui. Le paquet optionnel `@anthropic-ai/claude-agent-sdk-win32-x64` est le voisin du SDK dans le store pnpm ; le script le copie dans `bin/claude.exe`. Le `.vsix` contient exactement ce binaire (et son `claude.sha256`), aucun autre.
- **Taille** : `claude.exe` = 256,8 Mio ; `.vsix` = **116,8 Mio** (compressé), 270 Mo décompressé. Le SDK ne fournit pas de binaire plus petit. `vsce` avertit que le fichier est volumineux (sans effet bloquant).
- **Empreinte SHA-256** : calculée à l'empaquetage (`295b49ec…df2b` pour 0.3.299) et écrite dans `bin/claude.sha256`. Au démarrage, le moteur la recalcule en flux et la compare (`src/logic/integrity.ts`, fail-closed). Coût mesuré : moins d'une seconde pour le moteur complet (vérification + `claude --version`) à chaud.
- **Exécution** : `node engine.mjs .` depuis le dossier décompressé affiche `binaire vérifié, version : 2.1.299`. Avec un octet ajouté à `claude.exe` : `extension.binaryMismatch`, code de sortie 1.
- `createSdkRunner({ executable })` fixe `pathToClaudeCodeExecutable` ; la même clé passée via `sdkOptions` est ignorée (test).

## Non fait / non vérifié

- **Installation réelle** (`code --install-extension`) et commande « john : diagnostic » dans VS Code : non exécutées (session non interactive, profil VS Code de l'utilisateur). À faire en E6 ou à la main.
- `fork` sous Electron avec `ELECTRON_RUN_AS_NODE=1` : non testé (le moteur a seulement été lancé avec Node). Reste la zone « à surveiller » de l'ADR.
- Cible `linux-x64` : non construite ici (paquet optionnel absent sur ce poste Windows) ; le script prend la cible en argument.
- Le diagnostic lance `claude --version` mais pas encore un run avec `QueryFn` factice (lot E2).
- `vsce-sign` et `esbuild` ont des scripts d'installation ignorés par pnpm 10 : sans effet pour ce spike (binaires natifs via paquets optionnels).
