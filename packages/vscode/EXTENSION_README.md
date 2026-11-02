# Venator Ops

**Pentest in VS Code, with AI on call.**

Kali · Exegol · Terminaux · Kill chain · Agent IA optionnel

Un espace de travail dans VS Code pour tes CTF, tes labs et tes pentests autorisés. Prépare tes conteneurs, ouvre tes terminaux et rassemble tes découvertes. Travaille à la main ou fais appel à un agent quand tu en as besoin.

**Anciennement Warband.** Retrouve maintenant **Venator Ops** dans VS Code. La mise à jour conserve tes projets, ton historique et tes réglages.

## Tout retrouver au même endroit

- **Cockpit** : crée, démarre et associe tes conteneurs Kali ou Exegol à un projet.
- **Terminaux** : utilise tes outils à la main, sans compte IA.
- **Chat** : fais analyser une sortie, chercher une documentation ou effectuer une vérification avec ton agent.
- **Monitor** : suis les commandes exécutées par l’agent et leurs sorties en direct.
- **Kill chain** : relie tes découvertes, tes hypothèses et tes tentatives échouées dans un graphe.
- **Preuves et rapport** : capture une observation, exporte le graphe en SVG et prépare un brouillon de rapport Markdown.

Le cockpit, les terminaux, la capture manuelle de preuves et les exports fonctionnent sans connexion à une IA.

## Commencer

Il te faut **VS Code 1.90 ou plus** et **Docker installé et démarré** pour les conteneurs. Les paquets VSIX sont disponibles pour **Windows x64** et **Linux x64** ; tu n’as pas besoin d’installer Node.js ou de compiler le projet.

Si VS Code affiche le **mode restreint**, approuve d’abord ton dossier si tu lui fais confiance : l’extension reste désactivée tant qu’il ne l’est pas.

1. Ouvre la palette (`Ctrl+Maj+P`) et lance **Venator Ops : ouvrir les réglages**. Dans **Projet**, crée un projet avec un nom et un dossier, ou active un projet existant. Approuve le dossier dans VS Code si tu lui fais confiance.
2. Ouvre le **Cockpit**, associe un conteneur existant ou prépare-le avec **Nouveau conteneur**, puis démarre-le.
3. Lance **Venator Ops : ouvrir ou restaurer l’espace Venator Ops** pour retrouver le chat, la Kill chain et le Monitor. Ouvre un terminal pour travailler à la main.
4. Pour utiliser l’agent, ouvre **Configurer** dans le chat, choisis **Claude**, **OpenAI** ou **OpenCode**, configure la connexion et sélectionne un modèle disponible sur ton compte.

Les abonnements et les frais API dépendent de ton fournisseur ; ils ne sont pas inclus. Sous Windows, Claude nécessite [Git pour Windows, avec Git Bash](https://git-scm.com/downloads/win).

## Montre-lui où tu en es

Utilise **`@`** pour citer un conteneur du projet et **`#`** pour joindre un extrait d’un terminal ouvert par l’extension. Choisis l’entrée dans le menu de mentions, puis formule ta demande :

> Résume mes observations et propose les deux prochaines vérifications utiles. Explique pourquoi avant de proposer une commande.

Le Monitor suit les exécutions de l’agent ; utilise `#` pour lui transmettre les commandes que tu as tapées toi-même dans un terminal ouvert par l’extension.

Tu peux joindre du texte, du code et des journaux : **10 fichiers maximum**, **64 Kio chacun**, **256 Kio au total**. Les PDF et les images doivent être convertis en texte avant d’être fournis.

## Apprendre avec des indices

Dans **Réglages → Atlas → Ouvrir le dossier de cours**, dépose tes cours ou tes notes en **`.md` ou `.txt`**, avec un sous-dossier par source. Aucun cours n’est inclus. Active ensuite **Apprentissage** dans **Configurer**.

L’agent consulte tes cours, explique et peut t’aider à partir d’un extrait de terminal joint avec `#`. Il **n’exécute aucune commande et ne modifie aucun fichier** dans ce mode.

> Je bloque sur cette étape. Appuie-toi sur mes cours et sur cet extrait de terminal pour me donner un indice, sans toute la solution.

## Contrôler les actions et conserver les résultats

Quand une action demande ton accord, une carte te permet de l’autoriser une fois ou de la refuser. **Toujours**, lorsqu’il est proposé, mémorise ton choix après confirmation. Certaines lectures sont autorisées directement ; certaines actions sont refusées par les règles.

Le **Bypass**, activé explicitement pour une durée limitée, autorise automatiquement les demandes traitées par le contrôle d’approbation, y compris celles normalement refusées. Il ne change pas le mode Apprentissage.

Dans la palette, cherche **Venator Ops : Capturer la sélection comme preuve**, **Venator Ops : Capturer un extrait du journal terminal** ou **Venator Ops : Lister les preuves du projet**. La Kill chain propose l’export SVG et un brouillon Markdown pour ton rapport. Complète et vérifie les preuves, la gravité et les remédiations avant livraison.

## Accès rapide

Appuie sur `Alt+J`, relâche, puis sur la seconde touche :

| Raccourci | Action |
| --- | --- |
| `Alt+J Alt+J` | Lanceur |
| `Alt+J T` | Terminal |
| `Alt+J C` | Chat latéral |
| `Alt+J N` | Nouveau chat dans l’éditeur |
| `Alt+J K` | Cockpit |
| `Alt+J M` | Monitor |
| `Alt+J G` | Kill chain |
| `Alt+J S` | Réglages |

Un conteneur manque ? Vérifie Docker, le projet actif et ses conteneurs associés. Aucun modèle ne s’affiche ? Vérifie la connexion dans **Configurer**, puis actualise la liste.

## Télécharger et mettre à jour

La distribution actuelle se fait par [releases GitHub](https://github.com/tomtimlt/warband/releases), sans publication Marketplace pour le moment. Télécharge le `.vsix` adapté à ton système, puis utilise **Extensions → … → Installer à partir de VSIX…**. Répète cette opération avec le nouveau paquet pour une mise à jour.

[Présentation et installation](https://github.com/tomtimlt/warband#readme) · [Signaler un problème](https://github.com/tomtimlt/warband/issues)

## Choisir une méthode

La commande **Venator Ops : choisir un skill / profil agent** propose Mentor,
Bug bounty, Out of the box, Red team et Hack The Box. Le résumé du profil choisi
guide le prochain tour ; la méthode détaillée est chargée au besoin. Mentor
aide par indices graduels, Bug bounty organise les preuves, Out of the box
départage les hypothèses, Red team suit les objectifs de l’exercice et HTB
adapte la progression au challenge. Le mode Apprentissage conserve son
fonctionnement dédié aux cours, sans exécution.
