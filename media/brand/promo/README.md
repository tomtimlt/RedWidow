# Publicités RedWidow

Vidéos promotionnelles fabriquées à partir de l'interface réelle (composants
HTML du kit `../video-kit/html/`), sur le lab fictif `10.10.10.14`.

| Fichier | Format | Contenu |
| --- | --- | --- |
| `redwidow-promo-v1.mp4` | 1920 × 1080, 30 i/s, 42 s, H.264 + AAC | V1 « offensive » en anglais : EIGHT LEGS / ONE BRAIN / ONE TARGET, l'agent qui lance les outils en ROE Automatique, le Monitor en direct, la kill chain construite par l'agent (la petite araignée la parcourt), le mode Apprentissage (l'araignée étudie, l'indice pointe la faille), l'effort au maximum, les modèles, puis ALL OF THIS / OPEN SOURCE / FREE |
| `redwidow-promo-v2.mp4` | 1920 × 1080, 30 i/s, 39,5 s, H.264 + AAC | V2 : on comprend dès la première seconde (AN AI AGENT / THAT HACKS / WITH YOU pendant que l'agent lance ses outils dans le chat), révélation « YOUR AI RED TEAMER », Monitor, kill chain construite par l'agent, FULL AUTO et rapport qui s'écrit, Apprentissage (IT SEES WHAT YOU MISSED), MAX BRAIN, ANY MODEL, puis ALL OF THIS / OPEN SOURCE / FREE. Dégradés rouges sans reflet blanc. Sources dans `src-v2/` |
| `redwidow-promo-v3.mp4` | 1920 × 1080, 30 i/s, 42 s, H.264 + AAC | V3 : ouverture qui respire (la fenêtre sort du noir, le prompt se tape à vitesse humaine, la tension monte jusqu'à la révélation à 6,5 s), nouvelle bande-son trap industrielle en demi-tempo (808, caisse claire sur le 3, rafales de charleston, arpège pendant la kill chain), indice de l'Apprentissage surligné en même temps que la ligne du terminal (plus de flèche), fin sur `github.com/tomtimlt/redwidow`. Sources dans `src-v3/` (film.js dérivé de la V2 par `make_js.py`) |

## Refaire une version

Sources de la V1 dans `src/`, de la V2 dans `src-v2/`, de la V3 dans `src-v3/` (Playwright, ffmpeg, Python avec numpy) :

1. `node cap_agent.cjs` avec l'aperçu lancé (`PORT=4173 node scripts/preview.mjs`) :
   capture le chat de l'agent dans `snap/` (variable `SNAP`).
2. `python3 build.py` : assemble `film.html` (composants du kit + `film.css`).
3. `python3 synth.py music.wav 42` : bande-son synthétisée (120 BPM, calée sur le montage).
4. `node render.cjs redwidow-promo-vN.mp4 42 music.wav` : rendu image par image.
   `node still.cjs 9.5 21` sort des images fixes pour vérifier.

Chaque image est calculée à partir du temps (`window.render(t)` dans
`film.js`) ; les animations CSS du produit suivent une horloge virtuelle.
Règles : lab fictif uniquement, aucune fonction inventée, aucun zoom sans
objet (chaque recadrage montre ce que dit la légende).
