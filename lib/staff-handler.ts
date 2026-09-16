import { parseStaffAction, type ActionResult, type StaffAction } from "./staff-state";
export interface StaffEvent {
  type: string; mode?: string; webhookEventId: string; replyToken: string;
  source: {type: "user"; userId: string}; postback?: {data?: unknown}; message?: {type: string; text?: string};
}
export function isStaffEvent(value: unknown): value is StaffEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as StaffEvent;
  return e.mode !== "standby" && e.source?.type === "user" && typeof e.source.userId === "string" &&
    typeof e.webhookEventId === "string" && !!e.webhookEventId && typeof e.replyToken === "string" && !!e.replyToken &&
    (e.type === "postback" || (e.type === "message" && e.message?.type === "text" && e.message.text?.trim() === "งานรอ"));
}
export const STAFF_RESULTS: Record<ActionResult, string> = {
  claimed: "รับเรื่องแล้วค่ะ บอตพักอยู่ กรุณาเปิด LINE OA แล้วเลือกชื่อลูกค้าตามการ์ด เมื่อคุยจบกด ‘คืนให้บอต’ ในการ์ดเดิมได้เลย",
  already_owned: "คุณรับเคสนี้ไว้แล้วค่ะ ตอบลูกค้าใน LINE OA ได้ และกด ‘คืนให้บอต’ เมื่อคุยจบ",
  taken: "มีพนักงานคนอื่นรับเคสนี้แล้วค่ะ กรุณาให้ผู้รับเคสเป็นผู้ดูแล",
  released: "คืนให้บอตแล้วค่ะ บอตจะตอบข้อความใหม่ของลูกค้า",
  not_owner: "ยังคืนเคสนี้ไม่ได้ค่ะ ต้องเป็นพนักงานที่รับเคส หากยังไม่มีคนรับ ให้กด ‘รับเรื่อง’ ก่อน",
  stale: "เคสนี้ปิดหรือเปลี่ยนสถานะแล้วค่ะ ปุ่มเก่าใช้ไม่ได้ พิมพ์ ‘งานรอ’ เพื่อดูเคสปัจจุบัน",
  expired: "ปุ่มนี้หมดอายุแล้วค่ะ พิมพ์ ‘งานรอ’ เพื่อโหลดเคสปัจจุบัน",
  forbidden: "บัญชีนี้ไม่มีสิทธิ์จัดการเคสค่ะ",
};
interface Dependencies {
  isStaff(id: string): boolean; claimEvent(id: string): Promise<boolean>;
  actOnCase(id: string, action: StaffAction, caseId: string): Promise<ActionResult>;
  reply(token: string, text: string): Promise<void>; pending(id: string, token: string): Promise<void>;
}
export async function handleStaffEvent(e: StaffEvent, deps: Dependencies) {
  if (!deps.isStaff(e.source.userId)) {
    if (e.type === "postback" && parseStaffAction(e.postback?.data)) {
      if (await deps.claimEvent(e.webhookEventId)) await deps.reply(e.replyToken, STAFF_RESULTS.forbidden);
      return true;
    }
    return false;
  }
  const action = parseStaffAction(e.postback?.data);
  if (e.type === "postback" && !action) return true;
  if (!await deps.claimEvent(e.webhookEventId)) return true;
  if (action) {
    const result = await deps.actOnCase(e.source.userId, action.action, action.caseId);
    await deps.reply(e.replyToken, STAFF_RESULTS[result]);
  } else await deps.pending(e.source.userId, e.replyToken);
  return true;
}
