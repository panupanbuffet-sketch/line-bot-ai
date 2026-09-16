import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getConversation, setConversation, recentUsers, checkStorage } from "@/lib/bot-state";
import { checkStaffTransitions } from "@/lib/staff-check";
import { staffIds, isStaff } from "@/lib/staff-state";
import { caseCard } from "@/lib/staff-notifications";
import { randomUUID } from "node:crypto";
import { pushMessages } from "@/lib/line";
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
  if (body?.action === "staff-check") {
    try {
      const checks = await checkStaffTransitions();
      const validation = await fetch("https://api.line.me/v2/bot/message/validate/push", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [caseCard("ทดสอบรูปแบบ", randomUUID(), false)] }), signal: AbortSignal.timeout(5000),
      });
      return json({ ...checks, cardValidation: validation.ok ? "ok" : "failed", validationStatus: validation.status, validationDetails: validation.ok ? undefined : await validation.json(), staffCount: staffIds().length }, validation.ok ? 200 : 503);
    } catch { return json({ error: "Staff check failed" }, 503); }
  }
  if (body?.action === "staff-welcome") {
    if (typeof body.recipient !== "string" || !isStaff(body.recipient) || typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/.test(body.requestId)) return json({error:"Invalid recipient or request ID"},400);
    try {
      await pushMessages(body.recipient, [{type:"text",text:"เปิดระบบพนักงาน TASANA แล้วค่ะ เมื่อมีลูกค้าขอแอดมิน คุณจะได้รับการ์ดพร้อมปุ่ม รับเรื่อง / เปิด LINE OA / คืนให้บอต โดยไม่ต้องใส่รหัสเว็บ\nพิมพ์ ‘งานรอ’ เพื่อดูเคสล่าสุดได้ค่ะ\nหากใช้บัญชีนี้ทดสอบเป็นลูกค้าด้วย เมื่อพิมพ์ ‘แอดมิน’ จะได้รับทั้งข้อความรับเรื่องและการ์ดพนักงาน ซึ่งเป็นคนละหน้าที่ค่ะ"}], body.requestId);
      return json({sent:true});
    } catch { return json({error:"Notification failed"},503); }
  }
  if (body?.action === "check") {
    let stage = "storage";
    try {
      await checkStorage();
      stage = "sheet";
      const csv = await getFaqData();
      stage = "model";
      const question = typeof body.question === "string" && body.question.length <= 200 ? body.question : "มีเมนูเครื่องดื่มอะไร ราคาเท่าไหร่";
      const answer = await askGemini(question, csv);
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
