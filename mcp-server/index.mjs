#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { messagingApi } from "@line/bot-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!CHANNEL_ACCESS_TOKEN) {
  console.error(
    "LINE_CHANNEL_ACCESS_TOKEN is not set. Add it to .env at the project root."
  );
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err) {
  const message = err?.originalError?.response?.data
    ? JSON.stringify(err.originalError.response.data)
    : err?.message || String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

const server = new McpServer({ name: "line-oa", version: "1.0.0" });

server.tool(
  "line_push_message",
  "Send a text message directly to one LINE user by their userId (uses the push API, not tied to a webhook reply token).",
  { to: z.string().describe("LINE userId, groupId, or roomId"), text: z.string().max(5000) },
  async ({ to, text }) => {
    try {
      await client.pushMessage({ to, messages: [{ type: "text", text }] });
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
      await client.multicast({ to, messages: [{ type: "text", text }] });
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
      await client.broadcast({ messages: [{ type: "text", text }] });
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
      const profile = await client.getProfile(userId);
      return textResult(profile);
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
      const info = await client.getBotInfo();
      return textResult(info);
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
      const [quota, consumption] = await Promise.all([
        client.getMessageQuota(),
        client.getMessageQuotaConsumption(),
      ]);
      return textResult({ quota, consumption });
    } catch (err) {
      return errorResult(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
