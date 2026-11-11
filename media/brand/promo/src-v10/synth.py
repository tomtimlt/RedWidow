# Bande-son RedWidow promo V10 (94 BPM) : la musique démarre à la première image, un impact par outil
# de l'accroche, une demi-seconde de silence avant le logo, groove darksynth sur les cinq temps,
# montée finale qui ramène à la première image (LinkedIn rejoue la vidéo en boucle).
# Usage : python3 synth.py sortie.wav [a|15s|b]   (lit timeline[-15s|-b].json écrit par build.py)
# Les instruments sont ceux de la V8 (../src-v8/synth.py, partie haute du fichier).
import os, sys
H = os.path.dirname(os.path.abspath(__file__))
CUT = sys.argv[2] if len(sys.argv) > 2 else 'a'
TLFILE = 'timeline.json' if CUT == 'a' else f'timeline-{CUT}.json'
src = open(os.path.join(H, '..', 'src-v8', 'synth.py')).read()
src = src[:src.index('# 0 — accroche')].replace("'timeline.json'", repr(TLFILE))
import json
END = json.load(open(os.path.join(H, TLFILE)))['end']
G = {'__file__': os.path.join(H, 'synth.py'), '__name__': 'v8'}
argv = sys.argv; sys.argv = [argv[0], argv[1], str(END)]
exec(compile(src, 'src-v8/synth.py', 'exec'), G)
sys.argv = argv
globals().update({k: v for k, v in G.items() if not k.startswith('__')})

has = lambda k: T.get(k, 9e9) < 5000
def cue(k, fn):
    if has(k): fn(T[k])

# --- accroche : groove dès la première image, un impact par outil -------------------------------
section(0, T['hush'], drums=True, bass=True, arp=True, brightness=(0.35, 0.8))
add(impact(0.5, 1.2), 0); add(drone(T['hush'], 0.07), 0)
for i, k in enumerate(('t1', 't2', 't3', 't4')):
    cue(k, lambda x, i=i: (add(impact(0.42, 0.9), x), add(blip(440 * 1.12 ** i, 0.16), x), add(tick(3000, 0.07), x)))
cue('card', lambda x: (add(taiko(0.5), x), add(impact(0.6, 1.2), x), add(blip(330, 0.14), x)))
cue('allow', lambda x: (add(tick(4200, 0.13), x), add(ping(0.09), x + 0.05)))
cue('win', lambda x: (add(impact(0.65, 1.2), x), add(blip(880, 0.16), x), add(blip(1318.5, 0.1), x + 0.09)))
if has('cb'):  # accroche B : fin du rejeu, puis la consigne tapée
    r0 = T['replayb'] + BEAT
    for i in range(6):
        x = r0 + i * BEAT
        if x >= 0: add(blip(523 * 1.19 ** min(i, 5), 0.16), x); add(tick(3600, 0.08), x)
    add(impact(0.6, 1.2), T['cb'])
    for i in range(30): add(key(0.09), T['type0'] + i * ((T['type1'] - T['type0']) / 30), 1.0, (-1) ** i * 0.2)
    for i, k in enumerate(('bt1', 'bt2', 'bt3')): add(impact(0.38, 0.8), T[k]); add(blip(440 * 1.12 ** i, 0.15), T[k])
add(riser(T['hush'] - T['hush'] * 0.72, 0.3), T['hush'] * 0.72)

# --- logo : braam et sub drop après le silence --------------------------------------------------
rv = T['reveal']
add(braam(2.4, 0.5), rv); add(subdrop(), rv); add(impact(0.9, 2.0), rv)
body0 = rv + 2 * BEAT
add(lead(440.0, BEAT * 1.8, 0.07), rv + 0.02); add(heart(0.26), rv + BEAT)

# --- les temps du film : groove plein, respiration sur l'Apprentissage --------------------------
lock = T['lock']
calm0, calm1 = (T['learn'], T['models']) if has('learn') else (lock, lock)
section(body0, calm0, drums=True, bass=True, brightness=(0.7, 1.0))
if has('learn'):
    section(calm0, calm1, drums=False, bass=False, brightness=(0.35, 0.6))
    for x in np.arange(calm0, calm1 - 0.01, BEAT * 2): add(heart(0.24), x)
    add(riser(BAR * 0.75, 0.4), calm1 - BAR * 0.75)
    section(calm1, lock, drums=True, bass=True, brightness=(0.9, 1.0), hats16=True)
ROOTS = [55.0, 43.65, 65.41, 49.0]
for i, k in enumerate(('mon', 'kc', 'drive', 'report', 'learn')):
    cue(k, lambda x, i=i: (add(riser(0.4, 0.28), x - 0.4), add(impact(0.6, 1.3), x), add(braam(1.3, 0.22, ROOTS[i % 4]), x)))
