# 0017 — Bypass universel (lève aussi les refus durs)

- Statut : accepté
- Date : 2026-10-24
- Amende l'ADR 0006 (Décisions 1 et 2) et l'ADR 0014 (gate de `execute_command`) sur le seul point du périmètre du Bypass. Amende l'ADR 0010 (le Bypass reste sans effet en apprentissage, désormais par un seul mécanisme).

## Contexte

Jusqu'ici le Bypass n'auto-approuvait qu'un verdict `ask` couvert par `isBypassable` ; un `deny` de politique (`sudo *`, `rm *`, règles `deny`), un accès hôte (`docker.hostAccess`), un chemin sensible ou hors espace de travail, un danger shell restaient refusés même sous Bypass (`packages/core/src/approval/bypass.ts:91-129`, `gate.ts:270-291`).

Décision du propriétaire du projet, explicite et informée (2026-10-24) : « Un Bypass est censé tout bypasser. C'est l'utilisateur qui devient responsable. Pour toutes les fonctionnalités. » Le Bypass doit donc lever aussi les refus durs.

Cela renverse l'invariant de `CLAUDE.md` et du README : « un `deny` de politique, un chemin sensible ou hors de l'espace de travail, un `docker run` donnant accès à l'hôte et les dangers shell ne sont **jamais** contournables ni mémorisables ». Le présent ADR l'amende : ces verdicts deviennent contournables **pendant** un Bypass actif, jamais mémorisables.

Faits : le Bypass est borné (défaut 2 h, plafond 4 h, en mémoire, éteint à l'arrêt du moteur — `bypass.ts:14,17,76`, `engine.ts:352-354`) ; il n'écrit aucune règle (`gate.ts:286-291`, aucun appel à `remember`) ; sans Asker, un verdict `ask` est déjà refusé **avant** le Bypass (`gate.ts:272-277`) ; l'apprentissage charge `LEARNING_POLICY` et ne fournit pas d'Asker (`engine.ts:182-195`, `cours/policy.ts`).

## Décision

1. **Périmètre universel, borné à la fenêtre.** Pendant un Bypass actif, la gate auto-approuve **tout** verdict non-`allow` (y compris `deny`, chemins, accès hôte, dangers shell), en `once`, sans jamais mémoriser ni écrire de règle. Un verdict `allow` reste `source: "policy"` (ne pas le maquiller en bypass).

2. **Point d'application unique, dans la gate.** Une seule branche, placée **avant** le traitement du verdict, sous deux conditions cumulatives :
   - Bypass effectif (`observeBypass`) ;
   - **Asker présent** (`ask !== undefined`).
   La présence d'un Asker est l'unique garde : elle préserve sans cas particulier (a) le mode apprentissage (pas d'Asker → Bypass sans effet, l'ADR 0010 tient) et (b) la CLI non interactive. On ne lit aucun drapeau « learning » dans la gate.

   ```ts
   const override = bypassActive && ask !== undefined && verdict.decision !== "allow";
   if (override) {
     outcome = {
       decision: "allow",
       reason: reason(
         verdict.decision === "deny" ? "approval.override" : "approval.bypassed",
         undefined,
         verdict.reason, // verdict d'origine conservé en cause
       ),
       source: "bypass",
     };
   } else if (verdict.decision !== "ask") { /* …inchangé… */ }
   ```

3. **Traçabilité, sans nouveau `kind` ni nouveau champ.** `approval.decided` porte déjà `decision`, `source`, `reason` ; la raison chaîne le **verdict d'origine en `cause`** (code + paramètres), comme aujourd'hui pour `approval.bypassed`. L'audit du journal et l'export HTML voient donc « allow / source bypass / cause = `policy.rule` | `docker.hostAccess` | `path.sensitive` | … ». **Un seul ajout** : un nouveau code de raison `approval.override` (REASON_CODES + catalogues fr complet et en ; le test d'exhaustivité l'impose) réservé à la levée d'un **refus dur**, pour que le journal distingue d'un coup d'œil un `deny` levé d'un `ask` auto-approuvé. `approval.bypassed` reste pour les verdicts `ask`. Aucun nouveau `kind` d'événement, donc pas de `KIND_CLASS` à toucher.

4. **Rien n'est mémorisé.** La branche override n'appelle jamais `remember` et n'émet aucune règle `allow`. Une fois le Bypass coupé (désactivation, expiration, arrêt du moteur), la même demande repasse par la politique : un refus redevient refus. Confirmé invariant : « jamais mémorisable » tient.

5. **Apprentissage et politique non approuvée : non concernés.** L'apprentissage est un **verrou de mode** (politique figée + absence d'Asker), pas un garde-fou de permission : le Bypass ne le lève pas (condition « Asker présent »). L'empreinte de la politique du dépôt reste approuvée **avant** chargement : le Bypass agit sur la politique déjà en vigueur, il ne fait jamais appliquer une politique non approuvée. Ces deux invariants ne sont pas amendés.

