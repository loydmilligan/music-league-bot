# Player portal + digest workflow (as of 2026-10-03)

This is a plain-language guide to what changed for players and admins, and how a round's digest
gets from "round ended" to "players reading it". The screenshots that go with it are sent separately.

---

## 1. What changed

### For players — the league page is now the portal

Each league already had a "b-side" page at `https://digest.mattmariani.com/<league-code>/`
(Second Best: `…/yFfer5bePejN4PRXvgAfMg/`, Boarz: `…/U7o8L06wfe1HILD1qzk-wg/`). It is now the
**player portal**, with a nav bar on every screen:

| Tab | What players see |
|---|---|
| **Home** | Hero, KPIs, superlatives, members (as before) **+ a "Read the latest digest →" button** that opens the newest digest. |
| **Digests** | Every completed round, every season, newest first. Each card opens that round's digest (2.0 if finalized, otherwise the old 1.0 share). Rounds with no digest say "No digest". Updates within seconds of a 2.0 Finalize (for leagues that have a portal page) — no "Update" run needed. |
| **Season** | Live from the survey site: the season lineup (revealed themes with comment rules + credits; hidden rounds as teaser cards with "🔒 Revealed <date>"), open theme polls with a **Vote →** button, closed poll results, and **Add themes** when the survey is open. Anything that needs a login hands off to `mlsurvey.mattmariani.com`. If the survey site is down, it shows an "Open the season hub →" link instead. |
| Player profiles | Unchanged (now with the same nav). |

On the survey site, player pages now have a slim bar linking back to the league page, and links
like `…#polls`, `#mine`, `#survey`, `#lineup` open the right tab after the name login.

**Privacy rules (enforced twice — by the survey site and again by the portal):** hidden rounds never
show their real theme, credit, or comment rule; open polls never show vote counts; draft polls
(e.g. Second Best round 10's, which opens Nov 22) don't appear at all. The portal never shows the
admin app's address (`mlb13…`) anywhere.

### For admins

| Where | What's new |
|---|---|
| `/digest2/<round>` (via Content → **2.0 preview**) | Admin bar: **Generate** (only when the round has no story draft yet), **Edit story in 1.0 editor**, **Finalize & share** / **Re-publish**, **Copy** link. Publishing also refreshes the league portal's Digests list (a warning appears if that part failed — the digest itself is still published). |
| Content tab, each league card | **Player portal — Season**: Season feed URL + Season hub URL fields with Save. (Second Best and Boarz are pre-filled at deploy.) |
| ntfy notifications | Round-end pushes include a link to the 2.0 preview. |
| Survey admin (`mlsurvey…/…/admin/`) | Unchanged home for themes, lineup publishing, reveals, polls, player access, Music League sync. **Player access defaults matter:** players only reach Season lineup / My themes / Polls through portal links if those tabs are on for them. |

### Behind the scenes
- Each league folder on the digest host gets a small `portal.json` (round list + digest links +
  season URLs), rebuilt on 2.0 Finalize, b-side Publish/Update, and Season-settings Save.
- Every 2.0 digest and every `portal.json` passes a leak check before it's written: if the admin
  address or any app-only link would appear in a 2.0 digest, that digest's publish is blocked with
  the offending snippet. For `portal.json`, a leak only skips updating the league's Digests list;
  the digest itself is still published, with a warning.

---

## 2. Sending a round's digest

### 2a. What happens automatically when a round ends (today)

1. **Music League results email** arrives → the bot queues a digest job for that round.
2. **The app generates the 1.0 digest draft** (captures the export, writes the story sections with AI,
   renders it).
3. **For Boarz and Second Best (HiL leagues)** the host timer also drafts story ledes and pushes an
   ntfy notification: *"<League> — HiL review"* → tap to rate ledes on `/digest/<round>/hil`; the
   push also has a **Digest 2.0** button.
4. **Approval push:** *"Digest ready. Approve to post, Edit to open the editor, or Deny to drop it."*
   with a "Digest 2.0 preview: <link>" line.
   - **Approve** → the app finalizes the **1.0** digest (PDF) and the bot sends it to the league's
     WhatsApp group (exactly once).
   - **Edit** → opens the 1.0 editor. **Deny** → nothing is sent.
5. Nothing reaches a group without your Approve tap.

> The automated send is still the **1.0** digest. Sending the 2.0 link automatically through the
> same Approve tap is a planned next piece ("send via approval", per-league v1/v2 switch).

### 2b. Sending the 2.0 digest manually (today — recommended for round 1)

1. Wait for the round-end push (the 1.0 draft exists → 2.0 has its story text).
2. Open the **2.0 preview** (button in the push, or Content → **2.0 preview** tab, or
   `/digest2/<round>`). If it says "No story draft yet", press **Generate** and wait (minutes).
3. Read it. To change story text: **Edit story in 1.0 editor**, save, come back and reload.
4. Press **Finalize & share**. You get `https://digest.mattmariani.com/d2/<code>` — press **Copy**.
   - The league portal's Digests tab and Home button update automatically.
   - If it says *"Publish blocked — admin links found"*, a story section contains an app link —
     edit that text in the 1.0 editor and try again.
5. Paste the link into the league's WhatsApp group yourself (and, if you like, the portal link
   `https://digest.mattmariani.com/<league-code>/` for everything else).
6. **Deny** the 1.0 approval push if you don't also want the 1.0 PDF sent.
7. Changed something after sharing? Edit, then **Re-publish** — same link, new content.

### 2c. Once "send via approval" ships (planned)
Per league you'd pick 1.0 or 2.0. For 2.0 leagues the Approve tap would finalize the 2.0 digest and
send its `/d2/` link to the group — same one-tap approval, nothing sent without it.

---

## 3. Quick reference
- Portal: `https://digest.mattmariani.com/<league-code>/` — Home · Digests · Season
- 2.0 editor/preview: Content → 2.0 preview, or `/digest2/<round>`
- Season settings: Content → league card → Player portal — Season
- Survey admin: `https://mlsurvey.mattmariani.com/<league>/<season>/admin/`
- Live season feed (what the portal reads): `https://mlsurvey.mattmariani.com/feed/<league>/<season>.json`
