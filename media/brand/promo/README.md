# Publicités RedWidow

Vidéos promotionnelles fabriquées à partir de l'interface réelle (composants
HTML du kit `../video-kit/html/`), sur le lab fictif `10.10.10.14`.

| Fichier | Format | Contenu |
| --- | --- | --- |
| `redwidow-promo-v1.mp4` | 1920 × 1080, 30 i/s, 42 s, H.264 + AAC | V1 « offensive » en anglais : EIGHT LEGS / ONE BRAIN / ONE TARGET, l'agent qui lance les outils en ROE Automatique, le Monitor en direct, la kill chain construite par l'agent (la petite araignée la parcourt), le mode Apprentissage (l'araignée étudie, l'indice pointe la faille), l'effort au maximum, les modèles, puis ALL OF THIS / OPEN SOURCE / FREE |

## Refaire une version

Sources dans `src/` (Playwright, ffmpeg, Python avec numpy) :

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
