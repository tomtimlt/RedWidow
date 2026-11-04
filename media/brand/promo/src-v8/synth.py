# Bande-son RedWidow promo V8 « Weave. Watch. Strike. Wrap. » : sound design d'accroche, braam,
# groove darksynth au tempo de timeline.json (94 BPM), récapitulatif en frappes.
import numpy as np, wave, sys, json, os
H = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(H, 'timeline.json')))
BEAT = T['beat']; S16 = BEAT / 4; BAR = BEAT * 4
SR = 48000
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else T['end'] + 1.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(5)

def add(sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N or i < 0: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * (1 + min(0, pan))
def tt(d): return np.arange(int(d * SR)) / SR
def ma(x, k):
    k = max(1, int(k)); c = np.cumsum(np.concatenate([[0.0], x])); m = (c[k:] - c[:-k]) / k
    return np.concatenate([np.full(k // 2, m[0]), m, np.full(len(x) - len(m) - k // 2, m[-1])])
def hp(x, k): return x - ma(x, k)

def saw(f, t, nh=12, bright=1.0):
    s = np.zeros(len(t))
    for k in range(1, nh + 1):
        if k * f > 16000: break
        s += np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (k - 1) * (1.2 / max(bright, 0.05)))
    return s
def arp_note(f, bright, g=0.11, d=None):
    d = d or S16 * 1.6; t = tt(d)
    s = saw(f, t, 14, bright) * np.exp(-t * 14) * np.minimum(1, t / 0.003)
    return s * g
def bass_note(f, g=0.22):
    t = tt(BEAT / 2 * 0.95); s = saw(f, t, 10, 0.35) * np.minimum(1, t / 0.004) * np.exp(-t * 4)
    return np.tanh(s * 1.4) * g
def kick(g=0.6):
    t = tt(0.28); f = 52 + 120 * np.exp(-t * 35)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) + 0.25 * np.exp(-t * 300) * rng.standard_normal(len(t))
    return np.tanh(s * 1.5) * g
def snare(g=0.55):
    t = tt(0.42); n = rng.standard_normal(len(t))
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 28)
    tail = hp(ma(n, 2), 20) * np.exp(-t * 4.5) * (t < 0.33)  # réverbération coupée net
    hit = hp(n, 5) * np.exp(-t * 40)
    return np.tanh((body * 0.7 + tail * 0.55 + hit * 0.6) * 1.3) * g
def hat(g=0.08, d=0.045):
    t = tt(d); return hp(rng.standard_normal(len(t)), 3) * np.exp(-t * (4 / d)) * g
def ohat(g=0.07):
    t = tt(0.28); return hp(rng.standard_normal(len(t)), 3) * np.exp(-t * 10) * g
def pad(freqs, d, g=0.16, att=0.6):
    t = tt(d); s = np.zeros(len(t))
    for f in freqs:
        for det in (-0.4, 0.0, 0.4):
            s += saw(f * (1 + det / 100), t, 8, 0.5)
    env = np.minimum(1, t / att) * np.minimum(1, np.maximum(0, (d - t)) / 0.5)
    return ma(s, 4) * env * g * 0.05
def lead(f, d, g=0.12):
    t = tt(d); vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.3)
    s = saw(f, t * vib, 10, 0.6) + 0.5 * saw(f * 1.005, t, 10, 0.6)
    env = np.minimum(1, t / 0.02) * np.exp(-t * 0.9) * np.minimum(1, np.maximum(0, (d - t)) / 0.1)
    return s * env * g
def impact(g=0.7, d=1.6):
    t = tt(d); f = 60 + 70 * np.exp(-t * 10)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.5) * 0.5
    noise = ma(rng.standard_normal(len(t)), 6) * np.exp(-t * 6) * 0.8
    shimmer = hp(rng.standard_normal(len(t)), 2) * np.exp(-t * 2.5) * 0.25
    return np.tanh((s + noise + shimmer) * 1.2) * g
def riser(d, g=0.5):
    t = tt(d); x = t / d; n = rng.standard_normal(len(t))
    noise = hp(n, 2) * x ** 1.5 + ma(n, 10) * (1 - x)
    tone = np.sin(2 * np.pi * np.cumsum(220 + 1200 * x ** 2) / SR) * 0.25
    return (noise * 0.35 + tone) * x ** 2 * g
def glitch(g=0.16):
    t = tt(0.12); s = np.sign(np.sin(2 * np.pi * 1800 * t * (1 + 3 * t))) * (np.sin(2 * np.pi * 60 * t) > 0)
    return s * np.exp(-t * 20) * g
