# Lot P — interface de l'ADR 0054 (racine commune, conteneurs en pool)

Statut : cadré le 2026-11-27, après les lots M1 et M2. Ne redécide pas l'ADR 0054 (racine commune et conteneurs en pool).

## Décision

1. **Racine demandée une fois, partout.** `requireCommonRoot` sort de la fermeture du cockpit (`extension.ts`, ~l.1623) et devient un utilitaire de l'extension, appelé par la création de projet, l'adoption, l'import, le déplacement et la création de conteneur. Il s'appuie sur `ensureRoot` (`logic/container-root.ts`) : réglage `warband.root` lu, sinon modale « Où ranger les projets et les conteneurs ? » puis sélecteur natif, enregistré une seule fois. Annulation : rien n'est écrit. Le repli sur le partage du conteneur est supprimé.
2. **Nouveau projet sans conteneur.** Le studio n'envoie plus de conteneur (`createProject {name}`, `adoptProject {name}`, `importProject {}`). Création sous `<racine>/projets/<slug>` par `createManagedProject(configDir, name, root)` sans `primary`. Adoption : sélecteur natif ouvert sur `<racine>/projets`, tout dossier accepté par `adoptProjectDirectory` (plus de garde `project.outsideShare`). Un projet adopté hors racine s'affiche « Aucun conteneur ne voit ce projet ».
3. **Visibilité calculée par l'hôte, tous états.** Fonction pure dans `project-controls.ts` : pour chaque projet, les conteneurs de famille connue dont un montage (`rowMounts`, `projectContainerPath`) couvre son dossier, démarrés ou arrêtés. `unassociated` = projets sans aucun conteneur visible (liste Docker indisponible : rien n'est affirmé). Le tour, lui, reste borné par `visibleContainerNames` (démarrés).
4. **Carte projet (studio, panneau « Choisir un projet »).** Pour le projet choisi : « Vu par : … » (arrêtés suffixés), sélecteur « Conteneur par défaut » limité aux conteneurs qui le voient, plus « Aucun ». Sinon : « Aucun conteneur ne voit ce projet. » et deux boutons : « Créer un conteneur » (ouvre le cockpit, formulaire ouvert) et « Déplacer vers la racine… ».
5. **Déplacement vers la racine.** `relocateProject(projectId, deps)` sans conteneur : destination `<racine>/projets`, modale native obligatoire, `moveProjectWorkspace`, aucune association ni `primary` posé. Déjà sous `<racine>/projets` : refus sans écriture. Même message pour le studio et le bandeau du cockpit (`relocateProject {projectId}`).
6. **Cockpit.** Plus de bouton « Lier » ni de message `link`, ni de `canLink`/`linkTitle`. Chaque carte liste les projets qu'elle voit (tous montages, pas seulement `/workspace`) ; liste vide = conteneur libre. Étiquette « voit le projet » si le conteneur voit le projet actif ; « Par défaut » remplace « Principal » ; le bouton « Par défaut » est proposé sur tout conteneur qui voit le projet actif et n'est pas déjà le défaut.
7. **Suppression du parcours d'association.** `linkForProject`, `linkWithProjectWorkspace`, `recoverWorkspaceLink`, `unlinkedContainerMentions`, le fichier `logic/project-container-link.ts` et son test, les messages chat `linkMention`/`ignoreLinkMention`/`containerLinks` et `proposedLinks`. `link()` du cœur reste (lot D). Le bandeau du chat renvoie au cockpit. `warband.prepareMission` et le terminal d'éditeur (workdir, ~l.1028) utilisent la visibilité au lieu de `projectContainerNames`.
8. **Hors lot (voie moteur, orchestrateur)** : allowlist du terminal de preuves (`evidenceTerminalAllowed(projectContainerNames(...))`, ~l.3782 et ~l.3794) et `projectId` du shell (~l.1046). Ces lignes ne bougent pas dans le lot P.

## Textes (fr exacts, à ajouter aux domaines `studio`, `cockpit`, `chat` de `packages/messages/src/ui-domains/`, en minimal)

