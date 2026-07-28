/**
 * Local control server for the bot. Binds to 0.0.0.0 so it is reachable by
 * sibling compose containers (e.g. bot-ui POSTing /trigger) — it is a
 * send-capable surface, so it is never published to the host (no `ports:` on
 * the `bot` service in docker-compose.yml), only reachable within the
 * internal compose network.
 *
 * Routes (see router.ts):
 *   POST /trigger                       run one scheduled poll now
 *   POST /send {roundId, target, mode}  send any round's digest to any group
 *                                       (mode defaults to dry-run)
 *   POST /notify {text}                 DM the bot owner (fixed recipient)
 */
import http from 'node:http';
import { parseControlRequest } from './router.js';
import type { ManualSendReq, ManualSendResult } from '../digest/manualSend.js';

export interface ControlHandlers {
  onTrigger: () => Promise<void>;
  onSend: (req: ManualSendReq) => Promise<ManualSendResult>;
  onNotify: (text: string) => Promise<void>;
  onPoll: (
    target: string | null,
    name: string,
    options: string[],
    allowMultiple: boolean,
  ) => Promise<{ target: string }>;
  onMedia: (
    target: string | null,
    file: string,
    caption: string | null,
    pin: number | null,
  ) => Promise<{ target: string }>;
  onSay: (
    target: string | null,
    text: string,
    pin: number | null,
  ) => Promise<{ target: string }>;
  onPrompt: (prompt: Record<string, unknown>) => Promise<{ id: string }>;
}

// Bind on the compose network so bot-ui (a sibling container) can POST /trigger
// for immediate sends. NOT published to the host — see docker-compose.yml (`bot`
// has no `ports:`), so only sibling containers can reach it. /send stays dry-run
// by default and sendGuard stays fail-closed.
const CONTROL_HOST = process.env.BOT_CONTROL_HOST ?? '0.0.0.0';
const DEFAULT_CONTROL_PORT = 3003;

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

export function startControlServer(handlers: ControlHandlers): http.Server {
  const port = Number(process.env.BOT_CONTROL_PORT) || DEFAULT_CONTROL_PORT;

  const server = http.createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const route = parseControlRequest(req.method ?? '', req.url ?? '', body);
      const reply = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      try {
        if (route.action === 'trigger') {
          await handlers.onTrigger();
          reply(200, { ok: true, action: 'trigger' });
        } else if (route.action === 'send') {
          const result = await handlers.onSend(route);
          reply(200, { ok: true, action: 'send', ...result });
        } else if (route.action === 'notify') {
          await handlers.onNotify(route.text);
          reply(200, { ok: true, action: 'notify' });
        } else if (route.action === 'poll') {
          const result = await handlers.onPoll(route.target, route.name, route.options, route.allowMultiple);
          reply(200, { ok: true, action: 'poll', ...result });
        } else if (route.action === 'media') {
          const result = await handlers.onMedia(route.target, route.file, route.caption, route.pin);
          reply(200, { ok: true, action: 'media', ...result });
        } else if (route.action === 'prompt') {
          const result = await handlers.onPrompt(route.prompt);
          reply(200, { ok: true, action: 'prompt', ...result });
        } else if (route.action === 'say') {
          const result = await handlers.onSay(route.target, route.text, route.pin);
          reply(200, { ok: true, action: 'say', ...result });
        } else {
          reply(400, { ok: false, reason: route.reason });
        }
      } catch (err) {
        reply(500, { ok: false, reason: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  server.listen(port, CONTROL_HOST, () => {
    console.log(`[control] listening on ${CONTROL_HOST}:${port} (reachable by sibling compose containers)`);
  });
  server.unref();
  return server;
}
