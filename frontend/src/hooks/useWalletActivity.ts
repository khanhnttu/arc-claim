"use client";

import { useQuery } from "@tanstack/react-query";
import { encodeAbiParameters, getAddress, keccak256, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { useNetwork } from "@/components/NetworkProvider";
import { arcClaimAbi } from "@/contracts/ArcClaim";
import { AllocationStatus, arcClaimBatchAbi } from "@/contracts/ArcClaimBatch";
import { arcClaimV2Abi } from "@/contracts/ArcClaimV2";
import { isBatchSettled, type BatchData } from "@/lib/batches";
import { sameAddress } from "@/lib/format";
import { loadCache, saveCache } from "@/lib/logScan";
import { throttledCalls } from "@/lib/throttle";
import type { PaymentData, PaymentRef } from "@/lib/payments";
import { LIVE_POLL_MS, isTerminalStatus } from "./usePayment";

export type Kind = "v1" | "v2" | "batch";

export type Target = {
  kind: Kind;
  address: Address;
  abi: Abi;
  deployBlock: bigint;
  /** View that counts created records; v1's `nextClaimId` is one past the last id. */
  counter: "nextClaimId" | "paymentCount" | "batchCount";
  getter: "getClaim" | "getPayment" | "getBatch";
};

/** The ArcClaim contracts deployed on `network`. */
export function activityTargets(network: ArcNetwork): Target[] {
  const { claimV1, claimV2, batch } = network.contracts;
  const out: Target[] = [];
  if (claimV1)
    out.push({ kind: "v1", ...claimV1, abi: arcClaimAbi, counter: "nextClaimId", getter: "getClaim" });
  if (claimV2)
    out.push({ kind: "v2", ...claimV2, abi: arcClaimV2Abi, counter: "paymentCount", getter: "getPayment" });
  if (batch) out.push({ kind: "batch", ...batch, abi: arcClaimBatchAbi, counter: "batchCount", getter: "getBatch" });
  return out;
}

/** Number of records a counter value means (v1's nextClaimId starts at 1). */
export const createdCount = (kind: Kind, raw: bigint) => (kind === "v1" ? (raw > 0n ? raw - 1n : 0n) : raw);

/**
 * The record id for a creation nonce. ArcClaimV2 / ArcClaimBatch derive ids as
 * keccak256(abi.encode(block.chainid, address(this), nonce)) — see paymentIdAt / batchIdAt.
 */
export function recordId(t: Pick<Target, "kind" | "address">, chainId: number, nonce: bigint): bigint | Hex {
  if (t.kind === "v1") return nonce;
  return keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [BigInt(chainId), t.address, nonce]),
  );
}

// ---------------------------------------------------------------------------
// Activity items: one per role the wallet plays in a record.
// ---------------------------------------------------------------------------

type Base = { key: string; kind: Kind; nonce: bigint; contract: Address };

export type PaymentActivity = Base & {
  type: "PAYMENT_SENT" | "PAYMENT_RECEIVED";
  kind: "v1" | "v2";
  ref: PaymentRef;
  payment: PaymentData;
  /** The other side: recipient for sent, sender for received. */
  counterparty: Address;
};

export type AirdropCreatedActivity = Base & { type: "AIRDROP_CREATED"; kind: "batch"; batchId: Hex; batch: BatchData };

export type AirdropClaimActivity = Base & {
  type: "AIRDROP_CLAIMED";
  kind: "batch";
  batchId: Hex;
  batch: BatchData;
  /** This wallet's own allocation — not the airdrop total. */
  allocation: { amount: bigint; status: number };
  counterparty: Address;
};

export type ActivityItem = PaymentActivity | AirdropCreatedActivity | AirdropClaimActivity;
export type ActivityType = ActivityItem["type"];

/** Creation-order key of a record, shared by every item of that record (used for timeline lookups). */
export const recordKey = (kind: Kind, nonce: bigint) => `${kind}:${nonce}`;

// ---------------------------------------------------------------------------
// Reading from the contracts
// ---------------------------------------------------------------------------

