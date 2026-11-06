# RedWidow 0.3.73 — chats indépendants et Red Team — Expert

Cette livraison réunit les lots locaux P0/P1/P2 et la P4. L’identité technique
`warband.*`, les projets et l’historique existants sont conservés.

## Changements

- Chats indépendants : Bypass, fournisseur, modèle, effort, variante et modes
  restent rattachés au chat. Le Bypass est éteint pour une nouvelle conversation.
- Rendu du chat incrémental : les messages inchangés restent en place pendant
  les sorties d’outils. La sélection de texte et la position de lecture sont conservées.
- Navigation par échange utilisateur ou IA, avec relecture de l’historique à la
  demande et retour au direct. La pagination du Monitor reste distincte.
- La sortie détaillée d’une commande terminée ne propose plus le suivi du bas.
- Continuité de conversation, recherche Web explicite, arrêt et traçabilité de
  mission renforcés ; détail et limites dans la recette P4.
- Le profil Red team devient Red Team — Expert, sous le même identifiant
  `red-team` : investigation, recherche technique, hypothèses et discipline de preuve.
- P0 : vues bornées, pagination et rendu différé pour les longues sessions.
- P1 : dossier de projet partagé avec Docker, catégories de fichiers et outil
  de création d’artefacts sans écrasement.
- P2 : quatre styles de prompt Bash Docker, sans modification permanente du `.bashrc`.

## Validation

Les scénarios et limites sont consignés dans `docs/recettes/p4.md`. Le kit inclut
les journaux de vérification complète, la recette Chromium et le rapport
d’inspection des deux VSIX. Les tests de contrat facturés ne sont pas lancés automatiquement.

## Limites

Les scénarios synthétiques navigateur ne remplacent pas une session prolongée
dans VS Code natif. Windows/Docker Desktop et Exegol réel nécessitent une recette
sur leurs environnements respectifs. Aucun gain de performance des modèles n’est
annoncé sans évaluation comparative avec modèles réels.

## Installation et publication

Installer le VSIX correspondant à sa plateforme depuis VS Code, commande
« Extensions: Install from VSIX… ». Vérifier son SHA-256 avant installation.

La livraison comporte les paquets `linux-x64` et `win32-x64`, leurs empreintes,
les sources exactes et les justificatifs de validation. Le brouillon GitHub vise
le commit compilé. Le kit est déposé dans le dossier Drive privé Warband ; la
publication finale reste à l’utilisateur.
