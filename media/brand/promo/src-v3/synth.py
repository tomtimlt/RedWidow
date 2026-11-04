# Bande-son RedWidow promo V3 : intro qui respire, puis trap industrielle en demi-tempo
# (120 BPM, caisse claire sur le 3, 808 qui glissent, rafales de charleston). numpy seul.
import numpy as np, wave, sys
SR = 48000
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 42.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(23)

def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N or i < 0: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * (1 + min(0, pan))
def tt(d): return np.arange(int(d * SR)) / SR
def ma(x, k):
    k = max(1, int(k)); return np.convolve(x, np.ones(k) / k, mode='same')
def hp(x, k): return x - ma(x, k)
def lp(x, k): return ma(ma(x, k), k)

# — instruments —
def k808(f0=49.0, d=1.1, g=1.0, glide=None):
    t = tt(d)
    f = f0 + 90 * np.exp(-t * 40)
    if glide: f = f + (glide - f0) * np.clip((t - 0.25) / 0.25, 0, 1)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (2.0 / d))
    s += 0.25 * np.exp(-t * 400) * rng.standard_normal(len(t))
    return np.tanh(s * 2.4) * g * 0.8
def snare(g=1.0):
    t = tt(0.4); n = rng.standard_normal(len(t))
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.6
    noise = hp(lp(n, 2), 30) * np.exp(-t * 13)
    clap = np.zeros(len(t))
    for o in (0.0, 0.009, 0.019): clap += (t >= o) * np.exp(-np.clip(t - o, 0, None) * 90)
    return np.tanh((body + noise * 0.8 + hp(n, 6) * clap * 0.5) * 1.4) * g * 0.5
def hat(g=0.16, d=0.05):
    t = tt(d); return hp(rng.standard_normal(len(t)), 3) * np.exp(-t * (4 / d)) * g
def ohat(g=0.12):
    t = tt(0.3); return hp(rng.standard_normal(len(t)), 3) * np.exp(-t * 11) * g
def rim(g=0.18):
    t = tt(0.08); return (np.sin(2 * np.pi * 1700 * t) + 0.6 * hp(rng.standard_normal(len(t)), 3)) * np.exp(-t * 70) * g
def pad(notes, d, g=0.2, att=0.8):
    t = tt(d); s = np.zeros(len(t))
    for f in notes:
        for det in (-0.35, 0.0, 0.35):
            for k in range(1, 9): s += np.sin(2 * np.pi * k * (f * (1 + det / 100)) * t + k) / (k ** 1.6)
    env = np.minimum(1, t / att) * np.minimum(1, (d - t) / 0.6)
    return lp(s, 6) * env * g * 0.06
def sub_pulse(g=0.5):
    t = tt(0.5); return np.sin(2 * np.pi * 46 * t) * np.exp(-t * 9) * np.minimum(1, t / 0.01) * g
def boom(g=1.0, d=2.4):
    t = tt(d); f = 30 + 55 * np.exp(-t * 8)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.8)
    crack = lp(rng.standard_normal(len(t)), 5) * np.exp(-t * 16) * 0.7
    return np.tanh((s * 1.5 + crack) * 1.3) * g
def metal(g=0.4):
    t = tt(1.2); s = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((523, 1), (1110, .6), (1661, .45), (2489, .3)))
    return s * np.exp(-t * 4) * g * 0.18
def riser(d, g=0.6):
    t = tt(d); x = t / d; n = rng.standard_normal(len(t))
    noise = hp(n, 2) * x ** 1.5 + lp(n, 10) * (1 - x)
    tone = np.sin(2 * np.pi * np.cumsum(110 + 880 * x ** 2) / SR) * 0.3
    return (noise * 0.4 + tone) * x ** 2 * g
def rev(d, g=0.5):
    return riser(d, g)
def tick(f=3000, g=0.08):
    t = tt(0.03); return np.sin(2 * np.pi * f * t) * np.exp(-t * 180) * g
def blip(f, g=0.18):
    t = tt(0.2); return np.sin(2 * np.pi * f * t) * np.exp(-t * 18) * g
