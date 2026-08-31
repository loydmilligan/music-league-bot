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

const [inp, outp, tgt = '118'] = process.argv.slice(2);
if (!inp || !outp) { console.error('usage: pitchlock.mjs <in> <out> [hz]'); process.exit(1); }

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
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-af',
	`asetrate=${Math.round(SR * r)},aresample=${SR},atempo=${(1 / r).toFixed(4)}`,
	...(outp.endsWith('.mp3') ? ['-c:a', 'libmp3lame', '-q:a', '5'] : []), outp]);
fs.unlinkSync(tmp);
console.log(`${outp}  ${cur.toFixed(1)}Hz → ${tgt}Hz  (x${r.toFixed(3)})`);
