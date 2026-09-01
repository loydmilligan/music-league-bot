#!/usr/bin/env node
/**
 * pitchlock.mjs — pin a rendered clip to a target median f0.
 *
 * gpt-audio's register drifts ±30Hz between runs on the same prompt, which for
 * a recurring character is the difference between "that's the guy" and "who is
 * that". Measure, then correct with the same resample-and-slow-back chain
 * say.mjs uses, so pace is untouched.
 *
 * Usage: node pitchlock.mjs <in> <out> [targetHz=118]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [inp, outp, tgt = '108'] = process.argv.slice(2);
if (!inp || !outp) { console.error('usage: pitchlock.mjs <in> <out> [hz] [--wps N --words N]'); process.exit(1); }
const a = (n,d)=>{const i=process.argv.indexOf('--'+n); return i<0?d:process.argv[i+1];};

const tmp = '/tmp/_pl.wav';
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inp, '-ar', '24000', '-ac', '1', tmp]);
const py = `
import wave,struct,numpy as np
w=wave.open("${tmp}");sr=w.getframerate();n=w.getnframes()
x=np.frombuffer(w.readframes(n),dtype=np.int16).astype(float)/32768
N=int(.04*sr);H=int(.01*sr);lo,hi=int(sr/400),int(sr/60);o=[]
for i in range(0,len(x)-N,H):
    f=x[i:i+N]*np.hanning(N)
    if np.sqrt((f**2).mean())<0.012: continue
    f=f-f.mean();c=np.correlate(f,f,'full')[N-1:]
    if c[0]<=0: continue
    c/=c[0];s=c[lo:hi]
    if not len(s): continue
    k=int(np.argmax(s))+lo
    if c[k]>0.35: o.append(sr/k)
print(float(np.median(o)) if o else 0)`;
const cur = +execFileSync('python3', ['-c', py]).toString().trim();
if (!cur) { console.error('no pitch detected'); process.exit(1); }

const r = +tgt / cur;
const SR = 24000;

// Cadence is the other half. The model's pace swings between 1.6 and 3.5 words
// per second on the same settings, so it gets measured and corrected too rather
// than requested. asetrate changes pitch AND speed; the atempo after it pulls
// speed back to wherever we actually want it, independent of pitch.
const dur = +execFileSync('ffprobe', ['-v','error','-show_entries','format=duration',
	'-of','default=nw=1:nk=1', tmp]).toString().trim();
const words = +a('words', 0), wps = +a('wps', 0);
let speed = 1;
if (words && wps) {
	speed = (words / dur) > 0 ? wps / (words / dur) : 1;
	speed = Math.max(0.5, Math.min(2.0, speed));
}
const af = [`asetrate=${Math.round(SR * r)}`, `aresample=${SR}`,
	`atempo=${(speed / r).toFixed(4)}`];
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-af', af.join(','),
	...(outp.endsWith('.mp3') ? ['-c:a', 'libmp3lame', '-q:a', '5'] : []), outp]);
fs.unlinkSync(tmp);
const nd = +execFileSync('ffprobe', ['-v','error','-show_entries','format=duration',
	'-of','default=nw=1:nk=1', outp]).toString().trim();
console.log(`${outp}  ${cur.toFixed(1)}→${tgt}Hz (x${r.toFixed(3)})` +
	(words&&wps ? `  ${(words/dur).toFixed(2)}→${(words/nd).toFixed(2)} w/s (x${speed.toFixed(3)})` : ''));
