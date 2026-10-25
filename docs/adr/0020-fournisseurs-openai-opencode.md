# ADR 0020 — Fournisseurs OpenAI et OpenCode dans l’extension

- Statut : accepté pour le lot 0.3.30
- Date : 2026-10-25
- Complète les ADR 0005 et 0019.

## Contexte

Le chat proposait uniquement Claude alors que l’adaptateur OpenCode existait.
L’abonnement ChatGPT et la clé API OpenAI utilisent des mécanismes distincts ;
un cache OAuth présent ne doit pas détourner un appel demandé avec une clé.
Une session de conversation ne se transporte pas entre fournisseurs.

Repères : `packages/vscode/src/extension/extension.ts` (connexion et stockage),
`packages/agent-opencode/src/runner.ts` (environnement d’authentification et
catalogue), `packages/agent-opencode/src/config.ts` (configuration imposée),
`packages/vscode/src/logic/session.ts` (cycle des conversations) et
`packages/vscode/scripts/package-vsix.mjs` (binaire 1.19.0 et empreintes).

## Décision

- Embarquer OpenCode 1.19.0 pour Linux/Windows x64 et vérifier son empreinte
  avant exécution ; préserver le contrat neutre `AgentRunner` et la gate.
- Proposer OpenAI officiel via ce moteur : abonnement ChatGPT par OAuth Codex
  (`auth login --provider openai`) ou clé API dans `SecretStorage` de VS Code.
  Le cache OAuth appartient à OpenCode. Le mode abonnement retire les clés
  API de l’environnement ; le mode API exige une clé et isole le cache OAuth.
- Isoler la configuration OpenAI officielle pour empêcher les surcharges de
  destination, plugins ou paramètres incompatibles. Ne jamais journaliser
  les secrets ni les identifiants de compte.
- Conserver une entrée OpenCode utilisant ses fournisseurs configurés, sous
  les permissions traduites vers la gate Warband.
- Découvrir les modèles au runtime sans inférence. Désactiver le réglage
  d’effort hors Claude tant que son contrat n’est pas implémenté.
- Ouvrir une nouvelle conversation lors d’un changement de fournisseur ;
  conserver le contexte lors d’un simple changement de modèle du même moteur.

## Alternatives écartées

- Catalogue de modèles figé : il divergerait des droits et capacités réels.
- Réutilisation implicite du cache OAuth en mode API : facturation ambiguë.
- Reprise d’un ID de session chez un autre fournisseur : contexte incohérent.
- Connexion OAuth réimplémentée dans la webview : gestion supplémentaire de
  secrets et de protocoles déjà pris en charge par OpenCode.

## Conséquences et validation

Deux binaires doivent être empaquetés et vérifiés ; les comptes OAuth restent
gérés dans leur stockage OpenCode. Effacer la connexion OpenAI Warband conserve
ce cache ; la déconnexion complète passe par `auth logout`.

Le catalogue réel de 11 modèles a été lu sans inférence. Cela ne valide ni
un tour d’agent, ni une connexion OAuth ou API réelle, ni l’hôte VS Code sous
Windows. Les contrôles automatisés finaux sont consignés dans l’état du projet
après exécution ; les tests de contrats facturés ne sont pas automatiques.
