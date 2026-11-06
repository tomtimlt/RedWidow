# Recette P2 — prompt des terminaux Docker

Date : 5 novembre 2026. Branche : `temp/p2-terminal-prompt`.
P0 et P1 conservés. Aucune release, aucun paquet de livraison ni publication.

## Utilisation

Dans **Réglages → Apparence → Prompt du terminal Docker**, choisir :

- **D’origine**, valeur par défaut : lancement Bash existant et thème du conteneur.
- **RedWidow** : deux lignes, identité et dossier courant.
- **Compact** : utilisateur, hôte et dossier courant sur une ligne.
- **Minimal** : dossier courant, sans couleurs.

Les cartes montrent un exemple et confirment l’enregistrement. Un échec de
sauvegarde conserve la sélection confirmée et affiche une erreur. Le choix
est également disponible dans les réglages VS Code : `warband.terminalPrompt`.
La préférence est utilisateur/machine ; une valeur du dépôt n’est pas utilisée.

Le changement concerne les nouveaux terminaux Bash Docker ouverts par
RedWidow, pour Kali comme Exegol. Un terminal existant, ou simplement révélé
par l’extension, conserve son shell actuel. Pour voir le nouveau choix, fermer
un terminal puis en ouvrir un nouveau. D’origine permet de revenir au thème
du conteneur lors de la prochaine ouverture.

## Fonctionnement

Le réglage et les messages de la webview acceptent uniquement quatre identifiants.
Aucune saisie de code shell libre et aucune interpolation de chemin de projet
ou de nom de conteneur dans le script de prompt.

Pour un style personnalisé, Bash reçoit un rc éphémère par substitution de
processus : il charge le `.bashrc` existant et ajoute son réglage de prompt.
Aucun fichier `.bashrc` ou rc permanent n’est écrit. Les hooks `PROMPT_COMMAND`
existants sont conservés, en chaîne ou tableau, et le prompt est réappliqué
après eux. La fonction restitue le statut reçu. Les caractères non imprimables
ANSI du prompt sont délimités pour préserver le calcul des positions par Bash.
Le répertoire logique du P1 et le wrapper de capture ne sont pas remplacés.

`script` util-linux continue de capturer le terminal lorsqu’il est disponible.
Le même style fonctionne dans le lancement sans capture si `script` manque.
Le mode D’origine conserve exactement son lancement antérieur.

## Vérifications réalisées

- `pnpm check` complet : **2 278 tests réussis, 14 ignorés**, vérification
  TypeScript réussie, zéro erreur Biome ; 187 avertissements et 8 informations.
- Tests Bash réels : chaque style personnalisé, rc absent ou présent,
  plusieurs invites, statut après `false`, hooks chaîne et tableau modifiant
  eux-mêmes PS1, capture util-linux avec `SHELL=/bin/sh`, lancement sans `script`,
  contenu `.bashrc` inchangé. Valeurs inconnues et champs supplémentaires refusés.
- Docker Kali réel, réseau désactivé : les quatre styles lancés par le chemin
  de production (`terminalLaunch` et `capturedShell`), dossier logique P1
  conservé, hooks conservés, statut et journal vérifiés, empreinte `.bashrc`
  identique avant et après. Le conteneur de recette a ensuite été retiré.
- Navigateur sur la vraie webview avec sa CSP : quatre aperçus, sélection reçue
  de l’hôte, attente de confirmation, erreur et succès de sauvegarde, retour
  à D’origine, navigation clavier, changement FR/EN, palette et affichage étroit
  en contraste élevé. Aucun débordement des cartes sur la vue contrôlée,
  aucune erreur de navigateur.
- Après ajustement visuel des cartes : nouvelle vérification CSS et nouvelle
  recette navigateur réussies. Pas de nouvelle modification du comportement.

Preuves locales :
`/workspace/work/p2-native-prompt-verification.json`,
`/workspace/work/p2-studio-verification.json` et
`/workspace/work/p2-apparence-fr.png`.
Journal complet : `/tmp/p2-check.log`.

## Limites à vérifier avant livraison

Pas de recette native Windows/Docker Desktop ni d’image Exegol réelle dans
cette session. La recette navigateur ne remplace pas l’essai dans VS Code
installé. Le chemin de lancement existant utilise Bash : ce réglage ne convertit
pas les terminaux externes ou les sessions Zsh.

Un rc qui remplace Bash avec `exec`, verrouille PS1 ou PROMPT_COMMAND en lecture
seule, ou installe des traps personnalisés peut empêcher le style souhaité.
Utiliser D’origine pour ces configurations. Les styles personnalisés nécessitent
la substitution de processus Bash et `/dev/fd`, vérifiés dans le conteneur Kali.

La préférence porte uniquement sur l’affichage du prompt. Aucune modification
de gate, de droits d’exécution ou d’exposition des outils en mode Apprentissage.
