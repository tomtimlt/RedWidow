# 0054 — Identifiant enregistré par l'agent

- Statut : accepté
- Date : 2026-11-12

## Contexte
En mission, l'agent découvre des identifiants (jeton, mot de passe d'un compte de test). Laissés dans le chat ou le journal, ils traînent en clair. L'utilisateur veut que l'agent puisse les ranger dans le coffre chiffré du serveur web (ADR 0052), comme les comptes de test saisis à la main (ADR 0043).

## Décision
1. Outil `mcp__desk__store_credential` (`{label, login?, secret, kind, programme?}`), exposé seulement si l'hôte annonce la capacité au démarrage (le serveur web oui, l'extension VS Code non).
2. Il passe par la gate comme tout outil ; la politique par défaut le met en `ask`.
3. Le secret n'entre dans aucun journal : le recorder l'apprend à l'appel de l'outil, avant de masquer l'entrée, et le masque ensuite dans tout événement (`Recorder.addSecret`, additif au masquage existant). Les runners et le moteur l'apprennent dès l'apparition de l'appel.
4. Transport moteur → hôte par messages IPC additifs (`credentialStore`, `credential`, `credentialAck`), `PROTOCOL_VERSION` inchangé. L'outil ne renvoie à l'agent que `{ok, id}`.
5. Le serveur range le secret au coffre, les métadonnées dans l'état (`createdBy: "agent"`), et audite sans la valeur.

## Conséquences
- Les secrets de moins de 6 caractères sont stockés mais pas masquables (règle de l'ADR 0043).
- La transcription interne du binaire de l'agent, hors du journal warband, peut garder le secret.
- Les terminaux déjà ouverts ne masquent pas un secret ajouté après leur ouverture ; les nouveaux le masquent.