/** Per network + contract + wallet: records read so far, and the nonces this wallet is part of. */
type IndexCache = { scanned: bigint; mine: bigint[] };
const indexKey = (network: ArcNetwork, t: Target, wallet: Address) =>
  `arcclaim:activity-index:v2:${network.key}:${t.address.toLowerCase()}:${wallet.toLowerCase()}`;

/** Airdrops can gain allocations after creation (addAllocations, 200 rows per tx), so recent ones are re-checked. */
const RECHECK_RECENT_BATCHES = 20n;

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

async function readWalletActivity(client: PublicClient, network: ArcNetwork, account: Address): Promise<ActivityItem[]> {
  const wallet = getAddress(account);
  const chainId = network.chainId;
  const targets = activityTargets(network);
  const caches = targets.map((t) => loadCache<IndexCache>(indexKey(network, t, wallet)) ?? { scanned: 0n, mine: [] });
  // Through the shared eth_call throttle: bounded backoff on the RPC's 429s instead of failing the list.
  const multicall = (contracts: Call[]) =>
    throttledCalls(() => client.multicall({ contracts: contracts as never, allowFailure: false, batchSize: 16_384 })) as Promise<
      unknown[]
    >;

  const getRecord = (t: Target, nonce: bigint): Call => ({
    address: t.address,
    abi: t.abi,
    functionName: t.getter,
    args: [recordId(t, chainId, nonce)],
  });
  const getAllocation = (t: Target, nonce: bigint): Call => ({
    address: t.address,
    abi: t.abi,
    functionName: "getAllocation",
    args: [recordId(t, chainId, nonce), wallet],
  });

  // Request 1: counters + fresh state of this wallet's known records (+ its allocations in them),
  // and a re-check of the most recent airdrops it is not (yet) part of.
  type Job = { t: Target; nonce: bigint; what: "record" | "allocation" };
  const jobs: Job[] = [];
  targets.forEach((t, i) => {
    for (const nonce of caches[i].mine) {
      jobs.push({ t, nonce, what: "record" });
      if (t.kind === "batch") jobs.push({ t, nonce, what: "allocation" });
    }
    if (t.kind === "batch") {
      const mine = new Set(caches[i].mine);
      const from = caches[i].scanned > RECHECK_RECENT_BATCHES ? caches[i].scanned - RECHECK_RECENT_BATCHES + 1n : 1n;
      for (let n = from; n <= caches[i].scanned; n++) if (!mine.has(n)) jobs.push({ t, nonce: n, what: "allocation" });
    }
  });
  const first = await multicall([
    ...targets.map((t) => ({ address: t.address, abi: t.abi, functionName: t.counter })),
    ...jobs.map((j) => (j.what === "record" ? getRecord(j.t, j.nonce) : getAllocation(j.t, j.nonce))),
  ]);
  const counts = targets.map((t, i) => createdCount(t.kind, first[i] as bigint));
  const records = new Map<string, unknown>();
  const allocations = new Map<string, { amount: bigint; status: number }>();
  const recheck: Job[] = [];
  jobs.forEach((j, i) => {
    const r = first[targets.length + i];
    const k = recordKey(j.t.kind, j.nonce);
    if (j.what === "record") records.set(k, r);
    else {
      const [amount, status] = r as readonly [bigint, number];
      allocations.set(k, { amount, status });
      if (status !== AllocationStatus.NONE && !caches[targets.indexOf(j.t)].mine.includes(j.nonce)) recheck.push(j);
    }
  });

  // Request 2 (only when something is new): records created since last time, plus the records of
  // re-checked airdrops that now include this wallet.
  const fresh: Job[] = [];
  targets.forEach((t, i) => {
    for (let n = caches[i].scanned + 1n; n <= counts[i]; n++) {
      fresh.push({ t, nonce: n, what: "record" });
      if (t.kind === "batch") fresh.push({ t, nonce: n, what: "allocation" });
    }
  });
  const second = [...fresh, ...recheck.map((j) => ({ ...j, what: "record" as const }))];
  if (second.length > 0) {
    const results = await multicall(second.map((j) => (j.what === "record" ? getRecord(j.t, j.nonce) : getAllocation(j.t, j.nonce))));
    second.forEach((j, i) => {
      const k = recordKey(j.t.kind, j.nonce);
      if (j.what === "record") records.set(k, results[i]);
      else {
        const [amount, status] = results[i] as readonly [bigint, number];
        allocations.set(k, { amount, status });
      }
    });
    // Keep the nonces this wallet is part of (as sender, recipient or airdrop recipient).
    for (const j of second) {
      if (j.what !== "record") continue;
      const idx = targets.indexOf(j.t);
      if (caches[idx].mine.includes(j.nonce)) continue;
      const r = records.get(recordKey(j.t.kind, j.nonce)) as { sender: Address; recipient?: Address };
      const alloc = allocations.get(recordKey(j.t.kind, j.nonce));
      const involved =
        sameAddress(r.sender, wallet) ||
        (j.t.kind !== "batch" && !!r.recipient && sameAddress(r.recipient, wallet)) ||
        (j.t.kind === "batch" && !!alloc && alloc.status !== AllocationStatus.NONE);
      if (involved) caches[idx].mine.push(j.nonce);
    }
  }
  targets.forEach((t, i) => saveCache(indexKey(network, t, wallet), { scanned: counts[i], mine: caches[i].mine }));

  // One item per role.
  const items: ActivityItem[] = [];
  targets.forEach((t, i) => {
    for (const nonce of caches[i].mine) {
      const rk = recordKey(t.kind, nonce);
      const r = records.get(rk);
      if (!r) continue;
      const id = recordId(t, chainId, nonce);
      const base = { kind: t.kind, nonce, contract: t.address };
      if (t.kind === "batch") {
        const batch = r as BatchData;
        const batchId = id as Hex;
        if (sameAddress(batch.sender, wallet))
          items.push({ ...base, kind: "batch", key: `${rk}:created`, type: "AIRDROP_CREATED", batchId, batch });
        const alloc = allocations.get(rk);
        if (alloc && alloc.status !== AllocationStatus.NONE)
          items.push({
            ...base,
            kind: "batch",
            key: `${rk}:claim`,
            type: "AIRDROP_CLAIMED",
            batchId,
            batch,
            allocation: alloc,
            counterparty: batch.sender,
          });
      } else {
        const payment = r as PaymentData;
        const kind = t.kind;
        const ref: PaymentRef = kind === "v1" ? { version: 1, id: id as bigint } : { version: 2, id: id as Hex };
        // A payment to yourself shows once, as sent.
        if (sameAddress(payment.sender, wallet))
          items.push({ ...base, kind, key: `${rk}:sent`, type: "PAYMENT_SENT", ref, payment, counterparty: payment.recipient });
        else if (sameAddress(payment.recipient, wallet))
          items.push({ ...base, kind, key: `${rk}:received`, type: "PAYMENT_RECEIVED", ref, payment, counterparty: payment.sender });
      }
    }
  });
  return items;
}

