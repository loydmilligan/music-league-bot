# Boarz WhatsApp non-link music extraction

Run `python scripts/boarz-analysis/extract_nonlink_music.py` from the repository root after the song-link incident files exist in `data/boarz-final-round-analysis/whatsapp/link-incidents/`.

The script reads the Boarz WhatsApp group from `data/league.db` in parsed UTC timestamp order, breaking ties by message ID. Parsing is necessary because the database mixes timestamp formats such as `Z`, `.000Z`, and `+00:00`. This matches the link extractor's `corpus_index`. It excludes the union of message IDs in every link incident's `trigger_message`, `context_before`, and `context_after`. It then writes:

- `data/boarz-final-round-analysis/whatsapp/remaining-corpus.jsonl`: a complete copy of the remaining messages, one JSON object per line.
- `data/boarz-final-round-analysis/whatsapp/nonlink-incidents/*.json`: one file per remaining message with a music vocabulary match, with up to 10 messages before and after from the remaining corpus.
- `data/boarz-final-round-analysis/whatsapp/nonlink-manifest.json`: counts, matched terms, and file paths.

Each incident keeps the exact message text, sender, timestamp, original database fields, stable `chat_messages.id`, original corpus position, trigger terms, and source provenance. The `analysis` field is `null` until a later review assigns music relevance, conversation boundaries, sentiment, and player-specific signals. Keyword matches are candidates; terms such as “vote,” “record,” and “beat” can produce false positives. Explicit song or artist mentions without any matched music term can be missed and need a separate review pass.

Output under `data/` is ignored by Git because it contains private chat content. Re-running the script against the same source and link incident set regenerates the same records and filenames.
