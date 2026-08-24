# Participation Metric — design

Date: 2026-08-23 · Owner: Matt · Status: approved, ready for implementation

Project **B** of a four-part digest-improvement pass. The other three are out of
scope here and depend on this one:

| | project | depends on |
|---|---|---|
| A | HiL workflow formalisation (gates, mention-adjustment pass, image step) | B for targeting |
| **B** | **Participation metric (this doc)** | — |
| C | Visual upgrade of text-heavy sections + coherence pass | — |
| D | Impact loop: did digest choices move participation? | B |

Agreed order: **B → A → C → D**. B is first because it is the input to A's
adjustment pass and to D entirely, and because the mention time series it needs
is currently empty — `digest_mentions` holds exactly one round (R147).

---

## 1. Purpose

The digest is not only a report; it is a nudge. The working theory is that
players repeat behaviour that gets **named affectionately** — the Cat Lobby, the
carrotbox, Sarah Zucker's apologies. To aim that deliberately we need to know who
is under-engaged, in what way, and what raw material exists to build a bit from.

Two uses, which pull in different directions and are therefore served by two
different objects:

- **Targeting** (drives content): which player to feature this week, and on what.
- **Measurement** (drives review): is engagement rising over a season.

### Visibility

**Internal only.** The score is never published to the league. Facts it surfaces
may be used as digest content — as in R140's "Joe Quinto has never posted in the
chat and writes the longest submission comments" — but no number, ranking or
leaderboard ships.

Rationale: a visible score competes with the mechanism it is meant to serve. It
converts an affectionate running bit into a chore, and it invites optimisation of
the number instead of the behaviour. It would also have to be *defensible*, in a
league that has litigated a trailing comma and a mandolin.

### Non-goals

- No public engagement leaderboard, in the digest or elsewhere.
- No live dashboard or new UI route. A generated file per round is the right weight for a 13-person roster.
- No LLM topic segmentation in this project (see §5.4).
- No reply-graph. See §3.

---

## 2. Core decision: store the vector, derive the scalar

**The stored object is a per-(league, round, player) vector of facts.** The
composite scalar is computed at read time from those facts and a weight table.

The vector is true forever: Joe Quinto wrote 5 vote comments and 0 chat messages
in R140. The scalar is an opinion that depends on weights we have agreed we will
get wrong at first.

If the scalar were stored, every re-weighting would leave the history a mix of
old and new opinions and D's trend line would quietly lie. Deriving it means
**re-weighting retroactively corrects the whole series**, and the backfill can
run before the weights are settled.

Cost: "what was Jac's score in R138" is a computation, not a lookup. At ~4,600
messages this is microseconds.

**Corollary:** the vector is also the primary object for *targeting*. A single
composite would have hidden the most useful finding we have — that the league
splits into two populations that barely overlap:

| player | chat msgs | vote comments |
|---|---|---|
| Jac Chapin | 204 | **0** |
| Sarah Zucker | **5** | 35 |
| Joe Quinto | **0** | 26 |
| Tommy Chapin | 60 | 54 |

Jac and Sarah Zucker score similarly in composite and are opposites in fact. The
opposition is the content.

---

## 3. Scoping invariant

**Everything is scoped to (league, round). Nothing is pooled across groups.**

- A burst never spans groups.
- Temporal-overlap baselines use *that league's* hourly distribution.
- The scalar is comparable only within a league; rankings and percentiles are within-league.
- Identity resolution stays per-league (`player_identities.league_id`). Matt and Jon Black play in both leagues and get **two independent profiles**. Boarz participation must not influence Second Best digest targeting; merging would apply the mention ceiling to them twice.

### What we cannot capture

**Quote-replies are not available.** WhatsApp has them; our pipeline cannot see
them. GroupRelay captures Android *notifications*, and `CaptureEventPayload` is
exactly: `platform, package_name, event_type, direction, conversation,
conversation_key, party, party_handle, text, timestamp, duration_ms`. No quote,
no reply-to, no message id. The Pixel 9 chat export is a flat text file and
carries none either. Treated as out of scope; revisit only if the Android app
changes.