def tick(f=3000, g=0.07):
    t = tt(0.03); return np.sin(2 * np.pi * f * t) * np.exp(-t * 180) * g
def blip(f, g=0.14):
    t = tt(0.22); return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t * 16) * g
def key(g=0.11):
    t = tt(0.025); return hp(rng.standard_normal(len(t)), 3) * np.exp(-t * 240) * g
def chatter(d, g=0.035):
    out = np.zeros(int(d * SR))
    for k in range(int(d * 34)):
        b = tick(1800 + rng.integers(0, 2600), g); i = int(k / 34 * SR)
        out[i:i + len(b)] += b[: len(out) - i]
    return out


# --- instruments de la V8 ---
def braam(d=2.6, g=0.5, root=55.0):
    t = tt(d); s = np.zeros(len(t))
    for f, a in ((root, 0.5), (root * 2, 0.8), (root * 3, 0.5), (root * 4, 0.38), (root * 6, 0.22)):
        for det in (-0.7, 0.0, 0.7):
            s += a * saw(f * (1 + det / 100), t, 16, 0.8)
    env = np.minimum(1, t / 0.025) * np.exp(-t * 1.15) * np.minimum(1, np.maximum(0, d - t) / 0.3)
    s = np.tanh(s * env * 0.9)
    dark = ma(s, 20); k = np.minimum(1, t / 0.8)
    return (s * (1 - k) + dark * k) * g
def subdrop(g=0.3, d=1.5):
    t = tt(d); f = 32 + 70 * np.exp(-t * 3)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.7) * np.minimum(1, t / 0.01) * g
def drone(d, g=0.12):
    t = tt(d); lfo = 1 + 0.25 * np.sin(2 * np.pi * 0.35 * t)
    s = np.sin(2 * np.pi * 110 * t) + 0.5 * np.sin(2 * np.pi * 110.4 * t) + 0.35 * saw(55, t, 6, 2.0) + 0.2 * np.sin(2 * np.pi * 164.8 * t)
    return s * lfo * np.minimum(1, t / max(0.1, d * 0.8)) * g
def heart(g=0.34):
    out = np.zeros(int(0.5 * SR)); a = kick(g); b = kick(g * 0.7); j = int(0.17 * SR)
    out[:len(a)] += a; out[j:j + len(b)] += b[: len(out) - j]
    return out
def pluck(f, g=0.05):
    t = tt(0.6); s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3.01 * f * t)
    return s * np.exp(-t * 6) * np.minimum(1, t / 0.002) * g
def zip_down(d, g=0.12):
    t = tt(d); x = t / d; f = 1500 * np.exp(-x * 1.9) + 240
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.65 + 0.35 * np.sin(2 * np.pi * 26 * t))
    n = hp(rng.standard_normal(len(t)), 2) * (1 - x) * 0.35
    return (s * 0.5 + n) * np.minimum(1, t / 0.04) * (1 - 0.5 * x) * g
def wobble(g=0.12):
    t = tt(0.9); f = 196 * (1 + 0.035 * np.sin(2 * np.pi * 7 * t) * np.exp(-t * 3))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.8) * g
def shimmer(d, g=0.035):
    t = tt(d); return (np.sin(2 * np.pi * 1318.5 * t) + np.sin(2 * np.pi * 1322.0 * t)) * np.minimum(1, t / max(0.05, d)) * g
def ping(g=0.08):
    t = tt(0.5); return (np.sin(2 * np.pi * 1760 * t) + 0.6 * np.sin(2 * np.pi * 2637 * t)) * np.exp(-t * 10) * g
def taiko(g=0.7):
    t = tt(0.9); f = 50 + 75 * np.exp(-t * 18)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5) + ma(rng.standard_normal(len(t)), 3) * np.exp(-t * 25) * 0.6
    return np.tanh(s * 1.6) * g

