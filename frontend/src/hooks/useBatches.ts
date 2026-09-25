"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  decodeEventLog,
  getAbiItem,
  hexToBigInt,
  numberToHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { useConfig, useReadContract, useReadContracts } from "wagmi";
import { getPublicClient, readContract, simulateContract, writeContract } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { AllocationStatus, BatchStatus, arcClaimBatchAbi } from "@/contracts/ArcClaimBatch";
import { useNetwork } from "@/components/NetworkProvider";
import { FriendlyError } from "@/lib/errors";
import { formatUsdc } from "@/lib/format";
import { blockRanges, findInRanges } from "@/lib/logs";
import { loadCache, saveCache, scanLogsIncremental } from "@/lib/logScan";
import { batchContract, isBatchSettled, type BatchContract, type BatchData } from "@/lib/batches";
import { nowSeconds } from "@/lib/tx";
import { LIVE_POLL_MS } from "./usePayment";
import { useTxAction } from "./useTxAction";

const BATCH_CREATED = getAbiItem({ abi: arcClaimBatchAbi, name: "BatchCreated" });

/** The selected network's ArcClaimBatch contract, its chain id and a cache-key prefix. */
function useBatchNetwork() {
  const network = useNetwork();
  const { BATCH, isBatchEnabled } = batchContract(network);
  return { network, BATCH, isBatchEnabled, chainId: network.chainId, contractKey: contractKey(network) };
}

const contractKey = (network: ArcNetwork) =>
  `${network.chainId}:${batchContract(network).BATCH.address?.toLowerCase()}`;

/** Live on-chain batch totals. Polls until the batch is closed or fully claimed. */
export function useBatch(batchId: Hex | undefined) {
  const { BATCH, isBatchEnabled, chainId } = useBatchNetwork();
  return useReadContract({
    ...BATCH,
    functionName: "getBatch",
    args: batchId ? [batchId] : undefined,
    chainId,
    query: {
      enabled: !!batchId && isBatchEnabled,
      refetchInterval: (q) => (q.state.data && isBatchSettled(q.state.data) ? false : LIVE_POLL_MS),
    },
  });
}

export type BatchClosure = { event: "BatchRefunded" | "BatchCancelled"; txHash: Hash; timestamp?: bigint };

/**
 * When and how a closed batch returned its unclaimed funds (from its BatchRefunded / BatchCancelled
 * event). Scans forward from the creation block; the result is final and cached.
 */
export function useBatchClosure(batchId: Hex | undefined, status: number | undefined, fromBlock: bigint | undefined) {
  const config = useConfig();
  const { BATCH, isBatchEnabled, chainId, contractKey } = useBatchNetwork();
  const closed = status === BatchStatus.REFUNDED || status === BatchStatus.CANCELLED;
  return useQuery({
    queryKey: ["arcclaim-batch-closure", chainId, batchId, status],
    enabled: !!batchId && closed && fromBlock !== undefined && isBatchEnabled,
    staleTime: Infinity,
    retry: 2,
    queryFn: async (): Promise<BatchClosure | null> => {
      const key = `arcclaim:batch-closure:v1:${contractKey}:${batchId}`;
      const cached = loadCache<BatchClosure>(key);
      if (cached) return cached;
      const client = getPublicClient(config, { chainId });
      if (!client || !batchId || fromBlock === undefined) return null;
      const eventName = status === BatchStatus.REFUNDED ? "BatchRefunded" : "BatchCancelled";
      const event = getAbiItem({ abi: BATCH.abi, name: eventName });
      const latest = await client.getBlockNumber();
      const [log] = await findInRanges(blockRanges(fromBlock, latest), (f, t) =>
        client.getLogs({ address: BATCH.address, event, args: { batchId }, fromBlock: f, toBlock: t }),
      );
      if (!log) return null;
      const timestamp =
        log.blockTimestamp ?? (await client.getBlock({ blockNumber: log.blockNumber }).then((b) => b.timestamp));
      const closure: BatchClosure = { event: eventName, txHash: log.transactionHash, timestamp };
      saveCache(key, closure);
      return closure;
    },
  });
}

