"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { arcChain } from "@/config/arc";
import { usdcContract } from "@/contracts/usdc";

/** USDC (6-decimal ERC-20) balance of an address. */
export function useUsdcBalance(address?: Address) {
  return useReadContract({
    ...usdcContract,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcChain.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}
