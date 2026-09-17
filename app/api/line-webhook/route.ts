import { menuMessages } from "@/lib/menu-cards";
import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getFaqData } from "@/lib/sheet";
import { askGemini } from "@/lib/gemini";
import { verifyLineSignature, replyMessage, replyMessages } from "@/lib/line";
import { handleBotEvent, isTextMessageEvent, type TextEvent } from "@/lib/bot-handler";
import { isStaffEvent, handleStaffEvent } from "@/lib/staff-handler";
import { isStaff, actOnCase } from "@/lib/staff-state";
import { notifyHandoff, pendingCases } from "@/lib/staff-notifications";
import * as state from "@/lib/bot-state";

export const runtime = "nodejs";
export const maxDuration = 60;
async function answer(question: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getFaqData().then(csv => askGemini(question, csv)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Answer timeout")), 30000); }),
    ]);
  } finally { clearTimeout(timer); }
}
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyLineSignature(rawBody, req.headers.get("x-line-signature"))) return new Response("Invalid signature", { status: 401 });
  let body;
  try { body = JSON.parse(rawBody); } catch { return new Response("Bad request", { status: 400 }); }
  if (!body || !Array.isArray(body.events)) return new Response("Invalid events", { status: 400 });
  if (!body.events.length) return new Response("OK");
  if (!state.stateConfigured()) return new Response("Bot storage unavailable", { status: 503 });
  if (process.env.BOT_ENABLED !== "true") return new Response("Bot paused");
  const events = body.events.filter((e: unknown) => isTextMessageEvent(e) || isStaffEvent(e)) as TextEvent[];
  const users = [...new Set(events.map(event => event.source.userId))];
  // Order preserved within a batch; independent webhook requests may overlap.
  waitUntil(Promise.all(users.map(async userId => {
    for (const event of events.filter(event => event.source.userId === userId)) {
      try {
        if (isStaffEvent(event) && await handleStaffEvent(event, { isStaff, actOnCase, claimEvent: state.claimEvent, reply: replyMessage, pending: pendingCases })) continue;
        if (!isTextMessageEvent(event)) continue;
        await state.rememberUser(userId);
        await handleBotEvent(event, { ...state, answer, reply: replyMessage, replyMenu: (token, language) => replyMessages(token, menuMessages(language)), notifyHandoff });
      }
      catch { console.error("Bot event failed; automatic reply suppressed"); }
    }
  })));
  return new Response("OK");
}
export async function GET() {
  return new Response("TASANA LINE Bot webhook is running.", { status: 200 });
}
