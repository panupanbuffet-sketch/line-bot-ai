import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getFaqData } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";
import { verifyLineSignature, replyMessage } from "@/lib/line";
import type {
  LineTextMessage,
  LineWebhookBody,
  LineWebhookEvent,
} from "@/types";

// LINE's platform gives a webhook call only ~5 seconds to return 200 before
// it retries the same event -- it does NOT wait for the actual reply to be
// sent. The replyToken itself stays valid for about 60 seconds after the
// webhook fires. So we ack LINE immediately (well under 5s) and run the
// FAQ fetch + Gemini call + reply asynchronously via waitUntil(), guarded
// by a timeout safely under that ~60s replyToken window -- not under LINE's
// 5s ack deadline, which this used to (incorrectly) race against.
const GEMINI_TIMEOUT_MS = 25000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
      );
  });
}

function isTextMessageEvent(
  event: LineWebhookEvent
  ): event is LineWebhookEvent & { replyToken: string; message: LineTextMessage } {
  return (
    event.type === "message" &&
    typeof event.replyToken === "string" &&
    event.message?.type === "text"
    );
}

async function handleEvent(
  event: LineWebhookEvent & { replyToken: string; message: LineTextMessage }
  ) {
  const question = event.message.text;

let replyText = DEFAULT_REPLY;
  try {
    const faqCsv = await getFaqData();
    replyText = await withTimeout(askGemini(question, faqCsv), GEMINI_TIMEOUT_MS);
  } catch (err) {
    console.error("Webhook handling error:", err);
    replyText = DEFAULT_REPLY;
  }

try {
  await replyMessage(event.replyToken, replyText);
} catch (err) {
  // Don't throw -- a failed reply (e.g. expired replyToken) shouldn't
  // crash the background task.
  console.error("LINE reply failed:", err);
}
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

if (!verifyLineSignature(rawBody, signature)) {
  return new Response("Invalid signature", { status: 401 });
}

let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

const events = (body.events || []).filter(isTextMessageEvent);

// Return 200 to LINE right away -- the real work happens after this
// response is sent, so it never risks missing LINE's ~5s ack deadline.
waitUntil(Promise.all(events.map(handleEvent)));

return new Response("OK", { status: 200 });
}

export async function GET() {
  return new Response("TASANA LINE Bot webhook is running.", { status: 200 });
}
