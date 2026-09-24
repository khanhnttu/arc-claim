import { blockRanges } from "./logs";

/** JSON that round-trips bigint (localStorage cache format). */
export const bigJson = {
  stringify: (v: unknown) =>
    JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { __big: x.toString() } : x)),
  parse: <T>(s: string): T =>
    JSON.parse(s, (_k, x) => (x && typeof x === "object" && "__big" in x ? BigInt(x.__big) : x)) as T,
};

export function loadCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? bigJson.parse<T>(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function saveCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, bigJson.stringify(value));
  } catch {
    // Storage unavailable — the next visit simply rescans.
  }
}

type ScanCache<T> = { scannedTo: bigint; items: T[] };

/**
 * Incrementally scan logs from `startBlock` to `latest`, 10k-block chunks at a time, caching results
 * and progress in localStorage under `cacheKey`. Returns every item found so far (cached + new).
 * The cache only avoids re-scanning; live state is always re-read from the contract elsewhere.
 */
export async function scanLogsIncremental<T>({
  cacheKey,
  startBlock,
  latest,
  fetchRange,
  concurrency = 6,
  onProgress,
}: {
  cacheKey: string;
  startBlock: bigint;
  latest: bigint;
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>;
  concurrency?: number;
  onProgress?: (p: { done: number; total: number } | undefined) => void;
}): Promise<T[]> {
  const cache = loadCache<ScanCache<T>>(cacheKey);
  const items = [...(cache?.items ?? [])];
  const from = cache ? cache.scannedTo + 1n : startBlock;
  const ranges = blockRanges(from, latest);

  let done = 0;
  if (ranges.length > 1) onProgress?.({ done, total: ranges.length });
  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = await Promise.all(ranges.slice(i, i + concurrency).map(([f, t]) => fetchRange(f, t)));
    items.push(...batch.flat());
    done += batch.length;
    if (ranges.length > 1) onProgress?.({ done, total: ranges.length });
  }
  onProgress?.(undefined);

  saveCache(cacheKey, { scannedTo: latest < from ? (cache?.scannedTo ?? latest) : latest, items });
  return items;
}
