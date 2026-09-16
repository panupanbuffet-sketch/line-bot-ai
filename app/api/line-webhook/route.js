import crypto from "crypto";
import { getFaqData } from "../../../lib/sheet";
import { askGemini } from "../../../lib/gemini";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

function verifySignature(rawBody, signature) {
    if (!LINE_CHANNEL_SECRET || !signature) return false;
    const hash = crypto
      .createHmac("sha256", LINE_CHANNEL_SECRET)
      .update(rawBody)
      .digest("base64");
    return hash === signature;
  }

async function replyMessage(replyToken, text) {
    await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
                  Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                  "Content-Type": "application/json",
                },
          body: JSON.stringify({
                  replyToken,
                  messages: [{ type: "text", text: text.slice(0, 4900) }],
                }),
        });
  }

export async function POST(req) {
    const rawBody = await req.text();
    const signature = req.headers.get("x-line-signature");

    if (!verifySignature(rawBody, signature)) {
          return new Response("Invalid signature", { status: 401 });
        }

    let body;
    try {
          body = JSON.parse(rawBody);
        } catch {
          return new Response("Bad request", { status: 400 });
        }

    const events = body.events || [];

    await Promise.all(
          events.map(async (event) => {
                  if (event.type !== "message" || event.message?.type !== "text") return;
                  const question = event.message.text;
                  try {
                            const faqCsv = await getFaqData();
                            const answer = await askGemini(question, faqCsv);
                            await replyMessage(event.replyToken, answer);
                          } catch (err) {
                            console.error("Webhook handling error:", err);
                            await replyMessage(
                                        event.replyToken,
                                        "ขออภัยค่ะ ตอนนี้ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ"
                                      );
                          }
                })
        );

    return new Response("OK", { status: 200 });
  }

export async function GET() {
    return new Response("TASANA LINE Bot webhook is running.", { status: 200 });
  }
