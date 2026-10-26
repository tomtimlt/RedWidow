# ADR 0023 — Recherche et lecture web communes aux moteurs

- Statut : accepté
- Date : 2026-10-26

## Décision

Deux outils MCP partagés, `web.search_web` et `web.read_url`, sont exposés
par les adaptateurs Claude et OpenCode, dont la connexion OpenAI. La CLI et
le mode normal de l’extension les proposent. Le mode Apprentissage conserve
son périmètre de cours local.

La recherche utilise le serveur MCP public Exa, accessible anonymement avec
ses limites de requêtes. Aucun identifiant n’est requis ni envoyé à ce service.
Les résultats incluent des extraits, les URL sources et la date de consultation.
Il n’existe pas de module spécialisé CVE : les requêtes peuvent viser les avis
des éditeurs, la documentation, GitHub et les informations récentes.

La lecture HTTP(S) ne charge ni JavaScript ni ressources intégrées. Le HTML est
converti en texte ; Markdown, JSON et texte brut sont également acceptés.
Aucun outil ou programme n’est installé ou exécuté par ces deux fonctions.
Les actions dans les conteneurs conservent leur circuit d’approbation.

## Frontières

Les outils sont annotés en lecture seule et restent soumis à la gate. Les URL
n’acceptent pas d’identifiants et doivent résoudre exclusivement vers des IP
publiques. L’adresse validée est épinglée pour la connexion, y compris au
travers d’un proxy HTTP(S), avec Host/SNI et vérification TLS conservés.
Chaque redirection est revérifiée ; un passage HTTPS vers HTTP est refusé.
Les pages sont des données externes non fiables, pas des consignes de l’agent.

Plafonds : 25 secondes, cinq redirections, 1 Mio lu, 16 000 caractères de texte
retourné ; la troncature est indiquée. Recherche : cinq résultats par défaut,
huit au maximum. Les PDF, binaires, pages authentifiées, encodages compressés
ignorant `Accept-Encoding: identity` et applications nécessitant JavaScript ne
sont pas pris en charge dans ce lot.

## Validation

Tests des schémas, données HTML/SSE, adresses privées et obfusquées, DNS mixte,
redirections, annulation, taille et garde d’approbation via MCP réel local.
Recherche Exa et lecture de README/page GitHub vérifiées réellement dans le
cloud, sans inférence. Vérification de la lecture après bundling. Les limites
du service public peuvent affecter la disponibilité ; aucun résultat n’est
inventé en cas d’erreur. Bilan global dans l’état du projet.


### Diagnostic — 0.3.39

Les erreurs réseau structurées sont classées sans exposer leur message brut.
DNS, TLS, connexion, dépassement de délai et quota se distinguent. Les corps
non lus fermés après une erreur, une redirection ou un refus de contenu ont
un gestionnaire d’erreur explicite ; leur destruction ne doit pas terminer
le moteur par un événement `AbortError` non géré. Les erreurs de lecture
restent observables par l’itérateur. Les limites réseau et TLS ne changent pas.


### Consigne proactive — 0.3.40

Les deux adaptateurs ajoutent la même consigne système lorsque les deux outils
web sont effectivement exposés, dans l’extension comme dans la CLI. OpenCode
et la connexion OpenAI la transmettent à chaque tour ; Claude la reçoit dans
le complément du préréglage système. Les consignes de l’appelant sont
conservées. Aucun contexte web n’est ajouté aux configurations sans ces outils.


### Confiance système — 0.3.41

Les autorités par défaut et système sont fusionnées localement pour le
client web lorsque l’API Node est disponible. Les certificats supplémentaires
configurés au lancement sont conservés. Aucun certificat téléchargé depuis
un site ou joint par un utilisateur n’est installé ni promu en autorité.
Le site cible et le proxy HTTPS éventuel restent vérifiés avec leurs noms.
Les contrôles DNS, IP épinglées, redirections et plafonds sont inchangés.
