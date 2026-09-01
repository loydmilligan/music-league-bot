#!/usr/bin/env python3
"""
process.py — the voice-lab DSP chain.

The point of this file is that **articulation and pausing are separate knobs**.
`atempo` on a whole clip scales the words and the gaps together, so matching the
rhythm of a reference always ends up rushing the syllables. Here the clip is cut
into speech runs and silences first; `artic` retimes only the speech, `pause`
only the gaps.

The other useful separation is pitch vs. formants. asetrate moves both (the
chipmunk effect); rubberband can move one and hold the other, so "higher voice"
and "smaller head" become independent.

Usage:
  process.py --src in.wav --out out.mp3 [--json '{"pitch":1.0,...}']

Params (all optional, defaults = passthrough):
  pitch      pitch scale factor, formants preserved   (1.0 = unchanged)
  formant    vocal-tract scale; <1 bigger/darker, >1 smaller/nasal
  artic      articulation rate — speed of the words only
  pause      gap length multiplier
  gapmax     hard cap on any single gap, seconds (0 = off)
  nasal      dB boost at 2.1kHz with a scoop at 480Hz — the adenoidal knob
  muffle     lowpass cutoff Hz (0 = off) — 'congested'
  drive      compressor ratio (1 = off) — strained/pressed
  targethz   if set, pitch is solved to hit this median f0 instead of `pitch`
  targetwps  if set, artic is solved to hit this words/sec (needs --words)
"""
import argparse, json, subprocess, sys, wave, math, os, tempfile
import numpy as np

SR = 24000
AP = argparse.ArgumentParser()
AP.add_argument('--src', required=True)
AP.add_argument('--out', required=True)
AP.add_argument('--json', default='{}')
AP.add_argument('--words', type=float, default=0)
A = AP.parse_args()
P = json.loads(A.json)
g = lambda k, d: float(P.get(k, d))


def sh(args):
    subprocess.run(args, check=True, capture_output=True)


def load(path):
    tmp = tempfile.mktemp(suffix='.wav')
    sh(['ffmpeg', '-y', '-v', 'error', '-i', path, '-ar', str(SR), '-ac', '1', tmp])
    w = wave.open(tmp)
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    os.unlink(tmp)
    return x


