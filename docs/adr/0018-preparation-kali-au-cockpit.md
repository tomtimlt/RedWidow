# 0018 — Préparer le serveur Kali lors des actions du cockpit

- Statut : accepté
- Date : 2026-10-24
- Amende : ADR 0014, installation des prérequis par les actions humaines du cockpit ; aucun changement des permissions des outils de l'agent.

## Contexte

Le propriétaire a validé la création, le démarrage et l'association d'un
conteneur Kali. Le premier appel à `mcp__kali__execute_command` a pourtant
échoué avec `kali.unavailable` : l'image locale ne contenait pas le serveur
attendu. Après installation manuelle de `mcp-kali-server`, l'appel a réussi.
Créer un conteneur et le déclarer prêt dans ce parcours ne suffit donc pas à
préparer les outils de l'agent.

L'ADR 0014 interdit les installations implicites pendant un appel de l'agent :
ce contrat reste utile. Le propriétaire demande désormais la préparation
automatique à la création, et une vérification au démarrage. Ces gestes
explicites du cockpit constituent le point d'installation.

L'essai réussi a aussi rendu `pwd = /usr/share/mcp-kali-server`, alors que le
parcours annonce `/workspace`. Le répertoire du processus HTTP ne doit pas
devenir le répertoire des commandes de mission.

## Décision

1. **Préparation après une action humaine.** Après création d'un Kali, après
   son démarrage, ou avant association d'un Kali déjà démarré, vérifier ses
   prérequis et la disponibilité du serveur. Afficher une progression ; ne
   pas faire croire que l'opération a réussi si la préparation échoue.

2. **Présence d'abord, installation conditionnelle.** Vérifier `python3` et
   `kali-server-mcp` dans le conteneur. S'ils existent déjà, ne lancer aucune
   installation ni mise à jour APT. Sinon, sur une image Kali compatible,
   exécuter `apt-get update`, puis l'installation non interactive de `python3`
   et `mcp-kali-server` depuis les dépôts configurés dans cette image. Vérifier
   ensuite la présence des exécutables et la santé du serveur.

3. **Cible fixe, hors du modèle.** Le nom vient de la liste Docker courante ;
   il doit encore désigner un conteneur de famille Kali en cours d'exécution.
   Le modèle ne choisit ni paquets, ni commandes de préparation, ni dépôt APT.
   Installation dans ce conteneur uniquement, sous root ; aucun paquet n'est
   installé sur le poste de l'utilisateur. Aucun port n'est publié et le
   serveur écoute uniquement sur `127.0.0.1:5000` dans le conteneur.

4. **Échec visible et reprise possible.** Un dépôt inaccessible, une image
   incompatible, une installation refusée ou un serveur qui ne démarre pas
   donnent une erreur identifiant l'étape. Conserver le conteneur et son
   dossier pour permettre le diagnostic et une nouvelle tentative. Ne pas
   contourner les signatures APT ou la vérification TLS ; ne pas supprimer
   des paquets déjà installés pour simuler un retour arrière.

5. **Les appels de l'agent n'installent rien.** Ils conservent la résolution
   de cible, la gate et la vérification/démarrage du serveur définis par
   l'ADR 0014. Le Bypass ne transforme pas un appel d'outil en demande
   d'installation. Le mode Apprentissage ne prépare aucun conteneur.

6. **Répertoire explicite.** Les commandes transmises à l'API Kali exécutent
   leur contenu depuis `/workspace`, après contrôle par la gate. Ne pas
   remplacer l'entrée de l'image ni déduire un répertoire depuis la réponse
   du modèle. Vérifier les commandes multilignes, les commentaires et les
   codes de sortie pour préserver la sémantique de l'appel.

## Alternatives écartées

- **Installer à chaque démarrage sans vérification.** Réseau et temps perdus,
  mises à jour inutiles, échec possible alors que le conteneur était prêt.
- **Installer depuis le premier appel de l'agent.** Mélange une action de
  mission et la préparation de l'environnement ; l'erreur arrive trop tard.
- **Image Warband préconstruite obligatoire.** Reproductibilité intéressante,
  mais impose de maintenir et distribuer une image et exclut les images Kali
  locales du propriétaire. Une image personnalisée contenant les prérequis
  reste compatible et évite l'installation conditionnelle.
- **Contourner l'API par un exec générique en cas d'échec.** Changerait le
  contrat et les outils disponibles silencieusement. L'échec reste explicite.

## Conséquences

Une création ou un premier démarrage peut nécessiter le réseau et durer plus
longtemps. Les suivants réutilisent les paquets présents. Une image sans les
dépôts nécessaires ne devient pas compatible par son seul label Docker.

Les paquets installés appartiennent au système de fichiers du conteneur : ils
survivent à son arrêt/redémarrage, mais pas à sa suppression/recréation depuis
l'image d'origine. Le dossier monté `/workspace` reste indépendant.

## Plan et validation

- Préparation dans le cœur, réservée aux actions de l'hôte et testée avec
  Docker simulé : prérequis présents, manquants, installation échouée,
  mauvaise famille, conteneur arrêté et santé indisponible.
- Branchement cockpit avec progression et erreur observable, sans modifier
  les commandes ni paramètres de la webview pour fournir des scripts.
- Correction du répertoire des commandes API et tests de leur sémantique.
- Essai d'intégration Docker lorsque disponible, puis recette sur le poste
  Windows du propriétaire. Distinguer serveur simulé, paquet réel et image
  réelle ; aucun de ces essais ne prouve seul les deux autres.

L’installation automatique utilise `--no-install-recommends` : elle prépare
le serveur et ses dépendances nécessaires, sans ajouter toute la suite
d’outils Kali recommandée par le paquet. Les outils de mission disponibles
restent ceux installés dans l’image choisie.
