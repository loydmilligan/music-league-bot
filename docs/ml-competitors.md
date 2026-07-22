# Music-League-Style Platforms: Integration and Product Deep Dive

**Research date:** July 19, 2026  
**Prepared for:** Evaluation of alternative game platforms for an existing Music League companion/digest app  
**Platforms reviewed:** Music League, Mixtape Hero, BandJam, YapZap, CutClub

---

## Executive summary

The five services fall into three very different integration classes:

1. **Supported machine-to-machine integration:** **Mixtape Hero**
   - It has a documented Personal Access Token API covering groups, games, rounds, submissions, votes, and completed results.
   - It is the only reviewed platform that currently looks capable of supporting a reliable, automated, read/write integration without depending on file uploads or unsupported scraping.
   - Its API is not complete: user display names, song search, stable cross-DSP song schemas, chat, standings, webhooks, and incremental sync are notable gaps.

2. **Supported batch export:** **Music League** and probably **CutClub**
   - Music League explicitly sells raw league-data export as a premium feature. This is already compatible with the companion app’s current batch-ingestion approach.
   - CutClub’s help center explicitly lists an **Export your data** guide, but the public indexed material does not reveal the exact export format or fields. It should be treated as a promising but unverified batch-integration candidate until a real export is tested.

3. **Feature-rich but externally closed:** **BandJam** and **YapZap**
   - Both appear to store extremely useful internal data and offer richer built-in social, analytics, and discovery features than Music League.
   - I found no supported public API, webhook system, or administrator export for either.
   - Without vendor cooperation, they are poor integration targets even if they are attractive game products.

### Overall recommendation

**Build a Mixtape Hero adapter first.** It provides the best opportunity to turn the companion app from a post-season importer into an active game-data service that can schedule rounds, read anonymous voting-phase submissions, import completed ballots, and potentially submit songs or votes.

**Run a CutClub pilot second.** Its bounded seasons, bracket/survivor/team modes, Slack integration, reactions, and advertised data export could provide meaningful new app features, but the export must be inspected before engineering begins.

**Treat BandJam and YapZap as vendor-partnership opportunities, not reverse-engineering projects.** Their internal data is valuable, but supporting them responsibly requires an official export, API, or integration agreement.

---

## Important corrections and qualifications to the supplied comparison table

Several entries in the starting table require qualification.

| Item | Research finding |
|---|---|
| Music League annual price | Music League’s web subscription page currently advertises a promotional **$12.99/year**, while the Apple App Store still lists **$14.99/year**. Treat the price as channel- and promotion-dependent. |
| Mixtape Hero “advanced penalty cards” | I could not verify a documented penalty-card mechanic in the public product page or supplied OpenAPI specification. The API supports positive and negative vote weights, comments, free-form flair, and submitter guesses. |
| Mixtape Hero “hidden themes” | I could not verify this as a documented product or API feature. Do not make it part of the integration plan without an in-product test. |
| BandJam YouTube support | Spotify and Apple Music have the strongest native integration. BandJam now allows submission by YouTube link, but voters are sent to YouTube to listen. It also offers 30-second previews for supported tracks. |
| YapZap native playback | Full in-app playback is explicitly described for Spotify and Apple Music. Other services are supported through cross-platform matching and links; do not assume native full-track playback for every listed DSP. |
| YapZap monetization | The app is free and includes advertising according to its App Store listing. I did not find public pricing that substantiates a specific premium or in-app-purchase tier. |
| CutClub platform availability | CutClub’s FAQ still says a native app is “coming later,” but its current website and Google Play listing show that iOS and Android player apps now exist. The FAQ is stale. |
| CutClub source services | CutClub says users may submit links from Spotify, Apple Music, YouTube, SoundCloud, and Bandcamp. Its mobile experience and store listing emphasize submitting a YouTube cut and watching entries in a feed, so “YouTube-primary” is more accurate than “YouTube-only.” |
| CutClub bulk credits | The pricing page describes five season credits for $39 but visually labels it “$39 / season.” This appears internally inconsistent and should be confirmed at checkout. |

---

# 1. Evaluation criteria

The companion app currently benefits from a normalized model roughly resembling:

```text
League / community
  ├── Players
  ├── Seasons or league instances
  │    ├── Rounds
  │    │    ├── Theme and deadlines
  │    │    ├── Submissions
  │    │    │    ├── Submitter
  │    │    │    ├── Canonical track
  │    │    │    └── Submission comment
  │    │    ├── Votes
  │    │    │    ├── Voter
  │    │    │    ├── Submission
  │    │    │    ├── Weight
  │    │    │    └── Comment
  │    │    └── Results
  │    └── Standings
  ├── Chat and reactions
  └── Enriched song and player analytics
```

Each service was evaluated on:

- **Supported access:** public API, export, webhook, integration, or neither
- **Completeness:** whether individual ballots, comments, player identities, timestamps, and song identifiers are available
- **Timeliness:** real-time, pollable, phase-based, or only post-season
- **Identity quality:** stable user IDs and usable display names
- **Track identity:** Spotify ID, Apple Music ID, YouTube ID, ISRC, universal link, or only title/artist text
- **Lifecycle fidelity:** deadlines, statuses, anonymous phases, reveals, edits, and missed-player behavior
- **Social data:** comments, chat, reactions, guesses, badges, and flair
- **Operational safety:** supported authentication, rate limits, versioning, and vendor approval
- **Unique product mechanics:** features that could justify extending the companion app’s schema

---

# 2. Summary scorecard

Scores are from 1 to 5. They assess suitability for the companion app, not overall product quality.

