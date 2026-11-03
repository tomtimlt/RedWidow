# ADR 0034 — RedWidow et historique commun aux chats

Statut : accepté, 3 novembre 2026, lot 0.3.71.

L’utilisateur demande l’intégration de `design/ui-vscode` à `f26842c`, une release
et un relevé des supports graphiques restants. Il ajoute le partage de l’historique
entre le chat latéral et les chats d’éditeur montrés dans sa capture.

L’atelier étant une extension de démonstration sans ascendance commune avec la
production, son habillage est porté sélectivement. Les palettes, géométries SVG,
polices locales et l’araignée sont repris ; CSS fusionné à trois voies depuis
`fa4f5db`, ajouts de production conservés. Les scripts de simulation, règles
virtuelles et paramètres `warbandDesign.*` ne sont pas intégrés. Identifiants
`warband.*` et publisher stables, trois noms de terminaux reconnus. CSP inchangée,
nouveau script local sous nonce et contrôles de mouvement conservés.

L’historique utilisait une clé et un dossier distincts pour chaque chat. Un index
partagé par fenêtre importe les métadonnées validées une fois et applique des
mutations par entrée, sans réécriture depuis une liste périmée. Les abonnements
répercutent les changements aux sessions. Les journaux anciens restent à leur
emplacement ; un lecteur composite ne reçoit que les noms de chats validés et
les UUID déjà contrôlés. Les nouveaux journaux sont communs. La rétention garde
l’origine du chat et protège toutes les conversations ouvertes. Les suppressions
confirment leur portée et refusent les conversations en cours, y compris après
le dialogue. Une reprise déjà ouverte redonne le focus au chat propriétaire.

Le projet et la politique de reprise sont revalidés comme avant ; le partage de
la liste ne rejoue aucun journal et ne modifie aucun contexte de modèle. Les
fenêtres VS Code distinctes ne partagent pas un verrou/processus de publication
en temps réel dans ce lot. L’Audit indépendant de la rétention du chat reste
inchangé. Aucun changement de gate, Bypass, authentification ou SDK d’agent.
