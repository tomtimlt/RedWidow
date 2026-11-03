# Audit de mission

Audit sert à montrer ce qui a été exécuté et les éléments sur lesquels repose une
conclusion. Il fonctionne sans dépendre du fournisseur ou de la puissance du modèle.

## Utilisation

1. Activer un projet et lui associer ses conteneurs dans Venator.
2. Travailler avec l’agent ou ouvrir un terminal depuis Venator. La collecte démarre
   automatiquement ; aucune demande au modèle n’est nécessaire.
3. Ouvrir **Réglages → Audit**, ou cliquer sur l’état **Audit** de la barre VS Code.
   Filtrer par acteur, type d’événement, dates locales ou texte : cible, outil,
   commande et résultat. Les traces conservent leurs identifiants et dates UTC.
4. Déplier un brouillon du registre, vérifier ses preuves puis renseigner objectif,
   cible, contexte de test/accès, méthode et observations. Choisir **Constat**,
   **Non observé** ou **Non concluant**, puis **Enregistrer ma qualification**.
5. **Exporter le dossier d’audit** produit un ZIP local. L’empreinte du ZIP apparaît
   dans Output → Venator Ops. Aucun serveur de rapport ne reçoit cet export.

Les captures de preuve explicites depuis une sélection d’éditeur ou un terminal
restent disponibles et durables. Leur inventaire et leur texte masqué sont inclus
avec les traces dans le ZIP, sans les rattacher artificiellement à un contrôle.

## Ce qui est automatique

Les demandes et résultats d’outils, approbations/refus, événements de processus,
erreurs et fins de run sont copiés dans un journal par UUID de projet. Le run reste
rattaché à son projet initial, même si un autre projet devient actif. L’historique du
chat n’est pas importé rétroactivement et aucune ancienne session n’est envoyée au modèle.

L’agent normal dispose de `record_test` pour annoter un contrôle effectué. Les
références doivent appartenir aux observations réelles du run courant. Le résultat
reste **à qualifier**, même si l’agent annonce un constat. Il ne peut ni suspendre la
collecte, ni effacer les traces, ni s’attribuer une qualification humaine. Le mode
Apprentissage conserve ses seuls outils de cours ; la copie des traces par l’hôte
ne lui ajoute aucun outil d’écriture.

Un code de retour nul, une approbation ou la présence d’un extrait ne prouve pas la
validité d’un test. Les brouillons automatiques n’ont aucune conclusion attribuée.
Un nouveau résultat d’outil après une qualification remet ce brouillon à qualifier ;
la qualification précédente reste visible dans les traces.

## Terminaux manuels

Seuls les terminaux créés par cette fenêtre Venator et appartenant à un conteneur
associé au projet sont suivis. Leur attribution est fixée à l’ouverture. Aucun
terminal extérieur, navigateur, Burp ou poste complet n’est enregistré par cette
première capture manuelle.

La capture lit le journal `script` du conteneur toutes les trois secondes, sans
appel au modèle : au plus 64 Kio bruts par lecture et 16 384 caractères nettoyés et
masqués. Les morceaux nouveaux sont conservés, les tampons identiques dédupliqués.
Une dernière capture précède la suppression du journal temporaire lors de la
fermeture. Si elle échoue, ce temporaire n’est pas supprimé par ce parcours.

Cette collecte périodique ne constitue pas un relevé exhaustif de chaque commande :
elle peut perdre une rafale importante ou une partie des contrôles du terminal.
Sans `script`, avec un conteneur arrêté ou une lecture impossible, un trou est
signalé. La reprise n’invente pas la sortie manquante. La pause arrête les copies
durables ; à la reprise, le tampon courant sert de nouveau point de départ.

## Conservation et export

Le stockage est dans `<configDir>/projects/<UUID>/audit/`, séparé des conversations.
Sous Linux, les nouveaux dossiers/fichiers sont créés avec des droits 0700/0600.
Les secrets reconnus sont masqués avant écriture. Aucun effacement périodique n’est
prévu. Retirer une fiche projet ne détruit pas ces fichiers ; exporter avant de la
retirer permet de garder un accès pratique à ses traces.

Les écritures sont sérialisées par collecteur et projet, puis synchronisées sur le
disque. Les fichiers tournent par blocs de 8 Mio ; un collecteur s’arrête de copier
à son budget de 1 Gio, en comptant les journaux présents à sa première écriture.
Plusieurs fenêtres ont des fichiers distincts et ne partagent pas un quota global
atomique. Une saturation ou une erreur de disque reste visible ; elle ne bloque pas
silencieusement les actions de la mission. La collecte doit alors être rétablie
explicitement après gestion du stockage. Une fin de collecteur non propre est
signalée au mieux à la réouverture, sans prétendre détecter tous les arrêts brutaux.

Pour garder l’interface réactive, l’aperçu lit au plus 32 Mio de journaux récents,
affiche 500 traces et jusqu’à 1 000 entrées de registre dérivées. **Le registre n’est
pas exhaustif au-delà de cette fenêtre**, y compris dans `tests.json`. Le ZIP
conserve l’ensemble des fichiers JSONL retenus, figés par taille en octets pendant
l’export. Il comprend :

- `index.html` : aperçu autonome et filtrable, utilisable sans Venator ni IA ;
- `tests.json` : aperçu du registre, auteurs, conclusions, dates et références ;
- `evidence.json` : inventaire et texte des preuves explicites conservées ;
- `journals/*.jsonl` : fichiers de traces retenus ;
- `manifest.json` : périmètre, limites, état de collecte, tailles et SHA-256.

Pauses, données tronquées, événements illisibles et échecs de copie ne sont pas
présentés comme une mission complète. L’heure est celle de la machine ; les SHA-256
permettent de comparer l’intégrité des fichiers, sans signature, scellement externe
ni horodatage tiers. Les traces locales restent modifiables par une personne ayant
accès au disque. La fonction n’atteste pas de tests effectués hors de son périmètre.

La synchronisation dédiée SysReptor sera un lot distinct. Le connecteur MCP générique
`reptor` existant ne remplace pas ce travail de correspondance projet/contrôle/preuve.
