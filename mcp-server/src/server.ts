import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Transport-agnostic: this factory registers every tool (Tasks 9-11 each
// call `.tool(...)` on the instance returned here) but never connects a
// transport itself. index.ts picks stdio today; an HTTP/SSE entrypoint
// later just imports this same factory and connects a different transport.
export function createServer(): McpServer {
  return new McpServer({
    name: 'music-league-mcp-server',
    version: '0.1.0',
  });
}