const isLive = (it: ActivityItem) =>
  it.type === "AIRDROP_CREATED" || it.type === "AIRDROP_CLAIMED"
    ? !isBatchSettled(it.batch)
    : !isTerminalStatus(it.payment.status);

/**
 * Everything the wallet is part of on the selected network — payments it sent or received, airdrops it
 * created or has an allocation in — read directly from the contracts' counters and getters (no log
 * scanning). Shared by every Activity view through the query cache.
 */
export function useWalletActivity(wallet?: Address) {
  const config = useConfig();
  const network = useNetwork();
  const targets = activityTargets(network);
  const contractsKey = targets.map((t) => t.address.toLowerCase()).join(",");

  return useQuery({
    queryKey: ["arcclaim-sender-activity", network.key, contractsKey, wallet?.toLowerCase()],
    enabled: !!wallet && targets.length > 0,
    // Poll quickly while anything can still change; otherwise just watch for new records.
    refetchInterval: (q) => (q.state.data?.some(isLive) ? LIVE_POLL_MS : 30_000),
    queryFn: async (): Promise<ActivityItem[]> => {
      const client = getPublicClient(config, { chainId: network.chainId }) as PublicClient | undefined;
      if (!client || !wallet) return [];
      return readWalletActivity(client, network, wallet);
    },
  });
}
