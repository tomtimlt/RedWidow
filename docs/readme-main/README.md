<div align="center">

<img src="docs/img/venator-ops-logo.svg" alt="Logo Venator Ops" width="88" height="88">

# Venator Ops

**Pentest dans VS Code, avec l’IA d’astreinte.**

Tes conteneurs Docker Kali et Exegol, leurs terminaux, un Monitor, une kill chain
et des rapports au même endroit. Un agent IA t’épaule quand tu l’appelles.

![Licence MIT](https://img.shields.io/badge/licence-MIT-3cc7c0.svg)
![VS Code 1.90+](https://img.shields.io/badge/VS%20Code-1.90%2B-495F73.svg)
![Windows et Linux](https://img.shields.io/badge/Windows%20%7C%20Linux-495F73.svg)
![Docker requis](https://img.shields.io/badge/Docker-requis-495F73.svg)

<br>

<img src="docs/img/venator-ops-banniere.png" alt="Venator Ops : ton pentest, un seul cockpit, un seul agent" width="860">

</div>

---

> **À utiliser uniquement dans un cadre autorisé** : CTF, labs de certification,
> engagement avec périmètre et accord écrit.

## Pourquoi Venator Ops

Un pentest, c’est des dizaines de terminaux, de scans et de notes éparpillés.
Venator Ops les rassemble dans VS Code :

- **Tes conteneurs Docker Kali et Exegol** se préparent et se pilotent depuis le cockpit.
- **Tes terminaux** s’ouvrent directement dans le conteneur, comme n’importe quel terminal de l’éditeur.
- **Le Monitor** suit chaque commande de l’agent : son état et sa sortie en direct.
- **La kill chain** dessine ce que tu trouves : hôtes, identifiants, sites, étapes et butin, reliés entre eux, avec la technique MITRE ATT&CK de chaque étape.
- **Un agent IA** lance les outils de ton conteneur, explique et propose des pistes.

## Ce que tu peux faire

### Travailler avec l’agent

Tu écris ta consigne dans le chat, l’agent s’occupe du reste. Quand une action
demande ton accord, une carte indique l’outil, la commande et la raison.

<div align="center">
<img src="docs/img/venator-ops-chat.png" alt="Le chat Venator Ops avec une carte d’autorisation : outil, commande sqlmap, raison, et les boutons Autoriser une fois, Refuser, Toujours" width="380">
</div>

Dans le chat, tu disposes aussi de :

- `@` pour citer un conteneur, `#` pour citer un terminal ouvert (l’agent lit sa sortie), `/` pour les commandes ;
- jusqu’à **quatre conversations** en parallèle, et un **historique** filtré par projet ;
- le choix du **modèle** et de l’**effort de raisonnement** pour le message suivant ;
- la recherche sur le web (documentation, README, releases GitHub), avec les sources et la date de consultation.

### Suivre l’exécution : le Monitor

Chaque commande apparaît avec son état et sa sortie en direct. Une frise te
permet de sauter à n’importe quelle commande ; la flèche vers le bas active ou
suspend le suivi automatique.

<div align="center">
<img src="docs/img/venator-ops-monitor.png" alt="Le Monitor : une frise de commandes, l’entrée de la commande en cours et sa sortie numérotée" width="860">
</div>

### Suivre ton attaque : la kill chain

Hôtes, identifiants, sites, étapes, butin : chaque trouvaille a un **état**
(confirmé, hypothèse, échoué), une **technique MITRE ATT&CK** et des liens de
cause à effet avec les autres. Le graphe se parcourt à la souris et au clavier ;
**Rejouer** déroule le chemin retenu nœud par nœud.

<div align="center">
<img src="docs/img/venator-ops-killchain.png" alt="La kill chain : un graphe de trouvailles reliées, le chemin retenu en pointillés verts, et la légende" width="860">
</div>

### Apprendre : le mode Apprentissage

Tu bloques sur une box HTB ? Donne-lui ton cours, cite ta session de terminal
avec `#`, et il t’explique où tu en es à partir de ce que tu as vraiment tapé.
Le mode est en lecture seule : il cite ses sources et te met sur la piste.

<div align="center">
<img src="docs/img/venator-ops-apprentissage.png" alt="Mode Apprentissage : « Bloqué sur une box ? Donne-lui ton cours. Il lit ton terminal. », avec le terminal et le chat" width="860">
</div>

### Garder une trace et rédiger

Chaque mission est consignée dans un journal que tu peux relire. L’**aperçu du
rapport** présente les trouvailles du projet actif, sans identifiants ni butin,
et l’export produit un **brouillon Markdown** à compléter avec tes preuves et
tes remédiations. Les gravités restent « À évaluer » : tu les décides toi-même.
Aucun outil de rapport externe n’est nécessaire.

## Sans IA

Venator Ops sert à organiser ton pentest même sans compte ni fournisseur d’IA.

- **Des projets** : un nom, un dossier de travail et les conteneurs qui vont avec, avec un résumé que tu rédiges et modifies toi-même.
- **Le cockpit** : crée, démarre, arrête et associe tes conteneurs Docker Kali et Exegol. Les images Kali sont préparées pour toi.
- **Tes terminaux dans le conteneur** : ouvre un terminal dans Kali ou Exegol depuis VS Code et travaille comme d’habitude.
- **La kill chain** : parcours le graphe des trouvailles du projet, marque le chemin retenu et rejoue-le.
- **Le brouillon de rapport** : aperçu et export Markdown.

Le jour où tu veux de l’aide, ajoute un fournisseur dans **Configurer** : le
chat, le Monitor et l’alimentation automatique de la kill chain s’appuient alors
sur l’agent.

## Installation

Prérequis : **VS Code 1.90 ou plus** et **Docker** pour les conteneurs.

1. Télécharge le fichier `.vsix` de ta plateforme (**Windows** ou **Linux**) dans les [releases](https://github.com/tomtimlt/warband/releases).
2. Installe-le : `code --install-extension <fichier>.vsix`, ou dans VS Code **Extensions → … → Installer à partir d’un VSIX**.
3. Recharge la fenêtre VS Code.

Venator Ops n’est pas encore sur le Marketplace : l’installation se fait à la main.

## Premier lancement

1. Ouvre un **dossier de confiance** dans VS Code.
2. Ouvre **Réglages → Projet** : active un projet ou crée-le (un nom et un dossier).
3. Dans le **cockpit**, associe les conteneurs Kali ou Exegol du projet, ou crée-les.
4. Pour utiliser l’agent, ouvre **Configurer** dans le chat, choisis ton fournisseur et ajoute ton accès. Il est stocké dans le stockage sécurisé de VS Code.
5. Ouvre le chat (icône Venator Ops de la barre d’activité) et écris ta consigne.

| Raccourci | Action |
| --- | --- |
| `Alt+J Alt+J` | Lanceur |
| `Alt+J C` | Chat latéral |
| `Alt+J N` | Nouveau chat dans l’éditeur |
| `Alt+J K` | Cockpit |
| `Alt+J M` | Monitor |
| `Alt+J S` | Réglages |

## Questions fréquentes

**Quels fournisseurs d’IA sont compatibles ?**
**Claude** (jeton d’abonnement ou clé API), **OpenAI** (abonnement ChatGPT ou clé API) et **OpenCode**, qui ouvre aussi la porte à Gemini, à des modèles locaux avec Ollama et à des points d’accès compatibles. Tu peux changer de fournisseur en gardant la même conversation.

**Sur quels systèmes ça fonctionne ?**
Windows (natif, sans WSL) et Linux.

**Où sont mes données ?**
Les journaux de conversation sont stockés par VS Code sur ta machine, hors de ton dépôt. L’historique conserve environ les 100 dernières conversations, et les mots de passe, jetons et clés sont masqués avant d’être enregistrés.

**À quoi sert le Bypass ?**
À enchaîner une longue séquence sans cliquer à chaque carte : il se règle dans **Configurer**, dure 2 h par défaut (4 h au plus) et s’affiche en magenta avec un compte à rebours.

**Y a-t-il des profils pour mon contexte ?**
Oui : des profils de méthode (mentor, bug bounty, out of the box, red team, HTB) orientent l’agent.

**L’interface s’adapte à mon thème ?**
Oui : thèmes clair, sombre et contraste élevé, mouvement réduit respecté, cinq jeux de couleurs au choix dans **Réglages → Apparence**.

## Statut

Projet personnel en développement actif. La version publiée s’installe à la main (`.vsix`) et n’a pas encore été éprouvée dans toutes les configurations de VS Code (fenêtres distantes, version web). Les limites connues sont détaillées dans le [guide de l’extension](docs/extension-vscode.md#limites-connues).

## Aller plus loin

| | |
| --- | --- |
| [Guide de l’extension](docs/extension-vscode.md) | Installation, usage et limites |
| [État du projet](docs/etat-du-projet.md) | Ce qui existe et ce qui reste à faire |
| [Ligne de commande](docs/cli.md) | Pilotage et politique d’approbation hors de VS Code |
| [Développer](docs/adr/README.md) | Pour les développeurs : décisions d’architecture et organisation du code |

## Licence

[MIT](LICENSE).
