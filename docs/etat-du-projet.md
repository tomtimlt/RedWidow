# Warband — parcours, état actuel et reprise

État inspecté le 24 octobre 2026. Ce document sert de point d'entrée produit ;
les ADR expliquent les décisions, les idées restent une réserve.

## Le parcours de référence

**Choisir un projet → associer ses conteneurs → travailler avec l'agent →
approuver les actions nécessaires → consulter les résultats et les traces.**

Le projet regroupe le dossier de travail, les conteneurs autorisés et les
trouvailles. Le conteneur affiché comme principal facilite la navigation ; il
n'autorise pas à lui seul une exécution. Le mode Apprentissage constitue un
parcours distinct, en lecture seule sur les cours.

## Quelle version décrit-on ?

Base intégrée inspectée : `main` à `8682ea2`, après fusion des PR #14
(Bypass) et #15 (résumé de projet). Le tag `v0.3.19` pointe sur ce commit.
Cela confirme l’intégration et l’existence du tag, pas à lui seul le succès
du workflow ni la disponibilité des VSIX. Les résultats de validation et la
publication du lot suivant seront consignés après exécution.

## Lot 0.3.20 — état et validation

Les changements ci-dessous constituent le lot 0.3.20 ; les contrôles automatisés
décrits ici sont réussis. Le succès de publication sur GitHub doit être vérifié
séparément ; le parcours réel Windows/VS Code reste à valider.

### Preuves de validation automatisée

- `pnpm check` : **74 fichiers de tests réussis, 1 634 tests réussis,
  12 tests ignorés** ; Biome signale **29 avertissements**.
- `pnpm build` et contrôles CLI : réussis.
- Smoke Chromium : choix/création de projet, verrouillage des contrôles pendant
  un travail en cours, édition du résumé, conservation du brouillon, retours de
  sauvegarde/erreur après navigation et filtre d’historique réussis.
- Prévisualisations Chromium : **30 rendus sans débordement horizontal** ;
  navigation lisible à 280 px.
- Empaquetages finaux VSIX Linux et Windows : réussis. Manifestes, médias
  finaux, bundles et empreintes SHA-256 des binaires embarqués vérifiés.
- Moteur Linux empaqueté : échange IPC `ready`/`start`, puis refus attendu
  `auth.missingApiKey`, **sans appel API** ; empreinte du binaire conforme.
  Ce contrôle valide le démarrage et le refus d’authentification, pas un tour
  d’agent avec un fournisseur réel.

La base 0.3.19 avait également passé les contrôles avec 1 615 tests. Ces
résultats ne constituent pas une validation dans VS Code/Windows.

## Inventaire du parcours

« Présent » signifie repéré dans le code, pas validé ici dans un VS Code réel.

| Étape | Présent dans le code de travail | Limite ou travail restant |
|---|---|---|
| Choisir un projet | Page Projet : liste réelle, activation, création avec nom et dossier choisi par dialogue natif ; stockage et associations | Changement de projet bloqué pendant un tour actif ; vérifier le parcours dans VS Code réel |
| Associer ses conteneurs | Cockpit, Exegol/Kali, création et cycle de vie pilotés par l'humain, association, choix du conteneur affiché | Distinguer conteneurs autorisés et conteneur affiché ; ne pas présenter les dossiers hôtes supplémentaires comme livrés |
| Travailler avec l'agent | Chat, plusieurs conversations, mentions, choix de modèle/effort, outils Exegol/Kali, apprentissage | L'extension construit le runner Claude ; OpenCode existe dans la CLI mais reste désactivé dans le sélecteur du chat |
| Approuver | Gate, cartes de réponse, Bypass borné | Le Bypass universel de la 0.3.19 est décrit ci-dessous |
| Consulter les résultats | Trouvailles par projet, Kill chain avec minimap, Monitor, historique, journaux et export HTML CLI | Historique filtré par projet et édition du résumé réalisés ; rapport d’engagement encore à concevoir |

## Fonctions intégrées en 0.3.19

### Mémoire et historique de projet — ADR 0016

- S1 : stockage d'un résumé par projet, masqué et plafonné à 8 Kio.
- S2 : outil `remember`, injection du résumé au démarrage d'une conversation
  neuve, neutralisation des fermetures de balises dans le bloc injecté.
- Ajouts 0.3.20 : H1 réalisé, avec association immuable de la conversation
  à son projet et filtre d’historique. L’envoi et la reprise sont bloqués si
  le projet actif diffère ; une ancienne conversation exige de revenir à son
  contexte de projet, sans réattribution automatique.
- Édition du résumé réalisée dans la page Projet : texte réel, limite 8 Kio,
  brouillon conservé, retour d’enregistrement et erreurs explicites.

Mémoire de projet et historique des conversations sont deux fonctions
différentes : un résumé disponible ne signifie pas que l'historique est filtré.

### Bypass — ADR 0017

La 0.3.19 remplace le Bypass limité de la 0.3.18 par une autorisation ponctuelle
de tout verdict non autorisé, refus compris, si le Bypass est actif et qu'un
Asker est fourni. L'Asker est le canal de réponse : sa présence ne signifie
pas que l'humain confirme chaque action pendant le Bypass. Aucune règle n'est
mémorisée ; le journal conserve la cause du verdict initial. L'apprentissage
et la CLI sans Asker restent exclus.

