<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/vscode/media/logo.svg">
  <img src="docs/img/logo-clair.svg" alt="Logo Venator Ops" width="96" height="96">
</picture>

# Venator Ops

**Ton pentest. Un seul cockpit.**

Kali · Exegol · Terminaux · Kill chain · Agent IA optionnel

Un espace de travail dans VS Code pour tes CTF, tes labs et tes pentests autorisés.
Prépare ton environnement, garde tes terminaux sous la main et rassemble tes découvertes.
Travaille à la main ou fais appel à un agent quand tu en as besoin.

[Télécharger](https://github.com/tomtimlt/warband/releases) · [Premiers pas](#ta-première-mission) · [Signaler un problème](https://github.com/tomtimlt/warband/issues)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/paysage-chat-sombre.png">
  <img src="docs/img/paysage-chat-clair.png" alt="Le chat dans VS Code, avec une demande d’autorisation avant une action de l’agent" width="900">
</picture>

</div>

> **Anciennement Warband.** Dans cette version, l’extension installée, ses commandes et certains écrans portent encore le nom **Warband**. Cherche ce nom dans VS Code pour les retrouver.

## Ce que tu peux faire

| Tu veux… | Tu utilises… |
| --- | --- |
| Préparer ton environnement | Le **Cockpit** pour créer, démarrer et associer tes conteneurs Kali ou Exegol à un projet. |
| Garder la main sur tes outils | Les **terminaux** dans VS Code, sans connexion à une IA. |
| Te faire aider pendant une mission | Le **chat** pour analyser une sortie, chercher de la documentation, proposer une piste ou exécuter une vérification. |
| Suivre ce que lance l’agent | Le **Monitor**, avec les commandes et leurs sorties en direct. |
| Comprendre ton parcours | La **Kill chain**, un graphe de tes découvertes, hypothèses et tentatives échouées. |
| Préparer ton compte rendu | Les **captures de preuves**, l’export du graphe en SVG et un **brouillon de rapport Markdown** à compléter. |

**Pas envie d’utiliser d’IA ?** Le cockpit, les terminaux, la capture manuelle de preuves et les exports restent disponibles. Aucun compte IA n’est nécessaire pour ces fonctions.

## Installer l’extension

Il te faut **VS Code 1.90 ou plus** et **Docker installé et démarré** pour travailler dans des conteneurs. Les paquets sont disponibles pour **Windows x64** et **Linux x64**. Tu n’as pas besoin d’installer Node.js ou de compiler le projet.

1. Ouvre la page des [releases](https://github.com/tomtimlt/warband/releases) et télécharge le fichier `.vsix` adapté à ton système :

   | Système | Fichier à choisir |
   | --- | --- |
   | Windows x64 | Celui qui se termine par `-win32-x64.vsix` |
   | Linux x64 | Celui qui se termine par `-linux-x64.vsix` |

2. Dans VS Code, ouvre **Extensions**, puis le menu **… → Installer à partir de VSIX…**.
3. Sélectionne le fichier téléchargé et recharge la fenêtre si VS Code le demande.

La distribution se fait actuellement par VSIX ; l’extension n’est pas encore publiée sur le Marketplace. Pour la mettre à jour, installe le VSIX plus récent de la même façon.

## Ta première mission

Si VS Code affiche le **mode restreint**, approuve d’abord ton dossier si tu lui fais confiance : l’extension reste désactivée tant qu’il ne l’est pas.

1. **Crée ton projet.** Dans la palette de commandes (`Ctrl+Maj+P`), lance **Warband : ouvrir les réglages**. Dans **Projet**, choisis un projet existant ou crée-le avec un nom et un dossier. Approuve ce dossier dans VS Code si tu lui fais confiance.
2. **Prépare ton conteneur.** Ouvre le **Cockpit**. Associe un conteneur existant à ton projet ou utilise **Nouveau conteneur** pour en préparer un, puis démarre-le. Le téléchargement ou la construction d’une image peut prendre du temps.
3. **Ouvre ton espace de travail.** Lance **Warband : ouvrir ou restaurer l’espace Warband** pour retrouver le chat, la Kill chain et le Monitor. Ouvre un terminal pour commencer à travailler à la main.
4. **Ajoute l’IA si tu le souhaites.** Dans le chat, ouvre **Configurer**, choisis **Claude**, **OpenAI** ou **OpenCode**, puis configure ta connexion. Sélectionne ensuite l’un des modèles proposés par ton compte.

L’accès aux modèles dépend de ton abonnement ou de ta clé API et des conditions du fournisseur ; il n’est pas inclus dans l’extension. Sous Windows, l’utilisation de Claude nécessite aussi [Git pour Windows, avec Git Bash](https://git-scm.com/downloads/win).

## Donne à l’agent le bon contexte

Dans le chat, **`@`** permet de citer un conteneur associé au projet et **`#`** de joindre un extrait d’un terminal ouvert par l’extension. Sélectionne l’entrée proposée dans le menu de mentions.

Par exemple, après avoir joint ton terminal :

> Résume ce que j’ai déjà observé. Quelles sont les deux prochaines vérifications utiles ? Explique pourquoi avant de proposer une commande.

Tu peux aussi joindre des fichiers texte, du code ou des journaux : jusqu’à **10 fichiers**, **64 Kio par fichier** et **256 Kio au total**. Les PDF et les images ne sont pas pris en charge directement ; fournis leur contenu sous forme de texte.

Le Monitor suit les commandes exécutées par l’agent. Pour lui montrer ce que tu as tapé toi-même dans un terminal ouvert par l’extension, utilise `#`.

## Bloqué sur une box ? Passe en mode Apprentissage

Dépose tes notes ou tes cours au format **`.md` ou `.txt`** dans le dossier accessible depuis **Réglages → Atlas → Ouvrir le dossier de cours**, avec un sous-dossier par source. Aucun cours n’est fourni avec l’extension.

Active **Apprentissage** dans le menu **Configurer** du chat. L’agent peut rechercher dans tes cours, expliquer un passage et t’orienter avec des indices. Dans ce mode, il **n’exécute aucune commande et ne modifie aucun fichier**. Tu peux lui donner un extrait de terminal avec `#`.

> Je bloque sur cette étape. Appuie-toi sur mes cours et sur l’extrait du terminal pour me donner un premier indice, sans me donner toute la solution.

## Garde le contrôle et prépare ton rapport

En mode supervisé, les actions qui nécessitent ton accord affichent une carte : tu peux **autoriser une fois**, **refuser** ou, lorsque c’est proposé, **mémoriser** ton choix après confirmation. Certaines lectures sont autorisées directement et certaines actions sont refusées par les règles.

Le **Bypass** est un choix explicite : pendant sa durée, il autorise automatiquement les demandes traitées par le contrôle d’approbation, y compris celles normalement refusées. Le mode Apprentissage reste en lecture seule.

Pour conserver une observation, sélectionne du texte dans l’éditeur et lance **Warband : Capturer la sélection comme preuve**, ou capture un extrait du journal terminal. Tu retrouves les captures avec **Warband : Lister les preuves du projet**. La Kill chain aide à relier les découvertes ; son export SVG et le brouillon Markdown servent à préparer ton compte rendu. Vérifie les preuves, la gravité et les remédiations avant de livrer le rapport.

## Les raccourcis utiles

Appuie sur `Alt+J`, relâche, puis sur la seconde touche.

| Raccourci | Ouvre… |
| --- | --- |
| `Alt+J Alt+J` | Le lanceur |
| `Alt+J T` | Un terminal |
| `Alt+J C` | Le chat latéral |
| `Alt+J N` | Un nouveau chat dans l’éditeur |
| `Alt+J K` | Le cockpit |
| `Alt+J M` | Le Monitor |
| `Alt+J G` | La Kill chain |
| `Alt+J S` | Les réglages |

Un conteneur absent ? Vérifie que Docker tourne, que le bon projet est actif et que le conteneur lui est associé. Aucun modèle disponible ? Reviens dans **Configurer** pour vérifier la connexion et actualiser la liste.

[Signaler un problème ou proposer une idée](https://github.com/tomtimlt/warband/issues) · [Contribuer au projet](CONTRIBUTING.md) · [Licence MIT](LICENSE)
