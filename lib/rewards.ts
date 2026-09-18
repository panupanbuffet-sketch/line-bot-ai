import type { messagingApi } from "@line/bot-sdk";
import type { ReplyLanguage } from "./reply-language";

export const REWARDS_URL = "https://u.lin.ee/YyldygT";
const REQUESTS = new Set(["rewards", "reward", "loyalty", "loyalty card", "points", "my points", "tasana circle", "tasana rewards", "สะสมแต้ม", "บัตรสะสมแต้ม", "ดูแต้ม", "แต้ม", "สิทธิพิเศษ"]);
export function isRewardsRequest(text: string): boolean {
  return REQUESTS.has(text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "));
}
export function rewardsMessages(language: ReplyLanguage): messagingApi.Message[] {
  const th = language === "th";
  return [{ type: "flex", altText: "TASANA Rewards | 10 points = THB 80 off",
    contents: { type: "bubble", size: "mega",
      body: { type: "box", layout: "vertical", backgroundColor: "#F8F7F0", paddingAll: "24px", spacing: "lg", contents: [
        { type: "text", text: "TASANA CREATIVE SPACE", size: "xxs", color: "#78846B" },
        { type: "text", text: "TASANA Rewards", size: "xl", color: "#252F23", weight: "bold" },
        { type: "text", text: th ? "1 แก้ว • 1 แต้ม\nครบ 10 แต้ม รับส่วนลด 80 บาท" : "1 drink • 1 point\n10 points = THB 80 off", size: "md", color: "#252F23", wrap: true },
        { type: "separator", color: "#E1E4D9" },
        { type: "text", text: th
          ? "เฉพาะเครื่องดื่มราคาปกติ\nใช้รางวัลในการซื้อครั้งถัดไป\nบัตรอายุ 1 ปีจากวันใช้ครั้งแรก\nรางวัลอายุ 3 เดือนหลังได้รับ"
          : "Regular-priced drinks only.\nUse your reward on your next purchase.\nCard valid 1 year from first use.\nReward valid 3 months from receipt.", size: "sm", color: "#59634F", wrap: true },
        { type: "text", text: th
          ? "รับแต้มและใช้รางวัลกับพนักงานที่ร้าน\nไม่สะสมแต้มจากแก้วที่ใช้ส่วนลดหรือรางวัล ไม่ใช้ร่วมโปรโมชั่นอื่น ไม่แลกเงินสดหรือทอนส่วนต่าง\nดูแต้มของคุณและเงื่อนไขในบัตรด้านล่าง"
          : "Earn points and redeem with staff in store. No points on discounted/reward drinks. No combined offers, cash or change.\nOpen your card below for your points and full terms.", size: "xs", color: "#59634F", wrap: true },
      ] },
      footer: { type: "box", layout: "vertical", backgroundColor: "#F8F7F0", paddingAll: "16px", contents: [
        { type: "button", style: "primary", color: "#344631", action: { type: "uri", label: th ? "เปิดบัตรสะสมแต้ม" : "Open my rewards card", uri: REWARDS_URL } },
      ] },
    },
  }];
}
