import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFullServer } from './registerAll.js';

const server = createFullServer();
const transport = new StdioServerTransport();
await server.connect(transport);
