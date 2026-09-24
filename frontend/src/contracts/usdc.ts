import { erc20Abi } from "viem";
import { USDC_ADDRESS } from "@/config/arc";

/** USDC ERC-20 (balanceOf / allowance / approve). */
export const usdcContract = {
  address: USDC_ADDRESS,
  abi: erc20Abi,
} as const;
