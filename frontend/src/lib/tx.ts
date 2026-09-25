import type { QueryClient } from "@tanstack/react-query";
import type { Address, Hash } from "viem";
import type { Config } from "wagmi";
import { getAccount, readContract, switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { usdcContract } from "@/contracts/usdc";
import { FriendlyError } from "./errors";

/**
 * Returns the connected account, prompting a switch to the selected Arc network if the wallet is elsewhere.
 * Never lets a transaction go out on the wrong chain.
 */
export async function requireArcAccount(config: Config, network: ArcNetwork) {
  const account = getAccount(config);
  if (!account.address) throw new FriendlyError("Connect your wallet first.");
  if (account.chainId !== network.chainId) {
    try {
      await switchChain(config, { chainId: network.chainId });
    } catch {
      throw new FriendlyError(`Your wallet is on the wrong network. Switch to ${network.displayName}.`);
    }
    if (getAccount(config).chainId !== network.chainId)
      throw new FriendlyError(`Your wallet is on the wrong network. Switch to ${network.displayName}.`);
  }
  return account.address;
}

/** Wait for a transaction and throw if it reverted. */
export async function waitForSuccess(config: Config, network: ArcNetwork, hash: Hash) {
  const receipt = await waitForTransactionReceipt(config, { hash, chainId: network.chainId });
  if (receipt.status !== "success") {
    throw new FriendlyError("The transaction was reverted on-chain.");
  }
  return receipt;
}

/** Re-fetch every on-chain read (claims, balances, allowances) after a transaction. */
export function refreshChainReads(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      ["readContract", "readContracts", "balance"].includes(q.queryKey[0]),
  });
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Make sure `spender` may pull `amount` USDC from `owner`, approving exactly `amount` if not.
 * Never approves an unlimited amount. Returns the approval tx hash if one was sent.
 */
export async function ensureUsdcAllowance(
  config: Config,
  network: ArcNetwork,
  owner: Address,
  spender: Address,
  amount: bigint,
  onStep: (step: "approve-wallet" | "approving" | "approved") => void,
): Promise<Hash | undefined> {
  const chainId = network.chainId;
  const usdc = usdcContract(network);
  const [balance, allowance] = await Promise.all([
    readContract(config, { ...usdc, functionName: "balanceOf", args: [owner], chainId }),
    readContract(config, { ...usdc, functionName: "allowance", args: [owner, spender], chainId }),
  ]);
  if (balance < amount) throw new FriendlyError("You don't have enough USDC for this payment.");
  if (allowance >= amount) return undefined;

  onStep("approve-wallet");
  const hash = await writeContract(config, {
    ...usdc,
    functionName: "approve",
    args: [spender, amount],
    chainId,
  });
  onStep("approving");
  await waitForSuccess(config, network, hash);
  onStep("approved");
  return hash;
}
