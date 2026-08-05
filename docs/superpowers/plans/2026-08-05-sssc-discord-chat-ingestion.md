# SSSC Discord Chat Ingestion + Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the SSSC Discord "MusicLeague" thread into `chat_messages`, link the roster in `player_identities`, and enable the standard digest chat-notes section for `sssc` — so R163 "Ink worthy" renders chat notes.

**Architecture:** A pure line parser turns the Discord export format into `{sender, text, tsMs}` records; a Node script feeds them through the existing `ingestMessage()` (idempotent via `msg_hash`) with `platform='discord'`, `group_name='sssc'`. A second script materializes the authoritative roster (players + `discord`/`music-league` identities) from the spec's Appendix A. Small widenings let the existing chat-section pipeline treat `discord` as a first-class platform.

**Tech Stack:** TypeScript (parser, in `ui/src/lib`), Node `.mjs` scripts, `better-sqlite3`, vitest.

## Global Constraints

- DB is `data/league.db` (override with `DATA_DIR`/`LEAGUE_DB`); it is the prod bind-mounted volume, so **data writes (chat rows, identities, settings) are immediately live to prod** — no deploy needed for data. **Code changes (parser, platform widening, CHECK migration) require a prod deploy** (`docker compose build bot-ui && up -d --force-recreate bot-ui`, then bundle-assert) per `docs/dev-loop-playbook.md`.
- Chat identity/platform string is **`'discord'`** everywhere: `chat_messages.platform`, `player_identities.identity_type`, and the `buildChatSection`/`buildChatRoster` platform arg.
- League slug is `sssc`; chat `group_name` is `sssc`; roster is the authoritative table in `docs/superpowers/specs/2026-08-05-sssc-guesser-and-discord-chat-design.md` Appendix A (25 mapped, 3 ML-only).
- Correct source files: `~/Downloads/MusicLeague-thread-log_2026-{03,04,05,06,07,08}.txt`. (The `#general` export was the wrong channel; already quarantined to `~/.claude-trash/`.)
- Run impact analysis before editing any existing symbol and `detect_changes()` before each commit (project CLAUDE.md).

---

### Task 1: Allow `discord` as an identity type (CHECK migration)

`player_identities.identity_type` has `CHECK(identity_type IN ('whatsapp','google-chat','music-league'))`. SQLite can't alter a CHECK in place, so rebuild the table once, preserving rows.

**Files:**
- Modify: `ui/src/lib/db/client.ts` (add a guarded migration in `openLeagueDb`, near the other `ALTER TABLE` blocks)
- Test: `ui/src/lib/db/playerIdentitiesDiscord.test.ts`

