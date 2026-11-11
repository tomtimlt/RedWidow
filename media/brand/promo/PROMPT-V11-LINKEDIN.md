# Prompt — vidéo LinkedIn RedWidow V11 (pour Opus ou Sonnet)

Tu refais la vidéo LinkedIn de **RedWidow**, une extension VS Code de pentest,
open source et gratuite. Une V10 existe ; elle est propre mais elle ne tient pas
assez le spectateur. Ta mission : la V11, plus courte, plus lisible, avec une
accroche qu'un pentesteur reconnaît en une demi-seconde. Tu peux tout changer
dans le montage. Une seule chose ne bouge pas : tout ce qu'on voit et tout ce
qu'on lit est vrai.

Le critère de réussite est concret. Un pentesteur fait défiler son fil sur son
téléphone, son coupé. Il s'arrête sur la première image, il comprend en deux
secondes ce que fait le produit, il regarde jusqu'à l'URL, il clique sur
**github.com/tomtimlt/redwidow**. Chaque décision se juge à ça.

Dépôt : https://github.com/tomtimlt/RedWidow, branche `design/ui-vscode`. Tous
les chemins partent de la racine de cette branche. Lis d'abord
`media/brand/promo/PROMPT-FABLE-LINKEDIN.md` (le brief de la V10) : ses sections
1 (produit et public), 3 (honnêteté), 5 (assets) et 6 (textes validés) restent
valables et ne sont pas recopiées ici. Si ce prompt le contredit, ce prompt
l'emporte.

## 1. Ce que la V10 a appris

La V10 est dans `media/brand/promo/` (`redwidow-promo-v10-4x5-fr.mp4`, sources
dans `src-v10/`). Regarde-la image par image avant de commencer
(`ffmpeg -i … -vf "fps=1,scale=360:-1,tile=8x5"`). Ce qui marche et que tu
gardes :

- on entre en pleine action, sans logo ni fondu ; le logo arrive à 5 s et dure
  1,3 s ;
- la carte d'autorisation réelle qui tombe, le curseur qui presse « Autoriser
  une fois », le résultat qui s'affiche ;
- la kill chain en colonnes, liens routés hors des libellés, rejeu qui allume le
  chemin en rouge et laisse le nœud racine « prévu » ;
- le rail de mission en bas, dont la pastille courante se remplit ;
- l'écran de fin : URL en 53 px, bouton « Mets-lui une étoile sur GitHub ».

Ce qui ne marche pas assez, et que tu corriges :

1. **L'accroche montre du texte tronqué.** Les lignes d'outils du chat affichent
   « mcp__kali__execute_comma… nmap -sV -T… » : le nom de l'outil, qui est la
   preuve, est la partie coupée. Un pentesteur ne reconnaît rien d'un coup d'œil.
2. **Elle est trop longue.** 39,6 s et cinq chapitres à poids égal : c'est une
   liste de fonctions. Deux plans répètent l'accroche (le Monitor seul, la carte
   d'autorisation une seconde fois).
3. **La consigne tapée, qui est toute la promesse, est écrite en petit** dans une
   bulle du chat.
4. **La musique n'a jamais été écoutée.** Elle est synthétisée et mesurée, pas
   validée à l'oreille. Aucun modèle ne peut l'écouter : dis-le dans ton compte
   rendu au lieu de la déclarer bonne.

## 2. Le concept de la V11

**Une cible, une histoire, trente secondes.** On suit `10.10.10.14` du premier
scan au rapport, sans redite. L'accroche absorbe le repérage et la carte
d'autorisation ; le corps ne garde que ce qui fait avancer l'histoire.

**L'accroche montre une sortie nmap qui défile.** C'est l'image que le public
connaît par cœur. Le composant Monitor (`video-kit/html/monitor.html`) affiche
les vraies commandes en entier (`kali-1 $ nmap -sV -T4 10.10.10.14`) et leur
sortie numérotée, lisible à 28 px : `22/tcp open ssh OpenSSH 9.6p1`,
`8080/tcp open http Werkzeug httpd 3.0.1`, puis whatweb, puis ffuf et sa ligne
`login [Status: 200, Size: 1843, Words: 412]`. La consigne tapée est citée en
grand au-dessus. À la mesure suivante, on coupe sur le chat : sqlmap demande
l'accord, la carte tombe, « Autoriser une fois », l'injection SQL est confirmée.