# grille d'accords (la mineur) : la m, fa, do, sol
CH = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (130.81, 164.81, 196.0), (196.0, 246.94, 293.66)]
ROOT = [55.0 * 2, 43.65 * 2, 65.41, 49.0 * 2]
duck = np.ones(N)
def section(a, b, drums=True, bass=True, arp=True, brightness=(0.4, 1.0), hats16=False):
    t = a; bar_i = 0
    while t < b - 1e-6:
        ch = CH[bar_i % 4]; root = ROOT[bar_i % 4]
        for s in range(16):
            ts = t + s * S16
            if ts >= b: break
            br = brightness[0] + (brightness[1] - brightness[0]) * (ts - a) / max(1e-6, b - a)
            if arp:
                seq = [ch[0], ch[2], ch[1], ch[2], ch[0] * 2, ch[2], ch[1], ch[2]]
                add(arp_note(seq[s % 8], br), ts, 1.0, 0.25 * ((-1) ** s))
            if drums:
                if s % 4 == 0:
                    add(kick(), ts)
                    i = int(ts * SR); n = min(N - i, int(0.18 * SR))
                    if n > 0: duck[i:i + n] = np.minimum(duck[i:i + n], 0.45 + 0.55 * np.linspace(0, 1, n))
                if s in (4, 12): add(snare(), ts, 1.0, 0.04)
                if hats16 or s % 2 == 0: add(hat(0.07 if s % 4 == 2 else 0.045), ts, 1.0, -0.2)
                if s == 14: add(ohat(), ts, 1.0, 0.2)
            if bass and s % 2 == 0:
                add(bass_note(root), ts, 1.0)
        add(pad(ch, BAR + 0.2, 0.9 if not drums else 0.6), t)
        t += BAR; bar_i += 1

# 0 — accroche : la cible (cœur), les mots, la toile (fils de soie), la descente, le verrouillage
add(drone(T['hush']), 0)
add(impact(0.32, 1.0), 0); add(blip(880, 0.1), 0)
for x in (0, 2, 4): add(heart(), x * BEAT)
for k in ('h1', 'h2'): add(taiko(0.3), T[k]); add(tick(2600, 0.05), T[k])
add(impact(0.55, 1.6), T['h3']); add(glitch(0.1), T['h3'])
PENTA = [440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0]
for i in range(4): add(pluck(PENTA[i] / 2, 0.06), T['h3'] + i * 0.06, 1.0, (-1) ** i * 0.4)
for i in range(12): add(pluck(PENTA[i], 0.045), T['h3'] + 0.3 + i * 0.075, 1.0, (-1) ** i * 0.5)
add(riser(T['hush'] - T['h3'], 0.42), T['h3'])
add(zip_down(T['land'] - T['thread']), T['thread'])
add(wobble(), T['land']); add(kick(0.28), T['land'])
add(shimmer(T['hush'] - T['eyes']), T['eyes'])
add(tick(4200, 0.13), T['lockon']); add(tick(3400, 0.12), T['lockon'] + 0.06); add(ping(), T['lockon'] + 0.06)
# révélation : braam, sub drop, frappe ; la veuve se présente sur un arpège filtré
add(braam(3.0, 0.5), T['reveal']); add(subdrop(), T['reveal']); add(impact(0.9, 2.2), T['reveal']); add(glitch(), T['reveal'])
add(lead(440.0, BAR * 1.0, 0.07), T['reveal'] + BEAT); add(lead(659.25, BAR * 1.0, 0.05), T['reveal'] + BEAT)
section(T['reveal'] + BEAT, T['ch1'], drums=False, bass=False, brightness=(0.2, 0.6))
for x in np.arange(T['reveal'] + 2 * BEAT, T['ch1'] - 0.01, 2 * BEAT): add(heart(0.26), x)
add(riser(BAR * 0.75, 0.4), T['ch1'] - BAR * 0.75)
# chapitres : le groove tombe à 01 WEAVE ; chaque carton = souffle, braam court, frappe
section(T['ch1'], T['ch5'], drums=True, bass=True, brightness=(0.7, 1.0))
ROOTS = [55.0, 43.65, 65.41, 49.0]
for i, c in enumerate((T['ch1'], T['ch2'], T['ch3'], T['ch4'])):
    add(riser(0.42, 0.3), c - 0.42); add(impact(0.6, 1.4), c); add(braam(1.5, 0.26, ROOTS[i]), c); add(glitch(), c)
