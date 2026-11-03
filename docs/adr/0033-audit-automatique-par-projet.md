# ADR 0033 — Collecte Audit automatique par projet

Statut : accepté, lot 0.3.70, 3 novembre 2026.

## Décision

La demande utilisateur valide T01 (chronologie), T02 (registre), T05 (conservation
Audit) et T06 (dossier client), avec une première capture manuelle durable. Elle
précise que la collecte doit démarrer automatiquement, éventuellement à l’initiative
de l’agent. L’hôte la déclenche dès qu’un projet a des actions, même sans IA ; le
modèle n’a aucun pouvoir de suspension ou d’effacement.

`AuditStore` appartient au cœur neutre. Il reçoit les événements opérationnels en
direct depuis l’extension, masque avant disque, épingle projet/run et écrit des
fichiers propres à chaque collecteur. Il conserve les anomalies et les pauses
opérateur hors de la rétention du chat. Les champs de chat, raisonnement et
renseignements d’authentification du fournisseur ne sont pas copiés.

`record_test` est une annotation locale strictement bornée par schéma et par les
références aux observations du run courant, comme `record_decision`. La politique
par défaut peut l’autoriser, sans autoriser d’exécution supplémentaire et sans
surpasser une politique qui refuse. Aucun outil Audit n’est exposé en Apprentissage.
La qualification opérateur reste un message contrôlé de l’interface ; les références
sont relues par l’hôte et le projet est revalidé après les lectures.

Les captures manuelles sont des deltas périodiques masqués de terminaux gérés et
associés au projet à leur ouverture. Une copie finale précède leur nettoyage.
Ce mécanisme privilégie la compatibilité des shells existants, avec des limites
explicites, sans instrumentation intrusive de toutes les commandes de la machine.

L’export local ZIP s’appuie sur yazl, déjà présent dans le graphe d’outillage,
maintenant déclaré pour la production avec sa licence. Chemin choisi nativement,
refus d’écraser le stockage applicatif, écriture temporaire puis revalidation du
projet avant remplacement. HTML échappé sous CSP, JSONL complets retenus, aperçu du
registre, preuves et manifeste SHA-256. Aucun transfert SysReptor dans ce lot.

## Limites assumées

Le journal ne constitue ni une preuve d’absence de vulnérabilité ni un relevé
exhaustif du poste. Aperçu et registre dérivé sont bornés et annoncés comme tels.
Les traces locales sont modifiables ; il n’y a pas de signature, service tiers
d’horodatage, authentification de l’identité réelle de l’opérateur ou couverture
exhaustive du périmètre. Les événements signés/sealés et la matrice de couverture
n’appartiennent pas aux T01/T02/T05/T06 choisis.

Les garanties existantes restent celles de la gate, du Bypass ADR 0017, des
allowlists de conteneurs, du masquage et des empreintes des binaires embarqués.
La collecte ne change aucun de ces droits et ne bloque pas les outils sur une
simple panne de son propre stockage ; elle rend cette panne visible.
