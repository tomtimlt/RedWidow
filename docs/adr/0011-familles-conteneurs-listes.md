# 0011 — Familles des conteneurs déjà listés

- Statut : accepté
- Date : 2026-10-22
- S'appuie sur : ADR 0007 (le nom exécuté est celui de la liste courante)

## Contexte

`listLabelPrefix` ne retient aujourd'hui qu'un conteneur dont une clé de label commence par `org.exegol.` (`DOCKER_LABEL_PREFIX_INSPECT_FORMAT`, `packages/core/src/docker/client.ts:124-132`). Le parseur n'accepte que `state`, `name`, `image` et `workspace` (`client.ts:134-177`). Aucune valeur de label n'est recopiée. La sortie de la commande est journalisée ligne à ligne (`packages/core/src/process/run.ts:191-194`) : ce qui est imprimé sort du filtre.

Cette liste est l'autorité de plusieurs chemins :

- `resolveExegolContainer` (`packages/core/src/exegol/targets.ts:76-92`) autorise l'`exec` Exegol ;
- `link` (`packages/core/src/project.ts:80-90`) persiste le conteneur dédié du projet ;
- `controlListedContainer` (`packages/vscode/src/logic/cockpit.ts:393-416`) fait `docker start` ou `docker stop` sur le nom renvoyé par la liste.

`lookupContainer` (`targets.ts:32-45`) ne construit jamais un nom. `EXEGOL_PREFIX` ne sert qu'au nom court. Il n'existe ni filtre par nom d'image, ni label `io.warband.runtime`.

Décision de produit déjà prise : Exegol reste reconnu seulement par le préfixe de clé `org.exegol.`. Sans ce préfixe, la famille est `kali` si `io.warband.runtime` vaut exactement `kali`, sinon si la référence d'image contient `kali`. Le reste est absent de la liste. Ce lot ne crée pas de conteneur, ne pose pas de label, ne monte rien et ne retire pas `/start`.

## Décision

