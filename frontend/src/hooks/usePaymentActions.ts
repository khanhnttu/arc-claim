"use client";

import { useCallback } from "react";
import type { Address } from "viem";
import type { Config } from "wagmi";
import { readContract, simulateContract, writeContract } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { ClaimStatus } from "@/contracts/ArcClaim";
import { FriendlyError } from "@/lib/errors";
import { formatUsdc, sameAddress } from "@/lib/format";
import { paymentContracts, type PaymentData, type PaymentRef } from "@/lib/payments";
import { nowSeconds } from "@/lib/tx";
import { useTxAction, type PreparedTx } from "./useTxAction";

type Action = "claim" | "cancel" | "refundExpired";

const INACTIVE_MESSAGE: Record<number, string> = {
  [ClaimStatus.CLAIMED]: "This payment was already claimed.",
  [ClaimStatus.CANCELLED]: "This payment was already cancelled.",
  [ClaimStatus.REFUNDED]: "This payment was already refunded.",
};

async function readPayment(config: Config, network: ArcNetwork, ref: PaymentRef): Promise<PaymentData> {
  const chainId = network.chainId;
  const { V1, V2 } = paymentContracts(network);
  return ref.version === 1
    ? readContract(config, { address: V1.address, abi: V1.abi, functionName: "getClaim", args: [ref.id], chainId })
    : readContract(config, { address: V2.address, abi: V2.abi, functionName: "getPayment", args: [ref.id], chainId });
}

/** UX pre-flight checks against fresh on-chain state. The contract is the final authority. */
function assertCanRun(action: Action, p: PaymentData, account: Address) {
  if (p.status === ClaimStatus.NONE) throw new FriendlyError("This payment does not exist.");
  if (p.status !== ClaimStatus.FUNDED) {
    throw new FriendlyError(INACTIVE_MESSAGE[p.status] ?? "This payment is no longer active.");
  }
  const never = p.expiry === 0n;
  const expired = !never && nowSeconds() >= Number(p.expiry);
  if (action === "claim") {
    if (!sameAddress(account, p.recipient)) throw new FriendlyError("Only the recipient wallet can claim this payment.");
    if (expired) throw new FriendlyError("This payment has expired and can no longer be claimed.");
  } else if (action === "cancel") {
    if (!sameAddress(account, p.sender)) throw new FriendlyError("Only the sender can cancel this payment.");
    if (expired) throw new FriendlyError("This payment has expired. Use refund instead.");
  } else {
    if (never) throw new FriendlyError("This payment never expires, so it cannot be refunded. The sender can cancel it.");
    if (!expired) throw new FriendlyError("This payment has not expired yet.");
  }
}

function successMessage(action: Action, amount: bigint) {
  const usdc = `${formatUsdc(amount)} USDC`;
  if (action === "claim") return `${usdc} claimed successfully.`;
  if (action === "cancel") return `Payment cancelled. ${usdc} returned.`;
  return `Expired payment refunded. ${usdc} returned to the sender.`;
}

async function simulate(
  config: Config,
  network: ArcNetwork,
  ref: PaymentRef,
  action: Action,
  account: Address,
): Promise<PreparedTx["send"]> {
  const chainId = network.chainId;
  const { V1, V2 } = paymentContracts(network);
  if (ref.version === 1) {
    const { request } = await simulateContract(config, {
      address: V1.address,
      abi: V1.abi,
      functionName: action,
      args: [ref.id],
      account,
      chainId,
    });
    return () => writeContract(config, request);
  }
  const { request } = await simulateContract(config, {
    address: V2.address,
    abi: V2.abi,
    functionName: action,
    args: [ref.id],
    account,
    chainId,
  });
  return () => writeContract(config, request);
}

function usePaymentAction(action: Action) {
  const tx = useTxAction();
  const { execute } = tx;
  const run = useCallback(
    (ref: PaymentRef) =>
      execute(async ({ config, account, network }) => {
        const p = await readPayment(config, network, ref);
        assertCanRun(action, p, account);
        const send = await simulate(config, network, ref, action, account);
        return { send, successText: successMessage(action, p.amount) };
      }),
    [action, execute],
  );
  return { ...tx, run };
}

export type PaymentAction = ReturnType<typeof usePaymentAction>;

/** Recipient claims the payment (v1 or v2). */
export const useClaimPayment = () => usePaymentAction("claim");
/** Sender cancels a payment that has not expired (never-expire payments: any time before claim). */
export const useCancelClaim = () => usePaymentAction("cancel");
/** Anyone refunds an expired payment back to its sender. Not available for never-expire payments. */
export const useRefundExpired = () => usePaymentAction("refundExpired");
