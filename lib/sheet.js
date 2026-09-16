// Fetches the FAQ / menu reference data (published Google Sheet, CSV format)
// with a short in-memory cache so every incoming LINE message doesn't refetch.

let cache = { text: null, timestamp: 0 };
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function getFaqData() {
  const now = Date.now();
    if (cache.text && now - cache.timestamp < CACHE_TTL_MS) {
        return cache.text;
          }

            const url = process.env.SHEET_CSV_URL;
              if (!url) {
                  throw new Error("SHEET_CSV_URL is not configured.");
                    }

                      const res = await fetch(url, { cache: "no-store" });
                        if (!res.ok) {
                            throw new Error(`Failed to fetch FAQ sheet: ${res.status}`);
                              }
                                const text = await res.text();
                                  cache = { text, timestamp: now };
                                    return text;
                                    }
                                    