# Recon : prompt, outils
for i in range(39): add(key(0.09), T['type0'] + i * ((T['type1'] - T['type0']) / 39), 1.0, (-1) ** i * 0.2)
for i in range(4): add(blip(440 * (1.12 ** i)), T['tools'] + i * BEAT * 0.75)
for k in range(24): add(tick(2400 + 35 * k, 0.045), T['mon'] + 0.15 + k * 0.07)
# Watch : étapes, puis rejeu
for i, x in enumerate([0.3, 1.1, 1.8, 2.5, 3.1, 3.8, 4.4]): add(blip(392 * (1.12 ** i), 0.13), T['kc'] + x * BEAT, 1.0, 0.1 * ((-1) ** i))
for i in range(5): add(blip(523 * (1.19 ** i), 0.16), T['replay'] + 0.5 + i * BEAT); add(tick(3600, 0.08), T['replay'] + 0.5 + i * BEAT)
# Strike : « Or unleash it » — montée, braam, mélodie
add(riser(BAR * 0.5, 0.35), T['unleash'] - BAR * 0.5)
add(impact(0.75, 1.6), T['unleash']); add(glitch(0.2), T['unleash']); add(braam(1.8, 0.3), T['unleash'])
mel = [(0, 659.25, 2), (2, 587.33, 2), (4, 523.25, 3), (7, 493.88, 1), (8, 440.0, 4)]
for b0, f, ln in mel: add(lead(f, ln * BEAT, 0.085), T['unleash'] + b0 * BEAT, 1.0, 0.1)
# Wrap : le rapport
for i in range(4): add(blip(587 * (1.12 ** i), 0.12), T['report'] + 0.55 + i * BEAT * 0.6)
# Learn : respiration, retour du battement de cœur de l'accroche
add(impact(0.6, 2.0), T['ch5']); add(glitch(), T['ch5'])
section(T['ch5'], T['models'], drums=False, bass=False, brightness=(0.35, 0.6))
for x in np.arange(T['learn'], T['models'] - 0.01, BEAT * 2): add(heart(0.24), x)
for k in range(16): add(key(0.08), T['hint'] + k * 0.045)
add(blip(784, 0.14), T['hint'] + 0.9); add(blip(988, 0.16), T['hint'] + 2.2 * BEAT)
add(riser(BAR, 0.45), T['models'] - BAR)
# Modèles : groove plein, double croches
section(T['models'], T['r1'], drums=True, bass=True, brightness=(0.9, 1.0), hats16=True)
for x in (T['m1'], T['m2'], T['m3']): add(impact(0.45, 1.0), x); add(lead(880.0 if x == T['m3'] else 659.25, BEAT * 1.5, 0.07), x)
add(riser(BEAT * 1.4, 0.4), T['r1'] - BEAT * 1.4)
# Récapitulatif : quatre frappes Am-F-C-G, une par verbe
for i, k in enumerate(('r1', 'r2', 'r3', 'r4')):
    add(taiko(0.55), T[k]); add(braam(BEAT * 1.05, 0.3, ROOTS[i]), T[k]); add(snare(0.45), T[k])
    add(pad(CH[i], BEAT * 1.0, 0.9, 0.02), T[k])
add(glitch(0.2), T['r3']); add(impact(0.6, 1.2), T['r3'])
# Fin : groove plein sous « All of it. Open source. Free. », puis la signature
section(T['all'], T['lock'], drums=True, bass=True, brightness=(0.85, 1.0), hats16=True)
for x in (T['all'], T['oss'], T['free']): add(impact(0.7 if x != T['free'] else 0.95, 1.4), x); add(snare(0.55), x)
add(glitch(0.2), T['free']); add(riser(T['lock'] - T['free'] - 0.05, 0.4), T['free'] + 0.05)
add(braam(3.2, 0.45), T['lock']); add(subdrop(0.25), T['lock']); add(impact(0.9, 3.0), T['lock']); add(glitch(), T['lock'])
add(chatter(0.7), T['lock'] + BEAT * 2)
add(pad(CH[0], DUR - T['lock'], 1.0, 0.3), T['lock'])
add(lead(440.0, BAR * 1.5, 0.08), T['lock']); add(lead(329.63, BAR * 1.5, 0.06), T['lock'])

L *= duck * 0 + np.where(duck < 1, 0.85 + 0.15 * duck, 1.0)
R *= np.where(duck < 1, 0.85 + 0.15 * duck, 1.0)
# passe-haut ≈ 60 Hz pour garder des basses contenues
L[:] = hp(L, 360); R[:] = hp(R, 360)
i0, i1, fd = int(T['hush'] * SR), int(T['reveal'] * SR), int(0.012 * SR)
gate = np.ones(N); gate[i0:i1] = 0.0; gate[i0 - fd:i0] = np.linspace(1, 0, fd)
L *= gate; R *= gate
mix = np.tanh(np.stack([L, R], 1) * 1.0)
fade = np.ones(N); fl = int(1.6 * SR); fade[-fl:] = np.linspace(1, 0, fl)
mix *= (fade * np.minimum(1, np.arange(N) / (0.2 * SR)))[:, None]
mix /= np.max(np.abs(mix)) / 0.89
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', DUR)
