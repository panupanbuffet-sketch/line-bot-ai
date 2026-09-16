// Calls the Gemini API to turn the raw FAQ/menu CSV into a natural-language
// answer for the customer's question. No SDK dependency — plain REST call,
// so the model name can be swapped via GEMINI_MODEL without a redeploy of code.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const FALLBACK_REPLY =
    "ขออภัยค่ะ ตอนนี้ระบบไม่สามารถตอบคำถามได้ กรุณาลองใหม่อีกครั้ง หรือติดต่อร้านโดยตรงค่ะ";

function buildSystemPrompt(faqCsv) {
    return `คุณคือแอดมิน AI ของ TASANA CREATIVE SPACE คาเฟ่และพื้นที่จัดนิทรรศการศิลปะ ตั้งอยู่ที่อำเภอเชียงดาว จังหวัดเชียงใหม่
    หน้าที่ของคุณคือตอบคำถามที่ลูกค้าทักเข้ามาทาง LINE Official Account โดยอ้างอิงจาก "ข้อมูลอ้างอิง" ด้านล่างเท่านั้น

    กฎการตอบ:
    - ตอบเป็นภาษาไทย น้ำเสียงสุภาพ เป็นกันเอง กระชับ ไม่เกิน 3-4 ประโยค
    - ใช้ข้อมูลจากตารางอ้างอิงเท่านั้น ห้ามเดาหรือแต่งข้อมูลที่ไม่มีอยู่ในตาราง
    - ถ้าคำถามไม่มีข้อมูลรองรับในตาราง ให้ตอบอย่างสุภาพว่ายังไม่มีข้อมูลส่วนนี้ และแนะนำให้ติดต่อร้านโดยตรงตามเบอร์โทรในตาราง (ถ้ามี)
    - ห้ามบอกว่าร้านรับชำระด้วยบัตรเครดิต/เดบิต หรือระบบชำระเงินอื่นใดนอกจากที่ระบุในตาราง (เงินสด และสแกน QR พร้อมเพย์เท่านั้น)
    - ถ้าลูกค้าถามราคาเมนู ให้ตอบราคาทุกไซซ์/ตัวเลือกที่มีในตารางสำหรับเมนูนั้น

    ข้อมูลอ้างอิง (CSV):
    ${faqCsv}`;
}

export async function askGemini(question, faqCsv) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
          throw new Error("GEMINI_API_KEY is not configured.");
    }

  const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                      systemInstruction: { parts: [{ text: buildSystemPrompt(faqCsv) }] },
                      contents: [{ role: "user", parts: [{ text: question }] }],
                      generationConfig: { maxOutputTokens: 1024 },
            }),
    }
      );

  const data = await res.json();
    if (!res.ok) {
          throw new Error(`Gemini API error: ${res.status} ${JSON.stringify(data)}`);
    }

  const text =
        data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    return text.trim() || FALLBACK_REPLY;
}
