import { replyLanguage } from "./reply-language";
import type { LineWebhookEvent, LineTextMessage } from "../types/index";

export type TextEvent = LineWebhookEvent & { webhookEventId: string; replyToken: string; message: LineTextMessage; source: { type: "user"; userId: string } };
type State = { mode: "bot" | "human"; version: string };
export interface BotDependencies {
  claimEvent(id: string): Promise<boolean>;
  getConversation(id: string): Promise<State>;
  pauseConversation(id: string, version: string): Promise<boolean>;
  canReply(id: string, version: string): Promise<boolean>;
  answer(question: string): Promise<string>;
  reply(token: string, text: string): Promise<void>;
  notifyHandoff?(userId: string): Promise<void>;
}
export const HUMAN_REQUESTS = new Set(["แอดมิน", "ติดต่อแอดมิน", "คุยกับเจ้าหน้าที่", "คุยกับพนักงาน", "เจ้าหน้าที่", "admin", "human", "staff", "talk to staff", "talk to a human", "contact staff"]);
export const HANDOFF_REPLY = "รับเรื่องแล้วค่ะ\n\nระบบตอบอัตโนมัติพักแล้ว เพื่อให้เจ้าหน้าที่ดูแลต่อ\nฝากคำถามหรือรายละเอียดไว้ในแชตนี้ได้เลยค่ะ\n\nติดต่อเร่งด่วน\nโทร 061-794-7955";
export const FAILURE_REPLY = "ขออภัยค่ะ ขณะนี้ตรวจสอบข้อมูลไม่ได้\n\nระบบตอบอัตโนมัติพักแล้ว เพื่อให้เจ้าหน้าที่ช่วยตรวจสอบ\nกรุณาฝากคำถามไว้ในแชตนี้ค่ะ\n\nติดต่อร้าน\nโทร 061-794-7955";
export const ENGLISH_HANDOFF_REPLY = "Your request has been received.\n\nAutomatic replies are paused so our team can help. Please leave your question or details here.\n\nFor urgent enquiries, call 061-794-7955.";
export const ENGLISH_FAILURE_REPLY = "Sorry, we cannot check the information right now.\n\nAutomatic replies are paused so our team can help. Please leave your question here.\n\nContact us: 061-794-7955.";
export function isTextMessageEvent(event: unknown): event is TextEvent {
  if (!event || typeof event !== "object") return false;
  const e = event as TextEvent;
  return e.type === "message" && e.mode !== "standby" &&
    typeof e.webhookEventId === "string" && e.webhookEventId.length > 0 &&
    typeof e.replyToken === "string" && e.replyToken.length > 0 &&
    e.source?.type === "user" && typeof e.source.userId === "string" &&
    e.message?.type === "text" && typeof e.message.text === "string";
}
export async function handleBotEvent(event: TextEvent, deps: BotDependencies) {
  if (!await deps.claimEvent(event.webhookEventId)) return;
  const userId = event.source.userId;
  const english = replyLanguage(event.message.text) === "en";
  const state = await deps.getConversation(userId);
  if (state.mode === "human") return;
  if (HUMAN_REQUESTS.has(event.message.text.trim().toLowerCase())) {
    if (await deps.pauseConversation(userId, state.version)) {
      await Promise.all([deps.reply(event.replyToken, english ? ENGLISH_HANDOFF_REPLY : HANDOFF_REPLY), deps.notifyHandoff?.(userId)]);
    }
    return;
  }
  let answer: string;
  try { answer = await deps.answer(event.message.text); }
  catch {
    if (await deps.pauseConversation(userId, state.version)) {
      await Promise.all([deps.reply(event.replyToken, english ? ENGLISH_FAILURE_REPLY : FAILURE_REPLY), deps.notifyHandoff?.(userId)]);
    }
    return;
  }
  // Pause + resume also invalidates any old answer still being generated.
  if (await deps.canReply(userId, state.version)) await deps.reply(event.replyToken, answer);
}
