"use client";

import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type AbiEvent, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { useNetwork } from "@/components/NetworkProvider";
import { AllocationStatus, arcClaimBatchAbi } from "@/contracts/ArcClaimBatch";
import { firstBlockWhere, latestBlock, logsInBlock, readAtBlock } from "@/lib/historical";
import { loadCache, saveCache } from "@/lib/logScan";
import { throttledCalls } from "@/lib/throttle";
import { activityTargets, createdCount, recordId, recordKey, type Kind, type Target } from "./useWalletActivity";

/** Creation metadata of one record. `blockNumber` may be known (timeline) before the tx hash is resolved. */
export type CreationMeta = { blockNumber: bigint; txHash?: Hash; timestamp?: bigint };
export type CreationKind = Kind;

const CREATION_EVENT = {
  v1: { name: "ClaimCreated", idArg: "claimId" },
  v2: { name: "PaymentCreated", idArg: "paymentId" },
  batch: { name: "BatchCreated", idArg: "batchId" },
} as const;

/** Persistent cache key; network + contract + record id, so Testnet/Mainnet or redeploys never mix. */
export const activityMetaKey = (network: ArcNetwork, contract: Address, id: bigint | string) =>
  `arcclaim:activity-meta:${network.key}:${contract.toLowerCase()}:${id.toString()}`;

const metaKeyFor = (network: ArcNetwork, t: Target, nonce: bigint) =>
  activityMetaKey(network, t.address, recordId(t, network.chainId, nonce));

function saveMeta(key: string, patch: CreationMeta) {
  saveCache(key, { ...loadCache<CreationMeta>(key), ...patch });
}

// ---------------------------------------------------------------------------
// Timeline: creation blocks for many records at once (historical eth_call only, no logs)
// ---------------------------------------------------------------------------

type Pending = { rk: string; t: Target; nonce: bigint };

/**
 * Creation block of every record by one partition search: probe a block, read *all* counters there in a
 * single multicall, split the records into "created by then" / "not yet", recurse on both halves.
 * Records resolved together share the upper levels of the search.
 */
async function resolveBlocks(client: PublicClient, network: ArcNetwork, pending: Pending[]) {
  const targets = activityTargets(network);
  const head = await latestBlock(client, network.chainId);
  const out = new Map<string, bigint>();

  const countsAt = (block: bigint) =>
    throttledCalls(() =>
      client.multicall({
        blockNumber: block,
        allowFailure: true, // a contract not deployed yet at `block` returns no data → count 0
        contracts: targets.map((t) => ({ address: t.address, abi: t.abi, functionName: t.counter })) as never,
      }),
    ).then((rs) =>
      new Map(
        targets.map((t, i) => {
          const r = rs[i] as { status: string; result?: bigint };
          return [t.kind, r.status === "success" ? createdCount(t.kind, r.result!) : 0n] as const;
        }),
      ),
    );

  async function solve(lo: bigint, hi: bigint, items: Pending[]): Promise<void> {
    if (items.length === 0) return;
    if (lo >= hi) {
      for (const it of items) out.set(it.rk, lo);
      return;
    }
    const mid = lo + (hi - lo) / 2n;
    const counts = await countsAt(mid);
    const left = items.filter((it) => (counts.get(it.t.kind) ?? 0n) >= it.nonce);
    const right = items.filter((it) => (counts.get(it.t.kind) ?? 0n) < it.nonce);
    await Promise.all([solve(lo, mid, left), solve(mid + 1n, hi, right)]);
  }

  const lo = pending.reduce((m, p) => (p.t.deployBlock < m ? p.t.deployBlock : m), pending[0].t.deployBlock);
  await solve(lo, head, pending);
  return out;
}

/**
 * Creation blocks for the given records, used to order the Activity feed across contracts.
 * Cached per record in `arcclaim:activity-meta:<network>:<contract>:<id>`; only unknown ones are searched.
 */
export function useActivityTimeline(records: { kind: Kind; nonce: bigint }[]) {
  const config = useConfig();
  const network = useNetwork();
  const targets = activityTargets(network);
  const unique = [...new Map(records.map((r) => [recordKey(r.kind, r.nonce), r])).values()];

  const known = new Map<string, bigint>();
  const pending: Pending[] = [];
  for (const r of unique) {
    const t = targets.find((x) => x.kind === r.kind);
    if (!t) continue;
    const cached = loadCache<CreationMeta>(metaKeyFor(network, t, r.nonce));
    if (cached?.blockNumber !== undefined) known.set(recordKey(r.kind, r.nonce), cached.blockNumber);
    else pending.push({ rk: recordKey(r.kind, r.nonce), t, nonce: r.nonce });
  }
  const pendingKey = pending.map((p) => p.rk).sort().join(",");

  const query = useQuery({
    queryKey: ["arcclaim-activity-timeline", network.key, pendingKey],
    enabled: pending.length > 0,
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const client = getPublicClient(config, { chainId: network.chainId }) as PublicClient | undefined;
      if (!client) throw new Error("No RPC client");
      const found = await resolveBlocks(client, network, pending);
      for (const p of pending) {
        const b = found.get(p.rk);
        if (b !== undefined) saveMeta(metaKeyFor(network, p.t, p.nonce), { blockNumber: b });
      }
      return found;
    },
  });

  const blocks = new Map(known);
  query.data?.forEach((b, k) => blocks.set(k, b));
  return { blocks, isResolving: pending.length > 0 && query.isLoading, isError: query.isError };
}

// ---------------------------------------------------------------------------
// Creation tx of one (visible) record
// ---------------------------------------------------------------------------

