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

/**
 * Query `ranges` in parallel batches and stop at the first batch that returns
 * any results. Returns the results in range order.
 */
export async function findInRanges<T>(
  ranges: [bigint, bigint][],
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  concurrency = 4,
): Promise<T[]> {
  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = await Promise.all(ranges.slice(i, i + concurrency).map(([f, t]) => fetchRange(f, t)));
    const found = batch.flat();
    if (found.length > 0) return found;
  }
  return [];
}
