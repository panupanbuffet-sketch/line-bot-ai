import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  broadcastMessage,
  getBotInfo,
  getMessageQuotaInfo,
  getProfile,
  multicastMessage,
  pushMessage,
} from "@/lib/line";

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const anyErr = err as { originalError?: { response?: { data?: unknown } }; message?: string };
  const message = anyErr?.originalError?.response?.data
    ? JSON.stringify(anyErr.originalError.response.data)
    : anyErr?.message || String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function createLineOaMcpServer(): McpServer {
  const server = new McpServer({ name: "line-oa", version: "1.0.0" });

  server.tool(
    "line_push_message",
    "Send a text message directly to one LINE user by their userId (uses the push API, not tied to a webhook reply token).",
    { to: z.string().describe("LINE userId, groupId, or roomId"), text: z.string().max(5000) },
    async ({ to, text }) => {
      try {
        await pushMessage(to, text);
        return textResult(`Message sent to ${to}.`);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "line_multicast_message",
    "Send the same text message to multiple LINE userIds at once (max 500 recipients).",
    { to: z.array(z.string()).min(1).max(500), text: z.string().max(5000) },
    async ({ to, text }) => {
      try {
        await multicastMessage(to, text);
        return textResult(`Message sent to ${to.length} recipient(s).`);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "line_broadcast_message",
    "Broadcast a text message to every friend/follower of this LINE Official Account.",
    { text: z.string().max(5000) },
    async ({ text }) => {
      try {
        await broadcastMessage(text);
        return textResult("Broadcast sent to all followers.");
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "line_get_profile",
    "Look up a LINE user's display name, picture URL, and status message by their userId.",
    { userId: z.string() },
    async ({ userId }) => {
      try {
        return textResult(await getProfile(userId));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "line_get_bot_info",
    "Get this channel's bot info (basic ID, display name, picture, chat mode).",
    {},
    async () => {
      try {
        return textResult(await getBotInfo());
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "line_get_message_quota",
    "Get the monthly free-tier message quota and how much of it has been used, plus how many messages were sent today.",
    {},
    async () => {
      try {
        return textResult(await getMessageQuotaInfo());
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}
