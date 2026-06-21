#!/usr/bin/env python3
"""
import_whatsapp_chat.py — backfill WhatsApp 'Export chat' .txt into chat_messages.

Usage:
    python scripts/import_whatsapp_chat.py <path/to/chat.txt> --group "Hip jammers"
    python scripts/import_whatsapp_chat.py ~/Downloads/mlb-chat/"WhatsApp Chat with Hip jammers.zip" --group "Hip jammers"

    # Auto-detect group name from filename (strips "WhatsApp Chat with " prefix):
    python scripts/import_whatsapp_chat.py "WhatsApp Chat with Hip jammers.txt"

Idempotent: re-running never double-inserts (content-hash dedup).
"""
import re, sys, hashlib, argparse, sqlite3, zipfile, tempfile, os
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / 'data' / 'league.db'

# "5/10/26, 7:35 PM - Sender: text"
# WhatsApp uses   (NARROW NO-BREAK SPACE) between time and AM/PM on some exports
_SP = r'[\s ]?'
LINE_RE = re.compile(
    r'^(?P<date>\d{1,2}/\d{1,2}/\d{2,4}), '
    r'(?P<time>\d{1,2}:\d{2}' + _SP + r'[AP]M) - '
    r'(?P<sender>[^:]+?): (?P<text>.*)$'
)
SYS_RE = re.compile(r'^\d{1,2}/\d{1,2}/\d{2,4}, \d{1,2}:\d{2}' + _SP + r'[AP]M - ')
EDIT_SUFFIX = ' <This message was edited>'
MENTION_STRIP = str.maketrans('', '', '⁨⁩')


def parse_chat(path: str):
    """Yield (sender, ts_ms, text) tuples, joining multi-line messages."""
    msgs = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for raw in f:
            line = raw.rstrip('\n')
            m = LINE_RE.match(line)
            if m:
                text = m.group('text')
                if text.endswith(EDIT_SUFFIX):
                    text = text[:-len(EDIT_SUFFIX)]
                if text.strip() in ('<Media omitted>', ''):
                    continue
                date_str = m.group('date')
                time_str = m.group('time').replace(' ', '').replace(' ', '')
                try:
                    # Handle 2-digit and 4-digit year
                    if len(date_str.split('/')[-1]) == 4:
                        dt = datetime.strptime(f'{date_str} {time_str}', '%m/%d/%Y %I:%M%p')
                    else:
                        dt = datetime.strptime(f'{date_str} {time_str}', '%m/%d/%y %I:%M%p')
                    dt = dt.replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
                msgs.append([m.group('sender').strip(), int(dt.timestamp() * 1000),
                             text.translate(MENTION_STRIP)])
            elif SYS_RE.match(line):
                continue  # system event
            elif msgs:
                msgs[-1][2] += '\n' + line.translate(MENTION_STRIP)
    return msgs


def msg_hash(platform: str, group: str, sender: str, ts_ms: int, text: str) -> str:
    raw = f'{platform}|{group}|{sender}|{ts_ms}|{text}'
    return hashlib.sha256(raw.encode()).hexdigest()


def group_name_from_filename(path: str) -> str:
    name = Path(path).stem
    name = re.sub(r'\.done$', '', name)
    name = re.sub(r'^WhatsApp Chat with ', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(\d+\)\s*$', '', name).strip()
    return name


def main():
    ap = argparse.ArgumentParser(description='Import WhatsApp chat export into chat_messages')
    ap.add_argument('path', help='Path to .txt or .zip WhatsApp export')
    ap.add_argument('--group', help='Group name (default: auto-detect from filename)')
    ap.add_argument('--db', default=str(DB_PATH), help='Path to league.db')
    ap.add_argument('--dry-run', action='store_true', help='Parse only, do not write to DB')
    args = ap.parse_args()

    src_path = args.path
    tmp_file = None

    # Handle zip: extract the .txt
    if src_path.endswith('.zip'):
        tmp_file = tempfile.NamedTemporaryFile(suffix='.txt', delete=False)
        tmp_file.close()
        with zipfile.ZipFile(src_path) as z:
            txts = [n for n in z.namelist() if n.endswith('.txt')]
            if not txts:
                print('ERROR: no .txt file found in zip', file=sys.stderr)
                sys.exit(1)
            with z.open(txts[0]) as src, open(tmp_file.name, 'wb') as dst:
                dst.write(src.read())
        src_path = tmp_file.name

    group = args.group or group_name_from_filename(args.path)
    if not group:
        print('ERROR: could not determine group name; pass --group', file=sys.stderr)
        sys.exit(1)

    print(f'Parsing {args.path}')
    print(f'Group:  {group}')

    msgs = parse_chat(src_path)
    print(f'Parsed {len(msgs)} messages')

    if tmp_file:
        os.unlink(tmp_file.name)

    if args.dry_run:
        for sender, ts_ms, text in msgs[:5]:
            print(f'  [{datetime.fromtimestamp(ts_ms/1000, tz=timezone.utc)}] {sender}: {text[:80]}')
        print(f'  ... (dry run, not writing)')
        return

    db = sqlite3.connect(args.db)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('''
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY, platform TEXT NOT NULL,
            group_name TEXT NOT NULL, group_key TEXT,
            sender TEXT NOT NULL, text TEXT NOT NULL,
            ts TEXT NOT NULL, msg_hash TEXT NOT NULL,
            captured_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%SZ\',\'now\'))
        )
    ''')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_msg_hash ON chat_messages(msg_hash)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_chat_msg_group_ts ON chat_messages(group_name, ts)')

    import uuid
    platform = 'whatsapp'
    inserted = skipped = 0

    for sender, ts_ms, text in msgs:
        if not text.strip():
            continue
        ts_iso = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
        h = msg_hash(platform, group, sender, ts_ms, text)
        try:
            db.execute(
                'INSERT OR IGNORE INTO chat_messages (id, platform, group_name, sender, text, ts, msg_hash) VALUES (?,?,?,?,?,?,?)',
                (str(uuid.uuid4()), platform, group, sender, text, ts_iso, h)
            )
            if db.total_changes > inserted + skipped:
                inserted += 1
            else:
                skipped += 1
        except sqlite3.IntegrityError:
            skipped += 1

    db.commit()
    db.close()
    print(f'Done: {inserted} inserted, {skipped} skipped (already existed)')


if __name__ == '__main__':
    main()
