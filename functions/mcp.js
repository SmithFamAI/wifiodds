/* POST /mcp — the MCP server endpoint. A ROUTE BINDING, NOT LOGIC.
 * Everything real is in functions/_lib/mcp.mjs so that plain node can import and
 * call it with a mock context (build/apitest.js does exactly that — wrangler is
 * not installed on this machine, so that harness is the only pre-ship test there
 * is). Keep this file one line long. */
export { mcpRequest as onRequest } from './_lib/mcp.mjs';
