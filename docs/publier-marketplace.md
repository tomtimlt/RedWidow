# Publier RedWidow sur le Marketplace VS Code

Ce tuto se fait une seule fois. Une fois terminé, chaque release, que la session déclenche en changeant la version sur `main`, publie aussi l'extension sur le Marketplace, automatiquement.

L'extension est publiée sous l'identifiant **`tomtimlt.redwidow`** : éditeur `tomtimlt`, nom `redwidow` (`packages/vscode/extension.manifest.json`). L'éditeur que tu crées doit donc s'appeler exactement **`tomtimlt`**.

Compte une vingtaine de minutes. Tout se fait dans le navigateur, sauf l'étape 5 si tu veux tester à la main.

---

## 1. Un compte Microsoft

Un compte Microsoft personnel (Outlook, Hotmail ou autre) suffit. Si tu n'en as pas, crée-le sur https://account.microsoft.com.

## 2. Une organisation Azure DevOps (pour le jeton)

Le Marketplace délivre ses jetons de publication par Azure DevOps. C'est gratuit.

1. Va sur https://dev.azure.com et connecte-toi avec ce compte Microsoft.
2. Si on te le propose, crée une organisation. Le nom est libre, par exemple `tomtimlt`. Aucun projet n'est nécessaire.

## 3. Le jeton d'accès personnel (PAT)

1. Dans Azure DevOps, clique sur l'icône **User settings** (en haut à droite), puis **Personal access tokens**, puis **+ New Token**.
2. Remplis :
   - **Name** : `vsce RedWidow`
   - **Organization** : **All accessible organizations**. C'est obligatoire : avec une seule organisation, la publication échoue avec « 401 ».
   - **Expiration** : le maximum proposé (1 an). Note la date, il faudra le renouveler.
   - **Scopes** : **Custom defined**, puis **Show all scopes**, et coche **Marketplace › Manage**. Rien d'autre.
3. Clique sur **Create**, puis **copie le jeton tout de suite** : il ne sera plus jamais affiché.
4. Ne le colle nulle part ailleurs qu'à l'étape 6, ni dans un chat, ni dans un fichier du dépôt.

## 4. L'éditeur `tomtimlt`

1. Va sur https://marketplace.visualstudio.com/manage et connecte-toi avec le **même** compte Microsoft.
2. **Create publisher** :
   - **ID** : `tomtimlt`. Il doit correspondre exactement au champ `publisher` du manifeste, et il ne se change plus.
   - **Name** : `Red Widow` (le nom affiché).
   - Ajoute, si tu veux, un lien vers le dépôt et un logo.
3. Valide. L'éditeur apparaît dans la liste.

Si l'ID `tomtimlt` est déjà pris, dis-le-moi : il faudra changer `publisher` dans le manifeste, ce qui change l'identifiant de l'extension.

## 5. Premier essai à la main (facultatif, conseillé)

Sur ton PC, dans un clone du dépôt, après `pnpm install` :

```powershell
cd packages\vscode
pnpm exec vsce login tomtimlt
```

Colle le jeton quand il est demandé. Ensuite, avec les quatre VSIX de la release 1.0.6 téléchargés dans ce dossier :

```powershell
pnpm exec vsce publish --packagePath redwidow-1.0.6-win32-x64.vsix redwidow-1.0.6-linux-x64.vsix redwidow-1.0.6-darwin-arm64.vsix redwidow-1.0.6-darwin-x64.vsix
```

Le Marketplace vérifie le paquet pendant quelques minutes, puis la page apparaît : https://marketplace.visualstudio.com/items?itemName=tomtimlt.redwidow

Tu peux sauter cette étape : la prochaine release publiera toute seule une fois l'étape 6 faite.

## 6. Brancher la publication automatique

1. Sur GitHub, dans le dépôt `tomtimlt/RedWidow`, va dans **Settings**, puis **Secrets and variables**, puis **Actions**, puis **New repository secret**.
2. **Name** : `VSCE_PAT` (exactement). **Secret** : le jeton de l'étape 3. Valide.

C'est fini. Le workflow Release a déjà une étape « Publier sur le Marketplace VS Code » :
- sans le secret, il l'ignore ;
- avec le secret, il publie les quatre VSIX de la release ;
- une version déjà publiée, par exemple à l'étape 5, est ignorée sans erreur.

## 7. Vérifier

- Installe l'extension depuis VS Code : Extensions, puis recherche « RedWidow ». L'identifiant affiché doit être `tomtimlt.redwidow`.
- Les statistiques et les avis se trouvent sur https://marketplace.visualstudio.com/manage/publishers/tomtimlt.

---

## Problèmes fréquents

| Message | Cause | Solution |
|---|---|---|
| `401` ou `Access Denied` | Jeton limité à une seule organisation, ou sans le droit Marketplace › Manage | Recréer le jeton (étape 3) avec **All accessible organizations** et **Marketplace › Manage** |
| `The publisher 'tomtimlt' is not found` | Éditeur pas encore créé, ou créé avec un autre compte que celui du jeton | Étape 4 avec le même compte Microsoft |
| `Version already exists` | Cette version est déjà publiée | Normal, ignoré automatiquement par le workflow ; passer à la version suivante |
| Le jeton a expiré (1 an) | Fin de validité | Étape 3 à nouveau, puis remplacer la valeur du secret `VSCE_PAT` (étape 6) |
| Rejet pour une image du README | Le Marketplace refuse les images SVG venant de sources non approuvées | Le README de l'extension (`packages/vscode/EXTENSION_README.md`) n'en contient pas : à garder ainsi |

## Et Open VSX (VSCodium, Cursor…) ?

Cursor, VSCodium et d'autres éditeurs dérivés de VS Code n'utilisent pas le Marketplace de Microsoft. Ils lisent le registre **Open VSX** (https://open-vsx.org), qui demande un compte et un jeton à part. Dis-moi si tu veux aussi y publier : j'ajouterai une étape au workflow, sur le même principe, avec un secret `OVSX_PAT`.
