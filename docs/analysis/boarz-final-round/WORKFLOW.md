# Boarz Season 1 final-round taste analysis

## Purpose and current state

The decision is which song to submit for Boarz Season 1's final round, **“These Go to 11”** (`rounds.id = 152`). The eleven songs in the downloaded `Turnt_Playlist_Data.md` were added to the app's round 152 Research / Head-to-Head candidate set on 2026-09-19. Their ratings and match history were left empty for the owner to rank. `data/boarz-final-round-analysis/candidate-import.json` records the source rows, selected Spotify URIs, and app IDs.

This is a staged workflow. **Stage 1, evidence collection, is complete through the available chat snapshot.** Incident relevance, sentiment, expanded conversation boundaries, deduplicated preference signals, and final song recommendations still need review. The WhatsApp database currently ends on 2026-09-19; rerun extraction after the season ends to capture later discussion.

## Stage 1: source-faithful evidence bundle

The local bundle lives under `data/boarz-final-round-analysis/`. This directory is Git-ignored because it contains private chat and ballot content. The extractor scripts and this workflow document are in the repo.

| Evidence | Location | Current result |
| --- | --- | --- |
| Downloaded candidate list | `input/Turnt_Playlist_Data.md` | 11 songs |
| App import record | `candidate-import.json` | 11 unrated round 152 candidates |
| WhatsApp song-link incidents | `whatsapp/link-incidents/` + `link-manifest.json` | 212 incident JSON files from 13,399 messages; 1 message before and 10 after each link |
| WhatsApp remaining corpus | `whatsapp/remaining-corpus.jsonl` | 11,659 messages after removing the union of 1,740 link-incident window message IDs |
| Other music-discussion incidents | `whatsapp/nonlink-incidents/` + `nonlink-manifest.json` | 1,078 keyword hits; up to 10 remaining messages before and after each |
| Submission and voting evidence | `voting/players/` + `voting/index.json` | 10 players, 89 submissions, 696 vote records from nine completed rounds; 414 vote comments and 46 submission comments |
| Joined song metadata snapshot | `voting/song-catalog.json` | 89/89 Spotify tracks matched; duration and album release date for all; artist-level genre tags for 71; local Spotify popularity for 89, Last.fm play counts for 88, lyric word counts for 89, BPM/energy for 24 |
| Candidate metadata snapshot | `candidate-song-catalog.json` | 11/11 Spotify tracks matched, with duration, album date, popularity and source-list fields; artist-level genre tags for 10 |
| Provisional player taste profiles | `profiles/` | Ten Markdown profiles and ten JSON fingerprints with vote counts, missingness, comments, descriptive song features, and attributable WhatsApp statements; no final candidate ranking |

The link pass extracts Spotify and YouTube music-platform URLs. Spotify track links have stable track IDs; YouTube videos may be non-music and are marked unverified. Fifteen likely repeat captures are flagged. Clear text-only song mentions may appear in the non-link set but are not yet resolved to tracks. Its keyword search intentionally favors recall, so some hits are unrelated to music. Both WhatsApp passes order messages by parsed UTC instant and message ID, preserving each original database ID and corpus index.

Regenerate in dependency order from the repo root:

```bash
python scripts/boarz-final-round/extract_whatsapp_links.py
python scripts/boarz-analysis/extract_nonlink_music.py
python scripts/boarz-final-round/export_voting.py
python scripts/boarz-final-round/enrich_spotify_metadata.py
python scripts/boarz-final-round/build_profiles.py
```

The voting exporter and metadata snapshot generator read sources and write separate evidence files; neither changes app votes. The snapshot joins existing `song_popularity`, `song_lyrics_metrics`, `song_audio_features`, `chat_songs`, and `shortlist_songs` rows by Spotify URI before filling gaps from Spotify's API. A recorded zero is distinct from a downvote, and an absent vote is unobserved. Spotify's album date is **not** necessarily the song's original release date; artist genres are **not** track genres. Genre from theme-constrained submissions and ballots gets less weight than voluntary music posts in chat.

## Stage 2: incident review and conversation boundaries

Review every incident with its surrounding messages. For a non-link hit, decide whether the same music conversation began before or continued after the saved 10/10 window. If it did, extend the saved range from the original chronological corpus and record the added message IDs, boundary reason, and where the topic changed. A link-window message may be displayed as context in an extended discussion, but its evaluative signal must keep its original link owner. For a link incident, verify that the URL is actually music and resolve song identity where possible; do not assume every YouTube video is a song.

Each incident should acquire one `analysis` or `signal` object with at least:

```json
{
  "review_status": "music_relevant | unrelated | unresolved",
  "target": { "kind": "song | artist | genre | music_topic", "canonical_id": null, "name": null },
  "boundary_review": { "extended_before_ids": [], "extended_after_ids": [], "reason": null },
  "claims": [
    {
      "player_id": null,
      "evidence_message_ids": [],
      "sentiment": "positive | negative | mixed | neutral",
      "strength": -2,
      "preference_scope": "this_song | artist | genre | production | lyrics | familiarity | theme_fit | other",
      "reason": null,
      "confidence": 0.0
    }
  ],
  "uncertainty": []
}
```

The example is a schema sketch, not a filled assessment. Store the exact words and message IDs behind each claim. Merely posting a link shows interest in sharing, **not** approval. A joke, quotation, reaction emoji, or silence should not become a positive/negative preference without context.

### Attribution across nearby links

Context windows overlap. Before accepting any claim, assign its evaluative message to **one incident owner** in a global `signal-claims` ledger keyed by the evidence message ID. A reply about a specific song belongs to that song's link, even if it also appears in the next link's 10-message window. If two links are plausible and the text cannot disambiguate them, mark the claim unresolved instead of scoring both. A message that explicitly evaluates two distinct songs may contain two separately quoted clauses, but each clause still needs one owner and one target. Repeated links to the same song should be reconciled by canonical track key and message ID.

## Stage 3: player taste and candidate decision

The provisional `profiles/` pass has already calculated positive, negative, and explicit-zero vote counts, missing votes, within-player/within-round ranks, descriptive feature contrasts, and comment-backed examples. It maps WhatsApp aliases through `player_identities` and records directly attributable statements, but its link counts are participation measures rather than endorsements. Keep raw vote and message IDs with every derived measure. Submitted tracks are evidence of self-expression **under the round theme**, so do not treat their genre alone as a durable preference. In the next pass, review the voluntary WhatsApp statements and links over the whole available season, distinguishing the player's own opinion from someone else's reaction to their post.

Report a short taste summary, numerical measures with denominators, and confidence for every player. Spotify metadata fills duration and album-date gaps, but original song release dates and reliable track genres need further verification where they matter. Finally, assess each of the eleven candidate songs for each player with supporting evidence IDs, uncertainty, and likely downvote risk; aggregate across players without hiding polarized responses. Keep the app's Head-to-Head ratings and match picks under the owner's control.