| Platform | Supported integration access | Accessible data richness | Cross-DSP flexibility | Unique feature opportunity | Integration risk | Overall companion-app priority |
|---|---:|---:|---:|---:|---:|---:|
| **Music League** | 4 | 4 | 1 | 2 | Low | 4 |
| **Mixtape Hero** | 5 | 4 | 3 | 4 | Medium | **5** |
| **BandJam** | 1 | 1 externally / 5 internally | 4 | 5 | High | 2 |
| **YapZap** | 1 | 1 externally / 5 internally | 5 | 5 | High | 2 |
| **CutClub** | 3, pending export test | 3, pending export test | 4 | 5 | Medium | **4** |

### Why Music League is still a strong baseline

Music League is not the most feature-rich platform, but it has three major advantages:

- The companion app already understands its concepts and export.
- The export is an officially supported product feature rather than an undocumented workaround.
- Its simple Spotify-only model reduces track-normalization ambiguity.

### Why Mixtape Hero ranks first for new engineering

Mixtape Hero is the only reviewed platform with a documented bearer-token API that exposes individual votes and completed result records. It could support both ingestion and selected write operations.

### Why BandJam and YapZap score poorly despite excellent features

The issue is not lack of data. Both products clearly generate detailed data. The issue is **lack of supported access to that data**. A companion app cannot safely depend on information that is visible only inside a mobile client.

---

# 3. Music League

## Product structure

Music League uses the familiar model:

```text
League
  └── Ordered rounds
       ├── Theme
       ├── Anonymous Spotify submissions
       ├── Spotify playlist
       ├── Weighted votes and optional downvotes
       ├── Vote comments
       └── Reveal and cumulative standings
```

A league may contain many rounds, and the platform recommends a weekly cadence. Spotify is required for song search, playlist creation, and playback.

## Supported DSPs and playback

- **Spotify only**
- Playback occurs through Spotify.
- A free Spotify account may work, although Spotify can add tracks to short playlists for free-tier listeners.

### Effect on the companion app

This is the easiest platform to enrich:

- Spotify IDs are stable and directly useful.
- Album, artist, artwork, popularity, and related metadata are comparatively easy to resolve.
- The companion app does not need to decide whether an Apple Music record and a YouTube video represent the same recording.

The downside is exclusion of non-Spotify users and songs that are unavailable on Spotify.

## Integration surface

### Confirmed supported method: raw CSV data export

Music League advertises a premium **Data Export** feature:

> Download your league data in CSV format to analyze voting patterns, track trends, and create custom visualizations.

This is the companion app’s current strength: it can ingest an official, user-initiated data package rather than query undocumented endpoints.

### What the export model does well

For a digest and analytics product, a post-round or post-season export can provide enough data to calculate:

- Round winners and podiums
- Player standings
- Individual vote flows
- Voter generosity
- Superfan and nemesis relationships
- Consensus and divisiveness
- Reciprocity
- Taste similarity
- Song and artist frequency
- Comment analysis
- Cross-season career statistics

Third-party Music League analytics services also demonstrate that the export contains enough information to build vote heatmaps, track-level results, player generosity, taste-twin analysis, genre profiles, and multi-season leaderboards.

### Limitations

- Export is **batch**, not event-driven.
- A human generally has to download and provide the file.
- Public documentation does not guarantee a stable schema.
- There is no supported webhook or incremental “changed since” feed.
- The current public subscription page describes the export only as raw data; it does not publicly enumerate all tables and columns.
- Chat data should not be assumed to be included. The companion app’s separate WhatsApp or Google Chat ingestion remains useful.

## Better than the alternatives for the companion app

- Lowest normalization complexity
- Existing importer and historical compatibility
- Mature, well-understood scoring model
- Strong individual-ballot data after export
- Predictable anonymity/reveal behavior
- Officially supported data portability

## Worse than the alternatives

- Spotify lock-in
- No supported live API
- Limited built-in analytics compared with BandJam
- Fewer alternate competition modes than CutClub
- Fewer native discovery surfaces than YapZap
- Data export is behind a paid subscription
- No write integration for creating rounds or submitting data

## Product opportunities that remain valuable

Even if the group stays on Music League, the companion app can add features that alternatives demonstrate demand for:

- BandJam-style guess-the-submitter analytics
- CutClub-style bracket finale generated from season results
- CutClub-style team and survivor overlays
- YapZap-style radio narration generated from completed rounds
- Cross-DSP universal links for non-Spotify listeners
- Photo-prompt rounds stored in the companion app
- Theme buckets and lineage protection across multiple leagues
- Voting-time engagement heatmaps
- A scheduled “commissioner cockpit” using exported state plus calendar reminders

## Integration verdict

**Continue supporting as the stable baseline.** Music League remains the easiest service for the existing app, but its export-only architecture caps automation. It is best for historical analysis, not for operating the game.

---

# 4. Mixtape Hero

## Product structure

Mixtape Hero is built by members of the original Music League team and uses a related but more flexible hierarchy:

```text
Group
  └── Game
       └── Round
            ├── Submission
            ├── Vote
            └── Completed result
```

The persistent **Group** can contain multiple **Games**, which is useful for treating a friend group as a long-lived community rather than creating an entirely isolated league every season.

## Supported DSPs and playback

- Spotify
- Apple Music
- Playback occurs through the user’s existing streaming service.
- Mixtape Hero does not host audio files.

### Implications

Cross-DSP support is a major user-experience advantage, but it creates a companion-app normalization problem:

- The same recording can have different provider IDs.
- The API’s returned `song` object is provider-specific and not formally stable.
- The API uses an `agnostic_id` when submitting, but the documented specification omits the song-search endpoint that produces it.

The companion app should store:

```text
canonical_track_id
isrc
title
primary_artist
album
duration
version markers
provider_links[]
source_provider
source_provider_id
raw_provider_payload
```

