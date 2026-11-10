# ADR 0048 — Diagnostic fournisseur et stderr du moteur

## Contexte

Une erreur OpenCode ou une sortie prématurée du moteur ne donnait pas assez de contexte pour diagnostiquer une connexion. Le cache d'authentification et les sorties des processus peuvent contenir des secrets.

## Décision

Résoudre le chemin du cache OpenCode avec les mêmes règles XDG et HOME dans le moteur et l'extension. Le diagnostic indique le fichier recherché et qualifie de source indéterminée la source effectivement choisie par OpenCode, sauf clé API explicitement imposée. Aucun contenu du cache n'est extrait pour le diagnostic. Les messages du fournisseur sont masqués avec les secrets connus et les comptes de test avant leur plafonnement et leur émission au recorder.

La sortie stderr est collectée en octets jusqu'à 64 Kio, puis masquée en bloc avant transmission et sélection des 20 dernières lignes. Un débordement ou une fermeture incomplète au terme d'un délai borné détruit le bloc entier et produit un marqueur fixe. Le processus reste ainsi libéré même si un descendant conserve le descripteur.

Le bouton de test par fournisseur lance uniquement le sondage de modèles et du catalogue avec les mêmes réglages et identifiants, puis termine son moteur. Il distingue l’accès au catalogue et la connexion déclarée par le runtime ; la génération ne fait pas partie du test. Il ne change pas le fournisseur actif.

## Conséquences

Les cartes d'erreur peuvent aider à identifier une configuration et une cause sans exposer le contenu du cache. Un stderr trop volumineux ou incomplet ne fournit aucun extrait. Le recorder demeure l'autorité de masquage avant les sinks.
