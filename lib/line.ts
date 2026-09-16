import { messagingApi, validateSignature } from "@line/bot-sdk";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

let client: messagingApi.MessagingApiClient | undefined;
function getClient(): messagingApi.MessagingApiClient {
  if (!CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured.");
  }
  if (!client) {
    client = new messagingApi.MessagingApiClient({
      channelAccessToken: CHANNEL_ACCESS_TOKEN,
    });
  }
  return client;
}

export function verifyLineSignature(
  rawBody: string,
  signature: string | null
): boolean {
  if (!CHANNEL_SECRET || !signature) return false;
  return validateSignature(rawBody, CHANNEL_SECRET, signature);
}

export async function replyMessage(
  replyToken: string,
  text: string
): Promise<void> {
  await getClient().replyMessage({
    replyToken,
    messages: [{ type: "text", text: text.slice(0, 4900) }],
  });
}