Ce contrat doit être décrit uniformément dans l'interface et la documentation
dans les versions intégrées. Il ne rend pas automatiquement disponibles les outils que
le runner n'expose pas et ne supprime pas les validations hors de la gate.

## Simplification réalisée et suites

Les réglages passent de treize rubriques à cinq pages utilisables : **Projet,
Conteneurs, Kill chain, Atlas, Contrôle système**. Les pages vides ne figurent
plus dans la navigation quotidienne. Projet sert à choisir/créer le projet et
éditer son résumé ; le cockpit reste l’espace de gestion des conteneurs.
Les guides séparent désormais code présent, décisions historiques et limites
non validées.

1. **Base intégrée : fait.** PR #14/#15 fusionnées, base `8682ea2`, tag
   `v0.3.19` et contrôles de base confirmés.
2. **Lisibilité : réalisée, contrôles automatisés réussis.** Navigation réduite,
   parcours central et documentation remis en cohérence.
3. **Boucle par projet : réalisée, contrôles automatisés réussis.** Choix et
   création de projet, H1, filtre d’historique, garde de contexte et édition
   du résumé. Les contrôles UI n’effectuent pas de transaction avec un outil
   externe qui modifierait les fichiers de projet pendant un tour : éviter
   ces écritures concurrentes.
4. **Validation automatisée : réussie.** Suite, build, CLI, smoke résumé/filtre,
   rendus et démarrage du moteur empaqueté vérifiés ci-dessus. Empaquetages finaux des deux cibles et smoke projet complémentaires réussis. Le parcours réel sous
   Windows/VS Code reste non exécuté ; utiliser la recette ci-dessous.
5. **Release 0.3.20 : artefacts validés localement.** Le tag déclenche la
   publication ; vérifier le workflow et les deux VSIX distants avant
   d’annoncer la disponibilité sur GitHub.

Travaux à garder séparés de cette stabilisation : dossiers hôtes supplémentaires,
rapport d'engagement, intégration Kali complète de l'ADR 0014, OpenCode dans
l'extension. Pour Kali, le toolset est déjà branché sur main : comparer aux
critères exacts de K2 avant de reprendre « à faire » comme absence totale.
Leur priorité n'est pas encore décidée ; aucune nouvelle implémentation n'est
engagée par ce document.

## Règle de release

`.github/workflows/release.yml` se déclenche au push d'un tag `vX.Y.Z`, pas au
simple push de `main`. Le tag doit correspondre à la version de
`packages/vscode/extension.manifest.json`. Il exécute les contrôles et le build,
empaquette `linux-x64` et `win32-x64`, produit les empreintes SHA-256 et publie
les fichiers dans une release GitHub. Vérifier le résultat du workflow et les
artefacts avant d'annoncer que la version est téléchargeable.

## Rôle des documents

- Ce fichier : où en est le parcours et quel travail reprendre.
- README et guide de l'extension : comment utiliser la version actuelle.
- ADR : pourquoi une décision a été prise ; un statut « accepté » ne prouve
  pas son implémentation ni sa validation.
- Suivi d'architecture : lots techniques et preuves de livraison.
- Idées : possibilités non engagées, à recouper avec le code avant cadrage.

## Recette manuelle Windows / VS Code — version 0.3.20

Cette recette reste à exécuter sur Windows ; les tests automatisés Linux et
les captures Chromium ne la remplacent pas. Utiliser les VSIX issus du tag de
la version, garder les journaux utiles et noter chaque résultat.

| Essai | Résultat attendu |
|---|---|
| Installer le VSIX Windows et ouvrir un dossier approuvé | Extension active, aucun défaut de chargement ; dossier non approuvé : exécution inactive |
| Choisir A, associer un Exegol ou Kali autorisé | Projet et conteneurs affichés correctement ; choix du principal sans changer l’allowlist |
| Créer un chat sous A, envoyer une consigne simple | Modèle et contexte cohérents ; exécution visible dans Monitor |
| Demande d’approbation hors Bypass, puis refus | Refus respecté ; résultat et état de l’outil visibles |
| Activer puis désactiver le Bypass sur une opération de test maîtrisée | Avertissement explicite, absence de demande pendant activation, retour à la politique ensuite ; cause tracée |
| Écrire/lire/modifier le résumé de A | Texte réel affiché et conservé ; nouveau chat reçoit le résumé, B reste indépendant |
| Filtrer l’historique et reprendre sous A | Conversations de A identifiables ; reprise sans réattribution |
| Passer sur B avec un chat de A ouvert, envoyer ou reprendre | Envoi/reprise bloqués avec explication ; aucune bascule automatique du projet |
| Consulter une ancienne conversation sans projet sous B | Lecture possible ; reprise bloquée tant que le contexte ne correspond pas |
| Noter une trouvaille et ouvrir Kill chain/minimap | Trouvaille du bon projet, navigation du graphe et de la minimap utilisable |
| Stopper une exécution puis fermer/recharger VS Code | Processus arrêtés ; historique et résumé persistants |
