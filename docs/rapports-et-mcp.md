# Rapports et MCP — étude et essais du 27 octobre 2026

## Choix de départ : SysReptor

Pour Warband et les missions CTF/pentest, SysReptor est le premier choix proposé
pour produire des PDF à partir de modèles HTML/CSS et de contenu Markdown.
Il fournit des modèles et des exemples de rapports, une API et le client
Python/CLI `reptor`. La qualité finale dépend du modèle choisi, de la rédaction
et des preuves ; un export de notes ne suffit pas à produire un rapport client.

Sources officielles consultées : [SysReptor](https://github.com/Syslifters/sysreptor),
[exemples PDF](https://docs.sysreptor.com/demo-reports/),
[reptor](https://github.com/Syslifters/reptor).

| Solution | Point fort pour Warband | Limite ou choix à faire |
|---|---|---|
| SysReptor | Modèles HTML/CSS, contenu Markdown, rendu PDF ; `reptor` et API pour automatiser | Installer une instance et choisir un modèle ; mapper les données métier et les preuves |
| [Ghostwriter](https://github.com/GhostManager/Ghostwriter) | Rapports DOCX personnalisés avec Jinja2, collaboration, API GraphQL | Plus large : missions et infrastructure ; à privilégier si le livrable attendu est un Word éditable |
| [Dradis](https://github.com/dradis/dradis-ce) | Collaboration et centralisation des preuves/outils | Vérifier les formats et fonctions de l'édition retenue avant de choisir une offre ; aucune équivalence PDF/DOCX supposée entre CE et Pro |

Il n'existe pas de classement de qualité universel entre ces solutions. Pour
le besoin actuel, comparer un même échantillon de mission dans un modèle
SysReptor et un modèle Ghostwriter donnera une meilleure décision qu'une liste
abstraite de fonctions.

## Export Warband livré en 0.3.50

La commande **Warband : Exporter un brouillon de rapport Markdown** et le bouton
**Exporter le brouillon** dans la Kill Chain proposent un fichier local choisi
par dialogue natif. Le projet est revérifié après le dialogue et les notes
relues. Un document ouvert avec des modifications non enregistrées n'est pas
écrasé. L'export contient le cadre à compléter, les notes par état, le chemin
retenu et les champs de preuve, impact et remédiation à renseigner.

Les nœuds `credential` et `loot` et leurs liens sont exclus. Les sorties brutes,
le journal complet, les captures et les anciennes conversations ne sont pas
joints. Les titres sont neutralisés pour Markdown/HTML. Les autres notes peuvent
encore contenir des informations sensibles : relire le brouillon avant diffusion.

Ce fichier peut être repris dans les notes Markdown de SysReptor. Il n'est ni
une archive d'import native SysReptor, ni un rapport de vulnérabilités complet,
ni un PDF final. Aucun CVSS, impact ou succès n'est inventé à partir des seuls
titres de notes. Il n'y a pas encore d'envoi réseau vers un outil de rapport.

L'utilisateur n'a pas encore d'instance ni de modèle. La prochaine étape est
un essai SysReptor local avec un projet fictif : choisir le modèle, renseigner
les champs exigés, importer les notes autorisées et générer un PDF à relire.
Le connecteur Warband devra ensuite lire ce schéma et préparer un brouillon
révisable avant toute publication externe. Aucun déploiement cloud, abonnement
ou envoi de données réelles n'a été effectué pendant cette livraison.

## MCP SysReptor : oui, via reptor

Le projet officiel expose **`reptor mcp`**, installé avec l'option `reptor[mcp]`.
Le serveur actuel offre les transports `stdio`, `sse` et `streamable-http` ;
`stdio` est le défaut, SSE est indiqué comme déprécié. L'option **`--read-only`**
ne registre pas les outils d'écriture ; `--remove-fields` retire des champs.

Les outils couvrent notamment notes, findings, modèles et sections de rapport.
Les champs requis du modèle doivent être lus avant de construire un finding.
Le code consulté ne suffit pas à affirmer une authentification HTTP adaptée
à une exposition publique : garder ce service local et prévoir un adaptateur
Warband avec secret séparé, validation TLS et gate pour les écritures.

Sources : [aide CLI](https://github.com/Syslifters/reptor/blob/main/docs/help-messages/mcp),
[serveur et outils](https://github.com/Syslifters/reptor/blob/main/reptor/plugins/core/Mcp/Server.py).
L'existence et les capacités ont été vérifiées dans les sources ; aucun essai
avec une instance SysReptor réelle n'a eu lieu faute d'instance configurée.

## MCP Burp Suite : essai effectué

PortSwigger maintient [le serveur MCP officiel](https://github.com/PortSwigger/mcp-server).
C'est une extension de Burp : serveur local SSE et proxy stdio fourni. La
configuration par défaut annoncée est `127.0.0.1:9876`. Le catalogue comporte
l'historique HTTP, des fonctions Repeater, les issues scanner selon les capacités
de Burp, et des réglages dont l'édition peut être désactivée. Le serveur possède
aussi ses propres contrôles de requêtes et d'accès aux données.

Essai cloud sur le commit officiel
[`642e6fa31c63db3886a353fcd7ed62037e0ceed5`](https://github.com/PortSwigger/mcp-server/commit/642e6fa31c63db3886a353fcd7ed62037e0ceed5),
version déclarée 1.3.0, Java 21 et Gradle 9.2.0 : **97 tests passés, aucun échec
ni test ignoré**. La suite utilise l'API Montoya simulée ; son test d'intégration
démarre le vrai serveur local, effectue l'initialisation MCP, liste les outils
et vérifie le ping. Aucun site ni cible HTB n'est contacté par cet essai.

Ce résultat ne valide pas encore un vrai Burp Windows ni le routage de ses
outils dans Warband. Pour le prochain lot : commencer par l'historique en
lecture seule, sur un projet de test et un hôte lié explicitement. Les envois
HTTP, Repeater et changements de configuration devront conserver les contrôles
de scope et passer par la gate. Le serveur lancé sur le PC n'est pas joignable
via `localhost` depuis un conteneur distant : la topologie devra être choisie.
Le code et les binaires externes téléchargés pour l'essai restent hors du dépôt.

## Modularité MCP et harnais : réserve à moyen terme

Ne pas ouvrir toutes les configurations MCP des SDK pour brancher un serveur.
Le futur contrat doit distinguer connexion, catalogue validé, classification des
outils, secret, cible/projet, approbation, annulation et journal. Commencer par
un adaptateur Burp ou SysReptor explicite permettra de vérifier ce contrat avant
de construire un système de plugins générique. Les harnais supplémentaires
restent un chantier distinct, sans migration automatique des conversations.
