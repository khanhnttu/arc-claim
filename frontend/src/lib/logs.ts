import { LOG_BLOCK_RANGE } from "@/config/arc";

/** Split [from, to] into chunks the Arc RPC accepts for eth_getLogs. */
export function blockRanges(from: bigint, to: bigint, direction: "forward" | "backward" = "forward") {
  const ranges: [bigint, bigint][] = [];
  if (direction === "forward") {
    for (let start = from; start <= to; start += LOG_BLOCK_RANGE) {
      const end = start + LOG_BLOCK_RANGE - 1n;
      ranges.push([start, end > to ? to : end]);
    }
  } else {
    for (let end = to; end >= from; end -= LOG_BLOCK_RANGE) {
      const start = end - LOG_BLOCK_RANGE + 1n;
      ranges.push([start < from ? from : start, end]);
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// eth_getLogs throttle. The public Arc RPC answers bursts of more than ~3 getLogs
// requests per second with HTTP 429 "rate limit exceeded", so every log query in
// the app goes through one shared queue: a few in flight, spaced out, and retried
// with backoff when the RPC still says "slow down".
// ---------------------------------------------------------------------------

const MAX_IN_FLIGHT = 2;
const MIN_SPACING_MS = 300;
const MAX_ATTEMPTS = 6;

let inFlight = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  const gap = lastStart + MIN_SPACING_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_SPACING_MS);
  if (gap > 0) await sleep(gap);
}

function release() {
  inFlight--;
  waiting.shift()?.();
}

export function isRateLimitError(e: unknown): boolean {
  const err = e as { code?: number; status?: number; message?: string; details?: string; cause?: unknown };
  if (!err) return false;
  if (err.code === -32005 || err.status === 429) return true;
  const text = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  if (text.includes("rate limit") || text.includes("429") || text.includes("too many requests")) return true;
  return err.cause !== undefined && err.cause !== e ? isRateLimitError(err.cause) : false;
}

/** Run one log query through the shared throttle, retrying rate-limit errors with backoff. */
export async function throttledLogs<T>(fn: () => Promise<T>): Promise<T> {
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
}

/**
 * Query `ranges` in parallel batches and stop at the first batch that returns
 * any results. Returns the results in range order.
 */
export async function findInRanges<T>(
  ranges: [bigint, bigint][],
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  concurrency = 3,
): Promise<T[]> {
  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = await Promise.all(
      ranges.slice(i, i + concurrency).map(([f, t]) => throttledLogs(() => fetchRange(f, t))),
    );
    const found = batch.flat();
    if (found.length > 0) return found;
  }
  return [];
}