Durée cible : **28 à 32 s** pour le film complet, 15 s pour la coupe courte.
94 BPM comme la V10 (le propriétaire aime ce rythme et ne veut pas plus rapide) :
un temps dure 0,638 s, une mesure 2,55 s. Un texte reste au moins 1,2 s à
l'écran, soit deux temps.

## 3. Plan du film (en temps musicaux)

| Temps | Durée | Plan | Titre (FR / EN) |
| --- | --- | --- | --- |
| 0 → 4 | 2,6 s | **Accroche 1.** Monitor · kali-1 : nmap à 0, whatweb à 1, ffuf à 2, leurs sorties défilent | `> Repère 10.10.10.14 et trouve-moi une entrée.` puis UNE PHRASE. (0) / QUATRE OUTILS. (2) |
| 4 → 7,25 | 2,1 s | **Accroche 2.** Chat : la carte d'autorisation tombe (4), curseur, « Autoriser une fois » pressé (5,5), résultat (6) | UNE ENTRÉE. en cramoisi (6) |
| 7,25 → 8 | 0,5 s | Silence, l'image s'assombrit | |
| 8 → 10 | 1,3 s | **Logo.** Araignée, REDWIDOW, signature | Le pentest dans VS Code, avec l'IA en appui. / Pentest in VS Code, with AI on call. |
| 10 → 14 | 2,6 s | **Kill chain.** L'agent ajoute les sept nœuds | ELLE TRACE / LA KILL CHAIN. |
| 14 → 18 | 2,6 s | **Rejouer.** Le chemin s'allume, nœud racine en dernier | LE CHEMIN / JUSQU'AU ROOT. |
| 18 → 22 | 2,6 s | **Mode Auto.** Aura, badge « Auto 2:00 » qui décompte | OU LÂCHE / LA BÊTE. · Sans demander · de 1 min à 48 h |
| 22 → 26 | 2,6 s | **Rapport.** Les quatre constats s'écrivent | ELLE ÉCRIT / LE RAPPORT. |
| 26 → 28 | 1,3 s | **Apprentissage.** L'araignée étudie | BLOQUÉ SUR / UNE BOX ? |
| 28 → 32 | 2,6 s | **Indice.** Terminal et chat, ligne `sudo -l` surlignée | ELLE LIT / TON TERMINAL. · Un indice, pas la réponse · n'exécute jamais rien |
| 32 → 36 | 2,6 s | **Modèles.** Trois noms empilés, un par temps | Branche le modèle de ton choix · CLAUDE. GPT. OLLAMA. |
| 36 → 40 | 2,6 s | **Fin 1.** | TOUT ÇA. (36) / OPEN SOURCE. (37) / GRATUIT. (38) |
| 40 → 46 | 3,8 s | **Fin 2.** Araignée, REDWIDOW, URL, étoile, mention légale | github.com/tomtimlt/redwidow · Mets-lui une étoile sur GitHub |

Total : 46 temps, 29,4 s. « Pilote-la. » disparaît comme titre : la carte de
l'accroche le montre. Si tu veux le garder, mets-le en légende mono sous le
titre pendant la carte (« Pilote-la · Autoriser une fois · Refuser · Toujours »).

**Coupe 15 s** (24 temps, 15,3 s) : accroche 0 → 8, logo 8 → 10, rejeu 10 → 14
(graphe déjà construit), Auto 14 → 18, fin 18 → 24 avec « OPEN SOURCE.
GRATUIT. » sous le mot-symbole. Pas de rail dans cette coupe.

