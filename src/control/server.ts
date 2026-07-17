/**
 * Local control server for the bot. Binds to 127.0.0.1 INSIDE the container only
 * — it is a send-capable surface, so it is never exposed to the host or network.
 * Invoke it with `docker exec <bot> node -e "fetch('http://127.0.0.1:PORT/...')"`.
 *
 * Routes (see router.ts):
 *   POST /trigger                       run one scheduled poll now
 *   POST /send {roundId, target, mode}  send any round's digest to any group
 *                                       (mode defaults to dry-run)
 */
import http from 'node:http';
import { parseControlRequest } from './router.js';
import type { ManualSendReq, ManualSendResult } from '../digest/manualSend.js';

export interface ControlHandlers {
  onTrigger: () => Promise<void>;
  onSend: (req: ManualSendReq) => Promise<ManualSendResult>;
}

const CONTROL_HOST = '127.0.0.1';
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
        } else {
          reply(400, { ok: false, reason: route.reason });
        }
      } catch (err) {
        reply(500, { ok: false, reason: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  server.listen(port, CONTROL_HOST, () => {
    console.log(`[control] listening on ${CONTROL_HOST}:${port} (container-local only)`);
  });
  server.unref();
  return server;
}
