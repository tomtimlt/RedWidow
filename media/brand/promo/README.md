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

## Refaire une version

Sources de la V1 dans `src/`, de la V2 dans `src-v2/`, de la V3 dans `src-v3/`, de la V4 dans `src-v4/`, de la V5 dans `src-v5/` (Playwright, ffmpeg, Python avec numpy) :

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
