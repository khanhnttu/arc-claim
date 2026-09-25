"use client";

import { useQuery } from "@tanstack/react-query";
import { encodeAbiParameters, keccak256, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { useNetwork } from "@/components/NetworkProvider";
import { arcClaimAbi } from "@/contracts/ArcClaim";
import { arcClaimBatchAbi } from "@/contracts/ArcClaimBatch";
import { arcClaimV2Abi } from "@/contracts/ArcClaimV2";
import { isBatchSettled, type BatchData } from "@/lib/batches";
import { loadCache, saveCache } from "@/lib/logScan";
import type { PaymentData, PaymentRef } from "@/lib/payments";
import { LIVE_POLL_MS, isTerminalStatus } from "./usePayment";

/** A payment the sender created. `nonce` is its creation index on its contract (v1: the claim id). */
export type SentPayment = PaymentData & { ref: PaymentRef; nonce: bigint };
/** An airdrop the sender created, with its live on-chain totals. */
export type SentBatch = { batchId: Hex; nonce: bigint; data: BatchData };

export type SenderActivity = { v1: SentPayment[]; v2: SentPayment[]; batches: SentBatch[] };

type Kind = "v1" | "v2" | "batch";
type Target = {
  kind: Kind;
  address: Address;
  abi: Abi;
  /** View that counts created records; v1's `nextClaimId` is one past the last id. */
  counter: "nextClaimId" | "paymentCount" | "batchCount";
  getter: "getClaim" | "getPayment" | "getBatch";
};

/** The ArcClaim contracts deployed on `network`. */
export function activityTargets(network: ArcNetwork): Target[] {
  const { claimV1, claimV2, batch } = network.contracts;
  const out: Target[] = [];
  if (claimV1) out.push({ kind: "v1", address: claimV1.address, abi: arcClaimAbi, counter: "nextClaimId", getter: "getClaim" });
  if (claimV2) out.push({ kind: "v2", address: claimV2.address, abi: arcClaimV2Abi, counter: "paymentCount", getter: "getPayment" });
  if (batch) out.push({ kind: "batch", address: batch.address, abi: arcClaimBatchAbi, counter: "batchCount", getter: "getBatch" });
  return out;
}

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

/** Per network + contract + sender: how far the contract's records were read, and which are the sender's. */
type IndexCache = { scanned: bigint; mine: bigint[] };
const indexKey = (network: ArcNetwork, t: Target, sender: Address) =>
  `arcclaim:activity-index:v1:${network.key}:${t.address.toLowerCase()}:${sender.toLowerCase()}`;

const call = (t: Target, chainId: number, nonce: bigint) =>
  ({ address: t.address, abi: t.abi, functionName: t.getter, args: [recordId(t, chainId, nonce)] }) as const;

async function readActivity(client: PublicClient, network: ArcNetwork, sender: Address): Promise<SenderActivity> {
  const chainId = network.chainId;
  const targets = activityTargets(network);
  const caches = targets.map((t) => loadCache<IndexCache>(indexKey(network, t, sender)) ?? { scanned: 0n, mine: [] });
  const multicall = (contracts: readonly ReturnType<typeof call>[] | readonly unknown[]) =>
    client.multicall({ contracts: contracts as never, allowFailure: false, batchSize: 16_384 }) as Promise<unknown[]>;

  // Request 1: every counter + fresh state of the sender's already-known records.
  const known = targets.flatMap((t, i) => caches[i].mine.map((nonce) => ({ t, nonce })));
  const first = await multicall([
    ...targets.map((t) => ({ address: t.address, abi: t.abi, functionName: t.counter })),
    ...known.map(({ t, nonce }) => call(t, chainId, nonce)),
  ]);
  const counts = targets.map((t, i) => {
    const raw = first[i] as bigint;
    return t.kind === "v1" ? (raw > 0n ? raw - 1n : 0n) : raw;
  });
  const state = new Map<string, unknown>();
  known.forEach(({ t, nonce }, i) => state.set(`${t.kind}:${nonce}`, first[targets.length + i]));

  // Request 2 (only when something new was created): read the new records, keep the sender's.
  const fresh = targets.flatMap((t, i) => {
    const out: { t: Target; nonce: bigint }[] = [];
    for (let n = caches[i].scanned + 1n; n <= counts[i]; n++) out.push({ t, nonce: n });
    return out;
  });
  if (fresh.length > 0) {
    const results = await multicall(fresh.map(({ t, nonce }) => call(t, chainId, nonce)));
    fresh.forEach(({ t, nonce }, i) => {
      const r = results[i] as { sender: Address };
      if (r.sender.toLowerCase() !== sender.toLowerCase()) return;
      state.set(`${t.kind}:${nonce}`, r);
      caches[targets.indexOf(t)].mine.push(nonce);
    });
  }
  targets.forEach((t, i) => saveCache(indexKey(network, t, sender), { scanned: counts[i], mine: caches[i].mine }));

  const out: SenderActivity = { v1: [], v2: [], batches: [] };
  targets.forEach((t, i) => {
    for (const nonce of [...caches[i].mine].sort((a, b) => (a > b ? -1 : 1))) {
      const r = state.get(`${t.kind}:${nonce}`);
      if (!r) continue;
      const id = recordId(t, chainId, nonce);
      if (t.kind === "batch") out.batches.push({ batchId: id as Hex, nonce, data: r as BatchData });
      else if (t.kind === "v1") out.v1.push({ ...(r as PaymentData), ref: { version: 1, id: id as bigint }, nonce });
      else out.v2.push({ ...(r as PaymentData), ref: { version: 2, id: id as Hex }, nonce });
    }
  });
  return out;
}

const hasLive = (a: SenderActivity | undefined) =>
  !!a &&
  ([...a.v1, ...a.v2].some((p) => !isTerminalStatus(p.status)) || a.batches.some((b) => !isBatchSettled(b.data)));

/**
 * Everything `sender` created on the selected network (v1 + v2 payments and airdrops), read directly from
 * the contracts' counters and getters — no log scanning, so the cost does not grow with chain age.
 * All Activity sections share this one query.
 */
export function useSenderActivity(sender?: Address) {
  const config = useConfig();
  const network = useNetwork();
  const targets = activityTargets(network);
  const contractsKey = targets.map((t) => t.address.toLowerCase()).join(",");

  return useQuery({
    queryKey: ["arcclaim-sender-activity", network.key, contractsKey, sender?.toLowerCase()],
    enabled: !!sender && targets.length > 0,
    // Poll quickly while anything can still change; otherwise just watch for new records.
    refetchInterval: (q) => (hasLive(q.state.data) ? LIVE_POLL_MS : 30_000),
    queryFn: async () => {
      const client = getPublicClient(config, { chainId: network.chainId }) as PublicClient | undefined;
      if (!client || !sender) return { v1: [], v2: [], batches: [] } satisfies SenderActivity;
      return readActivity(client, network, sender);
    },
  });
}
