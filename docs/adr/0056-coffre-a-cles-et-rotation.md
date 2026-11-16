# 0056 — Coffre à clés par fournisseur et rotation sur quota

- Statut : accepté (version de test, branche `multi-agent`)
- Date : 2026-11-16

## Contexte
Faits du code :
- **Une seule clé par fournisseur.** Il n'existe qu'un jeton Claude (`warband.token`, `warband.tokenKind`) et une clé OpenAI (`warband.openai.apiKey`) dans `SecretStorage` (`extension.ts:219-221`). La saisie passe par `showInputBox({ password: true })` (`extension.ts:5392-5401`).
- **Transmission.** La clé n'arrive au moteur que par l'environnement du processus enfant : `EngineAuth`, puis `buildEngineEnv` (`logic/controller.ts:34-78`). Elle n'est jamais dans `process.env` de l'hôte, ni sur disque.
- **OpenCode.** Le serveur part de `safeEnv` (`agent-opencode/src/server.ts:58-80`), et `authEnvironment` pose `OPENAI_API_KEY` (`agent-opencode/src/runner.ts:402-445`).
- **Quotas.** Aucune détection propre. Côté SDK, `rate_limit_event` devient `rate.limited` sans effet (`agent-sdk/src/runner.ts:1003-1014`). Côté OpenCode, « Free usage exceeded » ou un retry de plus de 60 s fait échouer le run en `provider.error` (`agent-opencode/src/runner.ts:981-1068`).
- **Masquage.** Le recorder fige la liste des secrets à sa création (`core/src/recorder.ts:54`, `secretsFromEnv`), et le contrôleur fige la clé à sa construction (`controller.ts:164`).
- **Relance.** `resume` reprend une session (`core/src/runner.ts:58`), mais rien ne relance un run après une erreur.

L'utilisateur veut plusieurs clés par fournisseur activé, une rotation automatique quand un quota est dépassé, et la preuve que le moteur utilise bien la clé choisie.

## Décision
1. **Coffre.** Une entrée `SecretStorage` par fournisseur : `warband.vault.<fournisseur>`, valeur JSON `{ keys: [{ id, label?, value, addedAt, state, cooldownUntil? }] }`.
   - `state` vaut `active`, `exhausted` ou `invalid`.
   - Les fournisseurs concernés sont ceux qui utilisent une clé d'API : `claude` (mode clé d'API, variable `ANTHROPIC_API_KEY`), `openai` (`OPENAI_API_KEY`) et chaque fournisseur OpenCode configuré. Pour ce dernier, le nom de variable est validé par `^[A-Z][A-Z0-9_]*_(API_KEY|TOKEN)$` (ADR 0005, §4).
   - Le jeton d'abonnement Claude (OAuth) reste hors du coffre.
   - Au plus 10 clés par fournisseur.
   - L'ancienne clé unique devient la première clé du coffre, sans être effacée tant que la migration n'a pas réussi.
2. **La valeur ne sort jamais du coffre**, sauf vers l'environnement d'un moteur enfant. La webview ne reçoit que `id`, `label`, l'empreinte, `state` et `cooldownUntil`. La saisie se fait côté hôte (`showInputBox({ password: true })`), jamais dans un champ de la webview. Une clé n'est jamais journalisée, jamais envoyée dans un message `start` et jamais écrite sur disque. `safeEnv` reste inchangé.
3. **Empreinte.** `sha256(value)`, réduit aux 8 premiers caractères hexadécimaux et préfixé du rang : « clé 2 · 3fa9c1d0 ». Ni les premiers ni les derniers caractères de la clé ne sont montrés.
4. **Masquage.** Chaque moteur reçoit sa clé dans son environnement, et son recorder la masque (`secretsFromEnv`). Le recorder de l'hôte reconstruit sa liste de secrets à chaque modification du coffre, avec toutes les clés de tous les fournisseurs.
5. **Classement des erreurs.** Une fonction pure du cœur, `classifyProviderFailure`, range chaque échec dans `quota`, `invalidKey` ou `other`.
   - **`quota` :** statut 429, `insufficient_quota`, quota ou crédit épuisé, « Free usage exceeded », retry annoncé au-delà de 60 s, ou `rate_limit_event` au statut `rejected`.
   - **`invalidKey` :** statut 401 ou 403, `authentication_failed`, `ProviderAuthError`.

   Tout le reste vaut `other`, et ne provoque **jamais** de rotation.
6. **Rotation.** Elle se fait sur `quota` ou `invalidKey`, et seulement pour une clé venant du coffre.
   - La clé fautive passe à `exhausted`, avec `cooldownUntil` égal au retry annoncé, ou à 60 minutes par défaut. Sur `invalidKey`, elle passe à `invalid`, sans délai.
   - L'hôte choisit la clé `active` suivante dans l'ordre du coffre. Une clé `exhausted` redevient `active` une fois son délai passé.
   - Il relance le run dans un **nouveau processus moteur**, avec la nouvelle clé et `resume` sur la même session. C'est obligatoire, car la clé est figée dans l'environnement du processus.
   - Au plus autant de rotations par envoi qu'il y a de clés.
   - Quand toutes les clés sont épuisées, le run échoue avec `vault.allExhausted`, en indiquant la fin du plus court délai.
   - En campagne (ADR 0054), le même mécanisme s'applique à chaque moteur. Un worker relancé garde son intention.
7. **Vérification de la clé.** Au démarrage, le moteur calcule l'empreinte de la clé **réellement présente dans l'environnement qu'il transmet au SDK ou au serveur OpenCode**, et non de celle que l'hôte croit avoir envoyée. Il émet l'événement `provider.key` (`provider`, `keyRank`, `fingerprint`). L'hôte compare cette empreinte à celle de la clé choisie. Si elles diffèrent, le run est arrêté avec `vault.keyMismatch` (on échoue fermé). Le chat affiche la clé effective.
8. **Événements.** `provider.key` et `vault.rotated` (`provider`, `from` et `to` en rangs et empreintes, `cause` : `quota` ou `invalidKey`). Chacun a son validateur et son entrée `KIND_CLASS`. Les nouveaux codes de raison vont dans `REASON_CODES` et dans les catalogues fr et en.

## Lots
1. `core` : types du coffre (sans stockage), choix et rotation (fonctions pures, horloge injectée), `classifyProviderFailure`, empreinte, événements, codes, tests.
2. Hôte et moteur : stockage `SecretStorage` et migration, clé du coffre au lancement, `provider.key` émis par le moteur et vérifié par l'hôte, rotation avec relance `resume` (chat et campagne), masquage reconstruit, tests.
3. Interface (`cadre`, puis `surface`) : gestion du coffre par fournisseur (ajouter, renommer, supprimer, voir l'état et le délai), et clé effective affichée dans le chat.

## Conséquences
- Une rotation coûte un redémarrage du moteur, soit quelques secondes. La session est reprise, pas recommencée.
- Une erreur mal classée en `other` ne déclenche pas de rotation : l'erreur s'affiche comme aujourd'hui. On préfère rater une rotation plutôt que de faire tourner des clés sur une erreur qui n'a rien à voir avec un quota.