Ajouts :
- « Ouvrir un dossier existant… » (remplace « Dossier existant dans ce conteneur… »)
- « Les projets sont créés dans le dossier projets de la racine commune. » (remplace l'aide de création)
- « Vu par : {0} » ; « {0} (arrêté) » ; « Aucun conteneur ne voit ce projet. »
- « Conteneur par défaut » ; « Aucun »
- « Créer un conteneur » ; « Déplacer vers la racine… »
- Modale : « Déplacer le projet « {0} » vers la racine commune ? », détail « Le dossier {0} sera déplacé sous {1}. Les conteneurs qui voient la racine commune le verront. », action « Déplacer » (existant)
- « Le projet est déjà dans la racine commune. »
- Cockpit : « voit le projet » (remplace « lié ») ; « Par défaut » (remplace « Principal ») ; title « Conteneur proposé en premier pour ce projet » ; « Projets visibles » (remplace « Projets dans ce conteneur ») ; « Aucun projet visible : conteneur libre. » (remplace « Aucun projet dans ce partage. »)
- Chat : « Aucun conteneur ne voit ce projet : l'agent n'a pas de shell » ; bouton « Ouvrir le cockpit »
- `prepareMission` : « Aucun conteneur démarré ne voit ce projet : créez un conteneur ou déplacez le projet vers la racine. »

Retraits (si plus aucun usage) : « Conteneur du projet », « Créez d'abord un conteneur. », « Choisissez le conteneur du projet, puis donnez-lui un nom. », « Déplacer dans un conteneur… », « Lier », « Lier un conteneur », « Association indisponible », « Créer un conteneur pour ce projet », « Choisir un autre conteneur », « Compatible avec le projet actif », « Aucun conteneur affiché. Gérez les associations dans le cockpit. », « Définir comme conteneur principal (affichage seulement) ». Erreurs : réutiliser « Ce conteneur ne voit pas le dossier du projet. » et « Opération annulée » ; aucun nouveau code de raison.

## Sous-lots (séquentiels, mêmes fichiers)

**P1 — Projets : création, import, déplacement, carte.** `extension.ts` (racine partagée, handlers studio `createProject`/`adoptProject`/`importProject`/`relocateProject`/`setProjectPrimary`, handler cockpit `relocateProject`), `logic/project-controls.ts`, `logic/project-relocate.ts`, `logic/project-archive.ts` (import sous `prepareCommonRoot(root).projects`, sans conteneur ni `primary`), `logic/studio.ts` (messages et charge utile : visibilité par projet), `logic/cockpit.ts` (parse `relocateProject {projectId}`), `media/studio.js`, bouton du bandeau dans `media/cockpit.js`, `messages` (studio, cockpit), `media/i18n.js` régénéré (`node scripts/sync-ui-i18n.mjs`), tests `project-controls`, `project-relocate`, `project-archive`, `studio`, `cockpit`.

**P2 — Cockpit et chat : fin de l'association.** `extension.ts` (suppression `linkForProject`, `proposedLinks`, `linkMention`, case `link`, `setPrimary` sur visibilité, `prepareMission`, workdir du terminal ~l.1028), `logic/cockpit.ts` (vue), `logic/approval.ts`, `logic/html.ts`, suppression `logic/project-container-link.ts` et `test/project-container-link.test.ts`, `media/cockpit.js`, `media/chat.js`, `messages` (cockpit, chat), `media/i18n.js`, tests `cockpit`, `cockpit-render`, tests chat concernés.

## Critères (les deux sous-lots)

- `pnpm check` vert ; `git grep` sans résultat pour `linkWithProjectWorkspace`, `recoverWorkspaceLink`, `linkMention`, `canLink`, `"Lier"` dans `packages/vscode` (après P2) ; `link` du cœur toujours exporté.
- Tests : création sans conteneur sous `<racine>/projets` ; racine absente → `ensureRoot` appelé une fois, annulation → aucune écriture ; import sans conteneur sous `<racine>/projets`, sans `primary` ; un message webview portant un chemin ou un `container` superflu est rejeté par le parseur ; déplacement refusé sans confirmation, refusé si déjà sous la racine, refusé pendant un tour ; visibilité : projet sous `projets` monté vu par un conteneur arrêté et un démarré, conteneur libre avec liste vide ; `setProjectPrimary` refuse un conteneur qui ne voit pas le projet ; cockpit sans bouton « Lier » ; catalogues fr/en exhaustifs.

## Interdits

`packages/core` (dont `link()`, `projectContainerNames`, montages, `prepareContainerProjectWorkspace`), gate, politique, secrets, `safeEnv`, règles `docker run`, montages posés à la création des conteneurs, terminal de preuves (point 8). Aucun chemin accepté de la webview. Aucun identifiant de modèle.
