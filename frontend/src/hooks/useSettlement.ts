"use client";

import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type AbiEvent, type Address, type Hash } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { useNetwork } from "@/components/NetworkProvider";
import { ClaimStatus } from "@/contracts/ArcClaim";
import { blockRanges, findInRanges } from "@/lib/logs";
import { loadCache, saveCache } from "@/lib/logScan";
import { SETTLEMENT_EVENTS, paymentContracts, refKey, type PaymentRef } from "@/lib/payments";

/** On-chain record of how a payment left FUNDED, read from its settlement event. */
export type Settlement = {
  status: number;
  /** Recipient (claimed) or sender (cancelled / refunded) — who received the USDC. */
  account: Address;
  amount: bigint;
  txHash: Hash;
  blockNumber: bigint;
  timestamp?: bigint;
};

const cacheKey = (network: ArcNetwork, ref: PaymentRef) => {
  const { V1, V2 } = paymentContracts(network);
  return `arcclaim:settlement:v2:${network.chainId}:${(ref.version === 1 ? V1 : V2).address?.toLowerCase()}:${refKey(ref)}`;
};

/**
 * Find the claim / cancel / refund event of a settled payment. `fromBlockHint` (e.g. the creation block)
 * scans forward from there; otherwise it scans backward from the latest block. Results are final and cached.
 */
export function useSettlement(ref: PaymentRef | undefined, status: number | undefined, fromBlockHint?: bigint) {
  const config = useConfig();
  const network = useNetwork();
  const settled =
    status === ClaimStatus.CLAIMED || status === ClaimStatus.CANCELLED || status === ClaimStatus.REFUNDED;

  return useQuery({
    queryKey: ["arcclaim-settlement", network.chainId, ref && refKey(ref), status],
    enabled: !!ref && settled,
    staleTime: Infinity,
    retry: 2,
    queryFn: async (): Promise<Settlement | null> => {
      if (!ref || !settled) return null;
      const cached = loadCache<Settlement>(cacheKey(network, ref));
      if (cached && cached.status === status) return cached;

      const client = getPublicClient(config, { chainId: network.chainId });
      if (!client) return null;
      const { V1, V2 } = paymentContracts(network);
      const contract = ref.version === 1 ? V1 : V2;
      const eventName = SETTLEMENT_EVENTS[ref.version][status as 2 | 3 | 4];
      const event = getAbiItem({ abi: contract.abi as readonly AbiEvent[], name: eventName }) as AbiEvent;
      const idArg = ref.version === 1 ? { claimId: ref.id } : { paymentId: ref.id };

      const latest = await client.getBlockNumber();
      const ranges =
        fromBlockHint !== undefined
          ? blockRanges(fromBlockHint, latest, "forward")
          : blockRanges(contract.deployBlock, latest, "backward");

      const [log] = await findInRanges(ranges, (fromBlock, toBlock) =>
        client.getLogs({ address: contract.address, event, args: idArg, fromBlock, toBlock }),
      );
      if (!log) return null;

      const args = log.args as { recipient?: Address; sender?: Address; amount?: bigint };
      const timestamp =
        log.blockTimestamp ?? (await client.getBlock({ blockNumber: log.blockNumber }).then((b) => b.timestamp));
      const settlement: Settlement = {
        status: status!,
        account: (args.recipient ?? args.sender)!,
        amount: args.amount ?? 0n,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp,
      };
      saveCache(cacheKey(network, ref), settlement);
      return settlement;
    },
  });
}
