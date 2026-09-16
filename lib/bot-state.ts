import { createHash, randomUUID } from "node:crypto";

export function stateConfigured() {
  return Boolean((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
}
async function command<T>(...args: (string | number)[]): Promise<T> {
  if (!stateConfigured()) throw new Error("Bot state storage is not configured");
  const response = await fetch((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)!, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(3000),
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`Bot storage HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || !("result" in body)) throw new Error("Bot storage command failed");
  return body.result as T;
}
function key(kind: string, id: string) {
  return `${process.env.BOT_STATE_NAMESPACE || "tasana-production"}:${kind}:${createHash("sha256").update(id).digest("hex")}`;
}
export type ConversationState = { mode: "bot" | "human"; version: string };
export async function getConversation(userId: string): Promise<ConversationState> {
  const value = await command<string | null>("GET", key("conversation", userId));
  if (value === null) return { mode: "bot", version: "initial" };
  const state = JSON.parse(value);
  if (!["bot", "human"].includes(state.mode) || typeof state.version !== "string") throw new Error("Invalid conversation state");
  return state;
}
export async function setConversation(userId: string, mode: "bot" | "human") {
  const state = { mode, version: randomUUID() };
  // Manual takeover never silently expires.
  await command("SET", key("conversation", userId), JSON.stringify(state));
  return state;
}
export async function claimEvent(eventId: string) {
  // Shared atomic admission, retained seven days. No blind resend after failures.
  return (await command("SET", key("event", eventId), "claimed", "NX", "EX", 604800)) === "OK";
}
export async function canReply(userId: string, version: string) {
  const current = await getConversation(userId);
  return current.mode === "bot" && current.version === version;
}
export async function pauseConversation(userId: string, version: string) {
  // Only one concurrent request may change this version to human mode.
  const script = `local raw = redis.call('GET', KEYS[1])
    local current = raw and cjson.decode(raw) or {mode='bot',version='initial'}
    if current.mode ~= 'bot' or current.version ~= ARGV[1] then return 0 end
    redis.call('SET', KEYS[1], ARGV[2]); return 1`;
  return await command<number>("EVAL", script, 1, key("conversation", userId), version,
    JSON.stringify({ mode: "human", version: randomUUID() })) === 1;
}
export async function rememberUser(userId: string) {
  const list = key("recent", "users");
  await command("ZADD", list, Date.now(), userId);
  await command("ZREMRANGEBYSCORE", list, "-inf", Date.now() - 30 * 86400000);
}
export async function recentUsers() {
  return command<string[]>("ZREVRANGE", key("recent", "users"), 0, 19);
}
export async function checkStorage() {
  const probe = key("check", randomUUID());
  await command("SET", probe, "ok", "EX", 60);
  const value = await command("GET", probe);
  await command("DEL", probe);
  if (value !== "ok") throw new Error("Storage read/write check failed");
}