def save(x, path):
    tmp = tempfile.mktemp(suffix='.wav')
    w = wave.open(tmp, 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    w.close()
    return tmp


def median_f0(x):
    N, H = int(.04 * SR), int(.01 * SR)
    lo, hi = int(SR / 400), int(SR / 60)
    out = []
    for i in range(0, len(x) - N, H):
        f = x[i:i + N] * np.hanning(N)
        if np.sqrt((f ** 2).mean()) < 0.012:
            continue
        f = f - f.mean()
        c = np.correlate(f, f, 'full')[N - 1:]
        if c[0] <= 0:
            continue
        c = c / c[0]
        seg = c[lo:hi]
        if not len(seg):
            continue
        k = int(np.argmax(seg)) + lo
        if c[k] > 0.35:
            out.append(SR / k)
    return float(np.median(out)) if out else 0.0


def segments(x, thresh=0.012, hop=0.010, min_gap=0.09):
    """Speech runs and gaps. Gaps shorter than min_gap stay inside the speech."""
    H = int(hop * SR)
    rms = np.array([np.sqrt((x[i:i + H] ** 2).mean() + 1e-12) for i in range(0, len(x) - H, H)])
    voiced = rms > thresh
    runs, cur, start = [], voiced[0], 0
    for i, v in enumerate(voiced):
        if v != cur:
            runs.append((cur, start * H, i * H)); cur, start = v, i
    runs.append((cur, start * H, len(x)))
    merged = []
    for v, a, b in runs:
        if not v and (b - a) < min_gap * SR and merged:
            merged[-1] = (merged[-1][0], merged[-1][1], b)      # short gap = part of the word
        elif merged and merged[-1][0] == v:
            merged[-1] = (v, merged[-1][1], b)
        else:
            merged.append((v, a, b))
    return merged


def rb(x, tempo=1.0, pitch=1.0, formant_preserved=True):
    if abs(tempo - 1) < 1e-3 and abs(pitch - 1) < 1e-3:
        return x
    src = save(x, None)
    dst = tempfile.mktemp(suffix='.wav')
    f = f"rubberband=tempo={tempo:.5f}:pitch={pitch:.5f}:pitchq=quality"
    if formant_preserved:
        f += ":formant=preserved"
    sh(['ffmpeg', '-y', '-v', 'error', '-i', src, '-af', f, dst])
    y = load(dst); os.unlink(src); os.unlink(dst)
    return y


x = load(A.src)
src_f0 = median_f0(x)
src_dur = len(x) / SR

# ── pitch: solve for a target if one was given ───────────────────────────────
pitch = g('pitch', 1.0)
if g('targethz', 0) and src_f0:
    pitch = g('targethz', 0) / src_f0

# ── articulation: solve for a target words/sec if one was given ──────────────
artic = g('artic', 1.0)
segs = segments(x)
speech = sum(b - a for v, a, b in segs if v) / SR
if g('targetwps', 0) and A.words and speech:
    # solve against speech time only; pausing is handled separately
    artic = (A.words / speech) / g('targetwps', 0)
artic = max(0.4, min(2.5, artic))

pause = max(0.0, min(4.0, g('pause', 1.0)))
gapmax = g('gapmax', 0)

# ── retime speech and gaps independently ─────────────────────────────────────
parts = []
for v, a, b in segs:
    chunk = x[a:b]
    if v:
        parts.append(rb(chunk, tempo=artic))
    else:
        n = int(len(chunk) * pause)
        if gapmax:
            n = min(n, int(gapmax * SR))
        parts.append(np.zeros(n, dtype=np.float32))
y = np.concatenate(parts) if parts else x

# ── pitch (formants held) ────────────────────────────────────────────────────
if abs(pitch - 1) > 1e-3:
    y = rb(y, pitch=pitch, formant_preserved=True)

# ── formants alone: shift everything, then undo pitch and speed ──────────────
fm = g('formant', 1.0)
if abs(fm - 1) > 1e-3:
    tmp = save(y, None); dst = tempfile.mktemp(suffix='.wav')
    sh(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-af',
        f"asetrate={int(SR*fm)},aresample={SR},"
        f"rubberband=tempo={fm:.5f}:pitch={1/fm:.5f}:pitchq=quality", dst])
    y = load(dst); os.unlink(tmp); os.unlink(dst)

# ── timbre ───────────────────────────────────────────────────────────────────
chain = []
if abs(g('nasal', 0)) > 0.01:
    n = g('nasal', 0)
    chain += [f"equalizer=f=2100:t=q:w=1.4:g={n:.2f}",
              f"equalizer=f=480:t=q:w=1.1:g={-0.55*n:.2f}"]
if g('muffle', 0) > 0:
    chain.append(f"lowpass=f={int(g('muffle',0))}")
if g('drive', 1) > 1.01:
    chain.append(f"acompressor=ratio={g('drive',1):.2f}:threshold=-20dB:makeup=2")
chain.append("dynaudnorm=f=200:g=5")

tmp = save(y, None)
sh(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-af', ','.join(chain),
    *(['-c:a', 'libmp3lame', '-q:a', '4'] if A.out.endswith('.mp3') else []), A.out])
os.unlink(tmp)

fin = load(A.out)
print(json.dumps({
    'src_f0': round(src_f0, 1), 'out_f0': round(median_f0(fin), 1),
    'src_dur': round(src_dur, 2), 'out_dur': round(len(fin) / SR, 2),
    'speech_s': round(speech, 2), 'gap_pct': round(100 * (1 - speech / src_dur), 1),
    'pitch': round(pitch, 3), 'artic': round(artic, 3), 'pause': round(pause, 2),
    'out_wps': round(A.words / (len(fin) / SR), 2) if A.words else None,
}))
