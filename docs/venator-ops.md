# Venator Ops — identité et compatibilité (0.3.66)

Décision du 30 octobre 2026, à partir des visuels fournis par le propriétaire.
Cette décision complète la charte « Acier et signature » sans changer les
contrats d’exécution, d’approbation ou du mode Apprentissage.

## Nom et présentation

Le nom public est **Venator Ops**, anciennement Warband. Il apparaît dans les
commandes, les fenêtres, les terminaux, les notifications et la documentation
d’utilisation. Le mot-symbole **VENATOR OPS** conserve les capitales espacées :
VENATOR utilise le premier plan du thème, OPS la signature de la palette.
Sentinelle fournit le turquoise des visuels ; les autres palettes restent
disponibles. Les crochets, l’étincelle et le satellite du symbole sont conservés.

La signature « Pentest in VS Code, with AI on call. » accompagne l’accueil
sans conversation. Le texte français rappelle les conteneurs, les terminaux,
la Kill chain et l’IA optionnelle. L’absence de fournisseur bloque l’envoi au
chat, pas la lecture de l’accueil ni l’utilisation des parcours manuels.
Les titres contextuels Monitor et rapport restent distincts du mot-symbole.

Les surfaces utilisent les couleurs de VS Code. Les thèmes clairs, contrastés,
les couleurs forcées et le mouvement réduit restent respectés. Aucun nouveau
compteur ou résultat de mission n’est créé pour la présentation.

## Mise à jour des installations existantes

- L’identité de l’extension reste `warband.warband` : nom technique et publisher
  inchangés, pour installer la mise à jour sur l’extension existante.
- Les commandes `warband.*`, raccourcis, menus, types de panneaux, clés de
  réglages et de stockage restent identiques.
- Les chemins `.warband`, les projets, journaux, secrets, images Docker,
  variables d’environnement, protocoles et noms des artefacts restent stables.
- Les nouveaux terminaux portent le nom Venator Ops. Pour les terminaux déjà
  suivis par l’extension, les deux préfixes partagent la numérotation, la limite
  de quatre sessions et les mentions `#`. Les créations en cours et les colonnes
  d’éditeur reconnaissent également les anciens titres.
- Après réactivation de l’extension, la restauration rouvre des shells : elle
  ne réadopte pas un terminal existant à partir de son seul titre. Le renommage
  ne garantit pas la continuité d’un processus interactif pendant un rechargement.
- Les références historiques des ADR et des notes de versions conservent le
  nom utilisé au moment de leur rédaction.

Le mode Apprentissage consulte les cours `.md`/`.txt` et les extraits de terminal
fournis par l’utilisateur. Les visuels de référence ne constituent pas une
implémentation de lecture PDF, d’exécution ou d’accès automatique aux terminaux.

## Vérification de la livraison

Vérifier la coexistence des noms de terminaux, les mentions et la limite de
sessions, puis les rendus des vues en petite et grande largeur, dans les trois
thèmes et les cinq palettes. Les sept raccourcis de navigation restent exposés.
La livraison suit la pipeline locale décrite dans AGENTS.md.