1. **Une liste, un champ `family`.** `LabelPrefixContainer` gagne `family: "exegol" | "kali"`, obligatoire. Les noms `listLabelPrefix`, `parseDockerLabelPrefixInspect` et `LabelPrefixContainer` restent. Le commentaire de la méthode dit que la liste contient les deux familles.
2. **Signaux sur la ligne, famille dans le parseur.** Le format `docker inspect --format` n'imprime une ligne que pour un candidat, et seulement avec les clés déjà admises plus deux booléens littéraux : `"exegol":true` si une clé a les 11 premiers caractères `org.exegol.` ; `"runtimeKali":true` si une clé est exactement `io.warband.runtime` et que sa valeur est exactement `kali`. La comparaison de la valeur reste dans le modèle ; la valeur n'est pas interpolée (`$v` n'apparaît que dans `eq`). L'image est déjà émise par `json .Config.Image`. Le sous-chaîne `kali` côté modèle utilise `split` et `len` (fonctions du format Docker), pas `contains`. Le parseur est le seul à calculer `family`, dans cet ordre : signal `exegol`, sinon signal `runtimeKali`, sinon `image.includes("kali")` sensible à la casse, sinon la ligne est écartée. Il n'accepte pas une clé `family` en entrée. `exegol` ou `runtimeKali` autre que le booléen `true` est `docker.unexpectedOutput`, sans recopier le corps.
3. **Autorité inchangée hors de la liste.** `resolveExegolContainer` ignore toute entrée dont `family` n'est pas `"exegol"` (champ absent inclus). `link` refuse `family !== "exegol"` avec `project.notExegol`, après `project.notFound` et avant `project.notRunning`. `lookupContainer` et `controlListedContainer` ne filtrent pas la famille : start et stop exécutent le nom de la liste. `DockerClient.run` et l'outil MCP `run` ne changent pas.

## Alternatives écartées

- **Émettre `family` depuis le modèle Go.** Le critère de précédence ne serait pas testable sans Docker, et une ligne pourrait imposer la famille.
- **Classer Exegol par le nom d'image.** Contredit la décision de produit : seul le préfixe de clé classe Exegol.
- **Laisser `exec` et `link` suivre toute la liste.** Une image dont le nom contient `kali`, ou un label `io.warband.runtime=kali` posé par quiconque lance `docker run`, deviendrait une cible d'exécution ou un projet dédié. Le label n'est pas une autorité d'exécution au-delà de ce qu'Exegol faisait déjà ; on ne l'étend pas à Kali dans ce lot.
- **Renommer `listLabelPrefix`.** L'appel est l'autorité citée par l'ADR 0007. Le commentaire corrige le sens ; le renommage est un autre lot.
- **Nouveau code `exegol.containerDenied` pour `link`.** Le libellé parle du message en cours et des `@`, pas d'un lien de projet.

## Conséquences

- Un conteneur `org.exegol.` reste `exegol` même si l'image contient `kali` et même si `io.warband.runtime` vaut `kali`.
- `kali` dans la référence est sensible à la casse et non borné par des séparateurs : `kalilinux/kali-rolling` est retenu, `Kali` ne l'est pas, et une référence non liée qui contient ces quatre lettres l'est aussi.
- Les lignes écartées par le modèle n'entrent pas au journal. Une ligne bien formée mais sans famille est absente du tableau retourné ; elle a déjà pu être journalisée si le modèle l'a imprimée. Une ligne mal formée échoue tout l'appel, comme aujourd'hui.
- Le cockpit pourra proposer « lier » un Kali qui a `/workspace`, et `link` refusera. L'affichage et ce bouton ne font pas partie de ce lot.
- L'`exec` dans un conteneur Kali n'est pas ouvert.

## Plan

Un seul lot. Le brief pour `dev` est la section suivante.

### Objectif

Classer chaque conteneur retenu par `listLabelPrefix` en `exegol` ou `kali`, sans recopier de valeur de label, sans élargir `exec` ni `link` au-delà d'Exegol.

### Fichiers

- `packages/core/src/docker/client.ts`
- `packages/core/src/exegol/targets.ts` (`resolveExegolContainer` seulement ; `lookupContainer` et `EXEGOL_PREFIX` inchangés)
- `packages/core/src/project.ts` (`link` seulement)
- `packages/core/src/reason.ts` (`project.notExegol` à côté des autres `project.*`)
- `packages/messages/src/fr.ts` et `packages/messages/src/en.ts`
- `packages/core/test/docker-label-prefix.test.ts`
- `packages/core/test/helpers.ts` (le faux `docker` doit émettre les signaux, pas `family`)
- `packages/core/test/exegol-targets.test.ts`
- `packages/core/test/project.test.ts`
- `packages/vscode/test/cockpit.test.ts` (ajouter `family` aux objets déjà typés `LabelPrefixContainer`, et un cas start/stop Kali)

`packages/core/src/index.ts` réexporte déjà le client : ne le modifier que si un export manque. Ne pas modifier `packages/core/src/exegol/tool-specs.ts` : il passe les lignes à `resolveExegolContainer`, qui filtre. Ne pas modifier `controlListedContainer`.

### Décision

Reprendre les trois points de la section Décision. Détail que `dev` ne doit pas réinventer :

- Clés d'entrée admises : `state`, `name`, `image`, `workspace`, `exegol`, `runtimeKali`. Toute autre clé, y compris `family`, lève `docker.unexpectedOutput` avec `{ command, line }` et sans le corps.
- `exegol` et `runtimeKali` sont absents ou valent le booléen `true`. Ils ne sont pas recopiés sur `LabelPrefixContainer`.
- Précédence du parseur : `exegol === true` → `exegol` ; sinon `runtimeKali === true` → `kali` ; sinon `image.includes("kali")` → `kali` ; sinon la ligne est ignorée. `Kali` ne suffit pas.
- Le format n'imprime une ligne que si le signal Exegol, le signal runtime, ou `gt (len (split .Config.Image "kali")) 1` est vrai. Il ajoute `,"exegol":true` et `,"runtimeKali":true` comme littéraux, seulement quand le signal est vrai. `{{$v}}`, `{{json $v}}` et `json .Config.Labels` sont interdits. Le montage `/workspace` reste calculé seulement pour une ligne imprimée, comme aujourd'hui.
- `resolveExegolContainer` ne considère que `family === "exegol"`. Les tests existants qui attendent une résolution ajoutent `family: "exegol"`. Ne pas traiter un champ absent comme Exegol.
- `link` : absent de la liste → `project.notFound` ; `family !== "exegol"` → `project.notExegol` avec `{ name }` ; puis les refus déjà là. Libellés : fr `conteneur non Exegol : …`, en `not an Exegol container: …`.
- Le faux docker des trois conteneurs gardés émet `"exegol":true`. Leurs images actuelles (`img:1`, `img:2`, `img:3`) ne contiennent pas `kali`.

### Critères

- Chaque ligne retournée a `family` égal à `exegol` ou `kali`.
- Une ligne avec `exegol: true` et une image qui contient `kali` reste `exegol`, y compris si `runtimeKali: true`.
- Une ligne sans signal Exegol, avec `runtimeKali: true` et une image `debian`, est `kali`.
- Une ligne sans booléen dont l'image contient `kali` est `kali`. Une image `debian` ou `Kali` sans signal est absente, sans erreur.
- Une valeur de label sentinelle n'apparaît ni dans le format, ni dans l'objet parsé, ni dans `docker.unexpectedOutput`.
- `resolveExegolContainer` refuse un dédié ou un `@` dont la seule correspondance est `family: "kali"`, et refuse une entrée sans `family`.
- `link` sur une ligne `kali` en cours, avec `workspace`, lève `project.notExegol` et n'écrit pas `project.json`.
- `controlListedContainer("start", …)` sur une ligne `kali` arrêtée appelle `docker start` avec le nom de la liste.
- `pnpm check` vert. Commit en français, sans pousser.

### Interdits

Pas de formulaire, pas de sélecteur de fichier, pas de projet nouveau, pas de VPN. Ne pas créer de conteneur, ne pas poser de label, ne pas monter de volume, ne pas retirer `/start`. Ne pas élargir `DockerClient.run` ni l'outil MCP `run`. Ne pas filtrer start/stop par famille. Ne pas affaiblir la gate. Pas d'affichage ni de `canLink`.
