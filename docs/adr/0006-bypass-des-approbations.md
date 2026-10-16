# 0006 — Bypass des approbations

- Statut : accepté
- Date : 2026-10-16

## Contexte

La maquette validée prévoit un interrupteur « Bypass approvals » dans Configure (affiché « bientôt », rien de câblé : `docs/design-exegol-ui.md:12`, `:36`, `:77`). Contraintes :

- La gate est l'unique autorité ; `canUseTool` n'est qu'un filet fail-closed (`packages/agent-sdk/src/runner.ts:263`, `:410`). Le SDK tourne en `permissionMode: "default"` (`runner.ts:244`, `:483`), option verrouillée (`runner.ts:70-78`).
- La gate distingue déjà les verdicts « ask » mémorisables (`REMEMBERABLE`, `packages/core/src/approval/gate.ts:83-89`) et exclut les répertoires externes (`gate.ts:102`). `deny` de politique, garde-fous de chemin, accès hôte d'un conteneur et dangers shell ne sont jamais mémorisables (`gate.ts:29-33`).
- Le motif `policy.default` n'est pas seulement « aucune règle » : il sert aussi au plafonnement des répertoires externes (`packages/core/src/approval/policy.ts:327-330`, `:359-367`). Le test de répertoire externe de `gate.ts:102` est donc indispensable à tout prédicat fondé sur ce motif.
- Pour Bash, le verdict retenu est celui du segment le plus strict, le premier à égalité (`policy.ts:208`) : `ls && rm -rf x`, avec une règle `ask` sur `ls` seulement, rend `policy.rule` alors que `rm` seul rendrait `bash.noRule`. Dangers shell (`bash.hazard`) et `docker.hostAccess` sont évalués avant (`policy.ts:189-206`).
- Sans Asker, un « ask » est refusé (`gate.ts:204-209`). L'extension propose `once | deny | always` (`packages/vscode/src/logic/approval.ts:9`).
- `.vscode/settings.json` est contrôlé par le dépôt : tout réglage lu depuis la configuration de l'espace de travail est une entrée hostile.

## Décision

Décisions du propriétaire du produit : interrupteur on/off sans modale, 2 h par défaut et 4 h au maximum, règles `ask` explicites couvertes.

