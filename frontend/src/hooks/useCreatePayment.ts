"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { parseEventLogs, zeroAddress, type Address, type Hash, type TransactionReceipt } from "viem";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { arcChain } from "@/config/arc";
import { FriendlyError, toFriendlyMessage } from "@/lib/errors";
import { V1, V2, isV1Enabled, isV2Enabled, type PaymentRef } from "@/lib/payments";
import { ensureUsdcAllowance, nowSeconds, refreshChainReads, requireArcAccount, waitForSuccess } from "@/lib/tx";

export type CreateStep =
  | "idle"
  | "checking"
  | "approve-wallet"
  | "approving"
  | "approved"
  | "create-wallet"
  | "creating"
  | "success"
  | "error";

export type CreatePaymentInput = {
  recipient: Address;
  /** Amount in USDC base units (6 decimals). */
  amount: bigint;
  /** Unix timestamp in seconds; 0 = never expires (ArcClaimV2 only). */
  expiry: bigint;
};

export type CreatedPayment = CreatePaymentInput & {
  ref: PaymentRef;
  sender: Address;
  txHash: Hash;
  /** Block the payment was created in (lower bound for settlement event lookups). */
  blockNumber: bigint;
  approvalTxHash?: Hash;
};

export const CREATE_STEP_MESSAGE: Record<CreateStep, string> = {
  idle: "",
  checking: "Checking USDC balance and allowance…",
  "approve-wallet": "Waiting for wallet confirmation…",
  approving: "Approving USDC…",
  approved: "USDC approved.",
  "create-wallet": "Waiting for wallet confirmation…",
  creating: "Creating payment…",
  success: "Payment ready to claim.",
  error: "",
};

function readCreatedRef(receipt: TransactionReceipt, version: 1 | 2): PaymentRef | undefined {
  if (version === 1) {
    const [log] = parseEventLogs({
      abi: V1.abi,
      eventName: "ClaimCreated",
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === V1.address.toLowerCase()),
    });
    return log && { version: 1, id: log.args.claimId };
  }
  const [log] = parseEventLogs({
    abi: V2.abi,
    eventName: "PaymentCreated",
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === V2.address.toLowerCase()),
  });
  return log && { version: 2, id: log.args.paymentId };
}

/**
 * Approve (exact amount, only if needed) then create a payment — on ArcClaimV2 when it is deployed,
 * otherwise on the Phase 1 contract. All checks here are UX only; the contract enforces the rules.
 * Resend uses this same flow: it always creates a brand-new payment.
 */
export function useCreatePayment() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<CreateStep>("idle");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CreatedPayment>();

  const reset = useCallback(() => {
    setStep("idle");
    setNeedsApproval(false);
    setError(undefined);
    setResult(undefined);
  }, []);

  const create = useCallback(
    async ({ recipient, amount, expiry }: CreatePaymentInput) => {
      setError(undefined);
      setResult(undefined);
      setNeedsApproval(false);
      const version = isV2Enabled ? 2 : 1;
      const contract = version === 2 ? V2 : V1;
      try {
        if (!isV2Enabled && !isV1Enabled) throw new FriendlyError("Payments are not configured for this network.");
        if (recipient === zeroAddress) throw new FriendlyError("Recipient cannot be the zero address.");
        if (amount <= 0n) throw new FriendlyError("Amount must be greater than 0.");
        if (expiry === 0n && version === 1) throw new FriendlyError("Never-expiring payments need ArcClaim V2.");
        if (expiry !== 0n && expiry <= BigInt(nowSeconds())) throw new FriendlyError("Expiration must be in the future.");

        setStep("checking");
        const sender = await requireArcAccount(config);
        const chainId = arcChain.id;

        const approvalTxHash = await ensureUsdcAllowance(config, sender, contract.address, amount, (s) => {
          setNeedsApproval(true);
          setStep(s);
        });

        setStep("create-wallet");
        let txHash: Hash;
        if (version === 2) {
          const { request } = await simulateContract(config, {
            address: V2.address,
            abi: V2.abi,
            functionName: "createPayment",
            args: [recipient, amount, expiry],
            account: sender,
            chainId,
          });
          txHash = await writeContract(config, request);
        } else {
          const { request } = await simulateContract(config, {
            address: V1.address,
            abi: V1.abi,
            functionName: "createClaim",
            args: [recipient, amount, expiry],
            account: sender,
            chainId,
          });
          txHash = await writeContract(config, request);
        }
        setStep("creating");
        const receipt = await waitForSuccess(config, txHash);

        const ref = readCreatedRef(receipt, version);
        if (!ref) throw new FriendlyError("Payment created, but its ID could not be read. Check the dashboard.");

        setResult({
          ref,
          sender,
          recipient,
          amount,
          expiry,
          txHash,
          blockNumber: receipt.blockNumber,
          approvalTxHash,
        });
        setStep("success");
      } catch (e) {
        setError(toFriendlyMessage(e));
        setStep("error");
      } finally {
        void refreshChainReads(queryClient);
      }
    },
    [config, queryClient],
  );

  const isBusy = step !== "idle" && step !== "success" && step !== "error";

  return { create, reset, step, message: CREATE_STEP_MESSAGE[step], needsApproval, error, result, isBusy };
}