## Integration surface

### Confirmed: Personal Access Token API

The supplied OpenAPI specification documents:

- OpenAPI 3.1.0
- 13 paths
- 21 operations
- HTTP bearer authentication with Personal Access Tokens
- 15 requests per second per IP address

Tokens can be generated from the developer settings area.

### Read operations relevant to the companion app

- List the authenticated user’s groups
- Read group details, games, and membership IDs
- List the authenticated user’s games
- Read game configuration, memberships, and round summaries
- Retrieve submissions once a round enters voting
- Retrieve votes after a round completes
- Retrieve completed round results

### Write operations relevant to the companion app

- Create groups
- Create games
- Join or leave groups and games
- Add multiple future rounds in one request
- Submit one or more songs
- Save vote drafts
- Finalize votes
- Update selected game settings
- Create and revoke API tokens

### Completed-result richness

The completed-results endpoint combines:

- Provider-specific song data
- Submission ID
- Submitter user ID
- Individual votes
- Voter user ID
- Vote weight
- Vote comment
- Vote flair

This is enough to reconstruct a detailed vote graph and generate most of the companion app’s existing digest metrics.

## Anonymity and lifecycle behavior

The API explicitly supports the game’s anonymity boundary:

- During voting, submissions can be retrieved without submitter identity.
- The submitter `user_id` becomes available after completion.
- Individual votes and completed results are available only after completion.

This is better than an export-only service because the companion app could support a **live anonymous listening dashboard** without leaking identities.

## Important API gaps

### User identity

Membership objects contain stable user IDs and links but do not guarantee:

- Display name
- Username
- Avatar
- Email

This is the most serious digest-generation problem. A vote graph using opaque UUIDs is technically complete but socially useless.

**Mitigation:** maintain a league-specific identity map populated by:

- A one-time host mapping screen
- User-provided display names
- Data discovered from authorized browser links
- A future vendor endpoint

### Song search and canonical identity

The submission endpoint requires an `agnostic_id`, but the documented song-search route is missing.

**Mitigation:** for the first adapter, make ingestion read-only. Add submission write support only after the search route is supplied or observed in official documentation.

### Missing integration infrastructure

The API does not document:

- Webhooks
- WebSockets
- Server-sent events
- Updated-since filters
- Incremental cursors
- Pagination
- Bulk export
- Token scopes
- Sandbox environment
- Formal URL versioning

A sync worker must poll and cache completed rounds.

### Missing product resources

The API does not document:

- Chat
- Reactions
- Notifications
- Badges as a separate resource
- Standings
- Podiums
- Season totals
- Player profiles
- Taste analytics
- Playlist creation/export
- Stable provider-independent song schema
- Round edit/delete/pause/reorder operations
- A single-round detail endpoint
- Round deadlines after creation

### Comments, flair, and guesses

- Vote comments and flair are present in documented completed vote records.
- Submission comments are accepted when creating a submission but are not guaranteed in the documented read schema.
- Submitter guesses can be sent with a vote, but the read schema does not guarantee their return.

These need real API fixture tests.

## Better than Music League for the companion app

- Real authenticated API
- Can automate discovery of games and rounds
- Can ingest as soon as a phase changes
- Can retrieve anonymous submissions during voting
- Can create groups, games, and rounds
- Can potentially provide custom submission and voting clients
- Supports Spotify and Apple Music
- Persistent group layer is useful for long-term profiles
- Comments and free-form flair are attached directly to ballots

## Worse than Music League

- User display names are not reliably exposed
- Cross-DSP song objects are harder to normalize
- Missing song-search endpoint blocks a complete write workflow
- No webhooks or incremental sync
- No ready-made standings endpoint
- API appears younger and less operationally mature
- Chat and reactions are unavailable through the API
- Exact scoring and tiebreaking semantics may need local calculation

## New companion-app features enabled by Mixtape Hero

### 1. Live phase-aware league page

The app can display:

- Accepting songs
- Accepting votes
- Complete
- Anonymous ballot availability
- Results import status

### 2. Round scheduler and theme publisher

A host could author a season inside the companion app and batch-create rounds with names, descriptions, song deadlines, and vote deadlines.

### 3. Custom voting interface

The API supports:

- Positive weights
- Negative weights
- Comments
- Flair
- Guessed submitter
- Draft votes
- Finalized votes

This could allow a more expressive ballot than the upstream UI, provided the vendor permits this use.

### 4. Cross-platform song intelligence

A resolved track could show Spotify, Apple Music, YouTube Music, TIDAL, Deezer, and universal links even though the upstream game uses Spotify or Apple Music.

### 5. Near-live digest assembly

The companion app could precompute the playlist narrative during voting and complete the vote-flow analysis immediately after results become available.

## Recommended ingestion flow

```text
1. GET /groups/
2. GET /games/
3. GET /games/{game_id}/
4. Upsert group, game, membership IDs, configuration, and round summaries.
5. For ACCEPTING_VOTES rounds:
     GET submissions
     store anonymous submission records and raw song objects
6. For COMPLETE rounds:
     GET submissions
     GET votes
     GET results
7. Resolve opaque user IDs through the local identity map.
8. Normalize provider song objects into canonical tracks.
9. Cache completed rounds as immutable snapshots.
10. Recalculate standings and digest metrics locally.
```

## Integration verdict

**Best new platform to support.** Start with a read-only completed-round importer, then add phase polling and round creation. Delay song submission and voting write support until the missing song-search and identity issues are resolved.

---

# 5. BandJam

## Product structure

BandJam is a native iOS/Android music-competition app with:

- Private and public leagues
- Scheduled rounds
- Crew-based communities
- Theme buckets
- Configurable submissions and voting
- League and crew chat
- Detailed league and player analytics
- Templates and commissioner roles

