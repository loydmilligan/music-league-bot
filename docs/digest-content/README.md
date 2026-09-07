# Digest content entities

One file per content item. These are **descriptions of what happens today**, captured
2026-09-03 — not a target state. Where a field is `null`, we genuinely do not capture it
(see `docs/research/2026-09-03-digest-content-inventory.md` §4 for why those nulls matter).

Schema (every file, same keys, same order):

    <id>:
      label / surface / status / generation / engine
      input:  { sources[], evidence_bound, player_scope }
      llm:    { prompt{}, model, params{}, batching{} }   # null for deterministic items
      output: { schema, storage, summary_for_next_gen, players, cost_usd, tokens, observed }

`observed` is measured from the R153 (Boarz "Stranger Danger") draft, `draft-153-12106735`.