def key(g=0.12):
    t = tt(0.025); return hp(rng.standard_normal(len(t)), 3) * np.exp(-t * 240) * g
def whoosh(d=0.4, g=0.3):
    t = tt(d); x = t / d; n = rng.standard_normal(len(t))
    return (hp(n, 2) * x + lp(n, 12) * (1 - x)) * np.sin(np.pi * x) ** 2 * g
def pluck(f, g=0.12):
    t = tt(0.35); s = sum(np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (8 + 6 * k)) for k in range(1, 6))
    return s * g
def chatter(d, g=0.04):
    out = np.zeros(int(d * SR))
    for k in range(int(d * 36)):
        b = tick(1800 + rng.integers(0, 2600), g); i = int(k / 36 * SR)
        out[i:i + len(b)] += b[: len(out) - i]
    return out

A1, C2, D2, F1, G1, E2 = 55.0, 65.41, 73.42, 43.65, 49.0, 82.41
CH = [(110.0, 130.81, 164.81), (87.31, 110.0, 130.81), (73.42, 87.31, 110.0), (82.41, 98.0, 123.47)]  # la m, fa, ré m, mi m
BASS = [A1, F1, D2 / 2 * 1.0 + 0.0 if False else 36.71 * 1.5, 41.2]  # la, fa, ré (55), mi (41)
BASS = [55.0, 43.65, 36.71 * 1.5, 41.2]

def trap(a, b, ref, dense=False):
    bar_len = 2.0
    t = a
    while t < b - 1e-6:
        bar = int(round((t - ref) / bar_len))
        root = BASS[bar % 4]
        # 808 : 1, puis « 1-et-a » et le 4 et
        add(k808(root, 0.9), t, 1.0)
        add(k808(root, 0.5), t + 0.75, 0.85)
        if bar % 2 == 1: add(k808(root, 0.45, glide=root * 1.5), t + 1.375, 0.8)
        add(snare(), t + 1.0, 1.0, 0.05)
        if dense and bar % 2 == 1: add(snare(0.45), t + 1.875, 1.0, 0.05)
        # charlestons en croches, rafales en fin de mesure
        for s in range(8):
            add(hat(), t + s * 0.25, 0.9 if s % 2 else 0.6, -0.25)
        roll = 12 if bar % 2 == 1 else (14 if dense else 16)
        for k in range(roll, 16):
            for q in (0, 1):
                add(hat(0.1, 0.03), t + k * 0.125 + q * 0.0625, 1.0, 0.25)
        if bar % 4 == 3: add(ohat(), t + 1.5, 1.0, 0.2)
        if bar % 2 == 0: add(rim(), t + 1.625, 1.0, -0.15)
        t += bar_len

