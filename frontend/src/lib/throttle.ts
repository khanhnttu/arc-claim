/**
 * Request throttles for the public Arc RPC, which answers bursts with HTTP 429 / -32005
 * "rate limit exceeded". Each throttle keeps a few requests in flight, spaces their starts,
 * and retries rate-limit errors with exponential backoff (bounded — never forever).
 */

const MAX_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isRateLimitError(e: unknown): boolean {
  const err = e as { code?: number; status?: number; message?: string; details?: string; cause?: unknown };
  if (!err) return false;
  if (err.code === -32005 || err.status === 429) return true;
  const text = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  if (text.includes("rate limit") || text.includes("429") || text.includes("too many requests")) return true;
  return err.cause !== undefined && err.cause !== e ? isRateLimitError(err.cause) : false;
}

export function createThrottle({ maxInFlight, spacingMs }: { maxInFlight: number; spacingMs: number }) {
  let inFlight = 0;
  let lastStart = 0;
  const waiting: (() => void)[] = [];

  async function acquire() {
    if (inFlight >= maxInFlight) await new Promise<void>((r) => waiting.push(r));
    inFlight++;
    const gap = lastStart + spacingMs - Date.now();
    lastStart = Math.max(Date.now(), lastStart + spacingMs);
    if (gap > 0) await sleep(gap);
  }

  function release() {
    inFlight--;
    waiting.shift()?.();
  }

  return async function throttled<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await acquire();
      try {
        return await fn();
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS || !isRateLimitError(e)) throw e;
      } finally {
        release();
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 250);
    }
  };
}

/** eth_getLogs: the RPC allows ~3 per second. */
export const throttledLogs = createThrottle({ maxInFlight: 2, spacingMs: 300 });

/** Historical eth_call (binary searches): cheaper, but still limited in bursts. */
export const throttledCalls = createThrottle({ maxInFlight: 4, spacingMs: 60 });
