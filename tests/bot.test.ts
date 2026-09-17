import test from "node:test";
import assert from "node:assert/strict";
import { handleBotEvent, isTextMessageEvent, HANDOFF_REPLY, FAILURE_REPLY, type BotDependencies, type TextEvent } from "../lib/bot-handler";
import { claimEvent, getConversation } from "../lib/bot-state";
import { getFaqData } from "../lib/sheet";

function event(text = "menu", id = "event-1"): TextEvent {
  return { type: "message", timestamp: 1, webhookEventId: id, replyToken: "test-token", source: { type: "user", userId: "U123" }, message: { type: "text", id, text } };
}
function fixture() {
  let state: {mode: "bot" | "human"; version: string} = { mode: "bot", version: "initial" };
  const claimed = new Set<string>(); const replies: string[] = []; let calls = 0;
  const deps: BotDependencies = {
    async claimEvent(id) { if (claimed.has(id)) return false; claimed.add(id); return true; },
    async getConversation() { return { ...state }; },
    async pauseConversation(_, version) { if (state.mode !== "bot" || state.version !== version) return false; state = { mode: "human", version: "paused" }; return true; },
    async canReply(_, version) { return state.mode === "bot" && state.version === version; },
    async answer() { calls++; return "price from sheet"; },
    async reply(_, text) { replies.push(text); },
  };
  return { deps, replies, calls: () => calls, state: () => state, set: (next: typeof state) => { state = next; } };
}
test("concurrent redelivery generates and replies once", async () => {
  const f = fixture(); await Promise.all([handleBotEvent(event(), f.deps), handleBotEvent(event(), f.deps)]);
  assert.equal(f.calls(), 1); assert.deepEqual(f.replies, ["price from sheet"]);
});
test("human request bypasses AI and suppresses subsequent customer messages", async () => {
  const f = fixture(); await handleBotEvent(event("แอดมิน"), f.deps); await handleBotEvent(event("hello", "second"), f.deps);
  assert.equal(f.calls(), 0); assert.equal(f.state().mode, "human"); assert.deepEqual(f.replies, [HANDOFF_REPLY]);
});
test("two concurrent takeover requests acknowledge once", async () => {
  const f = fixture(); await Promise.all([handleBotEvent(event("admin", "a"), f.deps), handleBotEvent(event("admin", "b"), f.deps)]);
  assert.deepEqual(f.replies, [ENGLISH_HANDOFF_REPLY]);
});
test("takeover while AI is running cancels its reply", async () => {
  const f = fixture(); f.deps.answer = async () => { f.set({ mode: "human", version: "new" }); return "late"; };
  await handleBotEvent(event(), f.deps); assert.deepEqual(f.replies, []);
});
test("pause and resume also discard old generated answer", async () => {
  const f = fixture(); f.deps.answer = async () => { f.set({ mode: "bot", version: "resumed" }); return "late"; };
  await handleBotEvent(event(), f.deps); assert.deepEqual(f.replies, []);
});
test("data/AI failure pauses bot and sends one honest fallback", async () => {
  const f = fixture(); f.deps.answer = async () => { throw new Error("sheet unavailable"); };
  await handleBotEvent(event(), f.deps); assert.deepEqual(f.replies, [ENGLISH_FAILURE_REPLY]); assert.equal(f.state().mode, "human");
});
test("unavailable state fails closed without calling AI", async () => {
  const f = fixture(); f.deps.getConversation = async () => { throw new Error("offline"); };
  await assert.rejects(handleBotEvent(event(), f.deps)); assert.equal(f.calls(), 0); assert.deepEqual(f.replies, []);
});
test("ambiguous send failure is not retried on redelivery", async () => {
  const f = fixture(); let attempts = 0; f.deps.reply = async () => { attempts++; throw new Error("timeout"); };
  await assert.rejects(handleBotEvent(event(), f.deps)); await handleBotEvent(event(), f.deps); assert.equal(attempts, 1);
});
test("only valid direct text messages enter AI routing", () => {
  assert.equal(isTextMessageEvent(event()), true);
  for (const value of [null, {}, {...event(), webhookEventId: undefined}, {...event(), mode: "standby"}, {...event(), source: {type:"group", userId:"U123"}}, {...event(), type:"follow"}, {...event(), message:{type:"image"}}]) assert.equal(isTextMessageEvent(value), false);
});
test("Redis admission uses atomic NX and a seven-day expiry", async () => {
  const original = global.fetch;
  process.env.UPSTASH_REDIS_REST_URL = "https://test.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
  let requests = 0;
  global.fetch = async (_, init) => {
    const args = JSON.parse(init!.body as string);
    assert.equal(args[0], "SET"); assert.deepEqual(args.slice(3), ["NX", "EX", 604800]);
    return Response.json({ result: requests++ === 0 ? "OK" : null });
  };
  try { assert.equal(await claimEvent("one"), true); assert.equal(await claimEvent("one"), false); }
  finally { global.fetch = original; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; }
});
test("missing state storage cannot silently enable bot", async () => {
  await assert.rejects(getConversation("user"), /not configured/);
});
test("sheet rejects HTML and does not return stale prices after refresh failure", async () => {
  const original = global.fetch; const now = Date.now;
  process.env.SHEET_CSV_URL = "https://test.invalid/menu.csv";
  try {
    global.fetch = async () => new Response("<html>Sign in</html>");
    await assert.rejects(getFaqData(), /HTML/);
    global.fetch = async () => new Response("menu,price\nLatte,80");
    assert.match(await getFaqData(), /Latte/);
    Date.now = () => now() + 61000;
    global.fetch = async () => new Response("Unavailable", { status: 503 });
    await assert.rejects(getFaqData(), /503/);
  } finally { global.fetch = original; Date.now = now; delete process.env.SHEET_CSV_URL; }
});

