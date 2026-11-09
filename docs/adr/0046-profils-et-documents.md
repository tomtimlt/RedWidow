# 0046 — Profils et documents propres à chaque mission

Statut : accepté — décision utilisateur du 9 novembre 2026 (lot 25).

Pentest est le profil normal et le défaut des nouvelles conversations. Son
identifiant historique `out-of-box` reste compatible avec les préférences.
HTB/CTF et Mentor n’exigent aucun document. Bug bounty exige une fiche programme
validée ; Red Team exige une fiche d’engagement et un plan de campagne validés.

La table `profileDocuments` du cœur gouverne le contrôle de politique sur les
actions opérationnelles : HTTP, shells et outils Kali. La classification Kali
vient du catalogue canonique, indépendamment des arguments de cible (notamment
Metasploit et John). Les lectures de santé/suivi, la documentation et les outils
de préparation restent accessibles. Une lecture documentaire défaillante ne
vaut jamais validation. L’arrêt d’urgence reste prioritaire, y compris pour un
outil Kali dont la cible n’est pas extractible.

Ces refus documentaires ne sont pas mémorisables et suivent le contrat du
Bypass existant. La validation HTTP propre au Bug bounty conserve son exigence
de fiche même sous Bypass. Aucun nouveau contournement de la gate n’est ajouté.

Le socle commun conserve méthode, preuves et kill chain. Les consignes et
relances obligatoires de couverture restent propres au Bug bounty ;
`record_coverage` est disponible ailleurs sans imposer de continuation.
Chaque texte de profil parle uniquement de ses documents. Les références
externes ne sont chargées que sur demande, comme auparavant.

Validation : table des cinq profils et états documentaires, lectures en erreur,
arrêt avec Bypass, chaque outil Kali opérationnel, HTTP/lecture/exec/Kali en
Pentest et HTB sans fiche après approbation, absence de mentions croisées,
nouvelle conversation et couverture facultative sans relance automatique.
Libellés fr/en, icônes/couleurs existantes et captures du menu avant/après dans
`docs/img/chat-profils-*`, clair/sombre et mobile.
