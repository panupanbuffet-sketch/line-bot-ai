import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getConversation, setConversation, recentUsers, checkStorage } from "@/lib/bot-state";
import { getProfile } from "@/lib/line";
import { getFaqData } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function authorized(req: Request) {
  const secret = process.env.BOT_ADMIN_TOKEN;
  const provided = req.headers.get("authorization") || "";
  if (!secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export async function GET(req: Request) {
  if (!authorized(req)) return json({ error: "Unauthorized" }, 401);
  try {
    const users = await recentUsers();
    const conversations = await Promise.all(users.map(async userId => {
      const state = await getConversation(userId);
      let name = userId;
      try { name = (await getProfile(userId)).displayName; } catch { /* ID remains usable */ }
      return { userId, name, mode: state.mode };
    }));
    return json({ conversations });
  } catch { return json({ error: "State storage unavailable" }, 503); }
}
const change = z.object({ userId: z.string().regex(/^U[0-9a-f]{32}$/), mode: z.enum(["bot", "human"]) });
export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: "Unauthorized" }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (body?.action === "check") {
    let stage = "storage";
    try {
      await checkStorage();
      stage = "sheet";
      const csv = await getFaqData();
      stage = "model";
      const answer = await askGemini("ร้านเปิดกี่โมง", csv);
      return json({ storage: "ok", sheet: "ok", model: answer !== DEFAULT_REPLY ? "ok" : "fallback", answer, enabled: process.env.BOT_ENABLED === "true" });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
      return json({ error: "Integration check failed", stage, upstreamStatus: status }, 503);
    }
  }
  const input = change.safeParse(body);
  if (!input.success) return json({ error: "Invalid userId or mode" }, 400);
  try {
    const state = await setConversation(input.data.userId, input.data.mode);
    return json({ mode: state.mode });
  } catch { return json({ error: "State storage unavailable" }, 503); }
}
