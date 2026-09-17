import { command, key } from "./bot-state";
import { staffIds } from "./staff-state";
import { isStaffEvent, handleStaffEvent, type StaffEvent } from "./staff-handler";

export const GROUP_NAME = "TASANA | รับเรื่องลูกค้า";
export const REGISTER_GROUP = "เชื่อมกลุ่มรับเรื่อง TASANA";
export const GROUP_KEY = () => key("staff-group", "primary");
export async function staffGroup(): Promise<string | null> {
  const id = await command<string | null>("GET", GROUP_KEY());
  return id && /^C[0-9a-f]{32}$/.test(id) ? id : null;
}
export async function registerGroup(groupId: string, actor: string) {
  if (actor !== staffIds()[0] || !/^C[0-9a-f]{32}$/.test(groupId)) return false;
  // First group wins. A message in another group cannot redirect notifications.
  return await command("SET", GROUP_KEY(), groupId, "NX") === "OK" || await staffGroup() === groupId;
}
export async function forgetGroup(groupId: string) {
  await command("EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, GROUP_KEY(), groupId);
}
export interface GroupEvent {
  type: string; mode?: string; webhookEventId: string; replyToken?: string;
  source: {type: "group"; groupId: string; userId?: string};
  message?: {type: string; text?: string}; postback?: {data?: unknown};
}
export function isGroupEvent(value: unknown): value is GroupEvent {
  const e = value as GroupEvent;
  return !!e && e.mode !== "standby" && e.source?.type === "group" && /^C[0-9a-f]{32}$/.test(e.source.groupId) && typeof e.webhookEventId === "string" && !!e.webhookEventId;
}
type StaffDeps = Parameters<typeof handleStaffEvent>[1];
export interface GroupDependencies {
  staff: StaffDeps; owner(id: string): boolean;
  group(): Promise<string | null>; register(group: string, actor: string): Promise<boolean>;
  forget(group: string): Promise<void>; groupName(group: string): Promise<string>;
}
export async function handleGroupEvent(e: GroupEvent, deps: GroupDependencies) {
  const group = e.source.groupId;
  if (e.type === "leave") { await deps.forget(group); return; }
  const actor = e.source.userId;
  if (!actor || !/^U[0-9a-f]{32}$/.test(actor) || !e.replyToken) return;
  if (e.type === "message" && e.message?.type === "text" && e.message.text?.trim() === REGISTER_GROUP) {
    if (!deps.owner(actor) || !await deps.staff.claimEvent(e.webhookEventId)) return;
    if (await deps.groupName(group) !== GROUP_NAME) {
      await deps.staff.reply(e.replyToken, `กรุณาตั้งชื่อกลุ่มเป็น “${GROUP_NAME}” แล้วส่งคำสั่งเชื่อมอีกครั้งค่ะ`); return;
    }
    const ok = await deps.register(group, actor);
    await deps.staff.reply(e.replyToken, ok ? "เชื่อมกลุ่มรับเรื่อง TASANA แล้วค่ะ\n\nลูกค้าขอแอดมิน → แจ้งเตือนในกลุ่มนี้\nรับเรื่อง → แจ้งชื่อผู้รับและพักบอต\nคืนให้บอต → แจ้งปิดเคส\n\nพิมพ์ “งานรอ” เพื่อดูเคสล่าสุด\nเฉพาะพนักงานที่ลงทะเบียนมีสิทธิ์กดปุ่มค่ะ" : "มีการเชื่อมกลุ่มอื่นไว้แล้วค่ะ กรุณาติดต่อผู้ดูแลก่อนเปลี่ยนกลุ่ม");
    return;
  }
  // Group chatter never goes to the customer AI, even in the registered group.
  const direct = {...e, replyToken: e.replyToken, source: {type: "user" as const, userId: actor}};
  if (!isStaffEvent(direct) || !deps.staff.isStaff(actor) || await deps.group() !== group) return;
  await handleStaffEvent(direct as StaffEvent, deps.staff);
}
