# Profils : intégration et maintenance

Les cinq profils sont intégrés : `mentor`, `bug-bounty`, `out-of-box`, `red-team`
et `htb`. Leur source canonique est `packages/core/src/agent-profiles.ts`.
Chaque entrée contient un résumé, sa provenance de référence et six sections.
Le document utilisateur a guidé la conception ; les décisions et les références
vérifiées sont détaillées dans [profils-sources.md](profils-sources.md).

## Chargement et budgets

`deskInstructions` injecte seulement le résumé sélectionné, avec les indications
pour charger le détail utile. Une petite question ne demande pas de charger une
méthode complète. Une section déjà présente dans le contexte courant est réutilisée.
Le mode Apprentissage conserve son prompt pédagogique dédié et ses seuls outils
de cours ; les profils détaillés ne sont pas injectés dans cette branche.

`load_skill({profile})` charge la méthode française. `section` sélectionne un
identifiant exact en priorité, puis peut chercher un thème avec normalisation de
la casse et des accents. Une recherche sans résultat renvoie l’index et un message
explicite, pas le document entier. `source: "upstream"` demande la référence
épinglée ; elle est limitée à 16 000 octets UTF-8 avant sérialisation JSON.
Les champs `instructions`, `upstream` et sa provenance sont conservés, mais le
texte upstream n’est plus renvoyé dans l’appel par défaut.

Les tests verrouillent les budgets de caractères : résumé au plus 1 200,
consigne du bureau au plus 2 500 et profil détaillé au plus 7 000. Il s’agit de
caractères, pas de tokens ; le coût réel dépend du tokenizer du modèle.

## Artefacts embarqués

Les cinq fichiers `packages/vscode/media/skills/*/SKILL.md` sont générés depuis
le catalogue. Leur enveloppe ajoute métadonnées, contrat et licence ; le corps
méthodologique est identique au résultat de `load_skill`.

Après une modification du catalogue :

```sh
pnpm build
node scripts/sync-agent-skills.mjs
node scripts/sync-agent-skills.mjs --check
pnpm check
```

Le contrôle `--check` ne modifie rien et échoue si un fichier manque ou diffère.
Les tests vérifient aussi cette cohérence, ainsi que la transmission par les
adaptateurs Claude et OpenCode. Une modification du profil ne modifie aucune
permission, clé de réglage ou capacité d’outil.

## Évaluation et fournisseurs

La [grille d’évaluation](profils-evaluation.md) prépare des essais sémantiques
séparés des tests logiciels. Les tests de chargement ne prouvent pas une
amélioration des réponses des modèles ; aucun appel IA facturé n’est automatique.

Les profils sont indépendants du fournisseur. Le changement de fournisseur
conserve le fil avec un transfert borné et masqué. Les endpoints compatibles
OpenCode utilisent le [réglage explicite](opencode-providers.md), tout en gardant
l’isolation de la configuration globale.
