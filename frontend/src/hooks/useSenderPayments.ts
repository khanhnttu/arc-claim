"use client";

import type { Address } from "viem";
import { useNetwork } from "@/components/NetworkProvider";
import { paymentContracts } from "@/lib/payments";
import { useSenderActivity } from "./useSenderActivity";

export type { SentPayment } from "./useSenderActivity";

/**
 * Payments `sender` created on one contract version, with live status — read directly from the contract
 * (shared Activity query; no log scanning, no backend).
 */
export function useSenderPayments(version: 1 | 2, sender?: Address) {
  const { isV1Enabled, isV2Enabled } = paymentContracts(useNetwork());
  const enabled = !!sender && (version === 1 ? isV1Enabled : isV2Enabled);
  const activity = useSenderActivity(enabled ? sender : undefined);

  return {
    payments: (version === 1 ? activity.data?.v1 : activity.data?.v2) ?? [],
    isLoading: enabled && activity.isLoading,
    error: activity.error,
    refetch: activity.refetch,
  };
}
