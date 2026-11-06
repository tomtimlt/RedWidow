# RedWidow 0.3.74 — pièces jointes et projets dans un partage Docker

## Changements

- Ajout de fichiers texte UTF-8 et d’images PNG, JPEG, WebP ou GIF par le sélecteur,
  le glisser-déposer ou le collage des fichiers exposés par le presse-papiers.
  Les images restent visibles et retirables avant l’envoi.
- Les images sont envoyées comme contenu multimodal au tour courant, avec les
  adaptateurs Claude et OpenCode. Le journal de conversation conserve les noms,
  sans y recopier les données binaires des images.
- La saisie avertit lorsque le modèle est déclaré sans vision, ou lorsque sa
  capacité n’est pas annoncée. Un refus explicite de vision bloque l’envoi avec
  images ; le brouillon reste disponible pour retirer les images ou changer de modèle.
- Correction de la régression 0.3.73 qui refusait un projet situé dans un
  sous-dossier du partage Docker. La correspondance est vérifiée sur les chemins
  réels et par une preuve lue depuis le conteneur.

## Vérification et limites

Le kit accompagne les contrôles logiciels et les recettes Chromium et Docker.
Les résultats effectifs et le commit compilé figurent dans les justificatifs.
Les tests de contrat avec modèles réels ne sont pas lancés automatiquement.

Le collage de fichiers dépend de ce que le système et la webview exposent dans
le presse-papiers. Un chemin copié comme texte reste du texte : il ne déclenche
aucune lecture de fichier sur le poste. Les PDF, archives et documents bureautiques
binaires ne sont pas pris en charge par cette insertion.

La capacité vision dépend des métadonnées du catalogue. Une capacité inconnue
n’est pas une garantie de prise en charge. La recette sous Chromium et Docker
Linux ne remplace pas une validation native Windows/Docker Desktop.

## Installation et publication

Installer le VSIX de sa plateforme avec « Extensions: Install from VSIX… »
et vérifier son SHA-256. Le kit contient les paquets `linux-x64` et `win32-x64`,
leurs empreintes, les sources exactes, le patch et les justificatifs.

Le brouillon GitHub vise le commit compilé et le kit est déposé dans le dossier
Drive privé Warband. La publication finale reste à l’utilisateur : joindre les
deux VSIX et leurs deux fichiers `.sha256`, puis publier le brouillon.
