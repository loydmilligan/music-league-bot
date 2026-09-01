# Token map — element → `ui/src/app.css` `@theme` token

Requested in brief §12. Every element resolves to an existing token; the prototype's inline hex values are listed only to confirm the match. **No new token is required.** Tailwind v4 auto-generates the utility from each token name (`--color-surface` → `bg-surface` / `text-surface` / `border-surface`).

## Colors

| Element | Prototype hex | `app.css` token | Tailwind utility |
|---|---|---|---|
| Page background | `#07090c` | `--color-bg` | `bg-bg` |
| Expanded editor / ledger panel / collapsed-gut surface | `#0d1116` | `--color-bg-elevated` | `bg-bg-elevated` |
| Candidate row / card / strip pill | `#141921` | `--color-surface` | `bg-surface` |
| Row hover | `#1d2128` | `--color-surface-hover` | `hover:bg-surface-hover` |
| Strong hairline / rail (possible) / mini-bar track / pressed | `#283039` | `--color-border-muted` | `border-border-muted` |
| Standard hairline / input & pill border | `#3a4451` | `--color-border` | `border-border` |
| Primary text · song title · locked name | `#f1f4f7` | `--color-fg` | `text-fg` |
| Secondary text · artist · dimmed name | `#c2cad3` | `--color-fg-muted` | `text-fg-muted` |
| Caption / hint / possible chip text / ledger summary | `#8b97a4` | `--color-fg-dim` | `text-fg-dim` |
| Very dim · gut marker · mono labels · empty line · taken name | `#5a6773` | `--color-fg-faint` | `text-fg-faint` |
| **State: locked** — chip, 3px rail, certainty fill, active flash | `#ff5b2e` | `--color-accent` | `text-accent` / `bg-accent` / `border-accent` |
| Button/chip hover-pressed | `#d94c23` | `--color-accent-strong` | `hover:bg-accent-strong` |
| Accent deep (chip border on tinted surface) | `#8a2d15` | `--color-accent-deep` | `border-accent-deep` |
| Accent tinted surface (locked chip fill) | `#221a14` | `--color-accent-bg` | `bg-accent-bg` |
| **State: prime** — chip, dashed rail, dimmed-availability, incompleteness | `#e8a83a` | `--color-amber` (= `--color-warn`) | `text-amber` / `border-amber` |
| **Conflict / hard / rejected-write** — duplicate marker, error rail & line | `#e6566c` | `--color-ember` | `text-ember` / `border-ember` |
| **Settled / good** — the "ready to submit" roll-up line | `#3ec27a` | `--color-moss` (= `--color-health`) | `text-moss` |
| Reserved model slot (inert placeholder) | `#3a4451` on `#283039` dashes | `--color-border` / `--color-border-muted` | dashed `border-border` |

Semantic axis tokens `--color-sky` (`#5aa3ff`) etc. are not used on this surface.

## Type (Tailwind defaults + house mono rule)

| Element | Treatment |
|---|---|
| All chrome — labels, chips, values, status lines, eyebrows, tags | `font-mono text-xs tracking-widest uppercase` (JetBrains Mono) |
| Song titles | `font-bold text-fg` (Inter Tight) |
| Artists | `text-fg-muted` |
| Submitter comments (when Project B populates them) | `text-fg-faint text-sm italic` |
| Body / notes / factors text | Inter Tight, sans |
| Section titles (gallery only) | Bricolage Grotesque (`--font-display`) — not used in the shipped board itself |

Families: `--font-body` Inter Tight · `--font-display` Bricolage Grotesque · `--font-mono` JetBrains Mono.

## Spacing / radius / depth

| Property | Value | Note |
|---|---|---|
| Row padding | `pl-3 pr-4 py-2.5` | matches the gut slate |
| Gap between rows | `gap-2` | |
| Section separation | `mb-4` / `mb-6` | |
| Row rail | `border-l-2` (`border-l-[3px]` when locked) | the app's signature list treatment |
| Button radius | `rounded-sm` | |
| Input / textarea radius | `rounded-lg` | |
| Shadows | none | depth = surface color + hairlines only |
| Ledger rail width | 244px, `sticky top-4` | |

## Motion

| Token | Value | Used for |
|---|---|---|
| `--dur-fast` | 120ms | chip state change |
| `--dur-base` | 200ms | hover/color transitions |
| propagation flash | ~700ms one-shot `@keyframes` accent tint | rows whose availability changed after a lock — the only bespoke keyframe; no animation library |

## Proposed token additions
**None required.** Optional future: a dedicated "prime suspect" hue distinct from `--color-warn` if Matt wants prime and warning to differ — propose explicitly before adding; the current design reuses `--color-amber` and is complete without it.
