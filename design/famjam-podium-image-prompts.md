# Fam Jam S4 — podium image prompts (for an image model)

Nine images: **3 players × 3 themes**. Each theme is applied to all three players, so picking
any single theme gives you a matched podium set.

Companion to `design/famjam-podium-portraits-brief.md` (which has the full reasoning).

---

## How to use

1. Paste **§A Global spec** + **one prompt from §C**. The global block is the same every time.
2. Generate all three players in a theme **in one session** so the model keeps the style stable.
3. If the model supports a negative prompt, use **§B**.
4. Save as `famjam-s4-podium-{em|mara|johanna}-{riso|bloom|medal}.png`.

**On the initial letter:** every prompt asks for a single large letter (E / M / J). Image models
garble letterforms constantly. Check it. If a generation is perfect except the letter is wrong,
keep it — the letter can be composited on afterward, and the image still works without one.

---

## §0 If you're pasting into a chat LLM (not a direct image tool)

Lead with this once, at the top of the conversation. Skip it for Midjourney / a raw image
endpoint — those only need §A + §C.

```
I need nine square images for a music-league season recap — a "season podium" showing
the top three finishers in a family music competition. Three people, three style themes;
each theme gets applied to all three people, so that picking one theme yields a matched
set of three cards that sit side by side.

Rules for you, please follow them exactly:
- Generate exactly what each prompt describes. Do not add objects, symbols or props that
  aren't in the prompt — the whole point is that these are evocative and abstract, not
  literal illustrations of anyone's job or hobbies.
- Within a theme, hold the style rigidly constant across all three images: same technique,
  same texture, same treatment, same lighting. Only the colour palette, the geometry and
  the letter change between the three people. They must look like one set.
- Do not add any text, captions or labels. The only glyph in each image is the single
  capital letter named in the prompt.
- Do not depict faces or people.
- If you cannot render the letter cleanly, produce the image without it and tell me.

I'll give you a global spec block that applies to every image, then the prompts one at a
time. Confirm you've got it, then wait for the first prompt.
```

---

## §A Global spec — prefix every prompt with this

```
Square 1:1 composition, 1024x1024. Album-cover-scale artwork — it will be displayed
small, about 200 pixels wide, so use bold large-scale shapes and high contrast; no fine
detail, no thin lines, no small text. It sits on a very dark charcoal background
(#141921) inside a dark editorial magazine layout, so the artwork must read clearly
against near-black and must not be a flat white rectangle. Keep the top-left corner of
the square visually quiet and uncluttered — a small badge overlays that corner. No
human faces, no people, no portraits. No words or text of any kind except the single
letter specified. Abstract, evocative, designed — not a literal illustration of any
object.
```

---

## §B Negative prompt

```
text, words, lettering, typography, captions, watermark, signature, logos, human faces,
people, portraits, hands, basketball, sports equipment, graduation cap, diploma, school,
microphone, headphones, turntables, DJ equipment, speakers, musical notes, vinyl records,
loom, yarn, knitting, sewing, fabric swatches, Swedish flag, blue and yellow flag,
national flags, IKEA, clichéd music iconography, stock photo, cluttered, busy, tiny
details, thin hairlines, low contrast, muddy
```

---

## §C The nine prompts

### Theme 1 — RISOGRAPH POSTER
*Flat two-colour riso print. Coarse grain, visible ink misregistration, bold overlapping
shapes, one enormous letterform as the composition itself. The loudest, most graphic of the
three — best small-size legibility.*

**1a · Em (champion)**
```
Two-colour risograph poster. A huge letter "E" built from concentric expanding
arcs radiating outward like a rising pulse, warm and buoyant. Fluorescent orange and
warm gold inks overprinting into a hot amber where they cross, on a deep charcoal ground.
Heavy paper grain, coarse halftone dots, deliberate 2mm ink misregistration. Optimistic,
rhythmic, generous — the composition expands outward from the centre rather than
contracting. Bold flat shapes only.
```

**1b · Mara (runner-up)**
```
Two-colour risograph poster. A huge letter "M" constructed from hard angular slabs,
one slab knocked out of alignment as if the letter is bracing against something.
Oxblood red and hot pink inks overprinting on a deep charcoal ground, sharp diagonal
counter-shapes cutting across the letter. Heavy paper grain, coarse halftone,
deliberate misregistration. Sharp, defiant, guarded — tension held in place, nothing
soft or open.
```

**1c · Johanna (third)**
```
Two-colour risograph poster. A huge letter "J" formed where two interlocking systems of
thick bands cross over and under each other, structural and interwoven. Cool pale blue
and dusty rose inks overprinting into a soft violet on a deep charcoal ground. Heavy
paper grain, coarse halftone, deliberate misregistration. Calm, orderly, quietly witty —
repetition and interlock rather than symmetry.
```

