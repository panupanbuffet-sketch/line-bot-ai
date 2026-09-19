import { SHOP_HOURS_REFERENCE } from "./shop-hours";

// Fetches the FAQ / menu reference data (published Google Sheet, CSV format)
// with a 60s in-memory cache. Failed refreshes are surfaced to the handoff
// handler instead of serving stale menu prices.

interface SheetCache {
  text: string | null;
  timestamp: number;
}

let cache: SheetCache = { text: null, timestamp: 0 };
const CACHE_TTL_MS = 60 * 1000;

export async function getFaqData(): Promise<string> {
  const now = Date.now();
  if (cache.text && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.text;
  }

  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    throw new Error("SHEET_CSV_URL is not configured.");
  }

  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      throw new Error(`Failed to fetch FAQ sheet: ${res.status}`);
    }
    const text = await res.text();
    if (!text.trim() || /^\s*</.test(text)) throw new Error("Sheet returned empty data or HTML");
    const reference = `${text}\n\n[Verified regular opening hours]\n${SHOP_HOURS_REFERENCE}`;
    cache = { text: reference, timestamp: now };
    return reference;
  } catch (err) {
    // Do not quote potentially outdated prices after a failed refresh.
    throw err;
  }
}
