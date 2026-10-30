# Warband 0.3.64 — tous les raccourcis de navigation

La barre de titre du chat latéral et celle des panneaux Warband déclarent désormais les sept actions de navigation : Terminal, Chat, Monitor, Cockpit, Kill Chain, Réglages et Lanceur. La capture précédente ne montrait que les trois premières, seules déclarées dans les menus natifs. Les actions conservent leurs commandes et raccourcis clavier existants.

Le rendu et l’éventuel débordement d’une barre de titre native restent gérés par VS Code selon la largeur disponible. Cette correction expose toutes les actions dans le groupe de navigation ; elle ne supprime aucun bouton existant.

Construction et livraison : pipeline permanente d’AGENTS.md, pnpm release:local. Deux VSIX vérifiés, SHA-256, sources et patch, livraison privée Drive et brouillon GitHub sur le commit exact. Publication finale manuelle par l’utilisateur.
