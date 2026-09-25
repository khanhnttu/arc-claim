import { erc20Abi } from "viem";
import type { ArcNetwork } from "@/config/arc";

/** USDC ERC-20 (balanceOf / allowance / approve) on the given network. */
export const usdcContract = (network: ArcNetwork) =>
  ({
    address: network.usdcAddress,
    abi: erc20Abi,
  }) as const;