Le rail de mission est visible **dès la première image** (01 Repérage pendant
l'accroche), puis 02 Analyse, 03 Action, 04 Rapport, 05 Apprentissage. Il donne
une raison de rester. Il s'efface aux modèles.

Ce plan est un point de départ solide, pas une cage. Si, images à l'appui, une
autre construction tient mieux (par exemple l'accroche de la V10 conservée),
change-la et explique pourquoi. Monte les deux premières images candidates, mets-les
côte à côte à 360 px de large, et choisis.

## 4. Détail des plans

**Mise en page 4:5 (1080 × 1350).** Bande du haut de 60 à 400 px : repère et
titre. Interface de 410 à 1170 px. Rail de 1186 à 1232 px. Rien d'essentiel sous
1240 px ni dans les coins (commandes du lecteur). Texte d'interface d'au moins
28 px à la sortie (les composants de chat et le Monitor à l'échelle 2,2), titres
Geist 800 en capitales de 86 px, légendes JetBrains Mono de 26 px au moins. La
dernière ligne d'un titre est en cramoisi `#E5132B`.

**Accroche 1 (0 → 4).** Bande du haut : repère rouge « POUR LES PENTESTEURS ·
AGENT IA DANS VS CODE » ; en dessous la consigne en JetBrains Mono 34 px, blanc,
chevron cramoisi, sur une ligne (elle tient dans 960 px) ; puis le titre.
« UNE PHRASE. » et la consigne sont déjà là à l'image 0 : démarre leur animation
à un temps négatif pour qu'elles soient à 90 % d'opacité, encore en mouvement.
Fenêtre « Monitor · kali-1 » : composant `monitor` forcé à 470 × 338 px (il se
replie proprement, c'est fait dans `src-v10/film.css`), échelle 2,2. À l'image 0,
la commande nmap est posée et ses lignes de sortie arrivent, une toutes les
0,07 s. À chaque nouvelle commande, la vue défile vers le bas, le compteur passe
de « 1 commande » à « 3 commandes », un trait s'ajoute à la frise. Un impact
sonore par commande.

**Accroche 2 (4 → 7,25).** Coupe franche sur le chat (`chat-hook` de
`src-v10/build.py` : la conversation « Repère 10.10.10.14… » avec la carte réelle
du composant `chat-approval-tall`). Cadre directement sur la ligne sqlmap « en
cours » et la carte. Le curseur arrive du bas à droite, le bouton s'enfonce à
5,5, la carte se referme, la réponse « Entrée : injection SQL sur /login »
apparaît à 6 avec la troisième ligne du titre. C'est exactement la fonction
`hook()` de `src-v10/film.js` à partir de `T.card` : reprends-la.

**Logo (8 → 10).** Identique à la V10 (`reveal()`).

**Kill chain et rejeu (10 → 18).** `makeKC()` de la V10, sans changer la
géométrie. Construction en quatre temps, rejeu avec `step = 0.6` comme dans la
coupe 15 s de la V10 (cinq étapes puis le nœud racine à 17,4). Sous la fenêtre,
la ligne « ÉTAPE 3/5 · Comptes par défaut · T1078 », puis « ENSUITE · PRÉVU ·
Élévation root · T1068 ». Le nœud racine garde sa pastille « ? ».

**Mode Auto (18 → 22).** `auto()` de la V10 : panneau de 338 px de haut pour que
l'aura l'entoure en entier, badge qui décompte, araignée de l'en-tête qui marche.

**Rapport (22 → 26).** `report()` de la V10.

**Apprentissage (26 → 32).** `welcome-learning` zoomé sur l'araignée au livre
pendant deux temps, puis terminal et chat empilés (`hint()` de la V10).

**Modèles et fin (32 → 46).** Comme la V10. Vérifie l'interligne de « TOUT ÇA. /
OPEN SOURCE. » : la cédille ne touche pas la ligne du dessous.

**Transitions.** Coupe sur le temps, avec le balayage cramoisi de la V10
(0,22 s, `out3`) : une seule image presque vide par coupe, pas plus. Pas de
dédoublement de couleurs, pas de tremblement.

## 5. Le moteur

Pars de `media/brand/promo/src-v10/` : copie-le en `src-v11/` et réécris la
timeline et la liste des plans de `build.py`. Le reste se reprend.

- `build.py <fr|en> <a|15s|b>` écrit `film-4x5[-fr][-15s].html` et
  `timeline[-15s].json`. La timeline est en temps musicaux (`BEATS`), convertie
  en secondes par `B()`. Un plan absent d'une coupe reçoit le temps 9000.
- `film.js` calcule chaque image par `window.render(t)`. Fonctions utiles :
  `captions` (lignes qui montent de 28 px en 0,45 s), `camY` et `yIn` (caméra
  verticale dans une fenêtre, positions dans le repère du composant),
  `prepTool` / `toolState` (états réels « en cours » et « réussi »),
  `setMission` (rail de mission du produit), `cursorTo`, `press`, `makeKC`,
  `monitor`, `hook`, `auto`, `report`, `hint`, `end2`, `clockAnims` (horloge
  virtuelle des animations CSS du produit).
- `fr.py` : légendes (`CAP`) et interface (`UI`, libellés réels de
  `media/brand/src-banners/readme/fr-map.json`).
- `synth.py <sortie.wav> <coupe>` : bande-son calée sur la timeline (instruments
  de `src-v8/synth.py`). `make.sh <fr|en> <coupe> <sortie.mp4>` enchaîne tout ;
  `AUDIO_ONLY=1` ne refait que le son d'un fichier déjà rendu.
- `still.cjs <variante> t1 t2 …` sort des images fixes (`OUT=dossier`, `PNG=1`).

Un rendu complet prend environ deux minutes. Chromium, Playwright, ffmpeg et
numpy sont installés ; scipy ne l'est pas.

À écrire pour la V11 : la fonction du plan Monitor d'accroche (trois commandes
qui arrivent à 0, 1 et 2 temps, sorties ligne par ligne, défilement), la ligne de
consigne dans la bande du haut, le rail visible dès l'image 0, la nouvelle
timeline, et les cues correspondantes dans `synth.py`.

## 6. Pièges déjà rencontrés

- **Un plan masqué mesure zéro.** `offsetHeight` et `getBoundingClientRect`
  renvoient 0 tant que la scène est en `display:none`. Mesure dans la fonction
  du plan, pas à l'initialisation.
- **Dimensions réelles de la kill chain** (unités du composant) : nœud de
  236 × 95,5, tête de 46 de haut, barre d'outils de 60 px à l'échelle 1,5. Les
  liens tracés depuis le centre des têtes passent sur les libellés : garde le
  routage par la gouttière centrale et la marge droite.
- **La barre de la kill chain se met sur deux lignes** si on la grossit trop
  (`zoom` de 1,25 au plus).
- **Mélange de langues.** En français, « loot · T1068 » n'était pas traduit ; en
  anglais, « Réflexion » restait dans le chat. Relis chaque image des deux
  versions en cherchant un mot de l'autre langue.
- **Le rail de mission de la capture** affiche « Rapport » en cours pendant le
  repérage : recale-le avec `setMission`.
- **Crête audio.** L'encodage AAC ajoute jusqu'à 2 dB de dépassement sur les
  impacts, et 4 dB à la reprise après le silence. Le limiteur de `make.sh`
  (plafond 0,56, après un `loudnorm` à −13,1) et la réouverture de la porte en
  8 ms règlent le problème. Mesure toujours le fichier MP4 final, pas le WAV.
- **Deux `make.sh` de la même coupe en parallèle** écrivent la même musique et
  la corrompent. Lance-les l'un après l'autre.
- **Les transitions CSS se figent** dans un rendu image par image. Tout
  mouvement passe par `render(t)` ou par `clockAnims`.
- **Plusieurs composants partagent des `id`** : cherche toujours à partir de la
  fenêtre (`$('#log', win)`).
- **Écriture des fichiers.** Écris et modifie le JavaScript avec les outils
  d'édition de fichiers, pas avec un heredoc dans le shell : le contrôle de
  sécurité des commandes refuse les scripts qu'il ne sait pas analyser.

## 7. Honnêteté

La section 3 de `PROMPT-FABLE-LINKEDIN.md` s'applique en entier. Les points qui
ont déjà failli casser :

- le lab fictif `10.10.10.14` uniquement, utilisateur `dev` ;
- un nœud « prévu » de la kill chain ne passe jamais à ✓ ; on peut dire « elle
  trace le chemin jusqu'au root », pas « root obtenu » ;
- aucun chiffre absent des sources, aucune garantie de résultat, pas
  d'« autonome » ;
- on ne change aucun texte dans un composant d'interface, sauf par `fr.py`. Les
  états qu'on fait jouer (outil en cours puis réussi, étape du rail, compteur du
  Monitor) sont des états que le produit affiche réellement ;
- pas de macOS, pas de Marketplace, pas d'autre produit, pas de logo d'Exegol,
  de Kali ou de HackTheBox ;
- pas de hacker à capuche, de pluie de matrice, de glitch ni de néon ajouté.

« UNE PHRASE. / QUATRE OUTILS. / UNE ENTRÉE. » décrit la scène du lab ; ce n'est
pas un texte validé par le propriétaire. Signale-le dans ton compte rendu, avec
l'alternative validée (« Ta cible / est déjà / dans la toile. »).

## 8. Son

94 BPM, la musique démarre à la première image. Un impact par commande de
l'accroche, un coup plus lourd quand la carte tombe, un tintement sur
« Autoriser une fois », une demi-seconde de silence avant le logo, braam et
sub sur le logo. Groove plein jusqu'à l'Apprentissage, qui respire (pas de
batterie, battement de cœur), puis reprise sur les modèles. Montée dans les deux
derniers temps pour enchaîner avec la première image, car LinkedIn rejoue la
vidéo en boucle. Environ 5 % de l'énergie sous 80 Hz (`synth.py` l'affiche). Pas
de sirène, pas de drop dubstep, pas de voix.

Cibles mesurées sur le MP4 : −14 LUFS intégrés (±0,3), crête vraie sous
−1,5 dBTP.

Tu ne peux pas écouter le résultat. Écris-le tel quel dans le compte rendu et
indique les trois passages à vérifier à l'oreille : l'entrée à la première
image, le silence avant le logo, la montée finale.

## 9. Livrables

Dans `media/brand/promo/` :

- `redwidow-promo-v11-4x5-fr.mp4` (principale) et `redwidow-promo-v11-4x5.mp4`
  (anglais), 28 à 32 s ;
- `redwidow-promo-v11-4x5-fr-15s.mp4` et `redwidow-promo-v11-4x5-15s.mp4` ;
- `redwidow-v11-cover-fr.png` et `redwidow-v11-cover.png` (1080 × 1350) : l'image
  la plus forte de l'accroche, titre complet si possible ;
- `src-v11/` : sources complètes, `make.sh`, et `POST.md` (reprends celui de la
  V10 en l'ajustant à ce que montre la V11) ;
- une ligne par fichier dans le tableau de `README.md`, et un paragraphe
  « V11 » avec les commandes.

Format : 1080 × 1350, 30 i/s, H.264 `yuv420p`, AAC 192 kb/s.

## 10. Vérifier avant de livrer

Fais ces contrôles sur les **fichiers finaux**, dans les deux langues, et écris
dans le compte rendu ce que tu as vraiment regardé.

- Une image par seconde et chaque image des trois premières secondes, en
  planche-contact, regardées une par une : chevauchement, texte coupé au bord
  d'une fenêtre, trait sur un libellé, mot de l'autre langue, image vide.
- La même planche à 360 px de large : chaque titre se lit-il ? L'image 0 dit-elle
  « pentest, dans VS Code, avec un agent » ?
- Chaque phrase à l'écran face à la section 7, avec sa source.
- `ffprobe` : taille, cadence, durée. Loudness et crête sur le MP4.
- Le journal de rendu : « aucune erreur », aucune requête réseau.
- La boucle : mets la dernière et la première image côte à côte.

## 11. Cadre de travail

- Travaille et pousse uniquement sur `design/ui-vscode`. Commits en français, un
  par lot cohérent (sources, puis vidéos), sans nom de modèle d'IA.
- Déjà approuvé sans demander : créer `src-v11/`, rendre, extraire des images de
  contrôle, mettre à jour le README des pubs, committer et pousser sur cette
  branche. Ne touche ni aux fixtures, ni à l'interface de l'atelier, ni à
  `src-v10/`.
- Ne délègue pas à d'autres agents.
- Va jusqu'au bout. Une erreur de rendu, un chevauchement, une crête trop haute
  sont des obstacles ordinaires : corrige-les. Pose une question seulement si
  une décision appartient vraiment au propriétaire.
- Termine par un compte rendu pour quelqu'un qui n'a pas suivi : fichiers livrés
  avec leurs mesures, accroche retenue et pourquoi, écarts par rapport à ce
  plan, chaque affirmation à l'écran avec sa source, vérifications faites, et ce
  qui reste à regarder (dont la musique, à l'oreille).