**@mentions are available now.** They are already in the stored text using
WhatsApp's invisible FSI/PDI wrappers — e.g. `@⁨Sarah Zucker⁩ No need to
apologize to these cretins.` 69 in Second Best this season. Precise but sparse
(~2% of messages), and they backfill across everything captured.

---

## 4. Task zero: timestamp normalisation

**This blocks everything else.** Three vector dimensions depend on correct
wall-clock time: `days_active`, every burst-derived dimension, and time-of-day.

### The bug

Two ingest paths disagree. Live-relay rows end `Z`; Pixel 9 backfill rows end
`+00:00`. Measured against a PDT (UTC−7) conversion:

| path | rows | median local hour | share posted 2–8am |
|---|---|---|---|
| live relay (`…Z`) | 3,447 | 19:00 | 5.9% |
| backfill (`…+00:00`) | 1,178 | 09:00 | **51.3%** |

Half the backfilled messages landing between 2am and 9am is an offset, not a
sleep schedule.

### Ground truth (Matt, 2026-08-23)

| message | stored | actually |
|---|---|---|
| "Hey Friends - figured it might be ideal to start a group…" (Second Best) | `2026-05-06 22:17` | 10:17pm local |
| "Layous takes the lead, but we are soon both good and stoned" (Second Best) | `2026-06-02 10:52` | 10:52am local |
| "yes - i thought of it 2 seconds ago…" (Boarz) | `2026-07-15 03:47` | 14 Jul, 8:47pm local |

So Second Best backfill stores **local time mislabelled UTC**; Boarz backfill
stores **correct UTC**. The correction was applied on one export pass and not the
other. A single arithmetic fix would have been wrong.

### Confirmed against the full population

| backfilled group | rows | if stored-is-local | if stored-is-UTC | verdict |
|---|---|---|---|---|
| Second Best and Friends | 1,178 | median 15:00, 3% at 2–8am | median 09:00, 47% | **stored is local → +7h** |
| Hip Jammers | 188 | median 19:00, 3% | median 12:00, 18% | **stored is local → +7h** |
| Boarz II Men | 288 | median 03:00, 44% | median 18:00, **0%** | **already correct → leave** |

All affected rows fall between 2026-05-06 and 2026-07-23, entirely within PDT —
no DST edge case.

### The fix

1. Add `source_path TEXT` to `chat_messages`; backfill it as `relay` for `…Z` rows and `export` for `…+00:00` rows.
2. Add `+7h` to the 1,366 rows in Second Best and Hip Jammers. Leave Boarz's 288.
3. Normalise every `ts` to a single `…Z` representation so format stops encoding provenance.
4. Record the correction in a migration note; the export importer must stamp `source_path` and apply the offset at ingest, because **the Pixel 9 backfill is a manual task that will run again**.
5. Verify: no group's corrected distribution claims a large share of messages between 2am and 8am, and the three ground-truth messages land on their stated local times.

**Back up `data/league.db` before the UPDATE.** It is destructive and touches a
quarter of the chat corpus.

---

## 5. The vector

One row per (league, round, player). All chat dimensions are computed over the
round's chat window — previous round's `voting_deadline` → this round's — which
is the window `chat_participation.py` already establishes.

### 5.1 Ballot dimensions

From `votes` and `ml_submissions`, which are already trustworthy.

| field | meaning |
|---|---|
| `voted` | filed a ballot at all (0/1) |
| `submitted` | submitted a song (0/1) |
| `vote_comments` | count of non-empty vote comments |
| `vote_comment_chars` | total characters across them |
| `sub_comment_chars` | characters in the submission comment |

`vote_comment_chars` matters: Tommy Chapin wrote 1,925 characters in R140 and
Sarah Zucker 364. Both are "commenters"; they are not the same player.

### 5.2 Chat volume

| field | meaning |
|---|---|
| `msgs` | messages in the window |
| `chars` | total characters |
| `days_active` | distinct local days on which they posted |

`days_active` is the strongest single discriminator observed. In R140, Mara
posted 25 messages across **all seven days**; Philip posted 78 across **two**. By
volume Philip looks three times as engaged; by presence, Mara is there daily and
Philip appeared once.

### 5.3 Chat kind

| field | meaning |
|---|---|
| `music_links` | Spotify / YouTube-Music / youtu.be links |
| `media` | photo, video, GIF, poll markers |
| `other_links` | remaining URLs |

**These carry character, not weight.** Non-text is ~5% of all traffic (2,970 text
vs 85 music links, 57 media, 20 other links in Second Best this season), so
weighting them heavily moves nothing. They exist because "Jac is the link guy,
Pascoe is the media guy" is exactly the raw material a running bit is built from.

### 5.4 Conversation

Mechanical only. LLM topic segmentation is deferred; add it only if burst
boundaries prove to be the weak link, and note that its real value is to the
chat *section* (projects A/C), not to the score.

| field | meaning |
|---|---|
| `bursts_joined` | bursts they posted in that had ≥2 distinct senders |
| `group_discussions_joined` | bursts with ≥3 distinct senders |
| `elicited` | times someone posted within 10 min of their message who had **not** posted in the preceding 30 min |
| `mentions_made` | @mentions and name-in-text directed at others |
| `mentions_received` | times others named them |
| `temporal_overlap` | share of their messages falling in that league's **peak hours** — the smallest set of local hours containing 75% of the league's messages for the season |

**Burst definition:** a run of messages in one group ending after 30 minutes of
group silence. The 30-minute gap is a starting value to be tuned once against
corrected timestamps, checking that bursts do not swallow whole evenings.

**`elicited`** is the signal intended to surface quiet players who start
something — Sarah Black's single line about "Some Cut" opened the week's largest
thread; Philip's answer about Sacramento trees drew an hour out of Layous.

**`temporal_overlap`** is the control for a confound Matt identified: Philip
often posts late because that is when he is free, and when nobody else is
present. A player posting off-peak has structurally near-zero `elicited` and
`bursts_joined` through no fault of their own. The metric must record why rather
than score them as disengaged.

**`mentions_received`** is a separate axis from talking, and a good targeting
signal: in R140 Tommy Chapin (11 messages, named 9 times) and Sarah Zucker (5
messages, named 8 times) were discussed far more than they spoke. The league is
already thinking about them.

### 5.5 Context

| field | meaning |
|---|---|
| `rounds_in_league` | rounds this player has been eligible for |
| `median_hour`, `share_off_peak` | posting-time profile |

### Known limitation

With two topics running concurrently — common in these chats — a burst fuses
them and credits an exchange that did not happen. This is the accepted cost of
mechanical segmentation and the trigger for revisiting §5.4.

---

## 6. The scalar, and normalisation

### Composite

A weighted sum over the vector, computed at read time from a weight table kept in
one place and versioned in git. Because weights are applied on read, tuning them
retroactively corrects the whole history.

Starting weights — deliberately crude, to be tuned once real distributions are
visible. Each input is first scaled to its within-(league, round) max so the
dimensions are commensurable:

| input | weight | why |
|---|---|---|
| `voted` | 15 | filing a ballot at all is the floor of participation |
| `vote_comments` | 10 | the ballot-only players' main channel |
| `vote_comment_chars` | 5 | separates Tommy (1,925) from Sarah Z (364) |
| `sub_comment_chars` | 5 | the other place quiet players speak |
| `days_active` | 15 | strongest observed discriminator (§5.2) |
| `msgs` | 8 | volume, deliberately not dominant |
| `bursts_joined` | 12 | Matt's hierarchy: conversation beats isolated comment |
| `group_discussions_joined` | 15 | …and group discussion beats conversation |
| `elicited` | 10 | drew someone in |
| `mentions_made` | 3 | addressed someone directly |
| kind counts | 0 | character, not weight (§5.3) |

`temporal_overlap` is **not** a weighted input. It is a divisor applied to the
burst-derived terms only, so a player who posts off-peak is not penalised for the
league's absence.

Weights only affect ranking and trend. **Targeting reads the vector**, so wrong
weights cost a wobbly graph, not bad content decisions.

### Two numbers, not one

- **Level** — the player's vector for the round, as-is.
- **Position** — their percentile within that **league-season**, among players **active that round**.

Position is what makes a newcomer comparable. Michael Black joined at R139 and
posted 264 messages in two rounds; Joe Quinto has been present all season and
posted none. Raw totals make Michael the most engaged player in the league on the
strength of being new and loud. Percentile-among-active asks "where does this
person sit among those who actually played this week."

`rounds_in_league` rides along as context so a report can say "third round in"
rather than implying the comparison is clean. Deliberately no more elaborate
normalisation: n is 13, and anything fancier would over-fit.

---

## 7. Backfill scope

Every completed round in both active leagues with chat coverage:

- **Second Best** — S11 (R136–R140) plus prior-season rounds with chat back to 2026-05-06.
- **Boarz II Men** — R135, R145–R148.
- **Hip Jammers** — chat exists but no active digest. Store; do not use.

This yields roughly a dozen rounds per league the moment timestamps are fixed, so
project D has a baseline on day one rather than waiting a month.

---

## 8. Implementation shape

**Extend `chat_participation.py` in place**, with one refactor: lift round-window
resolution and player-identity resolution into a shared module that both it and
the new scorer import.

Rationale: those two are the parts most likely to drift and produce two different
answers to "who was active in R140." A prototype written without them could not
join chat senders to ballot names at all, because that mapping lives in
`player_identities`. This mirrors `mention_matrix`/`mention_inventory`, whose
totals reconcile for free because they share their resolution logic.

Rejected: a standalone module (re-implements the hard parts), and building it in
TypeScript inside the app (commits to a schema before the model is proven; app
consumption is project A's concern).

### Storage

New table `player_participation`, primary key `(league_id, round_id,
competitor_id)`, one column per vector field, plus `computed_at`. Additive; no
existing table changes except `chat_messages.source_path`.

### CLI

`scripts/digest-qa/participation.py`

- `<league-slug>` — compute and store for all rounds
- `--round N` — one round
- `--report` — emit the review page
- `--json` — raw vectors

Round-close wiring is **project A's** job. B only has to be callable.

---

## 9. Review surface

`--report` emits one self-contained HTML page per league per round, in the same
shape as `dupe_review_page.py` — a static file that can be opened from an ntfy
tap.

1. **This round's vector table** — players × dimensions, sorted by composite.
2. **Movement** — change since last round, and position against the player's own season baseline.
3. **Targeting** — who is low or falling, and for each, the raw material we hold: most-repeated phrasings, what they share, who names them. This block feeds the punch-up and is the reason the vector is primary.
4. **League trend** — composite by round.
5. **Impact** — *empty in this project.* Columns defined, no rows: for players featured in round N, what their participation did in N+1. Built now so the join accumulates from the first round instead of being unreconstructable when D starts.

---

## 10. Testing

- **Timestamp fix**: assert the three ground-truth messages land on their stated local times; assert no group exceeds a threshold share of messages between 2am and 8am; assert Boarz's 288 rows are unchanged.
- **Scoping**: a burst must never contain two group names; a player in both leagues must produce two rows per round with independent values.
- **Vector**: fixture round with hand-computed expected values for each dimension.
- **Bursts**: synthetic message sequences for the boundary cases — exactly-30-minute gap, single-sender run (not a burst), three-sender run (group discussion).
- **Reconciliation**: `participation.py`'s chat message counts must equal `chat_participation.py`'s for the same round, by construction of the shared module.
- **Backfill**: re-running is idempotent.

---

## 11. Deferred

| item | to |
|---|---|
| LLM topic segmentation and labels | later in B, or A/C where labels are content |
| Reply-graph | blocked on the Android app |
| Improvement-relative scoring (reward movement, not level) | D, which needs a baseline that does not exist yet |
| Round-close automation | A |
| Consuming the metric in generation | A |
| Impact analysis | D |