for k in ('replay', 'hint', 'cut2'):
    cue(k, lambda x: add(impact(0.45, 1.0), x))
# Monitor : lignes qui défilent
cue('mon', lambda x: [add(tick(2400 + 35 * k, 0.04), x + 2 * BEAT + 0.1 + k * 0.09) for k in range(18)])
# kill chain : un blip par étape ajoutée, puis par étape rejouée
if has('kc') and T['kc'] > 0:
    for i, b in enumerate([0.2, 0.8, 1.3, 1.9, 2.4, 2.9, 3.4]): add(blip(392 * 1.12 ** i, 0.13), T['kc'] + b * BEAT, 1.0, 0.1 * (-1) ** i)
if has('replay'):
    step = BEAT * T['step']; r0 = T['replay'] + BEAT * (1 if T['step'] == 1 else 0.4)
    for i in range(6): add(blip(523 * 1.19 ** min(i, 5), 0.16 if i < 5 else 0.22), r0 + i * step); add(tick(3600, 0.08), r0 + i * step)
    add(ping(0.1), r0 + 5 * step)
# Strike : la carte (trois boutons), puis le mode Auto
cue('drive', lambda x: [add(tick(3000 + 300 * k, 0.09), x + (1 + k) * BEAT) for k in range(3)])
def unleash(x):
    add(riser(BEAT * 1.5, 0.35), x - BEAT * 1.5); add(impact(0.8, 1.6), x); add(braam(1.8, 0.32), x)
    for b0, f, ln in [(0, 659.25, 2), (2, 587.33, 2)]: add(lead(f, ln * BEAT, 0.085), x + b0 * BEAT, 1.0, 0.1)
cue('unleash', unleash)
cue('report', lambda x: [add(blip(587 * 1.12 ** i, 0.12), x + 0.4 + i * BEAT * 0.6) for i in range(4)])
cue('hint', lambda x: (add(blip(784, 0.14), x + 0.6), add(blip(988, 0.16), x + 1.5 * BEAT)))
# modèles : un impact par nom ; fin : Tout ça. / Open source. / Gratuit.
cue('models', lambda x: [(add(impact(0.5, 1.0), x + i * BEAT), add(lead(880.0 if i == 2 else 659.25, BEAT * 1.2, 0.07), x + i * BEAT)) for i in range(3)])
for k in ('all', 'oss', 'free'):
    cue(k, lambda x, k=k: (add(impact(0.95 if k == 'free' else 0.7, 1.4), x), add(snare(0.55), x)))
add(riser(BEAT * 1.6, 0.4), lock - BEAT * 1.6)
# signature, puis montée qui ramène à la première image
add(braam(3.0, 0.45), lock); add(subdrop(0.25), lock); add(impact(0.9, 2.6), lock)
add(pad(CH[0], T['end'] - lock, 1.0, 0.3), lock)
add(lead(440.0, BAR * 1.2, 0.08), lock); add(lead(329.63, BAR * 1.2, 0.06), lock)
for x in np.arange(lock + 2 * BEAT, T['end'] - 0.01, BEAT): add(heart(0.22), x)
add(riser(BEAT * 2, 0.45), T['end'] - BEAT * 2)

duckg = np.where(duck < 1, 0.85 + 0.15 * duck, 1.0)
L *= duckg; R *= duckg
L[:] = hp(L, 360); R[:] = hp(R, 360)          # passe-haut ≈ 60 Hz : basses tenues
i0, i1, fd = int(T['hush'] * SR), int(rv * SR), int(0.012 * SR)
gate = np.ones(N); gate[i0:i1] = 0.0; gate[i0 - fd:i0] = np.linspace(1, 0, fd)   # le silence avant le logo
fo = int(0.008 * SR); gate[i1:i1 + fo] = np.linspace(0, 1, fo)                    # réouverture en 8 ms (pas de claquement à l'encodage)
L *= gate; R *= gate
mix = np.tanh(np.stack([L, R], 1))
fade = np.ones(N); fl = int(0.06 * SR); fade[-fl:] = np.linspace(1, 0, fl); fade[:int(0.004 * SR)] = np.linspace(0, 1, int(0.004 * SR))
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) / 0.89
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
# part de l'énergie sous 80 Hz (repère : environ 5 %)
m = mix.mean(1); S = np.abs(np.fft.rfft(m)) ** 2; f = np.fft.rfftfreq(len(m), 1 / SR)
print('ok', CUT, round(END, 2), 's · énergie < 80 Hz :', round(100 * S[f < 80].sum() / S.sum(), 1), '%')
