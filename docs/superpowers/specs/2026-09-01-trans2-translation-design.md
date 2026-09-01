# `#trans2` — style translation as a chat command

**Status:** design agreed, not built. No code exists in `src/` or `ui/src/`.
**Date:** 2026-09-01
**Owner:** Matt

---

## 1. What this is

A bot command that rewrites a message in someone else's voice, in the live Boarz
WhatsApp group. Two jokes, not one:

- **`#trans2english`** — person → plain English. The joke is **deflation**: strip
  the voice and the content is revealed as mundane.
- **`#trans2<person>`** — person → person. The joke is **incongruity**: the same
  point delivered by someone it would never occur to.

This is the user-facing form of the normalfy/personify pair. It is deliberately
*translation* rather than generation: the bot restyles something a human already
said, so it never has to invent an opinion and attribute it to a real person.

### Scope

**v1 is `#trans2` only.** `#replyas-<person>` (generate a reply in a voice) and
`#sayitas-<person>` (the same, as TTS audio) are designed-for but not built. The
`2` in the token does not extend cleanly to them — `#rep2jb` reads as "reply *to*
JB" — so that family needs its own shape when it arrives.

---

## 2. Command grammar

**Token:** `#trans2<alias>`, e.g. `#trans2jb`, `#trans2english`.

Deliberately bespoke. A bare `#translate` collides with ordinary speech; `trans2`
is short, memorable, and the `2` reads as "to", which is semantically right rather
than arbitrary decoration.

**Position — leading or trailing only, never mid-sentence:**

```
#trans2jb                    ✅ leading, empty
#trans2jb what a take        ✅ leading, inline
what a take #trans2jb        ✅ trailing
you should try #trans2jb     ⚠️  trailing — WILL fire (accepted risk, §5)
try #trans2jb on that one    ❌ mid-sentence — never fires
```

Mid-sentence is banned permanently; it is where the real false-positive risk lives
and banning it costs nothing.

**Flags** follow the command in an uninterrupted run:

- `-o <bare|thinlabel|standalone>` — output format
- `-m <reply|inline|empty|reply-inline>` — force a mode (§3)
- `--` — end of flags; everything after is literal text

**The closed-value rule.** Free text and flags share one string with no delimiter,
which is ambiguous:

```
#trans2jb -o is a weird abbreviation
```

A naive parser eats `is` as the value of `-o` and silently corrupts the message.
Resolution: **a dash token is a flag only if its value is in that flag's allowed
set.** Every flag we have is enumerated, so `is` is not a valid `-o` value, `-o`
is therefore text, and flag parsing stops there. Trailing form has no ambiguity at
all — text is everything before the command.

---

## 3. Target resolution

Four modes, auto-detected. `-m` overrides.

| reply? | inline text? | mode | content translated | context |
|---|---|---|---|---|
| no | no | `empty` | preceding message | — |
| no | yes | `inline` | the inline text | — |
| yes, has text | no | `reply` | the quoted message | — |
| yes, has text | yes | `reply-inline` | the inline text | the quoted message |
| yes, no text | no | *error* | — | — |
| yes, no text | yes | `inline` (degraded) | the inline text | — |

**`reply-inline` is the only two-slot mode**: quoted text is *context*, inline text
is *content*, and the instruction becomes "render this as X, shaped as a response
to that". It needs its own prompt template, not a variable swap. It borders
`#replyas` — the distinction is that reply-inline still translates text the user
supplied, while `#replyas` would invent it.

**Explicit mode must fail rather than fall back.** If `-m reply` is given and there
is no reply, error. Silent fallback defeats the purpose of being explicit.

**Both inputs already exist on the message envelope** — no DB or relay read needed:

- `msg.quotedText` — `src/whatsapp/client.ts:105` (reads `qm.caption || qm.body`,
  so a *captioned* image works as a reply target; only text-free media errors)
- `msg.priorMessages` — `src/whatsapp/client.ts:82`, an in-process ring of the last
  3 messages per chat

**Known degradation:** that ring buffer is memory-only, so `empty` mode has nothing
to work with on the first message after a restart. It must say so, not no-op.

---

## 4. Dispatch and guards

**Dispatch before `handlePromptAnswer`** (`src/bot/handler.ts:66`). A prompt answer
is *inferred* (the engine acts when exactly one prompt is open); a command is
*explicit*. Explicit beats inferred, or an open prompt eats the command.

**Guards**, each independently testable:

| guard | why |
|---|---|
| ignore `fromMe` | already `handler.ts:50`; matters doubly here because bot output contains persona names |
| ignore forwarded (`_data.isForwarded`) | forwarding an old command must not re-fire it |
| ignore token found in `quotedText` | re-quoting a command must not re-fire it |
| ignore messages older than ~2 min | wwebjs replays history after reconnect; without this a redeploy translates dozens of old messages and bills for it |
| per-message-id dedupe | |
| per-author rate limit (~5/hr) | every fire is a paid call |

