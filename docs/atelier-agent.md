# Atelier de mission — 0.3.62

## Ouvrir l’espace de travail

La commande **Warband : ouvrir ou restaurer l’espace Warband** ouvre le chat
latéral, la Kill Chain dans le groupe supérieur et le Monitor dans le groupe
inférieur. Le terminal reste accessible par son icône et peut partager les onglets
du groupe supérieur. Le premier accès propose cette disposition automatiquement
seulement dans une fenêtre sans onglet ; les fenêtres déjà occupées ne sont pas
réorganisées. VS Code conserve ensuite sa disposition et ses onglets. La commande
explicite restaure deux groupes ; aucun fichier n’est fermé ou sauvegardé par Warband.

Dans **Réglages → Projet**, utiliser **Préparer et vérifier les fichiers de mission**.
Cela crée notes, scripts, resultats, preuves et rapports sans écraser les fichiers.
Un chemin existant incompatible ou symbolique est refusé. Le diagnostic affiche
le montage constaté pour les conteneurs liés : dossier hôte → /workspace. Un
montage absent ou différent doit être corrigé avant de compter sur la présence
locale des résultats. Warband ne déplace pas automatiquement les fichiers anciens
restés dans /tmp ou /root et ne modifie pas un conteneur existant.

L’Explorateur VS Code travaille sur le dossier hôte partagé. Ce n’est pas un mode
Dev Containers : l’hôte d’extension n’est pas déplacé dans Kali. Ouvrir VS Code
dans le conteneur demande encore une intégration Dev Containers spécifique.

## Fichiers volumineux

Les outils `mcp__projectfiles__list_project_files` et `read_project_file` lisent le
dossier réel du projet : chemins relatifs uniquement, liens résolus sous cette
racine, lecture par offsets en octets, 32 Kio maximum. La réponse donne la taille
et l’offset suivant. L’agent peut examiner un fichier de 40 Mo ou davantage déjà
présent dans le dossier, sans l’envoyer intégralement au modèle. Il n’écrit rien
avec ces outils. Les appels passent par la gate habituelle.

Les bornes d’un bloc UTF-8 peuvent couper un caractère ; utiliser un chevauchement
si nécessaire. Les fichiers binaires doivent être convertis avant lecture. Cela
n’augmente pas les limites des pièces jointes du chat (10 fichiers, 64 Kio chacun,
256 Kio cumulés). Copier les gros fichiers dans le dossier partagé pour ce parcours.

## Catalogue MCP et profils spécialisés

**Contrôle système → Catalogue MCP**, ou **Warband : catalogue des intégrations
MCP**, ouvre les connecteurs Playwright, Filesystem, MarkItDown, SysReptor,
Serena, Semgrep, Trivy, BloodHound, Ghidra et WireMCP. Le dépôt de chaque serveur
est accessible depuis la fiche. Quatre services maximum par projet, connexion
explicite sur 127.0.0.1, port, transport HTTP/SSE et chemin. Les réglages sont
utilisateur machine, indexés par UUID de projet ; un dépôt ne peut pas activer un
serveur. Un projet sans réglage n’hérite pas des services d’un autre projet.
Modifier une connexion arrête les tours actifs ; le prochain moteur relit le choix.

Warband fournit le connecteur, pas les logiciels tiers ni leurs comptes. Les
services doivent être installés et démarrés séparément. Le catalogue ne signifie
pas qu’un serveur est joignable. Le bouton de test initialise la connexion et lit
le catalogue réel, sans appel au modèle ni outil distant exécuté. Une connexion
réussie ne prouve pas la validité du projet ou du scope configuré dans le service.
Configurer séparément leurs racines et projets : par exemple la collection
BloodHound ou le projet SysReptor n’est pas choisi automatiquement.

Exemples de parcours, à adapter à la version installée :

- **Web** : Playwright en serveur local, navigateur isolé, Burp déjà disponible.
- **Documents** : MarkItDown en HTTP local, limité au dossier de mission dans son
  conteneur. Ne pas exposer l’ensemble du disque à son convertisseur.
- **Rapport** : `reptor mcp` officiel, instance SysReptor et jeton configurés dans
  le service externe ; choisir explicitement le bon projet et ses modèles.
