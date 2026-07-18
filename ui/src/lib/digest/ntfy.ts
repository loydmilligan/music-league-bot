export interface NtfyConfig {
  url: string;
  topic: string;
  token?: string;
}

export interface NtfyAction {
  action: 'http' | 'view';
  label: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  clear?: boolean;
}

export interface Notification {
  title: string;
  message: string;
  click?: string;
  actions?: NtfyAction[];
  priority?: number;
  tags?: string[];
}

export function ntfyConfigFromEnv(env: Record<string, string | undefined>): NtfyConfig | null {
  if (!env.NTFY_URL || !env.NTFY_TOPIC) return null;
  return { url: env.NTFY_URL, topic: env.NTFY_TOPIC, token: env.NTFY_TOKEN };
}

function authedPost(url: string, token: string, bearer?: string): NtfyAction {
  return {
    action: 'http', label: '', url, method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ token }),
    clear: true,
  };
}

export function buildApprovalNotification(o: {
  league: string; round: string; reviewUrl: string;
  approveUrl: string; denyUrl: string; editUrl: string; token: string; bearer?: string;
}): Notification {
  return {
    title: `${o.league} — ${o.round}`,
    message: 'Digest ready. Approve to post, Edit to open the editor, or Deny to drop it.',
    click: o.reviewUrl,
    priority: 4,
    tags: ['musical_note'],
    actions: [
      { ...authedPost(o.approveUrl, o.token, o.bearer), label: 'Approve' },
      { action: 'view', label: 'Edit', url: o.editUrl, clear: false },
      { ...authedPost(o.denyUrl, o.token, o.bearer), label: 'Deny' },
    ],
  };
}

export function buildReviewNotification(o: {
  league: string; round: string; reviewUrl: string;
  editUrl: string; denyUrl: string; token: string; reason: string; bearer?: string;
}): Notification {
  return {
    title: `${o.league} — ${o.round} (needs review)`,
    message: `Needs a human before it can post: ${o.reason}. Open the editor to review.`,
    click: o.reviewUrl,
    priority: 4,
    tags: ['warning'],
    actions: [
      { action: 'view', label: 'Review', url: o.editUrl, clear: false },
      { ...authedPost(o.denyUrl, o.token, o.bearer), label: 'Deny' },
    ],
  };
}

export function buildFailureNotification(o: { stage: string; reason: string; roundId?: number }): Notification {
  return {
    title: '⚠ digest pipeline',
    message: `${o.stage} failed${o.roundId ? ` (round ${o.roundId})` : ''}: ${o.reason}`,
    priority: 5,
    tags: ['rotating_light'],
  };
}

export async function publish(cfg: NtfyConfig, n: Notification, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${cfg.url}/${cfg.topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify({
        topic: cfg.topic, title: n.title, message: n.message,
        click: n.click, actions: n.actions, priority: n.priority, tags: n.tags,
      }),
    });
    if (!res.ok) {
      console.error(`[ntfy] publish → ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[ntfy] publish failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}