**No `@`-mention in v1.** Not because mentions are bad but because they are
*unproven here*: `client.ts:69` notes every Store method throws in this wwebjs
build, so `mentionedIds` would have to come off the raw `_data` envelope and nobody
has confirmed it is populated. Its failure mode is also the worst kind — a
manually-typed `@bot` doesn't attach a real mention, producing a silent no-op that
reads as "the bot is broken". Verify with `LOG_GROUPS=1` before relying on it.

---

## 5. Failure UX — the highest-risk part of the design

**Precedent:** a previous poll feature died because two players made three failed
attempts each that vanished silently, then sent variations of "my guess is fuck
you". **Two failures and a user is gone for good, and never finds the feature funny
again.** The design consequence:

**Silence is correct for "not a command" and fatal for "a failed attempt."** So the
parser must distinguish them: a message *fuzzily resembling* an attempt (contains
`trans2`, `#trans`, `translate`, or a near-miss) always gets a response. Everything
else stays silent.

**Be forgiving at the token level, not just the alias.** All of these must work:
`#trans2jonn`, `#trans2 jon`, `#transtojon`, `#trans2Jon`. Every rejection spends
one of a two-strike budget.

**Reuse `src/chat/prompts/resolve.ts`.** It is a six-pass forgiving resolver —
curated aliases → exact → label-inside-word → shared prefix → length-scaled
Levenshtein — whose header records that every rule was derived from 2,945 real
Boarz messages, including a `BLOCKED_TOKENS` list built from observed collisions
("have"→Dave 173 times, "back"→Black 26, "giant"→Grant 6). Already covered by
`tests/chatPrompts.test.ts`. It returns `matched | ambiguous | unmatched` with a
`via` explanation.

**Bias toward acting.** With five targets, a single close match should just run,
stating the assumption inline (*"heard: Jon"*). `resolveAnswer` deliberately
refuses rather than guesses — right for scoring a poll, slightly too strict here.
A slightly-wrong translation is funny; silence is fatal.

**When it must ask, ask with a tappable answer** — *"Jon or Jensen? →
`#trans2jon` / `#trans2jensen`"*, not "invalid alias".

**Unprofiled people get warmth, not an error.** "Dave's voice isn't ready yet —
soon." A roadmap reads better than a rejection.

**Bare `#trans2` is a help path**, not a failure: return the roster and one example.

**Escalation:** first failure per person gets a short public one-liner that fixes
it *plus* a one-time DM with the full card. Repeat failures are DM-only — the bot
must never publicly fail at the same person twice.

**Log every failed attempt verbatim** with what the resolver saw and why it
declined. That turns "make it nicer" into a worklist, exactly as `BLOCKED_TOKENS`
was built.

---

## 6. Pipeline

**Where the call lives:** a new `POST /api/translate` in the UI app; the bot posts
to it. The bot has no LLM client and should not grow one — it already talks to the
UI over HTTP (`src/digest/poller.ts:29`), where `ui/src/lib/digest/llm.ts` owns the
model config, keys, `callOpenRouter`, and the `llm_cost_log` / `llm_health_event`
ledger. Cost: the bot now depends on the UI being up, a failure mode already seen
in production, so a fetch failure needs a real in-group message.

**Two stages**, cached:

1. **normalize** — strip to plain English. This *is* `#trans2english`, so the
   deflation command falls out of the pipeline for free.
2. **stylize** — apply the target's persona context.

**In-memory LRU keyed by WhatsApp message id, ~1h TTL, no DB.** It catches the only
reuse that actually happens (a good message translated to several people in quick
succession) and dies harmlessly on restart. Promote to a table only if the logs
show people re-translating old messages.

**Empty-output check is mandatory.** Measured during the spike: GLM 4.7 returned an
empty string on **21 of 21 calls**, burning its entire token budget on reasoning,
with HTTP 200 every time. An empty output scored as a failure and would have been
read as "cheap models can't do impressions". Never trust a 200.

---

## 7. Persona context — informed by the spike

`.planning/spikes/digest-comedy-media/personify/` — 192 generations, 4 models × 5
context depths × 2 command types, $1.45. Report: `context-depth-report.html`.

| depth | contents | ~tokens |
|---|---|---|
| L1 fingerprint | mechanical tells only | 194 |
| L2 kit | imitation kit + 5 quotes | 900 |
| L3 situational | kit + voice + humor + negative space | 3,581 |
| L4 full | the whole dossier | 5,971 |
| L5 retrieved | kit + 6 real messages retrieved for *this* input | 1,283 |

**Mean p(target) from the 5-way style judge (0.657 accuracy, ~0.20 chance):**

| model | L1 | L2 | L3 | L4 | L5 | $/call (L5) |
|---|---|---|---|---|---|---|
| Claude Opus 5 | 0.40 | 0.42 | 0.54 | **0.71** | 0.65 | $0.0127 |
| GLM 4.7 | 0.53 | 0.49 | **0.59** | 0.50 | 0.56 | $0.0006 |
| GPT-5.1 | 0.40 | 0.47 | **0.55** | 0.37 | 0.51 | $0.0036 |
| Gemini 3.7 Flash | 0.25 | 0.28 | **0.61** | 0.36 | 0.34 | $0.0031 |

**Findings that bear on the design:**

