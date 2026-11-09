# RedWidow 0.3.77 — visibilité des outils et correctifs de mission

## Changements

- Monitor : tous les appels d’outils, résumé HTTP, filtres locaux Tout / Shell / Web
  et export du contenu visible.
- Commande et bouton « Exporter le fil » : Markdown et JSONL dans le dossier
  `exports` du projet. Les pensées sont exclues par défaut et les résultats
  limités à 4 Kio par appel. Le ZIP d’audit contient aussi `chat.md`.
- Audit : conservation des fins de tour et des continuations. La commande
  `warband --lang fr trace <audit.zip>` lit les journaux du ZIP ou un fichier
  JSONL d’audit enveloppé, avec un seul avertissement de séquence reconstituée.
- Rythme HTTP partagé entre hôtes d’un même groupe d’IP résolues. Une suspicion
  de bannissement après réponse saine impose cinq minutes de pause au groupe ;
  un second signal pendant cette pause l’arrête. Arrêts et pauses sont persistés.
  La reprise explicite d’un membre reprend le groupe. Les anciens fichiers
  d’arrêts par hôte restent lisibles.
- Gros corps HTTP : conservation sous `outputs/warband-http-…/body.txt`, avec
  un fichier à lignes courtes pour la recherche dans les réponses minifiées.
  Les chemins de relecture sont indiqués au modèle. Plafond de sauvegarde : 32 Mio.
- Relances du bureau dans les résultats des outils, en cours de tour : technologie
  observée sans recherche et pistes non testées, sans répétition et au plus une
  note toutes les huit réponses d’outil.
- Méthode et profils : hypothèses rattachées aux observations, lecture des flux
  applicatifs, comparaisons bénignes face au WAF et changement d’hypothèse à la
  stagnation. `trace` mesure le ratio dérivé / générique des appels `http_request`,
  leurs chemins génériques fréquents et les familles de technique observées.
- Avertissement au démarrage d’un profil offensif sans conteneur attaché, dans
  le journal, `mission_context`, le chat et le Monitor.

## Vérifications et limites

La livraison est préparée par `pnpm release:local` : contrôles de style, types,
Vitest, compilation et VSIX des deux plateformes. Le commit exact est inscrit
dans `provenance.json`. Les journaux et rapports de vérification accompagnent
le kit. Les tests de contrat avec modèles réels ne sont pas lancés.

Les mesures de dérivation utilisent seulement les sorties antérieures présentes
au journal. Leurs résultats, ainsi que les familles de technique classées par
heuristique, ne prouvent ni créativité ni vulnérabilité. Les sorties déjà
tronquées peuvent limiter les observations disponibles.

Le rythme est un frein sur les requêtes des outils concernés, sans modification
de la gate ou du périmètre, et ne contrôle pas tout le trafic d’un conteneur.
La fusion d’IP peut ralentir ensemble des services distincts d’un même edge.

Les vérifications automatisées du Monitor dans Chromium restent distinctes d’un
essai dans une installation native de VS Code. Aucun essai natif Windows ni
nouvelle mission réelle n’est revendiqué. Une re-mesure sur une mission autorisée,
avec un conteneur attaché et un rythme prudent, reste à effectuer par l’utilisateur.

## Installation et publication

Télécharger toutes les parties et les fichiers d’accompagnement dans le même
dossier. Les parties sont numérotées `part001`, `part002`, etc. Si Drive ajoute
un `.zip` final à une partie, retirer seulement ce suffixe supplémentaire.
Lancer `assembler-windows.cmd` sous Windows ou `sh assembler-linux.sh` sous Linux.
Le script vérifie le SHA-256 avant de finaliser le ZIP.

Décompresser le kit, vérifier le SHA-256 du VSIX de sa plateforme et utiliser
« Extensions: Install from VSIX… ». Le kit contient les deux VSIX, leurs
empreintes, les sources exactes, le patch, les notes et la provenance.

Le dossier Drive est privé. Le brouillon GitHub vise le commit compilé ; joindre
les deux VSIX et leurs fichiers `.sha256`, puis publier le brouillon lorsque
la vérification manuelle est terminée.