6. **Nettoyage.** `isBypassable`, `BYPASSABLE`, `inputPathsFree` et leurs auxiliaires de `bypass.ts` deviennent sans objet (la gate n'a plus de prédicat de couverture). Ils sont **retirés** : laisser du code restrictif mort laisserait croire qu'un `deny` reste protégé sous Bypass. `createBypassSwitch`, `BypassSwitch`, `BYPASS_*_MS`, `observeBypass` sont conservés tels quels.

## Alternatives écartées

- **Verdict spécial / nouveau `kind` d'événement** : coûteux (validateur, graphe, export, consommateurs) pour une information déjà portée par `source: "bypass"` + cause. Écarté.
- **Garder `isBypassable` en l'élargissant au cas par cas** (deny durs listés) : recrée une liste à maintenir et contredit « tout bypasser ». Écarté au profit du prédicat unique « non-`allow` + Asker ».
- **Laisser le Bypass lever aussi l'apprentissage** : l'apprentissage est un contrat de mode (lecture seule du dossier de cours), pas une permission. L'y soumettre casserait l'ADR 0010 sans demande. Écarté.

## Conséquences

- **Sécurité (en tête).** Sous Bypass, l'utilisateur assume tout : exécution hôte, chemins sensibles, `sudo`/`rm`, dangers shell. Fail-safe maintenu : (i) borne temporelle 2 h / 4 h inchangée ; (ii) extinction à l'arrêt du moteur ; (iii) effet seulement si un Asker est présent ; (iv) aucune persistance. Les invariants **non amendés** (masquage des secrets, `safeEnv`, e-mail jamais journalisé, options SDK verrouillées, empreinte de politique, Bash off par défaut hors Bypass, gate unique autorité) restent intacts.
- **Avertissement à l'activation (voie produit).** Risque d'activation à l'aveugle : l'interface doit afficher, au moment d'activer le Bypass, un texte listant ce qui est désormais levé (refus de politique, `sudo`/`rm`, accès hôte, chemins sensibles et hors espace, dangers shell) et la durée. Ne pas concevoir l'écran ici : question posée au propriétaire, à cadrer par `cadre`/`surface`.
- **Textes à corriger** (hors de ce lot, par l'orchestrateur) : `CLAUDE.md` (invariant « jamais contournables ni mémorisables » → « jamais mémorisables ; contournables uniquement pendant un Bypass actif, sous la responsabilité de l'utilisateur ») ; `README.md:53` et `README.md:111` ; `docs/HANDOFF-windows.md:22` ; `docs/design-studio-ui.md:77`. Références à réaligner : ADR 0006 (Décisions 1, 2), ADR 0010:17 (le Bypass « ne lève jamais un deny » devient « sans effet faute d'Asker »), ADR 0014:208 (la gate de `execute_command` n'oppose plus de deny sous Bypass).
- **À surveiller** : qu'aucune branche de la gate ne marque un verdict `allow` de politique en `source: "bypass"` ; que `source: "bypass"` n'apparaisse jamais sans Asker ; que `remember` ne soit jamais atteint par l'override.

## Plan

Lots pour `dev` (voie moteur). Tous touchent la gate → **revue `architect` obligatoire** pour chacun.

### Lot B1 — Code de raison `approval.override`
- **Objectif** : ajouter le code de raison de la levée d'un refus dur.
- **Fichiers** : `packages/core/src/reason.ts` (REASON_CODES) ; `packages/messages/src/fr.ts` (libellé complet) ; `packages/messages/src/en.ts` (libellé minimal).
- **Décision** : nouveau code `approval.override`, libellé fr du type « refus levé par le bypass (<cause>) », en « refusal overridden by bypass (<cause>) », cause = `c.cause`. `approval.bypassed` inchangé.
- **Critères** : `pnpm check` vert, test d'exhaustivité des raisons passant ; aucun autre code touché.
- **Interdits** : identifiant de modèle ; toucher la gate dans ce lot ; nouveau `kind`.

### Lot B2 — Bypass universel dans la gate
- **Objectif** : appliquer la Décision 2 (branche override) et le choix de code de la Décision 3.
- **Fichiers** : `packages/core/src/approval/gate.ts` (fonction `decide`).
- **Décision** : branche `override = bypassActive && ask !== undefined && verdict.decision !== "allow"` placée avant le traitement du verdict ; `outcome` allow, `source: "bypass"`, raison `approval.override` si `verdict.decision === "deny"` sinon `approval.bypassed`, cause = `verdict.reason` ; ne jamais appeler `remember` ; branches `allow`/`noAsker`/`session`/`requested` inchangées quand override est faux.
- **Critères** : `pnpm check` vert ; tests couvrant : (a) sous Bypass, `deny` de règle, chemin sensible, hors espace, `docker.hostAccess`, danger shell → `allow` `source: "bypass"` motif `approval.override`, cause = code d'origine, aucun `approval.requested`, aucune règle persistée ; (b) sous Bypass, verdict `allow` de politique → `source: "policy"` ; (c) Bypass actif **sans** Asker (apprentissage / CLI) → refus inchangé (`deny` ou `approval.noAsker`), jamais `source: "bypass"` ; (d) Bypass coupé → la même demande refusée redevient refus.
- **Interdits** : lire un drapeau « learning » dans la gate ; persister une règle ; nouveau `kind` ou champ d'événement ; identifiant de modèle.

### Lot B3 — Retrait de `isBypassable` et des auxiliaires morts
- **Objectif** : supprimer le prédicat de couverture devenu inutile (Décision 6).
- **Fichiers** : `packages/core/src/approval/bypass.ts` (retirer `isBypassable`, `BYPASSABLE`, `inputPathsFree`, `bashBypassable`, `candidatesFree`, `collectStrings`, `valueTokens`, `attachedCandidates`, `looksLikePath`, `tokenPathFree`, `MAX_INPUT_DEPTH` et imports devenus inutiles) ; exports (`index.ts`) ; tests `packages/core/test/bypass.test.ts`.
- **Décision** : conserver `createBypassSwitch`, `BypassSwitch`, `MemoryBypassSwitch`, `BypassState`, `BYPASS_DEFAULT_MS`, `BYPASS_MAX_MS`, `BypassOffReason`. Retirer les tests devenus faux (couverture `isBypassable`) ; garder/adapter ceux de l'interrupteur et des bornes.
- **Critères** : `pnpm check` vert ; aucune référence résiduelle à `isBypassable` (grep) ; comportement de `gate.ts` inchangé par ce lot (B2 est la source de vérité).
- **Interdits** : modifier la logique de `createBypassSwitch` ou les bornes ; identifiant de modèle.

Ordre : B1, puis B2, puis B3.
