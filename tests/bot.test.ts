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
    const reference = await getFaqData();
    assert.match(reference, /Latte,80/);
    assert.match(reference, /จันทร์–ศุกร์: 08:30–17:00/);
    assert.match(reference, /เสาร์: 08:30–17:30/);
    assert.match(reference, /อาทิตย์: 08:30–17:00/);
    assert.match(reference, /วันหยุดพิเศษ/);
    assert.equal(await getFaqData(), reference);
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
import { rewardsMessages, REWARDS_URL } from "../lib/rewards";
test("rewards uses the live card link and bypasses AI once in either language", async () => {
  for (const [text, language] of [[" Rewards ", "en"], ["สะสมแต้ม", "th"]]) {
    const f = fixture(); const sent: string[] = [];
    f.deps.replyRewards = async (_, lang) => { sent.push(lang); };
    await Promise.all([handleBotEvent(event(text), f.deps), handleBotEvent(event(text), f.deps)]);
    assert.deepEqual(sent, [language]); assert.equal(f.calls(), 0);
    const payload = JSON.stringify(rewardsMessages(language as "th" | "en"));
    assert.ok(payload.includes(REWARDS_URL)); assert.ok(payload.includes("80"));
  }
});
test("rewards respects staff takeover and conversation version", async () => {
  for (const paused of [true, false]) {
    const f = fixture(); let sends = 0;
    f.deps.replyRewards = async () => { sends++; };
    if (paused) f.set({mode:"human", version:"paused"});
    else f.deps.canReply = async () => false;
    await handleBotEvent(event("Rewards"), f.deps);
    assert.equal(sends, 0); assert.equal(f.calls(), 0);
  }
});
test("failed rewards send is not replaced with AI or repeated on redelivery", async () => {
  const f = fixture(); let sends = 0;
  f.deps.replyRewards = async () => { sends++; throw new Error("timeout"); };
  await assert.rejects(handleBotEvent(event("Rewards"), f.deps));
  await handleBotEvent(event("Rewards"), f.deps);
  assert.equal(sends, 1); assert.equal(f.calls(), 0);
});
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

import { handleGroupEvent, isGroupEvent, REGISTER_GROUP, GROUP_NAME, type GroupEvent, type GroupDependencies } from "../lib/staff-group";
const groupId = "C" + "a".repeat(32);
function groupFixture() {
  const claimed = new Set<string>(); const replies: string[] = []; let actions = 0, pending = 0, registered: string | null = groupId;
  const deps: GroupDependencies = {
    owner: id => id === staffId, group: async () => registered,
    register: async id => { if (registered && registered !== id) return false; registered = id; return true; },
    forget: async id => { if (registered === id) registered = null; }, groupName: async () => GROUP_NAME,
    staff: {isStaff:id=>id===staffId, claimEvent:async id=>{if(claimed.has(id))return false;claimed.add(id);return true;},actOnCase:async()=>{actions++;return "claimed";},reply:async(_,text)=>{replies.push(text);},pending:async()=>{pending++;}}
  };
  const e: GroupEvent = {type:"postback",webhookEventId:"group-event",replyToken:"reply",source:{type:"group",groupId,userId:staffId},postback:{data:`staff:claim:${ticketId}`}};
  return {deps,e,replies,actions:()=>actions,pending:()=>pending,registered:()=>registered};
}
test("registered group accepts authorized button once without customer routing",async()=>{
  const f=groupFixture();assert.equal(isGroupEvent(f.e),true);assert.equal(isTextMessageEvent(f.e),false);
  await Promise.all([handleGroupEvent(f.e,f.deps),handleGroupEvent(f.e,f.deps)]);assert.equal(f.actions(),1);assert.equal(f.replies.length,1);
});
test("group buttons reject other groups, nonstaff, missing identity, and standby",async()=>{
  for(const source of [{type:"group" as const,groupId:"C"+"b".repeat(32),userId:staffId},{type:"group" as const,groupId,userId:"U"+"b".repeat(32)},{type:"group" as const,groupId}]){
    const f=groupFixture();await handleGroupEvent({...f.e,source},f.deps);assert.equal(f.actions(),0);assert.equal(f.replies.length,0);
  }
  const f=groupFixture();assert.equal(isGroupEvent({...f.e,mode:"standby"}),false);
});
test("group registration requires owner and exact group name",async()=>{
  const f=groupFixture();const e={...f.e,type:"message",message:{type:"text",text:REGISTER_GROUP}};
  f.deps.owner=()=>false;await handleGroupEvent(e,f.deps);assert.equal(f.replies.length,0);
  f.deps.owner=()=>true;f.deps.groupName=async()=>"Other";await handleGroupEvent(e,f.deps);assert.match(f.replies[0],/กรุณาตั้งชื่อกลุ่ม/);
});
test("normal group chatter remains silent, pending command works, leave disconnects",async()=>{
  const f=groupFixture();await handleGroupEvent({...f.e,type:"message",postback:undefined,message:{type:"text",text:"Menu"}},f.deps);assert.equal(f.replies.length,0);assert.equal(f.actions(),0);
  await handleGroupEvent({...f.e,type:"message",postback:undefined,message:{type:"text",text:"งานรอ"}},f.deps);assert.equal(f.pending(),1);
  await handleGroupEvent({...f.e,type:"leave"},f.deps);assert.equal(f.registered(),null);
});
test("private staff action announces even if reply fails",async()=>{
  let notified=0;
  const e: StaffEvent={type:"postback",webhookEventId:"private",replyToken:"reply",source:{type:"user",userId:staffId},postback:{data:`staff:claim:${ticketId}`}};
  await assert.rejects(handleStaffEvent(e,{isStaff:()=>true,claimEvent:async()=>true,actOnCase:async()=>"claimed",reply:async()=>{throw new Error("timeout");},pending:async()=>{},announce:async()=>{notified++;}}));assert.equal(notified,1);
});


test("live shop FAQ replaces snapshot and refresh failure does not serve old hours", async () => {
  const original = global.fetch; const now = Date.now;
  let clock = now() + 120000;
  Date.now = () => clock;
  process.env.SHEET_CSV_URL = "https://test.invalid/menu.csv";
  process.env.SHOP_FAQ_CSV_URL = "https://test.invalid/faq.csv";
  let hours = "09:00–16:00";
  let fail = false;
  global.fetch = async (url) => String(url).endsWith("faq.csv")
    ? new Response(fail ? "<html>Sign in</html>" : `question,answer\nHours,${hours}`)
    : new Response("menu,price\nLatte,80");
  try {
    const first = await getFaqData();
    assert.match(first, /09:00–16:00/);
    assert.match(first, /Latte,80/);
    assert.doesNotMatch(first, /08:30/);
    hours = "10:00–15:00"; clock += 61000;
    assert.match(await getFaqData(), /10:00–15:00/);
    fail = true; clock += 61000;
    await assert.rejects(getFaqData(), /HTML/);
  } finally {
    global.fetch = original; Date.now = now;
    delete process.env.SHEET_CSV_URL; delete process.env.SHOP_FAQ_CSV_URL;
  }
});
