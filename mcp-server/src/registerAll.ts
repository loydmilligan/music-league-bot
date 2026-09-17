import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from './server.js';
import { registerRoundTools } from './tools/rounds.js';
import { registerSongTools } from './tools/songs.js';
import { registerH2HTools } from './tools/h2h.js';
import { registerDigestTools } from './tools/digest.js';
import { registerThemeBriefTools } from './tools/themeBrief.js';

// One place that knows the full tool set, shared by the stdio and HTTP entrypoints.
export function createFullServer(): McpServer {
  const server = createServer();
  registerRoundTools(server);
  registerSongTools(server);
  registerH2HTools(server);
  registerDigestTools(server);
  registerThemeBriefTools(server);
  return server;
}
