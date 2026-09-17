export type ReplyLanguage = "th" | "en";
// Thai script takes precedence in mixed Thai/menu-name messages.
export function replyLanguage(text: string): ReplyLanguage {
  if (/\b(?:reply|respond|answer|speak)\s+(?:to me\s+)?in\s+english\b/i.test(text) || /ตอบ(?:เป็น)?ภาษาอังกฤษ/.test(text)) return "en";
  if (/\b(?:reply|respond|answer|speak)\s+(?:to me\s+)?in\s+thai\b/i.test(text)) return "th";
  return /[\u0E00-\u0E7F]/.test(text) || !/[a-z]/i.test(text) ? "th" : "en";
}
export const ENGLISH_DEFAULT_REPLY = "Sorry, I don't have confirmed information about that yet.\n\nType \"admin\" to ask our team for help.";
