# Venator Ops 0.3.68 — interface FR/EN et menu des ressources

L’interface utilise l’anglais par défaut. Le sélecteur EN/FR des Réglages traduit
les webviews, dialogues, statuts et exports produit ; les données des utilisateurs,
les commandes et les sorties restent intactes. Les titres de commandes natives
suivent la langue de VS Code via les catalogues NLS. La CLI accepte --lang fr|en,
avec anglais par défaut. Les prompts internes gardent leurs contrats existants.

Le compositeur propose un seul bouton + : pièces jointes, mentions de conteneurs
et de terminaux, commandes, Monitor, Kill chain, méthodes, MCP et recherche web.
Réglages → Contrôle système sert à configurer et activer les ressources proposées.
Le chat choisit les ressources de sa propre conversation. Désactiver une ressource
conserve sa configuration ; les nouvelles conversations partent sans sélection.
Une méthode spécialisée est choisie à la fois. Le mode Apprentissage suspend les
méthodes, MCP et le web pour garder ses seuls outils de cours en lecture.

Claude, OpenAI/ChatGPT, Google Gemini et les endpoints compatibles sont nommés
directement dans le produit. Un assistant de configuration propose Ollama et les
API compatibles, sans JSON à écrire. OpenCode reste le moteur sous-jacent. Les
clés passent par les dialogues natifs et le stockage du fournisseur, jamais par
la webview. Le catalogue des modèles est filtré par le fournisseur choisi et le
fil reste disponible après changement de fournisseur.

Tous les connecteurs du catalogue peuvent rester configurés pour un projet ;
quatre au maximum sont sélectionnés et transmis au moteur, avec validation IPC.
Burp conserve son connecteur dédié. Le choix du web contrôle réellement
l’exposition des outils des deux moteurs. Les sélections ne sont pas recopiées
dans un autre projet ou une nouvelle conversation. La gate, le Bypass, les
allowlists et la vérification des empreintes des binaires sont préservés.

Vérification globale : 2 210 tests réussis, 14 ignorés, types et lint validés
(165 avertissements et 6 informations Biome conservés, sans erreur).
Les tests couvrent les sélections forgées, la séparation entre configuration et
utilisation, les routes de modèles, les autorisations et les bascules de langue.
Les essais Chromium vérifient le menu +, les Réglages, le cockpit, le graphe,
le focus, les brouillons, le défilement et les verrous d’approbation. Les appels
IA réels facturés et l’installation native Windows ne sont pas automatisés ;
aucun gain de qualité des modèles n’est annoncé comme mesuré.

Livraison locale Linux x64 et Windows x64 : deux VSIX, leurs SHA-256, sources
exactes, patch, notes et journaux. Brouillon GitHub sur le commit compilé et
copie privée dans Warband sur Drive. La publication finale reste manuelle.

## Publier manuellement

1. Reconstituer le ZIP avec le script fourni si la livraison est découpée.
2. Vérifier son SHA-256, extraire, puis vérifier les SHA-256 des deux VSIX.
3. Ouvrir le brouillon GitHub v0.3.68, joindre les deux VSIX et leurs fichiers
   .sha256, puis publier quand les essais natifs conviennent.
4. Pour le Marketplace, conserver le même publisher et nom d’extension et
   publier cette version via un compte éditeur autorisé. Aucun jeton Marketplace
   n’est inclus dans la livraison.
