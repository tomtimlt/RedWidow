# Prompt — vidéo LinkedIn RedWidow (pour Fable 5.2)

Tu montes la vidéo LinkedIn de **RedWidow**, une extension VS Code de pentest,
open source et gratuite. L'objectif est simple : un pentesteur fait défiler son
fil, il s'arrête dès la première seconde, il regarde jusqu'au bout, puis il
clique sur **github.com/tomtimlt/redwidow**. Ce montage est le tien : les plans,
le rythme, les accroches et la musique sont à toi, dans le cadre ci-dessous. Une
règle ne se négocie pas : tout ce qu'on voit et tout ce qu'on lit est vrai.

Dépôt : https://github.com/tomtimlt/RedWidow, branche `design/ui-vscode`
(l'atelier de design). Tous les chemins ci-dessous partent de la racine de cette
branche.

## 1. Le produit et le public

RedWidow réunit dans VS Code les conteneurs Exegol et Kali, leurs terminaux, un
Monitor en direct, une kill chain, une matrice de couverture et un brouillon de
rapport. Un agent IA lance les outils dans le conteneur. On le pilote action par
action, ou on le lâche pour une durée fixée. Le mode Apprentissage lit le cours
fourni et le terminal cité, puis donne un indice ; il n'exécute rien. Version 1.0
en bêta publique, licence MIT. Le projet vise la croissance : étoiles GitHub,
visibilité dans la communauté cyber.

Le public : pentesteurs, red teamers, joueurs de CTF et de HackTheBox, étudiants
en cybersécurité, recruteurs du secteur. Sur LinkedIn, la vidéo démarre seule,
sans le son, le plus souvent sur un téléphone. La personne décide en une ou deux
secondes si elle reste.

## 2. Ce qui fait rester

C'est le cœur du travail. Le propriétaire l'a résumé ainsi : dès qu'on voit ce
qui se passe, on reste.

- **L'action dès la première image.** Pas d'écran noir, pas de fondu, pas de
  logo en ouverture. À t = 0, l'agent travaille déjà : une ligne d'outil arrive,
  une sortie défile, une cible est verrouillée. Quelque chose bouge avant 0,3 s.
  Le logo vient après l'accroche, en 1,5 s au plus.
- **L'image 1 se suffit à elle-même.** Vue seule, comme une vignette, elle dit :
  du pentest, dans VS Code, avec un agent.
- **Une boucle ouverte.** L'accroche pose une promesse que la suite tient. Le lab
  en offre une vraie : on tape une seule phrase, *« Recon 10.10.10.14 and find
  me a way in. »*, et l'agent enchaîne nmap, whatweb, ffuf et sqlmap jusqu'à une
  injection SQL confirmée.
- **Du concret, pas d'adjectifs.** Les vrais noms d'outils, les vrais boutons
  (*Allow once*), les vraies techniques MITRE ATT&CK (T1046, T1595, T1078…), le
  vrai chemin dans le graphe.
- **Lisible sans le son.** Chaque temps fort a son texte à l'écran. La musique
  donne l'énergie ; elle ne porte aucun sens.
- **Un repère de progression.** Les chapitres 01 à 05 et le rail de mission
  donnent une raison de rester jusqu'au bout.
- **Le bon rythme.** Un changement de plan ou de texte par mesure (94 BPM, une
  mesure dure environ 2,55 s) et du mouvement à chaque temps dans le plan. Le
  propriétaire aime le rythme des V7 et V8 et ne veut pas plus rapide : un texte
  reste au moins 1,2 s à l'écran.
- **Les moments forts qui existent vraiment.** La carte d'autorisation qui tombe,
  l'aura du mode Auto qui tourne, le curseur d'effort au maximum et sa vague, le
  rejeu de la kill chain, l'araignée qui étudie en mode Apprentissage, les
  palettes qui changent. Zoome sur ce qui compte, jamais sans raison.
- **Une fin qui fait cliquer.** « Open source. Free. », l'URL en grand pendant
  2,5 s au moins, une invitation à mettre une étoile. La dernière image
  s'enchaîne avec la première, car LinkedIn rejoue la vidéo en boucle.

## 3. Honnêteté

Valoriser au maximum, oui ; inventer, jamais. Une phrase qui frappe et qui est
vraie bat toujours une promesse floue.

**Affirmations permises** (sources : `docs/readme-main/README.md` et
`README.fr.md`, qui décrivent la 1.0) :

- open source sous licence MIT, gratuit ; dans VS Code ; Windows et Linux ;
- conteneurs Exegol et Kali préparés depuis le cockpit, terminaux ouverts dedans ;
- l'agent lance les outils dans le conteneur, lit les résultats, propose la suite ;
- le Monitor suit chaque commande et chaque requête web de l'agent, en direct ;
- la kill chain relie hôtes, identifiants, sites, étapes et butin, avec un état
  (confirmé, hypothèse, échec) et une technique MITRE ATT&CK ; *Rejouer*
  parcourt le chemin retenu ;
- une carte d'autorisation : *Allow once*, *Deny*, *Always* ;
- le Bypass (badge « Auto » dans les visuels) laisse l'agent travailler sans
  demander, de 1 minute à 48 heures ou sans limite ;
- le niveau Acharné (*Relentless*), le bouton Stop, les comptes de test gardés
  dans le coffre de secrets de VS Code ;
- matrice de couverture, export d'audit en ZIP avec empreintes SHA-256,
  brouillon de rapport en Markdown ;
- mode Apprentissage : lit le cours et le terminal cité avec `#`, cite ses
  sources, donne un indice plutôt que la réponse, n'exécute ni n'écrit rien ;
- profils Pentest, HTB / CTF, Bug bounty, Red Team, Mentor ;
- fournisseurs : Claude, OpenAI, OpenCode et son catalogue, Ollama ou tout
  endpoint compatible OpenAI (« Bring any model : Claude. GPT. Ollama. » est
  juste) ;
- 23 jeux de couleurs.

**Interdits :**

- « pentesteur autonome », « remplace les pentesteurs », « hacke n'importe
  quoi », « root en un clic », « trouve toutes les failles », toute garantie de
  résultat (les résultats dépendent du modèle) ;
- tout chiffre absent des sources : étoiles, téléchargements, utilisateurs,
  « 10 × plus rapide », « en 30 secondes » ;
- « root obtenu » : dans le lab, *www-data shell via webshell* et *Root
  escalation* sont des étapes **prévues** (pastille « ? »). On peut dire « elle
  trace le chemin jusqu'au root » et allumer le nœud racine à la fin du rejeu,
  mais un nœud prévu ne passe jamais à ✓. Attention : `src-v9/film.js`
  (`setDone`) le fait ; ne pas le reprendre ;
- macOS, Marketplace VS Code, SysReptor, modèles gratuits, interface en anglais
  livrée (l'interface réelle est en français ; la version anglaise de la vidéo
  traduit l'écran pour la campagne, sans le dire) ;
- toute donnée réelle : seulement le lab fictif `10.10.10.14`, utilisateur `dev` ;
- tout autre produit ou concurrent, à l'écran comme dans les commits ; les logos
  d'Exegol, de Kali ou de HackTheBox (leurs noms en texte suffisent) ;
- les clichés : hacker à capuche, pluie de matrice, glitch, néons ajoutés,
  images d'archive.

Le ton est offensif, sûr de lui, red team : phrases courtes, verbes d'action. Pas
de réassurance répétée du type « vous gardez le contrôle » : « Drive it. / Or
unleash it. » dit déjà l'équilibre. L'IA est une aide puissante, jamais le pilote
présenté comme autonome.

## 4. Format et style

- **4:5, 1080 × 1350**, 30 i/s, H.264 `yuv420p`, AAC 192 kb/s, normalisé à
  −14 LUFS, crête vraie −1,5 dBTP. Durée cible : 35 à 40 s.
- **Zones** : titre dans la bande du haut (60 à 390 px), interface au centre,
  rail de mission en bas comme dans la V9. Rien d'essentiel dans les 110 px du
  bas ni dans les coins (commandes du lecteur LinkedIn).
- **Lisibilité au téléphone** : texte d'interface d'au moins 28 px à la sortie,
  titres d'au moins 80 px, étiquettes mono d'au moins 26 px ; trois lignes de
  titre au plus à la fois.
- **Marque** : fond `#0b0b0d`, panneaux `#1f1f1f`, texte `#eef1f4`, gris
  `#a3a6ad`, cramoisi `#E5132B` (palette Widow) sur la dernière ligne d'une
  accroche et sur « RED » de REDWIDOW. Geist 800 en capitales pour les titres,
  JetBrains Mono pour les repères techniques. Polices locales uniquement.
- **Mouvement** : lignes qui montent de 28 px en fondu (0,45 s, `power3.out`,
  0,18 s de décalage, ligne cramoisie un demi-temps plus tard), coupes sur le
  temps, grain et vignette légers comme en V8.
- **Son** : 94 BPM, la musique démarre à la première image. Un impact sur chaque
  outil de l'accroche, une demi-seconde de silence avant la révélation du logo
  (le « hush » de la V8), basses tenues (environ 5 % de l'énergie sous 80 Hz).
  Pas de sirène ni de drop dubstep. Pas de voix off.
- **Langues** : une version française et une version anglaise, même montage. En
  français, légendes en tutoiement dans la voix des pubs (« Donne-lui une
  cible. ») et libellés réels de l'interface (`fr.py`, `fr-map.json`), typographie
  française (espace insécable avant « ? », « ! », « : »). Aucun mélange : seuls
  les noms propres et les noms d'outils restent en anglais, ainsi que « Open
  source ».

## 5. Où trouver les assets

**Le moteur à reprendre** — `media/brand/promo/src-v9/` : film de la V9, déjà
calé en 4:5. `build.py` (timeline en temps musicaux `TL`, légendes, mise en page
4:5 avec `F45`), `film.js` (chaque image calculée par `window.render(t)` sur une
horloge virtuelle, frappe de la consigne, lignes d'outils, kill chain redisposée
en colonnes pour le 4:5, rejeu, badge Auto), `film.css`, `film-9x16.css`,
`film-4x5.css`, `fr.py` (traductions des légendes et de l'interface),
`render.cjs` et `still.cjs` (rendu Playwright vers ffmpeg, images fixes),
`dump.cjs`, `grain.png`, `timeline.json`, `snap/` (chat capturé en hauteur),
`make_v9.py` (ce qui distingue la V9 de la V8). Commandes :
`python3 build.py 4x5 fr`, puis `node render.cjs 4x5-fr sortie.mp4 <durée>
music.wav`, et `node still.cjs 4x5-fr 1.0 2.5` pour des images fixes.
`media/brand/promo/README.md` détaille la fabrication de chaque version.

**La musique** — `media/brand/promo/src-v8/synth.py` régénère la bande-son de la
V8 à partir de `timeline.json` (numpy). Aucun fichier `.wav` n'est versionné :
pour réécouter la bande de la V9, l'extraire avec
`ffmpeg -i media/brand/promo/redwidow-promo-v9-4x5-fr.mp4 -vn music.wav`.

**Les films de référence** — `media/brand/promo/` : `redwidow-promo-v9-4x5-fr.mp4`
(dernière version LinkedIn, corrigée), `-v8-4x5-fr.mp4`, `-v8-16x9.mp4` et
`-v8-9x16.mp4` (anglais), `-v8-16x9-fr.mp4`, `-v7.mp4`. Les sources des versions
précédentes sont dans `src/` à `src-v8/`.

**L'interface vivante** — `media/brand/video-kit/html/` : `chat-approval-wide`
(980 × 640) et `chat-approval-tall` (470 × 849), `chat-bypass` (aura, badge,
rapport de constats), `chat-learning`, `welcome` et `welcome-learning`
(l'araignée qui se déploie ou qui étudie), `monitor`, `killchain`, `configure`
(curseur d'effort au maximum), `appearance` (palettes), `terminal` (session
kali-1, ligne `sudo -l` soulignée). Avec `html/css/redwidow-ui.css` (polices
déclarées « Warband Geist » et « Warband JetBrains Mono ») et
`html/redwidow-ui.js` (`RedWidowUI.effort`, `.palette`, `.learning`, `.bypass`,
`.running`, `.restore`). `html/README.md` donne tailles, sélecteurs et règles.
Tout plan d'interface se construit avec ces composants : on n'en change aucun
texte (sauf par `fr.py` pour la version française) et on ne redessine rien.

**Le kit vidéo** — `media/brand/video-kit/` : `BRIEF.md` (règles de la marque),
`brand.json` (couleurs, polices, les 23 palettes), `logo/` (araignée en calques
`redwidow.svg`, petite icône `redwidow-mini.svg` et monochrome, viseur, lockup
araignée + REDWIDOW, mot-symbole, PNG transparents et sur fond), `cards/` (cartons
de référence, à refaire en texte vivant), `screens/` (captures de référence, à ne
jamais zoomer), `fonts/` (Geist et JetBrains Mono, OFL), `HYPERFRAMES-PROMPT.md`
(ancien découpage de 60 s), `redwidow-video-kit.zip` (le même kit, compressé).
Si `BRIEF.md` contredit ce prompt (tempo, ton, badge), ce prompt l'emporte.

**La marque** — `media/brand/redwidow/` : `redwidow.svg` en calques (pattes,
pédipalpes, cerveau, yeux, viseur), `redwidow-intro.html` et `.mp4`
(animation de 8 s : pattes qui jaillissent, cerveau, viseur qui se verrouille),
viseur en SVG et PNG. `media/spider.js` (`WarbandSpider.create` et
`createMini`), `media/logo.svg`, `media/icons.js` (pictogrammes),
`media/fonts/`. `DESIGN.md`, sections « Logo », « Marque RedWidow » et
« Palettes », fixe l'identité.

**Les visuels fixes** — `media/brand/banner-github.png`, `banner-github@2x.png`,
`banner-linkedin.png`, `banner-github-strip.png`, `banner-github-learning.png`,
`banner-github-hook-en.png`, `social-preview.png` ; leurs sources dans
`media/brand/src-banners/` (`gen.py`, `hook.cjs`, `cap_en.cjs` ;
`readme/frames.py` pour les plaques de chapitre ; `readme/fr-map.json` et
`readme/cap_fr.cjs` pour les libellés français). Images du README dans
`docs/readme-main/docs/img/readme/` : `hero.png`, `hero-fr.png`, `01-weave.png`
à `06-yours.png` et leurs versions `-fr`, `preview.gif`, `preview-fr.gif` ; films
légers dans `docs/readme-main/docs/video/`.

**À ne pas utiliser** — `media/brand/linkedin-carousel-*` : ancienne identité
(Venator Ops).

**Copie sur Google Drive** (si tu y as accès) : dossier « RedWidow promo »
(`1Dvcsl4_nJ8se5WfJj-4H3MQibcr1Bke2`), sous-dossiers V7
(`1SjT7DnIZJt9BTbWgaYKNCkvzZIYnHkKG`), V8 (`17tqBfcTvk1h8LZ_xQn1Uak5-vVyYiARa`) et
V9 (`1K3kwyQ7nQDfUmgDxI7EmmJ8igF0T9URB`). Ce sont les mêmes exports que dans le
dépôt.

## 6. Textes déjà validés

Tu peux en écrire d'autres s'ils passent le test de la section 3.

| Anglais | Français |
| --- | --- |
| Recon 10.10.10.14 and find me a way in. *(consigne réellement tapée)* | Repère 10.10.10.14 et trouve-moi une entrée. |
| For pentesters · inside VS Code | Pour les pentesteurs · dans VS Code |
| Your target / is already / in the web. | Ta cible / est déjà / dans la toile. |
| Weave. Watch. Strike. Wrap. Learn. | Tisse. Guette. Frappe. Emballe. Apprends. |
| Give it a target. | Donne-lui une cible. |
| It maps the path to root. | Elle trace le chemin jusqu'au root. |
| Drive it. / Or unleash it. | Pilote-la. / Ou lâche la bête. |
| It writes the report. | Elle écrit le rapport. |
| Stuck on a box? / It reads your terminal. | Bloqué sur une box ? / Elle lit ton terminal. |
| Stuck? / Not for long. | Bloqué ? / Plus pour longtemps. |
| Never executes. | N'exécute jamais rien. |
| Bring any model. | Branche le modèle de ton choix. |
| 23 color sets. / One spider. | 23 jeux de couleurs. / Une araignée. |
| All of it. / Open source. / Free. | Tout ça. / Open source. / Gratuit. |
| Star it on GitHub | Mets-lui une étoile sur GitHub |
| For authorized testing only. | Réservé aux tests autorisés. |

## 7. Structure de départ

Un point de départ, pas un ordre : change-le si une autre construction tient
mieux le spectateur.

1. **Accroche, 0 à 5 s.** On entre en pleine action dans le chat (format 4:5 de la
   V9). La consigne est déjà envoyée ; nmap, whatweb, ffuf arrivent, un par temps,
   avec un impact sonore ; sqlmap fait tomber la carte d'autorisation, *Allow
   once* est pressé. En haut : trois lignes courtes qui montent avec les outils,
   la dernière en cramoisi.
2. **Logo, environ 1,3 s.** Silence d'une demi-seconde, l'araignée verrouille son
   viseur, REDWIDOW, « Pentest in VS Code, with AI on call. »
3. **Les cinq temps, environ 22 s.** 01 Weave (conteneurs Exegol et Kali,
   l'agent lance les scans dans kali-1) ; 02 Watch (Monitor en direct, kill chain
   lisible en colonnes, techniques ATT&CK, *Rejouer* jusqu'au nœud racine) ;
   03 Strike (« Drive it. » sur la carte, « Or unleash it. » sur l'aura Auto et le
   badge « Auto 2:00 ») ; 04 Wrap (rapport de constats et gravités) ; 05 Learn
   (terminal et chat d'Apprentissage, l'araignée étudie, l'indice).
4. **Modèles, environ 3 s.** « Bring any model : Claude. GPT. Ollama. »
5. **Fin, environ 6 s.** « All of it. / Open source. / Free. », puis l'araignée,
   l'URL en grand, l'invitation à l'étoile et « For authorized testing only. »
   La dernière image prépare la première pour la boucle.

Si le temps le permet, fais une **accroche B** sur le même corps, à tester
contre la A : ouvrir sur la fin du rejeu de la kill chain (« It maps the path to
root. »), puis revenir à la consigne tapée (« One sentence started it. »).

## 8. Livrables

Dans `media/brand/promo/` :

- `redwidow-promo-v10-4x5-fr.mp4` (version principale) et
  `redwidow-promo-v10-4x5.mp4` (anglais), 35 à 40 s ;
- `-v10-4x5-fr-15s.mp4` et `-v10-4x5-15s.mp4` : accroche, logo, Strike, rejeu
  de la kill chain, fin ;
- l'accroche B si tu l'as faite (`-v10-4x5-fr-b.mp4`) ;
- `redwidow-v10-cover-fr.png` et `redwidow-v10-cover.png` (1080 × 1350) : la
  vignette la plus forte, à choisir comme couverture sur LinkedIn ;
- `src-v10/` : sources complètes, reconstructibles avec les commandes du README ;
- une ligne par fichier dans le tableau de `media/brand/promo/README.md` ;
- `src-v10/POST.md` : trois propositions de texte de publication en français et
  trois en anglais (accroche dans la première ligne, lien vers le dépôt, aucune
  promesse hors section 3).

## 9. Vérifier avant de livrer

- Extraire une image par seconde, et chaque image des 3 premières secondes, puis
  les regarder toutes : chevauchements, texte coupé, glyphes qui se touchent (la
  cédille de « ÇA » sous la ligne du dessus : interligne d'au moins 1,2),
  accents, mélange de langues, texte trop petit.
- Regarder la vidéo réduite à 360 px de large, comme sur un téléphone : chaque
  texte se lit-il ? L'image 1 dit-elle ce qu'est le produit ?
- Relire chaque phrase à l'écran face à la section 3 et noter la source qui la
  prouve.
- Mesurer le son : −14 LUFS intégrés, crête vraie sous −1,5 dBTP, pas de
  saturation.
- Vérifier la taille réelle des fichiers (1080 × 1350) : `render.cjs` choisit la
  taille d'après le préfixe du format.
- Aucune requête réseau pendant le rendu (polices et images locales).

Pièges déjà rencontrés : les transitions CSS se figent dans un rendu image par
image (utiliser des animations pilotées par l'horloge) ; plusieurs composants
partagent des `id`, donc chercher les éléments à partir de leur parent ; pas de
`filter` sur les calques de l'araignée ; deux rendus lancés en même temps vers le
même fichier le corrompent.

## 10. Cadre de travail

- Travaille et pousse uniquement sur `design/ui-vscode`, jamais sur `main`.
  Commits en français, un par lot cohérent, sans nom de modèle d'IA.
- Sont déjà approuvés, sans demander : créer `src-v10/`, rendre les vidéos,
  extraire des images de contrôle, mettre à jour le README des pubs, committer et
  pousser sur `design/ui-vscode`. Ne modifie pas les fixtures ni l'interface de
  l'atelier : le film vit dans ses propres fichiers.
- Ne délègue pas à d'autres agents.
- Va jusqu'au bout : une erreur de rendu, une police qui ne charge pas ou un
  chevauchement sont des obstacles ordinaires à corriger, pas des raisons de
  t'arrêter. Pose une question seulement si une décision appartient vraiment au
  propriétaire.
- Termine par un compte rendu pour quelqu'un qui n'a pas suivi ton travail :
  les fichiers livrés, l'accroche choisie et pourquoi, chaque affirmation à
  l'écran avec sa source, les vérifications faites et ce qui reste à regarder.
