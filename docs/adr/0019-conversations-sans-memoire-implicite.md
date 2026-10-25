# ADR 0019 — Conversations sans mémoire implicite

Statut : accepté, à la demande du propriétaire le 25 octobre 2026.
Remplace l’injection S2 de l’ADR 0016 pour l’extension.

## Constat

Le résumé de projet était réinjecté automatiquement dans chaque nouvelle
conversation. L’outil remember pouvait y enregistrer des éléments d’un autre
échange. Ce partage est incompatible avec le souhait du propriétaire de
repartir sans les messages précédents dans une nouvelle conversation.

## Décision

- Aucune injection automatique du résumé de projet par le moteur de l’extension.
- Aucun outil remember dans les toolsets exposés par l’extension. La CLI
  conserve son contrat d’outils, sans changer silencieusement son API.
- Mémoire automatique du SDK désactivée par settings.autoMemoryEnabled=false,
  imposé par l’adaptateur et non surchargeable par sdkOptions.
- Nouvelle conversation invalide les démarrages asynchrones en attente et
  ignore les événements d’un moteur abandonné, sessionId compris.
- Les notes et l’historique existants restent stockés et consultables par
  l’utilisateur ; aucune suppression de données.
- Changer de modèle dans une même conversation conserve son contexte.
  Reprendre une conversation depuis l’historique est une action explicite.

## Périmètre

Cette décision supprime le transfert implicite du contexte des conversations.
Elle ne crée pas de sandbox de système de fichiers : les fichiers du projet,
les sorties de terminaux explicitement cités avec # et les résultats de
conteneurs restent des sources distinctes accessibles selon les permissions
existantes. Le contrat de la gate et du Bypass n’est pas modifié. Le refus
d’un fournisseur ne constitue pas une preuve de lecture d’un ancien chat.
