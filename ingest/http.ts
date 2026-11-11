// fetch with a timeout and retries (APIs sometimes hiccup; one bad response
// should not fail the whole job).
export async function fetchRetry(
  url: string,
  init: RequestInit = {},
  { retries = 3, timeoutMs = 30_000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      // 4xx (except rate limit) won't fix itself: stop retrying.
      if (res.status !== 429 && res.status < 500) {
        const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        throw new HttpError(res.status, `${res.status} ${res.statusText} from ${redact(url)}${detail ? ` — ${detail}` : ''}`);
      }
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      lastErr = new HttpError(res.status, `${res.status} ${res.statusText} from ${redact(url)}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      lastErr = err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Keeps API keys out of logs (GitHub logs on a public repo are public).
export function redact(url: string): string {
  return url
    .replace(/(token=)[^&]+/gi, '$1***')
    .replace(/(\/api\/area\/csv\/)[^/]+/i, '$1***');
}