The **Crew** layer is especially important. It lets multiple leagues share people and history, while “lineage protection” can prevent song reuse across leagues.

## Supported DSPs and playback

- Spotify
- Apple Music
- YouTube-link submissions
- Automatic shareable playlists for supported preferred services
- 30-second previews in the voting interface for supported tracks
- YouTube submissions open externally in YouTube

BandJam captures ISRC identifiers for supported tracks, which is valuable for cross-provider normalization.

## Integration surface

### Public supported access found

- No public API found
- No public webhook documentation found
- No administrator data-export feature found
- No web client suitable for an official scraping workflow found
- Native iOS and Android apps are the primary player surfaces

The release notes disclose that parts of the product use Firestore and named collections such as `SubmissionComment`, but that is an implementation detail, not permission to query the database.

### What would be available if BandJam exposed it

BandJam appears to internally possess nearly everything the companion app would want:

- Stable users and friendships
- Crews and league memberships
- League settings and templates
- Rounds and status transitions
- Submission timestamps
- Vote drafts and finalized votes
- Positive and negative vote allocations
- Submission guesses
- Submission and voting comments
- Reply threads
- Chat and emoji reactions
- Spotify popularity
- ISRC
- Voting-time heatmaps
- Player and league statistics
- Playlist links
- Notification and engagement state

This could be the richest integration of all five services if a supported export or API were added.

## Better than Music League as a game product

- Spotify and Apple Music support, plus YouTube links
- Strong mobile-first UI
- Scheduled leagues with optional listening periods and breaks
- Rich native analytics
- Voting-pattern heatmaps
- “Hitmaker” and “Crate Digger” popularity metrics
- Guess-the-submitter game
- Best Friend analytics
- Persistent comments and reply threads
- League and crew chat
- Emoji reactions
- Photo prompts
- Theme buckets
- Crew lineage protection
- Public league discovery
- Reusable league templates
- Commissioner delegation
- Optional downvotes
- One-artist-per-round restrictions
- Poke/reminder controls

## Worse than Music League for the companion app

- No supported data portability was found
- No public API or export
- No obvious host-controlled way to download individual ballots
- Mobile-only access makes manual extraction difficult
- Existing built-in analytics overlap with some companion-app value
- Small/new platform means schemas and mechanics may change rapidly
- YouTube submissions may lack normalized music-recording identifiers

## Unique features worth borrowing

### 1. Crew lineage and anti-repeat rules

The companion app could maintain a cross-season record of:

- Previously submitted tracks
- Previously submitted artists
- Theme reuse
- Winner reuse
- “Cooling-off periods” before a track becomes eligible again

This is useful even when the upstream platform does not enforce it.

### 2. Guessing-game analytics

Store guesses as first-class events:

```text
guess {
  voter_id
  submission_id
  guessed_player_id
  correct
  submitted_at
}
```

Possible digest awards:

- Best detective
- Most obvious submitter
- Best disguise
- Most falsely accused player
- Mutual impersonation pair

### 3. Participation timing heatmap

Record when players:

- Submit
- Start voting
- Finalize voting
- Comment
- React

This creates commissioner tools for identifying chronic deadline scramblers and ideal reminder times.

### 4. Photo-prompt rounds

Add an optional image to the companion app’s theme object, independent of upstream support.

### 5. Theme bucket

Allow league members to propose and vote on future themes, then draw from the bucket according to rules.

## Viable integration paths

### Preferred

Ask BandJam for one of:

- Per-league JSON export
- CSV/ZIP export
- Read-only API token
- OAuth application access
- Scheduled webhook for completed rounds
- “Send to companion app” integration

### Acceptable pilot

Use manually entered or share-page result data for a very small proof of concept, without attempting authentication bypass or direct Firestore access.

### Not recommended

- Decompiling the app
- Reusing mobile access tokens
- Querying Firestore directly
- Automating private endpoints without permission
- Depending on UI scraping

## Integration verdict

**Excellent product, poor current integration target.** Contact the developer before investing. A simple completed-round JSON export would move BandJam near the top of the ranking.

---

# 6. YapZap

## Product structure

YapZap has expanded beyond a conventional weekly music league. It now combines:

- Persistent leagues and seasons
- Traditional themed rounds
- Fast-paced Daily YapZap rooms
- Music recognition through Zap
- A personal discovery collection called the Crate
- Geospatial discovery through Scenes
- YapZap Radio with DJ Zap
- CarPlay
- Video leagues
- Public discovery
- Chat, threaded comments, GIFs, and sharing
- iMessage, Apple Watch, widgets, and Discord integration

This is less a single game and more a music-discovery social platform.

## Supported DSPs and playback

Advertised support includes:

- Spotify
- Apple Music
- YouTube Music
- TIDAL
- Amazon Music
- Deezer
- Qobuz

Important nuance:

- Full in-app playback is explicitly described for Spotify and Apple Music.
- The service says it automatically finds songs across services.
- YouTube playlists are auto-generated.
- Other DSPs should be treated as matched links unless tested otherwise.

## Integration surface

### Public supported access found

- No public API found
- No public export found
- No webhook documentation found
- A Discord bot integration exists, but public material does not describe it as a data-export API
- Rich public share links exist for invites, results, and ZapCards

Public result pages might help with low-detail imports, but they should not be assumed to expose complete ballots, timestamps, or all comments.

## Internal data likely available

YapZap’s own features imply that it stores:

- Persistent league and season membership
- Round themes and member suggestions
- Submission drafts
- Individual votes
- Vote allocation state
- Anonymous threaded comments
- GIF reactions
- Win streaks
- Career statistics
- Fans and benched members
- Public/private league settings
- Activity events
- Cross-platform track mappings
- Winning playlists
- Recognition events with time and location
- Scene-level geographic aggregates
- Daily-room fill and voting events
- Zap anti-cheat signals
- Share interactions
- Video submissions