import { handleStaffEvent, isStaffEvent, type StaffEvent } from "../lib/staff-handler";
import { actOnCase, parseStaffAction, staffIds } from "../lib/staff-state";
import { caseCard } from "../lib/staff-notifications";
const staffId = "U" + "a".repeat(32);
const ticketId = "a1234567-1234-4234-8234-123456789012";
function staffEvent(): StaffEvent { return { type: "postback", webhookEventId: "staff-event", replyToken: "reply", source: {type:"user", userId:staffId}, postback: {data:`staff:claim:${ticketId}`} }; }
test("staff allowlist rejects malformed IDs and deduplicates", () => {
  process.env.BOT_STAFF_IDS = `${staffId}, invalid, ${staffId}`;
  try { assert.deepEqual(staffIds(), [staffId]); } finally { delete process.env.BOT_STAFF_IDS; }
});
test("unauthorized actor cannot read or mutate case storage", async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error("must not access storage"); };
  try { assert.equal(await actOnCase("outsider", "release", ticketId), "forbidden"); }
  finally { global.fetch = original; }
});
test("postback parser rejects tampering and group/standby events", () => {
  assert.deepEqual(parseStaffAction(`staff:claim:${ticketId}`), {action:"claim", caseId:ticketId});
  for (const data of [null, "staff:release:customer-id", `staff:delete:${ticketId}`, `staff:claim:${ticketId}:extra`]) assert.equal(parseStaffAction(data), null);
  assert.equal(isStaffEvent(staffEvent()), true);
  assert.equal(isStaffEvent({...staffEvent(), source:{type:"group", userId:staffId}}), false);
  assert.equal(isStaffEvent({...staffEvent(), mode:"standby"}), false);
});
test("forwarded staff button is denied before action", async () => {
  let mutations = 0; const replies: string[] = [];
  await handleStaffEvent(staffEvent(), {isStaff:()=>false, claimEvent:async()=>true, actOnCase:async()=>{mutations++;return "claimed";}, reply:async(_,text)=>{replies.push(text);}, pending:async()=>{throw new Error("forbidden");}});
  assert.equal(mutations, 0); assert.match(replies[0], /ไม่มีสิทธิ์/);
});
test("redelivered staff click executes once", async () => {
  let seen = false; let mutations = 0;
  const deps = {isStaff:()=>true, claimEvent:async()=>{if(seen)return false;seen=true;return true;}, actOnCase:async()=>{mutations++;return "claimed" as const;}, reply:async()=>{}, pending:async()=>{}};
  await Promise.all([handleStaffEvent(staffEvent(),deps),handleStaffEvent(staffEvent(),deps)]);
  assert.equal(mutations,1);
});
test("staff pending command works even without customer AI routing", async () => {
  let pending = 0;
  const e = {...staffEvent(),type:"message",postback:undefined,message:{type:"text",text:"งานรอ"}};
  await handleStaffEvent(e,{isStaff:()=>true,claimEvent:async()=>true,actOnCase:async()=>{throw new Error("unexpected");},reply:async()=>{},pending:async()=>{pending++;}});
  assert.equal(pending,1);
});
test("handoff notifies once and still attempts notification when customer reply fails", async () => {
  const f = fixture(); let notifications=0;
  f.deps.notifyHandoff=async()=>{notifications++;};
  f.deps.reply=async()=>{throw new Error("reply expired");};
  await assert.rejects(handleBotEvent(event("แอดมิน"),f.deps));
  await handleBotEvent(event("แอดมิน","second"),f.deps);
  assert.equal(notifications,1); assert.equal(f.state().mode,"human");
});
test("staff cards contain opaque case buttons and stay inside LINE limits", () => {
  const card = caseCard("ช".repeat(100), ticketId, false);
  assert.equal(card.template.type,"buttons");
  if(card.template.type!=="buttons")throw new Error("wrong template");
  assert.ok(card.template.text.length <= (card.template.title || card.template.thumbnailImageUrl ? 60 : 160));
  assert.equal(card.template.actions.length,3);
  assert.ok(!JSON.stringify(card).includes(staffId));
});

