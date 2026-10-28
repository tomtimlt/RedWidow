# ADR 0029 — Fichiers texte joints au chat

Statut : accepté et implémenté pour la 0.3.60. Lecture, décision, implémentation
et revue dans la session principale à la demande de travailler sans sous-agents.

## Décision

Le contrat neutre du moteur accepte un prompt texte, pas des contenus multimodaux.
Cette livraison accepte donc uniquement des textes UTF-8, logs et code, sans
prétendre interpréter des images ou PDF. La sélection native HTML et le dépôt
lisent les objets File choisis volontairement. Aucun URI ou chemin envoyé par
la webview ne permet une lecture du disque côté hôte.

Les contenus restent en mémoire dans un brouillon borné : cinq fichiers,
64 Kio par fichier et 256 Kio cumulés. Le décodage UTF-8 est strict ; les NUL,
formats binaires connus, noms avec chemins ou contrôles sont refusés. Ces limites
et la forme exacte name/text sont revalidées par l’extension, indépendamment de
l’interface. L’ajout d’un lot invalide ne modifie pas les fichiers déjà joints.

Le prompt ajoute un tableau JSON de données non fiables après la résolution des
mentions de terminal : un #terminal contenu dans un fichier n’est jamais une
instruction de lecture. Aucun nouveau droit, outil ou contournement de gate.
L’interface envoie la conversation courante et un identifiant d’acquittement.
L’hôte revalide confiance, visibilité, disponibilité et génération du projet
avant et après les opérations asynchrones. Session.send renvoie true seulement
après transmission au contrôleur, false en cas de refus ou échec.

Un acquittement négatif conserve le brouillon. Un acquittement positif retire
les fichiers envoyés, en préservant un nouveau texte saisi pendant l’attente.
Un changement de conversation/chat invalide les lectures et les réponses
périmées ; la première création de conversation par l’envoi est reconnue par
la bulle attendue. Les pièces jointes ne sont jamais persistées dans setState.

## Limites et vérification

Les contenus rejoignent le prompt et le journal existants, avec leur masquage
habituel ; ce masquage ne justifie pas de joindre des secrets. Aucun stockage
séparé ni téléversement dans le conteneur. Les reprises avec transfert de contexte
fondé sur les bulles ne retransmettent pas automatiquement ces contenus.

Tests du protocole, bornes UTF-8, refus de chemins et formats, composition du
prompt et acquittements session. Parcours Chromium sur HTML et scripts réels :
sélection, dépôt, retrait, refus, conservation après erreur, première conversation,
isolation et absence de contenu dans l’état persistant, thèmes sombre/clair/HC.
La webview est simulée dans Chromium ; la sélection native sur Windows reste à
confirmer dans VS Code, sans bloquer les contrôles automatisés.
