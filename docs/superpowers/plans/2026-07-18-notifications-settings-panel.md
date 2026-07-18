# Notifications Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the env-hardcoded, ntfy-only digest alerts into a UI-configured, multi-channel system — a `settings/notifications` panel with a routing grid (alert-type × channel), a channel abstraction (ntfy + WhatsApp now, Twilio-ready), and a `notify()` dispatch that fans out over the grid.

**Architecture:** A `notify(db, payload, deps)` dispatch in bot-ui reads a `notifications` config blob (settings table) and fans an alert out to each checked+configured channel adapter. Adapters implement a common `Channel` interface declaring capabilities (`alert`/`approval`). ntfy sends over HTTP directly; WhatsApp routes through a new bot control `/notify` route (only the bot owns the WhatsApp client); the bot raises its own alerts via a new bot-ui `/api/notify` endpoint so all routing lives in one place.

**Tech Stack:** TypeScript, SvelteKit (adapter-node) bot-ui, `better-sqlite3`, Vitest, Node `fetch`. Two separate TS projects, NO shared imports: `ui/` (bot-ui) and `src/` (bot + api).

## Global Constraints

- **No shared imports across `src/` and `ui/`.** The bot control router lives in `src/`; the channel adapters live in `ui/`. They communicate over HTTP, never imports.
- **Config lives in the `settings` key-value table** under key `notifications` (one JSON blob), following the `getBucketBoundaries`/`updateBucketBoundaries` pattern in `ui/src/lib/db/settings.ts` (`SELECT value FROM settings WHERE key=?` + `INSERT OR REPLACE`).
- **Secrets from config/env, never hardcoded.** ntfy channel config seeds from `NTFY_URL`/`NTFY_TOPIC`/`NTFY_TOKEN`; WhatsApp owner from `OWNER_PHONE_NUMBER`. The DB blob is source of truth once saved; env is the seed + fallback.
- **`notify()` and every adapter NEVER throw** — a single channel failing must not block the others or crash a runner tick. Per-channel errors are logged.
- **The interactive Approve/Deny gate stays ntfy-only** (ntfy capabilities `['alert','approval']`; whatsapp `['alert']`). The abstraction must let a future channel add `sendApproval` + the `approval` capability without changing the interface's shape.
- **The bot's WhatsApp send path is delicate.** The bot-side rewiring (Task 6) must be additive + guarded (best-effort, never throws into the send/poll path).
- **Alert types:** `pipeline_failure`, `ml_auth_expired`, `digest_ready`, `digest_sent`. **Channels:** `ntfy`, `whatsapp`.
- **TDD, DRY, YAGNI, frequent commits.** ui tests: `npx vitest run <path>` from `ui/` (npm test is `vitest run` — do NOT add an extra `run`). root tests: `npm test -- run <path>`. Typecheck ui: `npm run check --prefix ui` (expect 0 errors; ~59 pre-existing warnings are unrelated).

---

### Task 1: Notifications config model

**Files:**
- Create: `ui/src/lib/notifications/config.ts`
- Test: `ui/src/lib/notifications/config.test.ts`

**Interfaces:**
- Produces:
  - `type AlertType = 'pipeline_failure' | 'ml_auth_expired' | 'digest_ready' | 'digest_sent'`
  - `type ChannelId = 'ntfy' | 'whatsapp'`
  - `interface NtfyChannelConfig { url: string; topic: string; token: string }`
  - `interface WhatsappChannelConfig { ownerNumber: string }`
  - `interface NotificationsConfig { channels: { ntfy: NtfyChannelConfig; whatsapp: WhatsappChannelConfig }; routing: Record<AlertType, Record<ChannelId, boolean>> }`
  - `const ALERT_TYPES: AlertType[]`, `const CHANNEL_IDS: ChannelId[]`
  - `getNotificationsConfig(db, env?): NotificationsConfig` — reads the blob, deep-fills missing keys from defaults; seeds ntfy from `env.NTFY_*`, whatsapp from `env.OWNER_PHONE_NUMBER`.
  - `setNotificationsConfig(db, cfg): void` — `INSERT OR REPLACE` the blob.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/notifications/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { getNotificationsConfig, setNotificationsConfig, ALERT_TYPES, CHANNEL_IDS } from './config.js';

function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  return d;
}
const ENV = { NTFY_URL: 'https://n', NTFY_TOPIC: 't', NTFY_TOKEN: 'k', OWNER_PHONE_NUMBER: '111@c.us' };

