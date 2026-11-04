# Brief Claude — supports RedWidow après intégration

La branche temporaire de production est `temp/0.3.72-design-refresh`. Le lot porte
les nouveautés de `design/ui-vscode` à `b7e2529` dans la vraie extension 0.3.71.
Lire `docs/redwidow.md` et `AGENTS.md` avant de reprendre.

## Déjà intégré — ne pas remplacer par les fichiers de démonstration

Le nom, la petite araignée dans l’interface et l’icône native, le viseur de
secours, l’araignée SVG en mode normal/Apprentissage, les 23 palettes,
Geist + JetBrains Mono, l’aura réelle du Bypass et l’icône Marketplace. Le menu +,
les providers, MCP, skills, FR/EN, Monitor, Kill chain et Audit restent ceux de
production. `media/chat.js` et `studio.js` de l’atelier ne doivent pas remplacer
leurs homologues : ils retireraient des fonctions, des traductions et des
contrôles. Les identifiants techniques `warband.*` restent inchangés.

Adaptations d’intégration : aura reliée à `body.bypass-on` (pas `automatic-on`),
cerveau animé par opacité plutôt que `filter: drop-shadow`, cartes des palettes
traduites et anciens titres de terminaux reconnus. Le relais des palettes entre
les vues accepte maintenant les 23 jeux. Les reflets de boutons unis et Aurora
clair ont été ajustés pour préserver le contraste ; conserver ces corrections.

## Kit et vidéos désormais livrés

Le kit RedWidow refait par Claude est livré dans `redwidow-video-kit.zip`.
Les quatre vidéos V8 (FR/EN, 16:9 et 9:16), leurs sources et leurs empreintes
sont déposées dans le même dossier privé que la release 0.3.72. Ils restent
séparés du VSIX. Les anciennes itérations V1 à V7 restent sur la branche design.
Les aperçus de l’atelier ne prouvent pas une validation des actions réelles.
Avant publication d’une vidéo, vérifier son URL finale : le dépôt de livraison
utilise encore `tomtimlt/warband`, alors que les films annoncent `tomtimlt/redwidow`.
La livraison ne renomme pas le dépôt GitHub.

## À refaire graphiquement

Les fichiers ci-dessous existent avec l’ancienne identité ; ce sont des supports
promotionnels à renouveler, pas des fonctions manquantes de l’extension.

| Support | Source / emplacement actuel | Sortie attendue |
| --- | --- | --- |
| Bannière README | `docs/img/venator-ops-banner.png` dans la production ; `media/brand/banner-github@2x.png` dans l’atelier | Nouveau visuel RedWidow 2x, même proportion, nom/logo actuels et captures réelles du lot |
| Captures produit du README | `docs/img/venator-ops-chat.png`, `venator-ops-monitor.png`, `venator-ops-killchain.png` et autres images référencées par `README.md` | Captures RedWidow cohérentes, FR/EN selon le support, mêmes fonctions et données de lab fictives |
| Aperçu social GitHub | `media/brand/social-preview.png` et variantes `banner-github*.png` de l’atelier | 1280 × 640 ; logo RedWidow, lisible à petite taille ; réglage GitHub à faire par le propriétaire |
| Bannière LinkedIn | `media/brand/banner-linkedin.png` de l’atelier | 1584 × 396 en 2x, zone de photo de profil préservée |
| Carrousel | `media/brand/linkedin-carousel-*` de l’atelier | Deux slides 4:5 à 1080 × 1350 en 2x, PDF et version animée si conservée |
| Kit vidéo | `media/brand/video-kit/redwidow-video-kit.zip` | Refonte livrée en 0.3.72 ; conserver les composants RedWidow et les licences |

Les logos RedWidow vectoriels et PNG et la vidéo `redwidow-intro.mp4` existent
**déjà** dans `design/ui-vscode:media/brand/redwidow/`. La vidéo est une ressource
promotionnelle ; ne pas inventer un écran d’introduction bloquant au démarrage de
l’extension. Les polices livrées avec chaque support doivent garder leur licence.

## Règles des visuels

Nom public **RedWidow**, projet open source, IA optionnelle. Ne pas afficher de
vrai compte, clé, flag ou donnée de mission. Privilégier un lab clairement fictif.
Ne pas annoncer de résultat, vulnérabilité, audit exhaustif ou synchronisation
SysReptor qui n’existe pas. Le mode Apprentissage n’exécute rien ; l’Audit manuel
reste périodique et borné. Aucun coût ou fournisseur obligatoire à suggérer.

Garder le viseur vide et l’araignée validée. Si un élément manque dans la vraie
interface, donner le sélecteur, le thème, la largeur, une capture et le comportement
attendu ; corriger la couche visuelle sans toucher à la gate ni aux droits.

## Vérification

`pnpm check`, puis vues étroites/larges en sombre, clair et contraste élevé ;
FR/EN, mouvement réduit, chargement local des polices et SVG, aucun échec réseau ou
CSP. Pour l’atelier autonome, son propre `npm run check` reste complémentaire.
Ne pas remplacer la preuve d’un test dans la production par une capture de fixture
de l’atelier. La livraison reste : deux VSIX, SHA-256, sources exactes, patch,
brouillon GitHub et Drive privé ; publication finale par l’utilisateur.
