"use client";

import { useReadContract } from "wagmi";
import { arcChain } from "@/config/arc";
import { ClaimStatus } from "@/contracts/ArcClaim";
import { V1, V2, isPaymentExpired, isV1Enabled, isV2Enabled, type PaymentData, type PaymentRef } from "@/lib/payments";
import { useNow } from "./useNow";

/** Poll interval while something can still change; settled payments are final. */
export const LIVE_POLL_MS = 5_000;

export const isTerminalStatus = (status: number | undefined) =>
  status === ClaimStatus.CLAIMED || status === ClaimStatus.CANCELLED || status === ClaimStatus.REFUNDED;

const pollUntilSettled = (q: { state: { data?: { status: number } } }) =>
  isTerminalStatus(q.state.data?.status) ? false : LIVE_POLL_MS;

/** Live on-chain view of a v1 or v2 payment, plus derived flags. Polls until the payment is settled. */
export function usePayment(ref: PaymentRef | undefined) {
  const now = useNow();

  const v1 = useReadContract({
    address: V1.address,
    abi: V1.abi,
    functionName: "getClaim",
    args: ref?.version === 1 ? [ref.id] : undefined,
    chainId: arcChain.id,
    query: { enabled: ref?.version === 1 && isV1Enabled, refetchInterval: pollUntilSettled },
  });
  const v2 = useReadContract({
    address: V2.address,
    abi: V2.abi,
    functionName: "getPayment",
    args: ref?.version === 2 ? [ref.id] : undefined,
    chainId: arcChain.id,
    query: { enabled: ref?.version === 2 && isV2Enabled, refetchInterval: pollUntilSettled },
  });

  const query = ref?.version === 2 ? v2 : v1;
  const data = query.data as PaymentData | undefined;
  const exists = !!data && data.status !== ClaimStatus.NONE;

  return {
    payment: exists ? data : undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    notFound: query.isSuccess && !exists,
    isFunded: data?.status === ClaimStatus.FUNDED,
    isExpired: !!data && isPaymentExpired(data.expiry, now),
    isTerminal: isTerminalStatus(data?.status),
    neverExpires: !!data && data.expiry === 0n,
    now,
  };
}