describe('notifications config', () => {
  it('exposes the four alert types and two channels', () => {
    expect(ALERT_TYPES).toEqual(['pipeline_failure', 'ml_auth_expired', 'digest_ready', 'digest_sent']);
    expect(CHANNEL_IDS).toEqual(['ntfy', 'whatsapp']);
  });
  it('seeds ntfy + whatsapp from env when unset, with a default routing grid', () => {
    const cfg = getNotificationsConfig(db(), ENV);
    expect(cfg.channels.ntfy).toEqual({ url: 'https://n', topic: 't', token: 'k' });
    expect(cfg.channels.whatsapp).toEqual({ ownerNumber: '111@c.us' });
    // every alert type has a routing entry for every channel
    for (const a of ALERT_TYPES) for (const c of CHANNEL_IDS) expect(typeof cfg.routing[a][c]).toBe('boolean');
    // default: the three real alerts go to ntfy; digest_sent is opt-in (all false)
    expect(cfg.routing.pipeline_failure.ntfy).toBe(true);
    expect(cfg.routing.digest_sent.ntfy).toBe(false);
  });
  it('round-trips a saved blob and it wins over env', () => {
    const d = db();
    const cfg = getNotificationsConfig(d, ENV);
    cfg.channels.ntfy.topic = 'saved-topic';
    cfg.routing.digest_sent.whatsapp = true;
    setNotificationsConfig(d, cfg);
    const reloaded = getNotificationsConfig(d, ENV);
    expect(reloaded.channels.ntfy.topic).toBe('saved-topic');
    expect(reloaded.routing.digest_sent.whatsapp).toBe(true);
  });
  it('deep-fills a partial stored blob (missing channel/routing keys) from defaults', () => {
    const d = db();
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('notifications', JSON.stringify({ channels: { ntfy: { url: 'x', topic: 'y', token: 'z' } } }));
    const cfg = getNotificationsConfig(d, ENV);
    expect(cfg.channels.whatsapp.ownerNumber).toBe('111@c.us'); // filled from env
    expect(cfg.routing.digest_ready.ntfy).toBe(true);            // filled from default
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/config.test.ts` (from `ui/`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the config model**

Create `ui/src/lib/notifications/config.ts`:

```ts
import type Database from 'better-sqlite3';

export type AlertType = 'pipeline_failure' | 'ml_auth_expired' | 'digest_ready' | 'digest_sent';
export type ChannelId = 'ntfy' | 'whatsapp';

export const ALERT_TYPES: AlertType[] = ['pipeline_failure', 'ml_auth_expired', 'digest_ready', 'digest_sent'];
export const CHANNEL_IDS: ChannelId[] = ['ntfy', 'whatsapp'];

export interface NtfyChannelConfig { url: string; topic: string; token: string }
export interface WhatsappChannelConfig { ownerNumber: string }
export interface NotificationsConfig {
  channels: { ntfy: NtfyChannelConfig; whatsapp: WhatsappChannelConfig };
  routing: Record<AlertType, Record<ChannelId, boolean>>;
}

const KEY = 'notifications';

type Env = Record<string, string | undefined>;

function defaults(env: Env): NotificationsConfig {
  const routing = {} as NotificationsConfig['routing'];
  for (const a of ALERT_TYPES) {
    // The three real alerts default to ntfy (today's behavior); digest_sent is opt-in.
    routing[a] = { ntfy: a !== 'digest_sent', whatsapp: false };
  }
  return {
    channels: {
      ntfy: { url: env.NTFY_URL ?? '', topic: env.NTFY_TOPIC ?? '', token: env.NTFY_TOKEN ?? '' },
      whatsapp: { ownerNumber: env.OWNER_PHONE_NUMBER ?? '' },
    },
    routing,
  };
}

export function getNotificationsConfig(
  db: Database.Database, env: Env = process.env,
): NotificationsConfig {
  const base = defaults(env);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row?.value) return base;
  let stored: Partial<NotificationsConfig>;
  try {
    stored = JSON.parse(row.value) as Partial<NotificationsConfig>;
  } catch {
    return base;
  }
  // Deep-fill: stored values win, missing keys fall back to defaults.
  const merged: NotificationsConfig = {
    channels: {
      ntfy: { ...base.channels.ntfy, ...(stored.channels?.ntfy ?? {}) },
      whatsapp: { ...base.channels.whatsapp, ...(stored.channels?.whatsapp ?? {}) },
    },
    routing: {} as NotificationsConfig['routing'],
  };
  for (const a of ALERT_TYPES) {
    merged.routing[a] = { ...base.routing[a], ...(stored.routing?.[a] ?? {}) };
  }
  return merged;
}

export function setNotificationsConfig(db: Database.Database, cfg: NotificationsConfig): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEY, JSON.stringify(cfg));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/config.test.ts` (from `ui/`)
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/notifications/config.ts ui/src/lib/notifications/config.test.ts
git commit -m "feat(notifications): config model — notifications settings blob + env seed"
```

---

### Task 2: Channel interface + ntfy adapter

**Files:**
- Create: `ui/src/lib/notifications/channels/types.ts`
- Create: `ui/src/lib/notifications/channels/ntfy.ts`
- Test: `ui/src/lib/notifications/channels/ntfy.test.ts`

**Interfaces:**
- Consumes: `AlertType`/`ChannelId` (Task 1); the existing ntfy module `ui/src/lib/digest/ntfy.ts` (`publish`, `buildApprovalNotification`, `buildReviewNotification`, `type NtfyConfig`, `type Notification`).
- Produces:
  - `interface AlertPayload { alertType: AlertType; title: string; message: string; link?: string; approval?: ApprovalPayload }`
  - `interface ApprovalPayload { kind: 'approve' | 'review'; token: string; approveUrl?: string; denyUrl: string; editUrl: string; reviewReason?: string }`
  - `interface ChannelDeps { fetchFn?: typeof fetch; botControlUrl?: string }`
  - `interface Channel { id: ChannelId; capabilities: Array<'alert' | 'approval'>; isConfigured(cfg: unknown): boolean; sendAlert(cfg: unknown, p: AlertPayload, deps: ChannelDeps): Promise<{ ok: boolean; error?: string }> }`
  - `const ntfyChannel: Channel`

Note on the approval bearer: the ntfy action-button `Authorization: Bearer` is the ntfy channel's own configured token — the adapter injects it from `cfg.token`, so `ApprovalPayload` does NOT carry a bearer.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/notifications/channels/ntfy.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ntfyChannel } from './ntfy.js';
import type { AlertPayload } from './types.js';

const cfg = { url: 'https://n', topic: 'mlb', token: 'K' };
const okFetch = () => vi.fn().mockResolvedValue({ ok: true });

describe('ntfyChannel', () => {
  it('declares alert + approval capabilities', () => {
    expect(ntfyChannel.id).toBe('ntfy');
    expect(ntfyChannel.capabilities).toEqual(['alert', 'approval']);
  });
  it('isConfigured requires url + topic', () => {
    expect(ntfyChannel.isConfigured(cfg)).toBe(true);
    expect(ntfyChannel.isConfigured({ url: '', topic: 'x', token: '' })).toBe(false);
    expect(ntfyChannel.isConfigured({})).toBe(false);
  });
  it('plain alert: publishes a notification with title/message/click, returns ok', async () => {
    const fetchFn = okFetch();
    const p: AlertPayload = { alertType: 'pipeline_failure', title: 'T', message: 'M', link: 'https://d/x' };
    const r = await ntfyChannel.sendAlert(cfg, p, { fetchFn });
    expect(r.ok).toBe(true);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ topic: 'mlb', title: 'T', message: 'M', click: 'https://d/x' });
    expect(body.actions).toBeFalsy(); // plain alert has no action buttons
  });
  it('digest_ready approve: emits the interactive Approve/Edit/Deny notification with the configured token as bearer', async () => {
    const fetchFn = okFetch();
    const p: AlertPayload = {
      alertType: 'digest_ready', title: 'Fam-Jam — R12', message: 'ready', link: 'https://d/x',
      approval: { kind: 'approve', token: 'tok', approveUrl: 'https://a/approve', denyUrl: 'https://a/deny', editUrl: 'https://a/edit' },
    };
    await ntfyChannel.sendAlert(cfg, p, { fetchFn });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.actions.map((a: { label: string }) => a.label)).toEqual(['Approve', 'Edit', 'Deny']);
    const approve = body.actions.find((a: { label: string }) => a.label === 'Approve');
    expect(approve.headers.Authorization).toBe('Bearer K'); // adapter's own configured token
  });
  it('digest_ready review: emits Review/Deny only (no Approve)', async () => {
    const fetchFn = okFetch();
    const p: AlertPayload = {
      alertType: 'digest_ready', title: 'x', message: 'y', link: 'https://d/x',
      approval: { kind: 'review', token: 'tok', denyUrl: 'https://a/deny', editUrl: 'https://a/edit', reviewReason: 'season-final' },
    };
    await ntfyChannel.sendAlert(cfg, p, { fetchFn });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.actions.map((a: { label: string }) => a.label)).toEqual(['Review', 'Deny']);
  });
  it('returns ok:false (never throws) when publish fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = await ntfyChannel.sendAlert(cfg, { alertType: 'digest_sent', title: 'T', message: 'M' }, { fetchFn });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/channels/ntfy.test.ts` (from `ui/`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the channel interface**

Create `ui/src/lib/notifications/channels/types.ts`:

```ts
import type { AlertType, ChannelId } from '$lib/notifications/config.js';

export interface ApprovalPayload {
  kind: 'approve' | 'review';
  token: string;
  approveUrl?: string;   // present when kind==='approve'
  denyUrl: string;
  editUrl: string;
  reviewReason?: string; // present when kind==='review'
}

export interface AlertPayload {
  alertType: AlertType;
  title: string;
  message: string;
  link?: string;
  approval?: ApprovalPayload;
}

export interface ChannelDeps {
  fetchFn?: typeof fetch;
  botControlUrl?: string;
}

export interface Channel {
  id: ChannelId;
  capabilities: Array<'alert' | 'approval'>;
  isConfigured(cfg: unknown): boolean;
  sendAlert(cfg: unknown, p: AlertPayload, deps: ChannelDeps): Promise<{ ok: boolean; error?: string }>;
}
```

- [ ] **Step 4: Implement the ntfy adapter**

Create `ui/src/lib/notifications/channels/ntfy.ts`:

```ts
import {
  publish, buildApprovalNotification, buildReviewNotification,
  type NtfyConfig, type Notification,
} from '$lib/digest/ntfy.js';
import type { NtfyChannelConfig } from '$lib/notifications/config.js';
import type { AlertPayload, Channel } from './types.js';

function asNtfyConfig(cfg: unknown): NtfyChannelConfig {
  const c = (cfg ?? {}) as Partial<NtfyChannelConfig>;
  return { url: c.url ?? '', topic: c.topic ?? '', token: c.token ?? '' };
}

export const ntfyChannel: Channel = {
  id: 'ntfy',
  capabilities: ['alert', 'approval'],
  isConfigured(cfg) {
    const c = asNtfyConfig(cfg);
    return !!c.url && !!c.topic;
  },
  async sendAlert(cfg, p, deps) {
    const c = asNtfyConfig(cfg);
    const ntfyCfg: NtfyConfig = { url: c.url, topic: c.topic, token: c.token };
    let notif: Notification;
    if (p.approval?.kind === 'approve') {
      notif = buildApprovalNotification({
        league: p.title, round: p.message, reviewUrl: p.link ?? '',
        approveUrl: p.approval.approveUrl ?? '', denyUrl: p.approval.denyUrl, editUrl: p.approval.editUrl,
        token: p.approval.token, bearer: c.token,
      });
    } else if (p.approval?.kind === 'review') {
      notif = buildReviewNotification({
        league: p.title, round: p.message, reviewUrl: p.link ?? '',
        editUrl: p.approval.editUrl, denyUrl: p.approval.denyUrl,
        token: p.approval.token, reason: p.approval.reviewReason ?? '', bearer: c.token,
      });
    } else {
      // plain alert
      notif = { title: p.title, message: p.message, click: p.link, priority: 4 };
    }
    const ok = await publish(ntfyCfg, notif, deps.fetchFn);
    return ok ? { ok: true } : { ok: false, error: 'ntfy publish failed' };
  },
};
```

Note: `buildApprovalNotification`/`buildReviewNotification` currently take `league`/`round` as the title/message parts. Here the runner passes a composed `title` (league — round) and a short `message`; passing `title` as `league` and `message` as `round` yields `"<title> — <message>"` in the ntfy title, which is acceptable. If the implementer finds the composed title reads oddly, prefer adding a `buildAlertNotification`/plain builder and keeping the approval builders fed by the runner's existing league/round — but do not change the approval builders' signatures (Phase 2 tests depend on them).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/channels/ntfy.test.ts` (from `ui/`)
Expected: PASS.
Run: `npm run check --prefix ui`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/notifications/channels/types.ts ui/src/lib/notifications/channels/ntfy.ts ui/src/lib/notifications/channels/ntfy.test.ts
git commit -m "feat(notifications): Channel interface + ntfy adapter (alert + approval)"
```

---

### Task 3: Bot control `/notify` route (WhatsApp DM)

**Files:**
- Modify: `src/control/router.ts` (add `/notify`)
- Modify: `src/control/server.ts` (`ControlHandlers.onNotify` + route handling)
- Modify: `src/index.ts` (wire `onNotify` → owner DM)
- Test: `src/control/router.test.ts` (extend)

**Interfaces:**
- Produces: `ControlAction` gains `| { action: 'notify'; text: string }`; `ControlHandlers` gains `onNotify: (text: string) => Promise<void>`. `POST /notify { text }` on the bot control server DMs the bot owner.

- [ ] **Step 1: Write the failing test**

In `src/control/router.test.ts`, add:

```ts
it('parses POST /notify with a text body', () => {
  expect(parseControlRequest('POST', '/notify', { text: 'hello' })).toEqual({ action: 'notify', text: 'hello' });
});
it('rejects /notify without a non-empty text', () => {
  expect(parseControlRequest('POST', '/notify', {}).action).toBe('unknown');
  expect(parseControlRequest('POST', '/notify', { text: '  ' }).action).toBe('unknown');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run src/control/router.test.ts`
Expected: FAIL — `/notify` returns `unknown`.

- [ ] **Step 3: Add the route to the router**

In `src/control/router.ts`, extend `ControlAction` and `parseControlRequest`:

```ts
export type ControlAction =
  | { action: 'trigger' }
  | { action: 'send'; roundId: number; target: string; mode: 'live' | 'dry-run' }
  | { action: 'notify'; text: string }
  | { action: 'unknown'; reason: string };
```

Add, before the final `return`:

```ts
  if (path === '/notify') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.text !== 'string' || !b.text.trim()) {
      return { action: 'unknown', reason: 'text (non-empty string) required' };
    }
    return { action: 'notify', text: b.text.trim() };
  }
```

- [ ] **Step 4: Handle the route in the server**

In `src/control/server.ts`, add to `ControlHandlers`:

```ts
export interface ControlHandlers {
  onTrigger: () => Promise<void>;
  onSend: (req: ManualSendReq) => Promise<ManualSendResult>;
  onNotify: (text: string) => Promise<void>;
}
```

In the request handler's route switch (next to the `trigger`/`send` branches), add:

```ts
        } else if (route.action === 'notify') {
          await handlers.onNotify(route.text);
          reply(200, { ok: true, action: 'notify' });
```

- [ ] **Step 5: Wire `onNotify` in the bot**

In `src/index.ts`, inside the `startControlServer({...})` call, add the handler (the `client` and `ownerPhone` are in scope):

```ts
    onNotify: async (text) => { await makeSendDm(client)(ownerPhone, text); },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- run src/control/router.test.ts`
Expected: PASS.
Run: `npm test -- run tests/control.test.ts` (if it exercises the server handlers, ensure it still passes / add an `onNotify` stub to any handler fixture it builds)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/control/router.ts src/control/server.ts src/index.ts src/control/router.test.ts
git commit -m "feat(control): /notify route — bot DMs owner on behalf of bot-ui dispatch"
```

---

### Task 4: WhatsApp adapter

**Files:**
- Create: `ui/src/lib/notifications/channels/whatsapp.ts`
- Test: `ui/src/lib/notifications/channels/whatsapp.test.ts`

**Interfaces:**
- Consumes: the `Channel` interface (Task 2); the bot control `/notify` route (Task 3) reached over HTTP via `deps.botControlUrl`.
- Produces: `const whatsappChannel: Channel` (capabilities `['alert']`). `isConfigured` requires `ownerNumber`. `sendAlert` composes a text (title + message + link/reason) and POSTs `${deps.botControlUrl}/notify { text }`.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/notifications/channels/whatsapp.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { whatsappChannel } from './whatsapp.js';
import type { AlertPayload } from './types.js';

describe('whatsappChannel', () => {
  it('declares alert-only capability', () => {
    expect(whatsappChannel.id).toBe('whatsapp');
    expect(whatsappChannel.capabilities).toEqual(['alert']);
  });
  it('isConfigured requires an ownerNumber', () => {
    expect(whatsappChannel.isConfigured({ ownerNumber: '1@c.us' })).toBe(true);
    expect(whatsappChannel.isConfigured({ ownerNumber: '' })).toBe(false);
    expect(whatsappChannel.isConfigured({})).toBe(false);
  });
  it('POSTs the bot control /notify with a composed text and returns ok on 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const p: AlertPayload = { alertType: 'digest_ready', title: 'Fam-Jam — R12', message: 'Digest ready.', link: 'https://d/x' };
    const r = await whatsappChannel.sendAlert({ ownerNumber: '1@c.us' }, p, { fetchFn, botControlUrl: 'http://bot:3003' });
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://bot:3003/notify');
    const body = JSON.parse(init.body);
    expect(body.text).toContain('Fam-Jam — R12');
    expect(body.text).toContain('Digest ready.');
    expect(body.text).toContain('https://d/x');
  });
  it('returns ok:false (never throws) when the control POST fails or rejects', async () => {
    expect((await whatsappChannel.sendAlert({ ownerNumber: '1@c.us' }, { alertType: 'digest_sent', title: 'T', message: 'M' }, { fetchFn: vi.fn().mockResolvedValue({ ok: false, status: 500 }), botControlUrl: 'http://bot:3003' })).ok).toBe(false);
    expect((await whatsappChannel.sendAlert({ ownerNumber: '1@c.us' }, { alertType: 'digest_sent', title: 'T', message: 'M' }, { fetchFn: vi.fn().mockRejectedValue(new Error('net')), botControlUrl: 'http://bot:3003' })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/channels/whatsapp.test.ts` (from `ui/`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the WhatsApp adapter**

Create `ui/src/lib/notifications/channels/whatsapp.ts`:

```ts
import type { WhatsappChannelConfig } from '$lib/notifications/config.js';
import type { AlertPayload, Channel } from './types.js';

function asCfg(cfg: unknown): WhatsappChannelConfig {
  const c = (cfg ?? {}) as Partial<WhatsappChannelConfig>;
  return { ownerNumber: c.ownerNumber ?? '' };
}

function composeText(p: AlertPayload): string {
  const lines = [p.title, p.message];
  if (p.approval?.kind === 'review' && p.approval.reviewReason) lines.push(`(needs review: ${p.approval.reviewReason})`);
  if (p.link) lines.push(p.link);
  return lines.filter(Boolean).join('\n');
}

export const whatsappChannel: Channel = {
  id: 'whatsapp',
  capabilities: ['alert'],
  isConfigured(cfg) {
    return !!asCfg(cfg).ownerNumber;
  },
  async sendAlert(_cfg, p, deps) {
    const url = deps.botControlUrl ?? process.env.BOT_CONTROL_URL ?? 'http://bot:3003';
    const fetchFn = deps.fetchFn ?? fetch;
    try {
      const res = await fetchFn(`${url}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: composeText(p) }),
      });
      return res.ok ? { ok: true } : { ok: false, error: `control /notify ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
```

Note: the actual DM recipient is the bot's owner (`OWNER_PHONE_NUMBER`), chosen by the bot's `/notify` handler; the `ownerNumber` config here is the configured/displayed target and the "is WhatsApp set up" gate. It is intentionally not sent as a recipient — the control endpoint never accepts an arbitrary DM target.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/channels/whatsapp.test.ts` (from `ui/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/notifications/channels/whatsapp.ts ui/src/lib/notifications/channels/whatsapp.test.ts
git commit -m "feat(notifications): WhatsApp adapter over bot control /notify"
```

---

### Task 5: Dispatch service

**Files:**
- Create: `ui/src/lib/notifications/dispatch.ts`
- Test: `ui/src/lib/notifications/dispatch.test.ts`

**Interfaces:**
- Consumes: `getNotificationsConfig` (Task 1); `ntfyChannel` (Task 2), `whatsappChannel` (Task 4); `AlertPayload`/`ChannelDeps` (Task 2).
- Produces:
  - `const CHANNELS: Channel[]` (registry: `[ntfyChannel, whatsappChannel]`)
  - `notify(db, payload: AlertPayload, deps?: ChannelDeps): Promise<NotifyResult[]>` where `NotifyResult = { channel: ChannelId; ok: boolean; error?: string; skipped?: 'unrouted' | 'unconfigured' }` — fans out to each channel routed for `payload.alertType` AND configured; never throws.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/notifications/dispatch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { notify } from './dispatch.js';
import { setNotificationsConfig, getNotificationsConfig } from './config.js';
import type { AlertPayload } from './channels/types.js';

const ENV = { NTFY_URL: 'https://n', NTFY_TOPIC: 't', NTFY_TOKEN: 'k', OWNER_PHONE_NUMBER: '1@c.us' };
function db(routing: Partial<Record<string, { ntfy: boolean; whatsapp: boolean }>>): Database.Database {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const cfg = getNotificationsConfig(d, ENV);
  for (const [k, v] of Object.entries(routing)) cfg.routing[k as never] = v as never;
  setNotificationsConfig(d, cfg);
  return d;
}
const alert: AlertPayload = { alertType: 'pipeline_failure', title: 'T', message: 'M' };

describe('notify dispatch', () => {
  it('fans out only to channels routed AND configured', async () => {
    const d = db({ pipeline_failure: { ntfy: true, whatsapp: true } });
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const res = await notify(d, alert, { fetchFn, botControlUrl: 'http://bot:3003' });
    expect(res.filter((r) => r.ok).map((r) => r.channel).sort()).toEqual(['ntfy', 'whatsapp']);
    expect(fetchFn).toHaveBeenCalledTimes(2); // one ntfy publish + one control /notify
  });
  it('skips a channel that is unrouted', async () => {
    const d = db({ pipeline_failure: { ntfy: true, whatsapp: false } });
    const res = await notify(d, alert, { fetchFn: vi.fn().mockResolvedValue({ ok: true }) });
    expect(res.find((r) => r.channel === 'whatsapp')?.skipped).toBe('unrouted');
  });
  it('skips a channel that is routed but unconfigured', async () => {
    const d = new Database(':memory:');
    d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    const cfg = getNotificationsConfig(d, { OWNER_PHONE_NUMBER: '1@c.us' }); // no NTFY_* → ntfy unconfigured
    cfg.routing.pipeline_failure = { ntfy: true, whatsapp: false };
    setNotificationsConfig(d, cfg);
    const res = await notify(d, alert, { fetchFn: vi.fn() });
    expect(res.find((r) => r.channel === 'ntfy')?.skipped).toBe('unconfigured');
  });
  it('one channel failing does not block the other, and notify never throws', async () => {
    const d = db({ pipeline_failure: { ntfy: true, whatsapp: true } });
    // ntfy publish (first call) rejects; whatsapp (second) ok
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('ntfy down')).mockResolvedValueOnce({ ok: true });
    const res = await notify(d, alert, { fetchFn, botControlUrl: 'http://bot:3003' });
    expect(res.find((r) => r.channel === 'ntfy')?.ok).toBe(false);
    expect(res.find((r) => r.channel === 'whatsapp')?.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/dispatch.test.ts` (from `ui/`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dispatch**

Create `ui/src/lib/notifications/dispatch.ts`:

```ts
import type Database from 'better-sqlite3';
import { getNotificationsConfig, type ChannelId } from './config.js';
import { ntfyChannel } from './channels/ntfy.js';
import { whatsappChannel } from './channels/whatsapp.js';
import type { AlertPayload, Channel, ChannelDeps } from './channels/types.js';

export const CHANNELS: Channel[] = [ntfyChannel, whatsappChannel];

export interface NotifyResult {
  channel: ChannelId;
  ok: boolean;
  error?: string;
  skipped?: 'unrouted' | 'unconfigured';
}

export async function notify(
  db: Database.Database, payload: AlertPayload, deps: ChannelDeps = {},
): Promise<NotifyResult[]> {
  const cfg = getNotificationsConfig(db);
  const routing = cfg.routing[payload.alertType] ?? ({} as Record<ChannelId, boolean>);
  const results: NotifyResult[] = [];
  for (const ch of CHANNELS) {
    if (!routing[ch.id]) { results.push({ channel: ch.id, ok: false, skipped: 'unrouted' }); continue; }
    const chCfg = cfg.channels[ch.id];
    if (!ch.isConfigured(chCfg)) { results.push({ channel: ch.id, ok: false, skipped: 'unconfigured' }); continue; }
    try {
      const r = await ch.sendAlert(chCfg, payload, deps);
      if (!r.ok) console.error(`[notify] ${ch.id} ${payload.alertType} failed: ${r.error ?? 'unknown'}`);
      results.push({ channel: ch.id, ...r });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[notify] ${ch.id} ${payload.alertType} threw: ${error}`);
      results.push({ channel: ch.id, ok: false, error });
    }
  }
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/dispatch.test.ts` (from `ui/`)
Expected: PASS.
Run: `npm run check --prefix ui`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/notifications/dispatch.ts ui/src/lib/notifications/dispatch.test.ts
git commit -m "feat(notifications): notify() dispatch — fan out over the routing grid"
```

