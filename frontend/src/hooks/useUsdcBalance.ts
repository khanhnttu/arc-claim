"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { usdcContract } from "@/contracts/usdc";
import { useNetwork } from "@/components/NetworkProvider";

/** USDC (6-decimal ERC-20) balance of an address on the selected network. */
export function useUsdcBalance(address?: Address) {
  const network = useNetwork();
  return useReadContract({
    ...usdcContract(network),
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: network.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}
