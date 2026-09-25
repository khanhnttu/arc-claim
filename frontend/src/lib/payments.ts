import { isHex, type Address, type Hex } from "viem";
import { shareUrl, type ArcNetwork } from "@/config/arc";
import { arcClaimAbi } from "@/contracts/ArcClaim";
import { arcClaimV2Abi } from "@/contracts/ArcClaimV2";
import { shortAddress } from "./format";

/**
 * A single-recipient payment on either contract:
 * v1 = Phase 1 ArcClaim (uint256 claimId), v2 = ArcClaimV2 (bytes32 paymentId, supports never-expire).
 * Both share the same status enum: NONE, FUNDED, CLAIMED, CANCELLED, REFUNDED.
 */
export type PaymentRef = { version: 1; id: bigint } | { version: 2; id: Hex };

export type PaymentData = {
  sender: Address;
  recipient: Address;
  amount: bigint;
  /** 0 = never expires (v2 only). */
  expiry: bigint;
  status: number;
};

/**
 * The payment contracts on `network`. The Phase 1 contract (ArcClaim v1) only exists on Arc Testnet;
 * when ArcClaimV2 is deployed, new payments go to it. Addresses come from src/config/arc.ts.
 */
export function paymentContracts(network: ArcNetwork) {
  const { claimV1, claimV2 } = network.contracts;
  return {
    isV1Enabled: !!claimV1,
    isV2Enabled: !!claimV2,
    V1: { address: claimV1?.address as Address, abi: arcClaimAbi, deployBlock: claimV1?.deployBlock ?? 0n },
    V2: { address: claimV2?.address as Address, abi: arcClaimV2Abi, deployBlock: claimV2?.deployBlock ?? 0n },
  } as const;
}

export type PaymentContracts = ReturnType<typeof paymentContracts>;

/** Settlement event name per status, per contract version. */
export const SETTLEMENT_EVENTS = {
  1: { 2: "Claimed", 3: "Cancelled", 4: "ExpiredRefunded" },
  2: { 2: "PaymentClaimed", 3: "PaymentCancelled", 4: "PaymentRefunded" },
} as const;

export const refKey = (ref: PaymentRef) => `v${ref.version}:${ref.id.toString()}`;

export const paymentPath = (ref: PaymentRef) =>
  ref.version === 1 ? `/claim/${ref.id.toString()}` : `/pay/${ref.id}`;

/** Shareable claim link; tagged with the network so it opens on the right chain. */
export const paymentUrl = (network: ArcNetwork, ref: PaymentRef) => shareUrl(network, paymentPath(ref));

/** "#4" for v1, "0x1a2b…9f0e" for v2. */
export const paymentLabel = (ref: PaymentRef) => (ref.version === 1 ? `#${ref.id}` : shortAddress(ref.id, 4));

export const neverExpires = (expiry: bigint) => expiry === 0n;

/** `now` is 0 before hydration; treat as unknown (not expired). */
export const isPaymentExpired = (expiry: bigint, now: number) =>
  expiry !== 0n && now > 0 && now >= Number(expiry);

/** Parse a /pay/[id] route segment into a v2 ref. */
export function parsePaymentId(raw: string | undefined): PaymentRef | undefined {
  if (!raw || !isHex(raw) || raw.length !== 66) return undefined;
  return { version: 2, id: raw.toLowerCase() as Hex };
}

/** Parse a /claim/[id] route segment into a v1 ref. */
export function parseClaimId(raw: string | undefined): PaymentRef | undefined {
  if (!raw || !/^\d{1,78}$/.test(raw)) return undefined;
  const id = BigInt(raw);
  return id > 0n ? { version: 1, id } : undefined;
}

/** Resend link: opens the create form pre-filled; always creates a brand-new payment. */
export function resendHref(p: { recipient: Address; amount: bigint; expiry: bigint }, amountText: string) {
  const q = new URLSearchParams({ recipient: p.recipient, amount: amountText });
  if (p.expiry === 0n) q.set("expiry", "never");
  return `/?${q.toString()}#create`;
}
