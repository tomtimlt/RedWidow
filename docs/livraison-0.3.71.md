# RedWidow 0.3.71 — refonte de l’interface

Branche `temp/0.3.71-redwidow`, base de production
`5bdd5f8395a81c0d344120de99a9e1b12c6b03b2` (Audit 0.3.70).
Habillage porté depuis `design/ui-vscode` à `f26842c`.

Nom public RedWidow, viseur et satellite, araignée animée qui étudie en mode
Apprentissage, 23 palettes dont Widow par défaut, Geist et JetBrains Mono locales,
aura du Bypass en dégradé. L’icône native est fournie. Les noms techniques de
l’extension restent stables et les anciens terminaux sont reconnus.

L’atelier de Claude est autonome : ses données et commandes de démonstration ne
sont pas importées. Audit, providers OpenCode, menu +, MCP/skills, FR/EN, Monitor,
Kill chain, preuves, gate et droits d’Apprentissage sont conservés. Les filtres
animés sont retirés et le mouvement réduit/caché reste respecté.

Les anciens supports promotionnels à renouveler sont listés dans
[le brief Claude](brief-claude-redwidow.md). La vidéo d’introduction existe dans
l’atelier ; ce n’est pas une nouvelle étape bloquante dans le démarrage du produit.

Sources, patch, notes, journaux de vérification, VSIX Windows/Linux et SHA-256 sont
livrés dans le dossier privé. Le brouillon GitHub vise le commit compilé ; ajouter
les deux VSIX et leurs deux SHA-256 avant publication manuelle.

L’historique est désormais commun aux chats latéral et d’éditeur de la même
fenêtre : import des anciennes listes, lecture de leurs journaux sans déplacement,
renommages/suppressions synchronisés. Les budgets existants restent appliqués par
chat d’origine et les conversations ouvertes sont protégées de la rétention. Une
reprise déjà ouverte renvoie vers son chat, sans ouvrir un deuxième moteur. Une
suppression partagée refuse les conversations en cours. Le partage de la liste
ne charge aucun ancien message dans le modèle.

## Vérifications de cette livraison

- `pnpm check` : 2 259 tests réussis, 14 ignorés, aucun échec ; types des
  sources et tests valides. Biome : zéro erreur, 176 avertissements et 8 conseils.
- Chromium sur les fichiers de production : CSP conservée, aucune erreur de
  chargement, mode Apprentissage, mouvement réduit, pause des animations hors
  écran, aura Bypass, menu +, OpenCode et changement FR/EN sans perte du brouillon.
- 23 cartes de palettes ; contraste des boutons vérifié pour les 22 palettes
  propres au produit en thèmes sombre et clair. Le jeu Éditeur conserve les
  couleurs choisies par le thème VS Code. Reflet des jeux unis et Aurora clair
  adaptés pour garder les textes lisibles.
- Deux vraies sessions de chat et deux webviews : liste commune, renommage et
  suppression depuis Chat 2 visibles dans Chat 1, sans requête IA supplémentaire.
  Tests unitaires de migration, anciens journaux, projets et rétention réussis.
- Recette Audit après refonte : FR/EN, filtres, brouillon préservé au
  rafraîchissement, qualification opérateur, pause/reprise et vrai export ZIP.
- Deux VSIX vérifiés : manifeste 0.3.71, plateforme, médias, cinq skills,
  licences, intégrité ZIP et empreintes des binaires Claude/OpenCode. Le moteur
  Linux empaqueté a chargé 235 fournisseurs et 10 modèles disponibles, dont
  l’accès général OpenCode ; aucune requête d’inférence envoyée.
- Vues contrôlées en sombre, clair et contraste élevé, largeurs de 320 à 1 200 px.

Les moteurs IA de la recette d’historique sont simulés : aucun appel facturé.
L’installation native Windows/VS Code n’est pas déclarée testée. Les contrôles
sont faits dans Chromium et sur les archives compilées des deux plateformes.
