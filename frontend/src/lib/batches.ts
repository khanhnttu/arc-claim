import { isHex, type Address, type Hex } from "viem";
import { shareUrl, type ArcNetwork } from "@/config/arc";
import { BatchStatus, arcClaimBatchAbi } from "@/contracts/ArcClaimBatch";
import { formatDate, formatDurationShort, shortAddress } from "./format";

/** The ArcClaimBatch contract on `network` (address from src/config/arc.ts). */
export function batchContract(network: ArcNetwork) {
  const batch = network.contracts.batch;
  return {
    isBatchEnabled: !!batch,
    BATCH: { address: batch?.address as Address, abi: arcClaimBatchAbi, deployBlock: batch?.deployBlock ?? 0n },
  } as const;
}

export type BatchContract = ReturnType<typeof batchContract>["BATCH"];

export type BatchData = {
  sender: Address;
  expiry: bigint;
  status: number;
  totalAmount: bigint;
  claimedAmount: bigint;
  returnedAmount: bigint;
  recipientCount: bigint;
  claimedCount: bigint;
};

/** What the UI shows for a batch, derived from on-chain fields + the clock. */
export type BatchPhase = "ACTIVE" | "COMPLETED" | "EXPIRED" | "REFUNDED" | "CANCELLED";

export function batchPhase(b: BatchData, now: number): BatchPhase {
  if (b.status === BatchStatus.REFUNDED) return "REFUNDED";
  if (b.status === BatchStatus.CANCELLED) return "CANCELLED";
  if (b.totalAmount > 0n && b.claimedAmount === b.totalAmount) return "COMPLETED";
  if (b.expiry !== 0n && now > 0 && now >= Number(b.expiry)) return "EXPIRED";
  return "ACTIVE";
}

/**
 * Secondary timing line for a batch. Only an ACTIVE batch with a deadline shows a countdown;
 * settled batches describe what happened instead.
 */
export function batchTimingText(b: BatchData, phase: BatchPhase, now: number, closedAt?: bigint): string {
  switch (phase) {
    case "CANCELLED":
    case "REFUNDED":
      return closedAt ? `Funds returned · ${formatDate(closedAt)}` : "Funds returned";
    case "COMPLETED":
      return "All recipients claimed";
    case "EXPIRED":
      return `Expired ${formatDurationShort(now - Number(b.expiry))} ago`;
    default:
      if (b.expiry === 0n) return "Never expires";
      return now > 0 ? `Expires in ${formatDurationShort(Number(b.expiry) - now)}` : `Expires ${formatDate(b.expiry)}`;
  }
}

/** Batch is closed or fully claimed: nothing on-chain can change any more. */
export const isBatchSettled = (b: Pick<BatchData, "status" | "totalAmount" | "claimedAmount">) =>
  b.status === BatchStatus.REFUNDED ||
  b.status === BatchStatus.CANCELLED ||
  (b.totalAmount > 0n && b.claimedAmount === b.totalAmount);

export function parseBatchId(raw: string | undefined): Hex | undefined {
  if (!raw || !isHex(raw) || raw.length !== 66) return undefined;
  return raw.toLowerCase() as Hex;
}

export const batchPath = (id: Hex) => `/airdrop/${id}`;
/** Shareable airdrop link; tagged with the network so it opens on the right chain. */
export const batchUrl = (network: ArcNetwork, id: Hex) => shareUrl(network, batchPath(id));
export const batchLabel = (id: Hex) => shortAddress(id, 4);

/** Claimed share of the total, 0–100 with one decimal. */
export function claimedPercent(b: Pick<BatchData, "totalAmount" | "claimedAmount">) {
  if (b.totalAmount === 0n) return 0;
  return Number((b.claimedAmount * 1000n) / b.totalAmount) / 10;
}
