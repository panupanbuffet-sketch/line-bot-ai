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
  "claimed": "รับเรื่องสำเร็จค่ะ\n\nสถานะ: คุณเป็นผู้ดูแลเคส · บอตพักอยู่\n\n1. กด “เปิด LINE OA”\n2. เลือกลูกค้าตามชื่อในการ์ดและตอบแชต\n3. เมื่อคุยจบ กด “คืนให้บอต” ในการ์ดเดิม",
  "already_owned": "คุณรับเคสนี้ไว้แล้วค่ะ\n\nสถานะ: บอตพักอยู่\nตอบลูกค้าใน LINE OA ได้เลยค่ะ\nเมื่อคุยจบ กด “คืนให้บอต” ในการ์ดเดิม",
  "taken": "เคสนี้มีผู้ดูแลแล้วค่ะ\n\nพนักงานอีกคนรับเรื่องไว้แล้ว\nกรุณาประสานงานกับผู้รับเคสก่อนตอบลูกค้าค่ะ",
  "released": "คืนให้บอตสำเร็จค่ะ\n\nสถานะ: บอตพร้อมตอบ\nบอตจะตอบเมื่อมีข้อความใหม่จากลูกค้า\nข้อความระหว่างพักจะไม่ถูกตอบย้อนหลังค่ะ",
  "not_owner": "ยังคืนเคสนี้ไม่ได้ค่ะ\n\nเฉพาะพนักงานที่รับเคสเท่านั้นที่คืนงานได้\nหากเคสยังไม่มีผู้ดูแล ให้กด “รับเรื่อง” ก่อนค่ะ",
  "stale": "สถานะเคสเปลี่ยนแล้วค่ะ\n\nเคสนี้จบหรือถูกเปลี่ยนสถานะ จึงใช้ปุ่มเดิมไม่ได้\nพิมพ์ “งานรอ” เพื่อดูเคสปัจจุบันค่ะ",
  "expired": "ปุ่มนี้หมดอายุแล้วค่ะ\n\nพิมพ์ “งานรอ” เพื่อเรียกการ์ดของเคสปัจจุบันค่ะ",
  "forbidden": "ไม่สามารถดำเนินการได้ค่ะ\n\nบัญชีนี้ไม่มีสิทธิ์จัดการเคส\nกรุณาติดต่อผู้ดูแลร้านเพื่อตรวจสอบสิทธิ์ค่ะ"
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