/** The connected wallet's own allocation in a batch (amount 0 + NONE if it is not a recipient). */
export function useMyAllocation(batchId: Hex | undefined, account: Address | undefined, settled: boolean) {
  const { BATCH, isBatchEnabled, chainId } = useBatchNetwork();
  const q = useReadContract({
    ...BATCH,
    functionName: "getAllocation",
    args: batchId && account ? [batchId, account] : undefined,
    chainId,
    query: { enabled: !!batchId && !!account && isBatchEnabled, refetchInterval: settled ? false : LIVE_POLL_MS },
  });
  const [amount, status] = q.data ?? [];
  return { amount, status: status as number | undefined, isLoading: q.isLoading };
}

// ---------------------------------------------------------------------------
// Activity: recipients (AllocationFunded) and claims (AllocationClaimed) from events
// ---------------------------------------------------------------------------

type ActivityItem = {
  event: "BatchCreated" | "AllocationFunded" | "AllocationClaimed" | "BatchRefunded" | "BatchCancelled";
  account?: Address;
  amount?: bigint;
  txHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  timestamp?: bigint;
};

export type ClaimRecord = { txHash: Hash; timestamp?: bigint };

export type BatchActivity = {
  /** Recipients in funding order. */
  recipients: { address: Address; amount: bigint }[];
  claims: Map<string, ClaimRecord>;
  created?: ActivityItem;
  closed?: ActivityItem;
};

async function findCreationBlock(
  client: PublicClient,
  BATCH: BatchContract,
  keyPrefix: string,
  batchId: Hex,
  latest: bigint,
): Promise<bigint | undefined> {
  const key = `arcclaim:batch-created:v1:${keyPrefix}:${batchId}`;
  const cached = loadCache<bigint>(key);
  if (cached !== undefined) return cached;
  const [log] = await findInRanges(blockRanges(BATCH.deployBlock, latest, "backward"), (fromBlock, toBlock) =>
    client.getLogs({ address: BATCH.address, event: BATCH_CREATED, args: { batchId }, fromBlock, toBlock }),
  );
  if (!log) return undefined;
  saveCache(key, log.blockNumber);
  return log.blockNumber;
}

