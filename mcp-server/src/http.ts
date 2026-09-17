import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createFullServer } from './registerAll.js';
import { createAccessVerifier } from './accessAuth.js';

// Streamable HTTP entrypoint, published behind Cloudflare Access through the
// CM4 tunnel. Stateless: a fresh McpServer + transport per request, so there
// is no session table to leak or lose on restart.
//
// Env: MCP_HTTP_HOST, MCP_HTTP_PORT, CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD,
//      MCP_ALLOWED_EMAILS (comma list, optional), plus BOT_UI_* for the tools.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the HTTP entrypoint`);
  return v;
}

const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
const port = Number(process.env.MCP_HTTP_PORT ?? 3890);
const verify = createAccessVerifier({
  teamDomain: required('CF_ACCESS_TEAM_DOMAIN'),
  audience: required('CF_ACCESS_AUD'),
  allowedEmails: (process.env.MCP_ALLOWED_EMAILS ?? '').split(','),
});

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4 * 1024 * 1024) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const header = req.headers['cf-access-jwt-assertion'];
    const who = await verify(Array.isArray(header) ? header[0] : header);
    console.log(`${req.method} /mcp ${who.email}`);
  } catch (err) {
    console.warn(`rejected ${req.method} /mcp from ${req.socket.remoteAddress}: ${(err as Error).message}`);
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  // Stateless mode has no server-initiated stream and nothing to delete.
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' }).end();
    return;
  }

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    return;
  }

  const server = createFullServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('mcp request failed:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
}

const httpServer = createHttpServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/healthz') {
    sendJson(res, 200, { ok: true });
  } else if (path === '/mcp') {
    void handleMcp(req, res);
  } else {
    sendJson(res, 404, { error: 'not found' });
  }
});

httpServer.listen(port, host, () => {
  console.log(`music-league MCP (Streamable HTTP) on http://${host}:${port}/mcp`);
});
