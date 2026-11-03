# Venator Ops 0.3.69 — restauration complète d’OpenCode

Cette correction rétablit l’entrée générale OpenCode et remplace la liste fixe
par le catalogue réel du moteur. Contrôle système affiche les fournisseurs
connectés et non connectés, avec recherche, interrupteurs d’activation et
connexion native ciblée. Chaque fournisseur activé apparaît dans Configurer du
chat. L’entrée OpenCode regroupe tous les modèles connectés. Le choix individuel
filtre le catalogue sur ce fournisseur. Les activations de la 0.3.68 sont
conservées ; le défaut ancien à trois entrées récupère aussi OpenCode.

Le catalogue est lu sans prompt ni inférence. Le contrat neutre listCatalog
renvoie seulement des métadonnées publiques et les modèles connectés ; les
clés et options d’authentification restent exclues des messages IPC. La limite
de modèles passe à 20 000 pour les catalogues agrégés. Une réponse invalide
garde son diagnostic IPC et ne devient plus une fausse erreur d’arrêt code 0.

Les cases et boutons radio natifs sont remplacés par des interrupteurs dans
le style d’Apprentissage et Bypass, dans le chat et les réglages. La loupe et
la saisie occupent des colonnes séparées. Le bloc de recherche entier disparaît
quand le catalogue est indisponible, évitant une icône isolée sur le champ manuel.

Le réglage warband.language reste déclaré dans le manifeste et les catalogues
NLS. Si le registre VS Code ne connaît pas encore ce réglage pendant une mise
à jour, FR/EN est conservé dans les préférences de l’extension et appliqué sans
erreur d’écriture. Les autres erreurs d’écriture restent signalées.

Validation globale : 2 219 tests réussis, 14 ignorés ; types et lint sans erreur
(165 avertissements et 7 informations Biome conservés). Le catalogue Linux
réel d’OpenCode 1.19.0 a fourni 235 fournisseurs et 9 modèles connectés, sans
inférence. Ce nombre dépend du moteur et ne constitue pas une liste codée en dur.
Les essais Chromium couvrent le catalogue complet, la recherche, les interrupteurs,
OpenCode dans le chat, FR/EN, la loupe avec/sans liste, les approbations, le cockpit
et le graphe. Les essais d’inférence payants et l’installation native Windows
ne sont pas effectués automatiquement.

Livraison : VSIX Windows x64 et Linux x64, SHA-256, sources exactes, patch,
journaux et instructions. Installer le bon VSIX puis recharger la fenêtre
VS Code pour charger les nouvelles contributions. Dépôt privé dans Warband sur
Drive et brouillon GitHub visant le commit compilé ; publication finale manuelle.
