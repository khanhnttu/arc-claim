"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getAbiItem, type Address, type Hash } from "viem";
import { useConfig, useReadContracts } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { arcChain } from "@/config/arc";
import { scanLogsIncremental } from "@/lib/logScan";
import { V1, V2, isV1Enabled, isV2Enabled, refKey, type PaymentRef } from "@/lib/payments";
import { LIVE_POLL_MS, isTerminalStatus } from "./usePayment";

export type SentPayment = {
  ref: PaymentRef;
  recipient: Address;
  amount: bigint;
  expiry: bigint;
  txHash: Hash;
  blockNumber: bigint;
};

const CLAIM_CREATED = getAbiItem({ abi: V1.abi, name: "ClaimCreated" });
const PAYMENT_CREATED = getAbiItem({ abi: V2.abi, name: "PaymentCreated" });

/**
 * Discover payments created by `sender` on one contract version from its creation events (no backend),
 * then read each payment's live status from the contract.
 */
export function useSenderPayments(version: 1 | 2, sender?: Address) {
  const config = useConfig();
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const contract = version === 1 ? V1 : V2;
  const enabled = !!sender && (version === 1 ? isV1Enabled : isV2Enabled);

  const events = useQuery({
    queryKey: ["arcclaim-sent", version, sender?.toLowerCase()],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<SentPayment[]> => {
      const client = getPublicClient(config, { chainId: arcChain.id });
      if (!client || !sender) return [];
      const latest = await client.getBlockNumber();

      const found = await scanLogsIncremental<SentPayment>({
        cacheKey: `arcclaim:sent:v3:${arcChain.id}:${contract.address.toLowerCase()}:${sender.toLowerCase()}`,
        startBlock: contract.deployBlock,
        latest,
        onProgress: setProgress,
        fetchRange: async (fromBlock, toBlock) => {
          if (version === 1) {
            const logs = await client.getLogs({
              address: V1.address,
              event: CLAIM_CREATED,
              args: { sender },
              fromBlock,
              toBlock,
            });
            return logs.map((l) => ({
              ref: { version: 1, id: l.args.claimId! },
              recipient: l.args.recipient!,
              amount: l.args.amount!,
              expiry: l.args.expiry!,
              txHash: l.transactionHash,
              blockNumber: l.blockNumber,
            }));
          }
          const logs = await client.getLogs({
            address: V2.address,
            event: PAYMENT_CREATED,
            args: { sender },
            fromBlock,
            toBlock,
          });
          return logs.map((l) => ({
            ref: { version: 2, id: l.args.paymentId! },
            recipient: l.args.recipient!,
            amount: l.args.amount!,
            expiry: l.args.expiry!,
            txHash: l.transactionHash,
            blockNumber: l.blockNumber,
          }));
        },
      });

      const unique = new Map(found.map((p) => [refKey(p.ref), p]));
      return [...unique.values()].sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1));
    },
  });

  const list = events.data ?? [];
  const statuses = useReadContracts({
    contracts: list.map((p) =>
      p.ref.version === 1
        ? ({ address: V1.address, abi: V1.abi, functionName: "getClaim", args: [p.ref.id], chainId: arcChain.id } as const)
        : ({ address: V2.address, abi: V2.abi, functionName: "getPayment", args: [p.ref.id], chainId: arcChain.id } as const),
    ),
    query: {
      enabled: list.length > 0,
      // Keep polling while any payment can still change; stop once all are settled.
      refetchInterval: (q) => {
        const results = q.state.data;
        const allSettled =
          !!results &&
          results.length > 0 &&
          results.every((r) => r.status === "success" && isTerminalStatus((r.result as { status: number }).status));
        return allSettled ? false : LIVE_POLL_MS;
      },
    },
  });

  const payments = list.map((p, i) => {
    const onchain = statuses.data?.[i];
    return {
      ...p,
      status: onchain?.status === "success" ? (onchain.result as { status: number }).status : undefined,
    };
  });

  return {
    payments,
    isLoading: enabled && events.isLoading,
    error: events.error ?? statuses.error,
    progress,
    refetch: () => Promise.all([events.refetch(), statuses.refetch()]),
  };
}
