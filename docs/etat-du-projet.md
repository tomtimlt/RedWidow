# Warband — parcours, état actuel et reprise

État inspecté le 27 octobre 2026 pour la version 0.3.46. Ce document sert de point d'entrée produit ;
les ADR expliquent les décisions, les idées restent une réserve.

## Le parcours de référence

**Choisir un projet → associer ses conteneurs → travailler avec l'agent →
approuver les actions nécessaires → consulter les résultats et les traces.**

Le projet regroupe le dossier de travail, les conteneurs autorisés et les
trouvailles. Le conteneur affiché comme principal facilite la navigation ; il
n'autorise pas à lui seul une exécution. Le mode Apprentissage constitue un
parcours distinct, en lecture seule sur les cours.

## Quelle version décrit-on ?

La version du manifeste est **0.3.46**. Les paragraphes
0.3.19 à 0.3.29 ci-dessous sont des relevés historiques, pas les preuves de
validation de ce lot. Les artefacts publiés sont accessibles dans les
[releases GitHub](https://github.com/tomtimlt/warband/releases).

## Lot 0.3.46 — chargement et diagnostic du catalogue (publication en préparation)

Le sondage du catalogue reçoit désormais le même délai de 45 secondes que
l'interface, au lieu du délai implicite de 30 secondes du contrôleur. Les
erreurs structurées du moteur ne sont plus réduites à une exception générique.
Le bandeau et Sortie → warband distinguent démarrage OpenCode, code de sortie,
intégrité du binaire, refus de configuration, statut HTTP et dépassement de délai.
Une liste fermée de diagnostics exclut les messages bruts, sorties du serveur,
corps HTTP, URL et identifiants secrets. Les erreurs inconnues restent génériques.

Signalement utilisateur : impossible de charger les modèles OpenCode Zen sur
un PC Windows personnel avec une nouvelle clé. La cause sur ce poste n'est
pas encore identifiée : le message de la 0.3.45 effaçait le diagnostic. Aucun
effacement de connexion, relâchement TLS ou contournement des contrôles de
configuration n'est ajouté. Le fonctionnement sur ce PC devra être confirmé
après installation de la version avec diagnostic détaillé.
Validation locale : **1 986 tests réussis, 12 ignorés**, typage et build réussis.
Les tests couvrent le diagnostic IPC réel, les refus HTTP locaux, le code de
sortie Windows, le délai transmis et l'absence de secrets dans la vue et les logs.

## Lot 0.3.45 — scans longs supervisés (publié)

Un scan Nmap complet demandé par `nmap_scan` est refusé avant tout lancement
avec le code `kali.taskRequired`, traduit en français et en anglais. L'agent
doit choisir `task_start` explicitement, avec ses approbations habituelles.
Les vérifications Nmap courtes restent disponibles. Les commandes longues
arbitraires ne sont pas automatiquement converties ni reprises.

Les consignes Kali et du moteur expliquent le cycle `task_list`, `task_start`,
`task_status`, `task_cancel`, les processus synchrones absents de `task_list`,
le shell POSIX sans expansion des accolades et le respect du dossier demandé
par l'utilisateur pour les résultats. Les journaux techniques des tâches
restent dans leur dossier interne annoncé. Six tests vérifient le refus sans
appel à l'API Kali de différentes formes du scan complet ; 68 tests ciblés
des outils Kali, des tâches et du moteur réussissent.
Validation complète : **1 978 tests réussis, 12 ignorés**, typage et build réussis.

Publication vérifiée : commit **3c01c54** attribué à `tomtimlt`, tag **v0.3.45**,
[workflow 40411696951](https://github.com/tomtimlt/warband/actions/runs/40411696951)
réussi. Les deux VSIX et leurs SHA-256 de la
[release 0.3.45](https://github.com/tomtimlt/warband/releases/tag/v0.3.45)
ont été téléchargés : empreintes conformes, archives intègres, version et
garde-fou présents dans les bundles. Le changement de chat ne tue pas les
anciens processus synchrones ni les tâches supervisées encore actives.

## Lot 0.3.44 — compatibilité des proxys HTTP (publié)

Les URL HTTP derrière un proxy HTTP sont transmises sans tunnel CONNECT,
avec l'IP validée dans l'URL et le Host d'origine. Les URL HTTPS conservent
CONNECT, SNI, les autorités système/Node et la vérification TLS stricte.
Les tests GET et POST vérifient la forme absolue, l'IP épinglée, le Host,
le corps et le refus des redirections vers une adresse privée.

Essais cloud avec les vrais outils : deux recherches Exa et six lectures HTTPS
(Bing, GitHub, README brut, Node.js, Microsoft Learn, example.com) réussies.
L'essai HTTP example.com passe d'une fermeture de tunnel à une réponse 403 :
le transport compatible est implémenté, mais cette lecture reste refusée dans
le cloud. Aucun contournement des contrôles IP/DNS n'est ajouté.
La validation TLS avec les autorités internes sur le poste Windows reste ouverte.
Le bouton Monitor et la restauration du dossier de projet sont conservés.
Validation locale : **1 971 tests réussis, 12 ignorés**, typage et build réussis.

Le commit **6b791da**, attribué à `tomtimlt`, est poussé sur `main` et marqué
**v0.3.44**. Le
[workflow 40407538702](https://github.com/tomtimlt/warband/actions/runs/40407538702)
a réussi. Les deux VSIX et leurs SHA-256 de la
[release 0.3.44](https://github.com/tomtimlt/warband/releases/tag/v0.3.44)
ont été téléchargés : empreintes conformes, archives intègres, version et
présence du correctif HTTP vérifiées. TLS strict, autorités système, bouton
Monitor et restauration du dossier sont également présents dans les bundles.

## Lot 0.3.43 — suivi du bas dans le Monitor (publié)

Le bouton **Suivi du bas** du Monitor et du suivi de commande permet de forcer
le défilement vers les dernières sorties ou de conserver la position de lecture.
Il est activé par défaut dans chaque panneau ; le réactiver revient immédiatement
en bas. Le bouton reste accessible en haut pendant le défilement.

Validation : **1 969 tests réussis, 12 ignorés**, typage et build réussis.
Les 18 scénarios Chromium couvrent les deux panneaux, trois thèmes, trois
largeurs, la lecture stable pendant les mises à jour et la bascule au clavier.
Le volet web, HTTPS strict et la restauration du dossier actif sont conservés.
L'essai de `search_web` et `read_url` avec les certificats système sur le poste
Windows reste ouvert, de même que l'essai natif de restauration du dossier.

Publication vérifiée : commit **f33d904** attribué à `tomtimlt`, tag **v0.3.43**,
[workflow 40406107262](https://github.com/tomtimlt/warband/actions/runs/40406107262)
réussi et [release 0.3.43](https://github.com/tomtimlt/warband/releases/tag/v0.3.43)
disponible. Les VSIX Linux et Windows et leurs SHA-256 ont été téléchargés :
empreintes conformes, archives intègres, version 0.3.43 et bouton présents.

## Lot 0.3.41 — autorités HTTPS du système (publié)

Les outils web fusionnent les autorités par défaut de Node (certificats
supplémentaires compris) avec celles du système, lorsque l’API Node 22.15+
est disponible. La confiance est locale aux connexions web : aucune autorité
n’est installée ni ajoutée globalement. La connexion directe et les deux
couches d’un proxy HTTPS conservent `rejectUnauthorized: true` et la
vérification du nom du serveur. Si l’API manque ou échoue, Node garde ses
réglages stricts par défaut ; aucune désactivation de TLS.

Diagnostic du poste : certificat HTTPS signé par une autorité interne,
reconnue par le navigateur mais pas par le moteur web. Aucun certificat du
propriétaire n’est versionné ni approuvé automatiquement. Le correctif doit
encore être essayé dans VS Code sur son poste Windows : vérifier séparément
`search_web` et `read_url` avec les certificats système. **Ce problème reste
ouvert tant que cet essai réel n'est pas confirmé** ; les tests automatisés,
la construction du VSIX Windows et sa publication ne constituent pas cette
confirmation. Le volet web déjà intégré et ce correctif HTTPS sont conservés
dans la 0.3.42, sans modification de la vérification TLS.

Validation locale : **1 963 tests réussis, 12 ignorés**, typage et compilation
réussis. HTTPS réel local avec une CA éphémère : connexion reconnue, refus
sans cette CA, refus du mauvais nom et proxy HTTPS vérifiés. Aucun certificat
installé sur l’hôte ; les tests cryptographiques OpenSSL ciblent Linux, les
tests de fusion et de repli restent multiplateformes.

L'authentification GitHub fonctionne. Le tag distant **v0.3.41**, absent lors de
la reprise, a été créé sur **5fabef5**. Le workflow
[Release 40398961001](https://github.com/tomtimlt/warband/actions/runs/40398961001)
a réussi le 26 octobre 2026. La
[release 0.3.41](https://github.com/tomtimlt/warband/releases/tag/v0.3.41)
contient les VSIX **linux-x64** et **win32-x64** et leurs deux fichiers SHA-256.
Les quatre fichiers publiés ont été téléchargés : les deux empreintes sont
conformes, les archives ZIP sont intègres et leurs manifestes portent 0.3.41.

## Lot 0.3.42 — ouverture du dossier actif (publié)

L'extension ouvre automatiquement le dossier du projet actif au démarrage
d'une fenêtre sans dossier. La création et l'activation d'un projet ouvrent
aussi son dossier. Les documents modifiés, y compris les onglets d'éditeurs
spécialisés, entraînent une ouverture dans une nouvelle fenêtre ; les contrôles
de confiance restent ceux de VS Code. Une tentative automatique est mémorisée
avant l'ouverture pour éviter les boucles. Une sélection explicite permet de
réessayer. Une fenêtre déjà occupée n'est pas remplacée au démarrage.

L'ancienne fenêtre conserve ses conversations et ses brouillons. L'envoi et
la reprise sont refusés si son dossier ne correspond plus au projet actif,
en complément des contrôles existants du projet de chaque conversation.
Ce correctif est publié dans les VSIX 0.3.42 ; il n'est pas inclus dans la 0.3.41.
Le parcours natif de sauvegarde et de confiance reste à essayer dans VS Code
sur le poste utilisateur.
Validation locale : **1 969 tests réussis, 12 ignorés**, typage et compilation
réussis. Les tests couvrent la restauration, la sélection et la création,
les documents modifiés, les erreurs de lecture et d'ouverture, l'absence de
boucle et le refus d'exécution depuis le dossier d'un autre projet.

Le commit **188c114** a été poussé sur `main`, puis le tag **v0.3.42** a déclenché
[Release 40404551736](https://github.com/tomtimlt/warband/actions/runs/40404551736),
terminé avec succès. La
[release 0.3.42](https://github.com/tomtimlt/warband/releases/tag/v0.3.42)
contient les deux VSIX **linux-x64** et **win32-x64** et leurs fichiers SHA-256.
Les quatre fichiers ont été téléchargés et comparés aux empreintes GitHub ;
les empreintes des deux VSIX correspondent aussi aux fichiers SHA-256 publiés.
Les archives ZIP sont intègres, les manifestes portent 0.3.42 et les bundles
contiennent la restauration du dossier, `search_web`, `read_url` et la fusion
des autorités système avec vérification TLS. Cette inspection du contenu ne
valide pas le fonctionnement HTTPS sur le poste Windows : l'essai réel indiqué
dans le lot 0.3.41 reste ouvert.

## Lot 0.3.40 — recherche proactive dans le contexte des agents

Une consigne commune est injectée dans le contexte système de Claude et dans
chaque tour OpenCode/OpenAI lorsque `search_web` et `read_url` sont exposés.
Elle demande de vérifier une information inconnue, incertaine ou récente,
et la documentation des technologies/versions nouvellement découvertes,
avant de recommander une suite. Sources officielles, dates et versions
concernées sont privilégiées ; une CVE ne prouve pas à elle seule une vulnérabilité.

La consigne distingue l’échec du service de l’absence d’information, évite
les recherches répétitives et conserve les contraintes hors ligne,
confidentialité et approbations. Elle complète la consigne existante sans
la remplacer. Sans outils web — notamment en Apprentissage — le contexte
reste inchangé. Tests avec moteurs factices, sans inférence ni recherche réelle.

Validation locale : **1 959 tests réussis, 12 ignorés**, typage et compilation
réussis.

## Lot 0.3.39 — erreurs de recherche et lecture web

Les échecs DNS, TLS, connexion, délai de 25 secondes et quota HTTP 429 ont
maintenant des diagnostics distincts. Seuls des codes réseau connus sont
exposés : aucun message brut contenant une URL de proxy ou des identifiants.
Une erreur non gérée reproduite à la fermeture d’un corps HTTP non lu est
corrigée (erreurs HTTP, redirections et contenus refusés). Les erreurs de
lecture continuent d’être propagées ; la vérification TLS reste active.

La recherche exacte « PHP2shell » fonctionne depuis le cloud, ainsi qu’une
requête témoin. Le propriétaire confirme `read_url` fonctionnel pour
`https://example.com` sur son poste. La cause précise de l’échec de recherche
sur ce poste n’est pas établie : ce lot corrige le traitement des erreurs et
permet de distinguer les causes, sans prétendre avoir rétabli Exa sur Windows.

Validation locale : **1 953 tests réussis, 12 ignorés**, typage et compilation
réussis ; cas HTTP réels locaux et recherche Exa réelle vérifiés.

## Lot 0.3.38 — tâches longues dans les conteneurs

Quatre outils communs aux trois fournisseurs et aux familles Kali/Exegol :
lancer, lister, consulter, annuler. Supervision dans le conteneur, état privé
par projet, fichiers persistés dans `outputs`, durée et volume de sortie
bornés. Un lancement reste sous la gate et hérite des refus de l’outil
synchrone ; hors Bypass, son autorisation n’est pas mémorisable.

Essais Docker réels sur une image Python Linux portant les labels de chaque
famille : lancement court, résultat/code final, lecture des fichiers depuis
l’hôte non root, annulation, interruption au redémarrage et isolation des
projets. Aucun scan ni appel d’inférence effectué. Ces essais valident la
mécanique commune, pas les services MCP ni tous les outils de l’image Kali
complète ou d’une image Exegol. Voir [ADR 0024](adr/0024-taches-longues-conteneurs.md)
et le guide pour les limites de cycle de vie.

Validation locale : **1 937 tests réussis, 12 ignorés**, typage et compilation
réussis ; VSIX Windows et Linux construits.

## Lot 0.3.37 — catalogue de modèles lisible

Le sélecteur regroupe les modèles par fournisseur runtime, affiche leur identifiant
complet et conserve l’ordre des modèles de chaque fournisseur. Le choix par défaut
et les valeurs envoyées au moteur restent identiques. Le badge « Gratuit » reprend
uniquement « Free » dans le nom ou le suffixe `:free` de l’identifiant ; aucun prix
n’est déduit pour les autres modèles. Le filtre recherche aussi le fournisseur et
le mot « gratuit ». Vérification Chromium des groupes, de la recherche, du choix
au clavier et du rendu sûr sur quatre largeurs et trois thèmes.

## Lot 0.3.36 — exécution Nmap dans Kali

Erreur 126 reproduite avec le paquet Kali Nmap 7.991 : le binaire demande
NET_ADMIN alors que Docker ne la fournit pas. La préparation adapte les
capacités réseau connues du binaire au jeu autorisé, puis vérifie son lancement.
Aucun privilège Docker ajouté et aucun scan déclenché. La recette Kali complète
inclut libcap2-bin et les capacités Nmap compatibles ; les images déjà en cache
bénéficient du contrôle au prochain démarrage/liaison par le cockpit.

Validation locale : **1 922 tests réussis, 12 ignorés**, typage et compilation
réussis. Essai réel sur un Kali minimal : version bloquée avant correction,
version 7.991 fonctionnelle après, puis seconde préparation idempotente.
La reconstruction de l’image Kali complète n’a pas été relancée pour ce lot ;
l’essai concerne le paquet réel dans un conteneur Docker aux capacités standard.

## Lot 0.3.35 — recherche et lecture web

`search_web` et `read_url` sont disponibles avec Claude, OpenAI et OpenCode,
sans module CVE spécifique. Recherche Exa publique sans clé, puis lecture de
pages, documentation et GitHub en texte. Sources et date de consultation sont
retournées ; le service public applique ses limites. Installation et exécution
restent des actions distinctes des conteneurs, sous leurs approbations.

Lecture publique bornée, contrôle DNS/redirections et épinglage d’IP ; aucun
JavaScript exécuté. Mode Apprentissage local conservé. Voir [ADR 0023](adr/0023-recherche-et-lecture-web.md).
Recherche Exa et lecture de README/page GitHub ont été vérifiées dans le cloud,
y compris après bundling, sans inférence. Validation locale : **1 920 tests
réussis, 12 ignorés**, types et compilation réussis ; garde MCP, annulation,
redirections, types de contenus et plafonds couverts.

## Lot 0.3.34 — suppression dans la Kill chain

Sélection d’un nœud puis Supprimer, avec confirmation native et actualisation
du graphe. `delete_note` est disponible pour l’agent sous la gate existante.
Une suppression conserve les autres éléments et retire les liens pointant
vers le nœud supprimé ; aucun effacement en cascade. Projet et cible sont
revérifiés juste avant le commit. Les mutations sont coordonnées entre le
moteur et l’interface pour éviter pertes et résurrections concurrentes.
Voir [ADR 0022](adr/0022-suppression-des-trouvailles.md), notamment la récupération
d’un verrou laissé après un arrêt brutal.

Validation locale : **1 879 tests réussis, 12 ignorés**, lint, typage et
compilation réussis. Tests entre véritables processus pour les écritures
concurrentes ; contrôles Chromium de la sélection, suppression, annulation,
erreurs et caméra dans quatre largeurs et trois thèmes. Revue architecte
du commit atomique, des changements de projet et de la gate effectuée.

## Lot 0.3.33 — catalogue OpenCode dépassant 100 modèles

Reproduction avec une clé OpenCode fournie au cloud comme secret : le moteur
retourne 112 modèles, mais la validation IPC de l’extension en acceptait au
plus 100. Le catalogue était donc rejeté avant son affichage.

Le plafond passe à 1 000, sans troncature ni assouplissement des validations
individuelles. Après correction, les 112 entrées passent la validation et le
cache. Tests de régression du catalogue, de son dernier modèle et du protocole.
Validation locale : **1 848 tests réussis, 12 ignorés**, lint, types et compilation
réussis. Aucun appel d’inférence effectué, aucune clé enregistrée dans le dépôt
ou les journaux. La lecture du catalogue local ne valide pas un appel facturé
au fournisseur ; un essai HTTPS distant de métadonnées a répondu 403.

## Lot 0.3.32 — changements et limites

- **Catalogue** : chargement global borné à 45 secondes, lecture de connexion
  comprise ; annulation du sondage HTTP, nouvel essai possible et messages fixes
  pour connexion indisponible, délai dépassé ou liste vide. Configuration de
  la connexion accessible dans le popover de modèle.
- **Effort OpenAI/OpenCode** : variantes exactes du modèle réellement utilisé,
  annoncées au runtime et revalidées ; Auto omet `variant`. Les alias Claude
  et le préréglage Ultracode restent propres à Claude.
- **Continuité du fil (ADR 0020 amendé)** : même conversation, projet, fil et
  `runIds` lors d’un changement de fournisseur, avec une nouvelle session SDK
  à chaque changement, même A → B → A. Transfert des seuls messages
  utilisateur/assistant du fil courant, masqués : 80 messages, 80 000 caractères
  au total, 8 000 par message. Le contexte partiel est signalé au modèle.
- **Frontière de sécurité** : aucun rejeu d’outil ou de verdict. Les mentions
  anciennes n’autorisent aucune cible ; `onPrompt` et le journal `user.message`
  ne reçoivent que la nouvelle consigne. La gate reste inchangée.

Validation locale : **1 846 tests réussis, 12 ignorés**, lint, typage et
compilation réussis. Les contrôles Chromium couvrent le curseur de variantes
(Auto, singleton et clavier), le chargement relançable et les messages/connexion
dans quatre largeurs et trois thèmes. Les tests vérifient le transfert A → B → A,
les échecs avant confirmation du premier tour, la reprise, l’isolation des autres
conversations et l’absence d’effet des anciennes mentions sur les cibles.
Le **binaire Linux réel a renvoyé 9 modèles sans inférence** ; cette lecture
ne valide pas un tour d’agent. La cause exacte de l’incident sur le PC utilisateur
reste à démontrer. Aucun compte OAuth ou API réel n’a été validé pour ce lot ;
la vérification du catalogue par le vrai binaire Windows est ajoutée à la CI ;
le parcours dans VS Code sur le poste utilisateur reste à effectuer.

## Lot 0.3.30 — code présent et limites

- **Fournisseurs (ADR 0020)** : Claude, OpenAI et OpenCode dans le chat ;
  OpenCode 1.19.0 embarqué et vérifié. Abonnement ChatGPT par OAuth Codex,
  ou clé API OpenAI dans `SecretStorage`, avec isolation des deux modes.
  À l’origine de ce lot, changement de fournisseur : nouvelle conversation
  et effort désactivé hors Claude ; ces deux règles sont remplacées en
  préparation 0.3.32. Catalogues runtime sans inférence.
- **Création et suppression (ADR 0021)** : Exegol dans un terminal interactif,
  choix natif du VPN OpenVPN/WireGuard/dossier et du workspace, NAT, bureau
  web loopback 6080, ressources et `--log`/`script`. Suppression humaine par
  ID Docker après confirmation et revérification ; volumes, images et
  dossiers hôtes conservés, associations de projets nettoyées.
- **Kali complet** : image locale `warband/kali:complete-1`, construite depuis
  Kali rolling avec `kali-linux-headless`, MCP et subfinder/httpx/nuclei.
  Pull avec progression par couche, vitesse et annulation ; rotation des
  logs des nouveaux Kali : `json-file`, 10 Mio × 3.
- **Résultats** : consigne par session de conserver les scans sous
  `/workspace/outputs`, stderr et code de retour compris. `list_notes` et
  `update_note` permettent la lecture/correction des trouvailles du projet
  sans réinjecter d’historique de conversation.

Preuves réelles rapportées pour ce lot : construction complète de l’image
réussie ; pull Alpine via l’API Docker réussi ; catalogue OpenCode de
11 modèles obtenu sans inférence. **Le démarrage de l’image complète n’est
pas validé** : le stockage cloud de 32 Go et le pilote Docker `vfs` n’ont pas
permis de conserver les couches nécessaires à cet essai. La réussite de la
construction ne prouve donc pas le démarrage du conteneur ni ses scans.

Validation locale finale : **1 777 tests réussis, 12 ignorés**, lint, typage
et compilation réussis ; VSIX Linux et Windows construits. Vérification Chromium
des fournisseurs, options Exegol, suppression, progression et annulation sur
quatre largeurs et trois thèmes ; graphe et sorties Kali également contrôlés.
Le moteur Linux empaqueté obtient 11 modèles sans inférence et refuse le mode
API sans clé. Les deux binaires et leurs empreintes sont contrôlés dans les
VSIX. Revue architecte des frontières d’authentification et de la suppression
effectuée ; annulation vérifiée immédiatement avant la suppression Docker.

OAuth et clé API avec des comptes réels, parcours
VS Code Windows, VPN et bureau Exegol ne sont pas validés. Aucun appel
d’inférence réel n’est attesté par la lecture du catalogue.

### Portabilité des tests — 0.3.31

La CI Windows de la 0.3.30 a révélé trois échecs dans les nouveaux tests :
un faux serveur dépendait d’un shebang POSIX et deux chemins attendus
utilisaient des séparateurs Linux. Le faux serveur passe désormais par Node
avec des arguments structurés et les chemins de test suivent la plateforme.
Les assertions d’isolation restent identiques ; le code fonctionnel est inchangé.
Les 17 tests ciblés passent localement.

### Recette restante — à reprendre pour la 0.3.32

| Essai | Résultat attendu |
|---|---|
| Installer les VSIX de cette version | Binaires embarqués vérifiés ; chat et cockpit utilisables |
| Connecter ChatGPT puis tester la clé API séparément | Chaque mode utilise sa propre authentification, sans repli sur l’autre |
| Passer de Claude à OpenAI/OpenCode | Même conversation et projet ; nouvelle session SDK, y compris au retour au fournisseur initial |
| Actualiser les modèles | Catalogue runtime borné ; variantes exactes OpenAI/OpenCode, Auto omet la variante |
| Créer un Exegol avec VPN et bureau | Dialogue natif, terminal interactif, NAT et bureau loopback ; logs présents |
| Construire puis démarrer Kali complet avec assez de disque | Image locale, conteneur actif, santé MCP et outils attendus |
| Annuler un pull, puis reprendre | Annulation visible ; aucune création présentée comme réussie |
| Supprimer un conteneur lié à plusieurs projets | Confirmation, suppression du bon ID, associations nettoyées, volumes et dossiers préservés |
| Exécuter un scan autorisé et corriger sa trouvaille | Fichiers réels dans outputs avec stderr/code ; update_note conserve les autres champs |

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
| Travailler avec l'agent | Chat, plusieurs conversations, mentions, choix de modèle/effort, outils Exegol/Kali, apprentissage | Claude, OpenAI et OpenCode branchés dans l’extension ; comptes réels à valider |
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

Suites identifiées lors de la 0.3.20 : dossiers hôtes supplémentaires et
rapport d'engagement. L’intégration Kali et OpenCode a évolué depuis ; se
référer au lot 0.3.30 en tête de document. Pour Kali, le toolset est déjà branché sur main : comparer aux
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

## Recette historique Windows / VS Code — version 0.3.20

Cette recette décrit le contrat historique de la 0.3.20 ; l’injection du
résumé a été retirée depuis la 0.3.27. Pour la version actuelle, utiliser la
recette 0.3.30 en tête de document. Les tests automatisés Linux et
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

## Retour Windows et correctif 0.3.21

Le choix/création du projet a été validé par le propriétaire sur son PC Windows.
La création de Kali avec un dossier local a échoué avec `source : chemin non
analysable`. La validation pouvait refuser un dossier de travail distinct dès
que Windows empêchait la résolution d'un dossier sensible protégé. Le correctif
utilise ses métadonnées et son parent réel lorsque cela suffit à établir sa
position sans ouvrir son contenu ; les liens non résolvables, les métadonnées
inaccessibles et la source inaccessible restent refusés.

Le scénario est couvert sous Windows simulé ; le nouvel essai sur le PC du
propriétaire reste nécessaire pour confirmer la cause du retour initial.

Validation du correctif : `pnpm check` réussi, **1 639 tests réussis et
12 ignorés** ; compilation réussie. Revue des garde-fous effectuée.

## Retour Kali et correctif 0.3.22

Le conteneur créé avec une image à shell affichait une invite puis sortait
avec le code 0. La création détachée Kali ouvre désormais stdin et un
pseudo-terminal, sans remplacer la commande de l’image. Les conteneurs
existants ne sont pas reconfigurés : créer un nouveau nom avec le même dossier
permet de conserver l’ancien conteneur pendant la vérification.

Validation : 1 639 tests réussis, 12 ignorés. Essai Docker réel avec Alpine
à shell : ancien mode arrêté code 0 ; création via le client Warband corrigé
active, dossier monté lisible, arrêt/redémarrage réussi. Cet essai ne valide
pas les services spécifiques à l’image Kali du propriétaire.

## Préparation Kali automatique — 0.3.23

Créer, Démarrer et Lier depuis le cockpit préparent désormais le serveur Kali :
vérification des binaires, installation conditionnelle sur Kali/APT, puis
contrôle de santé. Une progression est affichée ; l’échec conserve le conteneur
et ouvre la sortie Warband. Aucun paquet n’est installé depuis un outil agent.
L’installation ne prend pas les paquets recommandés et ne se répète pas si les
prérequis existent. Les commandes de l’API s’exécutent depuis `/workspace`.
Décision : ADR 0018.

Validation : 1 651 tests réussis et 12 ignorés ; compilation et VSIX Windows
construits. Essai avec Docker réel et image officielle Kali rolling :
installation effective du paquet `mcp-kali-server` et de Python, santé valide,
seconde préparation sans réinstallation ; `pwd; whoami` renvoie `/workspace`
et `root`. L’essai utilise le miroir officiel HTTPS `kali.download` et le
certificat du proxy cloud dans le seul conteneur de test, en conservant les
vérifications TLS et les signatures APT. Les outils de scan et le parcours
VS Code Windows ne sont pas validés par cet essai.

## Graphe et sorties Kali — 0.3.24

Graphe circulaire inspiré de la référence du propriétaire, libellés sous les
icônes, caméra conservée lors des mises à jour du même projet. Actualisation
par surveillance des fichiers de trouvailles et du projet actif, regroupement
des événements et déduplication des vues identiques. Une lecture plus ancienne
ne peut pas remplacer une nouvelle ; erreurs visibles sans effacer le graphe.

Sorties Kali normalisées avant troncature pour le chat, le Monitor et
l’historique : stdout/stderr lisibles, ANSI neutralisé, erreurs/timeout/code
et résultats partiels conservés. Les journaux et paramètres d’outils restent
bruts. Vérification sur des données fictives, sans requête vers les domaines
d’exemple fournis par le propriétaire.

Validation : 1 658 tests réussis, 12 ignorés, compilation réussie. Chromium
vérifie ajout de nœuds/caméra, changement de projet, erreur sur graphe vide,
les trois thèmes, absence de débordement à 280 px et sortie Kali décodée.
La surveillance des fichiers utilise l’API native de VS Code ; son comportement
sur le poste du propriétaire reste à confirmer.

## Refonte de l’interface — 0.3.25

Charte révisée dans `docs/design-interface-2026.md` selon les captures du
propriétaire : surfaces intégrées au thème, accent fonctionnel du thème,
icônes SVG locales cohérentes. Chat, outils, composer, Configurer, historique,
Monitor et réglages partagent les mêmes contrôles et espacements.
Les niveaux d’effort sont des boutons utilisables au clavier. Les bascules
Apprentissage/Bypass sont regroupées dans Configurer ; les fonctions futures
non disponibles sont retirées. Aucun changement de contrat d’approbation.

Conteneurs : état système compact, création repliée avec brouillon conservé,
détails des lignes dépliables et persistants aux actualisations. Accès direct
à la gestion depuis les réglages. Les nœuds, la minimap, l’actualisation et la
caméra du graphe sont conservés.

Validation : 1 661 tests passés, 12 ignorés ; typage et compilation réussis.
Contrôles Chromium sur le chat, Configurer, approbations, historique, projet
et conteneurs à 280/360/520/900 px, en sombre/clair/contraste élevé ; outils et
création dépliés, aucune erreur JavaScript ni débordement horizontal.
La validation visuelle dans VS Code sur le poste Windows du propriétaire reste
à effectuer avec le VSIX de cette version.

## Lisibilité et réglage d’effort — 0.3.26

Envoyer et les voyants sont ronds ; police Inter variable embarquée sous OFL.
Slider natif souris/clavier, borné aux efforts compatibles, retour Auto
conservé. Projet actif distinct des panneaux Choisir/Nouveau, contexte rappelé
dans la navigation, brouillon conservé et commandes natives inchangées.
Validation : 1 661 tests passés, 12 ignorés. Chromium vérifie la police locale,
le slider souris/clavier et les panneaux/création/brouillon dans trois thèmes
à 280/360/520/900 px. Essai dans VS Code Windows à confirmer par le propriétaire.

## Isolation des conversations — 0.3.27

L’ADR 0019 remplace le partage implicite du résumé de l’ADR 0016 dans
l’extension : aucune réinjection, aucun outil remember exposé, mémoire SDK
automatique désactivée. Nouvelle conversation isole aussi les événements et
démarrages tardifs d’un ancien moteur. Notes et historique conservés ;
reprise explicite et changement de modèle dans le même échange inchangés.
Les sources explicitement jointes (#terminal) et les fichiers de projet ne
sont pas assimilés à l’historique des conversations.

Validation de la 0.3.27 : 1 663 tests passés, 12 ignorés, typage et compilation
réussis. Régressions sur l’absence d’injection, les outils exposés, les
événements tardifs et l’annulation pendant la lecture du jeton. Revue
architecte du correctif effectuée ; aucun appel facturé à un modèle.

## Activité et contexte conteneur — 0.3.28

Anneau de réflexion animé, rangée non rétractable pour éviter l’icône coupée ;
pause approbation/vue masquée et mouvement réduit respectés. Vérification
Chromium à 280/520/900 px, hauteurs 360/900 px, pause et mouvement réduit.

Chaque tour reçoit les noms, familles et états des seuls conteneurs allowlistés
vérifiés, afin d’éviter de choisir les outils Kali pour un Exegol lié. Contexte
courant uniquement ; aucun historique ou résumé injecté. Texte original
conservé pour targets.note et user.message ; gate/résolution inchangées.
Inventaire absent distingué d’une liste vide ; délai Docker borné par commande.

Validation : 1 670 tests réussis, 12 ignorés, typage et compilation réussis.
Régressions Exegol/Kali/mixte, inventaire indisponible, filtrage des métadonnées
et conservation du journal original. Revue architecte du branchement effectuée.

## Erreur de libellé de trouvaille — 0.3.29

Un label note dépassant 200 caractères renvoyait à tort project.invalid, alors
que le projet pouvait être valide. Limite documentée et exposée dans le schéma,
erreur finding.labelInvalid traduite en français/anglais, refus sans écriture
ni troncature puis réessai possible avec un titre court. La limite du graphe
et les validations du projet restent inchangées.
Validation : 1 672 tests réussis, 12 ignorés, typage/compilation et VSIX Windows
réussis. Régression sur la borne 200/201, le schéma exposé, l’absence d’écriture
en cas de rejet, la conservation des trouvailles et le réessai valide.
