# 0052 — Version serveur web et authentification

- Statut : accepté
- Date : 2026-11-12

## Contexte
RedWidow n'existe que comme extension VS Code. On veut une version installable sur un VPS Linux, ouverte dans un navigateur derrière un mot de passe, orientée bug bounty et livrée en Docker.

Le moteur tourne déjà dans un processus Node séparé, lancé par `fork` et piloté par messages (`ToEngine`/`FromEngine`, `packages/vscode/src/logic/protocol.ts`). Seul `src/extension/extension.ts` importe `vscode` (garde : `test/boundary.test.ts`). `src/logic` et `src/engine` sont réutilisables sans modification. Les vues sont du JavaScript sans framework qui parle à l'hôte par `postMessage`.

## Décision
1. **Nouvel hôte `packages/server`** (`@warband/server`), Node ≥ 22, `node:http` et une seule dépendance `ws` en version exacte. Il remplace `extension.ts` : il lance le même moteur, sert la même logique. `packages/vscode` ne change pas de comportement.
2. **Pont WebSocket.** Le navigateur reçoit un adaptateur qui fournit la même interface qu'`acquireVsCodeApi()`. Chaque message passe par une WebSocket authentifiée et est validé côté serveur par les validateurs existants avant d'atteindre le moteur. `PROTOCOL_VERSION` inchangé.
3. **Authentification fermée par défaut.**
   - Un seul compte. Mot de passe haché par `scrypt` (`node:crypto`), fourni par `REDWIDOW_PASSWORD_HASH` ou créé par `redwidow-server set-password`. Sans mot de passe, le serveur refuse de démarrer.
   - Session par cookie `HttpOnly; Secure; SameSite=Strict`, jeton aléatoire de 256 bits, expiration glissante, déconnexion. Seule l'empreinte SHA-256 du jeton est gardée en mémoire.
   - Délai croissant par IP après un échec de connexion. Contrôle d'`Origin` sur toute requête modifiante et sur l'ouverture WebSocket.
   - CSP stricte reprise de `logic/html.ts`, nonce par page.
   - Mot de passe, jeton de session et secrets des fournisseurs ne sont jamais journalisés.
4. **La gate reste l'unique autorité.** Les demandes d'approbation s'affichent dans l'interface web ; seule une session authentifiée y répond. Bypass, arrêt d'urgence et règles « jamais mémorisable » gardent leur sémantique (ADR 0017, 0040, 0041). Sans navigateur connecté, une demande attend : jamais d'approbation implicite.
5. **Stockage sur `/data`.** L'état remplace `globalState`. Les secrets des fournisseurs remplacent `SecretStorage` et sont chiffrés au repos en AES-256-GCM, clé dérivée de `REDWIDOW_SECRET_KEY` par scrypt. Les journaux restent en `.warband/runs/*.jsonl`. Les processus enfants gardent `safeEnv`.
6. **Bascule de fournisseur.** L'utilisateur enregistre une liste ordonnée d'identifiants (clés) par fournisseur. Quand le moteur signale une limite atteinte (HTTP 429, quota, code de limite du fournisseur), l'hôte passe à l'identifiant suivant, vérifie par un appel léger que le nouvel identifiant est accepté, relance le moteur avec lui, puis reprend la mission sur la même conversation. Chaque bascule est un événement journalisé, sans la valeur de la clé. Si tous les identifiants sont épuisés, la mission s'arrête et l'interface le dit.
7. **Docker.** Image serveur Node slim multi-étapes, utilisateur non root, `HEALTHCHECK`, binaire `opencode` embarqué. Compose `redwidow` + `caddy` (HTTPS automatique, seuls 80/443 exposés ; le serveur n'écoute que sur le réseau interne). Le serveur pilote les conteneurs Kali/Exegol par le socket Docker de l'hôte ; l'agent travaille dans ces conteneurs et ne voit jamais le socket.

## Modèle de menace (court)
- **Attaquant réseau sans mot de passe** : tout est refusé (401) sauf `/healthz`, la page et la route de connexion. Force brute freinée par délai croissant. TLS terminé par Caddy.
- **Site tiers dans le navigateur de l'utilisateur** : cookie `SameSite=Strict` et contrôle d'`Origin` (CSRF, détournement de WebSocket).
- **Contenu injecté dans les vues** (sortie d'outil, page cible) : CSP stricte avec nonce, pas de script inline sans nonce.
- **Agent compromis par une cible** : il reste soumis à la gate, à la politique et au périmètre ; il ne voit ni le socket Docker ni les secrets (`safeEnv`).
- **Vol du volume `/data`** : secrets chiffrés ; la clé est hors du volume (variable d'environnement).
- **Hors périmètre** : compromission de l'hôte VPS ou de Docker. Le socket Docker monté donne les droits de l'hôte au conteneur serveur ; le VPS doit être dédié.

## Alternatives écartées
- **code-server / VS Code dans le navigateur** : surface énorme, authentification faible, l'extension resterait liée à VS Code.
- **Framework web (Express, Fastify)** : dépendances inutiles pour quelques routes.
- **Plusieurs comptes utilisateurs** : non demandé ; un compte unique simplifie le modèle.

## Conséquences
- Nouvelles surfaces à tester : authentification, Origin, WebSocket sans session, pont moteur.
- La fiche programme et le périmètre restent une déclaration de l'utilisateur, comme dans l'extension.
- Le socket Docker monté impose un VPS dédié.