async function resolveCreation(
  client: PublicClient,
  network: ArcNetwork,
  kind: CreationKind,
  nonce: bigint,
  knownBlock?: bigint,
): Promise<CreationMeta> {
  const target = activityTargets(network).find((t) => t.kind === kind);
  if (!target) throw new Error("Contract not deployed on this network");
  const chainId = network.chainId;

  // Created by block B  ⇔  the contract's counter at B has reached this record's nonce.
  const block =
    knownBlock ??
    (await firstBlockWhere(target.deployBlock, await latestBlock(client, chainId), async (b) => {
      const count = await readAtBlock<bigint>(client, chainId, { address: target.address, abi: target.abi, functionName: target.counter }, b);
      return createdCount(kind, count) >= nonce;
    }));
  if (block === undefined) throw new Error("Creation block not found");

  // One log query, for that single block.
  const ev = CREATION_EVENT[kind];
  const event = getAbiItem({ abi: target.abi, name: ev.name }) as AbiEvent;
  const [log] = await logsInBlock(() =>
    client.getLogs({ address: target.address, event, args: { [ev.idArg]: recordId(target, chainId, nonce) }, fromBlock: block, toBlock: block }),
  );
  if (!log?.transactionHash) throw new Error("Creation log not found");
  const timestamp =
    log.blockTimestamp ?? (await throttledCalls(() => client.getBlock({ blockNumber: block })).then((b) => b.timestamp));
  return { txHash: log.transactionHash, blockNumber: block, timestamp };
}

/**
 * Creation tx + time of one Activity record, resolved on demand (only rendered rows call this) and cached
 * in localStorage. Cached records make no RPC calls. One retry, then the row shows a manual Retry.
 * `knownBlock` (from the timeline) skips the block search, leaving one single-block log query.
 */
export function useCreationMeta(kind: CreationKind, nonce: bigint, knownBlock?: bigint, enabled = true) {
  const config = useConfig();
  const network = useNetwork();
  const target = activityTargets(network).find((t) => t.kind === kind);
  const key = target ? metaKeyFor(network, target, nonce) : undefined;

  return useQuery({
    queryKey: ["arcclaim-activity-meta", key],
    enabled: !!key && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    retryDelay: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: () => {
      const cached = key ? loadCache<CreationMeta>(key) : undefined;
      return cached?.txHash ? cached : undefined;
    },
    queryFn: async () => {
      const client = getPublicClient(config, { chainId: network.chainId }) as PublicClient | undefined;
      if (!client) throw new Error("No RPC client");
      const block = knownBlock ?? loadCache<CreationMeta>(key!)?.blockNumber;
      const meta = await resolveCreation(client, network, kind, nonce, block);
      saveMeta(key!, meta);
      return meta;
    },
  });
}

// ---------------------------------------------------------------------------
// Airdrop claim tx of one (visible) allocation
// ---------------------------------------------------------------------------

export type ClaimMeta = { txHash: Hash; blockNumber: bigint; timestamp?: bigint };

async function resolveAllocationClaim(
  client: PublicClient,
  network: ArcNetwork,
  batchId: Hex,
  account: Address,
  fromBlock?: bigint,
): Promise<ClaimMeta> {
  const batch = network.contracts.batch;
  if (!batch) throw new Error("ArcClaimBatch not deployed on this network");
  const chainId = network.chainId;
  const head = await latestBlock(client, chainId);
  // Claimed by block B  ⇔  the allocation's status at B is CLAIMED (FUNDED → CLAIMED, never back).
  const block = await firstBlockWhere(fromBlock ?? batch.deployBlock, head, async (b) => {
    const [, status] = await readAtBlock<readonly [bigint, number]>(
      client,
      chainId,
      { address: batch.address, abi: arcClaimBatchAbi, functionName: "getAllocation", args: [batchId, account] },
      b,
    );
    return status === AllocationStatus.CLAIMED;
  });
  if (block === undefined) throw new Error("Claim block not found");
  const event = getAbiItem({ abi: arcClaimBatchAbi, name: "AllocationClaimed" });
  const [log] = await logsInBlock(() =>
    client.getLogs({ address: batch.address, event, args: { batchId, recipient: account }, fromBlock: block, toBlock: block }),
  );
  if (!log) throw new Error("Claim log not found");
  const timestamp =
    log.blockTimestamp ?? (await throttledCalls(() => client.getBlock({ blockNumber: block })).then((b) => b.timestamp));
  return { txHash: log.transactionHash, blockNumber: block, timestamp };
}

/**
 * When the wallet claimed its airdrop allocation: binary search on the allocation's historical status
 * (FUNDED → CLAIMED), then the AllocationClaimed log of that one block. Cached per network + contract +
 * batch id + claimant.
 */
export function useAllocationClaim(batchId: Hex, account: Address | undefined, claimed: boolean, fromBlock?: bigint) {
  const config = useConfig();
  const network = useNetwork();
  const batch = network.contracts.batch;
  const key =
    batch && account ? `${activityMetaKey(network, batch.address, batchId)}:claim:${account.toLowerCase()}` : undefined;

  return useQuery({
    queryKey: ["arcclaim-activity-claim", key],
    enabled: !!key && claimed,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    retryDelay: 2_000,
    refetchOnWindowFocus: false,
    initialData: () => (key ? loadCache<ClaimMeta>(key) : undefined),
    queryFn: async (): Promise<ClaimMeta> => {
      const client = getPublicClient(config, { chainId: network.chainId }) as PublicClient | undefined;
      if (!client || !account) throw new Error("No RPC client");
      const meta = await resolveAllocationClaim(client, network, batchId, account, fromBlock);
      saveCache(key!, meta);
      return meta;
    },
  });
}
