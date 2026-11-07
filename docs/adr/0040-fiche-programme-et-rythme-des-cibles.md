# 0040 — Fiche programme, périmètre et rythme vers les cibles

- Statut : proposé
- Date : 2026-11-07

## Contexte

Une mission bug bounty impose un périmètre (hôtes inclus/exclus), souvent un
suffixe User-Agent et un débit. Le but est d'éviter le ban et la sortie de
périmètre, pas de ralentir. Décisions produit : fiche par projet remplie par
l'agent avec citation, URL et date ; validée par l'utilisateur ; non validée =
non appliquée ; hors périmètre = `ask`, pas de refus dur ; rythme adaptatif
(pause 60 s puis débit ÷ 2 au premier 429, 403 de WAF ou timeout ; arrêt au ban).

Faits : aucun outil ne voit l'hôte de façon uniforme. `execute_command` est une
chaîne shell (`kali/tool-specs.ts:453-460`), déjà `ask` non mémorisable
(ADR 0014) ; les outils Kali dédiés ont un champ `target`
(`kali/tool-specs.ts:318-325`) que la gate n'analyse pas ; `task_start` est
analysé comme Bash (`policy.ts` ~404-412) ; Exegol `exec` et Burp `call_tool`
sont opaques ; seul `read_url` voit l'hôte (`web/network.ts:165,180`).
`sessionKey` vaut le nom d'outil hors Bash (`gate.ts:109-131`) : une
approbation de session de `nmap_scan` couvre toute cible. Précédent
d'évaluation par arguments : `evaluateWeb` (`policy.ts:446-458`, ADR 0039).
Aucun limiteur ; horloges injectables (`gate.ts:84-85,167`, `bypass.ts:40-44`).
Le `kind` `rate.limited` existe déjà (`events.ts:174-179`) : nom à ne pas réutiliser.

Modèle de menaces. L'agent et le contenu web (page du programme, cible)
contrôlent le **brouillon** et les commandes ; seul un humain, par un canal hors
outil d'agent, contrôle la **validation** ; le moteur applique. Fail-closed :
fiche validée illisible ou empreinte divergente → toute action réseau vers un
hôte connu passe en `ask` non mémorisable.

## Décision

Option C, par étapes : fiche + gate de périmètre sur les hôtes visibles, puis
outil moteur `http_request` (seul lieu d'application complète : UA, rythme,
adaptation, preuve), puis conformité des commandes shell connues. Le proxy
sortant est reporté à un ADR distinct, **sans interception TLS**.

