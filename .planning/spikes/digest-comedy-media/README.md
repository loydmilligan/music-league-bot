---
spike: digest-comedy-media
name: historical-digest-comedy-media-lab
type: exploratory
validates: "Given real league history, which short generated formats are funny enough to deserve becoming product features — and does historical retrieval materially improve the humour?"
verdict: VALIDATED (mechanism), UNMEASURED (frequency)
brief: .planning/spikes/digest-comedy-media-spike.md
related: []
tags: [digest, comedy, retrieval, chat, votes, second-best]
---

# Spike: Historical Digest Comedy / Media Lab

Text-only experiment. **Nothing here is wired to production.** No WhatsApp behaviour, no
bot commands, no schema changes, no jobs, no deploys, no paid APIs, no media generated.
Everything lives under this directory and can be deleted in one `rm -rf`.

## Read in this order

| File | What it is |
|---|---|
| `findings.md` | **Start here.** The answers. |
| `source-audit.md` | Phase 1 — what history the repo actually has, and what it doesn't |
| `incidents.yaml` | Phase 3 — the evidence-backed Incident Sheet, written before any comedy |
| `candidates/` | Phase 4/5 — 10 treatments + 1 `NO BIT`, each with its sources and reservations |
| `memory-comparison.md` | Phase 6 — the controlled local-context vs. historical-context test |
| `music-specific.md` | Phase 5 — what music/voting data yields that chat can't |
| `evaluation.html` | Static rating page — open it in a browser, no server needed |
| `evidence.sh` | Every query behind every claim. Read-only. |

## Verify the claims

```bash
bash .planning/spikes/digest-comedy-media/evidence.sh          # defaults to data/league.db
xdg-open .planning/spikes/digest-comedy-media/evaluation.html  # rate the samples, export JSON
```

`evidence.sh` is 12 labelled queries (E1–E12) and every assertion in every document cites
one. It only reads.

## The one-paragraph answer

The corpus contains at least one genuinely excellent comedy incident — **the Ska Rule**,
a genre statute Matt invented in a vote comment, enforced exactly once against Sarah
Zucker, then broke in public three weeks later while two other players were still obeying
it. It works because it is retrieval, not writing: the setup is in `chat_messages`, the
turn is in `ml_submissions`, the punchline is in `votes`, and the beats are 26 days apart.
The controlled test found that a round-scoped generator doesn't produce a *worse* version
of this bit — it produces **no bit at all**, because the funniest line in the round is a
non-sequitur without the archive. The formats that added the most voice scored worst; the
best treatment (`receipts`) invents nothing and just puts four real artefacts in date
order. What is **not** established is how often such material occurs — that is the next
spike, and it should be detection-only.

## Data-integrity notes

- **No quote in any artefact here is invented.** Player text is copied from the database
  and marked verbatim; invented dialogue (only in `court`, `attack_ad` and the two
  institutional-voice bits) is labelled PARODY in the file it appears in.
- **`design/second-best-player-dossier.md` has a real error**: it conflates Sarah Zucker
  and Sarah Black, and it credits "The Frank Black Embargo" as a running joke when the
  data shows two messages eight minutes apart. Both are documented in `source-audit.md`
  and `findings.md`. Worth fixing at the source — a generator trusting the dossier would
  have misattributed this entire incident.
- The primary target of the comedy is **Matt**, which is deliberate.
