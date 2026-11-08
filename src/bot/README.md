# Bot Orchestration

This folder should contain the high-level pipeline:

1. Receive parsed WhatsApp message.
2. Resolve song.
3. Evaluate rules.
4. Add to playlists.
5. Store audit data.
6. Reply to WhatsApp.

## Player commands (catch-up preview)

DM only, and only for people listed in the catch-up preview config. A group @-mention of any of these just gets an emoji.

- `top-songs`, `top-pics`, `top-videos`, `top-links`, `top-media`: each takes an optional `week`.
- `pick one`: a ranked pick: mentions of you first, then group heat, then your taste, plus a little randomness.
- `list-topics`, `show-topic N`, `my-dossier`.
- `morning-recap sub`, `morning-recap unsub`, `morning-recap <time>`: opt-in recap DM. A once-a-minute tick sends at most one DM per 10 s, only after the day's recap went live to the group (never on a dry run). Subscriptions are in `data/recap-subs.json` (0600, raw DM ids, never logged).
- `catch me up` and `help` also work by DM.
