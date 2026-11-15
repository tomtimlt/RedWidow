# 0055 — Précision : cible vérifiée partout, intentions ciblées, trouvailles prouvées et retestées

- Statut : accepté (version de test, branche `multi-agent`)
- Date : 2026-11-15

## Contexte
Faits du code :
- **Périmètre.** Il est typé dans la fiche programme (`program/sheet.ts:17-23`, `inScope` et `outOfScope`) et dans la fiche d'engagement (`engagement/sheet.ts:32-38`). Les motifs (hôte, `*.domaine`, IP, CIDR) sont validés par `isValidScopePattern` (`program/cited.ts:36-44`). La correspondance se fait dans `program/scope.ts:180-210`, et une exclusion l'emporte toujours.
- **Gate.** Elle contrôle le périmètre pour `read_url`, `http_request`, Bash, Kali et Exegol (`approval/policy.ts:443-592`, `programTargets` dans `scope.ts:135-173`). **Les outils Burp ne sont pas contrôlés**, alors que `burp/tools.ts:62` suppose que la gate le fait.
- **`record_test.target`** est une chaîne libre (`audit-schema.ts:18`), sans lien avec le périmètre.
- **Trouvailles.** Le type `Finding` (`exegol/findings.ts:39-50`) n'a ni sévérité ni cible. Ses `evidenceIds` sont validés contre les fichiers de preuve, et aucun retest n'existe.
- **Objectif.** Il est coupé à 120 caractères quand le contexte de mission déborde (`mission-desk.ts:1137-1138`).
- **Intentions de campagne.** Elles n'ont pas de cible (ADR 0054).

L'idée reprise d'un outil red team open source : on formule des résultats plutôt que des étapes ; une cible est un nom d'hôte complet ; une trouvaille est ancrée dans des traces réelles ; et un seul échec ne prouve jamais qu'une faille est corrigée.

## Décision
1. **Burp passe par le contrôle de périmètre.** `programTargets` extrait les hôtes des arguments des outils Burp qui visent une cible (URL, hôte, requête). Ils suivent les règles existantes : `program.out_of_scope` ou `engagement.out_of_scope` en `ask`, `program.host_unresolved` en `ask` non mémorisable, et `engagement.halted` en `deny`. Les outils Burp de lecture pure, sans cible (historique, état du proxy), ne changent pas. C'est un durcissement : aucun invariant n'est affaibli.
2. **Cible typée dans `record_test`.** Quand une fiche programme ou d'engagement approuvée existe, `target` doit correspondre au périmètre (`scope.ts`). Sinon l'outil est refusé avec `audit.targetOutOfScope`. Sans fiche approuvée, le comportement actuel est conservé.
3. **Intentions ciblées.** `campaign_open_intent` accepte un champ `target` facultatif : un motif valide (`isValidScopePattern`), dans le périmètre approuvé s'il en existe un, sinon refusé avec `campaign.targetOutOfScope`. La cible fait partie de la clé de doublon, et le worker la reçoit dans son contexte de mission.
4. **Objectif intact.** Quand le contexte déborde, l'objectif courant n'est plus coupé à 120 caractères mais à 500 ; on retire d'abord les autres sections.
5. **Trouvailles prouvées.** `Finding` gagne trois champs facultatifs :
   - `severity` : `info`, `low`, `medium`, `high` ou `critical` ;
   - `target` : validé comme au point 2 ;
   - `proof` : `observed` (vu une fois), `reproduced` (rejoué avec succès) ou `exploited` (impact démontré).

   `proof` vaut `reproduced` ou `exploited` seulement si la trouvaille cite au moins une preuve (`evidenceIds`). Les anciennes trouvailles restent lisibles.
6. **Retest.** Un outil `record_retest`, côté Exegol comme `note`, prend un identifiant de trouvaille, un verdict (`reproduced`, `fixed` ou `inconclusive`) et des preuves. `fixed` exige au moins deux preuves distinctes, sinon il est refusé avec `finding.retestInsufficient`. Le retest émet un événement `finding.retest` (validateur et `KIND_CLASS`) et met à jour l'état de la trouvaille ; l'historique des retests est conservé.
7. **Hors champ.** La résolution DNS (un hôte hors périmètre qui pointe vers une IP du périmètre) reste non vérifiée, comme aujourd'hui.

## Lots
1. Burp dans `programTargets`, avec tests (lot de sécurité, relu contre les invariants).
2. `record_test.target` vérifié, `target` sur les intentions de campagne, objectif à 500 caractères.
3. Trouvailles : `severity`, `target`, `proof`, `record_retest` et `finding.retest`, avec l'affichage minimal dans le panneau des trouvailles (voie produit si le rendu change).

## Conséquences
- Plus de demandes d'approbation sur les outils Burp hors périmètre. C'est voulu.
- Un agent qui teste hors périmètre déclaré voit son `record_test` refusé. Il doit corriger sa cible ou demander une mise à jour de la fiche.
- De nouveaux codes de raison dans `REASON_CODES` et les catalogues fr et en.
