# ADR 0042 — Rythme partagé par groupe d’edge

Statut : accepté pour la livraison 0.3.77.

Plusieurs noms autorisés peuvent aboutir au même edge. Un rythme suivi par nom
permet alors de continuer à charger une adresse déjà en difficulté.

La résolution publique existante fournit toutes ses adresses validées au
contrôleur avant le transport, sans seconde résolution DNS. Les hôtes partageant
une adresse observée sont fusionnés transitivement ; les associations restent
conservées après rotation DNS. Une fusion garde l’arrêt, la pause et le débit les
plus prudents. Le seau global reste applicable.

Un délai ou une connexion coupée après une réponse saine récente provoque une
pause de cinq minutes du groupe. Un autre signal défavorable reçu pendant cette
pause arrête le groupe, y compris une réponse d’une requête déjà en vol.
L’annulation de l’utilisateur, DNS et TLS ne constituent pas ce signal.
La reprise explicite d’un membre concerne tout le groupe. Les anciens tableaux
d’arrêts par hôte restent lisibles ; les nouvelles écritures sont atomiques.

Ce regroupement ne prouve pas que deux services sont identiques. Il peut réduire
le débit de services partageant une infrastructure ; ce choix prudent ne modifie
ni le périmètre, ni la gate, ni `evaluateProgram`. Il s’agit d’un frein sur les
requêtes des outils concernés, pas d’un contrôle de tout le trafic réseau.