1. **Sémantique.** Le Bypass est une **auto-approbation `once`** décidée **dans la gate**, après `evaluatePolicy`, seulement si le verdict est `ask` et que `isBypassable(request, verdict, policy)` est vrai. Il ne mémorise rien et n'écrit aucune règle.
   - `BYPASSABLE = { "policy.default", "policy.rule", "policy.rule.custom" }` : l'absence de règle et les règles `ask` explicites (utilisateur, ou dépôt dont l'empreinte est approuvée ; une politique de dépôt non approuvée n'est pas chargée, donc ne produit aucune règle).
   - Toujours exclu, même si le motif appartient à `BYPASSABLE` : outil `EXTERNAL_DIRECTORY_TOOL` ou entrée portant `EXTERNAL_PATTERNS_FIELD` (même test que `gate.ts:102`).
   - **Bash** (garde contre l'élargissement de `bash.noRule` par un segment voisin, `policy.ts:208`) : bypassable seulement si `parseShell` réussit, sans danger, avec **un seul segment**, et si la règle appliquée (`verdict.rule`) porte un `command` dont le premier mot est littéral (sans `*`). Une règle `Bash ask` sans `command` ou en joker ne couvre rien : sinon elle rendrait `bash.noRule` bypassable.
   - **Chemins dans les arguments** (garde ajoutée par la révision du 2026-10-16) : `PATH_FIELDS` (`packages/core/src/approval/paths.ts:60-68`) ne couvre que Read, Write, Edit, MultiEdit, NotebookEdit, Grep et Glob ; Bash et les outils MCP ne passent pas par `checkPathAccess`, et jusqu'ici l'humain voyait la demande. Le Bypass n'est donc **pas accordé** si un argument Bash (mot issu de `parseShell`, cibles de redirection comprises) ou une chaîne quelconque de l'entrée de l'outil, lue en profondeur (objets et tableaux imbriqués), ressemble à un chemin (absolu POSIX, lettre de lecteur, segment `..`, préfixe `~`) et tombe sous `checkPathAccess` (sensible, hors espace de travail ou non supporté). La demande suit alors le chemin normal (`approval.requested`). Cette garde ne fait que restreindre le Bypass ; elle ne change aucun autre verdict.
   - Jamais bypassables, car hors `BYPASSABLE` : `deny` (règle ou garde-fou), `path.*`, `docker.hostAccess`, `bash.hazard`, `bash.unparseable`, `bash.empty`, `bash.missingCommand`, `shell.unanalyzable`, `sandbox.interpreter`, `bash.noRule`. Pas de plafond en nombre d'outils.
   - Sans Asker (mode non interactif), le Bypass est sans effet : le refus `approval.noAsker` reste. Le test est fait **avant** celui du Bypass.
2. **Portée et durée.** L'état vit en mémoire dans l'hôte de l'extension, **par fenêtre**. Il n'est jamais persisté (ni `globalState`, ni `workspaceState`, ni réglage). Il dure `BYPASS_DEFAULT_MS = 2 h` et n'excède jamais `BYPASS_MAX_MS = 4 h` (constantes exportées par `core`). Pas de réglage dans ce lot. Si un réglage est ajouté plus tard : `scope: "machine"`, lu par `inspect().globalValue` seulement (jamais `workspaceValue` ni `workspaceFolderValue`), borné à [1 min, 4 h] par l'hôte, valeur invalide ramenée à 2 h. Défense en profondeur : la gate traite comme inactif un état dont `expiresAt - since > BYPASS_MAX_MS`, ou dont `since > now`. L'état retombe à « off » à l'expiration, au rechargement de la fenêtre, au `reset` de la conversation et au changement d'espace de travail (`onDidChangeWorkspaceFolders`). La gate relit `current(now)` à chaque `decide` : une désactivation ou une expiration vaut dès la décision suivante.
3. **Activation.** Un interrupteur dans Configure, sans modale. La webview envoie `setBypass { enabled: boolean }`, sans autre champ (la durée n'est jamais fournie par la webview). L'hôte le valide dans `parseWebviewMessage` (liste blanche, objet strict, champ supplémentaire = rejet), puis l'applique. `enabled: true` n'est accepté que si la vue est visible ; `enabled: false` est toujours accepté. Aucune activation n'est possible par la politique (utilisateur ou dépôt), un réglage de l'espace de travail, une option du runner ou une variable d'environnement. La CLI n'expose aucun Bypass.
4. **Journal.** Nouveau `kind` `bypass.changed` `{ state: "on" | "off", reason: Reason, since?: number, expiresAt?: number }`, émis par la gate quand elle observe un changement à un `decide` (motifs `bypass.enabled`, `bypass.disabled`, `bypass.expired`) : un « off » à la transition on→off ; un « on » à la transition off→on **et** dès que les bornes (`since`, `expiresAt`) diffèrent de celles du dernier « on » émis (réactivation, prolongation), même sans « off » observé entre les deux. Le validateur exige `since` et `expiresAt` (nombres finis) quand `state` vaut « on ». Effet : tout journal qui contient une décision `source: "bypass"` contient avant elle un `bypass.changed` « on ». Chaque outil auto-approuvé produit un `approval.decided` `source: "bypass"`, motif `approval.bypassed` dont la cause est le motif d'origine du verdict (`policy.default`, `policy.rule`…), sans `approval.requested`. Aucun nouveau champ sensible ; le masquage reste celui du recorder.
5. **Modes et `permissionMode`.** `permissionMode` reste `"default"` et verrouillé : jamais `bypassPermissions`. Le Bypass passe par la gate seule et couvre Claude et OpenCode à l'identique. Les modes Answer/Plan/Auto relèvent d'un ADR séparé.

Signature indicative (cœur) :

```ts
export const BYPASS_DEFAULT_MS = 2 * 60 * 60 * 1000;
export const BYPASS_MAX_MS = 4 * 60 * 60 * 1000;
export interface BypassState { since: number; expiresAt: number; }
export interface BypassSwitch {
  /** État courant ; `null` = inactif ou expiré. Relu à chaque décision. */
  current(now: number): BypassState | null;
  /** Motif de la dernière mise à « off » (désactivation ou expiration), pour `bypass.changed`. */
  lastOffReason(): "bypass.disabled" | "bypass.expired";
}
export function isBypassable(request: ApprovalRequest, verdict: PolicyVerdict, policy: Policy): boolean;
// ApprovalGateOptions.bypass?: BypassSwitch ; ApprovalGateOptions.now?: () => number (tests)
// ApprovalOutcome.source: "policy" | "user" | "bypass"
```

## Alternatives écartées

- **`permissionMode: "bypassPermissions"`** : désactive la gate côté SDK, viole l'invariant d'autorité unique et n'a pas d'équivalent OpenCode.
- **Modale native de confirmation** (version proposée) : écartée par le propriétaire du produit. Ses compensations sont listées ci-dessous.
- **Bypass = `session` sur tout `REMEMBERABLE`** : couvrirait `bash.noRule` (toute commande Bash sans danger détecté) et `sandbox.interpreter`, et mémoriserait.
- **Bash couvert dès que le verdict est `policy.rule`** : un segment couvert par une règle ferait passer un segment voisin sans règle (`policy.ts:208`).
- **État persisté ou réglage VS Code de portée espace de travail** : un dépôt hostile pourrait l'imposer, et le Bypass survivrait à l'attention de l'utilisateur.
- **Réutiliser `source: "user"`** : confondrait dans l'audit un humain et un automatisme.

## Conséquences

- Positives : aucun invariant n'est touché ; chemin unique pour les deux adaptateurs ; audit explicite (motif d'origine conservé).
- Garde des chemins dans les arguments : faux positifs possibles (un chemin hors espace de travail dans un argument inoffensif, par exemple `echo /etc/hostname` ou un champ MCP libre, redemande une approbation). Accepté : l'erreur va vers la question, jamais vers l'exécution silencieuse.
- Négatives : changer l'union `source` touche le validateur, le graphe, l'export et les consommateurs. Une politique de dépôt approuvée peut élargir la couverture du Bypass en ajoutant des règles `ask` (accepté : l'empreinte est approuvée ; rien au-delà de `ask`).
- **Risque principal : activation sans modale.** Une webview compromise (injection via du contenu d'agent rendu) peut activer le Bypass d'un message. Compensations : (1) le périmètre exclut tout garde-fou (deny, chemins, externe, hôte, shell), donc le pire cas est l'exécution sans question d'outils que la politique classe « ask » ; (2) la durée vient de l'hôte, plafonnée à 4 h, contrôlée par la gate elle-même ; (3) `enabled: true` est refusé quand la vue est cachée ; (4) chaque transition est journalisée et la gate n'approuve rien sans `bypass.changed` « on » préalable dans le même journal ; (5) l'état visible (bordure, badge, barre d'état native) ne dépend pas de la webview seule. La CSP stricte de la webview (nonce, pas de script en ligne) devient une exigence de sécurité, à vérifier au Lot 2.
- L'expiration fait foi côté hôte et gate (comparaison d'horloge), jamais par un minuteur de la webview.

## Plan

**Lot 1 (core, messages, export-html).** Objectif : constantes `BYPASS_DEFAULT_MS`/`BYPASS_MAX_MS`, `BypassState`, `BypassSwitch`, une implémentation en mémoire `createBypassSwitch({ now })` (`enable(durationMs)` qui borne à `BYPASS_MAX_MS`, `disable()`, `current`, `lastOffReason`), options de gate `bypass` et `now`, `BYPASSABLE`, `isBypassable` (exporté), `source: "bypass"`, le kind `bypass.changed`, les codes `approval.bypassed`, `bypass.enabled`, `bypass.disabled`, `bypass.expired`. Fichiers : `packages/core/src/approval/gate.ts`, `packages/core/src/approval/bypass.ts` (nouveau), `events.ts` (type et validateur), `reason.ts` (`REASON_CODES`), `graph/build.ts`, `index.ts`, catalogues fr (complet) et en de `packages/messages`, `KIND_CLASS` de `packages/export-html`. Critères (vitest), Bypass actif :
- (a) `deny` de règle, (b) `~/.ssh/id_rsa` (chemin sensible, `SENSITIVE_HOME_PATHS`, `paths.ts:95-112`) et un chemin hors espace de travail, (c) dangers shell (`;`, `$(…)`), (d) `docker run -v /:/host`, (e) `EXTERNAL_DIRECTORY_TOOL` et une entrée avec `EXTERNAL_PATTERNS_FIELD` (motif `policy.default`) : jamais `source: "bypass"`.
- (f) Règle `ask` explicite non Bash, et Bash `git status` avec une règle `{ tool: "Bash", command: "git status", decision: "ask" }` : `allow`, `source: "bypass"`, motif `approval.bypassed` avec cause `policy.rule`, sans `approval.requested` ni mémorisation (une fois le Bypass coupé, la même demande émet `approval.requested`).
- (g) `bash.noRule`, `ls && rm x` avec une règle `ask` sur `ls` seulement, et une règle `Bash ask` sans `command` : `approval.requested`.
- (h) Sans Asker : `deny` `approval.noAsker`.
- (i) Expiration, désactivation et état incohérent (`expiresAt - since > BYPASS_MAX_MS`) : effet dès le `decide` suivant, un seul `bypass.changed` par transition, avec le bon motif.
- (j) Avec une règle `{ tool: "Bash", command: "echo *", decision: "ask" }` : `echo x > /etc/passwd` (redirection) et `echo x | sh` (pipe, plusieurs segments) : jamais `source: "bypass"`.
- (k) `Read` hors espace de travail avec une règle `ask` sur `Read` : jamais `source: "bypass"` ; un chemin qui rend `path.unsupported` : idem.
- (l) Réactivation (disable puis enable entre deux `decide`) et prolongation (nouvel `enable` sans `disable`) sans `decide` intermédiaire : un nouveau `bypass.changed` « on » avec les nouvelles bornes au `decide` suivant ; validateur : « on » sans `since` ou `expiresAt` rejeté.
- (m) Bash sur win32 sans `posixShell` : jamais `source: "bypass"`.
- (n) Chemin sensible (`~/.ssh/id_rsa`) et chemin hors espace de travail dans un argument Bash couvert par une règle `ask` littérale (`cat ~/.ssh/id_rsa` avec règle `cat`), et dans une chaîne imbriquée d'une entrée MCP couverte par une règle `ask` : `approval.requested`.
- (o) Contre-exemple : même commande ou même entrée MCP avec un chemin relatif ou absolu dans l'espace de travail : reste `source: "bypass"`.
- Les tests d'exhaustivité des codes et des kinds restent verts.

**Lot 2 (vscode, hôte, sécurité).** Objectif : un `BypassSwitch` par fenêtre, branché sur chaque gate créée par l'extension ; message `setBypass { enabled: boolean }` dans `parseWebviewMessage` ; `enabled: true` refusé si la vue n'est pas visible ; minuteur hôte à `expiresAt` qui pousse l'état « off » vers la webview ; remise à « off » au `reset` et sur `onDidChangeWorkspaceFolders` ; état poussé à la webview (`on`, `expiresAt`). Critères : message avec champ en trop, `enabled` non booléen ou champ `duration` rejeté ; aucune lecture de `workspace.getConfiguration`, `globalState` ni `workspaceState` pour le Bypass (test sur fausse API) ; durée effective égale à `BYPASS_DEFAULT_MS` ; état « off » après `reset` et changement de dossiers ; CSP de la webview vérifiée (nonce, pas de `unsafe-inline` pour les scripts) ou signalée à l'orchestrateur.

Validation de chaque lot : `pnpm check`. Interdits : modifier `permissionMode` ou les options verrouillées ; ajouter une option de runner, une variable d'environnement ou une commande CLI pour le Bypass ; persister l'état ; élargir `BYPASSABLE`, assouplir la garde Bash ou la garde des chemins dans les arguments sans nouvel ADR ; écrire une règle depuis le Bypass.

Note : `.env` n'est pas un chemin sensible par défaut (`SENSITIVE_HOME_PATHS`, `paths.ts:95-112`) et `Read` est `allow` par défaut (`policy.ts:56`). Le traitement de `.env` est un fait de politique, indépendant du Bypass : le Bypass n'y change rien, ni dans un sens ni dans l'autre.

**Voie produit (après le Lot 2, `cadre` puis `surface`).** L'interface doit afficher : l'interrupteur on/off dans Configure, qui reflète l'état poussé par l'hôte (jamais un état local optimiste) ; une bordure et un badge BYPASS tant que l'état est « on », avec le temps restant ; le retour automatique à « off » à l'expiration ; une mention claire de ce qui reste demandé ou refusé (deny, chemins, externe, hôte, shell, Bash sans règle) ; un élément de barre d'état natif (hors webview) recommandé.

## Révision

**2026-10-16, revue d'architecte du Lot 1.** Trois corrections, sans élargir le périmètre :

1. Garde des chemins dans les arguments (Décision 1) : Bash et les outils MCP échappent à `PATH_FIELDS` (`paths.ts:60-68`) ; le Bypass est refusé dès qu'un argument ou une chaîne de l'entrée, lue en profondeur, ressemblant à un chemin tombe sous `checkPathAccess`. Restreint seulement le Bypass ; faux positifs acceptés.
2. Émission de `bypass.changed` (Décision 4) : un « on » est émis dès que `since` ou `expiresAt` changent, pas seulement à la transition off→on ; `since` et `expiresAt` sont exigés par le validateur quand l'état est « on ».
3. Critère (b) du Lot 1 : `.env` n'est pas sensible par défaut et `Read` est `allow` par défaut (`policy.ts:56`) ; remplacé par `~/.ssh/id_rsa` et un chemin hors espace de travail. Cas de test (j) à (o) ajoutés.