---

### Task 6: Rewire alert call-sites through dispatch

**Files:**
- Modify: `ui/src/lib/digest/runnerLoop.ts` (fail / awaitApproval / awaitReview → `notify`)
- Create: `ui/src/routes/api/notify/+server.ts` (bot-ui endpoint for the bot to raise alerts)
- Modify: `src/digest/poller.ts` (route `notifyOwner` + add `digest_sent` through bot-ui `/api/notify`)
- Modify: `ui/src/routes/api/digest/approve/+server.ts` and `.../deny/+server.ts` (Bearer from settings token, env fallback)
- Test: `ui/src/lib/digest/runnerLoop.test.ts` (extend — deps still wired) + `ui/src/lib/notifications/notifyEndpoint.test.ts` (payload parsing helper)

**Interfaces:**
- Consumes: `notify` (Task 5), `AlertPayload` (Task 2).
- Produces: `POST /api/notify { alertType, title, message, link? }` on bot-ui runs `notify(...)`. The runner's fail/awaitApproval/awaitReview emit via `notify` instead of direct `publish`.

- [ ] **Step 1: Write the failing test for the endpoint payload helper**

Create `ui/src/lib/notifications/notifyEndpoint.ts` will hold a pure parser; test it. Create `ui/src/lib/notifications/notifyEndpoint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseNotifyBody } from './notifyEndpoint.js';

describe('parseNotifyBody', () => {
  it('accepts a valid alert body', () => {
    expect(parseNotifyBody({ alertType: 'digest_sent', title: 'T', message: 'M', link: 'https://x' }))
      .toEqual({ ok: true, payload: { alertType: 'digest_sent', title: 'T', message: 'M', link: 'https://x' } });
  });
  it('rejects an unknown alertType', () => {
    expect(parseNotifyBody({ alertType: 'nope', title: 'T', message: 'M' }).ok).toBe(false);
  });
  it('rejects missing title/message', () => {
    expect(parseNotifyBody({ alertType: 'digest_sent' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/notifyEndpoint.test.ts` (from `ui/`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the payload parser**

Create `ui/src/lib/notifications/notifyEndpoint.ts`:

```ts
import { ALERT_TYPES } from './config.js';
import type { AlertPayload } from './channels/types.js';

export function parseNotifyBody(body: unknown): { ok: true; payload: AlertPayload } | { ok: false; reason: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ALERT_TYPES.includes(b.alertType as never)) return { ok: false, reason: 'invalid alertType' };
  if (typeof b.title !== 'string' || !b.title) return { ok: false, reason: 'title required' };
  if (typeof b.message !== 'string' || !b.message) return { ok: false, reason: 'message required' };
  const payload: AlertPayload = {
    alertType: b.alertType as AlertPayload['alertType'],
    title: b.title, message: b.message,
    link: typeof b.link === 'string' ? b.link : undefined,
  };
  return { ok: true, payload };
}
```

- [ ] **Step 4: Create the bot-ui `/api/notify` endpoint**

Create `ui/src/routes/api/notify/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { notify } from '$lib/notifications/dispatch.js';
import { parseNotifyBody } from '$lib/notifications/notifyEndpoint.js';

export const POST: RequestHandler = async ({ request }) => {
  const parsed = parseNotifyBody(await request.json().catch(() => ({})));
  if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, { status: 400 });
  const results = await notify(getDb(), parsed.payload);
  return json({ ok: true, results });
};
```

- [ ] **Step 5: Rewire the runner loop**

In `ui/src/lib/digest/runnerLoop.ts`:

1. Replace the ntfy imports with the dispatch + payload types:

```ts
import { notify } from '$lib/notifications/dispatch.js';
import type { AlertPayload } from '$lib/notifications/channels/types.js';
```

(Remove the now-unused `ntfyConfigFromEnv, publish, buildApprovalNotification, buildReviewNotification, buildFailureNotification` import — the ntfy module is still used, but only via the adapter now.)

2. `botControlUrl` for the whatsapp channel — add near `baseUrl`:

```ts
const botControlUrl = process.env.BOT_CONTROL_URL ?? 'http://bot:3003';
const dispatchDeps = { botControlUrl };
```

3. Rewrite `fail` to distinguish ML-auth from generic failure and dispatch:

```ts
    fail: (roundId, error, now) => {
      const outcome = failOrRetry(getDb(), roundId, error, now);
      if (outcome !== 'failed') return;
      const alertType = error.startsWith('capture auth') ? 'ml_auth_expired' : 'pipeline_failure';
      const title = alertType === 'ml_auth_expired' ? '⚠ ML auth expired' : '⚠ digest pipeline';
      void notify(getDb(), { alertType, title, message: `round ${roundId}: ${error}` } as AlertPayload, dispatchDeps);
    },
```

4. Rewrite `awaitApproval` (keep the token + `setAwaitingApproval` DB write; replace the publish with dispatch):

```ts
    awaitApproval: async (roundId, leagueId, reviewUrl) => {
      const token = generateApprovalToken();
      setAwaitingApproval(getDb(), roundId, token, reviewUrl, new Date().toISOString());
      const { league, round } = names(roundId, leagueId);
      await notify(getDb(), {
        alertType: 'digest_ready', title: `${league} — ${round}`, message: 'Digest ready.', link: reviewUrl,
        approval: { kind: 'approve', token, approveUrl: `${appBase}/api/digest/approve`, denyUrl: `${appBase}/api/digest/deny`, editUrl: `${appBase}/digest/${roundId}` },
      }, dispatchDeps);
    },
```

5. Rewrite `awaitReview` likewise:

```ts
    awaitReview: async (roundId, leagueId, reviewUrl, reason) => {
      const token = generateApprovalToken();
      setAwaitingReview(getDb(), roundId, token, reviewUrl, new Date().toISOString());
      const { league, round } = names(roundId, leagueId);
      await notify(getDb(), {
        alertType: 'digest_ready', title: `${league} — ${round}`, message: `Needs review: ${reason}`, link: reviewUrl,
        approval: { kind: 'review', token, denyUrl: `${appBase}/api/digest/deny`, editUrl: `${appBase}/digest/${roundId}`, reviewReason: reason },
      }, dispatchDeps);
    },
```

- [ ] **Step 5b: Keep the approve/deny Bearer in sync with the settings token**

The approve/deny endpoints (`ui/src/routes/api/digest/approve/+server.ts`, `.../deny/+server.ts`) currently check the callback Bearer against `process.env.NTFY_TOKEN`. But the ntfy action-button bearer now comes from the notifications config token (the adapter uses `cfg.channels.ntfy.token`). If a user edits the token in the panel, these must agree — otherwise approve/deny 401s. In BOTH endpoints, source the expected token from the config with env fallback:

```ts
import { getNotificationsConfig } from '$lib/notifications/config.js';
// ...inside POST, replace the bearer check's expected value:
const expected = getNotificationsConfig(getDb()).channels.ntfy.token || process.env.NTFY_TOKEN;
if (!bearerOk(request.headers.get('authorization'), expected)) {
  return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
}
```

`bearerOk` (fail-closed on empty `expected`) is unchanged. Add a focused test to `ui/src/lib/digest/approvals.test.ts` only if you extract a helper; otherwise this is exercised in the Task 8 live check (approve still works after the token flows from settings).

- [ ] **Step 6: Route the bot's own alerts through bot-ui**

In `src/digest/poller.ts`, the `PollerOpts.notifyOwner` is currently a direct DM. Change the wiring so the poller reports through bot-ui `/api/notify` (best-effort, never throws). In `makeDeps`, add a helper and route `notifyOwner` + a new success hook:

```ts
  async function raise(alertType: string, title: string, message: string): Promise<void> {
    try {
      await fetch(`${opts.baseUrl}/api/notify`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alertType, title, message }),
      });
    } catch (e) { console.error('[autopost] /api/notify failed:', e instanceof Error ? e.message : e); }
  }
```

Then in the returned deps, replace `notifyOwner: opts.notifyOwner` usage so a send failure calls `raise('pipeline_failure', '⚠ digest send', <msg>)`, and after a successful `confirm`, call `raise('digest_sent', 'Digest sent', <league→group msg>)`. Keep `opts.notifyOwner` as a fallback if `/api/notify` is unreachable is NOT required — the bot-ui dispatch is the single path now; if it fails, we log. Do not remove the `send`/`confirm`/`fail` ledger calls — only the owner-notification path changes.

Note: this makes a bot→bot-ui→(whatsapp)→bot round-trip for a WhatsApp-routed `digest_sent`. That is intended (one routing brain). The change must be additive and guarded so a notify failure never affects the actual digest send.

- [ ] **Step 7: Extend the runnerLoop assembly test**

In `ui/src/lib/digest/runnerLoop.test.ts`, keep the existing "wires the review-gate + approval collaborators" assertion (deps are still functions). Confirm it still passes after the import changes.

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/lib/notifications/notifyEndpoint.test.ts src/lib/digest/runnerLoop.test.ts` (from `ui/`)
Expected: PASS.
Run: `npm run check --prefix ui`
Expected: 0 errors.
Run: `npm test -- run src/digest` (bot poller tests still green)
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src/lib/digest/runnerLoop.ts ui/src/routes/api/notify/+server.ts ui/src/lib/notifications/notifyEndpoint.ts ui/src/lib/notifications/notifyEndpoint.test.ts src/digest/poller.ts ui/src/lib/digest/runnerLoop.test.ts "ui/src/routes/api/digest/approve/+server.ts" "ui/src/routes/api/digest/deny/+server.ts"
git commit -m "feat(notifications): route runner + bot alerts through notify() dispatch"
```

---

### Task 7: Settings panel + config/test endpoints

**Files:**
- Create: `ui/src/routes/api/notifications/+server.ts` (GET load / POST save)
- Create: `ui/src/routes/api/notifications/test/+server.ts` (POST per-channel test)
- Create: `ui/src/routes/settings/notifications/+page.server.ts`
- Create: `ui/src/routes/settings/notifications/+page.svelte`
- Modify: `ui/src/routes/settings/+page.svelte` (add a panel card linking to `/settings/notifications`)
- Test: `ui/src/lib/notifications/testSend.ts` + `ui/src/lib/notifications/testSend.test.ts` (pure test-payload builder)

**Interfaces:**
- Consumes: `getNotificationsConfig`/`setNotificationsConfig` (Task 1), `notify` + `CHANNELS` (Task 5).
- Produces: `GET /api/notifications` → `{ config }`; `POST /api/notifications { config }` → save (blank secret = keep existing); `POST /api/notifications/test { channel }` → sends a canned alert through only that channel and returns `{ ok, error? }`. A `settings/notifications` panel renders the config cards + routing grid.

- [ ] **Step 1: Write the failing test for the test-payload builder + secret-preserve**

Create `ui/src/lib/notifications/testSend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestPayload, mergePreservingSecrets } from './testSend.js';

describe('buildTestPayload', () => {
  it('builds a recognizable test alert', () => {
    const p = buildTestPayload();
    expect(p.alertType).toBe('pipeline_failure');
    expect(p.title.toLowerCase()).toContain('test');
  });
});

describe('mergePreservingSecrets', () => {
  it('keeps the stored secret when the incoming secret field is blank', () => {
    const stored = { channels: { ntfy: { url: 'u', topic: 't', token: 'SECRET' }, whatsapp: { ownerNumber: 'o' } }, routing: {} as never };
    const incoming = { channels: { ntfy: { url: 'u2', topic: 't2', token: '' }, whatsapp: { ownerNumber: 'o2' } }, routing: {} as never };
    const merged = mergePreservingSecrets(stored as never, incoming as never);
    expect(merged.channels.ntfy.token).toBe('SECRET'); // blank kept
    expect(merged.channels.ntfy.url).toBe('u2');        // non-secret updated
  });
  it('overwrites the secret when a new value is supplied', () => {
    const stored = { channels: { ntfy: { url: 'u', topic: 't', token: 'OLD' }, whatsapp: { ownerNumber: 'o' } }, routing: {} as never };
    const incoming = { channels: { ntfy: { url: 'u', topic: 't', token: 'NEW' }, whatsapp: { ownerNumber: 'o' } }, routing: {} as never };
    expect(mergePreservingSecrets(stored as never, incoming as never).channels.ntfy.token).toBe('NEW');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/testSend.test.ts` (from `ui/`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `ui/src/lib/notifications/testSend.ts`:

```ts
import type { NotificationsConfig } from './config.js';
import type { AlertPayload } from './channels/types.js';

export function buildTestPayload(): AlertPayload {
  return { alertType: 'pipeline_failure', title: '🔔 Test notification', message: 'This is a test from the notifications settings panel.' };
}

/** Merge incoming config over stored, but keep a stored secret when the incoming secret field is blank. */
export function mergePreservingSecrets(stored: NotificationsConfig, incoming: NotificationsConfig): NotificationsConfig {
  const token = incoming.channels.ntfy.token.trim() === '' ? stored.channels.ntfy.token : incoming.channels.ntfy.token;
  return {
    channels: {
      ntfy: { ...incoming.channels.ntfy, token },
      whatsapp: { ...incoming.channels.whatsapp },
    },
    routing: incoming.routing,
  };
}
```

- [ ] **Step 4: Create the config endpoints**

Create `ui/src/routes/api/notifications/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getNotificationsConfig, setNotificationsConfig, type NotificationsConfig } from '$lib/notifications/config.js';
import { mergePreservingSecrets } from '$lib/notifications/testSend.js';

export const GET: RequestHandler = async () => {
  return json({ config: getNotificationsConfig(getDb()) });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { config?: NotificationsConfig };
  if (!body.config?.channels || !body.config?.routing) return json({ ok: false, reason: 'config required' }, { status: 400 });
  const merged = mergePreservingSecrets(getNotificationsConfig(getDb()), body.config);
  setNotificationsConfig(getDb(), merged);
  return json({ ok: true });
};
```

Create `ui/src/routes/api/notifications/test/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getNotificationsConfig, CHANNEL_IDS, type ChannelId } from '$lib/notifications/config.js';
import { CHANNELS } from '$lib/notifications/dispatch.js';
import { buildTestPayload } from '$lib/notifications/testSend.js';

const botControlUrl = process.env.BOT_CONTROL_URL ?? 'http://bot:3003';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { channel?: string };
  if (!CHANNEL_IDS.includes(body.channel as ChannelId)) return json({ ok: false, reason: 'unknown channel' }, { status: 400 });
  const ch = CHANNELS.find((c) => c.id === body.channel)!;
  const cfg = getNotificationsConfig(getDb());
  const chCfg = cfg.channels[ch.id];
  if (!ch.isConfigured(chCfg)) return json({ ok: false, error: 'channel not configured' });
  const r = await ch.sendAlert(chCfg, buildTestPayload(), { botControlUrl });
  return json(r);
};
```

- [ ] **Step 5: Create the panel server load**

Create `ui/src/routes/settings/notifications/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getNotificationsConfig, ALERT_TYPES, CHANNEL_IDS } from '$lib/notifications/config.js';
import { CHANNELS } from '$lib/notifications/dispatch.js';

export const load: PageServerLoad = async () => {
  const config = getNotificationsConfig(getDb());
  // capability map so the grid can disable a cell a channel can't service (future-proofing)
  const capabilities = Object.fromEntries(CHANNELS.map((c) => [c.id, c.capabilities]));
  return { config, alertTypes: ALERT_TYPES, channelIds: CHANNEL_IDS, capabilities };
};
```

- [ ] **Step 6: Create the panel UI**

Create `ui/src/routes/settings/notifications/+page.svelte`, following the structure of `ui/src/routes/settings/chat/+page.svelte` (same page container, headings, save button, and tailwind classes used across the settings panels). It must render:

- **Per-channel config cards** (loop `channelIds`): ntfy card with `url`/`topic`/`token` inputs (token `type="password"` placeholder `••••`, blank = unchanged); whatsapp card with `ownerNumber` input. Each card has a **Send test** button that `POST`s `/api/notifications/test { channel }` and shows the returned `{ok}`/`{error}` inline.
- **Routing grid**: an HTML table, rows = `alertTypes`, columns = `channelIds`, each cell a checkbox bound to `config.routing[alertType][channelId]`. Disable a checkbox when the channel is not configured, OR (future) when `!capabilities[channelId].includes('approval')` and the row requires approval — for Phase 1 no row requires approval, so only the not-configured disable applies.
- **Save** button → `POST /api/notifications { config }`, then reload/toast.

Reference the exact class names + layout from `settings/chat/+page.svelte`. Keep the component under one file; if it grows past ~250 lines, extract the grid into a child component.

Full inline data flow (Svelte 5 runes or the project's existing store pattern — match whatever `settings/chat` uses):

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
  let config = $state(structuredClone(data.config));
  let testResult = $state<Record<string, string>>({});

  function isConfigured(ch: string): boolean {
    if (ch === 'ntfy') return !!config.channels.ntfy.url && !!config.channels.ntfy.topic;
    if (ch === 'whatsapp') return !!config.channels.whatsapp.ownerNumber;
    return false;
  }
  async function save() {
    await fetch('/api/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) });
  }
  async function test(ch: string) {
    testResult[ch] = 'sending…';
    const r = await fetch('/api/notifications/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: ch }) }).then((x) => x.json());
    testResult[ch] = r.ok ? 'sent ✓' : `failed: ${r.error ?? r.reason ?? 'error'}`;
  }
</script>
```

(Markup: config cards + the grid table + Save, styled per the existing settings panels. The implementer builds the template to match `settings/chat`'s look.)

- [ ] **Step 7: Link the panel from the settings landing page**

In `ui/src/routes/settings/+page.svelte`, add a panel card/link to `/settings/notifications` matching the existing cards (e.g. the one linking to `/settings/api-tokens` near line 591). Label it "Notifications", one-line description "Channels + routing for pipeline alerts and the approval gate."

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/lib/notifications/testSend.test.ts` (from `ui/`)
Expected: PASS.
Run: `npm run check --prefix ui`
Expected: 0 errors (endpoints + page typecheck).

- [ ] **Step 9: Commit**

```bash
git add ui/src/routes/api/notifications ui/src/routes/settings/notifications ui/src/routes/settings/+page.svelte ui/src/lib/notifications/testSend.ts ui/src/lib/notifications/testSend.test.ts
git commit -m "feat(notifications): settings panel — config cards, routing grid, per-channel test send"
```

---

### Task 8: Live verification (CONTROLLER + USER — not a subagent)

**Files:** none (operational). Rebuilds bot + bot-ui; sends real test notifications.

- [ ] **Step 1: Rebuild + deploy**

Matt runs: `docker compose build --no-cache bot bot-ui && docker compose up -d bot bot-ui`. Verify the images are fresh.

- [ ] **Step 2: Panel loads + saves**

Open `mlb37.mattmariani.com/settings/notifications`. Confirm the ntfy card is pre-seeded from env, the whatsapp card shows the owner number, and the routing grid renders. Toggle a checkbox, Save, reload — the change persists.

- [ ] **Step 3: Per-channel test sends**

Click **Send test** on the ntfy card → a test push arrives on the phone. Click **Send test** on the WhatsApp card → a WhatsApp DM arrives from the bot. Both report "sent ✓" inline.

- [ ] **Step 4: Real fan-out**

Enable `pipeline_failure` for both ntfy + whatsapp in the grid, Save. Trigger a controlled failure (or `POST /api/notify {alertType:'pipeline_failure', title:'test', message:'fanout'}` from inside bot-ui) → confirm both channels receive it.

- [ ] **Step 5: Regression — approval gate still works**

Confirm the digest approval path still fires its ntfy notification via the new dispatch (the Phase 2 flow): the `digest_ready` alert with ntfy checked still produces the interactive Approve/Deny notification. (Use the same planted-job smoke technique from the Phase 2 approval-gate ledger if needed.)

- [ ] **Step 6: Record** the outcome in `.superpowers/sdd/progress.md`.

---

## Notes for the executor

- **Do not change the ntfy module** `ui/src/lib/digest/ntfy.ts` — the adapter wraps it. Its `publish`/builders and their tests are shared with the Phase 2 approval gate.
- **The interactive approval gate is unchanged behaviorally** — it now flows through `notify('digest_ready', {approval})` → the ntfy adapter → the same `buildApprovalNotification`. Verify parity in Task 6/8.
- **Bot-side changes (Task 6 step 6) are delicate** — additive, guarded, never throwing into the send/poll path. If unsure, report DONE_WITH_CONCERNS rather than risk the live send.
- **Secrets** (ntfy token) are masked in the UI and preserved on save when blank; never log them.