/** Every event for one batch in a block range (the batch id is topic 1 of all batch events). */
async function fetchBatchLogs(client: PublicClient, BATCH: BatchContract, batchId: Hex, fromBlock: bigint, toBlock: bigint) {
  const raw = await client.request({
    method: "eth_getLogs",
    params: [
      {
        address: BATCH.address,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(toBlock),
        topics: [null, batchId],
      },
    ],
  });
  const items: ActivityItem[] = [];
  for (const log of raw) {
    try {
      const decoded = decodeEventLog({ abi: BATCH.abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const args = decoded.args as { recipient?: Address; sender?: Address; amount?: bigint };
      const ts = (log as { blockTimestamp?: Hex }).blockTimestamp;
      items.push({
        event: decoded.eventName as ActivityItem["event"],
        account: args.recipient ?? args.sender,
        amount: args.amount,
        txHash: log.transactionHash!,
        blockNumber: hexToBigInt(log.blockNumber!),
        logIndex: Number(log.logIndex),
        timestamp: ts ? hexToBigInt(ts) : undefined,
      });
    } catch {
      // Not an ArcClaimBatch event — ignore.
    }
  }
  return items;
}

/**
 * Rebuild a batch's recipient list and claim history from its events (no backend).
 * Live per-recipient status still comes from getAllocations().
 */
export function useBatchActivity(batchId: Hex | undefined, settled: boolean, fromBlockHint?: bigint) {
  const config = useConfig();
  const { BATCH, isBatchEnabled, chainId, contractKey } = useBatchNetwork();
  const query = useQuery({
    queryKey: ["arcclaim-batch-activity", chainId, batchId],
    enabled: !!batchId && isBatchEnabled,
    refetchInterval: settled ? false : 10_000,
    queryFn: async (): Promise<ActivityItem[]> => {
      const client = getPublicClient(config, { chainId }) as PublicClient | undefined;
      if (!client || !batchId) return [];
      const latest = await client.getBlockNumber();
      const start = fromBlockHint ?? (await findCreationBlock(client, BATCH, contractKey, batchId, latest));
      if (start === undefined) return [];
      return scanLogsIncremental({
        cacheKey: `arcclaim:batch-activity:v1:${contractKey}:${batchId}`,
        startBlock: start,
        latest,
        fetchRange: (f, t) => fetchBatchLogs(client, BATCH, batchId, f, t),
      });
    },
  });

  const activity = useMemo<BatchActivity>(() => {
    const items = [...(query.data ?? [])].sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
    );
    const seen = new Set<string>();
    const recipients: BatchActivity["recipients"] = [];
    const claims = new Map<string, ClaimRecord>();
    let created: ActivityItem | undefined;
    let closed: ActivityItem | undefined;
    for (const it of items) {
      const key = `${it.txHash}:${it.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (it.event === "BatchCreated") created = it;
      else if (it.event === "AllocationFunded" && it.account && it.amount !== undefined)
        recipients.push({ address: it.account, amount: it.amount });
      else if (it.event === "AllocationClaimed" && it.account)
        claims.set(it.account.toLowerCase(), { txHash: it.txHash, timestamp: it.timestamp });
      else if (it.event === "BatchRefunded" || it.event === "BatchCancelled") closed = it;
    }
    return { recipients, claims, created, closed };
  }, [query.data]);

  return { ...activity, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

const ALLOCATION_CHUNK = 400;

/** Live allocation status for each recipient (batched getAllocations calls). */
export function useAllocations(batchId: Hex | undefined, recipients: Address[], settled: boolean) {
  const { BATCH, chainId } = useBatchNetwork();
  const chunks = useMemo(() => {
    const out: Address[][] = [];
    for (let i = 0; i < recipients.length; i += ALLOCATION_CHUNK) out.push(recipients.slice(i, i + ALLOCATION_CHUNK));
    return out;
  }, [recipients]);

  const q = useReadContracts({
    contracts: chunks.map(
      (chunk) => ({ ...BATCH, functionName: "getAllocations", args: [batchId!, chunk], chainId }) as const,
    ),
    query: { enabled: !!batchId && chunks.length > 0, refetchInterval: settled ? false : LIVE_POLL_MS },
  });

  const statuses = useMemo(() => {
    const map = new Map<string, number>();
    q.data?.forEach((res, i) => {
      if (res.status !== "success") return;
      const [, st] = res.result as readonly [readonly bigint[], readonly number[]];
      chunks[i].forEach((addr, j) => map.set(addr.toLowerCase(), st[j]));
    });
    return map;
  }, [q.data, chunks]);

  return { statuses, isLoading: q.isLoading };
}

// ---------------------------------------------------------------------------
// Sender's batches
// ---------------------------------------------------------------------------

export type SentBatch = { batchId: Hex; expiry: bigint; txHash: Hash; blockNumber: bigint };

export function useSenderBatches(sender?: Address) {
  const config = useConfig();
  const { BATCH, isBatchEnabled, chainId, contractKey } = useBatchNetwork();
  const [progress, setProgress] = useState<{ done: number; total: number }>();

  const events = useQuery({
    queryKey: ["arcclaim-sent-batches", chainId, sender?.toLowerCase()],
    enabled: !!sender && isBatchEnabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<SentBatch[]> => {
      const client = getPublicClient(config, { chainId });
      if (!client || !sender) return [];
      const latest = await client.getBlockNumber();
      const found = await scanLogsIncremental<SentBatch>({
        cacheKey: `arcclaim:sent-batches:v1:${contractKey}:${sender.toLowerCase()}`,
        startBlock: BATCH.deployBlock,
        latest,
        onProgress: setProgress,
        fetchRange: async (fromBlock, toBlock) => {
          const logs = await client.getLogs({
            address: BATCH.address,
            event: BATCH_CREATED,
            args: { sender },
            fromBlock,
            toBlock,
          });
          return logs.map((l) => ({
            batchId: l.args.batchId!,
            expiry: l.args.expiry!,
            txHash: l.transactionHash,
            blockNumber: l.blockNumber,
          }));
        },
      });
      const unique = new Map(found.map((b) => [b.batchId, b]));
      return [...unique.values()].sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1));
    },
  });

  const list = events.data ?? [];
  const batches = useReadContracts({
    contracts: list.map((b) => ({ ...BATCH, functionName: "getBatch", args: [b.batchId], chainId }) as const),
    query: {
      enabled: list.length > 0,
      refetchInterval: (q) => {
        const all = q.state.data;
        const settled = !!all && all.every((r) => r.status === "success" && isBatchSettled(r.result as BatchData));
        return settled ? false : LIVE_POLL_MS;
      },
    },
  });

  return {
    batches: list.map((b, i) => {
      const r = batches.data?.[i];
      return { ...b, data: r?.status === "success" ? (r.result as BatchData) : undefined };
    }),
    isLoading: !!sender && isBatchEnabled && events.isLoading,
    error: events.error,
    progress,
    refetch: events.refetch,
  };
}

// ---------------------------------------------------------------------------
// Actions: claim own allocation / cancel (sender) / refund expired (anyone)
// ---------------------------------------------------------------------------

type BatchAction = "claim" | "cancelBatch" | "refundExpired";

function useBatchAction(action: BatchAction) {
  const tx = useTxAction();
  const { execute } = tx;
  const run = useCallback(
    (batchId: Hex) =>
      execute(async ({ config, account, network }) => {
        const { BATCH } = batchContract(network);
        const chainId = network.chainId;
        const b = (await readContract(config, {
          ...BATCH,
          functionName: "getBatch",
          args: [batchId],
          chainId,
        })) as BatchData;
        if (b.status === BatchStatus.NONE) throw new FriendlyError("This airdrop does not exist.");
        if (b.status !== BatchStatus.ACTIVE) throw new FriendlyError("This airdrop has already been closed.");
        const never = b.expiry === 0n;
        const expired = !never && nowSeconds() >= Number(b.expiry);
        const unclaimed = b.totalAmount - b.claimedAmount;
        let successText: string;

        if (action === "claim") {
          const [amount, status] = await readContract(config, {
            ...BATCH,
            functionName: "getAllocation",
            args: [batchId, account],
            chainId,
          });
          if (status === AllocationStatus.NONE) throw new FriendlyError("This wallet is not a recipient of this airdrop.");
          if (status === AllocationStatus.CLAIMED) throw new FriendlyError("You already claimed this allocation.");
          if (expired) throw new FriendlyError("This airdrop has expired and can no longer be claimed.");
          successText = `${formatUsdc(amount)} USDC claimed successfully.`;
        } else if (action === "cancelBatch") {
          if (account.toLowerCase() !== b.sender.toLowerCase())
            throw new FriendlyError("Only the sender can cancel this airdrop.");
          if (expired) throw new FriendlyError("This airdrop has expired. Use refund instead.");
          if (unclaimed === 0n) throw new FriendlyError("Everything has been claimed — there is nothing to return.");
          successText = `Airdrop cancelled. ${formatUsdc(unclaimed)} USDC was returned to the sender.`;
        } else {
          if (never) throw new FriendlyError("This airdrop never expires, so it cannot be refunded.");
          if (!expired) throw new FriendlyError("This airdrop has not expired yet.");
          if (unclaimed === 0n) throw new FriendlyError("Everything has been claimed — there is nothing to refund.");
          successText = `Refund complete. ${formatUsdc(unclaimed)} USDC was returned to the sender.`;
        }

        const { request } = await simulateContract(config, {
          ...BATCH,
          functionName: action,
          args: [batchId],
          account,
          chainId,
        });
        return { send: () => writeContract(config, request), successText };
      }),
    [action, execute],
  );
  return { ...tx, run };
}

export const useClaimAllocation = () => useBatchAction("claim");
export const useCancelBatch = () => useBatchAction("cancelBatch");
export const useRefundBatch = () => useBatchAction("refundExpired");
