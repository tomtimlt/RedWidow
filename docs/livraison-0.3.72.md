# RedWidow 0.3.72 — petite araignée et Bypass aux couleurs du thème

Branche `temp/0.3.72-design-refresh`, base de production
`af63c52bfc49e297a4311d3ee625386f4bb152fc` (0.3.71).
Nouveautés de l’atelier `design/ui-vscode` à
`b7e2529e50e1f3305f0d62e8acfd3e8554e2e583`.

La petite araignée RedWidow remplace le viseur dans l’en-tête, l’activité,
les avatars des réponses et les cartes de palettes. Cerveau et quatre pattes
s’animent quand l’agent travaille ; le viseur reste un secours sans script.
Les SVG statiques et l’icône native sont mis à jour. Les calques utilisent des
classes pour ne pas dupliquer leurs identifiants au fil des messages.

Le Bypass adopte la palette choisie : aura tournante pour les 22 palettes du
produit, pastille, contour du compositeur, interrupteur et jauge en dégradé.
Attente de confirmation en pointillés, dernières minutes plus visibles,
mouvement réduit et vues cachées respectés. Éditeur et contraste élevé gardent
les couleurs du thème. Les dégradés unis restent dans leur teinte, sans reflet
blanc ; leur amplitude conserve la lisibilité des libellés. Le livre du mode
Apprentissage retrouve une position stable après son animation d’apparition.

Audit, historique commun, menu +, OpenCode et tous ses fournisseurs, MCP, cinq
skills, FR/EN, gate, droits d’Apprentissage et identifiants `warband.*` conservés.
Les scripts de démonstration de l’atelier ne remplacent pas ceux de production.
La CSP reste stricte ; l’araignée locale est aussi chargée sous nonce dans les
réglages et la Kill chain.

La livraison Drive contient séparément le kit vidéo refait, les quatre vidéos
V8 en FR/EN paysage et portrait, leurs sources et SHA-256. Ces fichiers ne sont
pas ajoutés aux VSIX. Les visuels du README, les bannières et le carrousel
restent à renouveler : voir le brief Claude actualisé. Les films montrent le
lab fictif de l’atelier. Leur URL finale annonce `tomtimlt/redwidow`, alors que
le dépôt livré reste `tomtimlt/warband` ; vérifier ce point avant diffusion.

La pipeline reste : deux VSIX Windows/Linux, SHA-256, sources exactes, patch,
notes et journaux dans Drive privé, branche temporaire poussée et brouillon
GitHub sur le commit compilé. La publication finale reste manuelle.

## Vérifications

- `pnpm check` : 2 262 tests réussis, 14 ignorés, aucun échec ; types des sources
  et tests valides. Biome : zéro erreur, 180 avertissements et 8 conseils.
- Chromium, scripts et CSP de production : petite araignée aux trois emplacements
  du chat et sur les 23 cartes, marche en activité, aucun identifiant SVG
  dupliqué ; livre visible après animation et en mouvement réduit.
- Bypass testé sur jeux uni et en dégradé : aura, pastille, interrupteur,
  compositeur, dernières minutes et attente en pointillés. Éditeur et contraste
  élevé conservent le rendu prévu. Palettes du produit contrôlées pour le
  contraste du texte sur les boutons en sombre et clair.
- Recettes FR/EN, menu +, sélection OpenCode, vues cachées et largeurs de
  320 à 1 200 px ; aucune erreur de script, chargement ou CSP constatée.
- Deux sessions réelles et deux webviews partagent l’historique ; renommage et
  suppression synchronisés sans requête IA supplémentaire. Page Audit : filtres,
  brouillon, qualification opérateur, pause/reprise et export ZIP réels réussis.
- VSIX Windows et Linux : manifeste, plateforme, médias, cinq skills, licences,
  intégrité ZIP et empreintes des binaires Claude/OpenCode contrôlés. Le moteur
  Linux empaqueté retrouve 235 fournisseurs et 10 modèles disponibles, dont
  l’accès général OpenCode, sans envoyer de requête au modèle.
- Quatre MP4 V8 : H.264 + AAC, 30 images/s, 53,2 s, dimensions conformes,
  décodage intégral sans erreur. Kit ZIP : intégrité et 89 entrées vérifiées,
  aucune ressource statique HTML/CSS manquante.

Aucun appel d’inférence facturé. Installation native Windows/VS Code non
exécutée ; recettes dans Chromium, vérification des archives et lancement du
catalogue avec le moteur Linux empaqueté distingués des essais natifs.
