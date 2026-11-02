# Venator Ops 0.3.67 — cinq méthodes et fournisseurs OpenCode

Les profils Mentor, Bug bounty, Out of the box, Red team et Hack The Box disposent
d’un résumé court et de six sections détaillées. Une source canonique génère
les cinq SKILL.md et alimente le chargement à la demande. Une section exacte
reste ciblée ; une recherche absente ne charge pas tout le document. Les
références tierces épinglées sont chargées uniquement avec source: "upstream".
Les permissions et le mode Apprentissage restent contrôlés par le moteur.

Cette version regroupe les travaux précédemment gardés en attente des personas :
correction du menu des modèles (hauteur, défilement et fermeture), configuration
explicite des endpoints OpenCode compatibles OpenAI avec modèle déclaré,
connexion native Gemini et conservation du fil lors d’un changement fournisseur.
L’isolation de la configuration et le stockage natif des secrets sont conservés.
Le README anglais et les visuels fournis via GitHub ont été récupérés.

La conception s’appuie sur le PDF utilisateur et des sources primaires vérifiées.
La grille d’évaluation distingue les invariants logiciels et la qualité réelle
des modèles. Aucun gain de résolution chiffré n’est annoncé : les tests ne font
pas d’appels IA facturés. Le guide des profils et les décisions de sources sont
dans docs/profils-agent.md et docs/profils-sources.md.

Livraison locale Windows x64 et Linux x64 : deux VSIX et leurs SHA-256, sources,
patch, notes et instructions, brouillon GitHub sur le commit exact et dossier
privé dans Warband sur Drive. La publication finale reste manuelle.
