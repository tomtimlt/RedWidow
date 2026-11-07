# RedWidow 0.3.75 — profil bug bounty, fiche programme et couverture

## Changements

- La méthode du profil choisi est injectée d’office, en entier, dans le prompt système.
- Recherche web native pour les missions cyber, avec déclencheurs de recherche
  et champ `sources`. La politique par défaut des outils web et la garde sur leurs
  arguments limitent les redirections aux sources de référence.
- Profil bug bounty réécrit autour des règles du programme, d’un rythme adaptatif,
  de fiches de méthode et de la couverture. L’adaptation d’exploits trouvés reste
  permise après un essai local.
- Fiche programme par projet, validée par empreinte : périmètre, rythme attendu,
  outil `http_request`, outil d’agent `program_draft` (brouillon avec citations),
  contrôle des hôtes et des drapeaux des commandes shell (User-Agent, débit),
  page dédiée dans VS Code. Un contrôleur de rythme borne le débit global et par hôte.
- Matrice de couverture dans l’Audit (pourcentage, comptes, tableau filtrable),
  alimentée par `record_coverage`.
- Niveaux d’encadrement par chat (léger, standard, strict), choisis à côté de l’effort.
- Gate : « toujours » par binaire réservé à Bash et jamais sur un shell non
  analysable ; `read_url` mémorisé par hôte, sans règle globale.

## Vérification et limites

Le kit accompagne les contrôles logiciels (`pnpm check`, build) et le commit compilé
figure dans `provenance.json`. Les tests de contrat avec modèles réels ne sont pas
lancés automatiquement.

Limites connues : aucun essai dans un vrai VS Code, ni en mission réelle. Le proxy
sortant n’est pas réalisé : le contrôle de périmètre et de rythme porte sur les
outils et commandes analysés, pas sur le trafic réseau lui-même.

## Installation et publication

Installer le VSIX de sa plateforme avec « Extensions: Install from VSIX… »
et vérifier son SHA-256. Le kit contient les paquets `linux-x64` et `win32-x64`,
leurs empreintes, les sources exactes et la provenance.

Le brouillon GitHub vise le commit compilé et le kit est déposé dans le dossier
Drive privé Warband. La publication finale reste à l’utilisateur : joindre les
deux VSIX et leurs deux fichiers `.sha256`, puis publier le brouillon.
