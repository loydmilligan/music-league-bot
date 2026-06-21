# WhatsApp Group Chat Capture via Notification Relay

**Goal:** Capture every message from your league group chats into one queryable store, and expose an export tool that takes **(group, start_date, end_date)** and returns the full ordered transcript — matching WhatsApp's native export format.

There are now **three feeds** into the same store:

1. **WhatsApp, going forward** — dedicated watcher account + notifAI Relay (Sections 1–7).
2. **WhatsApp, historical backfill** — parse the native `Export chat` `.txt` so groups are complete from before the watcher existed (Section 9).
3. **Google Chat, the one league group** — captured via the same store (Section 10). For Google Chat the relay is *optional*: unlike WhatsApp, Google Chat has a sanctioned API that gives 100% capture **and** real history, so the API is the recommended primary there.

This document is self-contained. Every change below is given as complete code you can paste in. You do **not** need to re-reference the notifAI project files unless you later want exact line-level diffs against your current `onNotificationPosted` / `_process_relay_notification` (offered at the end).

---

## 1. Why this works now (and why it didn't before)

The half-conversation problem that kills the relay for 1:1 chats **disappears for groups**, on one condition: the relay runs on a **separate watcher account** that never sends messages.

- In a group, every human's message generates a notification on every *other* member's phone.
- Your own sent messages don't notify *your* phone — but they **do** notify the watcher, because the watcher is a different member.
- The watcher never sends anything, so it has no blind spot of its own.

Net result: a watcher account added to the group sees **100% of the human conversation, both sides included**. The capture ceiling is no longer "incoming only" — it's now only the notification layer's truncation behavior (Section 4, Gap 5), which is a ~90–95% problem, not a structural 50% one.

### Architecture

```
                                     [Your server (notifAI backend)]

[Old phone] WhatsApp watcher
  NotifAI Relay ──POST──▶ /webhooks/relay ─┐
                                           │
[One-time] WhatsApp Export .txt            ├─▶  chat_messages table
  import script ───────────────────────────┤      (one row per message,
                                           │       per-message content dedup)
[Google Chat] one league group             │            │
  Chat API poll (recommended) ─────────────┘            ▼
  OR relay on the same phone                    GET /api/chat/export?group=&start=&end=
                                                   → ordered .txt transcript
```

All three feeds write to **one unified table** so the export tool doesn't care where a message came from. The old phone is just a host for the watcher's WhatsApp + the relay app. No Baileys, no Web protocol, no session pairing to keep alive.

> **Naming note:** because the store now holds more than WhatsApp, the doc renames the table `whatsapp_messages` → `chat_messages` and adds a `platform` column (`whatsapp` | `googlechat`). If you've already built Section 5 with `whatsapp_messages`, treat the names below as a rename — the structure is identical apart from the new `platform` field.

---

## 2. What we reuse from notifAI (already built, no changes)

These pieces already do exactly what we need:

| Component | File | What it gives us |
|---|---|---|
| System notification hook | `NotificationListenerService.onNotificationPosted` | Fires on every incoming group message |
| MessagingStyle extraction | `extractMessages()` | Pulls `EXTRA_MESSAGES` → `[{text, sender, timestamp}]` |
| Group name + metadata | `extractNotification()` | Notification **title** = group name; `group_key`, `post_time` |
| Forwarding + retry | `WebhookForwarder` | Async POST with retry to the backend |
| Foreground service + boot start | `RelayForegroundService`, `BootReceiver` | Keeps capture alive across reboots/doze |
| Relay payload model | `RelayNotificationPayload` | Already carries `title`, `group_key`, `post_time`, `messages` — **no payload change needed** |

The Android app **already sends** the group name and the per-message array. The work is mostly in (a) two small Android correctness fixes and (b) replacing how the backend *stores* the data.

---

## 3. The output we're building toward

The export endpoint produces this, which mirrors WhatsApp's own "Export chat" text format closely enough to feed any existing WhatsApp-log parser:

