import { ImapFlow } from 'imapflow';

/**
 * Thin IMAP fetch for Music League notification mail. Connects to Gmail over
 * TLS with an app password, finds messages from the notifications sender, and
 * returns the raw source of those with UID greater than a caller-provided floor
 * (so polls are incremental). UIDVALIDITY-aware: the floor is computed per
 * validity, so a mailbox reset just re-fetches rather than silently skipping.
 */

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromFilter: string;
}

export interface FetchedEmail {
  uid: number;
  uidValidity: number;
  raw: string;
}

export async function fetchMusicLeagueEmails(
  cfg: ImapConfig,
  /** Given the mailbox UIDVALIDITY, return the highest UID already ingested. */
  minUidFor: (uidValidity: number) => number,
): Promise<FetchedEmail[]> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // Fail fast instead of hanging. A hung/slow command must never hold a Gmail
    // connection open indefinitely: Gmail caps an account at ~15 simultaneous
    // IMAP connections, and a leaked connection per timed-out poll accumulates
    // into "[ALERT] Too many simultaneous connections. (Failure)", which then
    // rejects EVERY new login (even clean ones) until the slots free up.
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
    socketTimeout: 60_000,
  });

  // ImapFlow can emit 'error' asynchronously — a socket timeout fires from a
  // timer, outside any pending await — so the caller's try/catch never sees it.
  // With no listener attached, Node escalates that emit to an uncaught
  // exception and kills the process; this crash-looped the api service (which
  // also serves /webhooks/relay) until it wedged. The connect()/fetch()
  // promises still reject, so the caller's catch stays the real error path.
  client.on('error', (err: unknown) => {
    console.error('[imap] client error:', err instanceof Error ? err.message : String(err));
  });

  const out: FetchedEmail[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === 'boolean') return out;
      const uidValidity = Number(mailbox.uidValidity);
      const minUid = minUidFor(uidValidity);

      // Date-bound the search so Gmail is not scanning the entire mailbox
      // history on every poll — the slow unbounded SEARCH is what tripped the
      // socket timeout that started the connection leak. The UID floor below
      // still guarantees no duplicates; a window far larger than the poll
      // interval cannot miss a freshly-arrived message.
      const windowDays = Number(process.env.EMAIL_SEARCH_WINDOW_DAYS ?? 30);
      const since = new Date(Date.now() - windowDays * 86_400_000);
      const uids = await client.search({ from: cfg.fromFilter, since }, { uid: true });
      const wanted = (uids || []).filter((u) => u > minUid).sort((a, b) => a - b);
      if (wanted.length === 0) return out;

      for await (const msg of client.fetch(wanted.join(','), { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        out.push({ uid: Number(msg.uid), uidValidity, raw: msg.source.toString('utf8') });
      }
    } finally {
      lock.release();
    }
  } finally {
    // ALWAYS tear the connection down — even when connect()/search()/fetch()
    // throws or the socket times out — so a failed poll can never leak a Gmail
    // IMAP slot. logout() is the clean path; close() force-destroys the socket
    // when logout can't run (e.g. connect() itself failed).
    try {
      await client.logout();
    } catch {
      /* not connected / already gone */
    }
    try {
      client.close();
    } catch {
      /* already closed */
    }
  }
  return out;
}