import { pushMessages } from "../lib/line";
test("notification retries ambiguous network failure with identical retry key and payload", async () => {
  const original=global.fetch; const requests: RequestInit[]=[];
  global.fetch=async(_,init)=>{requests.push(init!);if(requests.length===1)throw new Error("network");return new Response(null,{status:409,headers:{"x-line-accepted-request-id":"accepted"}});};
  try {
    await pushMessages(staffId,[{type:"text",text:"test"}],ticketId);
    assert.equal(requests.length,2);
    assert.deepEqual(requests[0].headers,requests[1].headers);
    assert.equal(requests[0].body,requests[1].body);
  } finally {global.fetch=original;}
});
test("notification quota/auth errors are not blindly retried", async () => {
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;return new Response(null,{status:429});};
  try {await assert.rejects(pushMessages(staffId,[{type:"text",text:"test"}],ticketId));assert.equal(calls,1);}
  finally {global.fetch=original;}
});

import { replyLanguage } from "../lib/reply-language";
import { ENGLISH_HANDOFF_REPLY, ENGLISH_FAILURE_REPLY } from "../lib/bot-handler";
test("reply language supports English, Thai, and mixed menu questions", () => {
  assert.equal(replyLanguage("How much is a latte?"), "en");
  assert.equal(replyLanguage("Latte ราคาเท่าไร"), "th");
  assert.equal(replyLanguage("ตอบเป็นภาษาอังกฤษ"), "en");
  assert.equal(replyLanguage("Reply in Thai"), "th");
  assert.equal(replyLanguage("123"), "th");
  assert.match(ENGLISH_HANDOFF_REPLY, /paused/);
  assert.match(ENGLISH_FAILURE_REPLY, /061-794-7955/);
});

test("Thai failure remains Thai", async () => { const f = fixture(); f.deps.answer = async () => { throw new Error("offline"); }; await handleBotEvent(event("ราคา"), f.deps); assert.deepEqual(f.replies, [FAILURE_REPLY]); });

import { isMenuRequest, menuMessages } from "../lib/menu-cards";
test("menu entry sends five cards once without invoking AI", async () => {
  const f = fixture(); const sent: string[] = [];
  f.deps.replyMenu = async (_, lang) => { sent.push(lang); };
  await Promise.all([handleBotEvent(event(" Menu "), f.deps), handleBotEvent(event(" Menu "), f.deps)]);
  assert.deepEqual(sent, ["en"]); assert.equal(f.calls(), 0); assert.deepEqual(f.replies, []);
});
test("Thai menu entry chooses Thai follow-up actions", async () => {
  const f = fixture(); let language = "";
  f.deps.replyMenu = async (_, lang) => { language = lang; };
  await handleBotEvent(event("เมนู"), f.deps); assert.equal(language, "th");
  const messages = menuMessages("th"); const card = messages[1];
  assert.equal(messages.length, 2); assert.equal(card.type, "flex");
  if (card.type !== "flex" || card.contents.type !== "carousel") throw new Error("Expected carousel");
  assert.equal(card.contents.contents.length, 5);
  assert.match(JSON.stringify(card), /กาแฟ/);
  for (const bubble of card.contents.contents) {
    assert.equal(bubble.hero?.type, "image");
    assert.match(JSON.stringify(bubble.hero), /https:\/\/line-bot-ai-nine\.vercel\.app\/menu\/2026-09-18\//);
  }
});
test("paused conversation and changed version suppress menu cards", async () => {
  for (const paused of [true, false]) {
    const f = fixture(); let sends = 0;
    f.deps.replyMenu = async () => { sends++; };
    if (paused) f.set({ mode: "human", version: "paused" });
    else f.deps.canReply = async () => false;
    await handleBotEvent(event("Menu"), f.deps); assert.equal(sends, 0); assert.equal(f.calls(), 0);
  }
});
test("specific menu questions and category buttons still use AI", async () => {
  for (const text of ["Coffee", "Tea", "ลาเต้ราคาเท่าไร", "Menu prices for latte"]) {
    const f = fixture(); f.deps.replyMenu = async () => { throw new Error("unexpected cards"); };
    await handleBotEvent(event(text), f.deps); assert.equal(f.calls(), 1);
    assert.equal(isMenuRequest(text), false);
  }
});
test("ambiguous menu send failure is not resent or replaced by AI", async () => {
  const f = fixture(); let sends = 0;
  f.deps.replyMenu = async () => { sends++; throw new Error("timeout"); };
  await assert.rejects(handleBotEvent(event("Menu"), f.deps));
  await handleBotEvent(event("Menu"), f.deps);
  assert.equal(sends, 1); assert.equal(f.calls(), 0); assert.deepEqual(f.replies, []);
});
