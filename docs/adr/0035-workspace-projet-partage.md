# ADR 0035 — workspace de mission partagé avec Docker

Statut : accepté ; étendu aux sous-dossiers du partage en 0.3.74.

## Parcours

Le dossier hôte du projet (`StoredProject.workspace`), ouvert dans VS Code,
devient la racine des artefacts : `reports`, `payloads`, `scans`, `scripts`,
`evidence`, `notes`. Les anciens dossiers français et les fichiers existants ne
sont ni déplacés ni écrasés. Les noms sur disque ne dépendent pas du réglage FR/EN.

Le cockpit attend un projet pour créer un conteneur et utilise son dossier.
Kali est associé après sa création et sa vérification. Exegol conserve son
parcours interactif natif avec `--workspace` ; une fois créé, l’opérateur
l’associe par le bouton du cockpit. Le bouton Dossier du projet révèle ses
fichiers dans l’Explorateur. Les écritures sont visibles des deux côtés.

## Montage

Le montage physique `/workspace` reste compatible avec les API Kali, tâches
et outils Exegol. Un alias est préparé sous
`/redwidow/Workspace/<nom-normalisé>-<préfixe-UUID>/`. Il référence les mêmes
fichiers : aucune copie ni synchronisation périodique. Le terminal conserve ce
chemin logique avec un wrapper shell fixe. Le prompt personnalisable reste au P2.

Avant préparation : conteneur associé, lancé, source du montage résolue et
comparée au dossier réel du projet, qui peut être le montage ou un sous-dossier réel de celui-ci. Un fichier aléatoire est créé dans le dossier
hôte, lu depuis le chemin correspondant sous `/workspace` puis supprimé. Les parents de l’alias ne doivent
pas être des liens ; un chemin existant incompatible est refusé, jamais remplacé.
Cette préparation intervient à l’association, à l’ouverture du terminal, par
Préparer le dossier de mission et avant un tour visant un conteneur résolu.
Un partage incohérent bloque le tour avant les actions d’agent.

Le mode Apprentissage est explicitement exclu de la préparation dans le moteur,
par retour anticipé et garde-fou `!learningMode`. Il n’expose pas les outils fichiers.

Les variantes Docker Desktop sont adaptées ; la preuve de partage reste
obligatoire. Un démon distant sans partage local accessible n’est pas présenté
comme synchronisé. Aucun conteneur existant n’est recréé automatiquement.
Un renommage peut ajouter un alias ; l’ancien alias et les fichiers restent.
Deux missions doivent utiliser des dossiers hôtes distincts : deux projets
configurés sur le même dossier partagent nécessairement ces fichiers.

## Écriture des artefacts

`projectfiles.write_project_artifact` crée des fichiers UTF-8 dans une catégorie
fixe, avec nom simple et limite de 256 Kio. Pas de chemin absolu, traversée, nom
Windows réservé ou écrasement. Chemins réels vérifiés, liens sortants refusés,
création exclusive sans suivi du lien final. Une création avortée est nettoyée
si elle appartient encore au même fichier. Aucun contenu n’est exécuté.

Les deux adaptateurs utilisent le même outil et la même méthode de rangement.
La gate habituelle s’applique et les contrôles du handler restent obligatoires,
y compris après une approbation ou en Bypass.

Ce n’est pas une nouvelle sandbox du conteneur. Les commandes arbitraires et les
outils externes gardent leurs permissions ; le dossier courant et une consigne
ne garantissent pas le confinement de toutes leurs écritures. Le contrôle fort
décrit ici concerne l’outil d’artefacts. Aucun parser shell prétendant résoudre
cette limite ni modification silencieuse des droits SDK n’est introduit.
Les caches système ne constituent pas les destinations des fichiers de mission.

## Migration

Si le dossier actif est le montage ou un sous-dossier de celui-ci, la préparation
est additive. Sinon, conserver l’ancien conteneur et sauvegarder ses données
avant de créer explicitement un conteneur utilisant le bon dossier ; comparer
les fichiers avant tout retrait de l’ancien. Docker nécessite une recréation
pour changer le montage. Aucune suppression ni copie forcée n’est automatique.
Ne pas appliquer `chmod 777` pour contourner un problème de permissions.

## Vérification

Tests : chemins, catégories, refus d’écrasement, liens sortants, traversée,
UTF-8, annulation et logique du terminal ; recettes du cockpit en FR/EN.
Docker réel sur Kali, réseau désactivé : partage avec espaces dans le chemin,
écritures dans les deux sens, refus d’un autre projet et conservation après
suppression du conteneur de test. Windows et Exegol natifs restent à valider.
Les droits d’un shell arbitraire ne sont pas présentés comme un confinement testé.