This is extraordinarily valuable data, but it is not externally accessible through a supported interface that I could verify.

## Better than Music League as a game/discovery product

- Broadest cross-DSP promise
- Native Spotify and Apple Music playback
- Persistent communities across seasons
- Round-theme suggestion and voting
- Public and private leagues
- Fast daily rooms
- Music recognition
- Location-based discovery map
- Personal discovery crate
- Radio and CarPlay
- Video leagues
- Threaded comments and GIFs
- Career stats and fan/bench system
- Shareable public results
- iMessage and Discord integrations
- Multi-language support
- AI theme suggestions
- Wikipedia information cards
- Platform-wide “Hits” scoring

## Worse than Music League for the companion app

- No supported export or API found
- Complex cross-DSP matching can produce identity ambiguity
- Multiple game modes require a much broader schema
- Music, video, location, chat, and recognition events increase privacy obligations
- The App Store says the product contains advertising
- The App Store privacy label says multiple categories may be used for tracking and linked to identity
- Built-in analytics and radio overlap with companion-app features
- New and rapidly expanding product surface increases integration volatility

## Unique features worth adding to the companion app

### 1. “Found in the wild” song events

A user could save a song discovered at a bar, show, store, or party and later nominate it to a round.

Possible object:

```text
discovery_event {
  user_id
  canonical_track_id
  occurred_at
  approximate_location
  venue_name
  discovery_method
  note
}
```

Location should be optional and privacy-preserving.

### 2. Scene map

Aggregate discovery and submission trends by broad region or venue without exposing precise player locations.

Possible digest:

- Songs discovered around Los Angeles this month
- Which neighborhoods produce the most league submissions
- Venue-to-round influence
- Travel discoveries that later won a round

### 3. Radio recap

Generate a spoken or text DJ sequence from:

- Theme introduction
- Round winner
- Best comment
- Most divisive track
- Underdog discovery
- Next-round tease

This aligns closely with the existing digest concept.

### 4. Daily micro-rounds

The companion app could run optional rapid side games between weekly rounds:

- 20-minute join window
- 60-minute vote window
- No effect on season standings, or separate side-game rating
- Short playlist or head-to-head format

### 5. Platform-wide discovery score

A local “league hit” score could combine:

- Vote score
- Number of distinct supporters
- Comments
- Saves/favorites
- Cross-league recurrence
- Post-round listening
- Obscurity at submission time

## Privacy and governance concerns

Because YapZap includes location, recognition, chat, advertising, and cross-service identity, an integration should use stricter controls than a normal league importer:

- Make precise location opt-in
- Store coarse regions by default
- Separate private league data from public discovery data
- Do not ingest contacts
- Avoid importing advertising identifiers
- Give users deletion and export controls
- Distinguish user-submitted locations from inferred locations
- Keep Zap anti-cheat data out of the companion app unless clearly necessary

## Integration verdict

**Most ambitious feature inspiration, but not presently a practical data source.** Pursue only through a formal API/export partnership. Its Zap, Scenes, Radio, Daily Rooms, and cross-DSP mapping are excellent ideas for companion-app-native features.

---

# 7. CutClub

## Product structure

CutClub is explicitly season-based:

```text
Club
  └── Season
       ├── 8, 10, or 12 weekly matchups
       ├── One theme per matchup
       ├── One cut per player
       ├── Listening / feed
       ├── Voting, reactions, and comments
       ├── Reveal and recap
       └── Season standings and history
```

The bounded-season model is meaningfully different from Music League’s flexible/perpetual league structure. It makes an ending, recap, champion, and optional tournament feel central rather than incidental.

## Supported DSPs and playback

CutClub’s FAQ says it accepts links from:

- Spotify
- Apple Music
- YouTube
- SoundCloud
- Bandcamp

The current mobile description emphasizes:

- Submitting a YouTube link
- Watching every submission in a single feed
- Voting while watching
- Native feed-style player experience

The correct interpretation is:

- **Submission source:** multi-platform links
- **Primary normalized playback object:** likely YouTube/video
- **Player UX:** in-app feed
- **Track identity quality:** needs testing, especially for SoundCloud and Bandcamp submissions

## Platform availability

- Web administration and season setup
- iOS and Android player apps
- Web access remains available
- The FAQ statement saying there is no native app is stale

## Monetization

Current advertised options include:

- $9.99 per season for unlimited players
- $1.50 per active player per season
- Five season credits advertised for $39, with inconsistent per-season labeling
- $99.99 per year for unlimited seasons
- Free trial season with two rounds and unlimited players

The host or organization pays, rather than every player needing an individual subscription.

## Integration surface

### Confirmed or strongly indicated

- Help Center has a dedicated **Export your data** article.
- Help Center has a dedicated **Slack integration** article.
- Pricing includes Slack integration.
- The product includes recaps, standings, badges, season history, reactions, comments, and push notifications.

### Not yet verified

The publicly indexed help page does not expose the exact export article contents. Before development, obtain a real export and answer:

- Is it CSV, JSON, ZIP, or account-level archive?
- Is export available to every player or only club hosts?
- Does it include a whole club, one season, or only the requesting user?
- Are individual vote records included?
- Are comments and reactions included?
- Are stable player IDs included?
- Are timestamps included?
- Are source URLs and normalized YouTube IDs included?
- Are bracket, survivor, and team events included?
- Are deleted or edited records represented?
- Is there an API behind the export action?

### Likely integration tier

Until tested, CutClub should be classified as:

> **Supported batch export, schema unknown**

