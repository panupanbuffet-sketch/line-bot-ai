import { randomUUID } from "node:crypto";
import { command, key } from "./bot-state";
import { ACTION_SCRIPT } from "./staff-state";
// Runs real Redis atomic operations on isolated, short-lived probe keys only.
export async function checkStaffTransitions() {
  const id = randomUUID();
  const keys = [key("probe-case", id), key("probe-conversation", id), key("probe-audit", id)];
  const version = randomUUID();
  const act = (actor: string, action: string) => command<string>("EVAL", ACTION_SCRIPT, 3, ...keys, version, actor, action, randomUUID(), JSON.stringify({probe:true}));
  try {
    await command("SET", keys[0], JSON.stringify({userId:"probe",version}), "EX", 60);
    await command("SET", keys[1], JSON.stringify({mode:"human",version}), "EX", 60);
    const claims = await Promise.all([act("staff-a","claim"),act("staff-b","claim")]);
    if(claims.filter(x=>x==="claimed").length!==1 || !claims.includes("taken"))throw new Error("Double claim");
    const owner = claims[0]==="claimed"?"staff-a":"staff-b";
    if(await act(owner,"claim")!=="already_owned")throw new Error("Repeated claim");
    if(await act(owner==="staff-a"?"staff-b":"staff-a","release")!=="not_owner")throw new Error("Ownership bypass");
    if(await act(owner,"release")!=="released")throw new Error("Release failed");
    if(await act(owner,"claim")!=="stale")throw new Error("Stale button");
    await command("DEL",keys[0]);
    if(await act(owner,"claim")!=="expired")throw new Error("Expired button");
    return { concurrentClaim:"ok", ownership:"ok", release:"ok", staleButtons:"ok", expiredButtons:"ok" };
  } finally { await command("DEL",...keys); }
}
