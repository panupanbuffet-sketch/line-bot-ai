# TASANA LINE Bot

Next.js webhook on Vercel. Reads the published Google Sheet CSV and answers with Gemini.

## Reply ownership

- LINE OA greeting: may stay on. This webhook does not answer follow events.
- LINE OA chat: on, so staff can answer customers.
- LINE OA automatic replies (including Default and keyword replies): off when this bot is enabled, during AND outside business hours.
- Vercel bot: the sole automatic responder for direct text messages.
- Rich menu: existing text actions can stay; their messages are handled by the bot using Sheet data.
- Customer types `แอดมิน`, `ติดต่อแอดมิน`, `คุยกับเจ้าหน้าที่`, `คุยกับพนักงาน`, `เจ้าหน้าที่`, `admin`, or `human`: bot acknowledges once and pauses that customer until staff explicitly resume it.

## Required configuration

Keep the existing LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, GEMINI_API_KEY,
GEMINI_MODEL and SHEET_CSV_URL environment variables. Never commit their values.

Add these in Vercel Project Settings > Environment Variables:

The Vercel Marketplace integration may instead inject `KV_REST_API_URL` and
`KV_REST_API_TOKEN`. These are supported directly; no duplicate credentials needed.

| Name | Value |
| --- | --- |
| UPSTASH_REDIS_REST_URL | REST endpoint of a persistent Upstash Redis database |
| UPSTASH_REDIS_REST_TOKEN | Read/write REST token for that database |
| BOT_ADMIN_TOKEN | Separate random secret, at least 32 characters |
| BOT_STATE_NAMESPACE | tasana-production; use a separate namespace for a test channel |
| BOT_ENABLED | false until rollout checks pass; true to answer customers |

Generate an admin secret locally with `openssl rand -hex 32`. Enter it in Vercel and
your password manager, not chat or GitHub. Creating a database, granting its access,
and any provider plan selection are deployment steps still to complete.

The Redis database stores hashed event keys for seven days, per-user bot/human
state, and a recent user-ID index (30 days). It does not store message text or
Sheet contents. Human state has no automatic expiry. Use persistent storage
without eviction of conversation state; lost state means the default bot mode.
Preview deployments must not use production LINE credentials.

## Staff workflow

1. Open `/admin` on the deployed Vercel project and enter BOT_ADMIN_TOKEN.
2. Load the latest 20 contacts. Names are fetched from LINE; compare the user ID
   when names are identical. New contacts appear after their next text message.
3. Click **รับช่วง / พักบอต** and wait for success BEFORE replying in LINE OA.
4. When finished, click **คืนงานให้บอต**. It resumes on the next customer message.

Typing a reply in LINE OA does NOT automatically pause this external bot.
The page is manually refreshed and does not send staff notifications. Monitor
the LINE OA inbox; this change does not enable notification preferences.
The secret is held in page memory only and is sent in an Authorization header.

For a known user outside the latest-20 list, an authorized tool can POST JSON
`{"userId":"U...","mode":"human"}` or `{"userId":"U...","mode":"bot"}` to
`/api/bot-admin`, with `Authorization: Bearer <BOT_ADMIN_TOKEN>`.

## Rollout (not performed by this local patch)

1. Provision Redis and configure all variables with BOT_ENABLED=false.
2. Deploy the code. Verify `/admin` rejects a wrong secret and loads with the correct one.
3. Use a separate test LINE channel and Redis namespace. Confirm normal questions,
   duplicate webhook delivery, customer takeover, staff takeover while AI is running,
   and explicit resume. Confirm Gemini can read the actual published CSV.
4. For the production switch, keep Webhook OFF while stopping every OA auto-reply
   (including Default and keyword replies). Keep chat and one OA greeting enabled.
5. Deploy with BOT_ENABLED=true, then turn Webhook ON and verify the endpoint in LINE Developers.
6. Send test questions from a real LINE account and confirm one response, current
   Sheet prices, and takeover/resume. Enable webhook redelivery only after testing.

Rollback: turn Webhook OFF first, restore the previous OA automatic replies and
manual chat settings. Do not enable both automatic responders simultaneously.

## Reliability boundaries

- Shared atomic Redis SET NX prevents repeated processing of the same event for
  seven days, across Vercel instances. It deliberately favors at-most-once sending.
- Work runs with Vercel waitUntil after acknowledgement. If a function crashes or
  a network call fails after event admission, that reply is not automatically
  recovered. A durable job queue/outbox is needed for guaranteed job recovery.
- Conversation state is checked again immediately before sending. A LINE API call
  already in flight cannot be recalled when staff click pause.
- Concurrent separate customer messages can finish out of order; this is not a
  multi-turn conversation history or an order-taking system.
- Sheet refresh failures no longer serve stale cached prices: the bot pauses the
  conversation and asks staff to help. A successful cached read can be up to 60s old.
