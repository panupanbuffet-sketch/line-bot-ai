import { randomUUID } from "node:crypto";
import type { messagingApi } from "@line/bot-sdk";
import { getConversation, recentUsers } from "./bot-state";
import { createCase, staffIds, isStaff } from "./staff-state";
import { getProfile, pushMessages, replyMessages } from "./line";

export function caseCard(name: string, caseId: string, owned: boolean): messagingApi.TemplateMessage {
  return {
    type: "template", altText: `TASANA: ${name.slice(0, 40)} ต้องการเจ้าหน้าที่`,
    template: { type: "buttons",
      text: `TASANA · ดูแลลูกค้า\n\nลูกค้า: ${name.replace(/[\r\n\t]/g, " ").slice(0, 35)}\nสถานะ: ${owned ? "มีผู้ดูแลแล้ว" : "รอรับเรื่อง"} · บอตพัก\n\nเคส ${caseId.slice(0, 8)} · ปุ่มใช้ได้ 7 วัน`,
      actions: [
        { type: "postback", label: "รับเรื่อง", data: `staff:claim:${caseId}` },
        { type: "uri", label: "เปิด LINE OA", uri: "https://chat.line.biz/account/@409xrtpd" },
        { type: "postback", label: "คืนให้บอต", data: `staff:release:${caseId}` },
      ],
    },
  };
}
async function cardFor(userId: string) {
  const ticket = await createCase(userId);
  if (!ticket) return null;
  let name = "ลูกค้า (ตรวจชื่อในหน้าเว็บผู้ดูแล)";
  try { name = (await getProfile(userId)).displayName; } catch { /* no raw user ID in notifications */ }
  return caseCard(name, ticket.caseId, !!ticket.owner);
}
export async function notifyHandoff(userId: string) {
  const recipients = staffIds();
  if (!recipients.length) return;
  const card = await cardFor(userId);
  if (!card) return;
  const results = await Promise.allSettled(recipients.map(to => pushMessages(to, [card], randomUUID())));
  if (results.some(result => result.status === "rejected")) console.error("Staff notification failed; use pending command or admin page");
}
export async function pendingCases(staffId: string, replyToken: string) {
  if (!isStaff(staffId)) return;
  const messages: messagingApi.Message[] = [];
  for (const userId of await recentUsers()) {
    const state = await getConversation(userId);
    if (state.mode !== "human" || (state.owner && state.owner !== staffId)) continue;
    const card = await cardFor(userId);
    if (card) messages.push(card);
    if (messages.length === 4) break;
  }
  messages.push({ type: "text", text: messages.length ? "รายการงานปัจจุบัน\n\nแสดงสูงสุด 4 เคส จากผู้ติดต่อ 20 คนล่าสุด\n\n• กด “รับเรื่อง” ก่อนตอบลูกค้า\n• กด “คืนให้บอต” เมื่อคุยจบ\n• พิมพ์ “งานรอ” เพื่อโหลดรายการใหม่ค่ะ" : "ไม่มีงานรอในรายการล่าสุดค่ะ\n\nขณะนี้ไม่พบเคสที่รอคุณดูแลในผู้ติดต่อ 20 คนล่าสุด\nพิมพ์ “งานรอ” เพื่อดูรายการใหม่ได้ค่ะ" });
  await replyMessages(replyToken, messages);
}
