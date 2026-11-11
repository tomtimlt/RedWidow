# Recette manuelle V1 — RedWidow

Version testée : `1.0.x` (celle de la release du jour, `redwidow-<version>-<plateforme>.vsix`). Machine : ______ · Date : ______ · Testeur : ______

Règle : un KO donne un correctif, puis on rejoue le scénario. Sous Windows, tous les scénarios doivent être OK. Sous Linux, au minimum 1 à 5, 10 et 13.

Pour chaque étape, coche OK ou KO et note la preuve (capture, chemin de fichier, message exact).

**Avant de commencer**
- Docker Desktop est lancé et affiche « Engine running ».
- Dans Docker Desktop › Settings › Resources › File sharing, le dossier parent de tes dossiers partagés est déclaré, par exemple `C:\Me\Test-Warband`.
- Le réseau laisse passer `kali.download` et `http.kali.org`. Un réseau d'entreprise peut renvoyer « 403 Forbidden » : utilise alors un autre réseau pour construire l'image Kali.
- Tu as un jeton Claude ou une clé API. Pour OpenCode, un modèle qui répond : `opencode/deepseek-v4.1-flash-free` a déjà répondu 403.

---

## 1. Installation et premier lancement

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 1.1 | Extensions › `···` › « Install from VSIX… » › `redwidow-<version>-<plateforme>.vsix` | Installation sans erreur | ☐ | ☐ |
| 1.2 | Ouvrir un dossier et lui faire confiance (« Trust ») | Sans confiance, l'extension reste inerte : c'est normal | ☐ | ☐ |
| 1.3 | Cliquer l'icône « RedWidow » de la barre d'activité | La vue « Chat » s'ouvre sans erreur | ☐ | ☐ |
| 1.4 | Si une ancienne version « warband » était installée : ouvrir « Historique » › « Tous les projets » | Les anciennes conversations apparaissent (ADR 0051) | ☐ | ☐ |

