import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { registerRoundTools } from './tools/rounds.js';
import { registerSongTools } from './tools/songs.js';
import { registerH2HTools } from './tools/h2h.js';
import { registerDigestTools } from './tools/digest.js';
import { registerThemeBriefTools } from './tools/themeBrief.js';

const server = createServer();
registerRoundTools(server);
registerSongTools(server);
registerH2HTools(server);
registerDigestTools(server);
registerThemeBriefTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
