// Sense 2 of the R150 Coinage: each carmanteau read by someone who has never
// seen a car. Deliberately PAINTERLY, matching Shane's Tacomanger nativity — the
// rendering split is what separates the vehicles the league really built (photo)
// from the readings the digest invented (paint).
import fs from 'node:fs';
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

const STYLE =
  'Renaissance devotional oil painting. Dramatic chiaroscuro, a single shaft of warm golden ' +
  'divine light falling from above through dust motes, deep umber shadows, cracked-varnish ' +
  'texture, reverent and entirely serious in tone — the solemnity is the joke. ' +
  'No text, no lettering, no watermarks.';

const SUBJECTS = [
  { slug: 'outbrat-sense2',
    prompt: 'A single grilled bratwurst sausage lying alone on the red sand of the Australian ' +
      'outback, lit from above as though sanctified. A kangaroo stands a short distance away in ' +
      'the shadows, watching it with what appears to be reverence. Scrub and red rock to the horizon.' },
  { slug: 'acuranger-sense2',
    prompt: 'A national park ranger in a wide-brimmed flat hat and uniform kneeling beside an ' +
      'enormous brown bear that lies calmly on its side in a clearing. The ranger is carefully ' +
      'placing long acupuncture needles in a neat row along the bear\'s back. The bear appears ' +
      'deeply relaxed. A picnic basket sits forgotten nearby.' },
  { slug: 'acuruck-sense2',
    prompt: 'A rugby ruck: a dense heap of mud-covered players bound together over the ball in a ' +
      'field. Every visible player is bristling with dozens of long acupuncture needles stuck into ' +
      'their backs, shoulders and legs, which none of them appear to have noticed. Steam rises ' +
      'from the pile.' },
];

for (const s of SUBJECTS) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
               'X-Title': 'Music League Bot - Carmanteau' },
    body: JSON.stringify({ model: 'google/gemini-2.5-flash-image',
      messages: [{ role: 'user', content: `${s.prompt}\n\n${STYLE}` }],
      modalities: ['image', 'text'], image_config: { aspect_ratio: '3:2' }, usage: { include: true } }),
  });
  if (!res.ok) { console.error(s.slug, 'HTTP', res.status, (await res.text()).slice(0, 200)); continue; }
  const json = await res.json();
  const e = json.choices?.[0]?.message?.images?.[0];
  const raw = typeof e?.image_url === 'string' ? e.image_url : e?.image_url?.url;
  if (!raw) { console.error(s.slug, 'no image returned'); continue; }
  fs.writeFileSync(`digests/_media/${s.slug}.png`,
    raw.startsWith('data:') ? Buffer.from(raw.slice(raw.indexOf(',') + 1), 'base64')
                            : Buffer.from(await (await fetch(raw)).arrayBuffer()));
  console.log(`${s.slug.padEnd(18)} $${(json.usage?.cost ?? 0).toFixed(4)}`);
}
