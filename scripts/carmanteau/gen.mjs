// One-off: generate the "carmanteau" slideshow art for the R150 Coinage.
// Devotional-painting style throughout, anchored on Shane's Tacomanger photo so
// the four read as one set. Writes straight into digests/_media/.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }
const MODEL = 'google/gemini-2.5-flash-image';

const STYLE =
  'Renaissance devotional oil painting. Dramatic chiaroscuro, a single shaft of warm golden ' +
  'divine light falling from above through dust motes, deep umber shadows, cracked-varnish ' +
  'texture, reverent and serious in tone. No text, no lettering, no watermarks.';

const SUBJECTS = [
  { slug: 'outbrat', title: 'The Outbrat',
    prompt: 'A 1998 Subaru Outback station wagon whose rear roof and hatch have been cut away and ' +
      'converted into a small open pickup bed, half-finished, dust-sheeted and long abandoned in a ' +
      'shuttered workshop. Tools lie untouched on the floor. Nobody has come for it in years.' },
  { slug: 'acuranger', title: 'The AcuRanger',
    prompt: 'A silver 2003 Acura TL luxury sedan whose back half has been replaced by the bed of a ' +
      'Ford Ranger pickup, joined at an obvious weld line, producing an absurdly long wheelbase ' +
      'that sags in the middle. It sits alone on a garage floor as though presented for judgement.' },
  { slug: 'acuruck', title: 'The Acuruck',
    prompt: 'The same silver Acura sedan-turned-pickup, now jacked up on enormous monster-truck ' +
      'tires that dwarf the body, front end lifted. Two mechanics in grubby coveralls kneel before ' +
      'it in the attitude of adoration, hands clasped, faces lit from above.' },
];

const outDir = path.resolve('digests/_media');

for (const s of SUBJECTS) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: `${s.prompt}\n\n${STYLE}` }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: '3:2' },
    usage: { include: true },
  };
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
               'X-Title': 'Music League Bot - Carmanteau' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.error(s.slug, 'HTTP', res.status, (await res.text()).slice(0, 300)); continue; }
  const json = await res.json();
  const msg = json.choices?.[0]?.message ?? {};
  const entry = msg.images?.[0];
  let raw = typeof entry?.image_url === 'string' ? entry.image_url : entry?.image_url?.url ?? msg.image_url;
  if (!raw) { console.error(s.slug, 'no image in response', JSON.stringify(json).slice(0, 300)); continue; }
  let bytes;
  if (raw.startsWith('data:')) bytes = Buffer.from(raw.slice(raw.indexOf(',') + 1), 'base64');
  else bytes = Buffer.from(await (await fetch(raw)).arrayBuffer());
  const out = path.join(outDir, `${s.slug}.png`);
  fs.writeFileSync(out, bytes);
  console.log(`${s.slug.padEnd(11)} ${(bytes.length / 1024).toFixed(0)}KB  $${(json.usage?.cost ?? 0).toFixed(4)}  ${Date.now() - t0}ms`);
}