## 2. Conteneurs (Kali, Exegol)

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 2.1 | Palette « RedWidow : ouvrir le cockpit » | Ordre : carte « Conteneur lié », liste « Conteneurs », puis création. La création est en tête si aucun conteneur n'est lié | ☐ | ☐ |
| 2.2 | « Nouveau conteneur » | Le panneau s'ouvre et le bouton disparaît. La croix referme le panneau et fait revenir le bouton | ☐ | ☐ |
| 2.3 | Nom saisi, image, « Dossier partagé » › « Choisir… » | Dialogue natif. Le chemin choisi s'affiche. « Créer » reste grisé tant qu'aucun dossier n'est choisi | ☐ | ☐ |
| 2.4 | « Choisir… » sur `C:\`, sur le dossier personnel, puis sur `.ssh` | Refus : « …il expose des données sensibles » | ☐ | ☐ |
| 2.5 | « Créer » avec l'image « Kali RedWidow complète (construction locale) » | Les étapes avancent (Image → Téléchargement/Construction → Démarrage → Vérification MCP → Liaison), le bouton affiche « Création… » et le formulaire reste rempli. Réussite : coche et « Voir le conteneur ». Échec : étape en rouge, code et lignes d'erreur Docker, « Réessayer » | ☐ | ☐ |
| 2.6 | « Créer » avec un dossier non déclaré dans Docker Desktop | Message clair « Docker Desktop ne partage pas le dossier … Settings > Resources > File sharing… » | ☐ | — |
| 2.7 | Dossier partagé qui contient le dossier du projet actif | Le conteneur est « lié ». Sinon : « Conteneur créé sans liaison… », sans erreur | ☐ | ☐ |
| 2.8 | Carte liée | « Image » et « Dossier hôte » visibles sans clic. Boutons « Terminal » et « Ouvrir le dossier ». La liste porte « Arrêter », « Supprimer » et « Lier » | ☐ | ☐ |
| 2.9 | « Terminal » | Un shell s'ouvre dans le conteneur, dans `/workspace` | ☐ | ☐ |
| 2.10 | Exegol (seulement si Exegol est installé sur l'hôte) : créer, puis lancer un run qui exécute une commande | `mcp__exegol__exec` visible dans le Monitor | ☐ | ☐ |

## 3. OpenCode

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 3.1 | « RedWidow : ouvrir les réglages » › Fournisseurs IA › « Rechercher un fournisseur… » | Le catalogue s'affiche. La connexion est « gérée par OpenCode » | ☐ | ☐ |
| 3.2 | « Tester la connexion » | Succès | ☐ | ☐ |
| 3.3 | Chat : choisir OpenCode et un modèle, puis envoyer un message simple | Réponse affichée, compteur d'outils cohérent | ☐ | ☐ |

## 4. Claude Agent SDK

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 4.1 | « RedWidow : définir le jeton » › « Jeton d'abonnement » ou « Clé API » | « Jeton enregistré et appliqué. » | ☐ | ☐ |
| 4.2 | Chat : fournisseur Claude, message qui demande la lecture d'un fichier | Carte d'approbation, puis réponse. Le binaire empaqueté fonctionne (jamais vérifié en vrai) | ☐ | ☐ |

## 5. Projet, fiche programme, politique

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 5.1 | Réglages › Projet › « Nouveau projet » (nom), puis « Activer le projet » | Le dossier du projet s'ouvre dans la fenêtre. Activation refusée pendant un tour | ☐ | ☐ |
| 5.2 | « RedWidow : ouvrir la fiche programme » › « Remplir par IA » ou saisie › « Valider la fiche… » | La modale affiche « Empreinte : … ». L'état passe de « Brouillon, non validé » à « Validée et appliquée » | ☐ | ☐ |
| 5.3 | Demander à l'agent une cible de la section « Hors périmètre » | Refus de la gate, non mémorisable | ☐ | ☐ |
| 5.4 | Avec un `.warband/policy.json` dans le dossier : Réglages › Projet › « Politique du dépôt » › « Relire et approuver… » (ou palette « RedWidow : approuver la politique du dépôt ») | Le fichier s'ouvre, puis une modale affiche l'empreinte. « Approuver » fait passer l'état à « approuvée ». Si le fichier est modifié pendant la modale, l'approbation est refusée. Espace de travail non approuvé : refus | ☐ | ☐ |

## 6. Rythme

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 6.1 | Laisser le rythme arrêter un hôte (l'arrêt est automatique, il n'y a pas de bouton manuel) | L'hôte apparaît dans la fiche programme › « Rythme » › « Hôtes arrêtés » | ☐ | ☐ |
| 6.2 | « Reprendre » sur l'hôte | Confirmation « Reprendre l'hôte … ? », puis l'hôte est repris. En CLI : `resume <hôte>` | ☐ | ☐ |

## 7. Bypass

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 7.1 | Chat › « Configurer » › interrupteur Bypass › « Heures » / « Minutes » (1 min à 48 h) › « Activer » | Badge « BYPASS » avec l'heure de fin, barre d'état « BYPASS · … ». **Plus de bandeau « Couper »** | ☐ | ☐ |
| 7.2 | « Illimité » › « Activer » | Badge « BYPASS · ∞ » | ☐ | ☐ |
| 7.3 | Couper avec l'interrupteur du chat, puis avec la palette « RedWidow : Désactiver le Bypass des approbations », puis avec un clic sur la barre d'état | Le Bypass s'éteint dans chaque cas | ☐ | ☐ |
| 7.4 | Bypass de 1 min, attendre | « Bypass terminé. » | ☐ | ☐ |
| 7.5 | Bypass actif, arrêter le moteur ou changer de projet | Bypass éteint | ☐ | ☐ |
| 7.6 | Bypass actif, chemin sensible demandé par l'agent | Contourné seulement si un humain répond à la demande, jamais mémorisé | ☐ | ☐ |

## 8. Engagement red team

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 8.1 | « RedWidow : ouvrir l'engagement » › « Importer un fichier… » › « Valider l'engagement… » | Modale avec empreinte, engagement validé | ☐ | ☐ |
| 8.2 | « Valider le plan… » | Plan de campagne validé | ☐ | ☐ |
| 8.3 | « Arrêt d'urgence » › « Activer… » | Modale de confirmation, puis plus aucun outil n'est exécuté. L'arrêt survit à la fermeture de VS Code | ☐ | ☐ |
| 8.4 | « Lever l'arrêt… » | Reprise possible | ☐ | ☐ |

## 9. Supervision « Acharné »

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 9.1 | Configurer › Encadrement › « Acharné » (OpenCode) | Le réglage est verrouillé pendant un tour | ☐ | ☐ |
| 9.2 | Lancer une tâche longue | « Relance automatique n/20 · k piste(s) ouverte(s) » visible (rendu en direct jamais vérifié). Avec Claude, la relance automatique n'existe peut-être pas : noter ce qu'on observe | ☐ | ☐ |

## 10. Monitor, export, audit, trace

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 10.1 | Bouton Monitor de la zone de saisie | Événements, outils et approbations listés | ☐ | ☐ |
| 10.2 | « Exporter le fil » | Fichier `<projet>/exports/fil-<runId>` écrit, sans dialogue | ☐ | ☐ |
| 10.3 | Réglages › Projet › Audit › « Exporter le dossier d'audit » | ZIP contenant `index.html`, `tests.json`, `evidence.json`, `chat.md` et `journals/*.jsonl` | ☐ | ☐ |
| 10.4 | `node packages/cli/dist/main.js --lang fr trace <audit.zip>` (options `--json`, `-n 10`) | Synthèse du run sans erreur | ☐ | ☐ |

## 11. Rapport, Kill chain, Attack Flow

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 11.1 | Icône Kill chain de la vue chat (elle n'est plus dans les Réglages) | Onglet « RedWidow · Kill chain » ouvert. Un projet actif est requis | ☐ | ☐ |
| 11.2 | « Exporter le brouillon », « Aperçu du rapport » | `rapport-warband.md` écrit, aperçu lisible | ☐ | ☐ |
| 11.3 | « Exporter l'image », « Attack Flow » | `killchain-warband.svg` et `attack-flow-warband.json` écrits | ☐ | ☐ |

## 12. Historique entre projets (nouveau)

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 12.1 | Deux projets, une conversation dans chacun. « Historique » › « Tous les projets » | Les deux conversations sont visibles. Le filtre par projet fonctionne | ☐ | ☐ |
| 12.2 | Clic sur la conversation de l'autre projet | « Lecture seule : … » s'affiche avec le fil | ☐ | ☐ |
| 12.3 | « Reprendre » | Avertissement « Cette conversation appartient au projet « … » » avec « Changer de projet » | ☐ | ☐ |
| 12.4 | « Annuler » | Rien ne change | ☐ | ☐ |
| 12.5 | « Changer de projet » | Le projet change, puis la conversation se rouvre en lecture seule dans la fenêtre du projet. « Reprendre » marche alors | ☐ | ☐ |
| 12.6 | Deuxième fenêtre VS Code : y créer une conversation, puis rouvrir « Historique » dans la première | La nouvelle conversation apparaît (dépend de VS Code : noter le résultat) | ☐ | ☐ |

## 13. Désinstallation

| # | Étape | Résultat attendu | Win | Linux |
|---|---|---|---|---|
| 13.1 | « RedWidow : effacer le jeton », puis supprimer les conteneurs dans le cockpit | Jeton effacé, conteneurs supprimés | ☐ | ☐ |
| 13.2 | Désinstaller l'extension | Ce qui reste et peut être supprimé à la main : `%APPDATA%\warband` (ou `~/.config/warband`), dossiers des projets (`~/.exegol/workspaces` ou la racine réglée), stockage VS Code de `tomtimlt.redwidow` (et de l'ancien `warband.warband`) | ☐ | ☐ |

---

## Écarts connus entre la doc et le code (à corriger après la recette)

- Durée maximale du Bypass : le code va jusqu'à 48 h ou illimité, alors que `docs/extension-vscode.md` et `EXTENSION_README.md` disent 2 h ou 4 h.
- `docs/extension-vscode.md` cite encore la Kill chain et le Contrôle système dans les Réglages, l'ancien nom « Warband : … » des commandes, une version 0.3.32 et une liste de palettes périmée.
- Aucune section Engagement dans la doc utilisateur. Aucune procédure de désinstallation.
