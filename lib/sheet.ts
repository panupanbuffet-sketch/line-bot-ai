// Fetches the FAQ / menu reference data (published Google Sheet, CSV format)
// with a 60s in-memory cache. If a refetch fails, an existing stale cache is
// served rather than failing the request outright.

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
    if (cache.text) return cache.text;
    throw new Error("SHEET_CSV_URL is not configured.");
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch FAQ sheet: ${res.status}`);
    }
    const text = await res.text();
    cache = { text, timestamp: now };
    return text;
  } catch (err) {
    if (cache.text) {
      console.error("FAQ sheet fetch failed, serving stale cache:", err);
      return cache.text;
    }
    throw err;
  }
}