It may turn out to be almost as easy as Music League or too incomplete for detailed digest generation.

## Slack integration opportunities

Even if Slack does not expose game data, it can improve the companion workflow:

- Submission deadline reminders
- Voting reminders
- Results announcements
- Digest publication
- Theme suggestions
- Player trash talk and reactions
- Commissioner alerts
- Corporate-team onboarding

A useful architecture would treat Slack messages as a separate social stream linked to the season and matchup, similar to the current WhatsApp/Google Chat approach.

## Alternate game modes

CutClub’s Help Center lists:

- Classic mode
- Blind mode
- Bracket Finale mode
- Survivor mode
- Teams mode

These are the most strategically valuable differences from Music League.

### Bracket Finale

Regular-season results lead into a single-elimination tournament. This can generate:

- Seeding
- Head-to-head matchup votes
- Upsets
- Cinderella runs
- Bracket prediction games
- A separate tournament champion

### Survivor

Players are eliminated over time. The companion app would need:

```text
elimination_event {
  season_id
  round_id
  player_id
  reason
  rank_at_elimination
  points_at_elimination
}
```

### Teams

Collaborative scoring requires:

```text
team
team_membership
team_round_score
team_season_score
```

It unlocks rivalry and chemistry analysis that individual-only Music League cannot support.

## Better than Music League

- Multi-source song links
- Native feed-style playback
- Stronger bounded-season identity
- Recaps and season wraps built into the product
- Emoji reactions and threaded discussion
- Pay-per-season instead of recurring player subscription
- Slack integration
- AI theme generator
- Bracket finale
- Survivor
- Teams
- Clear player app/admin console separation
- Host-friendly corporate use case

## Worse than Music League for the companion app

- Export schema is unverified
- Newer and less mature
- Video-centric identity may not map cleanly to recordings
- Accepted arbitrary links can create duplicate/canonicalization problems
- Fewer public details on vote model and export completeness
- Paid host model may limit casual experimentation
- Existing recaps overlap directly with the companion app
- Fixed 8/10/12-week framing may be less flexible for some groups

## New companion-app features enabled by CutClub concepts

- Bracket generator from regular-season results
- Team-based seasons
- Survivor overlay
- Emoji reaction analytics
- “Defend your pick” structured prompts
- Corporate Slack digest delivery
- Host billing and seat-management dashboards
- Season wrap artifact with awards, rivalry map, and bracket history
- Feed completion tracking: who actually watched/listened before voting

## Integration verdict

**Second-best candidate after Mixtape Hero, pending export inspection.** CutClub may be the best source of new competition formats even if the companion app ultimately continues ingesting Music League data.

---

# 8. Canonical cross-platform data model

Supporting more than one upstream service requires separating the companion app’s model from Music League terminology.

## Community

```typescript
type Community = {
  id: string;
  source: "music_league" | "mixtape_hero" | "bandjam" | "yapzap" | "cutclub";
  sourceCommunityId: string;
  name: string;
  description?: string;
  imageUrl?: string;
};
```

Maps to:

| Platform | Community object |
|---|---|
| Music League | League or recurring player group, depending on current importer |
| Mixtape Hero | Group |
| BandJam | Crew |
| YapZap | Persistent league |
| CutClub | Club |

## Competition instance

```typescript
type Competition = {
  id: string;
  communityId: string;
  sourceCompetitionId: string;
  name: string;
  format: "classic" | "discovery" | "daily" | "bracket" | "survivor" | "teams";
  status: "draft" | "active" | "complete";
  startsAt?: string;
  endsAt?: string;
};
```

Maps to:

| Platform | Competition object |
|---|---|
| Music League | League |
| Mixtape Hero | Game |
| BandJam | League |
| YapZap | Season or Daily room |
| CutClub | Season |

## Round

Add flexible phase fields rather than a single hard-coded Music League status:

```typescript
type Round = {
  id: string;
  competitionId: string;
  sourceRoundId: string;
  name: string;
  description?: string;
  promptImageUrl?: string;
  phase:
    | "not_started"
    | "accepting_submissions"
    | "listening"
    | "accepting_votes"
    | "complete"
    | "cancelled";
  submissionsDueAt?: string;
  listeningStartsAt?: string;
  votesDueAt?: string;
  completedAt?: string;
};
```

## Track and media object

Do not assume every submission is a Spotify track.

```typescript
type CanonicalMedia = {
  id: string;
  mediaType: "track" | "music_video" | "video" | "other_audio";
  title: string;
  primaryArtist?: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  recordingVersion?: string;
  artworkUrl?: string;
  providerLinks: Array<{
    provider:
      | "spotify"
      | "apple_music"
      | "youtube"
      | "youtube_music"
      | "tidal"
      | "amazon_music"
      | "deezer"
      | "qobuz"
      | "soundcloud"
      | "bandcamp";
    providerId?: string;
    url: string;
  }>;
  rawSourcePayload?: unknown;
};
```

## Vote

Support more than numeric Music League points:

```typescript
type Vote = {
  id: string;
  roundId: string;
  submissionId: string;
  voterId: string;
  weight?: number;
  rank?: number;
  choice?: "left" | "right" | "advance" | "eliminate";
  comment?: string;
  flair?: string;
  guessedPlayerId?: string;
  isFinal: boolean;
  createdAt?: string;
  updatedAt?: string;
};
```

## Social event

Unify chat, comments, replies, and reactions:

```typescript
type SocialEvent = {
  id: string;
  scopeType: "community" | "competition" | "round" | "submission" | "result";
  scopeId: string;
  authorId: string;
  eventType: "message" | "comment" | "reply" | "reaction" | "gif";
  body?: string;
  reaction?: string;
  parentEventId?: string;
  createdAt?: string;
};
```

## Special game event

