#!/bin/sh
# Fabrique une variante de la V10 : ./make.sh fr|en a|15s|b sortie.mp4
# AUDIO_ONLY=1 ./make.sh … ne refait que le son d'un fichier déjà rendu.
# (film HTML, musique synthétisée, normalisation −14 LUFS en deux passes et limiteur (crête vraie sous −1,5 dBTP), rendu image par image)
set -e
cd "$(dirname "$0")"
LANG_="$1"; CUT="$2"; OUT="$3"
SUF=""; [ "$LANG_" = "fr" ] && SUF="-fr"; [ "$CUT" != "a" ] && SUF="$SUF-$CUT"
TLF="timeline.json"; [ "$CUT" != "a" ] && TLF="timeline-$CUT.json"
python3 build.py "$LANG_" "$CUT"
DUR=$(python3 -c "import json;print(json.load(open('$TLF'))['end'])")
python3 synth.py "music-$CUT-raw.wav" "$CUT"
M=$(ffmpeg -hide_banner -i "music-$CUT-raw.wav" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | python3 -c "
import sys, json, re
j = json.loads(re.search(r'\{[^{}]*\}\s*$', sys.stdin.read()).group(0))
print(f\"measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}\")")
ffmpeg -loglevel error -y -i "music-$CUT-raw.wav" -af "loudnorm=I=-13.1:TP=-1.5:LRA=11:$M:linear=true,aresample=192000,alimiter=limit=0.56:attack=2:release=40:level=disabled,aresample=48000" "music-$CUT.wav"
if [ -n "$AUDIO_ONLY" ]; then
  ffmpeg -loglevel error -y -i "$OUT" -i "music-$CUT.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -t "$DUR" -movflags +faststart "$OUT.tmp.mp4" && mv "$OUT.tmp.mp4" "$OUT"
else
  node render.cjs "4x5$SUF" "$OUT" "$DUR" "music-$CUT.wav"
fi
