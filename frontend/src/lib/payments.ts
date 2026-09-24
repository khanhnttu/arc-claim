import { isHex, type Address, type Hex } from "viem";
import { IS_MAINNET, appBaseUrl } from "@/config/arc";
import { ARC_CLAIM_ADDRESS, ARC_CLAIM_DEPLOY_BLOCK, arcClaimAbi } from "@/contracts/ArcClaim";
import { ARC_CLAIM_V2_ADDRESS, ARC_CLAIM_V2_DEPLOY_BLOCK, arcClaimV2Abi } from "@/contracts/ArcClaimV2";
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

/** The Phase 1 contract (ArcClaim v1) was only deployed on Arc Testnet. */
export const isV1Enabled = !IS_MAINNET;

/** True once ArcClaimV2 has been deployed and configured. New payments then go to v2. */
export const isV2Enabled = !!ARC_CLAIM_V2_ADDRESS;

export const V1 = { address: ARC_CLAIM_ADDRESS, abi: arcClaimAbi, deployBlock: ARC_CLAIM_DEPLOY_BLOCK } as const;
export const V2 = {
  address: ARC_CLAIM_V2_ADDRESS as Address,
  abi: arcClaimV2Abi,
  deployBlock: ARC_CLAIM_V2_DEPLOY_BLOCK,
} as const;

/** Settlement event name per status, per contract version. */
export const SETTLEMENT_EVENTS = {
  1: { 2: "Claimed", 3: "Cancelled", 4: "ExpiredRefunded" },
  2: { 2: "PaymentClaimed", 3: "PaymentCancelled", 4: "PaymentRefunded" },
} as const;

export const refKey = (ref: PaymentRef) => `v${ref.version}:${ref.id.toString()}`;

export const paymentPath = (ref: PaymentRef) =>
  ref.version === 1 ? `/claim/${ref.id.toString()}` : `/pay/${ref.id}`;

export const paymentUrl = (ref: PaymentRef) => `${appBaseUrl()}${paymentPath(ref)}`;

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
  if (!isV1Enabled) return undefined; // Phase 1 links only exist on Arc Testnet
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
