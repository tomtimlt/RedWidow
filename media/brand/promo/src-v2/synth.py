# Bande-son RedWidow promo V2 : techno sombre 120 BPM, calée sur le montage V2. numpy seul.
import numpy as np, wave, sys
SR = 48000
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 39.5
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(11)

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
def kick(g=1.0):
    t = tt(0.45); f = 48 + 110 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.5)
    s += 0.3 * np.exp(-t * 300) * rng.standard_normal(len(t))
    return np.tanh(s * 1.6) * g
def clap():
    t = tt(0.35); n = rng.standard_normal(len(t)); e = np.zeros(len(t))
    for o in (0, 0.011, 0.022, 0.034): e += (t >= o) * np.exp(-np.clip(t - o, 0, None) * (60 if o < 0.03 else 14))
    return hp(ma(n, 4), 40) * e * 0.45
def hat(open_=False):
    t = tt(0.25 if open_ else 0.06); n = hp(rng.standard_normal(len(t)), 4)
    return ma(n, 2) * np.exp(-t * (14 if open_ else 70)) * 0.18
def bass(f, d=0.12):
    t = tt(d); s = np.zeros(len(t))
    for k in range(1, 14): s += np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (10 + 9 * k))
    s *= np.minimum(1, t / 0.004) * np.exp(-t * 9)
    return np.tanh(s * 2.2) * 0.42
def boom(g=1.0, d=2.2):
    t = tt(d); f = 34 + 60 * np.exp(-t * 9)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    crack = ma(rng.standard_normal(len(t)), 8) * np.exp(-t * 18) * 0.8
    return np.tanh((s * 1.4 + crack) * 1.3) * g
def metal(g=0.5):
    t = tt(0.9); s = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((1180, 1), (1873, .7), (2711, .5), (3420, .35)))
    return (s * np.exp(-t * 7) + 0.5 * np.exp(-t * 400) * rng.standard_normal(len(t))) * g * 0.22
def lock():
    t = tt(0.12); return (np.sin(2 * np.pi * 2400 * t) + np.sin(2 * np.pi * 3600 * t)) * np.exp(-t * 60) * 0.18
def riser(d, g=0.6):
    t = tt(d); n = rng.standard_normal(len(t)); x = t / d
    bright = hp(n, 3) * x + ma(n, 12) * (1 - x)
    tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * x ** 2) / SR) * 0.25
    return (bright * 0.45 + tone) * x ** 2.2 * g
def tick(f=3200, g=0.12):
    t = tt(0.03); return np.sin(2 * np.pi * f * t) * np.exp(-t * 180) * g
def blip(f, g=0.2):
    t = tt(0.16); return np.sin(2 * np.pi * f * t + 2 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 30)) * np.exp(-t * 26) * g
def key():
    t = tt(0.025); return hp(rng.standard_normal(len(t)), 3) * np.exp(-t * 260) * 0.14
def whoosh(d=0.35, g=0.35):
    t = tt(d); x = t / d; n = rng.standard_normal(len(t))
    return (hp(n, 2) * x + ma(n, 20) * (1 - x)) * np.sin(np.pi * x) ** 2 * g
def drone(d, g=0.25, notes=(36.71, 55.0, 73.42)):
    t = tt(d); s = np.zeros(len(t))
    for f in notes:
        for det in (-0.6, 0.6):
            for k in range(1, 7): s += np.sin(2 * np.pi * k * (f + det) * t) / (k * k)
    return s * np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.6) * g * 0.18
def chatter(d, g=0.05):
    out = np.zeros(int(d * SR))
    for k in range(int(d * 40)):
        b = tick(2000 + rng.integers(0, 3000), g); i = int(k / 40 * SR)
        out[i:i + len(b)] += b[: len(out) - i]
    return out