# A — ouverture qui respire (0–6.5)
add(pad(CH[0], 6.6, 0.9, att=2.2), 0.0)
add(sub_pulse(0.35), 1.0); add(sub_pulse(0.25), 1.25)
add(sub_pulse(0.4), 2.0); add(sub_pulse(0.28), 2.25)
for i in range(39): add(key(), 1.2 + i * (1.5 / 39), 1.0, (-1) ** i * 0.2)
add(whoosh(0.35, 0.3), 2.75); add(blip(660, 0.15), 2.8)
add(sub_pulse(0.5), 3.0); add(sub_pulse(0.35), 3.25); add(sub_pulse(0.55), 4.0); add(sub_pulse(0.4), 4.25)
for k in range(int((6.35 - 3.0) / 0.25)): add(hat(0.06 + 0.012 * k, 0.04), 3.0 + k * 0.25, 1.0, 0.2)
for i, x in enumerate((3.6, 4.0, 4.4, 4.8)): add(blip(440 * (1.12 ** i), 0.16), x)
add(boom(0.6, 1.6), 4.4); add(metal(0.4), 4.4)
add(sub_pulse(0.6), 5.0); add(sub_pulse(0.45), 5.25); add(sub_pulse(0.65), 5.5); add(sub_pulse(0.5), 5.75); add(sub_pulse(0.7), 6.0)
add(chatter(0.6), 5.3); add(riser(1.25, 0.75), 5.1)
# silence avant la révélation : 6.35–6.5
cut = slice(int(6.36 * SR), int(6.5 * SR)); L[cut] *= 0.05; R[cut] *= 0.05
# B — révélation (6.5) : chute et premier groove
add(boom(1.15, 3.0), 6.5); add(metal(0.8), 6.5); add(snare(0.9), 6.5)
add(chatter(0.6), 7.05)
add(pad(CH[0], 17.0, 0.5, att=0.4), 6.5)
trap(6.5, 23.5, ref=6.5)
# C — Monitor
add(whoosh(0.4, 0.35), 8.8)
for k in range(24): add(tick(2400 + 35 * k, 0.05), 9.2 + k * 0.055)
add(chatter(0.5), 10.7)
# D — kill chain : arpège « araignée » en doubles croches
add(whoosh(0.4, 0.35), 12.3)
arp = [220.0, 261.63, 329.63, 261.63, 220.0, 196.0, 220.0, 329.63]
for k in range(int((19.0 - 12.5) / 0.125)): add(pluck(arp[k % 8], 0.08), 12.5 + k * 0.125, 1.0, 0.3 * ((-1) ** k))
for i, x in enumerate((12.95, 13.45, 13.95, 14.55, 15.05, 16.15, 17.25)): add(blip(392 * (1.12 ** i), 0.18), x, 1.0, 0.1 * ((-1) ** i))
add(chatter(0.6), 15.3); add(boom(0.5, 1.4), 17.4)
# E — plein auto, rapport
add(boom(0.75, 1.8), 19.0); add(metal(0.45), 19.0)
add(boom(0.45, 1.2), 21.0)
for i in range(4): add(blip(523 * (1.15 ** i), 0.16), 21.4 + i * 0.3)
add(rev(0.9, 0.35), 22.6)
# F — « Stuck on a box? » : coupure, respiration
add(boom(1.0, 2.8), 23.5); add(metal(0.6), 23.5)
add(pad(CH[2], 6.2, 0.9, att=0.3), 23.5)
for x in np.arange(24.5, 29.5, 1.0): add(sub_pulse(0.5), x); add(sub_pulse(0.35), x + 0.25)
add(whoosh(0.4, 0.25), 24.8); add(blip(587, 0.14), 24.9)
for k in range(16): add(key(0.1), 27.0 + k * 0.045)
add(blip(784, 0.18), 27.9); add(blip(988, 0.2), 28.4)
add(riser(1.0, 0.75), 28.5)
cut = slice(int(29.38 * SR), int(29.5 * SR)); L[cut] *= 0.05; R[cut] *= 0.05
# retour (29.5) : groove plus dense
add(boom(1.0, 2.0), 29.5); add(metal(0.5), 29.5)
add(pad(CH[3], 5.6, 0.5, att=0.3), 29.5)
trap(29.5, 35.0, ref=29.5, dense=True)
add(riser(0.75, 0.45), 31.6)
for x in (33.1, 33.6, 34.1): add(boom(0.55, 0.9), x); add(metal(0.3), x)
# H — ALL OF THIS / OPEN SOURCE / FREE, signature
add(boom(0.85, 1.0), 35.0); add(snare(0.7), 35.0)
add(boom(0.9, 1.0), 36.0); add(snare(0.75), 36.0)
add(boom(1.2, 1.8), 37.0); add(metal(0.8), 37.0); add(snare(0.9), 37.0)
add(riser(0.9, 0.45), 37.1)
add(boom(1.1, 3.4), 38.0); add(metal(0.7), 38.0); add(chatter(0.6), 38.5)
add(pad(CH[0], 4.0, 0.7, att=0.2), 38.0)

mix = np.tanh(np.stack([L, R], 1) * 1.1)
fade = np.ones(N); fl = int(1.4 * SR); fade[-fl:] = np.linspace(1, 0, fl)
fin = np.minimum(1, np.arange(N) / (0.25 * SR))
mix *= (fade * fin)[:, None]
mix /= np.max(np.abs(mix)) / 0.89
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', DUR)
