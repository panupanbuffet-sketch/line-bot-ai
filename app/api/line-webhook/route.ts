import type { NextRequest } from "next/server";
import { getFaqData } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";
import { verifyLineSignature, replyMessage } from "@/lib/line";
import type {
  LineTextMessage,
  LineWebhookBody,
  LineWebhookEvent,
} from "@/types";

// LINE expects a reply well within its own timeout window; guard the
// Gemini call so a slow/stuck request still gets a reply instead of
// letting LINE's webhook call itself time out.
const GEMINI_TIMEOUT_MS = 8000;

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

  const events = body.events || [];

  await Promise.all(
    events.map(async (event) => {
      if (!isTextMessageEvent(event)) return;
      const question = event.message.text;

      let replyText = DEFAULT_REPLY;
      try {
        const faqCsv = await getFaqData();
        replyText = await withTimeout(
          askGemini(question, faqCsv),
          GEMINI_TIMEOUT_MS
        );
      } catch (err) {
        console.error("Webhook handling error:", err);
        replyText = DEFAULT_REPLY;
      }

      try {
        await replyMessage(event.replyToken, replyText);
      } catch (err) {
        // Don't throw — a failed reply (e.g. expired replyToken) shouldn't
        // crash the handler or stop LINE from getting its 200.
        console.error("LINE reply failed:", err);
      }
    })
  );

  return new Response("OK", { status: 200 });
}

export async function GET() {
  return new Response("TASANA LINE Bot webhook is running.", { status: 200 });
}
