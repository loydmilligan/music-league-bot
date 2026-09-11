// Sense 1 of the R150 Coinage: the four carmanteaus as ACTUAL VEHICLES,
// photoreal. Sense 2 (the non-vehicle readings) stays stylised on purpose — the
// split in rendering is what separates what the league really built from what
// the digest invented.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }
const MODEL = 'google/gemini-2.5-flash-image';

const STYLE =
  'Photorealistic colour photograph, shot on a DSLR with a 35mm lens, natural daylight, ' +
  'shallow depth of field, true-to-life materials and paint, slight lens vignetting. ' +
  'Looks like a real listing photo of a real vehicle someone actually welded together. ' +
  'No text, no lettering, no watermarks.';

const SUBJECTS = [
  { slug: 'outbrat',
    prompt: 'A 1998 Subaru Outback station wagon in faded green, its rear roof and hatch cut away ' +
      'and rebuilt as a short open pickup bed with a visible weld seam behind the rear doors. ' +
      'Parked on a cracked concrete driveway outside a suburban garage, half finished, primer ' +
      'showing in patches.' },
  { slug: 'acuranger',
    prompt: 'A silver 2003 Acura TL luxury sedan whose rear half has been replaced by the rusted ' +
      'cargo bed of a Ford Ranger pickup, joined at an obvious weld line behind the front doors, ' +
      'producing a very long wheelbase that visibly sags in the middle. Parked in a repair shop lot.' },
  { slug: 'acuruck',
    prompt: 'The same silver Acura sedan-turned-pickup, now lifted on oversized off-road monster ' +
      'tires with the suspension raised, the body sitting absurdly high above the wheels. ' +
      'Photographed on a gravel lot under overcast daylight.' },
  { slug: 'tacomanger-truck',
    prompt: 'A grey Toyota Tacoma pickup that has had a SECOND cargo bed welded on directly behind ' +
      'its first one, so the truck has two pickup beds in a row and an extremely long rear overhang. ' +
      'The second bed is mismatched in colour and clearly donated from another truck. Parked on a ' +
      'suburban street.' },
];

const outDir = path.resolve('digests/_media');
for (const s of SUBJECTS) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
               'X-Title': 'Music League Bot - Carmanteau' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: `${s.prompt}\n\n${STYLE}` }],
      modalities: ['image', 'text'], image_config: { aspect_ratio: '3:2' }, usage: { include: true } }),
  });
  if (!res.ok) { console.error(s.slug, 'HTTP', res.status, (await res.text()).slice(0, 200)); continue; }
  const json = await res.json();
  const msg = json.choices?.[0]?.message ?? {};
  const entry = msg.images?.[0];
  const raw = typeof entry?.image_url === 'string' ? entry.image_url : entry?.image_url?.url;
  if (!raw) { console.error(s.slug, 'no image returned'); continue; }
  const bytes = raw.startsWith('data:')
    ? Buffer.from(raw.slice(raw.indexOf(',') + 1), 'base64')
    : Buffer.from(await (await fetch(raw)).arrayBuffer());
  fs.writeFileSync(path.join(outDir, `${s.slug}-real.png`), bytes);
  console.log(`${s.slug.padEnd(18)} ${(bytes.length / 1024).toFixed(0)}KB  $${(json.usage?.cost ?? 0).toFixed(4)}`);
}
