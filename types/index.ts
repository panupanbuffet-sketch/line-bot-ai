export interface LineTextMessage {
  type: "text";
  id: string;
  text: string;
}

export interface LineMessage {
  type: string;
  id: string;
  [key: string]: unknown;
}

export interface LineEventSource {
  type: string;
  userId?: string;
  [key: string]: unknown;
}

export interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  timestamp: number;
  source: LineEventSource;
  message?: LineTextMessage | LineMessage;
  [key: string]: unknown;
}

export interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}

export interface FaqRow {
  category: string;
  topic: string;
  detail?: string;
  price?: string;
  note?: string;
}
