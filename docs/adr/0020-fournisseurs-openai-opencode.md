# ADR 0020 — Fournisseurs OpenAI et OpenCode dans l’extension

- Statut : accepté pour le lot 0.3.30, amendé pour la préparation 0.3.32
- Amendement : continuité du fil lors du changement de fournisseur, décision explicitement acceptée par le propriétaire
- Date : 2026-10-25
- Complète les ADR 0005 et 0019.

## Contexte

Le chat proposait uniquement Claude alors que l’adaptateur OpenCode existait.
L’abonnement ChatGPT et la clé API OpenAI utilisent des mécanismes distincts ;
un cache OAuth présent ne doit pas détourner un appel demandé avec une clé.
Un identifiant de session SDK ne se transporte pas entre fournisseurs.
L’amendement 0.3.32 distingue cette session technique du fil utilisateur, qui
doit rester ouvert lors d’un changement de fournisseur.

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
- Découvrir les modèles au runtime sans inférence. Borner le chargement
  global à 45 secondes, lecture de connexion comprise, annuler les requêtes
  HTTP abandonnées et permettre de réessayer. Utiliser des messages fixes
  pour la connexion manquante, le délai dépassé et une liste vide.
- Pour OpenAI/OpenCode, transmettre seulement une variante exacte annoncée
  par le catalogue runtime du modèle réellement utilisé, revalidée dans le
  runner. Auto omet `variant` ; aucun alias d’effort Claude ni préréglage
  Ultracode n’est transmis à ces moteurs.
- Conserver la même conversation, son projet, son fil et ses `runIds` lors
  d’un changement de fournisseur. Chaque changement invalide l’ancienne
  session SDK, y compris A → B → A ; aucune session précédente n’est reprise.
- Transférer uniquement les messages utilisateur/assistant du fil courant,
  masqués et neutralisés : 80 messages au plus, 80 000 caractères au total,
  8 000 caractères par message. Signaler le contexte partiel au modèle.
  Ne pas rejouer les outils, leurs résultats ou les verdicts ; ne pas lire
  les autres conversations ni injecter le résumé de projet.
- Résoudre les mentions et les cibles sur la nouvelle consigne seulement.
  Le contexte transféré n’est pas une autorisation ; `onPrompt` et
  `user.message` reçoivent seulement cette nouvelle consigne. La gate et
  la politique actuelle contrôlent les nouvelles actions.
- Un changement de modèle dans le même moteur conserve son contexte.
  Une nouvelle conversation repart de zéro, conformément à l’ADR 0019.

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

Pour le lot 0.3.30, le catalogue réel de 11 modèles avait été lu sans inférence.
En préparation 0.3.32, le binaire Linux réel renvoie actuellement 9 modèles,
sans inférence. Ce nombre décrit une observation, pas un catalogue figé. Cela ne valide ni
un tour d’agent, ni une connexion OAuth ou API réelle, ni l’hôte VS Code sous
Windows. Les contrôles automatisés finaux sont consignés dans l’état du projet
après exécution ; les tests de contrats facturés ne sont pas automatiques.

## Amendement 0.3.48 — isolation de la configuration du serveur embarqué

À la demande du propriétaire, l'extension active `isolateConfig` sur son runner
OpenCode, pour le catalogue comme pour les conversations et l'apprentissage.
Un `XDG_CONFIG_HOME` temporaire empêche les plugins, hooks et permissions des
agents globaux d'interférer avec la configuration imposée. Les sélecteurs
`OPENCODE_CONFIG` et `OPENCODE_CONFIG_DIR` supplémentaires sont écartés.
Le magasin d'authentification, les dossiers de données, le proxy et les autorités
TLS restent accessibles. Les fichiers personnels ne sont ni modifiés ni effacés.
Les fournisseurs/agents personnalisés déclarés seulement dans la configuration
globale ne sont donc plus importés par l'extension. La bibliothèque/CLI conserve
son comportement existant sans cette option ; le mode OpenAI reste isolé.
Les permissions effectives restent validées en mode fermé : aucun refus n'est
ignoré. Un serveur externe ne peut pas demander cette isolation locale.
