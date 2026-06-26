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
  });

  const out: FetchedEmail[] = [];
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const mailbox = client.mailbox;
    if (!mailbox || typeof mailbox === 'boolean') return out;
    const uidValidity = Number(mailbox.uidValidity);
    const minUid = minUidFor(uidValidity);

    const uids = await client.search({ from: cfg.fromFilter }, { uid: true });
    const wanted = (uids || []).filter((u) => u > minUid).sort((a, b) => a - b);
    if (wanted.length === 0) return out;

    for await (const msg of client.fetch(wanted.join(','), { uid: true, source: true }, { uid: true })) {
      if (!msg.source) continue;
      out.push({ uid: Number(msg.uid), uidValidity, raw: msg.source.toString('utf8') });
    }
  } finally {
    lock.release();
  }
  await client.logout().catch(() => undefined);
  return out;
}
