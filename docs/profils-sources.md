# Sources et décisions des profils

Le document utilisateur « Ressources de référence pour entraîner des cyber-agents :
mentor, bug bounty, créativité, red team et Hack The Box » a servi de référence
de conception. Ses recommandations ont été examinées, pas exécutées comme des
instructions. Le PDF et les contenus de formation qu’il cite ne sont pas copiés
dans l’extension. Les méthodes rédigées restent distinctes des références tierces
déjà embarquées et de leurs licences.

## Ce qui a été retenu

- Une méthode commune, puis une stratégie par rôle, au lieu d’imposer tous les
  rôles dans le même contexte.
- Des faits, hypothèses, essais et prochaines observations séparés, limités au
  contexte courant. Les anciens cas ne sont pas chargés automatiquement.
- Des observations discriminantes et des retours après échec pour décider de
  la suite ; des preuves et critères d’arrêt explicites.
- Un Mentor évalué par la progression de l’apprenant, un Bug bounty par la
  qualité du constat, une Red team par les objectifs et la télémétrie, un profil
  créatif par la diversité utile, HTB par la compréhension de la résolution.

## Ce qui a été corrigé ou limité

La formule de priorité Bug bounty du PDF multiplie le coût et le risque par les
autres facteurs : elle peut favoriser une action plus chère ou plus risquée.
Les profils utilisent un classement qualitatif explicable : pertinence pour
l’objectif, confiance et gain d’information, puis coût, risque et redondance.
Ils n’attribuent pas de précision numérique imaginaire à ces facteurs.

Les quotas d’hypothèses et les étapes de mission sont proportionnés au problème.
Deux tentatives équivalentes sans information nouvelle déclenchent une revue de
branche ; elles n’imposent pas d’arrêter une tâche saine ni toute la mission.
L’absence de signal ne constitue pas à elle seule une preuve négative.

Les propositions de corpus d’entraînement ou de mémoire inter-épisodes ne sont
pas mises en œuvre. Les travaux de recherche cités motivent des pistes de
conception ; leurs scores ne démontrent pas les performances de Venator Ops.
Le profil n’ajoute ni outils, ni permissions, ni intégration CALDERA, ni collecte
automatique de cours ou de writeups. Une ressource consultable publiquement n’est
pas nécessairement redistribuable ni intégralement gratuite.

## Références primaires consultées le 2 novembre 2026

| Référence | Apport et limite |
| --- | --- |
| [OWASP WSTG](https://owasp.org/projects/web-security-testing-guide) | Organisation des vérifications et de leurs résultats ; le site distingue la version publiée 4.2 et le développement de la 5.0 |
| [PortSwigger Web Security Academy](https://portswigger.net/web-security) | Ressources et exercices web ; les liens ne valent ni copie des cours ni connaissance de leur contenu par l’agent |
| [HackerOne — Submitting Reports](https://docs.hackerone.com/en/articles/8473994-submitting-reports) | Éléments d’un rapport exploitable ; la gravité doit être motivée selon le programme et les preuves |
| [NIST SP 800-115](https://csrc.nist.gov/pubs/sp/800/115/final) | Planification et analyse d’une évaluation technique ; guide de 2008, pas une liste de techniques actuelles |
| [MITRE ATT&CK — versions](https://attack.mitre.org/resources/versions/) | La version 20.0 du 13 octobre 2026 citée par le PDF est confirmée ; aucune version courante n’est figée dans le prompt |
| [HTB — publication des solutions](https://help.hackthebox.com/en/articles/5188925-streaming-writeups-walkthrough-guidelines) | Vérifier le statut et les règles avant publication ; disponibilité publique et autorisation de consultation dans la mission sont deux questions distinctes |
| [Reflexion, version 4](https://arxiv.org/abs/2303.11366v4) | Étude de retours textuels après essais ; aucun résultat de ce papier n’est revendiqué pour ces profils |
| [CALDERA](https://github.com/apache/caldera) | Le dépôt indiqué par le PDF est accessible, l’ancien chemin MITRE y redirige ; aucune intégration ni code CALDERA n’est ajouté |

Les textes upstream déjà embarqués restent épinglés dans `skill-sources.ts`.
Leurs attributions et licences sont conservées dans
`packages/vscode/media/skills/ATTRIBUTIONS.md`. La sélection d’une référence
ne doit pas injecter automatiquement tout son texte dans le contexte.