Use extensible events for non-classic formats:

```typescript
type GameEvent = {
  id: string;
  competitionId: string;
  roundId?: string;
  type:
    | "bracket_seeded"
    | "matchup_created"
    | "submission_advanced"
    | "player_eliminated"
    | "team_scored"
    | "song_recognized"
    | "discovery_saved";
  payload: Record<string, unknown>;
  occurredAt?: string;
};
```

---

# 9. Proposed adapter architecture

```text
Upstream source
  ↓
Source adapter
  ↓
Raw immutable source snapshot
  ↓
Normalizer
  ↓
Canonical league database
  ↓
Identity resolver + track resolver
  ↓
Metrics, profiles, digests, dashboards, exports
```

## Required adapter contract

```typescript
interface CompetitionSourceAdapter {
  listCommunities(): Promise<SourceCommunity[]>;
  listCompetitions(communityId?: string): Promise<SourceCompetition[]>;
  getCompetition(id: string): Promise<SourceCompetitionDetail>;
  listRounds(competitionId: string): Promise<SourceRound[]>;
  getRoundData(
    competitionId: string,
    roundId: string
  ): Promise<SourceRoundBundle>;
}
```

Optional capabilities:

```typescript
interface WritableCompetitionSourceAdapter {
  createCompetition?(input: CreateCompetitionInput): Promise<string>;
  createRounds?(competitionId: string, rounds: CreateRoundInput[]): Promise<string[]>;
  submitMedia?(roundId: string, input: SubmitMediaInput): Promise<string>;
  saveVotes?(roundId: string, votes: VoteInput[]): Promise<void>;
  finalizeVotes?(roundId: string): Promise<void>;
}
```

## Capability discovery

Each adapter should declare capabilities:

```json
{
  "read": {
    "communities": true,
    "rounds": true,
    "anonymousSubmissions": true,
    "completedVotes": true,
    "chat": false,
    "reactions": false
  },
  "write": {
    "rounds": true,
    "submissions": false,
    "votes": false
  },
  "sync": {
    "mode": "poll",
    "incremental": false,
    "webhooks": false
  }
}
```

This prevents the UI from promising features an upstream service cannot support.

## Raw-source retention

Store the original source records before normalization. This protects against:

- Schema changes
- Incorrect track matching
- Revised identity mappings
- New analytics fields
- Audit disputes
- Needing to regenerate old digests

## Identity mapping

Create a cross-source identity table:

```text
person
source_identity
community_membership
display_name_history
manual_alias
```

Do not merge users automatically on display name alone.

## Track normalization strategy

1. Prefer ISRC when present.
2. Otherwise use provider IDs and cross-platform resolver results.
3. Compare normalized artist/title/album/duration.
4. Distinguish:
   - studio version
   - live version
   - remix
   - remaster
   - cover
   - music video
5. Preserve all source links.
6. Assign a confidence score.
7. Allow manual correction.

---

# 10. Controlled platform test plan

Before committing to any adapter, run the same controlled game on each candidate.

## Test league

- Four test users
- Three rounds
- Two submissions per user in one round if supported
- One Spotify-only song
- One Apple Music-origin song
- One YouTube-only recording
- One song with multiple versions
- One duplicate artist
- One explicit track
- One missed submission
- One missed ballot
- Positive votes
- Negative vote
- Vote comment
- Submission comment
- Reply or reaction
- Submitter guess
- Edited comment
- Deleted comment, if supported

## Capture points

Capture data at:

1. League creation
2. Round scheduled
3. Submission phase
4. Listening phase
5. Voting phase
6. Immediately after reveal
7. End of season
8. After a user leaves
9. After an admin edits a round
10. After export or API token revocation

## For export platforms

Inspect:

- File names
- Encoding
- Delimiters
- IDs
- Foreign-key relationships
- Time zones
- Null handling
- Deleted records
- Anonymous-phase behavior
- Comments and reactions
- Full individual ballots
- Source track URLs and IDs
- User display names
- Schema version

## For API platforms

Test:

- Authentication
- Token expiration and revocation
- Rate-limit headers
- 401/403/404 behavior
- Anonymous submissions
- Post-reveal identity
- Vote draft versus final behavior
- Idempotency
- Duplicate submissions
- Pagination
- Provider-specific song payloads
- Result consistency across endpoints

---

# 11. Vendor questions

Send a concise version of these questions to BandJam, YapZap, and CutClub.

## Data access

1. Do you offer a supported API, export, or webhook for a league administrator?
2. Can a host retrieve all rounds, submissions, individual votes, comments, reactions, and player IDs?
3. Is there a completed-round JSON payload?
4. Is export available per round, season, or entire community?
5. Are stable IDs included?
6. Are timestamps included?
7. Are deleted and edited records represented?
8. Is the export schema versioned?

## Authentication and permissions

1. Do you support personal access tokens, OAuth, or service accounts?
2. Can access be limited to read-only?
3. Can a league host authorize a third-party companion app?
4. Can a user revoke access?
5. Are there rate limits?

## Events

1. Can the platform send a webhook when:
   - a round opens,
   - submissions close,
   - voting opens,
   - voting closes,
   - results publish?
2. Is there an updated-since cursor or event log?

## Song identity

1. Do records include ISRC?
2. Are Spotify, Apple Music, YouTube, and other provider IDs retained?
3. How are live versions, remixes, and covers distinguished?
4. Is a provider-independent track ID available?

## Commercial and policy

1. Is third-party digest/analytics use permitted?
2. Is attribution required?
3. May completed results be stored long-term?
4. May users publish generated recaps?
5. Is there a partnership or developer program?

---

# 12. Recommended implementation roadmap

## Phase 1: Generalize the existing importer

Goal: remove Music League assumptions from the internal schema.

