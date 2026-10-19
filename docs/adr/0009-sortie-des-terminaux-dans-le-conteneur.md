# 0009 — Sortie des terminaux `#` journalisée dans le conteneur

- Statut : accepté
- Date : 2026-10-16

## Contexte

Le chat cite un terminal Warband ouvert avec `#jeton` (`#htb1`, `#htb1-2`) pour joindre sa sortie à la consigne (`withTerminalContext`, marqueur `TERMINAL_CONTEXT_MARK`). La première version enveloppait `docker exec` dans `script` (util-linux) **sur l'hôte**, et seulement sous Linux. Sous Windows, cible principale (ADR 0002), il n'y avait aucun journal : la sortie jointe valait toujours « Sortie illisible ». S'y ajoutaient deux défauts : chaque envoi qui visait un conteneur (`@` ou conteneur dédié) ouvrait un nouveau shell d'éditeur (jusqu'à quatre), et `/start` ouvrait un terminal `exegol start` non suivi, donc absent du menu `#`.

## Décision

1. **Journal dans le conteneur.** Le shell d'éditeur lance, à la place de `/bin/bash`, le programme constant de `capturedShell` (`packages/vscode/src/logic/termlog.ts`) : `bash -c '<script constant>' warband <chemin>`. Si `script` existe dans l'image (paquet essentiel `bsdutils` des images Debian, dont Exegol), il journalise la session dans le chemin donné. Sinon, le programme lance un bash nu, sans capture. Le chemin est un argument positionnel, jamais interpolé dans le script.
2. **Chemin.** `/tmp/warband-terminals/<jeton>-<8 hex aléatoires>.log`. Le jeton suit la regex des jetons `#`, et le chemin complet est revalidé (`LOG_PATH`) avant tout usage.
3. **Lecture.** `docker exec` sans shell, par `DockerClient.execWorkspace` (options figées) : `tail -c 65536 <chemin>`. La suppression se fait de la même façon à la fermeture du terminal (`rm -f <chemin>`). Le nettoyage des séquences et la troncature restent ceux de `readableTerminal`.
4. **Aucun terminal ouvert à l'envoi.** Envoyer une consigne ne crée jamais de fenêtre.
5. **`/start <jeton>`.** Si le conteneur est dans la liste Docker courante : démarrage s'il est arrêté (`controlListedContainer`), puis shell d'éditeur capturé. Sinon : `exegol start <court>`, comme avant (création). Ce point remplace le point 4 de l'ADR 0007 pour un conteneur existant.
6. **Consigne avec seulement `#`.** Elle est admise sans `@` ni conteneur dédié : l'agent analyse la sortie jointe. Les outils Exegol restent bornés par les règles de cible du cœur (ADR 0007, point 3).
7. **Menu `#`.** La webview demande la liste à chaque ouverture (`refreshTerminals`, au plus une demande par seconde). Chaque entrée affiche le jeton exact et la dernière commande.

## Alternatives écartées

- **`script` sur l'hôte.** Absent sous Windows ; l'option `-c` diffère sous macOS.
- **Pseudoterminal VS Code avec capture côté extension.** `docker exec -it` exige un vrai tty, et `node-pty` n'est pas exposé aux extensions.
- **API d'intégration du shell de VS Code.** Elle n'est pas injectée dans un bash lancé par `docker exec`.
- **Option de journalisation d'`exegol start`.** Elle n'est disponible que pour un shell ouvert par Exegol, et le fichier est rangé côté hôte selon la configuration d'Exegol.

## Conséquences

- Fonctionne quel que soit l'hôte. Une lecture prend environ 100 ms (`docker exec`).
- Une image sans `script` ouvre un shell normal ; sa sortie est signalée illisible.
- Le journal reste dans `/tmp` du conteneur tant que le terminal est ouvert. Il peut rester après un arrêt brutal de VS Code.
- La sortie jointe part au modèle : ce que l'utilisateur tape dans ce terminal (mots de passe compris) peut s'y trouver. Le recorder masque les secrets reconnus avant tout sink.