- Unknown-topic wording from Gemini may still ask the customer to contact the shop;
  explicit handoff commands, Sheet/AI failures, or staff controls trigger the pause.
- Group chats, media messages, standby events and follow events are ignored.
- The fallback telephone number is the existing TASANA business number; update it
  in lib/bot-handler.ts if the shop changes its contact number.

## Validation

Run `npm install`, `npm test`, `npm run typecheck`, and `npm run build`.
Tests use fake LINE/AI/state dependencies and mocked Redis HTTP responses; they
do not send messages, call Gemini, or exercise a live Redis database.

References: [LINE webhook events](https://developers.line.biz/en/docs/messaging-api/receiving-messages/),
[Upstash REST commands](https://upstash.com/docs/redis/features/restapi).

## Staff handoff in LINE

Set `BOT_STAFF_IDS` in Production to comma-separated LINE user IDs approved by the owner. Staff must add this OA as a friend and have separate LINE OA chat access to answer customers. Revocation requires removing the ID and redeploying; forwarded buttons alone never grant access.

When a customer requests an admin (or the AI/data request fails), the bot pauses and pushes a buttons card to enrolled staff. No customer message contents are copied; the card contains the display name, opaque case reference, and controls. `รับเรื่อง` atomically assigns the case to the first staff member. `คืนให้บอต` only works for that assignee. Web-admin changes invalidate existing cards and remain the override for an absent/revoked assignee. Opening LINE OA opens the inbox; select the customer by name there. It does not automatically select a specific customer or send a reply.

Buttons expire after 7 days. Staff can send `งานรอ` to this OA for up to 4 currently paused cases (unassigned or owned by that staff member) among the 20 most recently active contacts. This is a bounded recovery view, not a full historical ticket queue. Other staff text remains normal customer input, allowing the owner to test using the same account. A staff member testing `แอดมิน` receives both the customer acknowledgment and a separate staff card intentionally.

Push notifications use the same LINE retry key for one bounded retry on network/5xx errors. Failed or blocked deliveries are not guaranteed: staff should check the web page or `งานรอ` if needed. No external durable notification worker is configured. Push messages count against the OA message allowance. Atomic claim/release actions are logged in Redis (latest 1,000 entries, expire 30 days after the last action). The admin API provides an authenticated `staff-check` action to verify isolated Redis transitions and validate the LINE card without messaging customers.

## Thai communication standard

All new bot/customer/staff messages use polite Thai with ค่ะ/คะ, a short outcome or topic first, blank lines between sections, and clear next actions. Single-menu prices have one variant per bullet; full menus use compact named prices grouped by category. Avoid repeated greetings, sales closings, ambiguous slash-separated prices, Markdown tables, and bold markers that LINE does not render. Staff controls consistently use รับเรื่อง, เปิด LINE OA, คืนให้บอต, and งานรอ. Do not promise staff response times, notification delivery, or completed handoff unless the corresponding action has happened. Existing delivered LINE messages/cards are immutable and retain their old wording.

### Staff LINE group

Create `TASANA | รับเรื่องลูกค้า`, invite the TASANA OA, and have the first registered `BOT_STAFF_IDS` account send `เชื่อมกลุ่มรับเรื่อง TASANA` from mobile LINE. Registration uses the signed webhook actor, checks the group name, and atomically binds only the first group. Sending the same command elsewhere cannot replace it. Removing the OA clears that group's binding.

Only allowlisted staff may use case buttons or `งานรอ` in the bound group. Missing actor identity is rejected. Normal group messages never reach the AI. New handoffs notify the group; if a group push fails, personal staff notifications are attempted. Claim/release announcements include the staff display name and case reference. Private staff actions also announce in the bound group. `งานรอ` in the group includes claimed cases, up to four from the latest twenty contacts. Card text is a snapshot; use a new pending query to refresh. Existing Redis atomic ownership and conversation-version guards remain authoritative.

## Regular opening hours reference

`lib/shop-hours.ts` supplies a verified snapshot from `Line oa New` →
`ข้อมูลร้านและ FAQ` row 14 (read 2026-09-19). The live CSV currently lacks these
facts and the FAQ tab is not publicly readable via the standard CSV export.
This snapshot is appended to the successfully fetched menu data; it does not
replace menu prices, bypass failed refreshes, or assert special holiday opening.
Update this file and redeploy when regular hours change. Editing the Sheet alone
does not automatically update this snapshot.

## Live shop FAQ

Set `SHOP_FAQ_CSV_URL` to the published CSV URL for the `ข้อมูลร้านและ FAQ`
tab (gid 483817067) in the source spreadsheet. Publish only this approved tab,
not the `ข้อมูลรอยืนยัน` tab. The bot loads both menu and FAQ with a 60-second
in-memory cache. Live FAQ replaces the static hours snapshot entirely. A failed
FAQ refresh triggers the existing handoff path instead of quoting stale hours.
Without this variable, the existing static snapshot remains in use.
Configure the URL and redeploy before claiming live FAQ synchronization is active.