BEAT = 0.5
NOTES = [73.42, 87.31, 65.41, 58.27]
def groove(a, b, dense=False, ref=4.0):
    t = a
    while t < b - 1e-6:
        beat = round((t - ref) / BEAT)
        add(kick(), t, 0.95)
        if beat % 2 == 1: add(clap(), t, 0.8, 0.05)
        add(hat(), t + 0.25, 0.9, -0.3)
        if dense: add(hat(), t + 0.125, 0.4, 0.3); add(hat(), t + 0.375, 0.4, 0.3)
        bar = int((t - ref) // 2.0) % 4
        for s16 in (1, 2, 3): add(bass(NOTES[bar]), t + s16 * 0.125, 0.9)
        if beat % 8 == 7: add(hat(True), t + 0.25, 0.6, 0.2)
        t += BEAT

# A — accroche (0–4) : demi-temps tendu, l'agent tape et lance ses outils
add(drone(4.2, 0.8), 0.0)
for x in (0.5, 1.5, 2.5): add(boom(0.85, 1.4), x); add(metal(0.45), x, 1, 0.1)
for x in np.arange(0.0, 4.0, 0.5): add(kick(0.45), x)
for k in range(32): add(hat(), k * 0.125, 0.3, 0.25 * ((-1) ** k))
for i in range(39): add(key(), 0.1 + i * (0.7 / 39), 1.0, (-1) ** i * 0.2)
add(whoosh(0.3, 0.45), 0.8); add(blip(700, 0.2), 0.95)
for i, x in enumerate((1.3, 1.6, 1.9, 2.2)): add(blip(880 * (1.12 ** i)), x, 1.1)
add(chatter(0.5), 3.0); add(riser(1.0, 0.85), 3.0)
# B — révélation (4) : drop
add(boom(1.15, 2.8), 4.0); add(metal(0.9), 4.0); add(lock(), 4.4, 1.2); add(chatter(0.6), 4.55)
groove(4.0, 21.0)
for k in range(int((21 - 10) / 0.125)):
    if k % 2: add(hat(), 10 + k * 0.125, 0.35, 0.35)
# C — Monitor
add(whoosh(0.4, 0.4), 6.3)
for k in range(24): add(tick(2600 + 40 * k, 0.07), 6.7 + k * 0.055)
add(chatter(0.5), 8.2)
# D — kill chain
add(whoosh(0.4, 0.4), 9.8)
for i, x in enumerate((10.45, 10.95, 11.45, 12.05, 12.55, 13.65, 14.75)): add(blip(520 * (1.12 ** i), 0.25), x, 1.0, 0.1 * ((-1) ** i))
for a, b in ((10.75, 11.45), (11.85, 12.55), (12.95, 13.65), (14.05, 14.75)):
    for k in range(int((b - a) * 8)): add(tick(1500, 0.06), a + k / 8, 1.0, 0.3 * ((-1) ** k))
add(chatter(0.6), 12.8); add(boom(0.55, 1.4), 14.9)
# E — plein auto, rapport
add(boom(0.8, 1.6), 16.5); add(metal(0.5), 16.5)
add(boom(0.5, 1.2), 18.5)
for i in range(4): add(blip(640 * (1.15 ** i), 0.2), 18.9 + i * 0.3)
add(riser(0.8, 0.3)[::-1].copy(), 20.2)
# F — coupure « Stuck on a box? » (21), Apprentissage
add(boom(1.0, 2.6), 21.0); add(metal(0.7), 21.0)
add(drone(6.2, 0.8, (36.71, 43.65, 55.0)), 21.0)
for x in np.arange(22.0, 27.0, 1.0): add(kick(0.5), x); add(kick(0.35), x + 0.22)
add(whoosh(0.4, 0.3), 22.3); add(blip(660, 0.15), 22.4)
for k in range(16): add(key(), 24.5 + k * 0.045)
add(blip(990, 0.25), 25.4); add(whoosh(0.5, 0.3), 26.0)
add(riser(1.0, 0.8), 26.0)
# retour du beat (27)
add(boom(1.0, 2.0), 27.0); add(metal(0.6), 27.0)
groove(27.0, 32.5, dense=True, ref=27.0)
add(riser(0.75, 0.5), 29.1)
for x in (30.6, 31.1, 31.6): add(boom(0.6, 0.9), x); add(metal(0.35), x)
add(riser(0.5, 0.6), 32.0)
# H — ALL OF THIS / OPEN SOURCE / FREE, signature
add(boom(0.9, 1.0), 32.5); add(boom(0.95, 1.0), 33.5); add(boom(1.2, 1.6), 34.5); add(metal(0.9), 34.5)
add(riser(0.9, 0.5), 34.6)
add(boom(1.1, 3.0), 35.5); add(metal(0.8), 35.5); add(lock(), 35.9, 1.2); add(chatter(0.6), 36.0)
add(drone(3.6, 0.7), 35.5)

mix = np.tanh(np.stack([L, R], 1) * 1.2)
fade = np.ones(N); fl = int(1.2 * SR); fade[-fl:] = np.linspace(1, 0, fl)
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) / 0.89
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', DUR)
