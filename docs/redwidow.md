# RedWidow — intégration graphique des 0.3.71 et 0.3.72

La première refonte (0.3.71) provient de l’atelier `design/ui-vscode`, commit
`f26842cdd8e1649d0c32f0cd8151d3826baaa641`. L’atelier est autonome,
avec données fictives et commandes `warbandDesign.*` : il n’est pas fusionné dans
le moteur. L’intégration conserve les actions réelles et les validations de la
0.3.70, y compris l’Audit, les fournisseurs OpenCode, le menu + et FR/EN.

La 0.3.72 porte les nouveautés de ce même atelier à
`b7e2529e50e1f3305f0d62e8acfd3e8554e2e583` sur la base de production
`af63c52bfc49e297a4311d3ee625386f4bb152fc`. Le logo de l’interface devient la
petite araignée : tête au cerveau, yeux et quatre pattes, sans abdomen ni viseur.
Le viseur reste un secours si le script ne se charge pas. L’icône native SVG et
le PNG de la fiche sont actualisés. Les calques animés utilisent des classes,
sans identifiants SVG dupliqués entre l’en-tête, les réponses et les aperçus.

Le Bypass prend désormais les couleurs de tous les jeux propres au produit,
avec aura, pastille, compositeur et interrupteur en dégradé. L’attente de
confirmation reste en pointillés. Éditeur et contraste élevé gardent leurs
couleurs de thème ; les droits et la durée ne changent pas. Les dégradés unis
restent dans leur teinte ; leur amplitude est ajustée pour préserver la
lisibilité des textes. Le livre de l’accueil apparaît par animation et retrouve
une position de repos stable, y compris en rendu image par image.

Le kit vidéo RedWidow et les quatre vidéos V8 sont livrés séparément dans Drive,
avec leurs sources et empreintes : FR/EN, paysage 1920 × 1080 et portrait
1080 × 1920. Les captures qui s’y trouvent sont les fixtures de l’atelier,
pas des traces de pentest ni une preuve d’essai des fonctions de production.
Ces médias ne sont pas embarqués dans les VSIX. Aucun lecteur ou écran de
publicité n’est ajouté au produit.

## Éléments intégrés

- Nom public RedWidow, petite araignée de l’interface, mot-symbole complet ;
  viseur vide et satellite gardés en secours ;
- araignée SVG locale en calques à l’accueil ; en Apprentissage, livre ouvert,
  regard et page animés, viseur atténué, sans nouveau droit d’exécution ;
- 23 palettes : les 16 de l’atelier, puis les sept couleurs classiques ;
  Widow par défaut, préférences précédentes conservées ;
- Geist pour l’interface et JetBrains Mono pour les données/code, polices
  locales sous OFL ;
- aura et indicateurs du Bypass en dégradé, reliés à l’état réel `bypass-on` ;
- mouvement suspendu dans une vue cachée, arrêté en mouvement réduit et en
  contraste élevé, sans filtres animés coûteux ;
- icône PNG native de la petite araignée pour la fiche de l’extension, SVG monochrome pour
  la barre d’activité.

Les identifiants `warband`, `warband.*`, le publisher, les chemins, les projets,
les secrets et les paramètres restent stables. Les titres de terminaux des
anciens noms **Warband** et **Venator Ops** restent reconnus. Les fichiers de
livraison conservent le préfixe `warband-` pour la même extension installée.

La CSP reste inchangée ; `spider.js` est un cinquième script local sous nonce.
Réglages et Kill chain chargent aussi l’araignée locale sous nonce avant
leur script de vue. Aucun code de démonstration de l’atelier n’est ajouté à la production. Les
lueurs du cerveau sont obtenues par opacité ; l’aura anime un angle CSS typé.
Aucune permission, gate ou option SDK n’est modifiée.

Les captures promotionnelles Venator Ops restent des références historiques.
Le travail graphique encore à reprendre est détaillé dans le
[brief destiné à Claude](brief-claude-redwidow.md), avec les chemins et formats.

## Historique commun

Le correctif demandé sur Chat 1 / Chat 2 partage l’index dans la même fenêtre VS
Code, avec filtres par projet. Les anciens index sont rassemblés une fois ; les
journaux restent lisibles dans leurs anciens dossiers et les nouveaux utilisent
un dossier commun. Les anciennes données ne sont ni déplacées ni effacées par la
migration. La rétention garde son budget par chat d’origine ; les conversations
ouvertes sont protégées. L’index commun reste borné à 2 000 métadonnées.

Ouvrir une entrée la lit explicitement ; rien n’est envoyé au modèle au simple
partage de l’historique. Reprendre une conversation déjà ouverte affiche son chat
au lieu de lancer un second moteur. Renommer et supprimer sont synchronisés ;
effacer l’historique commun nécessite sa confirmation et aucune conversation visée
ne doit être en cours. Les index de fenêtres VS Code distinctes ne sont pas
synchronisés en temps réel par ce correctif.
