import type { Abi, Address, PublicClient } from "viem";
import { throttledCalls, throttledLogs } from "./throttle";

/**
 * Finding *when* something happened without scanning logs.
 *
 * The Arc RPC caps eth_getLogs at 10,000 blocks and rate-limits it hard, but historical eth_call is cheap.
 * ArcClaim state only moves forward (counters grow, a status leaves FUNDED once), so "has it happened by
 * block B?" is monotonic in B and a binary search over historical reads finds the exact block in
 * ~log2(range) calls (~18 for 200k blocks). The caller then reads logs for that single block only.
 */

/** Smallest block in [lo, hi] for which `happened` is true, or undefined if it is still false at `hi`. */
export async function firstBlockWhere(
  lo: bigint,
  hi: bigint,
  happened: (block: bigint) => Promise<boolean>,
): Promise<bigint | undefined> {
  if (lo > hi || !(await happened(hi))) return undefined;
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if (await happened(mid)) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

// Identical reads (same contract, call and block) are shared. Records resolved together start their
// searches over the same range, so their first steps hit the same blocks and cost one call.
const reads = new Map<string, Promise<unknown>>();
const MAX_MEMO = 2_000;

/** eth_call at a past block, memoised per chain + contract + call + block. */
export function readAtBlock<T>(
  client: PublicClient,
  chainId: number,
  call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] },
  blockNumber: bigint,
): Promise<T> {
  const key = `${chainId}:${call.address.toLowerCase()}:${call.functionName}:${String(call.args ?? "")}:${blockNumber}`;
  let p = reads.get(key);
  if (!p) {
    if (reads.size >= MAX_MEMO) reads.clear();
    p = throttledCalls(() => client.readContract({ ...call, blockNumber } as Parameters<PublicClient["readContract"]>[0]));
    reads.set(key, p);
    p.catch(() => reads.delete(key)); // never memoise a failure
  }
  return p as Promise<T>;
}

// The chain head, shared briefly so a page of records resolving at once asks for it once.
const heads = new Map<number, { at: number; block: Promise<bigint> }>();
export function latestBlock(client: PublicClient, chainId: number): Promise<bigint> {
  const h = heads.get(chainId);
  if (h && Date.now() - h.at < 5_000) return h.block;
  const block = throttledCalls(() => client.getBlockNumber());
  heads.set(chainId, { at: Date.now(), block });
  block.catch(() => heads.delete(chainId));
  return block;
}

/** eth_getLogs for exactly one block, through the shared getLogs throttle. */
export const logsInBlock = <T>(fn: () => Promise<T>) => throttledLogs(fn);
