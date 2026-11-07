# 0039 — Recherche web native et relancée pour les missions cyber

- Statut : proposé
- Date : 2026-11-07

## Contexte

L'ADR 0023 expose `search_web` et `read_url` (Exa anonyme, 5 à 8 résultats,
16 000 caractères par lecture, IP publiques épinglées) sans en imposer l'usage
(`docs/redteam-expert-conception.md:133`). Ils ne figurent pas dans
`DEFAULT_POLICY` (`packages/core/src/approval/policy.ts:55-88`) : chaque appel
passe en « ask ». Les profils restreignent la recherche à GitHub et interdisent
l'exploration générale ; la relance de `mission_context`
(`packages/core/src/mission-desk.ts:223-226`) ne vise que GitHub.

Terrain : une extraction de prompt système n'a réussi qu'après une recherche
spontanée sur arXiv ; une autre mission a conclu trop tôt sans jamais chercher
la pile identifiée (Solr derrière PHP, ModSecurity CRS).

Menace principale d'une recherche libre : **l'exfiltration**. Une requête ou une
URL peut porter des données de la cible (secrets, butin, noms internes, client)
vers Exa ou vers un hôte choisi par un contenu injecté. `PolicyRule` ne filtre
pas les arguments d'un outil MCP (`policy.ts:17-24`).

## Décision

1. **Politique.** `search_web` passe en `allow` par défaut (destination unique
   et fixe). `read_url` reste `ask` par défaut, sauf vers une **liste fermée de
   sources de référence** (NVD, MITRE CVE, GitHub et ses avis, exploit-db,
   PortSwigger, arXiv, sites de documentation éditeur listés) : `allow` avec le
   code `web.reference_source`. Cette promotion ne s'applique qu'à un résultat
   « ask » ; elle n'annule jamais un `deny` (politique de dépôt, Bypass compris).
   Garde d'arguments, appliquée aux deux outils : une requête ou une URL qui
   contient une valeur au format secret (motifs du recorder), une IP privée ou
   un identifiant déjà masqué dans le run repasse en `ask` avec le code
   `web.query_sensitive`, **non mémorisable**.
2. **Déclencheurs, non bloquants.** Un détecteur pur du cœur
   (`researchTriggers`) lit les observations du run : technologie ou version
   identifiée sans recherche correspondante, erreur répétée ≥ 2, 403/WAF
   répétés, aucune recherche dans le run. Il produit une relance contextuelle
   nommant la technologie ou l'erreur. Points d'injection : `mission_context`,
   et la réponse de `record_decision`/`record_test` lorsque la conclusion est
   négative ou de clôture sans recherche dans le run. Aucun outil n'est bloqué.
3. **Traçabilité sans nouveau `kind`.** Les appels web sont déjà des événements
   d'outil (requête, URL, date). `record_test` et `record_decision` reçoivent un
   champ optionnel `sources` : identifiants d'événements `search_web`/`read_url`
   du run, validés. `mission_context` liste les recherches du run.
4. **Sources.** La hiérarchie (éditeur, NVD/CVE, avis GitHub/éditeur,
   exploit-db, PortSwigger, arXiv pour IA/LLM et techniques récentes, rapports
   publics, HackTricks et PayloadsAllTheThings à recouper), la préférence pour
   le récent daté, le statut de donnée du contenu web et « une CVE ne prouve
   rien sans test » vont dans `WEB_GUIDANCE`, injecté seulement si les outils
   sont exposés. `AGENT_METHODOLOGY` reçoit une seule règle conditionnelle :
   pas de conclusion négative sans recherche sur la pile identifiée lorsque
   l'accès web existe. Règle commune : ne jamais mettre dans une requête un
   identifiant de la cible, un secret ou une donnée client ; chercher le
   composant, la version, le message d'erreur.
5. **Fournisseur plus riche : pas maintenant.** Seule une interface
   `SearchProvider` est extraite, Exa restant l'unique implémentation.

## Alternatives écartées

- `read_url` en `allow` total : canal d'exfiltration vers tout hôte public.
- Blocage d'une clôture sans recherche : contournable (texte libre), bruit dans
  la gate, qui doit rester l'autorité d'approbation et non de méthode.
- Nouveau `kind` « recherche » : doublon des événements d'outil.
- Fournisseur à clé tout de suite : nouvelle destination, secret et coût, alors
  que l'échec observé est l'absence de recherche, pas sa qualité.

## Conséquences

- Positives : recherche sans friction sur les sources fiables, relances ciblées.
- Risques : Exa voit les requêtes (technologies, versions) ; une mission
  confidentielle peut refuser `search_web` par politique de dépôt (`deny` reste
  le plus strict). Heuristique de détection imparfaite : relance seulement.
- À surveiller : taux de relances ignorées, faux positifs de la garde.

## Plan

Chaque lot se valide par `pnpm check` vert.

1. **Politique et garde** : `approval/policy.ts`, `web/` (liste
   `REFERENCE_HOSTS`, `webArgumentGuard`), `REASON_CODES`, catalogues fr/en.
   Tests : `search_web` allow ; `read_url` vers un hôte de référence allow,
   sinon ask ; `deny` de dépôt conservé ; requête avec secret ou IP privée en
   ask non mémorisable, y compris sur un hôte de référence.
2. **Textes** : `web/guidance.ts`, `methodology.ts`, `mission-desk.ts:225`
   (élargir au-delà de GitHub), profils (`agent-profiles.ts`,
   `packages/vscode/media/skills/{htb,red-team,mentor}`) sans restriction
   « GitHub seul ». Profil bug bounty hors lot. Tests de présence des règles.
3. **Déclencheurs** : `researchTriggers` pur dans le cœur, branché sur
   `mission_context`, `record_decision`, `record_test`. Tests par déclencheur et
   absence de relance après une recherche couvrant la technologie.
4. **Traçabilité** : champ `sources` validé (événement web du run), validateur
   d'événement mis à jour, liste des recherches dans `mission_context`.
5. **Interface `SearchProvider`** : extraction sans changement de comportement.
