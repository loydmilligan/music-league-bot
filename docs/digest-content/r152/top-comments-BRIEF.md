# Brief — Top comments per Boarz S1 player (for the baseball card backs)

**From:** Claude (pane pA). Deterministic research + curation. **No LLM section, no DB writes.**
Repo: `music-league-bot`. DB: `data/league.db` (read-only).

## Goal
For each **assigned** player, produce two things:
1. **Top WhatsApp comment** — read the group chat, find their funniest lines, list **3 candidates**, then **pick the single best** (star it ★).
2. **Top voting comment** — their best/funniest vote comment from the season.

These go on the back of each player's animated baseball card, so keep them **short, punchy, verbatim, and self-contained** (a stranger should laugh without needing setup).

## Data sources
- **WhatsApp:** `chat_messages` WHERE `group_name = 'Boarz II Men - Music Leagueing https way'` (14,370 msgs). Columns: `sender`, `text`, `ts`.
  - Map `sender` → player. A sender may appear as a display name or a `~Name` form. **GOTCHA:** the `~` senders use U+202F (narrow no-break space), NOT a regular space — normalize whitespace before matching or you'll silently drop ~most of a person's messages. Cross-check with `player_identities` (identity_type='whatsapp', league_id=5) if useful.
- **Voting comments:** `votes v JOIN competitors c ON v.voter_id=c.id`, `v.round_id IN (SELECT id FROM rounds WHERE season_id=10)`, non-empty `v.comment`. (Note: a 0-point row is a comment-without-vote — still valid as a "comment".)

## Player → names (chat sender / competitor may differ)
| Player | competitor name | likely chat sender(s) |
| --- | --- | --- |
| Matt (Slopulist) | Mashew | Matt Mariani |
| Jon / JB (Cat Man) | Jonathan Black | Jon Black / Jonathan Black |
| Jimmy (Bystander) | Jimmy Troy | Jimmy |
| Clements (City Bumpkin) | Clements | Clements Johnson |
| Jensen (Concussionist) | djensen37 | Dave Jensen |
| Darren (Transient) | Darren Paletz | Darren Paletz |
| Shane (Southern Stan) | Shane Farkas | Shane Farkas |
| Steiny (Steiny Gump) | Steiny | Dave Steingart |
| Grant / Koz (Ex-Expat) | Grant Koziol | Grant |
| Conor (Twinkler) | CJ Wookie | Conor Johnston |

## Output
Append to **`docs/digest-content/r152/top-comments-<YOURPANE>.md`** (e.g. `top-comments-p1.md`). One section per player:

```
## <Player> (<hero>)
### WhatsApp candidates
1. "<verbatim>" — <YYYY-MM-DD>  (why it lands: …)
2. "<verbatim>" — <date>  (…)
3. "<verbatim>" — <date>  (…)
★ TOP: #<n>
### Top voting comment
"<verbatim>" — round "<round name>"  (why: …)
```

## Rules
- **Verbatim only.** No paraphrasing, no invention. Cite the date (WhatsApp) or round (vote).
- Prefer lines that are funny **out of context** and short enough for a card back.
- Keep the group's tone; profanity is fine (it's their voice), just make sure it's a real quote.
