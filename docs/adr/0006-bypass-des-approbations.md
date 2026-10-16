# 0006 — Bypass des approbations

- Statut : proposé
- Date : 2026-10-16

## Contexte

La maquette validée prévoit un interrupteur « Bypass approvals » dans Configure (affiché « bientôt », rien de câblé : `docs/design-exegol-ui.md:12`, `:36`, `:77`). Contraintes :

- La gate est l'unique autorité ; `canUseTool` n'est qu'un filet fail-closed (`packages/agent-sdk/src/runner.ts:263`, `:410`). Le SDK tourne en `permissionMode: "default"` (`runner.ts:244`, `:483`), option verrouillée (`runner.ts:70-78`).
- La gate distingue déjà les verdicts « ask » mémorisables (`REMEMBERABLE`, `packages/core/src/approval/gate.ts:83-89`) et exclut les répertoires externes (`gate.ts:102`). `deny` de politique, garde-fous de chemin, accès hôte d'un conteneur et dangers shell ne sont jamais mémorisables (`gate.ts:29-33`).
- Sans Asker, un « ask » est refusé (`gate.ts:204-209`). L'extension propose `once | deny | always` (`packages/vscode/src/logic/approval.ts:9`).
- `.vscode/settings.json` est contrôlé par le dépôt : tout réglage lu depuis la configuration de l'espace de travail est une entrée hostile.

## Décision

1. **Sémantique.** Le Bypass est une **auto-approbation `once`** décidée **dans la gate**, après `evaluatePolicy`, et seulement si le verdict est `ask` **et** que son motif appartient à `BYPASSABLE`, un sous-ensemble strict de `REMEMBERABLE`. Il ne mémorise rien et n'écrit aucune règle. Par défaut, `BYPASSABLE = { "policy.default" }` (aucune règle ne s'applique). Il est toujours exclu pour : `deny`, règle `ask` explicite (utilisateur ou dépôt), garde-fous de chemin, répertoire externe (même test que `gate.ts:102`), accès hôte, dangers shell, commande illisible, `sandbox.interpreter`, `bash.noRule`. Sans Asker (mode non interactif), le Bypass est sans effet : le refus `approval.noAsker` reste.
2. **Portée et durée.** L'état vit en mémoire dans l'hôte de l'extension, **par fenêtre**, et il n'est jamais persisté (ni `globalState`, ni `workspaceState`, ni réglage). Il expire après un délai (30 min par défaut, borné à 2 h). Il retombe à « off » au rechargement de la fenêtre, à `reset` de la conversation et au changement d'espace de travail. La gate le relit à chaque `decide` : une désactivation vaut dès la demande suivante.
3. **Activation.** Seule une commande VS Code native avec modale de confirmation (`showWarningMessage` en `modal: true`) l'active. La webview peut seulement *demander* la modale (`requestBypass`) ou *désactiver* (`disableBypass`), ce qui va dans le sens sûr. Aucune activation par message webview seul, par la politique (utilisateur ou dépôt), par un réglage VS Code, par une option du runner ou par une variable d'environnement. La CLI n'expose aucun Bypass.
4. **Journal.** On ajoute un nouveau `kind` `bypass.changed` `{ state: "on" | "off", reason: Reason, expiresAt?: number }`, émis par la gate quand elle observe un changement d'état (activation, désactivation, expiration). Chaque outil auto-approuvé produit un `approval.decided` avec la nouvelle valeur `source: "bypass"` et le motif `approval.bypassed` (cause : le motif du verdict). Il ne produit pas d'`approval.requested`. Le masquage reste celui du recorder, sans nouveau champ sensible.
5. **Modes et `permissionMode`.** `permissionMode` reste `"default"` et verrouillé : jamais `bypassPermissions`. Le Bypass passe par la gate seule et couvre donc Claude et OpenCode à l'identique. Les modes Answer/Plan/Auto sont orthogonaux et relèvent d'un ADR séparé.

Signature indicative (cœur) :

```ts
export interface BypassSwitch {
  /** État courant ; `null` = inactif ou expiré. Relu à chaque décision. */
  current(now: number): { since: number; expiresAt: number } | null;
}
// ApprovalGateOptions.bypass?: BypassSwitch
// ApprovalOutcome.source: "policy" | "user" | "bypass"
```

## Alternatives écartées

- **`permissionMode: "bypassPermissions"`** : cette option désactive la gate côté SDK, viole l'invariant d'autorité unique et n'a pas d'équivalent OpenCode.
- **Bypass = `session` sur tout `REMEMBERABLE`** : il couvrirait les règles `ask` explicites et `bash.noRule` (toute commande Bash sans danger détecté), ce qui est trop large pour un état activé d'un clic.
- **État persisté ou réglage VS Code** : un dépôt hostile pourrait l'imposer, et le Bypass survivrait à l'attention de l'utilisateur.
- **Réutiliser `source: "user"`** : on confondrait dans l'audit un humain et un automatisme.

## Conséquences

- Positives : aucun invariant n'est touché, le chemin est le même pour les deux adaptateurs et l'audit est explicite.
- Négatives : le périmètre est étroit, et les règles `ask` explicites continuent de demander (c'est voulu). Le changement de l'union `source` touche le validateur, le graphe, l'export et les consommateurs.
- Risques : une webview compromise pourrait spammer `requestBypass`. La modale est native et ne peut pas être cliquée par la webview, mais il faut limiter son débit (une modale à la fois). L'expiration doit être vérifiée côté hôte, jamais par un minuteur de la webview.

## Plan

**Lot 1 (core, messages, export-html).** Objectif : `BypassSwitch`, l'option de gate, `BYPASSABLE`, `isBypassable(request, verdict)` (exporté), `source: "bypass"`, le kind `bypass.changed` et les codes `approval.bypassed`, `bypass.enabled`, `bypass.disabled`, `bypass.expired`. Fichiers : `packages/core/src/approval/gate.ts`, `events.ts` (type et validateur), `reason.ts` (`REASON_CODES`), `graph/build.ts`, `index.ts`, les catalogues fr et en de `packages/messages`, `KIND_CLASS` de `packages/export-html`. Critères (tests vitest) : avec un Bypass actif, (a) un `deny` de politique, (b) `.env` et un chemin hors espace de travail, (c) un danger shell (`;`, substitution), (d) un `docker run` avec accès à l'hôte, (e) un répertoire externe, (f) une règle `ask` explicite, (g) `bash.noRule` et (h) l'absence d'Asker ne sont pas auto-approuvés. Les cas (f) et (g) émettent `approval.requested`. `policy.default` donne `allow` avec `source: "bypass"`, sans `approval.requested` ni mémorisation (la même demande redemande une fois le Bypass coupé). L'expiration et la désactivation prennent effet au `decide` suivant, avec un seul `bypass.changed` par transition. Les tests d'exhaustivité des codes et des kinds restent verts.

**Lot 2 (vscode hôte, sécurité).** Objectif : l'état par fenêtre, la commande native avec modale, les messages `requestBypass` et `disableBypass` (validés par `parseWebviewMessage`, sans charge utile), le branchement de la gate, la réinitialisation sur reload, `reset` et changement d'espace de travail. Critères : aucun message webview ne fait passer l'état à « on » sans confirmation de la modale (test sur une fausse API `window`), et aucune lecture de configuration ou de `workspaceState` n'est faite. Rendu (bordure, badge BYPASS) : voie produit (`cadre` puis `surface`), après ce lot.

Validation de chaque lot : `pnpm check`. Interdits : modifier `permissionMode` ou les options verrouillées, ajouter une option de runner, élargir `BYPASSABLE` sans nouvel ADR.