1. **Fiche.** `<configDir>/projects/<id>/program.json` (brouillon) et
   `program.approval.json` (empreinte SHA-256 du contenu canonique, date). Pas
   dans `.warband/` du dépôt : le projet est l'unité de mission et le dossier de
   travail est écrit par l'agent. Ces deux fichiers sont des chemins sensibles
   (refus Write/Edit/Bash). Type `ProgramSheet` (cœur, sans texte) : chaque
   champ est `Cited<T> = { value: T; quote: string; url: string; retrievedAt: string; verified: boolean }`.
   Champs : `inScope`, `outOfScope` (motifs `hôte`, `*.domaine`, IP/CIDR),
   `userAgentSuffix?`, `pace` (`{ preset: "fast" | "normal" | "careful" }` ou
   `{ maxRequestsPerSecond }`). Exclusion prioritaire ; hôte non listé = hors
   périmètre. L'agent écrit le brouillon par l'outil `program_draft` ;
   `verified` est vrai seulement si la citation figure dans le résultat d'un
   `read_url` du run sur cette URL. **Validation par empreinte, comme la
   politique de dépôt**, seulement par la CLI (puis l'interface), jamais par un
   outil d'agent. Toute écriture du brouillon invalide l'application.
   `suspend` rend le projet au profil généraliste sans effacer la fiche.
2. **Gate.** `evaluateProgram` après `evaluateUncapped`, sur le modèle
   d'`evaluateWeb`, alimenté par un `ProgramProvider` injecté. Il ne transforme
   jamais un `deny` en autre chose. Hôte hors périmètre → `ask`
   `program.out_of_scope`, mémorisable **par hôte** seulement
   (`program-host:<hôte>`), jamais par nom d'outil : une approbation de session
   d'outil ne couvre pas un hôte hors périmètre. Outil réseau connu sans hôte
   extractible → `ask` `program.host_unresolved` non mémorisable. Hôte en arrêt
   → `ask` `program.halted` non mémorisable. Dans le périmètre : `read_url` et
   `http_request` sont promus de `ask` à `allow` (`program.in_scope`), la garde
   `web.query_sensitive` restant prioritaire.
3. **Rythme.** Contrôleur pur du cœur (`pace/`, horloge injectable) : plafond
   global du programme (seau à jetons), multiplicateur adaptatif par hôte.
   Signal (429, 403 de WAF, timeout) → pause 60 s, débit ÷ 2 (plancher ÷ 8) ;
   remontée ×1,5 toutes les 20 réponses saines, jamais au-delà du plafond ;
   trois signaux en 10 min ou un signal au plancher → arrêt de l'hôte.
   **L'attente n'a jamais lieu dans la gate** : elle a lieu dans le gestionnaire
   de `http_request`, bornée à 90 s et annulable ; au-delà, l'outil rend
   `program.paced` avec `retryAfterMs`. La reprise d'un hôte arrêté est un geste
   humain (CLI), jamais automatique.
4. **Bypass.** Les `ask` de périmètre sont contournables pendant un Bypass actif
   (ADR 0017). Le Bypass ne touche ni le rythme, ni l'arrêt d'un hôte, ni le
   suffixe UA : ce sont des protections, pas des approbations.
5. **Événements et codes.** Nouveaux `kind` : `program.state`
   (`approved` | `suspended` | `invalidated`, empreinte), `pace.adjusted`
   (hôte, ancien et nouveau débit, cause), `pace.halted` (hôte, cause). Codes :
   `program.out_of_scope`, `program.host_unresolved`, `program.halted`,
   `program.unreadable`, `program.in_scope`, `program.paced`,
   `program.flag_missing`.

## Alternatives écartées

- **A seule** : laisse les commandes shell sans rythme ni signal ; acceptable
  comme étape, pas comme cible.
- **B avec interception TLS** : AC injectée dans le conteneur, trafic déchiffré
  de la cible (cookies, jetons) traversant warband, épinglage cassé. Sans
  interception, B ne voit que l'hôte du CONNECT et n'arrête pas un outil qui
  ignore `HTTP_PROXY` (nmap, sockets bruts) : une observation, pas une frontière.
- **Fiche dans la politique de dépôt** : liée au code, pas à la mission ;
  modifiable par l'agent dans le dossier de travail.
- **Refus dur hors périmètre** : contraire au choix produit.
- **Attente dans la gate** : bloquerait la file d'approbation.

## Conséquences

- Positives : `http_request` applique tout ; la gate signale chaque sortie de
  périmètre visible ; bascule pentest ↔ bug bounty par `suspend`.
- Risques : l'extraction d'hôte du shell est au mieux (variables, `-iL`,
  scripts) ; seuls les binaires listés sont couverts ; Exegol `exec` et Burp
  restent aveugles hors extraction. Un brouillon issu d'une page injectée peut
  élargir le périmètre : la validation montre le diff et les champs non
  vérifiés. Le suffixe UA porte souvent le pseudonyme du chercheur : donnée
  identifiante, pas secrète ; l'e-mail du compte n'entre jamais dans la fiche.
- `http_request` part de l'hôte : boucle locale, lien local et métadonnées
  refusés (deny non mémorisable) pour protéger les services de warband.
- À surveiller : taux de `host_unresolved`, faux positifs de 403 « WAF ».

## Plan

Chaque lot : `pnpm check` vert. Revue `architect` pour les lots 1, 3, 4, 6, 7.

1. **Fiche et validation** (livrable seul) : `core` `program/` (type,
   validation, forme canonique, empreinte, stockage `0o600` avec contrôle
   UUID), chemins sensibles, `program.state`, codes, catalogues, `KIND_CLASS`,
   CLI `program show|import <fichier>|approve|suspend`, fiche validée injectée
   dans `mission_context` (bloc « données non fiables »). Tests : brouillon
   modifié → non appliqué ; Write sur `program*.json` refusé.
2. **`program_draft`** : outil d'agent, champs cités, `verified` par
   recoupement `read_url`. Tests : citation absente → `verified: false` ;
   l'outil ne peut pas valider.
3. **Gate de périmètre** : `evaluateProgram`, `ProgramProvider`, hôtes de
   `read_url` et du champ `target` Kali, clé `program-host:`. Tests : session
   `nmap_scan` ne couvre pas un hôte hors périmètre ; `deny` conservé ; fiche
   illisible → `program.unreadable`.
4. **Extraction shell** : curl, wget, httpx, nmap, sqlmap, ffuf, nuclei dans
   `execute_command`, `task_start`, Exegol `exec`. Tests par binaire, cas `-iL`
   → `host_unresolved`.
5. **Contrôleur de rythme** pur, `pace.adjusted`, `pace.halted`. Tests à
   horloge simulée de chaque transition.
6. **`http_request`** : UA suffixé non surchargeable, attente bornée, signaux,
   réponse plafonnée par `capOutput` et masquée, adresses locales refusées.
7. **Conformité shell** : drapeaux de débit et d'UA attendus → `ask`
   `program.flag_missing` mémorisable par binaire.
