# RedWidow — intégration graphique de la 0.3.71

La refonte provient de l’atelier `design/ui-vscode`, commit
`f26842cdd8e1649d0c32f0cd8151d3826baaa641`. L’atelier est autonome,
avec données fictives et commandes `warbandDesign.*` : il n’est pas fusionné dans
le moteur. L’intégration conserve les actions réelles et les validations de la
0.3.70, y compris l’Audit, les fournisseurs OpenCode, le menu + et FR/EN.

## Éléments intégrés

- Nom public RedWidow, viseur vide et satellite, mot-symbole complet ;
- araignée SVG locale en calques à l’accueil ; en Apprentissage, livre ouvert,
  regard et page animés, viseur atténué, sans nouveau droit d’exécution ;
- 23 palettes : les 16 de l’atelier, puis les sept couleurs classiques ;
  Widow par défaut, préférences précédentes conservées ;
- Geist pour l’interface et JetBrains Mono pour les données/code, polices
  locales sous OFL ;
- aura du Bypass en dégradé tournant, reliée à l’état réel `bypass-on` ;
- mouvement suspendu dans une vue cachée, arrêté en mouvement réduit et en
  contraste élevé, sans filtres animés coûteux ;
- icône PNG native de 128 px pour la fiche de l’extension, SVG monochrome pour
  la barre d’activité.

Les identifiants `warband`, `warband.*`, le publisher, les chemins, les projets,
les secrets et les paramètres restent stables. Les titres de terminaux des
anciens noms **Warband** et **Venator Ops** restent reconnus. Les fichiers de
livraison conservent le préfixe `warband-` pour la même extension installée.

La CSP reste inchangée ; `spider.js` est un cinquième script local sous nonce.
Aucun code de démonstration de l’atelier n’est ajouté à la production. Les
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
