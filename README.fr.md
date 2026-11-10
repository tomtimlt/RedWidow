<div align="center">

<img src="docs/img/readme/redwidow-lockup.png" alt="RedWidow" width="360">

# RedWidow

**Le pentest dans VS Code, avec l'IA à la demande.**

Vos conteneurs Exegol et Kali, vos terminaux, un Monitor, un graphe d'attaque,
une matrice de couverture et un rapport, au même endroit. Un agent IA agit dans
votre conteneur quand vous l'appelez, sous votre contrôle.

![Licence MIT](https://img.shields.io/badge/licence-MIT-3cc7c0.svg)
![VS Code 1.90+](https://img.shields.io/badge/VS%20Code-1.90%2B-495F73.svg)
![Windows et Linux](https://img.shields.io/badge/Windows%20%7C%20Linux-495F73.svg)
![Docker requis](https://img.shields.io/badge/Docker-requis-495F73.svg)
![Bêta publique](https://img.shields.io/badge/statut-b%C3%AAta%20publique-c8344a.svg)

</div>

---

> [!WARNING]
> **Usage autorisé uniquement** : CTF, laboratoires de certification, ou mission
> avec un périmètre défini et une autorisation écrite. Vous restez responsable de
> ce que l'agent fait en votre nom.

> **Bêta publique 1.0.** L'outil est utilisable au quotidien, mais jeune : il ne
> promet aucun résultat. La réussite d'une mission dépend du modèle d'IA choisi
> et de la cible. [Limites connues](#limites-connues).

## Ce que c'est

Un pentest, ce sont des dizaines de terminaux, de scans et de notes éparpillés.
RedWidow les réunit dans VS Code :

- **Conteneurs Exegol et Kali** préparés et pilotés depuis le cockpit, terminaux ouverts directement dedans.
- **Un agent IA** qui lance les outils dans votre conteneur, lit les résultats et propose la suite. Chaque action sensible passe par une carte d'approbation.
- **Un Monitor** qui suit chaque commande et chaque requête web de l'agent, en direct.
- **Un graphe d'attaque** (kill chain) : hôtes, identifiants, sites, étapes, avec la technique MITRE ATT&CK de chaque étape.
- **Une matrice de couverture** : ce qui est testé, négatif, bloqué ou confirmé, en couleurs.
- **Un journal complet et exportable** de la mission, pour rendre des comptes ou mesurer l'agent.

## Un profil par type de mission

| Profil | Pour quoi | Document demandé |
|---|---|---|
| **Pentest** (par défaut) | Mission à la volée, tous les outils après approbation | Aucun |
| **HTB / CTF** | Énumération, exploitation, drapeaux | Aucun |
| **Bug bounty** | Respect des règles d'un programme, preuves minimales | Fiche programme |
| **Red Team** | Plan de campagne, ATT&CK, déconfliction | Fiche d'engagement |
| **Mentor** | Pédagogie, l'agent explique sans agir | Aucun |

Aucun profil n'impose les documents d'un autre : un pentest ne demande pas de
fiche de bug bounty, un CTF ne demande aucun contrat.

## Fonctions

### Piloter l'agent

Écrivez votre consigne dans le chat. L'agent propose, vous autorisez : une carte
montre l'outil, la commande et la raison, avec *Autoriser une fois*, *Refuser*
ou *Toujours*.

- `@` pour citer un conteneur, `#` pour citer un terminal ouvert, `/` pour les commandes.
- Plusieurs conversations en parallèle, avec un historique partagé par projet.
- Choix du **fournisseur** et du **modèle** (OpenCode, Claude, OpenAI) pour le message suivant.
- Niveau d'encadrement **Acharné** : l'agent est relancé tant qu'il reste des pistes qu'il peut avancer seul, et s'arrête quand seule une action humaine peut le débloquer.
- Bouton **Stop** dans la zone de saisie pendant un run.
- **Bypass** à durée choisie (de 1 minute à 48 h) ou illimité, quand vous voulez que l'agent travaille sans vous solliciter.

### Comptes de test

Une page **Comptes de test** enregistre vos identifiants ou un cookie de session
dans le coffre de VS Code. L'agent les utilise pour tester les parties
authentifiées, avec une session conservée entre deux requêtes. Les valeurs sont
masquées dans les journaux et les exports.

### Fiche programme remplie par l'IA

Pour un bug bounty, collez l'adresse du programme et cliquez sur **Remplir par
IA** : une conversation dédiée lit la page, rédige le périmètre, les exclusions,
le rythme et le User-Agent, en citant ses sources. Vous relisez et vous validez :
rien ne s'applique avant votre validation.

### Suivre l'exécution et garder une trace

- Le **Monitor** liste toutes les actions de l'agent (shell et web), filtrables.
- La **matrice de couverture** colore chaque case et signale d'un bandeau une faille confirmée.
- L'**Audit** conserve actions, décisions et captures du projet. Un ZIP exportable contient le fil de la mission, les journaux et les empreintes SHA-256.
- Les **sorties longues** sont gardées en entier et relisibles par tranche ou par recherche.

### Mesurer un run

La commande `trace` lit le ZIP d'audit d'un run et dit où il a perdu du temps :
nombre d'appels, répétitions, recherches, part des requêtes dérivées de ce que
l'agent avait observé, classe de blocage probable.

```bash
node packages/cli/dist/main.js trace mon-audit.zip
```

## Installation

Prérequis : **VS Code 1.90+**, **Docker** en marche, un conteneur **Exegol** ou
un Kali (RedWidow sait le préparer), et un compte chez un fournisseur de modèle
(OpenCode propose des modèles gratuits).

1. Téléchargez le fichier `.vsix` de la [dernière version](https://github.com/tomtimlt/RedWidow/releases).
2. Dans VS Code : *Extensions* → menu `···` → **Installer à partir d'un VSIX…**
3. Ouvrez **RedWidow** dans la barre d'activité.

## Démarrage en 5 étapes

1. **Réglages → Fournisseurs** : configurez un fournisseur de modèle.
2. **Réglages → Projet** : créez un projet (son dossier est créé pour vous).
3. **Cockpit → Nouveau conteneur** : il se lie tout seul au projet.
4. Dans le chat, **Configurer** : choisissez fournisseur, modèle et niveau d'encadrement.
5. Écrivez votre consigne, par exemple « scanne 10.10.11.42 et résume les services exposés ».

## Limites connues

- **Bêta** : des défauts d'interface sont possibles, signalez-les.
- Pas encore sur le Marketplace : installation par fichier `.vsix`.
- Testé sous Windows et Linux, pas sous macOS.
- Les résultats dépendent du modèle : un modèle gratuit trouve moins qu'un modèle de pointe.
- Les relances automatiques du niveau Acharné fonctionnent avec OpenCode.

## Licences et contenus tiers

RedWidow est sous licence **MIT** ([LICENSE](LICENSE)). Les contenus tiers
(OWASP, HackTricks, Attack Flow, OpenCode) et leurs licences sont listés dans
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## English

The [English README](README.md) is the reference for the project page. RedWidow is a VS Code extension
that drives Exegol and Kali containers with an AI agent, under your approval,
with a Monitor, an attack graph, a coverage matrix and an exportable audit log.
