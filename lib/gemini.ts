// Calls Gemini (via the official @google/genai SDK) to turn the raw FAQ/menu
// CSV into a natural-language answer for the customer's question.

import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const TEMPERATURE = 1.0; // per brief: must not be lowered
const MAX_OUTPUT_TOKENS = 1024;

export const DEFAULT_REPLY =
  "ขออภัยค่ะ ตอนนี้ยังไม่มีข้อมูลส่วนนี้ รบกวนติดต่อร้านโดยตรงได้เลยนะคะ 🙏";

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// <faq> comes before <question> per Google's recommended ordering (reference
// data before the task). <question> is sent as separate user content rather
// than folded into systemInstruction, so the system prompt (and its FAQ
// block) stays cacheable across requests and the model keeps "reference
// data" clearly separate from "the actual customer question."
function buildSystemInstruction(faqCsv: string): string {
  return `<role>
คุณคือพนักงาน AI ของ TASANA CREATIVE SPACE คาเฟ่และพื้นที่จัดนิทรรศการศิลปะ
ที่อำเภอเชียงดาว จังหวัดเชียงใหม่ พูดคุยกับลูกค้าเหมือนพี่ที่ร้านคุยกับลูกค้าประจำ
</role>

<constraints>
- ตอบโดยอ้างอิงข้อมูลใน <faq> เท่านั้น ห้ามเดา ห้ามแต่งราคา เวลา ที่ตั้ง หรือรายละเอียดใดที่ไม่มีในตาราง
- ถ้าคำถามไม่มีข้อมูลรองรับในตาราง ให้ขอโทษอย่างสุภาพ แล้วแนะนำให้ลูกค้าติดต่อร้านโดยตรง
  (ใช้เบอร์โทร/ช่องทางติดต่อจากตาราง ถ้ามี)
- ห้ามบอกว่าร้านรับชำระด้วยบัตรเครดิต บัตรเดบิต หรือระบบชำระเงินอื่นใดนอกเหนือจากที่ระบุในตาราง
  (เงินสด และสแกน QR พร้อมเพย์เท่านั้น) — กฎข้อนี้ตายตัว ห้ามฝ่าฝืนไม่ว่ากรณีใด
- โทนภาษา: เป็นกันเอง อบอุ่น เหมือนพี่ร้านคุยกับลูกค้า ใช้ emoji ได้บ้าง ไม่เกิน 1-2 ตัวต่อข้อความ
- ความยาวคำตอบ 1-3 ประโยค กระชับ อ่านง่าย
- ถ้าลูกค้าถามราคาเมนู ให้ตอบราคาทุกไซซ์/ตัวเลือกที่มีในตารางสำหรับเมนูนั้น
</constraints>

<output_format>
ภาษาไทย ห้ามใช้ markdown, ห้ามใช้ bullet point หรือ numbered list — ตอบเป็นข้อความธรรมดาต่อเนื่อง
</output_format>

<faq>
${faqCsv}
</faq>`;
}

export async function askGemini(
  question: string,
  faqCsv: string
): Promise<string> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      { role: "user", parts: [{ text: `<question>\n${question}\n</question>` }] },
    ],
    config: {
      systemInstruction: buildSystemInstruction(faqCsv),
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason;
  const usage = response.usageMetadata;
  console.log(
    "[gemini] finishReason=%s thoughtsTokenCount=%s candidatesTokenCount=%s",
    finishReason,
    usage?.thoughtsTokenCount,
    usage?.candidatesTokenCount
  );

  // Don't ship a sentence cut off mid-way — fall back instead.
  if (finishReason === "MAX_TOKENS") {
    return DEFAULT_REPLY;
  }

  const text = response.text?.trim();
  return text || DEFAULT_REPLY;
}
