# Publicités RedWidow

Vidéos promotionnelles fabriquées à partir de l'interface réelle (composants
HTML du kit `../video-kit/html/`), sur le lab fictif `10.10.10.14`.

| Fichier | Format | Contenu |
| --- | --- | --- |
| `redwidow-promo-v1.mp4` | 1920 × 1080, 30 i/s, 42 s, H.264 + AAC | V1 « offensive » en anglais : EIGHT LEGS / ONE BRAIN / ONE TARGET, l'agent qui lance les outils en ROE Automatique, le Monitor en direct, la kill chain construite par l'agent (la petite araignée la parcourt), le mode Apprentissage (l'araignée étudie, l'indice pointe la faille), l'effort au maximum, les modèles, puis ALL OF THIS / OPEN SOURCE / FREE |
| `redwidow-promo-v2.mp4` | 1920 × 1080, 30 i/s, 39,5 s, H.264 + AAC | V2 : on comprend dès la première seconde (AN AI AGENT / THAT HACKS / WITH YOU pendant que l'agent lance ses outils dans le chat), révélation « YOUR AI RED TEAMER », Monitor, kill chain construite par l'agent, FULL AUTO et rapport qui s'écrit, Apprentissage (IT SEES WHAT YOU MISSED), MAX BRAIN, ANY MODEL, puis ALL OF THIS / OPEN SOURCE / FREE. Dégradés rouges sans reflet blanc. Sources dans `src-v2/` |
| `redwidow-promo-v3.mp4` | 1920 × 1080, 30 i/s, 42 s, H.264 + AAC | V3 : ouverture qui respire (la fenêtre sort du noir, le prompt se tape à vitesse humaine, la tension monte jusqu'à la révélation à 6,5 s), nouvelle bande-son trap industrielle en demi-tempo (808, caisse claire sur le 3, rafales de charleston, arpège pendant la kill chain), indice de l'Apprentissage surligné en même temps que la ligne du terminal (plus de flèche), fin sur `github.com/tomtimlt/redwidow`. Sources dans `src-v3/` (film.js dérivé de la V2 par `make_js.py`) |
| `redwidow-promo-v4.mp4` | 1920 × 1080, 30 i/s, 45 s, H.264 + AAC, −14 LUFS | V4 : ouverture lisible sans le son en 3 s (AN AI AGENT / THAT HACKS / WITH YOU, « For pentesters · inside VS Code »), kill chain remplie en direct par l'agent (journal sous le graphe, caméra qui suit la dernière étape) puis « Rejouer » du produit (crochets, liens allumés, reste atténué), « YOU STEER. / OR LET IT HUNT. » au passage en Automatique, une seconde par modèle, basses allégées (passe-haut ≈ 60 Hz, 808 et explosions réduits), niveau normalisé à −14 LUFS. Sources dans `src-v4/` |
| `redwidow-promo-v5.mp4` | 1920 × 1080, 30 i/s, 42,4 s, H.264 + AAC, −14 LUFS | V5 « Toxic », tout nouveau concept : violet profond et vert toxique (interface en palette Toxique), toile d'araignée en fond qui bat la mesure, ouverture sur la galère du pentesteur en lignes de terminal barrées (23 terminals open…), révélation, puis quatre chapitres calqués sur le rail de mission du produit (01 RECON, 02 ANALYSIS, 03 ACTION avec « Drive it. / Or unleash it. », 04 REPORT), bonus 05 LEARN, modèles, fin ALL OF IT / OPEN SOURCE / FREE. Coupes en dédoublement violet-vert, balayages verts. Musique darksynth 110 BPM. Temps en temps musicaux dans `src-v5/build.py` (timeline.json partagé avec la musique) |
| `redwidow-promo-v6.mp4` | 1920 × 1080, 30 i/s, 42,4 s, H.264 + AAC, −14 LUFS | V6 : la V5 à l'identique (montage, musique) dans la palette rouge Widow : noir, cramoisi `#E5132B` et acier, interface en palette Widow, araignée aux couleurs de la marque. `src-v6/recolor.py` dérive les fichiers de la V5 ; la musique et les autres sources sont celles de `src-v5/` |
| `redwidow-promo-v7.mp4` | 1920 × 1080, 30 i/s, 51,5 s, H.264 + AAC, −14 LUFS | V7 : la V6 ralentie (94 BPM au lieu de 110, chaque temps dure 0,64 s) pour laisser lire chaque plan ; trois temps de plus après « Rejouer » pour que le chemin atteigne sa dernière étape avant le chapitre 3. Musique darksynth recalée sur le nouveau tempo. Sources dans `src-v7/` |
| `redwidow-promo-v7-9x16.mp4` | 1080 × 1920, 30 i/s, 51,5 s, H.264 + AAC, −14 LUFS | V7 verticale pour Reels, Shorts et LinkedIn mobile : même montage et même musique, légendes et fenêtres en colonne entre 250 et 1600 px de haut (zones sûres des interfaces mobiles), chat capturé en hauteur (470 × 849) avec une caméra qui passe de la saisie aux messages, kill chain resserrée qui suit le chemin pendant « Rejouer », terminal et chat d'Apprentissage empilés. `film-9x16.css` complète `film.css` |
| `redwidow-promo-v7-fr.mp4` | 1920 × 1080, 30 i/s, 51,5 s, H.264 + AAC, −14 LUFS | V7 paysage en français : même montage et même musique que la V7. Légendes traduites (« Donne-lui une cible. », « Pilote-la. / Ou lâche la bête. », « Tout ça. / Open source. / Gratuit. »), rail Repérage · Analyse · Action · Rapport, interface en français avec les libellés réels du produit (Supervisé, Rejouer, Votre consigne…) et lab fictif traduit (chat, kill chain, rapport, Apprentissage). Dictionnaires dans `src-v7/fr.py` |
| `redwidow-promo-v8-16x9.mp4` | 1920 × 1080, 30 i/s, 53 s, H.264 + AAC, −14 LUFS | V8 « Weave. Watch. Strike. Wrap. » : la chasse de la veuve noire calquée sur le rail de mission (Repérage, Analyse, Action, Rapport). Accroche lisible sans le son : « For pentesters · inside VS Code », la cible 10.10.10.14, « YOUR TARGET / IS ALREADY / IN THE WEB. », la toile qui se tisse depuis la cible, la veuve qui descend tête en bas sur son fil, crochets de verrouillage (LOCKED), une demi-seconde de silence puis braam et révélation. Chapitres 01 WEAVE · 02 WATCH · 03 STRIKE · 04 WRAP · 05 LEARN avec la phase réelle en sous-titre, mêmes plans d'interface que la V7, récapitulatif en quatre frappes (Am-F-C-G), fin All of it / Open source / Free. Grain et vignette. Nouvelle bande-son : drone, battement de cœur, fils de soie, descente, braam et sub drop, souffles de chapitres, pause Apprentissage sur le cœur |
| `redwidow-promo-v8-9x16.mp4` | 1080 × 1920, 30 i/s, 53 s | V8 verticale (Reels, Shorts, LinkedIn mobile), mêmes zones sûres que la V7 |
| `redwidow-promo-v8-16x9-fr.mp4` | 1920 × 1080, 30 i/s, 53 s | V8 en français : « TA CIBLE / EST DÉJÀ / DANS LA TOILE. », VERROUILLÉE, 01 TISSE · 02 GUETTE · 03 FRAPPE · 04 EMBALLE · 05 APPRENDS, interface en français |
| `redwidow-promo-v8-9x16-fr.mp4` | 1080 × 1920, 30 i/s, 53 s | V8 verticale en français |
| `redwidow-promo-v8-4x5-fr.mp4` | 1080 × 1350 (4:5), 30 i/s, 53 s | V8 en français au format LinkedIn : titre dans la bande du haut (60–390 px), interface zoomée au centre (commande lancée, réponse de l'agent, résultat), rail de mission en bas. `film-4x5.css` complète `film-9x16.css` ; `python3 build.py 4x5 fr`, puis `node render.cjs 4x5-fr …` |
| `redwidow-promo-v9-4x5-fr.mp4` | 1080 × 1350 (4:5), 30 i/s, 50,7 s | V9 : la V8 4:5 française corrigée. Interligne de « TOUT ÇA. / OPEN SOURCE. » (cédille dégagée, 24 px au plus serré) ; kill chain redisposée en colonnes, libellés à 28 px, rien de coupé, et nœud « Élévation root » allumé à la fin du rejeu ; plan logo réduit à 1,3 s (une mesure retirée, même coupe dans la musique de la V8, non régénérée) ; badge « Auto 2:00 » ; pastille « 05 Apprentissage » au rail et « APPRENDS. » dans le récapitulatif. Sources dans `src-v9/` (`make_v9.py` décrit les changements) |
| `redwidow-promo-v10-4x5-fr.mp4` | 1080 × 1350 (4:5), 30 i/s, 39,6 s, H.264 + AAC, −14 LUFS | V10, film LinkedIn en français (version principale). On entre en pleine action : la consigne est déjà envoyée, nmap, whatweb, ffuf arrivent un par temps, sqlmap fait tomber la carte d'autorisation, « Autoriser une fois » est pressé, l'injection SQL est confirmée (« UNE PHRASE. / QUATRE OUTILS. / UNE ENTRÉE. »). Demi-seconde de silence, logo en 1,3 s, puis les cinq temps sans carton plein écran (repère « 01 · TISSE · REPÉRAGE » dans la bande du haut, rail de mission en bas avec progression) : Monitor en direct, kill chain en colonnes puis « Rejouer » jusqu'au nœud racine (qui reste « prévu »), carte d'autorisation puis mode Auto, rapport de constats, mode Apprentissage. Modèles, « Tout ça. / Open source. / Gratuit. », URL en grand et invitation à l'étoile. Sources dans `src-v10/` |
| `redwidow-promo-v10-4x5.mp4` | 1080 × 1350, 30 i/s, 39,6 s | V10 en anglais, même montage et même musique (« ONE SENTENCE. / FOUR TOOLS. / ONE WAY IN. ») |
| `redwidow-promo-v10-4x5-fr-15s.mp4` | 1080 × 1350, 30 i/s, 15,3 s | V10 courte en français : accroche, logo, Strike (carte puis Auto), rejeu de la kill chain, fin avec « Open source. Gratuit. » et l'URL |
| `redwidow-promo-v10-4x5-15s.mp4` | 1080 × 1350, 30 i/s, 15,3 s | V10 courte en anglais |
| `redwidow-promo-v10-4x5-fr-b.mp4` | 1080 × 1350, 30 i/s, 39,6 s | V10 française avec l'accroche B, à tester contre la A : on ouvre sur la fin du rejeu de la kill chain (« ELLE TRACE LE CHEMIN / JUSQU'AU ROOT. »), puis la consigne tapée (« UNE PHRASE / A TOUT LANCÉ. ») ; même corps de film |
| `redwidow-v10-cover-fr.png`, `redwidow-v10-cover.png` | 1080 × 1350 | Couvertures LinkedIn (français, anglais) : l'image de l'accroche où la carte d'autorisation est à l'écran sous le titre complet |

## Refaire une version

Sources de la V1 dans `src/`, de la V2 dans `src-v2/`, de la V3 dans `src-v3/`, de la V4 dans `src-v4/`, de la V5 dans `src-v5/`, de la V7 dans `src-v7/` (Playwright, ffmpeg, Python avec numpy) :

1. `node cap_agent.cjs` avec l'aperçu lancé (`PORT=4173 node scripts/preview.mjs`) :
   capture le chat de l'agent dans `snap/` (variable `SNAP`).
2. `python3 build.py` : assemble `film.html` (composants du kit + `film.css`).
3. `python3 synth.py music.wav 42` : bande-son synthétisée (120 BPM, calée sur le montage).
4. Depuis la V4, normaliser la musique à −14 LUFS avant le rendu :
   `ffmpeg -i music_raw.wav -af loudnorm=I=-14:TP=-1.5:LRA=11 music.wav`.
5. `node render.cjs redwidow-promo-vN.mp4 45 music.wav` : rendu image par image.
   `node still.cjs 9.5 21` sort des images fixes pour vérifier.

Chaque image est calculée à partir du temps (`window.render(t)` dans
`film.js`) ; les animations CSS du produit suivent une horloge virtuelle.
Règles : lab fictif uniquement, aucune fonction inventée, aucun zoom sans
objet (chaque recadrage montre ce que dit la légende).

### V7, deux formats

Dans `src-v7/`, `build.py` prend le format en argument : `python3 build.py 16x9`
et `python3 build.py 9x16` écrivent `film-16x9.html` et `film-9x16.html` (et
`timeline.json`, commun aux deux). Les captures en hauteur viennent de
`cap_agent_tall.cjs` et `cap_bypass_tall.cjs` (aperçu lancé). Ensuite :
`python3 synth.py music_raw.wav 51.6`, normalisation à −14 LUFS, puis
`node render.cjs 16x9 redwidow-promo-v7.mp4 51.5 music.wav` et
`node render.cjs 9x16 redwidow-promo-v7-9x16.mp4 51.5 music.wav`
(`node still.cjs 9x16 19 27.6` pour des images fixes). Le tempo se règle par
`BPM` dans `build.py` ; la musique le lit dans `timeline.json`.

Version française : `python3 build.py 16x9 fr` écrit `film-16x9-fr.html`, puis
`node render.cjs 16x9-fr redwidow-promo-v7-fr.mp4 51.5 music.wav` (même
musique). `fr.py` traduit les légendes (`CAP`) et les nœuds texte de
l’interface (`UI`) ; `film.js` traduit les textes qu’il écrit lui-même
(consigne tapée, journal de la kill chain, « Rejouer », ROE).

### V8

Dans `src-v8/` (mêmes outils que la V7) : `python3 build.py 16x9|9x16 [fr]`,
`python3 synth.py music_raw.wav 53.3`, normalisation à −14 LUFS (deux passes),
puis `node render.cjs <16x9|9x16|16x9-fr|9x16-fr> redwidow-promo-v8-<format>.mp4 53.2 music.wav`.
La timeline tient en temps musicaux dans `build.py` (`TL`) et pilote à la fois
l'image (`film.js`) et la musique (`synth.py`). Le silence avant l'impact est
une porte entre `hush` et `reveal` dans `synth.py`. Les captures du chat en
hauteur viennent de `src-v7/cap_*_tall.cjs`.

### V10 (LinkedIn 4:5)

Dans `src-v10/` (Playwright, ffmpeg, Python avec numpy ; les instruments de la
musique viennent de `src-v8/synth.py`). Une commande par fichier :

```
./make.sh fr a   ../redwidow-promo-v10-4x5-fr.mp4
./make.sh en a   ../redwidow-promo-v10-4x5.mp4
./make.sh fr 15s ../redwidow-promo-v10-4x5-fr-15s.mp4
./make.sh en 15s ../redwidow-promo-v10-4x5-15s.mp4
./make.sh fr b   ../redwidow-promo-v10-4x5-fr-b.mp4
```

`make.sh` enchaîne `python3 build.py <fr|en> <a|15s|b>` (film HTML et
`timeline[-15s|-b].json`, en temps musicaux à 94 BPM), `python3 synth.py`
(bande-son calée sur cette timeline), la normalisation à −14 LUFS en deux passes
et `node render.cjs <variante> sortie.mp4 <durée> musique.wav`. Ne pas lancer deux
`make.sh` de la même coupe en même temps : ils écrivent la même musique. Images
de contrôle : `node still.cjs 4x5-fr 0 3.6 12.6` ; couvertures :
`PNG=1 node still.cjs 4x5-fr 3.6`. Le rendu échoue si la page fait une requête
réseau. `fr.py` traduit les légendes et l'interface (libellés réels de
`src-banners/readme/fr-map.json`) ; le chat de l'accroche assemble la
conversation de `snap/chat-agent-tall.html` et la carte d'autorisation du
composant `chat-approval-tall`. `POST.md` propose les textes de publication.

### Bannières et README

`media/brand/src-banners/` : `cap_en.cjs` (captures anglaises du lab, aperçu lancé),
`gen.py` (pages des bannières) et `shoot.cjs` (photographie, 2x pour le bandeau et
LinkedIn), `hook.cjs` (aperçu social tiré de l'accroche du film V8, en
`node hook.cjs <film-16x9.html> 3.4`). L'aperçu animé du README (`promo.gif`, 640 px,
6,6 s) et la vidéo légère (1280 × 720, 1,9 Mo) viennent de la V8 par ffmpeg.

### Prochaine version (prompt)

`PROMPT-FABLE-LINKEDIN.md` : brief complet pour qu'un modèle monte la V10 au
format LinkedIn (4:5, français et anglais) : stratégie d'accroche, règles
d'honnêteté, emplacement de chaque asset, structure de départ, livrables et
vérifications.


`PROMPT-V11-LINKEDIN.md` : plan de montage de la V11 (28 à 32 s). Bilan de la
V10, nouvelle accroche sur la sortie nmap du Monitor avec la consigne citée en
grand, plan en temps musicaux, détail des plans, pièges connus du moteur
`src-v10/`, livrables et vérifications.