# Venator Ops 0.3.70 — Audit automatique de mission

Branche `temp/0.3.70-audit-auto`, base `7b2988326e25cff9a62a55f8ca04e47f5c02524c`.

T01/T02/T05/T06 : chronologie filtrable, registre de contrôles sourcés, conservation
séparée du chat et export client local. La capture des actions et des terminaux
Venator associés démarre automatiquement avec le projet, même sans IA. L’agent
peut annoter un contrôle via `record_test` ; seule une qualification dans la page
Audit porte la mention « Revu par l’opérateur ». Une exécution réussie reste un
brouillon sans conclusion automatique.

Page Audit en FR/EN, état dans la barre VS Code, pause/reprise opérateur et limites
visibles. Le ZIP contient HTML autonome, aperçu du registre, preuves conservées,
JSONL retenus et manifeste SHA-256. Les copies manuelles sont périodiques et
bornées ; les outils et terminaux externes sont hors périmètre. Les empreintes ne
constituent ni signature ni horodatage indépendant. [Détails](audit.md).

OpenCode et son catalogue de fournisseurs, la gate, le Bypass et les droits du
mode Apprentissage sont conservés. Pas de synchronisation dédiée SysReptor dans
cette version, ni de reprise automatique des anciennes conversations.

Les vérifications finales et les artefacts de livraison sont consignés dans le
paquet privé : journaux des checks/constructions, contrôle des VSIX et des sources,
notes et instructions de publication. Le brouillon GitHub vise le commit exact ;
les deux VSIX et leurs SHA-256 sont à joindre avant publication manuelle.

## Vérifications locales

`pnpm check` sous le reaper cloud : **2 245 tests réussis, 14 ignorés**, aucun échec ;
types des sources/tests et compilation réussis. Biome : aucun échec, 168 avertissements
et 7 informations. Aucun appel d’inférence facturé.

Chromium avec CSP conservée : filtres, FR/EN, brouillon maintenu pendant les nouvelles
traces, qualification reliée au vrai registre hôte, pause/reprise, export ZIP réel,
trois thèmes et largeurs 360/1 000 px. Recette dans un conteneur Kali local sans
réseau : shell `script` réel, lecture Docker, masquage, déduplication, capture finale
avant nettoyage et export vérifiés. Les scénarios utilisent des sorties de recette,
sans test d’une cible extérieure.

L’installation native de l’extension dans VS Code et la recette sur Windows ne sont
pas déclarées exécutées par ces essais cloud. La vérification des deux VSIX reste
une vérification de paquet, distincte de cette recette native.