1. **Only Opus improves monotonically with depth.** Every other model peaks near L3
   and *degrades* on the full dossier — 6k tokens of character study appears to
   swamp the instruction without the headroom to hold both. "More context is
   better" is a property of Opus, not of the technique.
2. **Retrieval is the efficiency win.** Opus L5 reaches 0.65 at 88% top-1 for
   $0.0127, against L4's 0.71 / 100% at $0.0412 — ~90% of the quality for ~30% of
   the cost and a third of the context.
3. **Deflation needs no depth.** `#trans2english` scores identically at L2 and L4
   (Opus 0.32/0.32, Gemini 0.17/0.17). It should never pay for a dossier.
4. **Latency is 3–8s for every model.** Deep context is constrained by latency, not
   money.
5. **The judge is sound.** Normalising typography costs only 4% of its accuracy
   (8% on a 10-way judge), so it is reading style, not keyboards.

**Open — do not pick the default without it:** the judge measures *recognisable*,
not *funny*, and those can diverge. The human rating pass in the report decides. If
ratings track the judge, the shape is **Opus + L5-retrieved** for quality or **GLM
4.7 + L3** for value; if they diverge, ratings win.

**Dossiers live in the spike directory and must be promoted** into the repo proper
before shipping. Runtime uses a compact card (the §6 imitation kit); the full
dossier stays as the versioned source.

**Model config:** its own env var, `OPENROUTER_TRANSLATE_MODEL`, so tuning
translation never disturbs the digest. Skip prompt caching — the card is stable but
usage is too sporadic for a 5-minute TTL.

---

## 8. Output format

`-o bare | thinlabel | standalone`, default **thinlabel**: quote-reply the source
with a thin marker (`Jon:` or 🎭). Preserves nearly all of the joke while making it
unmistakably a bit — the ambiguity of an unlabelled impression stops being funny
the first time it causes a real misunderstanding.

**Acknowledge immediately.** Two sequential calls at 3–8s is long enough for a joke
to die. React to the source message (👀) as an instant "heard you". Caveat:
reactions go through wwebjs and `client.ts:69` warns Store methods throw in this
build — verify before relying on it, and fall back to nothing rather than a noisy
"working on it".

---

## 9. Runtime config — designed, deferred to v2

`#list-config` / `#set-config`, owner-gated, replying by DM, with
`--options`/`-o` listing current value first and bold.

**v1 ships dash-args only.** The config subsystem's value is *persisting* knobs,
and neither of us yet knows which knobs matter or what their good values are. Build
it first and we guess the schema; build it second and the dash-args have already
told us which settings earned persistence. Same destination, less rework.

**Naming trap:** `fromMe` in this codebase means *the bot's own* messages
(`handler.ts:50`), which is the opposite of "from Matt". Use **`ownerOnly`** for
the admin gate and leave `fromMe` alone.

**Gate on `msg.author === ownerPhone`**, which is reliable and needs no mentions.
`ownerPhone` is loaded and normalised at `src/index.ts:30-35` and already threaded
into `BotConfig` (`handler.ts:37`); `sendDm` is wired at `index.ts:66`. The gate is
itself a setting (`config-owner-only`, default `true`).

**Storage:** a `bot_settings` key-value table in the existing SQLite.
`src/config/loader.ts` is a 16-line static JSON read at boot and cannot hold
mutable settings; rewriting the JSON invites write races.

---

## 10. Testing

- `parse.ts` and `target.ts` are pure — full unit coverage in `tests/`, following
  `tests/handler.test.ts`. Vitest is already configured.
- `guards.ts` needs a synthetic envelope, which `handler.test.ts` already builds.
- **Style regression gate:** translate a fixture set to a target, run the personify
  judge, assert it identifies the target well above chance. Turns "does the
  impression work?" into a test rather than a vibe.
- No Svelte component or route test harness exists. Logic goes in `.ts`; `.svelte`
  stays thin. Do not invent a harness.

---

## 11. Open questions

1. **Default context depth and model** — blocked on the human rating pass.
2. **Is `#trans2` the right token?** "Trans" carries an unrelated colloquial reading
   that `#trans2jb` may trip over. Flagged once; Matt's call.
3. **Trailing-form false positives** — accepted risk. Log trailing fires and review
   after a few weeks of real use.
4. **Reaction support** — unverified in this wwebjs build.
5. **Jensen prediction** — his dossier described the wrong person (plainest
   vocabulary in the group, written up as elevated). He scored worst of all targets
   at p=0.324 / 25% hit against 47–55% for everyone else. Fixing the dossier should
   raise his score with the others flat; re-running his cells costs ~$1 and would
   confirm that dossier quality, not model capability, is the binding constraint.

---

## 12. Build order

1. Command frame — `parse.ts`, `target.ts`, `guards.ts`, dispatch, dash-args
2. `/api/translate` — two-stage pipeline, LRU, persona cards promoted into the repo
3. Failure UX — resolver reuse, escalation, attempt logging
4. Ship `#trans2` behind the group allowlist; watch the logs
5. Runtime config, once the dash-args have shown which knobs matter
6. `#replyas`, then `#sayitas`