---

### Theme 2 — PIGMENT BLOOM
*Fluid ink diffusing in water, photographed close. Organic, atmospheric, painterly. The
letter is ghosted — a negative space the pigment refuses to enter. The most beautiful of the
three, the riskiest at small size.*

**2a · Em**
```
Abstract macro photograph of luminous ink blooming into water against near-black.
Warm amber, coral and gold pigment unfurling in soft symmetrical waves, lit from
behind so it glows. In the centre, the letter "E" appears as clean negative space that
the pigment flows around and never enters. Radiant, warm, expansive. High contrast
against a very dark ground, no visible container or surface.
```

**2b · Mara**
```
Abstract macro photograph of ink blooming into water against near-black. Deep crimson
and oxblood pigment driven in sharp fast plumes, more turbulent than serene, edges
fracturing into fine threads. In the centre, the letter "M" appears as clean negative
space the pigment flows around and never enters. Intense, coiled, unapologetic. High
contrast against a very dark ground.
```

**2c · Johanna**
```
Abstract macro photograph of ink blooming into water against near-black. Cool
slate-blue and pale rose pigment settling in slow layered veils, drifting into soft
horizontal strata. In the centre, the letter "J" appears as clean negative space the
pigment flows around and never enters. Serene, layered, northern-light cool. High
contrast against a very dark ground.
```

---

### Theme 3 — STRUCK MEDAL
*An engraved metal plate: the monogram struck into brushed metal, with a geometric guilloché
field behind it. Ceremonial and trophy-like — it agrees with the gold / silver / bronze medal
borders the cards already have.*

**3a · Em — gold**
```
A square commemorative medal struck in warm gold metal, photographed straight on under
raking light. A large letter "E" is deeply struck into the surface, surrounded by a
radiating sunburst guilloché pattern of engraved lines expanding from the centre.
Brushed metal texture, crisp bevelled edges, deep shadow in the recesses, warm highlights
on the raised areas. Ceremonial and confident. Very dark background, the metal itself
providing the light.
```

**3b · Mara — silver**
```
A square commemorative medal struck in cool silver metal, photographed straight on under
raking light. A large letter "M" is deeply struck into the surface, surrounded by a
tight angular chevron guilloché pattern that fractures where it meets the letter.
Brushed metal texture, crisp bevelled edges, deep shadow in the recesses. Sharp,
severe, hard-won. Very dark background, the metal itself providing the light.
```

**3c · Johanna — bronze**
```
A square commemorative medal struck in warm bronze metal with a faint patina,
photographed straight on under raking light. A large letter "J" is deeply struck into the
surface, surrounded by an interlaced basket-weave guilloché pattern of bands passing
over and under one another. Brushed metal texture, crisp bevelled edges, deep shadow in
the recesses. Quiet, crafted, precise. Very dark background, the metal itself providing
the light.
```

---

## §D What each player's variation is keyed to *(so you can steer re-rolls)*

Nothing here should ever appear as an object — it's the *mood* each prompt is buying.

| Player | Evokes | Never depict |
|---|---|---|
| **Em** | expansive, warm, rhythmic, generous, buoyant — the champion who never had a bad week and deflects credit | basketball, courts, DJ gear, food |
| **Mara** | sharp, high-contrast, defiant, controlled, guarded — feisty, indie-rap, allergic to talking about feelings | graduation caps, diplomas, campuses, microphones |
| **Johanna** | interlocked, layered, cool, orderly, quietly funny — structure and repetition | looms, yarn, Swedish flags, blue-and-yellow |

If a generation feels wrong, adjust the **adjectives**, not the objects.

---

## §E Delivery checklist

- [ ] 1:1 square, 1024×1024, PNG
- [ ] Top-left corner quiet (a rank badge sits there)
- [ ] Reads at 200px — shrink it and check before accepting
- [ ] Doesn't glare against `#141921`, and doesn't get lost in it either
- [ ] The letter is correct, or is absent and will be composited
- [ ] All three players in a chosen theme look like one set
```
famjam-s4-podium-em-riso.png       famjam-s4-podium-em-bloom.png       famjam-s4-podium-em-medal.png
famjam-s4-podium-mara-riso.png     famjam-s4-podium-mara-bloom.png     famjam-s4-podium-mara-medal.png
famjam-s4-podium-johanna-riso.png  famjam-s4-podium-johanna-bloom.png  famjam-s4-podium-johanna-medal.png
```

Drop them anywhere and tell me the path — I'll wire them into the podium section for
`draft-129-e694c511`.
