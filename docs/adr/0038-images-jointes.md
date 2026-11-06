# ADR 0038 — Images jointes aux consignes

Statut : accepté pour 0.3.74.

L’utilisateur peut joindre des images PNG, JPEG, GIF et WebP au tour courant, par sélection, dépôt ou collage. Le cœur transporte une consigne texte ou une consigne structurée avec images, sans dépendre d’un SDK. Les adaptateurs traduisent les images dans le format de leur fournisseur. Les octets ne sont pas renvoyés automatiquement aux tours suivants ; le fournisseur ou le SDK peut conserver l’image dans l’historique de la session.

Les données proviennent de la webview, jamais d’un chemin hôte. Le nombre de pièces est limité à dix, les images à 5 Mio chacune et 12 Mio au total. La validation vérifie forme, nom, base64 canonique et signature. Les limites existantes des textes restent applicables ; PDF et binaires sont refusés. Les images sont transmises au fournisseur et seuls les noms sont affichés dans la conversation ; leurs données ne sont pas journalisées par le moteur.

La capacité visuelle est issue du catalogue du fournisseur quand il la fournit. Une capacité explicitement négative bloque l’envoi ; une capacité inconnue déclenche un avertissement sans interdire l’envoi. L’aperçu utilise une URL `data:` autorisée uniquement pour les images dans la CSP du chat.
