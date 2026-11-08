# RedWidow 0.3.76 — interface remaniée, profil Red Team Expert et diagnostic des journaux

## Changements

- Interface : réglages en rubriques Projet et Global, page Fournisseurs
  (intégrations déplacées), feuilles de style communes avec un fichier par page.
- Approbations en attente visibles hors du chat : barre d'état, badge et notification.
- Panneau Sessions : grille des chats ouverts, tri par urgence et filtre
  « En attente de toi ».
- Chat : menu @ (fichiers, killchain, sortie) et jauge de contexte alimentée par
  l'événement `context.usage` ; bascule activer/désactiver des capacités.
- Pages Monitor, Sortie et Rapport en lecture seule.
- Profil Red Team Expert (ADR 0041) : émulation d'adversaire autorisée en neuf
  sections, fiche d'engagement validée par empreinte, arrêt d'urgence, plan de
  campagne avec contrôle d'étape, journal et démontage, page Engagement dans VS Code.
  La gate tient compte de l'engagement approuvé et de l'arrêt d'urgence.
- Diagnostic des journaux de mission et commande `trace` : analyse d'arrêt et de
  stagnation d'un journal.
- Sorties de commandes shell complètes sauvegardées, extrait tête et queue dans le
  contexte, outil `read_output` pour relire la sortie entière.
- Niveau d'encadrement « acharné » : continuation automatique des tours et détection
  de stagnation d'approche (OpenCode seulement).

## Vérification et limites

Le kit accompagne les contrôles logiciels (`pnpm check`, build) et le commit compilé
figure dans `provenance.json`. Les tests de contrat avec modèles réels ne sont pas
lancés automatiquement.

Limites connues : aucun essai dans un vrai VS Code, ni en mission réelle. La
continuation automatique n'est pas implémentée côté agent-sdk. Le proxy sortant
n'est pas réalisé : le contrôle de périmètre et de rythme porte sur les outils et
commandes analysés, pas sur le trafic réseau lui-même.

## Installation et publication

Installer le VSIX de sa plateforme avec « Extensions: Install from VSIX… »
et vérifier son SHA-256. Le kit contient les paquets `linux-x64` et `win32-x64`,
leurs empreintes, les sources exactes et la provenance.

Le brouillon GitHub vise le commit compilé et le kit est déposé dans le dossier
Drive privé Warband. La publication finale reste à l'utilisateur : joindre les
deux VSIX et leurs deux fichiers `.sha256`, puis publier le brouillon.