- **Code** : Serena / `semgrep mcp` / Trivy selon la mission.
- **AD, reverse, réseau** : BloodHound, Ghidra ou WireMCP avec leurs applications
  et données. Certains connecteurs communautaires sont uniquement stdio : une
  passerelle locale stdio/HTTP distincte est alors nécessaire. Cette version de
  Warband ne lance aucun programme stdio arbitraire ni commande npx/Java.

Le moteur expose deux outils par service actif : `list_tools` puis `call_tool`.
Les schémas réels sont découverts à la demande, pas copiés tous dans le prompt.
Les appels sont plafonnés à ask, sans mémorisation « Toujours » sur ce pont ;
Bypass garde son contrat. Réception, arguments, catalogue, texte renvoyé et durée
restent bornés. Un timeout ne prouve pas l’arrêt dans le service : vérifier son
état avant de retenter. Images et contenus non textuels ne sont pas transférés.
L’Apprentissage reste limité aux cours, sans ces connecteurs.

## Skills

**Choisir un skill / profil agent** sélectionne Mentor, Bug bounty, Out of the box,
Red team ou HTB. Un seul résumé court est ajouté au système au prochain tour.
Les profils Warband sont des adaptations méthodologiques, pas cinq skills
upstream portant exactement ces noms. Ils ne contiennent pas de recette offensive
ni d’autorisation d’outil. Le contrat commun de preuve, tâches longues, Kill Chain
et rapport continue à s’appliquer.

`mcp__desk__load_skill` fournit une source GitHub épinglée seulement lorsque
l’agent en a besoin. Les sources reprises sont :

- Jesse Vincent, **Superpowers**, commit
  `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` : systematic-debugging et
  verification-before-completion, sous MIT.
- **Trail of Bits Skills**, commit
  `2be6433b39e009cd2b6fd3be1895f6b1faa5af9a` : audit-context-building,
  sous CC BY-SA 4.0.

Deux autres catalogues ont été examinés : murrtada/bug-bounty-agent-skills et
UnboundCompute/security-agent-skills. Ils ne sont pas importés en bloc. Des
recommandations de certains rapports, comme déduire un correctif client d’une
simple perte de reproductibilité ou reprendre un barème de gravité générique,
contredisent notre discipline de preuve. Une présence sur GitHub ne suffit pas
à valider une méthode. Les profils restent méthodologiques et les sources choisies
sont tracées, au lieu d’exposer des centaines de skills techniques.

Les textes upstream sont conservés comme données de référence, avec URL, licence
et bornage signalé. Leurs exemples de commandes, outils propriétaires, références
non chargées et demandes de délégation ne créent aucune capacité dans Warband.
Le scope, la confidentialité et les contrôles du moteur priment. Les licences
complètes sont distribuées dans media/skills ; ces données ne sont pas relicenciées
en MIT avec le code de l’extension. Aucune mise à jour distante silencieuse.

## Bureau du modèle : décision après implémentation

Le modèle doit recevoir un bureau de mission, pas une pile de documents :

1. **Toujours disponible** : objectifs utilisateur, contrat commun, profil court,
   conteneurs et montages vérifiés pour le tour, noms des outils réellement exposés.
2. **Sur demande** : pages de fichiers, catalogue d’un service, source d’un skill,
   détails de preuves. Garder les gros résultats sur disque et citer le chemin.
3. **Vérité durable** : journaux et états de tâches ; une hypothèse ne devient pas
   un fait parce qu’elle figure dans un résumé ou une recherche sémantique.

L’implémentation ne précharge ni tous les MCP ni toutes les sources de skills.
Elle ne crée pas de mémoire globale entre conversations. Les références et
résultats restent des données non fiables, pas des instructions d’autorisation.

Suite à mesurer avant toute sophistication : quantité de contexte injectée,
lectures inutiles, répétitions sans information nouvelle, durée sans progrès,
taux de chemins erronés et nombre de reprises réussies après interruption. Comparer
à modèle, cible et budget identiques ; un skill ou MCP supplémentaire ne garantit
pas de résoudre une HTB Hard. L’étape ultérieure utile serait un tableau de faits
et hypothèses avec liens vers les événements sources, validé par le moteur ; un
résumé libre généré par le modèle ne suffirait pas. Aucun benchmark payant exécuté.

## Recette et limites

Tests locaux et Chromium couvrent les parcours accessibles sans applications
tierces. Les transports sont exercés contre de vrais serveurs MCP factices HTTP
et SSE. Les versions de chaque application, Windows natif, les comptes et la
qualité du rapport final doivent être vérifiés sur une installation réelle.
