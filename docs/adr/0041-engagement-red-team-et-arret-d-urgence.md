# 0041 — Fiche d'engagement red team, plan de campagne et arrêt d'urgence

- Statut : accepté
- Date : 2026-11-08

## Contexte

Le profil `red-team` décrit une méthode de mission mais n'a aucune structure
d'autorisation propre à un engagement d'émulation d'adversaire. La fiche
programme (ADR 0040) couvre déjà le périmètre, le rythme et la validation par
empreinte pour le bug bounty. Un engagement red team autorisé exige en plus,
d'après les cadres publics (TIBER-EU, plans d'émulation du MITRE CTID,
NIST SP 800-115) : une autorisation nommée, des règles d'engagement, un contact
de pilotage (white team), une déconfliction, un journal d'opérations exportable,
un plan de campagne validé avant exécution, et un arrêt d'urgence.

## Décision

Réutiliser et prolonger les briques existantes ; ne rien exécuter sans
validation humaine par empreinte.

1. **Fiche d'engagement** : type `EngagementSheet` dans `core`, stocké et validé
   par empreinte comme `ProgramSheet` (même mécanisme de chemins sensibles et
   d'approbation CLI puis interface). Champs cités (valeur + citation + source) :
   autorisation (mandant, référence, signataire), fenêtre (dates, horaires),
   périmètre cible, **infrastructure déclarée** (hôtes que l'agent peut
   administrer, distincts des cibles), exclusions, règles d'engagement (techniques
   permises/interdites, systèmes critiques intouchables, données à ne jamais
   extraire), contact white team et procédure de déconfliction, politique OSINT
   (rôles et informations professionnelles publiques seulement ; vie privée
   exclue ; minimisation). Non validée = profil en préparation hors ligne
   seulement.
2. **Arrêt d'urgence** : interrupteur de campagne dans `core`, posé par un geste
   humain (CLI et interface). Quand il est actif, la gate refuse tout outil
   réseau et toute commande shell visant le périmètre ou l'infrastructure
   (code non mémorisable, jamais levé par le Bypass). Il se relâche par un second
   geste humain.
3. **Plan de campagne** : structure validée par empreinte avant exécution, sur le
   modèle des plans d'émulation (synthèse de menace, déroulé, étapes rattachées à
   une tactique/technique ATT&CK — champs déjà présents dans la Kill Chain —,
   objectifs, critères de décision et d'arrêt). Une étape non présente dans un
   plan validé ne peut pas être enregistrée comme exécutée.
4. **Journal de campagne** : vue d'export de l'Audit existant, enrichie des champs
   d'un journal d'opérations (horodatage UTC, étape du plan, technique ATT&CK,
   cible, résultat), remis à la white team.
5. **Infrastructure** : l'agent décrit et met en place la partie technique dans
   les limites de l'infrastructure déclarée ; toute ressource engageant l'identité
   ou le paiement de l'utilisateur (achat de serveurs, de domaines, comptes) est
   une demande à l'utilisateur, exécutée par lui. Démontage obligatoire : la
   clôture est refusée tant que la liste de nettoyage n'est pas complète.
6. **Encadrement strict par défaut** pour ce profil, avec un point de contrôle
   humain à chaque changement de phase.

## Conséquences

- Nouveaux `kind`, codes `Reason`, et une page « Engagement » dans l'interface.
- L'émulation reste subordonnée à une autorisation humaine vérifiable ; aucune
  capacité offensive n'est ajoutée au moteur, seulement des garde-fous et de la
  traçabilité.
- La mise en place d'infrastructure par l'agent est bornée par la fiche et
  journalisée ; les actions à identité/paiement restent humaines.

## Lots

Détail et critères dans les briefs. Lots moteur revus par l'orchestrateur avant
push ; chaque lot `pnpm check` vert.

1. Fiche d'engagement et arrêt d'urgence (core + CLI).
2. Gate : périmètre cible vs infrastructure déclarée ; refus sous arrêt d'urgence.
3. Plan de campagne structuré et validation par empreinte ; contrôle d'étape.
4. Journal de campagne (export Audit enrichi) et liste de clôture.
5. Réécriture du profil `red-team` selon les phases.
6. Interface « Engagement » (fiche, plan, phases, journal, arrêt d'urgence).
