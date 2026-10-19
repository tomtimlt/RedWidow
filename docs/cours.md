# Sources de cours (mode apprentissage)

Le mode apprentissage (ADR 0010) lit un dossier de cours en lecture seule. **Le dépôt ne contient aucun contenu de cours** : seulement le manifeste `cours/sources.json` et le script `scripts/cours-sync.mjs`. Le contenu est téléchargé à la demande dans `<dossier de configuration>/cours/<nom>/` (`$XDG_CONFIG_HOME/warband` ou `~/.config/warband` ; `%APPDATA%\warband` sous Windows).

## Synchroniser

```
node scripts/cours-sync.mjs [--racine <dossier>] [--manifeste <fichier>]
```

Lancement strictement manuel (aucun `postinstall`, aucune dépendance npm). Pour chaque entrée : validation du manifeste (toute entrée invalide est refusée avant tout accès réseau), clone peu profond avec `git` à la référence figée, vérification d'un fichier de licence (`LICENSE*`, `LICENCE*`, `COPYING*`, dans le sous-dossier puis à la racine du dépôt), copie des seuls `.md` et `.txt` plus la licence, écriture de `SOURCE.md` (nom, url, ref, licence). Rien n'est écrit hors de `<racine>/<nom>/`. Manifeste vide : sortie propre.

## Ajouter une source

1. Trouver le dépôt officiel et **lire son fichier de licence** ; relever l'identifiant SPDX exact. Pas de licence claire : ne pas ajouter la source.
2. Choisir une référence figée : étiquette existante ou SHA de commit (7 à 40 caractères hexadécimaux). Un nom de branche est refusé.
3. Ajouter `{ nom, url, ref, licence, sousDossier? }` à `cours/sources.json` : `nom` en `[a-z0-9-]` (41 caractères au plus), `url` en `https://`, `sousDossier` relatif sans `..`.
4. Documenter la licence et ses restrictions ci-dessous.

## Sources présentes

| Nom | Dépôt | Ref | Licence |
|---|---|---|---|
| `owasp-cheatsheets` | OWASP/CheatSheetSeries (`cheatsheets/`) | SHA `3e2db6bf` (pas d'étiquette) | CC-BY-SA-4.0 |
| `owasp-wstg` | OWASP/wstg (`document/`) | `v4.2` | CC-BY-SA-4.0 |
| `hacktricks` | HackTricks-wiki/hacktricks (`src/`) | SHA `fc0a66c8` (pas d'étiquette de version) | CC-BY-NC-4.0 |

Licences vérifiées dans les fichiers `LICENSE` des dépôts aux références ci-dessus. Pour HackTricks, la licence est dans `src/LICENSE.md` (CC BY-NC 4.0, Carlos Polop).

## Restrictions et attribution

- **CC-BY-SA-4.0** (OWASP) : attribution à l'OWASP Foundation et aux contributeurs, mention de la licence, indication des modifications ; toute adaptation redistribuée l'est sous la même licence.
- **CC-BY-NC-4.0** (HackTricks) : **usage non commercial uniquement**, avec attribution. Source ajoutée par choix de l'utilisateur pour un projet open source non commercial ; à retirer du manifeste si l'usage devenait commercial. Le texte copié depuis d'autres auteurs y garde la licence de ces auteurs.
- Chaque dossier synchronisé contient la licence d'origine et `SOURCE.md` ; ne pas les supprimer. Les citations du mode apprentissage doivent renvoyer à la source.
