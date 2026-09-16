import { randomUUID } from "node:crypto";
import { command, key, getConversation } from "./bot-state";

export function staffIds(): string[] {
  return [...new Set((process.env.BOT_STAFF_IDS || "").split(",").map(x => x.trim()).filter(x => /^U[0-9a-f]{32}$/.test(x)))];
}
export function isStaff(id: string) { return staffIds().includes(id); }
export type StaffAction = "claim" | "release";
export type ActionResult = "claimed" | "already_owned" | "taken" | "released" | "not_owner" | "stale" | "expired" | "forbidden";
export function parseStaffAction(data: unknown): { action: StaffAction; caseId: string } | null {
  if (typeof data !== "string") return null;
  const match = /^staff:(claim|release):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(data);
  return match ? { action: match[1] as StaffAction, caseId: match[2] } : null;
}
export async function createCase(userId: string) {
  const state = await getConversation(userId);
  if (state.mode !== "human") return null;
  const caseId = randomUUID();
  await command("SET", key("staff-case", caseId), JSON.stringify({ userId, version: state.version }), "EX", 604800);
  return { caseId, owner: state.owner };
}
// Both claiming and releasing are atomic against the conversation version.
// Admin web actions change that version, invalidating all previous buttons.
export const ACTION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'expired' end
local ticket = cjson.decode(raw)
if ticket.version ~= ARGV[1] then return 'stale' end
local currentRaw = redis.call('GET', KEYS[2])
if not currentRaw then return 'stale' end
local current = cjson.decode(currentRaw)
if current.mode ~= 'human' or current.version ~= ticket.version then return 'stale' end
local result
if ARGV[3] == 'claim' then
  if current.owner and current.owner ~= ARGV[2] then return 'taken' end
  if current.owner == ARGV[2] then return 'already_owned' end
  current.owner = ARGV[2]
  result = 'claimed'
else
  if current.owner ~= ARGV[2] then return 'not_owner' end
  current = {mode='bot', version=ARGV[4]}
  result = 'released'
end
redis.call('SET', KEYS[2], cjson.encode(current))
redis.call('LPUSH', KEYS[3], ARGV[5])
redis.call('LTRIM', KEYS[3], 0, 999)
redis.call('EXPIRE', KEYS[3], 2592000)
return result`;
export async function actOnCase(staffId: string, action: StaffAction, caseId: string): Promise<ActionResult> {
  if (!isStaff(staffId)) return "forbidden";
  const raw = await command<string | null>("GET", key("staff-case", caseId));
  if (!raw) return "expired";
  const ticket = JSON.parse(raw) as {userId: string; version: string};
  return command<ActionResult>("EVAL", ACTION_SCRIPT, 3,
    key("staff-case", caseId), key("conversation", ticket.userId), key("staff-audit", "events"),
    ticket.version, staffId, action, randomUUID(),
    JSON.stringify({ at: new Date().toISOString(), staffId, action, userId: ticket.userId, caseId }));
}
