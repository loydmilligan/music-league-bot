#!/usr/bin/env python3
"""
sync_google_chat.py — sync a Google Chat space into chat_messages.

First-run setup:
  1. Enable Google Chat API in a Google Cloud project.
  2. Create OAuth credentials (Desktop app) and download credentials.json.
  3. Run once:  python scripts/sync_google_chat.py --setup
     This opens a browser, lets you authorize, and saves token.json.
  4. Find your space ID:
     python scripts/sync_google_chat.py --list-spaces
  5. Run the sync:
     python scripts/sync_google_chat.py --space "spaces/AAAA..." --group "League Chat"

Idempotent: content-hash dedup means re-running never double-inserts.
Schedule via cron to keep it current:
  */30 * * * *  python /path/to/sync_google_chat.py --space spaces/AAAA... --group "League Chat"
"""
import hashlib, sqlite3, uuid, argparse, sys, os, json
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / 'data' / 'league.db'
TOKEN_PATH = Path(__file__).parent.parent / 'data' / 'gchat_token.json'
CREDS_PATH = Path(__file__).parent.parent / 'data' / 'gchat_credentials.json'

SCOPES = ['https://www.googleapis.com/auth/chat.messages.readonly']
PLATFORM = 'googlechat'


def require_google_libs():
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        return Credentials, InstalledAppFlow, Request, build
    except ImportError:
        print('ERROR: Google API libraries not installed.', file=sys.stderr)
        print('Install with:  pip install google-api-python-client google-auth-oauthlib', file=sys.stderr)
        sys.exit(1)


def get_credentials():
    Credentials, InstalledAppFlow, Request, _ = require_google_libs()
    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDS_PATH.exists():
                print(f'ERROR: {CREDS_PATH} not found.', file=sys.stderr)
                print('Download OAuth credentials.json from Google Cloud Console and save it there.', file=sys.stderr)
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_PATH), SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, 'w') as f:
            f.write(creds.to_json())
    return creds


def msg_hash(platform: str, group: str, sender: str, ts_ms: int, text: str) -> str:
    raw = f'{platform}|{group}|{sender}|{ts_ms}|{text}'
    return hashlib.sha256(raw.encode()).hexdigest()


def ensure_table(db: sqlite3.Connection):
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


def list_spaces(service):
    spaces = []
    page_token = None
    while True:
        resp = service.spaces().list(pageSize=100, pageToken=page_token).execute()
        for s in resp.get('spaces', []):
            if s.get('type') in ('ROOM', 'SPACE', None):
                spaces.append(s)
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return spaces


def sync_space(service, space_name: str, group_name: str, db: sqlite3.Connection,
               dry_run: bool = False) -> tuple[int, int]:
    inserted = skipped = 0
    page_token = None

    while True:
        resp = service.spaces().messages().list(
            parent=space_name,
            pageSize=1000,
            pageToken=page_token,
        ).execute()

        for m in resp.get('messages', []):
            text = (m.get('text') or '').strip()
            if not text:
                continue

            sender_info = m.get('sender', {})
            sender = sender_info.get('displayName') or sender_info.get('name') or 'Unknown'

            create_time = m.get('createTime', '')
            if not create_time:
                continue
            try:
                dt = datetime.fromisoformat(create_time.replace('Z', '+00:00'))
            except ValueError:
                continue

            ts_ms = int(dt.timestamp() * 1000)
            ts_iso = dt.isoformat()
            h = msg_hash(PLATFORM, group_name, sender, ts_ms, text)

            if dry_run:
                print(f'  [{ts_iso}] {sender}: {text[:80]}')
                inserted += 1
                continue

            try:
                db.execute(
                    'INSERT OR IGNORE INTO chat_messages (id, platform, group_name, group_key, sender, text, ts, msg_hash) VALUES (?,?,?,?,?,?,?,?)',
                    (str(uuid.uuid4()), PLATFORM, group_name, space_name, sender, text, ts_iso, h)
                )
                if db.total_changes > inserted + skipped:
                    inserted += 1
                else:
                    skipped += 1
            except sqlite3.IntegrityError:
                skipped += 1

        page_token = resp.get('nextPageToken')
        if not page_token:
            break

    if not dry_run:
        db.commit()

    return inserted, skipped


def main():
    ap = argparse.ArgumentParser(description='Sync a Google Chat space into chat_messages')
    ap.add_argument('--space', help='Space name, e.g. spaces/AAAAxxxxxxx')
    ap.add_argument('--group', help='Human-readable group name to store in DB (e.g. "League Chat")')
    ap.add_argument('--setup', action='store_true', help='Run OAuth setup and exit')
    ap.add_argument('--list-spaces', action='store_true', dest='list_spaces', help='List available spaces and exit')
    ap.add_argument('--db', default=str(DB_PATH), help='Path to league.db')
    ap.add_argument('--dry-run', action='store_true', help='Print messages only, do not write to DB')
    args = ap.parse_args()

    _, _, _, build = require_google_libs()
    creds = get_credentials()
    service = build('chat', 'v1', credentials=creds)

    if args.setup:
        print('OAuth setup complete. Token saved to:', TOKEN_PATH)
        return

    if args.list_spaces:
        spaces = list_spaces(service)
        print(f'Found {len(spaces)} spaces:')
        for s in spaces:
            print(f"  {s['name']}  —  {s.get('displayName') or s.get('name')}")
        return

    if not args.space:
        ap.error('--space is required (use --list-spaces to find your space ID)')
    if not args.group:
        ap.error('--group is required (the name to store in the DB)')

    db = sqlite3.connect(args.db)
    db.execute('PRAGMA journal_mode=WAL')
    ensure_table(db)

    print(f'Syncing {args.space} → group "{args.group}"')
    inserted, skipped = sync_space(service, args.space, args.group, db, dry_run=args.dry_run)

    if args.dry_run:
        print(f'Dry run: would have inserted {inserted} messages')
    else:
        print(f'Done: {inserted} inserted, {skipped} skipped (already existed)')
    db.close()


if __name__ == '__main__':
    main()