**Interfaces:**
- Produces: after `openLeagueDb()`, inserting a `player_identities` row with `identity_type='discord'` succeeds.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/db/playerIdentitiesDiscord.test.ts
import { describe, it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { randomUUID } from 'node:crypto';

describe('discord identity type', () => {
  it('accepts identity_type = discord after migration', () => {
    const db = openLeagueDb(`/tmp/pi-${randomUUID()}.db`);
    const p = db.prepare("INSERT INTO players (name) VALUES ('x') RETURNING id").get() as { id: number };
    expect(() =>
      db.prepare(
        "INSERT INTO player_identities (player_id, identity_type, identifier) VALUES (?, 'discord', 'Dogsweat')",
      ).run(p.id),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/playerIdentitiesDiscord.test.ts`
Expected: FAIL — `CHECK constraint failed: identity_type`.

- [ ] **Step 3: Add the migration** (run impact first: `impact({target:"openLeagueDb", direction:"upstream", repo:"music-league-bot"})`)

Insert into `openLeagueDb`, after the existing `player_identities`/draft column migrations:

```ts
// Widen player_identities.identity_type to allow 'discord'. SQLite cannot ALTER
// a CHECK, so rebuild once when the current CHECK is the pre-discord one.
const piSql = (db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='player_identities'",
).get() as { sql?: string } | undefined)?.sql ?? '';
if (piSql && !piSql.includes("'discord'")) {
  db.exec(`
    CREATE TABLE player_identities_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
      identity_type TEXT NOT NULL CHECK(identity_type IN ('whatsapp','google-chat','music-league','discord')),
      identifier TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO player_identities_new (id, player_id, league_id, identity_type, identifier, created_at)
      SELECT id, player_id, league_id, identity_type, identifier, created_at FROM player_identities;
    DROP TABLE player_identities;
    ALTER TABLE player_identities_new RENAME TO player_identities;
  `);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/playerIdentitiesDiscord.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/client.ts ui/src/lib/db/playerIdentitiesDiscord.test.ts
git commit -m "feat(db): allow 'discord' identity type (guarded table rebuild)"
```

---

### Task 2: Discord log parser

Pure function that turns the export text into records. Format:
`[MM/DD/YYYY, HH:MM AM/PM UTC] Display Name: message`. Handles: 3-line header, `(edited)…`/`Spoiler` trailers, non-`[` continuation lines appended to the prior message, and collapsing **consecutive** duplicate (sender,text) pairs (an export artifact).

**Files:**
- Create: `ui/src/lib/import/discordChat.ts`
- Test: `ui/src/lib/import/discordChat.test.ts`

**Interfaces:**
- Produces: `parseDiscordLog(raw: string): DiscordMessage[]` where
  `interface DiscordMessage { sender: string; text: string; tsMs: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/import/discordChat.test.ts
import { describe, it, expect } from 'vitest';
import { parseDiscordLog } from './discordChat.js';

const SAMPLE = [
  'south side secret club - "MusicLeague" thread (musics-chat) log',
  'Month: March 2026',
  'Total messages: 3',
  '',
  '[03/01/2026, 07:57 AM UTC] KarBen (MDR): I shall soon',
  '[03/01/2026, 05:31 PM UTC] Dogsweat 🚂: bullets stuff.Spoiler (edited)Sunday, March 1, 2026 at 9:32 AM',
  '[03/01/2026, 11:08 PM UTC] missmara: line one',
  'still missmara continued',
  '[03/01/2026, 11:08 PM UTC] missmara: line one',
].join('\n');

describe('parseDiscordLog', () => {
  it('parses records, strips edited trailer, joins continuations, drops consecutive dupes', () => {
    const msgs = parseDiscordLog(SAMPLE);
    expect(msgs.map((m) => m.sender)).toEqual(['KarBen (MDR)', 'Dogsweat 🚂', 'missmara']);
    expect(msgs[0].tsMs).toBe(Date.parse('2026-03-01T07:57:00Z'));
    expect(msgs[1].text).toBe('bullets stuff.');            // trailer stripped
    expect(msgs[2].text).toBe('line one\nstill missmara continued'); // continuation joined
    // the 4th line is a consecutive duplicate of msg[2] → collapsed, so only 3 total
    expect(msgs).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/import/discordChat.test.ts`
Expected: FAIL — module not found / `parseDiscordLog` undefined.

- [ ] **Step 3: Implement the parser**

```ts
// ui/src/lib/import/discordChat.ts
export interface DiscordMessage { sender: string; text: string; tsMs: number }

const LINE_RE = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}) (AM|PM) UTC\]\s+(.+?):\s([\s\S]*)$/;

/** Strip Discord's edit trailer: optional "Spoiler" then "(edited)<weekday date…>". */
function stripTrailer(text: string): string {
  return text.replace(/\s*(?:Spoiler\s*)?\(edited\).*$/s, '').trimEnd();
}

function toMs(mm: string, dd: string, yyyy: string, hh12: string, min: string, ap: string): number {
  let h = parseInt(hh12, 10) % 12;
  if (ap === 'PM') h += 12;
  const iso = `${yyyy}-${mm}-${dd}T${String(h).padStart(2, '0')}:${min}:00Z`;
  return Date.parse(iso);
}

export function parseDiscordLog(raw: string): DiscordMessage[] {
  const out: DiscordMessage[] = [];
  for (const line of raw.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) {
      // Continuation of the previous message (multi-line body). Ignore stray
      // lines before the first message (header).
      if (out.length && line.trim()) out[out.length - 1].text += '\n' + line;
      continue;
    }
    const [, mm, dd, yyyy, hh, min, ap, sender, body] = m;
    const tsMs = toMs(mm, dd, yyyy, hh, min, ap);
    if (Number.isNaN(tsMs)) continue;
    out.push({ sender: sender.trim(), text: stripTrailer(body), tsMs });
  }
  // Strip trailers again after continuations were appended, then collapse
  // consecutive duplicate (sender,text) pairs — an export artifact.
  const cleaned: DiscordMessage[] = [];
  for (const msg of out) {
    msg.text = stripTrailer(msg.text).trim();
    if (!msg.text) continue;
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.sender === msg.sender && prev.text === msg.text) continue;
    cleaned.push(msg);
  }
  return cleaned;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/import/discordChat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/import/discordChat.ts ui/src/lib/import/discordChat.test.ts
git commit -m "feat(import): Discord thread-log parser"
```

---

### Task 3: Discord ingest script

Reads the 6 monthly files, parses, and inserts via the existing `ingestMessage()` with `platform='discord'`, `group_name='sssc'`. Idempotent (INSERT OR IGNORE on `msg_hash`). Prints inserted/skipped so re-runs are verifiable.

**Files:**
- Create: `scripts/import-discord-chat.mjs`
- (Consumes: `parseDiscordLog` from Task 2; `ingestMessage` from `src/storage/chatMessagesDb.ts`.)

**Interfaces:**
- Produces (CLI): `node scripts/import-discord-chat.mjs <group_name> <glob-or-files...>` → prints `{inserted, skipped, total}`.

- [ ] **Step 1: Write the script**

```js
// scripts/import-discord-chat.mjs
// Usage: node scripts/import-discord-chat.mjs sssc ~/Downloads/MusicLeague-thread-log_2026-*.txt
import { readFileSync } from 'node:fs';
import { parseDiscordLog } from '../ui/src/lib/import/discordChat.ts';
import { ingestMessage } from '../src/storage/chatMessagesDb.ts';

const [groupName, ...files] = process.argv.slice(2);
if (!groupName || files.length === 0) {
  console.error('usage: import-discord-chat.mjs <group_name> <file...>');
  process.exit(1);
}
let inserted = 0, total = 0;
for (const f of files) {
  const msgs = parseDiscordLog(readFileSync(f, 'utf-8'));
  for (const m of msgs) {
    total++;
    if (ingestMessage({ platform: 'discord', groupName, sender: m.sender, text: m.text, tsMs: m.tsMs })) inserted++;
  }
}
console.log(JSON.stringify({ inserted, skipped: total - inserted, total }));
```

Run it with a `.ts`-aware runner (the repo uses `tsx`): `npx tsx scripts/import-discord-chat.mjs ...`. If `.ts` imports from `.mjs` are awkward, convert the file to `.ts` and run under `tsx`.

- [ ] **Step 2: Dry-run against a DB copy**

`chatMessagesDb.ts` resolves its DB as `resolve(DATA_DIR ?? 'data', 'league.db')`, so point `DATA_DIR` at a directory holding a copy:

```bash
mkdir -p /tmp/scr && cp data/league.db /tmp/scr/league.db
DATA_DIR=/tmp/scr npx tsx scripts/import-discord-chat.mjs sssc ~/Downloads/MusicLeague-thread-log_2026-*.txt
```
Expected: `inserted` ≈ total parsed (first run), `skipped` 0.

- [ ] **Step 3: Verify idempotency**

Run the same command again against `/tmp/scr`.
Expected: `inserted: 0`, `skipped` = total (all dedup by `msg_hash`).

- [ ] **Step 4: Verify counts & sanity**

```bash
sqlite3 /tmp/scr/league.db "SELECT COUNT(*), MIN(ts), MAX(ts) FROM chat_messages WHERE group_name='sssc' AND platform='discord';"
sqlite3 /tmp/scr/league.db "SELECT sender, COUNT(*) c FROM chat_messages WHERE group_name='sssc' GROUP BY sender ORDER BY c DESC LIMIT 8;"
```
Expected: a few thousand rows spanning 2026-03..08; top senders are known regulars (MrKlorox, PoetryInNoise, Dogsweat 🚂…).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-discord-chat.mjs
git commit -m "feat(scripts): ingest SSSC Discord thread into chat_messages"
```

---

### Task 4: Materialize the SSSC roster

Create/link a `players` row per SSSC person and write their `discord` identity (and, where useful, a `music-league` identity) scoped to `sssc`, from Appendix A. Skips the 3 ML-only people's discord rows (Aniss, Kelly Jean, sparklepants13). Idempotent.

**Files:**
- Create: `scripts/seed-sssc-roster.mjs` (embeds the Appendix-A map)
- Test: `ui/src/lib/db/ssscRoster.test.ts` (asserts `buildChatRoster` resolves the mapped senders)

**Interfaces:**
- Consumes: `players(name, ml_competitor_id)`, `competitors(id,name)`, `player_identities(player_id, league_id, identity_type='discord', identifier=<discord sender>)`.
- Produces: for `sssc`'s `league_id`, `buildChatRoster(db, leagueId, [<discord sender>], 'discord', 'sssc').resolve(<discord sender>)` returns a mapped (non-unmapped) person.

- [ ] **Step 1: Write the script (data-driven from Appendix A)**

```js
// scripts/seed-sssc-roster.mjs
// ML competitor name -> Discord sender (null = ML-only, no discord identity)
const MAP = {
  'Boonie Dogsweat': 'Dogsweat 🚂', 'Cherry': 'Libby/Cherry', 'KarBen': 'KarBen (MDR)',
  'Lexa Prole': 'lexa prole', 'Mouse Atreides': 'Mouse Atreides', 'PoetryinNoise': 'PoetryInNoise',
  'TekniKali.Mo': 'Kali', 'Tragically Skip': 'TragicallySkip', 'a1mrson': 'a1mrson',
  'antigravpjs': 'antigravpjs', 'bagimation': 'bagimation', 'bump versino': 'bump versino',
  'frankenberge': 'frankenberge', 'missmara': 'missmara', 'mrklorox': 'MrKlorox',
  'nateoeb': 'NateOEB', 'socalledbutton': 'socalledbutton',
  'Timmywhatup': 'timmyg (the g is for whatup)', 'GoodGollyMiss': '🌙✨good.golly.ms✨🌙',
  'jirafa': 'lithogiraffe', 'Dylan/Brannigans_L4w': "Brannigan's Law", 'dubs613': 'dubc_613',
  'Heath DG': 'FanonAndOn (AndOnAndOn)', 'Aidan': 'falseaidentity', 'nowlistenallison': 'zewskers',
  'Aniss': null, 'Kelly Jean': null, 'sparklepants13': null,
};
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
const db = new Database(resolve(process.env.DATA_DIR ?? 'data', 'league.db'));
const league = db.prepare("SELECT id FROM leagues WHERE slug='sssc'").get();
if (!league) throw new Error('sssc league row missing');

// competitor name -> {id (ml competitor id string), player_id}
const comps = db.prepare(`
  SELECT DISTINCT c.id AS ml_id, c.name
  FROM competitors c JOIN ml_submissions s ON s.competitor_id=c.id
  JOIN rounds r ON r.id=s.round_id JOIN seasons se ON se.id=r.season_id
  WHERE se.league_id=?`).all(league.id);
const byName = new Map(comps.map((c) => [c.name, c.ml_id]));

const findPlayer = db.prepare('SELECT id FROM players WHERE ml_competitor_id=?');
const insPlayer = db.prepare('INSERT INTO players (name, ml_competitor_id) VALUES (?, ?) RETURNING id');
const hasIdent = db.prepare(
  'SELECT 1 FROM player_identities WHERE player_id=? AND league_id=? AND identity_type=? AND identifier=?');
const insIdent = db.prepare(
  'INSERT INTO player_identities (player_id, league_id, identity_type, identifier) VALUES (?,?,?,?)');

let players = 0, idents = 0, missing = [];
const tx = db.transaction(() => {
  for (const [comp, discord] of Object.entries(MAP)) {
    const mlId = byName.get(comp);
    if (!mlId) { missing.push(comp); continue; }
    let p = findPlayer.get(mlId);
    if (!p) { p = insPlayer.get(comp, mlId); players++; }
    for (const [type, ident] of [['music-league', mlId], ['discord', discord]]) {
      if (!ident) continue;
      if (!hasIdent.get(p.id, league.id, type, ident)) { insIdent.run(p.id, league.id, type, ident); idents++; }
    }
  }
});
tx();
console.log(JSON.stringify({ playersCreated: players, identitiesCreated: idents, missingCompetitors: missing }));
```

- [ ] **Step 2: Run against the DB copy from Task 3**

```bash
DATA_DIR=/tmp/scr node scripts/seed-sssc-roster.mjs
```
Expected: `missingCompetitors: []`; ~25 discord identities + up to 28 music-league identities created.

- [ ] **Step 3: Write the roster resolution test**

```ts
// ui/src/lib/db/ssscRoster.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildChatRoster } from '../digest/chatRoster.js';

// Points at the seeded copy produced by the scripts above.
const DB = process.env.SSSC_TEST_DB ?? '/tmp/scr/league.db';

describe('sssc roster', () => {
  it('resolves mapped discord senders to players', () => {
    const db = new Database(DB, { readonly: true });
    const { id } = db.prepare("SELECT id FROM leagues WHERE slug='sssc'").get() as { id: number };
    const roster = buildChatRoster(db, id, ['Dogsweat 🚂', 'MrKlorox', 'zewskers'], 'discord', 'sssc');
    expect(roster.resolve('Dogsweat 🚂')?.unmapped).toBe(false);
    expect(roster.resolve('zewskers')?.unmapped).toBe(false); // = nowlistenallison
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd ui && npx vitest run src/lib/db/ssscRoster.test.ts`
Expected: PASS (needs `buildChatRoster` to accept `'discord'` — Task 5 widens the type; if run before Task 5, cast the arg. Order Task 5 before this step if the type errors.)

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-sssc-roster.mjs ui/src/lib/db/ssscRoster.test.ts
git commit -m "feat(scripts): materialize SSSC roster identities"
```

---

### Task 5: Treat `discord` as a first-class chat platform

Widen the platform unions and the digest's platform derivation so a `discord` group resolves `discord` identities (today it falls through to `whatsapp`).

**Files:**
- Modify: `ui/src/lib/digest/chatRoster.ts` (`buildChatRoster` platform param type)
- Modify: `ui/src/lib/digest/chatSection.ts` (`buildChatSection` `platform?` type)
- Modify: `ui/src/routes/digest/[roundId]/+page.server.ts:259-263` (platform derivation)
- Test: extend `ui/src/lib/db/ssscRoster.test.ts` (already passes `'discord'`)

**Interfaces:**
- Produces: `platform: 'whatsapp' | 'google-chat' | 'discord'` accepted by `buildChatRoster` and `buildChatSection`.

- [ ] **Step 1: Widen the types** (impact first on `buildChatRoster`, `buildChatSection`)

In `chatRoster.ts`: `platform: 'whatsapp' | 'google-chat' | 'discord' = 'whatsapp'`.
In `chatSection.ts`: `platform?: 'whatsapp' | 'google-chat' | 'discord';`.

- [ ] **Step 2: Fix the digest platform derivation**

Replace the ternary at `ui/src/routes/digest/[roundId]/+page.server.ts:259-263` with:

```ts
const rawPlatform = (db
  .prepare('SELECT platform FROM chat_messages WHERE group_name = ? LIMIT 1')
  .get(groupName) as { platform?: string } | undefined)?.platform;
const platform =
  rawPlatform === 'googlechat' ? ('google-chat' as const)
  : rawPlatform === 'discord' ? ('discord' as const)
  : ('whatsapp' as const);
```

- [ ] **Step 3: Type-check**

Run: `cd ui && npm run check`
Expected: no NEW errors from these files (pre-existing digest-page errors unrelated).

- [ ] **Step 4: Run roster test**

Run: `cd ui && SSSC_TEST_DB=/tmp/scr/league.db npx vitest run src/lib/db/ssscRoster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/chatRoster.ts ui/src/lib/digest/chatSection.ts "ui/src/routes/digest/[roundId]/+page.server.ts"
git commit -m "feat(digest): treat discord as a first-class chat platform"
```

---

### Task 6: Wire SSSC into the chat section (group map + enable) and enable default

The digest reads `getChatSettings(db).leagueGroupMap['sssc']` for the group name and `chatSectionEnabledFor(db,'sssc')` for opt-in. Set both, and add `sssc` to the code default so a fresh DB behaves.

**Files:**
- Modify: `ui/src/lib/digest/chatSection.ts` (`CHAT_SECTION_DEFAULTS`: add `'sssc': false` — keep off by default; enabled via setting)
- Data step (no code): write the two settings rows.

- [ ] **Step 1: Add `sssc` to `CHAT_SECTION_DEFAULTS`**

Add `'sssc': false,` to the map at `chatSection.ts:266`. (Explicit entry documents the league; actual enablement is the setting below.)

- [ ] **Step 2: Set the group map + enable, on the DB copy first**

Inspect the current `chat_settings` shape, then set the map key and enable flag. `leagueGroupMap` lives inside the `chat_settings` JSON setting; `chatSectionEnabledFor` reads the `chat_section_leagues` JSON setting.

```bash
DATA_DIR=/tmp/scr npx tsx -e "
import { getDb } from './ui/src/lib/db/client.js';
import { getChatSettings, saveChatSettings } from './ui/src/lib/db/chatSettings.js'; // confirm module path
import { setChatSectionEnabled } from './ui/src/lib/digest/chatSection.js';
const db = getDb();
const s = getChatSettings(db); s.leagueGroupMap['sssc']='sssc'; saveChatSettings(db, s);
setChatSectionEnabled(db, 'sssc', true);
console.log(getChatSettings(db).leagueGroupMap, 'enabled=', require('./ui/src/lib/digest/chatSection.js').chatSectionEnabledFor(db,'sssc'));
"
```
> Before running: `grep -rn "getChatSettings\|leagueGroupMap\|saveChatSettings" ui/src/lib/db` to confirm the exact module + save function names; adjust imports. If there is a Settings UI action for the league→group map, using it is equivalent.

- [ ] **Step 3: Commit the code default**

```bash
git add ui/src/lib/digest/chatSection.ts
git commit -m "feat(digest): register sssc for the chat section (off by default)"
```

---

### Task 7: Deploy, run the real ingest/seed on prod data, verify R163

**Files:** none (deploy + data ops).

- [ ] **Step 1: `detect_changes()` then deploy**

Run `detect_changes({repo:"music-league-bot"})`; confirm only the expected symbols. Then per the playbook:
```bash
docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
```
Bundle-assert a served `/_app/immutable/*.js` chunk contains a new marker (e.g. grep for `discord` handling), per `docs/dev-loop-playbook.md`.

- [ ] **Step 2: Run ingest + roster against the LIVE DB**

```bash
node scripts/import-discord-chat.mjs sssc ~/Downloads/MusicLeague-thread-log_2026-*.txt   # via tsx
node scripts/seed-sssc-roster.mjs
```
(Live `data/league.db`; both idempotent.) Then set the two settings rows against the live DB (Task 6 Step 2, no `DATA_DIR` override).

- [ ] **Step 3: Verify chat section on R163**

Load `http://localhost:3002/digest/163` (round_id 163, "Ink worthy"). Confirm the chat-notes section renders, `unmappedSenders` is small (only the 3 ML-only + genuine non-players), and message/participant counts look right for the round window.

- [ ] **Step 4: Record outcome**

Note final counts (chat rows ingested, identities created, R163 chat participants) in the PR/commit message. Update the spec's status line to reflect Plan 1 shipped.

---

## Self-Review

**Spec coverage (components 1 & 2 of the spec + the chat half of the R163 deliverable):**
- Discord ingest (spec §1) → Tasks 2,3,7. Quirks (dupes, edited trailer, mentions, header) → Task 2 test.
- Roster (spec §2, Appendix A) → Tasks 1,4; `discord` identity type → Task 1; platform plumbing → Task 5.
- Chat section enabled for sssc, group_name='sssc' → Task 6; R163 render → Task 7.
- Guesser (spec §3) and storylines (spec §4) are **out of scope for this plan** — separate plans (see below).

**Placeholder scan:** Task 6 Step 2 intentionally flags a `grep` to confirm the `chat_settings` module/function names before running the data step — the setting read (`getChatSettings().leagueGroupMap`) and enable (`setChatSectionEnabled`) are verified in code; only the *save* helper's exact name/path needs confirming at implementation time. No other placeholders.

**Type consistency:** `platform` union `'whatsapp'|'google-chat'|'discord'` is applied in both `chatRoster.ts` and `chatSection.ts` (Task 5) and produced by the digest derivation; `ingestMessage`/`msg_hash` unchanged. `DiscordMessage {sender,text,tsMs}` produced by Task 2, consumed verbatim by Task 3.

## Follow-on plans (not this document)
- **Plan 2 — "The Guesser"** (spec §3): extraction table `guesser_guesses`, deterministic records (weekly, eludes-him, always-nails, littermates, drunk-by-play_position via `ORDER BY spotify_uri`), new `digest_sections.kind='guesser'`, generation + rendering + off-by-default enable. Needs a short pre-plan read of the digest section generation/render path (`llm.ts`, `digest_sections` kind CHECK, `digest/[roundId]/+page.svelte`).
- **Plan 3 — Cast & storylines** (spec §4): `storyline_seeds` config, deterministic evidence search over chat + vote comments, thin LLM write-up; seeds from the spec table.
