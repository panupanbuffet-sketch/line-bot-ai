import type { messagingApi } from "@line/bot-sdk";
import type { ReplyLanguage } from "./reply-language";

const MENU_REQUESTS = new Set(["menu", "menus", "show menu", "show me the menu", "drink menu", "drinks menu", "เมนู", "ดูเมนู", "ขอเมนู", "เมนูเครื่องดื่ม"]);
export function isMenuRequest(text: string): boolean {
  return MENU_REQUESTS.has(text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "));
}
// Versioned, approved artwork: refresh these files when printed prices change.
export function menuMessages(language: ReplyLanguage): messagingApi.Message[] {
  const categories = ["Coffee", "Tea", "Milk and Cocoa", "Matcha", "Smoothies"];
  const thai = ["กาแฟ", "ชา", "นมและโกโก้", "มัทฉะ", "สมูทตี้"];
  return [
    { type: "text", text: language === "th"
      ? "เมนูเครื่องดื่ม TASANA\n\nเลื่อนซ้าย–ขวาเพื่อดูทั้ง 5 หมวด แล้วกด Ask about menu เพื่อสอบถามราคาและขนาดค่ะ"
      : "TASANA drinks menu\n\nSwipe through all 5 categories. Tap Ask about menu for prices and sizes." },
    { type: "flex", altText: "TASANA Menu | Coffee · Tea · Milk & Cocoa · Matcha · Smoothies",
      contents: { type: "carousel", contents: categories.map((category, index) => ({
        type: "bubble", size: "mega",
        hero: { type: "image", url: `https://line-bot-ai-nine.vercel.app/menu/2026-09-18/menu-card-${index + 1}-photo.png`, size: "full", aspectRatio: "111:100", aspectMode: "fit" },
        footer: { type: "box", layout: "vertical", backgroundColor: "#F8F7F0", paddingAll: "12px", contents: [
          { type: "button", style: "link", color: "#252F23", action: { type: "message", label: "Ask about menu", text: language === "th" ? thai[index] : category } },
        ] },
      })) },
    },
  ];
}