- Add `source` and `source_id` to every upstream object.
- Introduce Community, Competition, Round, Submission, Vote, SocialEvent, and GameEvent.
- Add cross-DSP provider-link support.
- Preserve raw source payloads.
- Add identity-map UI.
- Add import provenance and schema version.

## Phase 2: Mixtape Hero read-only adapter

- Personal Access Token storage
- Group/game discovery
- Game and round sync
- Anonymous submissions during voting
- Completed results import
- User-ID mapping
- Provider-song normalization
- Polling and immutable completion cache
- Digest generation parity with Music League

### Exit criteria

A completed Mixtape Hero round produces the same core digest sections as a Music League round:

- Podium
- Standings impact
- Vote flow
- Consensus/divisiveness
- Best comments
- Player taste-profile updates

## Phase 3: Mixtape Hero commissioner tools

- Batch-create future rounds
- Theme library integration
- Deadline calendar
- Submission/voting reminder layer
- Optional custom ballot prototype

Do not ship submission write support until `agnostic_id` song search is resolved.

## Phase 4: CutClub export pilot

- Run the controlled two-round trial
- Download host export
- Document schema
- Implement parser if individual ballots and stable player IDs exist
- Import Slack social context separately
- Model bracket, survivor, and teams events

## Phase 5: Vendor outreach

Approach BandJam and YapZap with a concrete proposal:

> Provide a read-only completed-round API or downloadable JSON export. In exchange, the companion app creates richer recaps, historical analytics, and cross-platform taste profiles while linking users back to the upstream game.

A small completed-round endpoint is more realistic than requesting their entire internal API.

## Phase 6: Cross-platform features

After two sources work reliably:

- Cross-platform player profiles
- Track identity confidence UI
- Universal listening links
- Cross-service career records
- Bracket finale generator
- Team seasons
- Survivor side game
- Radio-style digest
- Theme bucket and lineage protection
- Guessing-game analytics

---

# 13. Final platform recommendations

## Best technical integration: Mixtape Hero

Choose Mixtape Hero when the goal is to automate the companion app and potentially operate parts of the game from it.

**Primary risk:** incomplete identity and song-search APIs.

## Best current stability: Music League

Stay with Music League when reliable historical ingestion matters more than live automation or cross-DSP access.

**Primary risk:** batch export and Spotify lock-in.

## Best new format candidate: CutClub

Test CutClub when bracket, survivor, teams, reactions, Slack, and bounded seasons are strategically valuable.

**Primary risk:** export completeness is unknown.

## Best built-in analytics and league administration: BandJam

Consider BandJam when the group wants a richer native app and can accept that the companion app may have little or no data access.

**Primary risk:** externally closed data.

## Best discovery ecosystem: YapZap

Consider YapZap when music recognition, maps, daily rooms, radio, video, and cross-DSP discovery matter more than companion-app integration.

**Primary risk:** externally closed data, complex privacy surface, and unclear monetization details.

---

# 14. Suggested decision

For the companion app, the best sequence is:

1. **Retain Music League support.**
2. **Add Mixtape Hero as the first true API adapter.**
3. **Pilot CutClub and inspect its export.**
4. **Ask BandJam for a completed-round export/API.**
5. **Ask YapZap for an API or export only if its discovery features are strategically important.**

This produces a sensible portfolio:

- **Music League:** mature batch source
- **Mixtape Hero:** automated API source
- **CutClub:** alternate-format source
- **BandJam/YapZap:** future partnership sources

The architecture should be designed so a platform is not considered “supported” merely because the companion app can display a public results page. Full support should require stable identities, submissions, individual ballots, comments, track identifiers, and repeatable authorized access.

---

# Sources

## Music League

- [Music League home](https://musicleague.com/)
- [Music League subscription and data export](https://app.musicleague.com/subscription/about/)
- [Music League user guide](https://musicleague.dev/user-guide/)
- [Music League on the Apple App Store](https://apps.apple.com/us/app/music-league/id1589815321)
- [Music League on Google Play](https://play.google.com/store/apps/details?id=com.musicleague.app)
- [Independent example of analytics produced from a Music League export](https://musicleaguestats.com/)

## Mixtape Hero

- [Mixtape Hero product site](https://mixtapehero.app/)
- [Mixtape Hero API documentation route](https://mixtapehero.app/api-docs/)
- [Mixtape Hero developer settings](https://mixtapehero.app/settings/developer/)
- Supplied Mixtape Hero OpenAPI 3.1 specification and the previously prepared verified API guide in the user’s file library

## BandJam

- [BandJam product site](https://bandjam.app/)
- [BandJam on the Apple App Store](https://apps.apple.com/us/app/bandjam-music-competitions/id6756460555)
- [BandJam on Google Play](https://play.google.com/store/apps/details?id=app.bandjam)

## YapZap

- [YapZap product site](https://yapzap.com/)
- [YapZap on the Apple App Store](https://apps.apple.com/us/app/yapzap-music-video-leagues/id6748430650)

## CutClub

- [CutClub product site and pricing](https://www.playcutclub.com/)
- [CutClub FAQ](https://www.playcutclub.com/faq)
- [CutClub Help Center](https://www.playcutclub.com/help)
- [CutClub on Google Play](https://play.google.com/store/apps/details?id=com.cutclub.app)

---

## Confidence note

This report distinguishes between:

- **Confirmed:** explicitly described by an official product page, app-store listing, help center, or supplied OpenAPI specification
- **Strongly indicated:** required by a named feature or exposed in release notes, but not available through a public integration interface
- **Unknown:** no public documentation found

Absence of a public API or export in this research does not prove that a private partner API does not exist. It means a third-party companion app should not plan around one until the vendor confirms access.