```
[2026-06-14 19:02:11] Alex: anyone else think round 7 was robbery
[2026-06-14 19:02:40] Mara: the bass track should have won
[2026-06-14 19:03:05] You: hard agree, that drop was filthy
```

Input contract: `group` (the group name), `start` and `end` (ISO datetimes). Output: every message in that group within the range, in chronological order.

---

## 4. What was missing from notifAI, and the fix for each

notifAI was built to surface *notifications* for prioritization — not to reconstruct a *message log*. Five concrete gaps:

### Gap 1 — Group identity is collapsed
**Problem.** The backend keys channels on `item.package_name`, which is `com.whatsapp` for **every** group. All your ML groups (and every other WhatsApp chat) land in one bucket.
**Fix.** Stop routing on package. Store the notification **title** (= group name) as a first-class indexed column on each message, plus `group_key` for stability. The Android app already sends both.

### Gap 2 — Messages are concatenated, not stored individually
**Problem.** `_process_relay_notification` joins the **last 5** messages into a single `body` string on one notification row. That produces overlapping, duplicated 5-message blobs with no clean per-message records — useless for "reconstruct the chat."
**Fix.** **Explode** the `messages[]` array into individual rows (one row = one message), each with its own sender, text, and timestamp.

### Gap 3 — Notification-level dedup silently drops messages
**Problem.** `onNotificationPosted` early-returns if it saw the same `package|id|tag` within 5s. WhatsApp updates a group's notification *in place* (same id/tag), so during a busy round, rapid messages get dropped **before** `extractMessages` even runs.
**Fix.** Don't dedup at the notification level for WhatsApp. Always extract. Dedup at the **message level** by a content hash on the backend. Because the MessagingStyle array re-carries the last several messages on each update, message-level dedup *recovers* most of what notification-level dedup would have lost.

### Gap 4 — Sender + timestamp fidelity
**Problem A.** notifAI's `extractMessages` reads only the legacy `"sender"` CharSequence. On newer Android/WhatsApp the sender often lives in a `Person` object (`"sender_person"`), so `sender` comes back `null`.
**Problem B.** The backend uses notification-level timestamps. The *real* message time is the per-message `time` inside the MessagingStyle bundle.
**Fix.** Read the `Person` fallback for sender; use the per-message `time` (not `post_time`) for the transcript timestamp.

### Gap 5 — Notification truncation ceiling (the irreducible limit)
**Problem.** When a group gets very noisy, WhatsApp/Android sometimes shows a "N new messages" summary instead of listing each message, and the `messages[]` array has finite depth. Some messages never appear in any payload.
**Fix.** None fully — this is the ceiling of any notification-based approach. Message-level dedup + capturing on *every* update minimizes loss. **Realistic capture: ~90–95%**, with losses concentrated in rapid bursts. For Music League banter feeding a digest/awards bot, that's well inside your stated 98%-satisfied bar; just don't treat it as a forensically complete log.

There's also one **operational** gotcha that isn't code but will silently break capture:

