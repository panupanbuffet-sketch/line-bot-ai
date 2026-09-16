import crypto from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createLineOaMcpServer } from "@/lib/mcp-tools";

export const runtime = "nodejs";

// The path segment itself is the credential: only someone who knows this
// exact URL (kept secret, like a webhook token) can reach the LINE tools.
function isAuthorized(token: string): boolean {
  const expected = process.env.MCP_SECRET_TOKEN;
  if (!expected) return false;
  const provided = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}

async function handle(
  req: Request,
  { params }: { params: { token: string } }
): Promise<Response> {
  if (!isAuthorized(params.token)) {
    return new Response("Not found", { status: 404 });
  }

  const server = createLineOaMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