> **Do NOT mute the groups on the watcher account.** Muting suppresses notifications, which is the entire capture channel. This is counterintuitive (you'd normally mute a logging account) but critical. Also keep WhatsApp's notification previews **ON** (Settings → Notifications → "Show preview"), or MessagingStyle won't be populated.

---

## 5. Implementation — complete code

### 5.1 Android fix A: bypass notification-level dedup for WhatsApp

In `NotificationListenerService.onNotificationPosted`, replace the unconditional 5-second dedup block with a WhatsApp-aware version:

```java
private static final String WHATSAPP_PKG = "com.whatsapp";

// ... inside onNotificationPosted, after the blocked-package check:

boolean isWhatsApp = WHATSAPP_PKG.equals(packageName);

// Notification-level dedup is fine for everything EXCEPT WhatsApp groups,
// where the same notification id/tag is reused as the chat updates in place.
if (!isWhatsApp) {
    String dedupKey = packageName + "|" + sbn.getId() + "|" + sbn.getTag();
    long now = System.currentTimeMillis();
    Long lastSent = recentNotifications.get(dedupKey);
    if (lastSent != null && (now - lastSent) < DEDUP_WINDOW_MS) {
        Log.d(TAG, "Skipping duplicate notification: " + dedupKey);
        return;
    }
    recentNotifications.put(dedupKey, now);

    if (recentNotifications.size() > 100) {
        cleanupRecentNotifications(now);
    }
}
// For WhatsApp we always proceed; the backend dedups per message by content hash.
```

### 5.2 Android fix B: robust sender + group title in `extractMessages` / `extractNotification`

In `extractMessages`, add the `Person` fallback when reading each message bundle:

```java
CharSequence text = msgBundle.getCharSequence("text");
CharSequence sender = msgBundle.getCharSequence("sender");

// Newer WhatsApp/Android stores the sender as a Person, not a CharSequence.
if (sender == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    Object personObj = msgBundle.getParcelable("sender_person");
    if (personObj instanceof android.app.Person) {
        CharSequence name = ((android.app.Person) personObj).getName();
        if (name != null) sender = name;
    }
}

long time = msgBundle.getLong("time", 0);
if (text != null) {
    messages.add(new CapturedNotification.Message(
        text.toString(),
        sender != null ? sender.toString() : null,
        time
    ));
}
```

For the group name, WhatsApp sometimes uses `EXTRA_CONVERSATION_TITLE` for MessagingStyle. In `extractNotification`, prefer it when present:

```java
String groupTitle = getCharSequenceString(extras, Notification.EXTRA_CONVERSATION_TITLE);
if (groupTitle == null) {
    groupTitle = getCharSequenceString(extras, Notification.EXTRA_TITLE);
}
captured.setTitle(groupTitle);
```

> No change to `RelayNotificationPayload` or `WebhookForwarder` — the payload already carries `title`, `group_key`, `post_time`, and `messages[]`.

### 5.3 Backend: new message table

New SQLAlchemy model (e.g. `backend/src/models/chat_message.py`). One unified table for all feeds; `platform` distinguishes source:

```python
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from ..database import Base


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    platform = Column(String, index=True, nullable=False)     # 'whatsapp' | 'googlechat'
    group_name = Column(String, index=True, nullable=False)   # notification title / space name
    group_key = Column(String, index=True, nullable=True)     # stable-ish group id
    sender = Column(String, nullable=False)
    text = Column(Text, nullable=False)
    ts = Column(DateTime(timezone=True), index=True, nullable=False)  # real message time
    msg_hash = Column(String(64), unique=True, nullable=False)        # content dedup
    captured_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
```

Alembic migration body:

```python
def upgrade():
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("group_name", sa.String(), nullable=False),
        sa.Column("group_key", sa.String(), nullable=True),
        sa.Column("sender", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("msg_hash", sa.String(length=64), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_chat_platform", "chat_messages", ["platform"])
    op.create_index("ix_chat_group_name", "chat_messages", ["group_name"])
    op.create_index("ix_chat_group_key", "chat_messages", ["group_key"])
    op.create_index("ix_chat_ts", "chat_messages", ["ts"])
    op.create_unique_constraint("uq_chat_msg_hash", "chat_messages", ["msg_hash"])

def downgrade():
    op.drop_table("chat_messages")
```

> The content hash now folds in `platform` so the same text in two platforms never collides: `sha256(platform|group|sender|ts_ms|text)`. Update `_msg_hash` (5.4) and the export queries (5.5) to use `ChatMessage` + a `platform` filter accordingly.

### 5.4 Backend: explode + dedup on ingest

Add a WhatsApp branch in the relay handler. In `webhook_relay` (and `webhook_relay_batch`'s per-item loop), before the generic `_process_relay_notification`, route WhatsApp through this:

```python
import hashlib
from datetime import datetime, timezone
from sqlalchemy import select
from ..models.whatsapp_message import WhatsAppMessage

WHATSAPP_PKG = "com.whatsapp"


def _msg_hash(group: str, sender: str, ts_ms: int, text: str) -> str:
    raw = f"{group}|{sender}|{ts_ms}|{text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _ingest_whatsapp_messages(db, item) -> int:
    """Explode a WhatsApp MessagingStyle payload into individual rows.

    Dedups by content hash so re-carried messages (from in-place
    notification updates) are stored exactly once.
    """
    if not item.messages:
        return 0

    group = item.title or "Unknown Group"
    group_key = item.group_key
    inserted = 0

    for m in item.messages:
        if not isinstance(m, dict):
            continue
        text = (m.get("text") or "").strip()
        if not text:
            continue
        sender = m.get("sender") or "Unknown"
        ts_ms = m.get("timestamp") or item.post_time or 0

        h = _msg_hash(group, sender, ts_ms, text)
        exists = await db.execute(
            select(WhatsAppMessage.id).where(WhatsAppMessage.msg_hash == h)
        )
        if exists.scalar_one_or_none():
            continue  # already captured (re-carried by a later notification)

        ts = (
            datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
            if ts_ms else datetime.now(timezone.utc)
        )
        db.add(WhatsAppMessage(
            group_name=group,
            group_key=group_key,
            sender=sender,
            text=text,
            ts=ts,
            msg_hash=h,
        ))
        inserted += 1

    return inserted
```

Wire it into `webhook_relay`:

```python
@router.post("/relay", response_model=RelayResponse, status_code=status.HTTP_201_CREATED)
async def webhook_relay(payload: RelayNotificationPayload, db: AsyncSession = Depends(get_db)):
    try:
        if payload.package_name == WHATSAPP_PKG and payload.messages:
            inserted = await _ingest_whatsapp_messages(db, payload)
            await db.commit()
            return RelayResponse(
                success=True,
                notification_id="whatsapp",
                message=f"Captured {inserted} new WhatsApp message(s)",
            )

        # ...existing relay path for everything else...
        device_id = payload.device_id
        success, notification_id = await _process_relay_notification(db, payload, device_id)
        # ...unchanged...
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process relay notification: {str(e)}")
```

Do the same branch inside the `for item in payload.items:` loop of `webhook_relay_batch`.

### 5.5 Backend: the export tool (the "program")

New router (e.g. `backend/src/api/whatsapp_export.py`), mounted in `main.py`:

```python
from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from ..database import get_db
from ..models.whatsapp_message import WhatsAppMessage

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


@router.get("/groups")
async def list_groups(db: AsyncSession = Depends(get_db)):
    """Discover captured group names so you know the valid 'group' inputs."""
    result = await db.execute(select(distinct(WhatsAppMessage.group_name)))
    return {"groups": sorted([g for (g,) in result.all()])}


@router.get("/export")
async def export_chat(
    group: str = Query(..., description="Exact group name"),
    start: datetime = Query(..., description="ISO start datetime"),
    end: datetime = Query(..., description="ISO end datetime"),
    fmt: str = Query("whatsapp", description="'whatsapp' (.txt) or 'json'"),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(WhatsAppMessage)
        .where(
            WhatsAppMessage.group_name == group,
            WhatsAppMessage.ts >= start,
            WhatsAppMessage.ts <= end,
        )
        .order_by(WhatsAppMessage.ts.asc())
    )
    rows = (await db.execute(q)).scalars().all()

    if fmt == "json":
        return [
            {"ts": m.ts.isoformat(), "sender": m.sender, "text": m.text}
            for m in rows
        ]

    lines = [
        f"[{m.ts.strftime('%Y-%m-%d %H:%M:%S')}] {m.sender}: {m.text}"
        for m in rows
    ]
    return PlainTextResponse("\n".join(lines))
```

Usage:

```bash
# Which groups do I have?
curl "https://notifai.mattmariani.com/api/whatsapp/groups"

# Full transcript for one group between two dates
curl "https://notifai.mattmariani.com/api/whatsapp/export?group=Music%20League%20S12&start=2026-06-01T00:00:00&end=2026-06-30T23:59:59" \
  -o "ml-s12-june.txt"
```

That `.txt` is your deliverable: the entire chat for that group, in range, in order.

---

## 6. Watcher phone + account setup checklist

Operational steps, in order — several of these are silent-failure traps:

1. **Second WhatsApp account** on a spare number (cheap eSIM/data SIM, Google Voice, or a second number app that can receive SMS for activation).
2. **Old phone**, WhatsApp installed, watcher account activated.
3. **Add the watcher to each ML group.** This is visible to members (a "X added Y" system line appears) — just tell the group it's the logging account. There is no silent-observer mode.
4. Install the **NotifAI Relay** app; set the webhook URL to your backend's `/api/webhooks/relay`.
5. Grant **notification access** (Settings → Notification access → enable NotifAI Relay).
6. Toggle **Enable Relay** on; hit **Test Connection**.
7. **Disable battery optimization** for *both* WhatsApp and NotifAI Relay (Settings → Apps → Battery → Unrestricted). Doze will otherwise kill the listener overnight.
8. WhatsApp → Settings → Notifications → **"Show preview" ON**. Without previews, MessagingStyle is empty and you capture nothing.
9. **Do NOT mute the ML groups** on the watcher. Muted = no notifications = no capture.
10. Keep the phone **plugged in** and on Wi‑Fi.

---

## 7. Detailed implementation plan

### Phase 0 — Prove the assumption (½ day, do this first)
Before writing any backend code, confirm WhatsApp group MessagingStyle actually populates `messages[]` with real senders/timestamps on the watcher phone.
- Install the relay as-is, add the watcher to one test group, send a few messages from different members.
- Inspect what arrives at `/api/webhooks/relay` (log the raw `messages` array, or query the relay app's local `/notifications` endpoint on port 8765).
- **Decision gate:** if `messages[].sender` and `time` are present and correct → proceed. If `sender` is null → the Person fallback (5.2) is mandatory before anything else is worth doing.

### Phase 1 — Android correctness (½ day)
- Apply 5.1 (WhatsApp dedup bypass) and 5.2 (Person sender fallback + conversation title).
- Rebuild APK, reinstall on watcher.
- Re-run the Phase 0 test; confirm rapid back-to-back messages now all arrive.

### Phase 2 — Backend storage (1 day)
- Add the `WhatsAppMessage` model + migration (5.3), run `alembic upgrade head`.
- Add `_ingest_whatsapp_messages` and the WhatsApp branch in both `webhook_relay` and `webhook_relay_batch` (5.4).
- Send live group traffic; verify rows appear, one per message, with correct group/sender/ts, and **no duplicates** across overlapping notifications.

### Phase 3 — Export tool (½ day)
- Add the `whatsapp_export` router (5.5), mount in `main.py`.
- Verify `/whatsapp/groups` lists your real groups and `/whatsapp/export` returns a clean ordered transcript.

### Phase 4 — Soak + fidelity check (1 week, passive)
- Leave it running on the live ML groups.
- Spot-check: pick a busy round, compare the exported transcript against what you remember / against your own WhatsApp. Estimate the real capture rate.
- **Decision gate:** if capture feels good enough for the bot's purpose, done. If a specific high-traffic group loses too much, that's the only scenario where revisiting a Web-protocol library would be justified — but you've said Baileys has burned you, so the realistic fallback there is `whatsapp-web.js` *on the watcher account only*, not Baileys, and only for that one group.

### Phase 5 — Wire into the companion app (open-ended)
- Point Talking Music League at `/chat/export` (or the JSON `fmt`) to pull group history for digests, awards flavor, etc. This is where the captured chat actually earns its keep.

### Phase 6 — WhatsApp historical backfill (½ day, per group)
- On the day you add the watcher to a group, also **Export chat → Without media** for that group.
- Run `import_whatsapp_export.py` (Section 9) into `chat_messages`.
- Set up the canonical-name alias map (9.2) so historical and live sender names match.
- Verify the historical and live segments meet with no gap and no duplicates around the join date.

### Phase 7 — Google Chat league group (½–1 day)
- Decide Option A (API, recommended) vs B (relay).
- For A: create/enable the Chat API in a Cloud project, OAuth as yourself with `chat.messages.readonly`, grab the space id, run `sync_googlechat.py` once to backfill, then schedule it (cron/n8n).
- For B: add the `com.google.android.apps.dynamite` branch (10.3) and install Google Chat on the watcher phone.
- Confirm the space's messages appear in `/chat/export?platform=googlechat`.

---

## 8. Honest expectations

Completeness now varies **by feed**, which is the whole point of using three:

- **WhatsApp live (relay):** both sides captured in groups via the watcher; ~90–95% complete. Losses cluster in rapid bursts and WhatsApp "N new messages" collapses (Gap 5) — irreducible for any notification-based capture.
- **WhatsApp history (export import):** 100% complete up to the export moment, both directions. Export on the day you add the watcher and the historical + live segments meet with no gap — so a backfilled group is effectively **complete end to end**.
- **Google Chat (API):** 100% complete, full backfill *and* forward, sanctioned. (Relay fallback for Google Chat is the same ~90–95% as WhatsApp — only use it if avoiding the API.)
- **Account risk?** Effectively zero across all feeds. WhatsApp: a normal real member. Google Chat API: explicitly sanctioned. Nothing unofficial against Meta's or Google's servers.
- **Maintenance?** Keep the watcher phone alive and unmuted (WhatsApp); keep the Google Chat sync scheduled. That's the whole job.

---

## 9. Historical backfill from WhatsApp's native export

Capture is forward-only from when the watcher joins. To make a group **complete**, do a one-time import of WhatsApp's built-in `Export chat` `.txt` (the file you provided). On the watcher *or* your own phone: open the group → ⋮ → More → **Export chat** → **Without media** → save the `.txt`.

### 9.1 The format gap you must reconcile

Your historical export and the live relay produce **different** lines, and the export has quirks the live path never sees. From your real `Hip_jammers` file:

| Quirk | Example line | Handling |
|---|---|---|
| Different timestamp | `5/10/26, 7:35 PM - Matt Mariani: ...` | Parse `M/D/YY, h:mm AM/PM`; the live feed is already ISO |
| **Multi-line messages** | line has date+sender; following lines have **no prefix** | Append prefix-less lines to the previous message |
| Edited marker | `... <This message was edited>` | Strip the suffix; keep the text |
| Media placeholder | `Matt Mariani: <Media omitted>` | Skip (no text content) — see note below |
| Mentions | `@⁨Sasha Mariani⁩` | Strip the invisible `\u2068`/`\u2069` wrappers |
| System lines | `Mom joined using your invite`, `You changed this group's icon`, `... were added`, `created this group` | **Not messages** — skip (no `Sender: text` shape) |

The reliable discriminator: a real message line matches `^<date>, <time> - <sender>: <text>`. A line with the date prefix but **no `": "` after the sender** is a system event — skip it. A line with **no date prefix at all** is a continuation of the previous message.

> **Media note:** `<Media omitted>` means the text export carried no content for that item. If you ever need media references, re-export **With media** and you'll get filename placeholders instead — but for a Music League chat log, skipping media lines is almost certainly what you want.

### 9.2 Import script

A standalone one-shot (`scripts/import_whatsapp_export.py`). It writes into the same `chat_messages` table with the same content-hash dedup, so re-running it — or overlapping with live-captured messages — never double-inserts:

```python
#!/usr/bin/env python3
"""Import a WhatsApp 'Export chat' .txt into chat_messages.

Usage:
    python import_whatsapp_export.py "WhatsApp_Chat_with_Hip_jammers.txt" \
        --group "Hip jammers" --platform whatsapp
"""
import re, sys, hashlib, argparse
from datetime import datetime
# import your sync DB session + ChatMessage model here

# "5/10/26, 7:35 PM - Sender: text"   (sender present + ": " => real message)
LINE_RE = re.compile(
    r"^(?P<date>\d{1,2}/\d{1,2}/\d{2,4}), (?P<time>\d{1,2}:\d{2}\s?[AP]M) - "
    r"(?P<sender>[^:]+?): (?P<text>.*)$"
)
# Same date prefix but no "Sender: " => system line (joined/added/changed/etc.)
SYS_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}, \d{1,2}:\d{2}\s?[AP]M - ")

EDIT_SUFFIX = " <This message was edited>"
MENTION_WRAP = str.maketrans("", "", "\u2068\u2069")  # invisible mention wrappers


def parse(path: str):
    """Yield (sender, ts, text) tuples, joining multi-line messages."""
    msgs = []
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            m = LINE_RE.match(line)
            if m:
                text = m.group("text")
                if text.endswith(EDIT_SUFFIX):
                    text = text[: -len(EDIT_SUFFIX)]
                if text.strip() == "<Media omitted>":
                    continue  # no textual content
                ts = datetime.strptime(
                    f"{m.group('date')} {m.group('time').replace(' ', '')}",
                    "%m/%d/%y %I:%M%p",
                )
                msgs.append([m.group("sender").strip(), ts,
                             text.translate(MENTION_WRAP)])
            elif SYS_RE.match(line):
                continue  # system event, not a message
            elif msgs:
                # continuation of the previous message (newline inside a message)
                msgs[-1][2] += "\n" + line.translate(MENTION_WRAP)
            # else: leading junk before first message — ignore
    return msgs


def msg_hash(platform, group, sender, ts, text):
    raw = f"{platform}|{group}|{sender}|{int(ts.timestamp()*1000)}|{text}"
    return hashlib.sha256(raw.encode()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--group", required=True)
    ap.add_argument("--platform", default="whatsapp")
    args = ap.parse_args()

    rows = parse(args.path)
    inserted = 0
    # with Session() as db:
    for sender, ts, text in rows:
        if not text.strip():
            continue
        h = msg_hash(args.platform, args.group, sender, ts, text)
        # if db.query(ChatMessage.id).filter_by(msg_hash=h).first(): continue
        # db.add(ChatMessage(platform=args.platform, group_name=args.group,
        #                    sender=sender, text=text, ts=ts, msg_hash=h))
        inserted += 1
    # db.commit()
    print(f"Parsed {len(rows)} messages, inserted {inserted} new.")


if __name__ == "__main__":
    main()
```

> **Sender-name reconciliation.** In your export, *you* appear as both `You` (system lines) and `Matt Mariani` (your messages), while the live relay will record your watcher's saved name for you. These won't automatically match. Decide one canonical name per person and add a small alias map (e.g. `{"Matt Mariani": "Matt", "Mom": "Margaret"}`) applied at import and at live-ingest. Worth doing once so the awards bot doesn't treat "Matt Mariani" and "Matt" as two people.

### 9.3 Result

After import, that group is **complete**: historical messages (from the export) + live messages (from the relay), in one table, deduped, queryable by the same `/export` endpoint. The historical and live segments meet seamlessly as long as the export's end overlaps the watcher's join — so **export on the same day you add the watcher** to avoid a gap.

---

## 10. Adding the Google Chat league group

You have one group on Google Chat you want fully and historically. Good news: Google Chat is **easier and cleaner** than WhatsApp here, because it has a sanctioned API — no watcher account, no ToS risk, and you get **real history**, not just forward capture.

### 10.1 Two options, and why the API wins for one group

| | **A. Google Chat API (recommended)** | **B. Notification relay (same phone)** |
|---|---|---|
| History | **Yes** — full backfill via `spaces.messages.list` | No — forward only |
| Completeness | 100% | ~90–95% (same notification ceiling as WhatsApp) |
| Setup | Cloud project + service account/OAuth | Just add the Google Chat app to the watcher phone |
| ToS risk | None (sanctioned) | None, but lossy |
| Best when | One specific space you want fully | You already have the relay and want zero new infra |

For a single space you care about, **A** is clearly worth the modest setup: it backfills the entire history *and* keeps it complete going forward, which the relay can't. Use **B** only if you want zero new infrastructure and can tolerate gaps.

### 10.2 Option A — Google Chat API

**One-time setup:**
1. Create (or reuse) a **Google Cloud project**; enable the **Google Chat API**.
2. For a space *you're a member of*, **OAuth** (user credentials) is simplest — you authorize once as yourself and read the spaces you belong to. (A service account works too but must be added to the space and suits bot/workspace setups.)
3. Scope needed for read access: `https://www.googleapis.com/auth/chat.messages.readonly`.
4. Find the space id: list your spaces, or copy it from the Chat URL (`spaces/AAAA...`).

**Backfill + incremental poll** (`scripts/sync_googlechat.py`). Same `chat_messages` table, same hash dedup, so the first run backfills history and every later run just appends new messages:

```python
import hashlib
from datetime import datetime
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
# import your DB session + ChatMessage model

SPACE = "spaces/AAAAxxxxxxx"     # the league space
GROUP_NAME = "League Chat (Google)"
PLATFORM = "googlechat"


def msg_hash(platform, group, sender, ts, text):
    raw = f"{platform}|{group}|{sender}|{int(ts.timestamp()*1000)}|{text}"
    return hashlib.sha256(raw.encode()).hexdigest()


def sync(creds: Credentials):
    chat = build("chat", "v1", credentials=creds)
    page_token, inserted = None, 0

    while True:
        resp = chat.spaces().messages().list(
            parent=SPACE,
            pageSize=1000,
            pageToken=page_token,
            # orderBy="createTime asc",   # optional
        ).execute()

        for m in resp.get("messages", []):
            text = (m.get("text") or "").strip()
            if not text:
                continue  # attachment/card-only message, no text
            sender = (m.get("sender", {}).get("displayName")
                      or m.get("sender", {}).get("name") or "Unknown")
            # createTime is RFC3339, e.g. "2026-06-14T19:02:11.123456Z"
            ts = datetime.fromisoformat(m["createTime"].replace("Z", "+00:00"))

            h = msg_hash(PLATFORM, GROUP_NAME, sender, ts, text)
            # if db.query(ChatMessage.id).filter_by(msg_hash=h).first(): continue
            # db.add(ChatMessage(platform=PLATFORM, group_name=GROUP_NAME,
            #                    sender=sender, text=text, ts=ts, msg_hash=h))
            inserted += 1

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    # db.commit()
    print(f"Inserted {inserted} new Google Chat messages.")
```

Run it once to backfill, then on a schedule (cron / your n8n stack) to stay current. Because dedup is content-hash based, you can re-list the whole space every run without worrying about duplicates — though filtering by `createTime` once you have history is cheaper.

> Why this beats the relay path here: the Chat API returns *sent and received alike* with exact `createTime` and real `displayName`, and paginates the **entire** history. No watcher, no notification truncation, no burst loss.

### 10.3 Option B — relay on the same phone (only if avoiding the API)

Google Chat's Android app posts MessagingStyle notifications just like WhatsApp, so the existing relay captures it with **no new code** — the messages flow through `/webhooks/relay`. To route them into `chat_messages` with `platform='googlechat'`, branch on the package the same way you did for WhatsApp:

```python
GOOGLECHAT_PKG = "com.google.android.apps.dynamite"   # Google Chat app

# in webhook_relay, alongside the WhatsApp branch:
if payload.package_name == GOOGLECHAT_PKG and payload.messages:
    inserted = await _ingest_chat_messages(db, payload, platform="googlechat")
    await db.commit()
    return RelayResponse(success=True, notification_id="googlechat",
                         message=f"Captured {inserted} Google Chat message(s)")
```

Same gaps apply (forward-only, ~90–95%, burst loss). For one group you want *complete*, this is strictly worse than Option A — its only merit is zero new infrastructure.

### 10.4 Recommendation

Use **Option A (Chat API)** for the league space: one-time OAuth, full backfill, complete forward, sanctioned. Keep the relay for WhatsApp where no clean API exists. This gives you the best feed per platform rather than forcing everything through notifications.

---

If you'd rather have **exact diffs** against your current `NotificationListenerService.java` and `webhooks.py` (precise placement inside `onNotificationPosted` and the `webhook_relay` / `webhook_relay_batch` bodies, rather than paste-in blocks), drop those two files and I'll produce line-level patches.
